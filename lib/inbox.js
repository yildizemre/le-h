// Gelen kutusu: her gönderen hesabın INBOX'ını tarar; bizim mail attığımız kişilerden gelenleri "yanıt" olarak kaydeder,
// AI ile etiketler ve etikete göre aksiyon alır. Geri dönen (bounce) mailleri de yakalar.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { all, get, run, setting, setSetting } = require('./db');
const { event } = require('./notify');
const ai = require('./ai');
const mailer = require('./mailer');

// Alıntı/imza kısmını at: "On ... wrote:", "... tarihinde ... yazdı:", "-----Original Message-----", ">" satırları
function stripQuoted(t) {
  const lines = String(t || '').replace(/\r/g, '').split('\n'), out = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^(On .+wrote:|.+tarihinde .+yazdı:|-{2,}\s*(Original Message|Orijinal İleti|Forwarded)|From:\s.+|Kimden:\s.+|Gönderen:\s.+)$/i.test(l.trim())) break;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

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
    event('error', `Son 24 saatte ${n} mail geri döndü — Gmail hesaplarını korumak için gönderim DURDURULDU. Listeyi kontrol edip Gönderim Takvimi'nden tekrar aç.`);
  }
}

const EMO = { 'ilgileniyor': '🔥', 'soru': '❓', 'sonra yaz': '🕓', 'ilgisiz': '🚫', 'yanlış kişi': '↪️', 'otomatik cevap': '🏖️' };
const iso = d => { const t = Date.parse(d); return isNaN(t) ? null : new Date(t).toISOString(); };

// Etikete göre aksiyon
async function applyLabel(rep, r) {
  const c = get('SELECT * FROM contacts WHERE id=?', rep.contact_id) || {};
  const camp = rep.campaign_id;
  const cancelQueued = why => run("UPDATE outbox SET status='iptal', error=? WHERE contact_id=? AND status IN ('sırada','taslak') AND step<100", why, rep.contact_id);
  const stage = s => { run('UPDATE leads SET stage=? WHERE contact_id=?', s, rep.contact_id); run('UPDATE contacts SET status=? WHERE id=?', s, rep.contact_id); };
  let ret = r.return_date && iso(r.return_date + 'T07:00:00+03:00');
  let note = '';
  switch (r.label) {
    case 'otomatik cevap': { // sıra devam etsin; bekleyen takipleri dönüş tarihinin ertesi gününe kaydır
      const at = ret ? new Date(Date.parse(ret) + 864e5).toISOString() : new Date(Date.now() + 5 * 864e5).toISOString();
      const n = run("UPDATE outbox SET scheduled_at=? WHERE contact_id=? AND status='sırada' AND step<100 AND (scheduled_at IS NULL OR scheduled_at<?)", at, rep.contact_id, at).changes;
      note = n ? `takip ${at.slice(0, 10)} tarihine ertelendi` : 'sıra değişmedi';
      run("UPDATE replies SET status='tamam' WHERE id=?", rep.id);
      break;
    }
    case 'ilgisiz':
      cancelQueued('ilgisiz'); stage('ilgisiz');
      run("INSERT OR IGNORE INTO suppress(type,value) VALUES('email',?)", String(rep.from_email).toLowerCase());
      note = 'engel listesine alındı'; run("UPDATE replies SET status='tamam' WHERE id=?", rep.id);
      break;
    case 'sonra yaz': {
      cancelQueued('sonra yaz'); stage('sonra yaz');
      const at = ret || new Date(Date.now() + 30 * 864e5).toISOString();
      const last = get("SELECT max(step) s, max(sender_id) sid FROM outbox WHERE contact_id=? AND status='gönderildi' AND step<100", rep.contact_id);
      run("INSERT INTO outbox(campaign_id,contact_id,step,to_email,subject,body,status,scheduled_at,user_id,sender_id) VALUES(?,?,?,?,?,'','sırada',?,1,?)",
        camp, rep.contact_id, (last?.s ?? 0) + 1, rep.from_email, '', at, last?.sid || rep.sender_id);
      note = `${at.slice(0, 10)} tarihinde tekrar yazılacak`;
      break;
    }
    case 'yanlış kişi': {
      cancelQueued('yanlış kişi'); stage('yanlış kişi');
      const ref = r.referral || {};
      if (ref.email && /@/.test(ref.email)) {
        const ex = get('SELECT id FROM contacts WHERE lower(email)=?', ref.email.toLowerCase());
        const id = ex?.id || Number(run("INSERT INTO contacts(name,title,company,domain,email,status,source,owner_id) VALUES(?,?,?,?,?,'mail var','yönlendirme',1)",
          ref.name || ref.email, ref.title || '', c.company || '', c.domain || '', ref.email.toLowerCase()).lastInsertRowid);
        if (camp) { const co = get('SELECT company_id FROM leads WHERE campaign_id=? AND contact_id=?', camp, rep.contact_id); run('INSERT OR IGNORE INTO leads(campaign_id,contact_id,company_id,stage) VALUES(?,?,?,?)', camp, id, co?.company_id || null, 'mail var'); }
        note = `önerilen kişi eklendi: ${ref.name || ''} <${ref.email}>`;
      } else if (ref.name) {
        require('./worker').enqueue('manual_find', { name: ref.name, company: c.company || '', linkedin: '' }, camp, 1);
        note = `önerilen kişi aranıyor: ${ref.name}`;
      }
      break;
    }
    default: // ilgileniyor / soru → sıra durur, cevap bekler
      cancelQueued('yanıt geldi'); stage('yanıtladı');
  }
  run('UPDATE replies SET label=?, summary=?, draft=?, return_date=? WHERE id=?', r.label, (r.summary || '') + (note ? ` · ${note}` : ''), r.draft || '', r.return_date || null, rep.id);
  event('reply', `${EMO[r.label] || '💬'} ${r.label.toUpperCase()}: ${c.name || rep.from_name} (${c.company || ''})\n${r.summary || ''}${note ? '\n→ ' + note : ''}${r.draft ? '\n✍️ Taslak cevap hazır (Yanıtlar sayfası)' : ''}`, camp);
}

async function classify(id) {
  const rep = get('SELECT * FROM replies WHERE id=?', id); if (!rep) return;
  const c = get('SELECT * FROM contacts WHERE id=?', rep.contact_id);
  const sent = rep.outbox_id && get('SELECT subject FROM outbox WHERE id=?', rep.outbox_id);
  let r;
  try { r = await ai.classifyReply({ text: rep.text, subject: rep.subject, contact: c, sent }); }
  catch (e) { r = { label: 'soru', summary: 'AI sınıflandıramadı: ' + e.message.slice(0, 80), draft: '' }; }
  await applyLabel(rep, r);
}

let busy = false;
async function checkSender(s) {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: s.email, pass: s.pass }, logger: false });
  const fresh = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const last = +s.imap_last_uid || 0;
      const uids = (await client.search({ since: new Date(Date.now() - 14 * 864e5) }, { uid: true })) || [];
      const todo = uids.filter(u => u > last);
      let max = last; const bounces = [], matched = [];
      if (todo.length) for await (const m of client.fetch(todo.join(','), { envelope: true, uid: true }, { uid: true })) {
        max = Math.max(max, m.uid);
        const from = (m.envelope?.from?.[0]?.address || '').toLowerCase();
        if (!from || from === s.email.toLowerCase()) continue;
        if (/mailer-daemon|postmaster|mail delivery/i.test(from + ' ' + (m.envelope?.from?.[0]?.name || ''))) { bounces.push(m.uid); continue; }
        const o = get("SELECT o.*, c.name, c.company FROM outbox o JOIN contacts c ON c.id=o.contact_id WHERE lower(o.to_email)=? AND o.status='gönderildi' ORDER BY o.id DESC LIMIT 1", from);
        if (o) matched.push({ uid: m.uid, o, env: m.envelope });
      }
      if (matched.length) for await (const m of client.fetch(matched.map(x => x.uid).join(','), { source: true, uid: true }, { uid: true })) {
        const x = matched.find(y => y.uid === m.uid); if (!x) continue;
        let text = '';
        try { const p = await simpleParser(m.source); text = stripQuoted(p.text || (p.html || '').replace(/<[^>]+>/g, ' ')); } catch {}
        const r = run(`INSERT OR IGNORE INTO replies(sender_id,contact_id,outbox_id,campaign_id,from_email,from_name,subject,text,message_id,received_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          s.id, x.o.contact_id, x.o.id, x.o.campaign_id, (x.env.from[0].address || '').toLowerCase(), x.env.from[0].name || '', x.env.subject || '', text.slice(0, 8000),
          x.env.messageId || 'uid-' + m.uid, (x.env.date ? new Date(x.env.date) : new Date()).toISOString());
        if (r.changes) fresh.push(Number(r.lastInsertRowid));
      }
      if (bounces.length) {
        const recent = all("SELECT o.*, c.name, c.company FROM outbox o JOIN contacts c ON c.id=o.contact_id WHERE o.status='gönderildi' AND o.sender_id=? AND o.sent_at>=?", s.id, new Date(Date.now() - 14 * 864e5).toISOString());
        for await (const m of client.fetch(bounces.join(','), { source: true, uid: true }, { uid: true })) {
          const t = String(m.source || '').toLowerCase();
          for (const o of recent) if (t.includes(o.to_email.toLowerCase())) markBounce(o);
        }
      }
      run('UPDATE senders SET imap_last_uid=? WHERE id=?', max || (uids.length ? Math.max(...uids) : 0), s.id);
    } finally { lock.release(); }
    await client.logout();
  } catch (e) { console.error('imap', s.email, e.message); try { await client.logout(); } catch {} }
  for (const id of fresh) await classify(id);
  return fresh.length;
}

async function checkReplies() {
  if (busy) return 0; busy = true;
  let n = 0;
  try {
    if (!get("SELECT 1 FROM outbox WHERE status='gönderildi'")) return 0;
    for (const s of mailer.senders()) n += await checkSender(s);
  } finally { busy = false; }
  return n;
}

// Yanıta cevap: kuyruğu beklemeden, aynı hesaptan, aynı zincirde
async function sendReply(id, text, userId) {
  const rep = get('SELECT * FROM replies WHERE id=?', id);
  if (!rep) throw Object.assign(new Error('Yanıt bulunamadı'), { status: 404 });
  if (!String(text || '').trim()) throw Object.assign(new Error('Cevap metni boş'), { status: 400 });
  const subject = /^re:/i.test(rep.subject || '') ? rep.subject : 'Re: ' + (rep.subject || '');
  const oid = Number(run("INSERT INTO outbox(campaign_id,contact_id,step,to_email,subject,body,status,user_id,sender_id,reply_to_id) VALUES(?,?,100,?,?,?,'sırada',?,?,?)",
    rep.campaign_id, rep.contact_id, rep.from_email, subject, text, userId, rep.sender_id, rep.id).lastInsertRowid);
  const s = get('SELECT * FROM senders WHERE id=?', rep.sender_id) || mailer.senders()[0];
  const o = get(`SELECT o.*, c.name, c.company, c.title, c.location, c.industry, c.linkedin, c.domain, c.emails, c.email_check, c.opener AS c_opener FROM outbox o JOIN contacts c ON c.id=o.contact_id WHERE o.id=?`, oid);
  await mailer.deliver({ ...o, force: true }, s);
  const done = get('SELECT status, error FROM outbox WHERE id=?', oid);
  if (done.status !== 'gönderildi') throw Object.assign(new Error(done.error || 'Gönderilemedi'), { status: 400 });
  run("UPDATE replies SET status='cevaplandı' WHERE id=?", id);
  return { ok: true };
}

function start() { setInterval(checkReplies, 5 * 60e3); setTimeout(checkReplies, 40e3); }

module.exports = { start, checkReplies, classify, applyLabel, sendReply, stripQuoted };
