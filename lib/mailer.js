// Mail gönderimi: çoklu gönderen hesap, zamanlı kuyruk (gün/saat penceresi, hesap başı günlük limit + ısınma,
// rastgele bekleme, firma başı limit), kişiye özel ilk cümle, göndermeden adres doğrulama, takip mailleri.
// Gelen kutusu / yanıt işleme lib/inbox.js'de.
const nodemailer = require('nodemailer');
const { all, get, run, setting, setSetting, jsonSetting } = require('./db');
const { event } = require('./notify');
const ai = require('./ai');
const verify = require('./verify');

const SCHED_DEF = { days: [1, 2, 3, 4, 5], start: 9, end: 18, daily: 40, min_delay: 120, max_delay: 300, warmup: true, per_domain: 2 };
const schedule = () => jsonSetting('schedule', SCHED_DEF);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fill(tpl, c, me = {}) {
  const parts = String(c.name || '').trim().split(/\s+/);
  const v = { ad: parts[0] || '', soyad: parts.slice(1).join(' '), adsoyad: c.name || '', sirket: c.company || '', unvan: c.title || '', gonderen: me.name || '', kisisel: c.opener || '' };
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => v[k] ?? m).replace(/\n{3,}/g, '\n\n');
}
const html = (body, signature) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#222">${esc(body).replace(/\n/g, '<br>')}${signature ? '<br><br>' + signature : ''}</div>`;

// Kişisel cümleyi selamlamadan sonraki ilk paragraf olarak yerleştir ({{kisisel}} varsa oraya)
function withOpener(body, opener) {
  if (!opener) return String(body || '').replace(/\{\{\s*kisisel\s*\}\}\n*/g, '');
  if (/\{\{\s*kisisel\s*\}\}/.test(body)) return body;
  const parts = String(body).split(/\n\s*\n/);
  if (parts.length > 1 && parts[0].length < 80 && /[,!:]\s*$/.test(parts[0].trim())) return [parts[0], '{{kisisel}}', ...parts.slice(1)].join('\n\n');
  return '{{kisisel}}\n\n' + body;
}

// ---------------- Gönderen hesaplar ----------------
function migrateSenders() {
  if (!get('SELECT 1 FROM senders') && setting('gmail_user') && setting('gmail_pass')) {
    run('INSERT OR IGNORE INTO senders(email,pass,name,daily,imap_last_uid) VALUES(?,?,?,?,?)', setting('gmail_user').toLowerCase(), setting('gmail_pass'),
      setting('from_name') || '', schedule().daily || 40, +setting('imap_last_uid') || 0);
    const s = get('SELECT id FROM senders LIMIT 1');
    if (s) run('UPDATE outbox SET sender_id=? WHERE sender_id IS NULL', s.id);
  }
}
const senders = (activeOnly = true) => all(`SELECT * FROM senders ${activeOnly ? 'WHERE active=1' : ''} ORDER BY id`);
const tcache = new Map();
function transportFor(s) {
  if (!s) throw Object.assign(new Error('Entegrasyonlar → en az bir gönderen Gmail hesabı ekle'), { status: 400 });
  const key = s.id + ':' + s.pass;
  if (!tcache.has(key)) tcache.set(key, nodemailer.createTransport({ service: 'gmail', auth: { user: s.email, pass: s.pass }, pool: true, maxConnections: 1 }));
  const name = s.name || setting('from_name') || ai.project().sender_name;
  return { t: tcache.get(key), from: name ? `"${name.replace(/"/g, '')}" <${s.email}>` : s.email, user: s.email };
}
const transport = () => transportFor(senders()[0]); // geriye uyumluluk

const friendly = e => /535|Username and Password|Invalid login/i.test(e.message)
  ? new Error('Gmail girişi reddedildi: normal şifre değil, 16 haneli UYGULAMA ŞİFRESİ gerekir (2 adımlı doğrulama açık olmalı).')
  : /ENOTFOUND|ETIMEDOUT|ECONNREFUSED/.test(e.message) ? new Error('Gmail sunucusuna bağlanılamadı: ' + e.message) : e;
async function testSender(s, to, signature) {
  const tp = transportFor(s);
  try { await tp.t.verify(); } catch (e) { throw Object.assign(friendly(e), { status: 400 }); }
  const info = await tp.t.sendMail({ from: tp.from, to: to || s.email, subject: 'Lead-AI gönderim testi ✔', html: html(`Bu bir test mailidir. ${s.email} hesabından gönderim çalışıyor.\n\nLead-AI`, signature) });
  return { ok: true, to: to || s.email, id: info.messageId };
}
const testGmail = (to, signature) => testSender(senders()[0], to, signature);

// ---------------- Zaman / limitler ----------------
function nowTR() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', weekday: 'short', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hour: +p.hour % 24, date: `${p.year}-${p.month}-${p.day}` };
}
const dayStart = () => new Date(nowTR().date + 'T00:00:00+03:00').toISOString();
const sentToday = sid => sid
  ? get("SELECT count(*) n FROM outbox WHERE status='gönderildi' AND sent_at>=? AND sender_id=?", dayStart(), sid).n
  : get("SELECT count(*) n FROM outbox WHERE status='gönderildi' AND sent_at>=?", dayStart()).n;
// Isınma: her hesap kendi ilk gönderiminden itibaren günde 10 ile başlar, her gün +3
function senderDaily(s, sc = schedule()) {
  const cap = Math.max(1, +s.daily || sc.daily || 40);
  if (!sc.warmup) return cap;
  const first = get("SELECT min(sent_at) t FROM outbox WHERE status='gönderildi' AND sender_id=?", s.id).t;
  const days = first ? Math.floor((Date.now() - new Date(first)) / 864e5) : 0;
  return Math.min(cap, 10 + days * 3);
}
const effectiveDaily = () => senders().reduce((a, s) => a + senderDaily(s), 0);
const FREE = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'yandex.com', 'live.com'];
const domainSentToday = d => get("SELECT count(*) n FROM outbox WHERE status='gönderildi' AND sent_at>=? AND lower(to_email) LIKE ?", dayStart(), '%@' + d).n;

const nextAt = {}; // gönderen başına bir sonraki gönderim zamanı
function windowState(sc = schedule()) {
  const n = nowTR();
  if (!senders().length) return 'Gönderen Gmail hesabı yok';
  if (setting('sending_paused') === '1') return 'Gönderim duraklatıldı';
  if (!sc.days.includes(n.day)) return 'Bugün gönderim günü değil';
  if (!(n.hour >= sc.start && n.hour < sc.end)) return `Gönderim saati dışında (${sc.start}:00–${sc.end}:00)`;
  return '';
}
function senderStats() {
  const sc = schedule();
  return senders(false).map(s => ({ id: s.id, email: s.email, name: s.name, active: s.active, today: sentToday(s.id), daily: senderDaily(s, sc), max: s.daily, nextAt: nextAt[s.id] || 0 }));
}
function scheduleState() {
  const sc = schedule(), list = senderStats().filter(s => s.active);
  const today = sentToday(), daily = list.reduce((a, s) => a + s.daily, 0), max = list.reduce((a, s) => a + (+s.max || sc.daily), 0);
  let why = windowState(sc);
  if (!why && list.length && list.every(s => s.today >= s.daily)) why = `Günlük limit doldu (${today}/${daily})${daily < max ? ' — ısınma modu' : ''}`;
  return { ok: !why, why, today, daily, max, warmup: daily < max, senders: list, queued: get("SELECT count(*) n FROM outbox WHERE status='sırada'").n };
}
// Uygun gönderen: kapasitesi olan, bekleme süresi dolmuş, en az kullanılmış hesap
function pickSender(o, { ignoreWait } = {}) {
  const sc = schedule(), list = senders();
  if (o.step > 0) { // takip/yanıt aynı hesaptan gitmeli (aynı zincir)
    const prev = get("SELECT sender_id FROM outbox WHERE contact_id=? AND step<? AND status='gönderildi' AND sender_id IS NOT NULL ORDER BY step DESC LIMIT 1", o.contact_id, o.step);
    const s = prev && list.find(x => x.id === prev.sender_id);
    if (prev && !s) return null; // o hesap pasif
    if (s) return sentToday(s.id) < senderDaily(s, sc) && (ignoreWait || Date.now() >= (nextAt[s.id] || 0)) ? s : null;
  }
  return list.filter(s => sentToday(s.id) < senderDaily(s, sc) && (ignoreWait || Date.now() >= (nextAt[s.id] || 0)))
    .sort((a, b) => sentToday(a.id) / senderDaily(a, sc) - sentToday(b.id) / senderDaily(b, sc))[0] || null;
}

// ---------------- Engel listesi ----------------
function suppressed(c) {
  const email = String(c.email || c.to_email || '').toLowerCase();
  const dom = email.split('@')[1] || '', cdom = String(c.domain || '').toLowerCase().replace(/^www\./, '');
  return !!get(`SELECT 1 FROM suppress WHERE (type='email' AND value=?) OR (type='domain' AND value IN (?,?)) OR (type='linkedin' AND value<>'' AND value=?)
    OR (type='name' AND value=?)`, email, dom, cdom || '-', String(c.linkedin || '').toLowerCase(), (String(c.name || '') + '|' + String(c.company || '')).toLocaleLowerCase('tr'));
}
function cancelSuppressed() {
  for (const o of all("SELECT o.id, o.to_email, c.* FROM outbox o JOIN contacts c ON c.id=o.contact_id WHERE o.status IN ('sırada','taslak')"))
    if (suppressed({ ...o, email: o.to_email })) run("UPDATE outbox SET status='iptal', error='engel listesi' WHERE id=?", o.id);
}

// ---------------- Kuyruk ----------------
let busy = false;
const OSEL = `SELECT o.*, c.name, c.company, c.title, c.location, c.industry, c.linkedin, c.domain, c.emails, c.email_check, c.opener AS c_opener FROM outbox o JOIN contacts c ON c.id=o.contact_id`;
async function tick() {
  if (busy) return; busy = true;
  try {
    const sc = schedule();
    if (windowState(sc)) return;
    const list = all(`${OSEL} WHERE o.status='sırada' AND (o.scheduled_at IS NULL OR o.scheduled_at<=?)
      AND (o.campaign_id IS NULL OR o.campaign_id IN (SELECT id FROM campaigns WHERE status='aktif')) ORDER BY o.step DESC, o.id LIMIT 120`, new Date().toISOString());
    for (const o of list) {
      const d = String(o.to_email).split('@')[1]?.toLowerCase() || '';
      if (!FREE.includes(d) && domainSentToday(d) >= (sc.per_domain || 2)) continue; // aynı firmaya günde en fazla N
      const s = pickSender(o); if (!s) continue;
      const r = await deliver(o, s);
      if (r === 'skip') continue; // doğrulamada elendi, sıradakine geç (bekleme yok)
      nextAt[s.id] = Date.now() + (sc.min_delay + Math.random() * Math.max(0, sc.max_delay - sc.min_delay)) * 1000;
      break; // tur başına tek mail
    }
  } catch (e) { console.error('mail tick', e.message); }
  finally { busy = false; }
}

// Tekli gönderim: saat penceresini beklemez; hesap limitine, doğrulamaya ve engel listesine uyar
async function sendNow(id) {
  for (let i = 0; busy && i < 60; i++) await new Promise(r => setTimeout(r, 1000));
  const o = get(`${OSEL} WHERE o.id=? AND o.status IN ('taslak','sırada','hata')`, id);
  if (!o) throw Object.assign(new Error('Mail bulunamadı veya zaten gönderildi'), { status: 404 });
  if (!senders().length) throw Object.assign(new Error('Gönderen Gmail hesabı yok'), { status: 400 });
  const s = pickSender(o, { ignoreWait: true });
  if (!s) throw Object.assign(new Error('Tüm gönderen hesapların bugünkü limiti doldu — Gmail\'i korumak için yarın devam eder.'), { status: 400 });
  busy = true;
  try { await deliver({ ...o, force: true }, s); } finally { busy = false; }
  const n = get('SELECT status, error FROM outbox WHERE id=?', id);
  if (n.status !== 'gönderildi') throw Object.assign(new Error(n.error || 'Gönderilemedi'), { status: 400 });
}

const STOP_STAGES = ['yanıtladı', 'ilgisiz', 'yanlış kişi', 'sonra yaz'];
async function deliver(o, sender) {
  if (suppressed({ ...o, email: o.to_email })) { run("UPDATE outbox SET status='iptal', error='engel listesi' WHERE id=?", o.id); return 'skip'; }
  const lead = o.campaign_id && get('SELECT stage FROM leads WHERE campaign_id=? AND contact_id=?', o.campaign_id, o.contact_id);
  if (STOP_STAGES.includes(lead?.stage) && !o.force && o.step < 100) { run("UPDATE outbox SET status='iptal', error=? WHERE id=?", 'kişi ' + lead.stage, o.id); return 'skip'; }
  const camp = o.campaign_id ? get('SELECT * FROM campaigns WHERE id=?', o.campaign_id) : null;
  if (camp && camp.status !== 'aktif' && !o.force) return 'skip';

  // 3) Göndermeden adres doğrulama (sadece ilk mail; takipler zaten ulaşmış adrese gider)
  if (o.step === 0) {
    const v = await verify.checkContact({ id: o.contact_id, email: o.to_email, emails: o.emails, email_check: o.email_check });
    if (v.status === 'geçersiz') {
      run("UPDATE outbox SET status='iptal', error=? WHERE id=?", 'adres doğrulanamadı: ' + v.reason, o.id);
      if (o.campaign_id) run("UPDATE leads SET stage='geçersiz mail' WHERE campaign_id=? AND contact_id=?", o.campaign_id, o.contact_id);
      event('error', `Gönderilmedi (adres geçersiz): ${o.name} <${o.to_email}> — ${v.reason}`, o.campaign_id);
      return 'skip';
    }
  }

  const prev = o.step > 0 ? get("SELECT * FROM outbox WHERE contact_id=? AND campaign_id IS ? AND step<? AND status='gönderildi' ORDER BY step DESC LIMIT 1", o.contact_id, o.campaign_id, Math.min(o.step, 100)) : null;
  const user = get('SELECT * FROM users WHERE id=?', o.user_id) || {};
  let { subject, body } = o;
  if (!body) { // takip maili: gönderim anında AI ile yaz
    const d = await ai.draftEmail(camp || {}, o, o.step, prev);
    body = d.body; subject = prev ? (/^re:/i.test(prev.subject) ? prev.subject : 'Re: ' + prev.subject) : d.subject;
    run('UPDATE outbox SET subject=?, body=? WHERE id=?', subject, body, o.id);
  }

  // 1) Kişiye özel ilk cümle (ilk mail, açıksa). Bulunamazsa mail şablonla aynen gider.
  let opener = o.opener || '';
  if (o.step === 0 && o.personal && !opener) {
    if (o.c_opener) opener = o.c_opener;
    else {
      try {
        const en = /^(hi|hello|dear)\b/i.test(String(body).trim());
        opener = (await ai.opener(o, en ? 'English' : 'Türkçe')).opener || '';
        if (opener) run('UPDATE contacts SET opener=? WHERE id=?', opener, o.contact_id);
      } catch (e) { console.error('opener', e.message); }
    }
    run('UPDATE outbox SET opener=? WHERE id=?', opener || '-', o.id);
  }
  if (opener === '-') opener = '';
  const ctx = { ...o, opener };
  const finalBody = o.personal || /\{\{\s*kisisel\s*\}\}/.test(body) ? withOpener(body, opener) : body;

  const { t, from } = transportFor(sender);
  const msg = { from, to: o.to_email, subject: fill(subject, ctx, user), html: html(fill(finalBody, ctx, user), user.signature),
    headers: { 'X-Lead-AI': String(o.id) } };
  if (prev?.message_id) { msg.inReplyTo = prev.message_id; msg.references = [prev.message_id]; }
  if (o.reply_to_id) { const rp = get('SELECT message_id FROM replies WHERE id=?', o.reply_to_id); if (rp?.message_id) { msg.inReplyTo = rp.message_id; msg.references = [rp.message_id]; } }
  try {
    const info = await t.sendMail(msg);
    run("UPDATE outbox SET status='gönderildi', sent_at=?, message_id=?, subject=?, body=?, sender_id=?, error=NULL WHERE id=?",
      new Date().toISOString(), info.messageId, msg.subject, fill(finalBody, ctx, user), sender.id, o.id);
    if (o.campaign_id && o.step < 100) {
      run('UPDATE leads SET stage=? WHERE campaign_id=? AND contact_id=?', o.step ? `takip ${o.step}` : 'gönderildi', o.campaign_id, o.contact_id);
      const fus = ai.list(camp?.followups);
      if (fus[o.step] && +fus[o.step].days > 0)
        run("INSERT INTO outbox(campaign_id,contact_id,step,to_email,subject,body,status,scheduled_at,user_id,sender_id) VALUES(?,?,?,?,?,'','sırada',?,?,?)",
          o.campaign_id, o.contact_id, o.step + 1, o.to_email, '', new Date(Date.now() + fus[o.step].days * 864e5).toISOString(), o.user_id, sender.id);
    }
    event('sent', `${o.name} (${o.company}) → ${o.to_email}\n"${msg.subject}"${o.step >= 100 ? ' · yanıt' : o.step ? ` · takip ${o.step}` : ''}${opener ? ' · kişisel cümleli' : ''} · ${sender.email}`, o.campaign_id);
    return 'sent';
  } catch (e) {
    run("UPDATE outbox SET status='hata', error=? WHERE id=?", e.message.slice(0, 300), o.id);
    event('error', `Mail gönderilemedi: ${o.to_email} — ${e.message.slice(0, 150)} (${sender.email})`, o.campaign_id);
    if (/Invalid login|Username and Password|535/i.test(e.message)) { run('UPDATE senders SET active=0, note=? WHERE id=?', 'giriş reddedildi', sender.id); event('error', `${sender.email} hesabı devre dışı bırakıldı: Gmail girişi reddedildi`); }
    if (/rate|limit|quota|5\.4\.5|421|550 5\.4/i.test(e.message)) { nextAt[sender.id] = Date.now() + 6 * 3600e3; event('error', `${sender.email}: Gmail gönderim sınırı uyarısı — bu hesap 6 saat dinlendiriliyor`); }
    return 'error';
  }
}

function start() {
  migrateSenders();
  setInterval(tick, 20000); setTimeout(tick, 5000);
}

module.exports = { start, sendNow, deliver, pickSender, senders, transportFor, testSender, testGmail, transport, effectiveDaily, senderStats, fill, html, withOpener,
  scheduleState, schedule, SCHED_DEF, suppressed, cancelSuppressed, tick, nowTR, dayStart, migrateSenders };
