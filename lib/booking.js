// Online randevu: her kişiye imzalı kişisel link (lead.hypevisionlab.com/r/<token>). Kişi boş saatlerden birini seçer →
// toplantı kaydı, kişinin aşaması "toplantı" olur (takipler durur), kişiye + CC'ye takvim daveti (.ics) gider, Telegram'a haber düşer.
// Ekip takvimi: /cal/<gizli>.ics adresi Google Takvim'e "URL ile ekle" yapılınca tüm toplantılar otomatik görünür.
const crypto = require('crypto');
const { db, all, get, run, setting, setSetting, jsonSetting } = require('./db');
const { event } = require('./notify');

db.exec(`CREATE TABLE IF NOT EXISTS meetings(id INTEGER PRIMARY KEY, contact_id INTEGER, campaign_id INTEGER, start TEXT, end TEXT, name TEXT, company TEXT, email TEXT, phone TEXT,
  title TEXT, note TEXT, mode TEXT DEFAULT 'online', status TEXT DEFAULT 'planlandı', uid TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP)`);

const DEF = { days: [1, 2, 3, 4, 5], start: '10:00', end: '17:00', dur: 30, horizon: 10, lead_hours: 18, meet_link: '', followups: true, first: false,
  title: 'Hype Vision · tanışma görüşmesi', host: 'Hype Vision' };
const cfg = () => ({ ...DEF, ...jsonSetting('booking_cfg', {}) });
const secret = () => { let s = setting('booking_secret'); if (!s) { s = crypto.randomBytes(18).toString('hex'); setSetting('booking_secret', s); } return s; };
const base = () => (setting('public_url') || 'https://lead.hypevisionlab.com').replace(/\/$/, '');
const sig = s => crypto.createHmac('sha256', secret()).update(String(s)).digest('base64url').slice(0, 10);
const token = contactId => contactId ? `${Number(contactId).toString(36)}-${sig('c' + contactId)}` : 'genel';
const link = contactId => `${base()}/r/${token(contactId)}`;
function parse(t) {
  if (t === 'genel') return { general: true };
  const [a, s] = String(t || '').split('-'); const id = parseInt(a, 36);
  return id && s === sig('c' + id) ? { contactId: id } : null;
}
const calUrl = () => `${base()}/cal/${sig('calendar')}${secret().slice(0, 6)}.ics`;
const calOk = k => k === `${sig('calendar')}${secret().slice(0, 6)}`;

// TR saati (UTC+3, yaz saati yok)
const TR = 3 * 3600e3;
function slots() {
  const c = cfg(), out = [], busy = new Set(all("SELECT start FROM meetings WHERE status<>'iptal' AND start>=?", new Date().toISOString()).map(m => m.start));
  const [sh, sm] = c.start.split(':').map(Number), [eh, em] = c.end.split(':').map(Number);
  const now = Date.now(), min = now + c.lead_hours * 3600e3;
  for (let d = 0; d < 21 && out.length < 400; d++) {
    const day = new Date(now + TR + d * 864e5); day.setUTCHours(0, 0, 0, 0);
    const wd = day.getUTCDay() || 7; if (!c.days.includes(wd)) continue;
    if (out.filter(x => x.day).length >= c.horizon) break;
    const list = [];
    for (let m = sh * 60 + sm; m + c.dur <= eh * 60 + em; m += c.dur) {
      if (m >= 12 * 60 + 30 && m < 13 * 60 + 30) continue; // öğle arası
      const t = day.getTime() + m * 60e3 - TR, iso = new Date(t).toISOString();
      if (t < min || busy.has(iso)) continue;
      list.push(iso);
    }
    if (list.length) out.push({ day: new Date(day.getTime()).toISOString().slice(0, 10), slots: list });
  }
  return out;
}

const icsDate = iso => iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
function vevent(m, org) {
  const c = cfg();
  return ['BEGIN:VEVENT', `UID:${m.uid}`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `DTSTART:${icsDate(m.start)}`, `DTEND:${icsDate(m.end)}`,
    `SUMMARY:${icsEsc(m.title + ' — ' + (m.company || m.name))}`, `DESCRIPTION:${icsEsc(`${m.name} · ${m.company}\n${m.email}${m.phone ? ' · ' + m.phone : ''}${m.note ? '\nNot: ' + m.note : ''}${c.meet_link ? '\nBağlantı: ' + c.meet_link : ''}`)}`,
    `LOCATION:${icsEsc(c.meet_link || 'Online')}`, org ? `ORGANIZER;CN=${icsEsc(c.host)}:mailto:${org}` : '', m.email ? `ATTENDEE;CN=${icsEsc(m.name)};RSVP=TRUE:mailto:${m.email}` : '',
    `STATUS:${m.status === 'iptal' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT'].filter(Boolean).join('\r\n');
}
const ics = (events, method = 'REQUEST') => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hype Vision//Lead-AI//TR', 'CALSCALE:GREGORIAN', `METHOD:${method}`, 'X-WR-CALNAME:Lead-AI toplantılar', ...events, 'END:VCALENDAR'].join('\r\n');
const feed = () => ics(all("SELECT * FROM meetings WHERE start>=datetime('now','-60 day') ORDER BY start").map(m => vevent(m, null)), 'PUBLISH');

const fmtTR = iso => new Date(Date.parse(iso) + TR).toISOString().replace('T', ' ').slice(0, 16);
const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const human = iso => { const d = new Date(Date.parse(iso) + TR); return `${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()} ${days[d.getUTCDay()]} ${fmtTR(iso).slice(11)}`; };

function info(tok) {
  const p = parse(tok); if (!p) return null;
  const c = p.contactId ? get('SELECT id,name,company,email,title FROM contacts WHERE id=?', p.contactId) : null;
  if (p.contactId && !c) return null;
  const existing = c && get("SELECT start FROM meetings WHERE contact_id=? AND status<>'iptal' AND start>=? ORDER BY start LIMIT 1", c.id, new Date().toISOString());
  const k = cfg();
  return { general: !!p.general, name: c?.name || '', company: c?.company || '', email: c?.email || '', title: k.title, dur: k.dur, existing: existing ? human(existing.start) : null, days: slots() };
}

async function book(tok, b) {
  const p = parse(tok); if (!p) throw Object.assign(new Error('Geçersiz bağlantı'), { status: 404 });
  const k = cfg(), start = new Date(String(b.start || '')).toISOString();
  if (!slots().some(d => d.slots.includes(start))) throw Object.assign(new Error('Bu saat artık uygun değil, lütfen başka bir saat seçin'), { status: 409 });
  const c = p.contactId ? get('SELECT * FROM contacts WHERE id=?', p.contactId) : null;
  const name = String(c?.name || b.name || '').trim().slice(0, 120), email = String(b.email || c?.email || '').trim().toLowerCase().slice(0, 160);
  const company = String(c?.company || b.company || '').trim().slice(0, 160);
  if (!name || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) || !company) throw Object.assign(new Error('Ad, firma ve e-posta gerekli'), { status: 400 });
  const lead = c && get("SELECT campaign_id FROM leads WHERE contact_id=? ORDER BY id DESC LIMIT 1", c.id);
  const m = { contact_id: c?.id || null, campaign_id: lead?.campaign_id || null, start, end: new Date(Date.parse(start) + k.dur * 60e3).toISOString(), name, company, email,
    phone: String(b.phone || '').slice(0, 40), note: String(b.note || '').slice(0, 600), title: k.title, mode: 'online', status: 'planlandı', uid: crypto.randomUUID() + '@lead-ai' };
  m.id = Number(run('INSERT INTO meetings(contact_id,campaign_id,start,end,name,company,email,phone,title,note,mode,status,uid) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    m.contact_id, m.campaign_id, m.start, m.end, m.name, m.company, m.email, m.phone, m.title, m.note, m.mode, m.status, m.uid).lastInsertRowid);
  if (c) {
    run("UPDATE leads SET stage='toplantı' WHERE contact_id=?", c.id); run("UPDATE contacts SET status='toplantı' WHERE id=?", c.id);
    run("UPDATE outbox SET status='iptal', error='toplantı alındı' WHERE contact_id=? AND status IN ('sırada','taslak') AND step<100", c.id);
  }
  event('reply', `📅 TOPLANTI ALINDI: ${name} (${company}) — ${human(start)} · ${email}${m.phone ? ' · ' + m.phone : ''}${m.note ? '\nNot: ' + m.note : ''}`, m.campaign_id);
  invite(m).catch(e => console.error('davet', e.message));
  return { ok: true, when: human(start), meet: k.meet_link || '' };
}

// Daveti, kişiye daha önce yazan kutudan (yoksa ilk aktif kutudan) gönder; CC listesi de davetli
async function invite(m, cancel = false) {
  const mailer = require('./mailer'), k = cfg();
  const prev = m.contact_id && get("SELECT sender_id FROM outbox WHERE contact_id=? AND status='gönderildi' AND sender_id IS NOT NULL ORDER BY id DESC LIMIT 1", m.contact_id);
  const s = (prev && get('SELECT * FROM senders WHERE id=? AND active=1', prev.sender_id)) || mailer.senders()[0]; if (!s) return;
  const { t, from } = mailer.transportFor(s);
  const cc = String(setting('always_cc') || '').split(/[,;\s]+/).filter(x => x.includes('@') && x.toLowerCase() !== m.email);
  const body = cancel ? `Merhaba ${m.name.split(' ')[0]},\n\n${human(m.start)} tarihli görüşmemiz iptal edilmiştir.\n\n${s.name || k.host}`
    : `Merhaba ${m.name.split(' ')[0]},\n\nGörüşme talebiniz için teşekkürler. ${human(m.start)} (Türkiye saati, ${k.dur} dk) için takvim davetini ekte bulabilirsiniz.${k.meet_link ? `\n\nBağlantı: ${k.meet_link}` : '\n\nGörüşme bağlantısını kısa süre içinde ayrıca ileteceğiz.'}\n\nGörüşmede mevcut kameralarınızla neler yapılabileceğini kısaca göstereceğiz.\n\n${s.name || k.host}`;
  await t.sendMail({ from, to: m.email, cc: cc.length ? cc : undefined, subject: `${cancel ? 'İptal: ' : ''}${m.title} — ${human(m.start)}`, text: body,
    icalEvent: { method: cancel ? 'CANCEL' : 'REQUEST', filename: 'davet.ics', content: ics([vevent({ ...m, status: cancel ? 'iptal' : m.status }, s.email)], cancel ? 'CANCEL' : 'REQUEST') } });
}
async function cancel(id) {
  const m = get('SELECT * FROM meetings WHERE id=?', id); if (!m) return;
  run("UPDATE meetings SET status='iptal' WHERE id=?", id);
  await invite(m, true).catch(e => console.error('iptal daveti', e.message));
}

module.exports = { cfg, DEF, token, link, parse, slots, info, book, cancel, feed, calUrl, calOk, human };
