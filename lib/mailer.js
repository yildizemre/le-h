// Gmail gönderimi: zamanlı kuyruk (günlük limit, saat aralığı, rastgele bekleme), takip mailleri, IMAP ile yanıt yakalama
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { all, get, run, setting, setSetting, jsonSetting } = require('./db');
const { event } = require('./notify');
const ai = require('./ai');

const SCHED_DEF = { days: [1, 2, 3, 4, 5], start: 9, end: 18, daily: 40, min_delay: 120, max_delay: 300, warmup: true, per_domain: 2 };
const schedule = () => jsonSetting('schedule', SCHED_DEF);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fill(tpl, c, me = {}) {
  const parts = String(c.name || '').trim().split(/\s+/);
  const v = { ad: parts[0] || '', soyad: parts.slice(1).join(' '), adsoyad: c.name || '', sirket: c.company || '', unvan: c.title || '', gonderen: me.name || '' };
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => v[k] ?? m);
}
const html = (body, signature) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#222">${esc(body).replace(/\n/g, '<br>')}${signature ? '<br><br>' + signature : ''}</div>`;

function transport() {
  const user = setting('gmail_user'), pass = setting('gmail_pass');
  if (!user || !pass) throw Object.assign(new Error('Ayarlar → Gmail adresi ve uygulama şifresi girilmemiş'), { status: 400 });
  const name = setting('from_name') || ai.project().sender_name;
  return { t: nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }), from: name ? `"${name.replace(/"/g, '')}" <${user}>` : user, user };
}

// Bağlantı testi: SMTP doğrula + test maili gönder
const friendly = e => /535|Username and Password|Invalid login/i.test(e.message)
  ? new Error('Gmail girişi reddedildi: normal şifre değil, 16 haneli UYGULAMA ŞİFRESİ gerekir (2 adımlı doğrulama açık olmalı).')
  : /ENOTFOUND|ETIMEDOUT|ECONNREFUSED/.test(e.message) ? new Error('Gmail sunucusuna bağlanılamadı: ' + e.message) : e;
async function testGmail(to, signature) {
  const { t, from, user } = transport();
  try { await t.verify(); } catch (e) { throw Object.assign(friendly(e), { status: 400 }); }
  const info = await t.sendMail({ from, to: to || user, subject: 'Lead-AI Gmail testi ✔', html: html('Bu bir test mailidir. Gmail bağlantısı çalışıyor.\n\nLead-AI', signature) });
  return { ok: true, to: to || user, id: info.messageId };
}

// İstanbul saatine göre şimdi
function nowTR() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', weekday: 'short', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hour: +p.hour % 24, date: `${p.year}-${p.month}-${p.day}` };
}
// İstanbul günü başlangıcı (UTC+3)
const dayStart = () => new Date(nowTR().date + 'T00:00:00+03:00').toISOString();
const sentToday = () => get("SELECT count(*) n FROM outbox WHERE status='gönderildi' AND sent_at>=?", dayStart()).n;
// Isınma: yeni gönderim hesabında günde 10 ile başla, her gün +3, üst sınır = ayarlanan günlük limit
function effectiveDaily(s = schedule()) {
  if (!s.warmup) return s.daily;
  const first = get("SELECT min(sent_at) t FROM outbox WHERE status='gönderildi'").t;
  const days = first ? Math.floor((Date.now() - new Date(first)) / 864e5) : 0;
  return Math.min(s.daily, 10 + days * 3);
}
const FREE = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'yandex.com', 'live.com'];
const domainSentToday = d => get("SELECT count(*) n FROM outbox WHERE status='gönderildi' AND sent_at>=? AND lower(to_email) LIKE ?", dayStart(), '%@' + d).n;

function scheduleState() {
  const s = schedule(), n = nowTR();
  const inDay = s.days.includes(n.day), inHour = n.hour >= s.start && n.hour < s.end;
  const today = sentToday(), daily = effectiveDaily(s);
  let why = '';
  if (!setting('gmail_user') || !setting('gmail_pass')) why = 'Gmail ayarı yok';
  else if (setting('sending_paused') === '1') why = 'Gönderim duraklatıldı';
  else if (!inDay) why = 'Bugün gönderim günü değil';
  else if (!inHour) why = `Gönderim saati dışında (${s.start}:00–${s.end}:00)`;
  else if (today >= daily) why = `Günlük limit doldu (${today}/${daily})${daily < s.daily ? ' — ısınma modu' : ''}`;
  return { ok: !why, why, today, daily, max: s.daily, warmup: daily < s.daily, nextAt, queued: get("SELECT count(*) n FROM outbox WHERE status='sırada'").n };
}

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

let nextAt = 0, busy = false;
const OSEL = `SELECT o.*, c.name, c.company, c.title, c.location, c.industry, c.linkedin, c.domain FROM outbox o JOIN contacts c ON c.id=o.contact_id`;
async function tick() {
  if (busy) return; busy = true;
  try {
    if (!scheduleState().ok || Date.now() < nextAt) return;
    const sc = schedule();
    const list = all(`${OSEL} WHERE o.status='sırada' AND (o.scheduled_at IS NULL OR o.scheduled_at<=?)
      AND (o.campaign_id IS NULL OR o.campaign_id IN (SELECT id FROM campaigns WHERE status='aktif')) ORDER BY o.step DESC, o.id LIMIT 80`, new Date().toISOString());
    // Aynı firmaya (alan adı) günde en fazla N mail: toplu gönderim izlenimi vermemek için
    const o = list.find(x => { const d = String(x.to_email).split('@')[1]?.toLowerCase() || ''; return FREE.includes(d) || domainSentToday(d) < (sc.per_domain || 2); });
    if (!o) return;
    await deliver(o);
    const s = schedule();
    nextAt = Date.now() + (s.min_delay + Math.random() * Math.max(0, s.max_delay - s.min_delay)) * 1000;
  } catch (e) { console.error('mail tick', e.message); }
  finally { busy = false; }
}

// Tekli gönderim: saat penceresini beklemez, günlük limite ve engel listesine uyar
async function sendNow(id) {
  for (let i = 0; busy && i < 60; i++) await new Promise(r => setTimeout(r, 1000));
  const o = get(`${OSEL} WHERE o.id=? AND o.status IN ('taslak','sırada','hata')`, id);
  if (!o) throw Object.assign(new Error('Mail bulunamadı veya zaten gönderildi'), { status: 404 });
  const st = scheduleState();
  if (st.today >= st.daily) throw Object.assign(new Error(`Günlük limit doldu (${st.today}/${st.daily}). Gmail'i korumak için yarın devam eder.`), { status: 400 });
  busy = true;
  try { await deliver({ ...o, force: true }); } finally { busy = false; }
  const n = get('SELECT status, error FROM outbox WHERE id=?', id);
  if (n.status !== 'gönderildi') throw Object.assign(new Error(n.error || 'Gönderilemedi'), { status: 400 });
}

async function deliver(o) {
  {
    if (suppressed({ ...o, email: o.to_email })) { run("UPDATE outbox SET status='iptal', error='engel listesi' WHERE id=?", o.id); return; }
    const lead = o.campaign_id && get('SELECT stage FROM leads WHERE campaign_id=? AND contact_id=?', o.campaign_id, o.contact_id);
    if (lead?.stage === 'yanıtladı') { run("UPDATE outbox SET status='iptal', error='yanıt geldi' WHERE id=?", o.id); return; }
    const camp = o.campaign_id ? get('SELECT * FROM campaigns WHERE id=?', o.campaign_id) : null;
    if (camp && camp.status !== 'aktif' && !o.force) return;
    const prev = o.step > 0 ? get("SELECT * FROM outbox WHERE contact_id=? AND campaign_id IS ? AND step=? AND status='gönderildi'", o.contact_id, o.campaign_id, o.step - 1) : null;
    const user = get('SELECT * FROM users WHERE id=?', o.user_id) || {};
    let { subject, body } = o;
    if (!body) { // takip maili: gönderim anında AI ile yaz
      const d = await ai.draftEmail(camp || {}, o, o.step, prev);
      body = d.body; subject = prev ? (/^re:/i.test(prev.subject) ? prev.subject : 'Re: ' + prev.subject) : d.subject;
      run('UPDATE outbox SET subject=?, body=? WHERE id=?', subject, body, o.id);
    }
    const { t, from } = transport();
    const msg = { from, to: o.to_email, subject: fill(subject, o, user), html: html(fill(body, o, user), user.signature) };
    if (prev?.message_id) { msg.inReplyTo = prev.message_id; msg.references = [prev.message_id]; }
    try {
      const info = await t.sendMail(msg);
      run("UPDATE outbox SET status='gönderildi', sent_at=?, message_id=?, subject=?, error=NULL WHERE id=?", new Date().toISOString(), info.messageId, msg.subject, o.id);
      if (o.campaign_id) {
        run('UPDATE leads SET stage=? WHERE campaign_id=? AND contact_id=?', o.step ? `takip ${o.step}` : 'gönderildi', o.campaign_id, o.contact_id);
        const fus = ai.list(camp?.followups);
        if (fus[o.step] && +fus[o.step].days > 0)
          run("INSERT INTO outbox(campaign_id,contact_id,step,to_email,subject,body,status,scheduled_at,user_id) VALUES(?,?,?,?,?,'','sırada',?,?)",
            o.campaign_id, o.contact_id, o.step + 1, o.to_email, '', new Date(Date.now() + fus[o.step].days * 864e5).toISOString(), o.user_id);
      }
      event('sent', `${o.name} (${o.company}) → ${o.to_email}\n"${msg.subject}"${o.step ? ` · takip ${o.step}` : ''}`, o.campaign_id);
    } catch (e) {
      run("UPDATE outbox SET status='hata', error=? WHERE id=?", e.message.slice(0, 300), o.id);
      event('error', `Mail gönderilemedi: ${o.to_email} — ${e.message.slice(0, 150)}`, o.campaign_id);
      if (/Invalid login|Username and Password|535/i.test(e.message)) setSetting('sending_paused', '1');
    }
  }
}

// Geri dönen mail: adres geçersiz → bir daha asla gönderme; çok geri dönüş = hesap riski → gönderimi durdur
function markBounce(o) {
  if (get("SELECT 1 FROM outbox WHERE id=? AND status='geri döndü'", o.id)) return;
  run("UPDATE outbox SET status='geri döndü', error='adres geçersiz (bounce)' WHERE id=?", o.id);
  run("UPDATE outbox SET status='iptal', error='adres geçersiz' WHERE contact_id=? AND status IN ('sırada','taslak')", o.contact_id);
  run("UPDATE contacts SET email='', status='geçersiz mail' WHERE id=? AND lower(email)=?", o.contact_id, o.to_email.toLowerCase());
  run("UPDATE leads SET stage='geri döndü' WHERE contact_id=?", o.contact_id);
  run("INSERT OR IGNORE INTO suppress(type,value) VALUES('email',?)", o.to_email.toLowerCase());
  event('error', `Mail geri döndü (geçersiz adres): ${o.name} <${o.to_email}>`, o.campaign_id);
  const n = get("SELECT count(*) n FROM outbox WHERE status='geri döndü' AND sent_at>=?", new Date(Date.now() - 864e5).toISOString()).n;
  if (n >= 3 && setting('sending_paused') !== '1') {
    setSetting('sending_paused', '1');
    event('error', `Son 24 saatte ${n} mail geri döndü — Gmail hesabını korumak için gönderim DURDURULDU. Listeyi kontrol edip Gönderim Takvimi'nden tekrar aç.`);
  }
}

// Gelen kutusunda yanıt arama (gönderdiğimiz kişilerden gelen mail = yanıt)
let imapBusy = false;
async function checkReplies() {
  const user = setting('gmail_user'), pass = setting('gmail_pass');
  if (!user || !pass || imapBusy) return;
  if (!get("SELECT 1 FROM outbox WHERE status='gönderildi'")) return;
  imapBusy = true;
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const last = +setting('imap_last_uid') || 0;
      const since = new Date(Date.now() - 14 * 864e5);
      const uids = (await client.search({ since }, { uid: true })) || [];
      let max = last;
      const fresh = uids.filter(u => u > last);
      const bounces = [];
      if (fresh.length) for await (const m of client.fetch(fresh.join(','), { envelope: true, uid: true }, { uid: true })) {
        max = Math.max(max, m.uid);
        const from = (m.envelope?.from?.[0]?.address || '').toLowerCase();
        if (!from || from === user.toLowerCase()) continue;
        if (/mailer-daemon|postmaster|mail delivery/i.test(from + ' ' + (m.envelope?.from?.[0]?.name || ''))) { bounces.push(m.uid); continue; }
        const sent = get("SELECT o.*, c.name, c.company FROM outbox o JOIN contacts c ON c.id=o.contact_id WHERE lower(o.to_email)=? AND o.status='gönderildi' ORDER BY o.id DESC LIMIT 1", from);
        if (!sent) continue;
        run("UPDATE leads SET stage='yanıtladı' WHERE contact_id=?", sent.contact_id);
        run("UPDATE outbox SET status='iptal', error='yanıt geldi' WHERE contact_id=? AND status IN ('sırada','taslak')", sent.contact_id);
        run("UPDATE contacts SET status='yanıtladı' WHERE id=?", sent.contact_id);
        event('reply', `YANIT GELDİ: ${sent.name} (${sent.company}) <${from}>\nKonu: ${m.envelope?.subject || ''}`, sent.campaign_id);
      }
      if (bounces.length) {
        const recent = all("SELECT o.*, c.name, c.company FROM outbox o JOIN contacts c ON c.id=o.contact_id WHERE o.status='gönderildi' AND o.sent_at>=?", new Date(Date.now() - 14 * 864e5).toISOString());
        for await (const m of client.fetch(bounces.join(','), { source: true, uid: true }, { uid: true })) {
          const txt = String(m.source || '').toLowerCase();
          for (const o of recent) if (txt.includes(o.to_email.toLowerCase())) markBounce(o);
        }
      }
      setSetting('imap_last_uid', String(max || (uids.length ? Math.max(...uids) : 0)));
    } finally { lock.release(); }
    await client.logout();
  } catch (e) { console.error('imap', e.message); try { await client.logout(); } catch {} }
  finally { imapBusy = false; }
}

function start() {
  setInterval(tick, 20000); setTimeout(tick, 5000);
  setInterval(checkReplies, 5 * 60000); setTimeout(checkReplies, 30000);
}

module.exports = { start, sendNow, effectiveDaily, testGmail, transport, fill, html, scheduleState, schedule, SCHED_DEF, suppressed, cancelSuppressed, checkReplies, tick };
