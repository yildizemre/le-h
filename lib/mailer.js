// Mail gönderimi: çoklu gönderen hesap, zamanlı kuyruk (gün/saat penceresi, hesap başı günlük limit + ısınma,
// rastgele bekleme, firma başı limit), kişiye özel ilk cümle, göndermeden adres doğrulama, takip mailleri.
// Gelen kutusu / yanıt işleme lib/inbox.js'de.
const nodemailer = require('nodemailer');
const { all, get, run, setting, setSetting, jsonSetting } = require('./db');
const { event } = require('./notify');
const ai = require('./ai');
const verify = require('./verify');

// safe_mode: sadece doğrulanmış adres · plain_first: ilk mailde resimsiz/linksiz imza · optout: ilk maile çıkış cümlesi
const SCHED_DEF = { days: [1, 2, 3, 4, 5], start: 9, end: 18, daily: 40, min_delay: 120, max_delay: 300, warmup: true, per_domain: 1, safe_mode: true, plain_first: true, optout: true, spread: true };

// İnsan gibi gönderim: hesabın bugünkü kalan hakkı, gönderim penceresinin kalanına düzensiz aralıklarla yayılır
// (10 mail/gün → ~50 dk'da bir, ±%40 sapma). Kapalıysa eski min/max bekleme kullanılır.
function spreadDelay(s, sc = schedule()) {
  const base = (sc.min_delay + Math.random() * Math.max(0, sc.max_delay - sc.min_delay)) * 1000;
  if (sc.spread === false) return base;
  // Yurt dışı modunda alıcılar farklı saat dilimlerinde: kotayı ~16 saatlik kayan pencereye yay (Avrupa sabahı → ABD akşamüstü)
  const n = nowTR(), end = intlOnly() ? Date.now() + 16 * 3600e3 : new Date(n.date + 'T' + String(sc.end).padStart(2, '0') + ':00:00+03:00').getTime();
  const left = Math.max(1, senderDaily(s, sc) - sentToday(s.id));
  const gap = Math.max(0, end - Date.now()) / (left + 0.5);
  return Math.max(base, gap * (0.6 + Math.random() * 0.8));
}
const OPTOUT = { tr: 'Bu konu sizin için uygun değilse kısaca yazmanız yeterli, tekrar rahatsız etmem.', en: "If this isn't relevant for you, just let me know and I won't follow up." };
// HTML imzadan düz metin imza (resim ve link yok): ilk mailde spam puanını düşürür
const plainSig = h => String(h || '').replace(/<img[^>]*>/gi, '').replace(/<br\s*\/?>|<\/(div|p|tr)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').split('\n').map(l => l.trim()).filter(Boolean).join('<br>');
const schedule = () => jsonSetting('schedule', SCHED_DEF);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fill(tpl, c, me = {}) {
  const parts = String(c.name || '').trim().split(/\s+/);
  const v = { ad: parts[0] || '', soyad: parts.slice(1).join(' '), adsoyad: c.name || '', sirket: c.company || '', unvan: c.title || '', gonderen: me.name || '', kisisel: c.opener || '', randevu: c.contact_id ? require('./booking').link(c.contact_id) : '' };
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => v[k] ?? m).replace(/\n{3,}/g, '\n\n');
}
const html = (body, signature) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#222">${esc(body).replace(/https:\/\/[^\s<]+/g, u => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>')}${signature ? '<br><br>' + signature : ''}</div>`;

// Kişisel cümleyi selamlamadan sonraki ilk paragraf olarak yerleştir ({{kisisel}} varsa oraya)
function withOpener(body, opener) {
  if (!opener) return String(body || '').replace(/\{\{\s*kisisel\s*\}\}\n*/g, '');
  if (/\{\{\s*kisisel\s*\}\}/.test(body)) return body;
  const parts = String(body).split(/\n\s*\n/);
  if (parts.length > 1 && parts[0].length < 80 && /[,!:]\s*$/.test(parts[0].trim())) return [parts[0], '{{kisisel}}', ...parts.slice(1)].join('\n\n');
  return '{{kisisel}}\n\n' + body;
}

const ccList = () => String(setting('always_cc') || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s));

// ---------------- Gönderen hesaplar ----------------
function migrateSenders() {
  if (!get('SELECT 1 FROM senders') && setting('gmail_user') && setting('gmail_pass')) {
    run('INSERT OR IGNORE INTO senders(email,pass,name,daily,imap_last_uid) VALUES(?,?,?,?,?)', setting('gmail_user').toLowerCase(), setting('gmail_pass'),
      setting('from_name') || '', schedule().daily || 40, +setting('imap_last_uid') || 0);
    const s = get('SELECT id FROM senders LIMIT 1');
    if (s) run('UPDATE outbox SET sender_id=? WHERE sender_id IS NULL', s.id);
  }
}
// Sağlayıcı ayarları: Gmail, Zoho (com/eu), Outlook (Microsoft 365) ya da özel SMTP/IMAP. Kutunun sağlayıcısı MX kaydından otomatik bulunur.
for (const c of ["provider TEXT DEFAULT 'gmail'", "smtp_host TEXT DEFAULT ''", 'smtp_port INTEGER DEFAULT 0', "imap_host TEXT DEFAULT ''"]) { try { require('./db').db.exec('ALTER TABLE senders ADD COLUMN ' + c); } catch {} }
const PROVIDERS = {
  gmail: { label: 'Gmail / Google Workspace', smtp: 'smtp.gmail.com', port: 465, imap: 'imap.gmail.com' },
  zoho: { label: 'Zoho Mail', smtp: 'smtppro.zoho.com', port: 465, imap: 'imappro.zoho.com' },
  zoho_eu: { label: 'Zoho Mail (EU)', smtp: 'smtppro.zoho.eu', port: 465, imap: 'imappro.zoho.eu' },
  outlook: { label: 'Outlook / Microsoft 365', smtp: 'smtp.office365.com', port: 587, imap: 'outlook.office365.com' },
  purelymail: { label: 'Purelymail', smtp: 'smtp.purelymail.com', port: 465, imap: 'imap.purelymail.com' },
  custom: { label: 'Özel sunucu', smtp: '', port: 465, imap: '' },
};
function serverOf(s) {
  const p = PROVIDERS[s.provider] || PROVIDERS.gmail;
  const smtp = s.smtp_host || p.smtp, port = +s.smtp_port || p.port, imap = s.imap_host || p.imap || smtp.replace(/^smtp(pro)?\./, 'imap$1.');
  return { smtp, port, secure: port === 465, imap };
}
async function detectProvider(email) {
  const dom = String(email).split('@')[1] || '';
  if (/^(gmail|googlemail)\.com$/.test(dom)) return 'gmail';
  if (/^(outlook|hotmail|live)\.com$/.test(dom)) return 'outlook';
  try {
    const mx = (await require('dns').promises.resolveMx(dom)).map(m => m.exchange.toLowerCase()).join(' ');
    if (/google|googlemail/.test(mx)) return 'gmail';
    if (/zoho\.eu/.test(mx)) return 'zoho_eu';
    if (/zoho/.test(mx)) return 'zoho';
    if (/outlook|protection\.outlook/.test(mx)) return 'outlook';
    if (/purelymail/.test(mx)) return 'purelymail';
  } catch {}
  return 'custom';
}
const imapOf = s => ({ host: serverOf(s).imap, port: 993, secure: true, auth: { user: s.email, pass: s.pass }, logger: false });
const senders = (activeOnly = true) => all(`SELECT * FROM senders ${activeOnly ? 'WHERE active=1' : ''} ORDER BY id`);
const tcache = new Map();
function transportFor(s) {
  if (!s) throw Object.assign(new Error('Entegrasyonlar → en az bir gönderen Gmail hesabı ekle'), { status: 400 });
  const key = s.id + ':' + s.pass + ':' + (s.provider || '') + (s.smtp_host || '');
  const sv = serverOf(s);
  if (!sv.smtp) throw Object.assign(new Error('Özel sunucu için SMTP adresi girilmemiş'), { status: 400 });
  if (!tcache.has(key)) tcache.set(key, nodemailer.createTransport({ host: sv.smtp, port: sv.port, secure: sv.secure, requireTLS: !sv.secure, auth: { user: s.email, pass: s.pass }, pool: false, connectionTimeout: 30e3, greetingTimeout: 20e3, socketTimeout: 60e3 }));
  const name = s.name || setting('from_name') || ai.project().sender_name;
  return { t: tcache.get(key), from: name ? `"${name.replace(/"/g, '')}" <${s.email}>` : s.email, user: s.email };
}
const transport = () => transportFor(senders()[0]); // geriye uyumluluk

const friendly = e => /535|Username and Password|Invalid login|authentication failed|AUTHENTICATIONFAILED/i.test(e.message)
  ? new Error('Giriş reddedildi: normal şifre değil UYGULAMA ŞİFRESİ gerekir (Gmail: 16 haneli; Zoho: Hesabım → Güvenlik → Uygulamaya özel şifreler). Zoho’da ayrıca Ayarlar → Mail hesapları → IMAP erişimi açık olmalı.')
  : /ENOTFOUND|ETIMEDOUT|ECONNREFUSED/.test(e.message) ? new Error('Gmail sunucusuna bağlanılamadı: ' + e.message) : e;
// Gönderen kutunun imzası: kutuya özel imza yoksa ekip imza şablonundan o kişinin adı + maili ile üretilir
// (başkasının adı / unvanı / telefonu asla gitmez)
const escA = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function sigFor(s) {
  if (s?.signature) return s.signature;
  const name = s?.name || String(s?.email || '').split('@')[0], email = s?.email || '';
  const tpl = (get("SELECT signature FROM users WHERE role='admin' AND signature<>'' ORDER BY id LIMIT 1") || {}).signature || '';
  const addr = (tpl.match(/<div style="color:#6b7280[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
  const logo = (tpl.match(/<img [^>]*>/) || [])[0] || '<img src="https://hypevisionlab.com/hypevisionlogo.png" alt="Hype Vision" width="150" style="display:block;border:0;width:150px;height:auto">';
  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:13px;line-height:1.5"><tr>
    <td style="padding-right:16px;border-right:3px solid #12c2d9;vertical-align:middle"><a href="https://hypevisionlab.com" target="_blank">${logo}</a></td>
    <td style="padding-left:16px;vertical-align:middle">
      <div style="font-size:16px;font-weight:bold;color:#0f2a5c">${escA(name)}</div>
      <div style="color:#12a3b8;font-weight:bold;margin-bottom:6px">Hype Vision</div>
      <div><a href="mailto:${escA(email)}" style="color:#1f2937;text-decoration:none">${escA(email)}</a></div>
      <div><a href="https://hypevisionlab.com" target="_blank" style="color:#0f2a5c;text-decoration:none;font-weight:bold">hypevisionlab.com</a></div>
      ${addr ? `<div style="color:#6b7280;font-size:12px;margin-top:4px">${addr}</div>` : ''}
    </td></tr></table>`;
}
async function testSender(s, to, signature) {
  const tp = transportFor(s);
  try { await tp.t.verify(); } catch (e) { throw Object.assign(friendly(e), { status: 400 }); }
  const info = await tp.t.sendMail({ from: tp.from, to: to || s.email, subject: 'Lead-AI gönderim testi ✔', html: html(`Bu bir test mailidir. ${s.email} hesabından gönderim çalışıyor.\n\nLead-AI`, s.signature || signature) });
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
  // Ban kalkanı: ısınma kuralı (ilk 7 gün 0, 8-14. gün 5) × sağlık skoru × Postmaster itibarı
  const warm = require('./warmup').coldCap(s), f = require('./health').capFactor(s);
  // Ana alan adı (hypevisionlab.com) korunur: soğuk mail kutu başı en fazla main_cap (varsayılan 8)
  const ap = require('./autopilot').cfg(), main = String(s.email).toLowerCase().endsWith('@' + (ap.main_domain || 'hypevisionlab.com'));
  return Math.floor(Math.min(cap, 10 + days * 3, bounceCap(s, cap), warm, main ? (ap.main_cap || 8) : Infinity) * f);
}
// Geri dönüş freni: hesabın son 50 gönderiminde geri dönüş %3'ü geçerse limit yarıya, %5'i geçerse 0
function bounceCap(s, cap) {
  const r = get("SELECT count(*) n, sum(status='geri döndü') b FROM (SELECT status FROM outbox WHERE sender_id=? AND status IN ('gönderildi','geri döndü') AND step<100 ORDER BY id DESC LIMIT 50)", s.id);
  if (!r || r.n < 10) return cap;
  if ((r.b || 0) < 2) return cap; // tek geri dönüş kutuyu durdurmasın
  const rate = r.b / (r.n + 25); // küçük örneklemde yumuşatılmış oran
  return rate > 0.05 ? 0 : rate > 0.03 ? Math.max(3, Math.floor(cap / 2)) : cap;
}
const effectiveDaily = () => senders().reduce((a, s) => a + senderDaily(s), 0);
const FREE = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'yandex.com', 'live.com'];
const domainSentToday = d => get("SELECT count(*) n FROM outbox WHERE status='gönderildi' AND sent_at>=? AND lower(to_email) LIKE ?", dayStart(), '%@' + d).n;

const nextAt = {}; // gönderen başına bir sonraki gönderim zamanı
function windowState(sc = schedule()) {
  const n = nowTR();
  if (!senders().length) return 'Gönderen Gmail hesabı yok';
  if (setting('sending_paused') === '1') return 'Gönderim duraklatıldı';
  if (intlOnly()) return ''; // gün/saat kontrolü her alıcı için kendi yerel saatine göre tick() içinde yapılır
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
  // Otopilotta hariç tutulan kutulardan (Emre, Osman) soğuk mail / takip gitmez; onlar sadece yanıt (step>=100) için kullanılır
  const ex = o.step < 100 ? (require('./autopilot').cfg().exclude || []).map(x => String(x).toLowerCase()) : [];
  const sc = schedule(), list = senders().filter(s => !ex.includes(s.email.toLowerCase()));
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
// Yurt dışı modu (varsayılan açık; settings.intl_only='0' ile kapanır): Türkiye'deki kişi/firmalara soğuk mail gitmez
const TR_HINT = /t[uü]rkiye|turkey|istanbul|ankara|izmir|bursa|kocaeli|gebze|sakarya|tekirda[gğ]|manisa|konya|kayseri|gaziantep|denizli|trabzon|eski[sş]ehir|adana|mersin|antalya|izmit|[çc]orlu|[çc]erkezk[öo]y|[üu]mraniye|dilovas[ıi]|[çc]ayırova|\bosb\b|,\s*tr\s*$/i;
const intlOnly = () => setting('intl_only') !== '0';
function isTR(c) {
  const email = String(c.email || c.to_email || '').toLowerCase(), dom = String(c.domain || c.co_domain || '').toLowerCase();
  if (/\.tr$/.test(email) || /\.tr$/.test(dom)) return true;
  const camp = c.campaign_id ? get('SELECT location, geography FROM campaigns WHERE id=?', c.campaign_id) : null;
  return [c.location, c.camp_location, c.camp_geo, camp?.location, camp?.geography].some(x => x && TR_HINT.test(String(x).toLocaleLowerCase('tr')));
}
// Hedef orta ölçekli üreticiler: kamu/ordu/üniversite alan adları ve küresel dev markalar elenir
const BIG_DOMAIN = /\.(gov|mil|edu)(\.[a-z]{2})?$|\.gc\.ca$|(^|\.)(apple|tesla|nasa|spacex|google|microsoft|amazon|meta|samsung|siemens|bosch|toyota|volkswagen|vw|bmw|mercedes-benz|stellantis|ford|gm|honda|basf|bayer|nestle|unilever|pg|ge|boeing|airbus|lockheedmartin|3m|abb|philips|sony|lg|intel|ibm|dell|hp|huawei|foxconn|exxonmobil|shell|bp)\.[a-z.]+$/i;
// Alan adı yoksa şirket adından (RocketReach bazen işveren alan adı vermiyor)
const BIG_NAME = /\b(apple|tesla|nasa|spacex|google|microsoft|amazon|samsung|siemens|bosch|toyota|volkswagen|bmw|mercedes-benz|daimler|stellantis|ford motor|general motors|honda|basf|bayer|nestl[eé]|unilever|procter|boeing|airbus|lockheed|3m|abb|philips|sony|intel|ibm|huawei|foxconn|exxon|shell|ikea|skoda|škoda|renault|nissan|hyundai|kia|audi|porsche|volvo|scania|continental ag|michelin|bridgestone|goodyear)\b/i;
const isBig = c => BIG_NAME.test(String(c.company || "")) || BIG_DOMAIN.test(String(c.email || c.to_email || '').toLowerCase().split('@')[1] || '') || BIG_DOMAIN.test(String(c.domain || '').toLowerCase().replace(/^www\./, ''));
function cancelSuppressed() {
  for (const o of all("SELECT o.id, o.to_email, c.* FROM outbox o JOIN contacts c ON c.id=o.contact_id WHERE o.status IN ('sırada','taslak')"))
    if (suppressed({ ...o, email: o.to_email })) run("UPDATE outbox SET status='iptal', error='engel listesi' WHERE id=?", o.id);
}

// Alıcının yerel saatinde gönderim penceresi (schedule.days/start/end yerel saat olarak yorumlanır)
const tz = require('./tz');
function localOk(o, sc = schedule()) {
  const camp = o.campaign_id ? get('SELECT location, geography FROM campaigns WHERE id=?', o.campaign_id) : null;
  const l = tz.localNow(tz.tzFor(o, camp) || 'Europe/Berlin');
  return sc.days.includes(l.day) && l.hour >= sc.start && l.hour < sc.end;
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
      if (intlOnly() && o.step < 100 && !localOk(o, sc)) continue; // alıcının yerel mesai saati değil, sonraki tura kalsın
      const s = pickSender(o); if (!s) continue;
      const r = await deliver(o, s);
      if (r === 'skip') continue; // doğrulamada elendi, sıradakine geç (bekleme yok)
      nextAt[s.id] = Date.now() + spreadDelay(s, sc);
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


// Rakip / yazılım firması: görüntü işleme, yapay zeka, makine görüşü, video analitiği, yazılım/bilişim firmalarına HİÇBİR soğuk mail gitmez
const COMPETITOR = /g[oö]r[uü]nt[uü] i[sş]leme|computer vision|machine vision|makine g[oö]r[uü]|yapay zek[aâ]|artificial intelligence|(^|[^a-z])ai([^a-z]|$)|video anali|g[oö]r[uü]nt[uü] anali|yaz[iı]l[iı]m|software|(^|[^a-z])saas([^a-z]|$)|bili[sş]im|bilgi teknoloji|information technolog|(^|[^a-z])it (hizmet|services|solutions)/i;
const COMPETITOR_DOMAIN = /vision|soft|yazilim|bilisim|(^|[.-])ai[.-]|-ai\.|analytics|\.ai$|\.io$/i;
function isCompetitor(contactId, email) {
  const c = contactId ? get('SELECT name, title, company, domain, industry FROM contacts WHERE id=?', contactId) || {} : {};
  const dom = String(c.domain || String(email || '').split('@')[1] || '').toLowerCase();
  const co = contactId ? get(`SELECT co.name, co.sector, co.reason FROM leads l JOIN companies co ON co.id=l.company_id WHERE l.contact_id=? LIMIT 1`, contactId) || {} : {};
  return COMPETITOR.test([c.company, c.industry, co.name, co.sector, co.reason].join(' | ').toLocaleLowerCase('tr')) || COMPETITOR_DOMAIN.test(dom);
}
const STOP_STAGES = ['toplantı', 'yanıtladı', 'ilgisiz', 'yanlış kişi', 'sonra yaz'];
async function deliver(o, sender) {
  if (suppressed({ ...o, email: o.to_email })) { run("UPDATE outbox SET status='iptal', error='engel listesi' WHERE id=?", o.id); return 'skip'; }
  if (o.step < 100 && !o.force && intlOnly() && isTR(o)) { run("UPDATE outbox SET status='iptal', error=? WHERE id=?", 'Türkiye — yurt dışı modu', o.id); return 'skip'; }
  if (o.step < 100 && !o.force && isBig(o)) { run("UPDATE outbox SET status='iptal', error=? WHERE id=?", 'dev şirket / kamu — hedef değil', o.id); return 'skip'; }
  const lead = o.campaign_id && get('SELECT stage FROM leads WHERE campaign_id=? AND contact_id=?', o.campaign_id, o.contact_id);
  if (o.step < 100 && !o.force && isCompetitor(o.contact_id, o.to_email)) { run("UPDATE outbox SET status='iptal', error=? WHERE id=?", 'rakip/yazılım firması — gönderilmez', o.id); return 'skip'; }
  if (STOP_STAGES.includes(lead?.stage) && !o.force && o.step < 100) { run("UPDATE outbox SET status='iptal', error=? WHERE id=?", 'kişi ' + lead.stage, o.id); return 'skip'; }
  const camp = o.campaign_id ? get('SELECT * FROM campaigns WHERE id=?', o.campaign_id) : null;
  if (camp && camp.status !== 'aktif' && !o.force) return 'skip';

  // 3) Göndermeden adres doğrulama (sadece ilk mail; takipler zaten ulaşmış adrese gider)
  if (o.step === 0) {
    const v = await verify.checkContact({ id: o.contact_id, email: o.to_email, emails: o.emails, email_check: o.email_check });
    if (v.status !== 'geçersiz' && schedule().safe_mode && !v.verified && !o.force) {
      run("UPDATE outbox SET status='iptal', error=? WHERE id=?", 'güvenli mod: adres doğrulanmamış (' + v.reason + ')', o.id);
      return 'skip';
    }
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

  // Takipler her zaman ilk mailin konusunun altında "Re: …" olarak gitsin (sahte "Re: previous email" konusu spam/aldatıcı görünür)
  if (o.step > 0 && o.step < 100 && prev?.subject) subject = 'Re: ' + String(prev.subject).replace(/^(re|ynt|aw|sv):\s*/i, '');
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
  let finalBody = o.personal || /\{\{\s*kisisel\s*\}\}/.test(body) ? withOpener(body, opener) : body;
  const sc0 = schedule(), en = /^(hi|hello|dear)\b/i.test(String(body).trim());
  // Yurt dışında (GDPR) ilk mailde çıkış cümlesi her zaman eklenir
  if (o.step === 0 && (sc0.optout || (intlOnly() && en)) && !/rahatsız etmem|won't follow up|just let me know|listeden çık/i.test(finalBody)) {
    // çıkış cümlesini kapanıştan ("Saygılarımla," / "Best regards,") önce ekle
    const ot = en ? OPTOUT.en : OPTOUT.tr, m = String(finalBody).match(/\n\s*\n(Saygılarımla|Saygılar|İyi çalışmalar|Best regards|Kind regards|Regards|Best),?\s*\n/i);
    finalBody = m ? finalBody.slice(0, m.index) + '\n\n' + ot + finalBody.slice(m.index) : finalBody + '\n\n' + ot;
  }
  // Randevu linki: takiplerde (ayar açıksa ilk mailde de) kapanıştan önce tek satır; yanıtlarda {{randevu}} ile
  const bk = require('./booking').cfg();
  if (o.contact_id && o.step < 100 && ((o.step > 0 && bk.followups) || (o.step === 0 && bk.first)) && !/\/r\/[0-9a-z]+-/.test(finalBody) && !/\{\{\s*randevu/.test(finalBody)) {
    const bl = (en ? 'If easier, you can pick a time that suits you here: ' : 'Size uygun bir saati buradan da seçebilirsiniz: ') + require('./booking').link(o.contact_id);
    const m = String(finalBody).match(/\n\s*\n(Saygılarımla|Saygılar|İyi çalışmalar|Best regards|Kind regards|Regards|Best),?\s*\n/i);
    finalBody = m ? finalBody.slice(0, m.index) + '\n\n' + bl + finalBody.slice(m.index) : finalBody + '\n\n' + bl;
  }
  const fullSig = sigFor(sender);
  // Gövdede proje sahibinin adı geçiyorsa (ör. "Ben Emre Yıldız") gönderen kutunun adıyla değiştir
  const owner = String(ai.project().sender_name || '').trim();
  if (owner && sender.name && owner !== sender.name) finalBody = finalBody.split(owner).join(sender.name)
    .replace(new RegExp(`(^|[^\\p{L}])(ben|adım|I'm|I am|my name is)\\s+${owner.split(' ')[0]}(?![\\p{L}])`, 'giu'), (m, pre, w) => `${pre}${w} ${sender.name.split(' ')[0]}`);
  const me = { ...user, name: sender.name || user.name }; // {{gonderen}} = gönderen kutunun sahibi
  // İlk mailde görsel (logo) olmayan ama biçimli imza: isim, unvan, iletişim aynı tasarımda; resim/izleme yok → spam riski düşük
  const lightSig = h => /<img/i.test(h || '') ? String(h).replace(/<td[^>]*>\s*(<a[^>]*>\s*)?<img[^>]*>(\s*<\/a>)?\s*<\/td>/i, '').replace(/padding-left:16px;?/, '') : h;
  const signature = o.step === 0 && sc0.plain_first ? lightSig(fullSig) : fullSig;

  const { t, from } = transportFor(sender);
  const msg = { from, to: o.to_email, subject: fill(subject, ctx, me), html: html(fill(finalBody, ctx, me), signature), // hesabın kendi imzası (yoksa kullanıcınınki); ilk mailde düz metin
    // düz metin sürüm de eklenir (sadece-HTML mail spam sinyalidir)
    text: (fill(finalBody, ctx, me) + (signature ? '\n\n' + String(signature).replace(/<br\s*\/?>|<\/(div|p|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').split('\n').map(l => l.trim()).filter(Boolean).join('\n') : '')),
  };
  // Sabit CC: sadece gerçek yazışmalara (gelen cevaba verilen yanıt, step>=100) eklenir. Soğuk mail ve takiplerde CC yok:
  // alıcıya toplu gönderim gibi görünür, spam puanını artırır ve ekip kutusunu kopyalarla doldurur.
  const cc = o.step >= 100 ? ccList().filter(a => a !== String(o.to_email).toLowerCase() && a !== sender.email.toLowerCase()) : [];
  if (cc.length) msg.cc = cc;
  if (prev?.message_id) { msg.inReplyTo = prev.message_id; msg.references = [prev.message_id]; }
  if (o.reply_to_id) { const rp = get('SELECT message_id FROM replies WHERE id=?', o.reply_to_id); if (rp?.message_id) { msg.inReplyTo = rp.message_id; msg.references = [rp.message_id]; } }
  try {
    const info = await t.sendMail(msg);
    run("UPDATE outbox SET status='gönderildi', sent_at=?, message_id=?, subject=?, body=?, sender_id=?, error=NULL WHERE id=?",
      new Date().toISOString(), info.messageId, msg.subject, fill(finalBody, ctx, user), sender.id, o.id);
    if (o.campaign_id && o.step < 100) {
      run('UPDATE leads SET stage=? WHERE campaign_id=? AND contact_id=?', o.step ? `takip ${o.step}` : 'gönderildi', o.campaign_id, o.contact_id);
      const fus = ai.list(camp?.followups);
      const maxFu = Math.max(0, Math.min(2, +(require('./autopilot').cfg().followups ?? 1))); // aynı kişiye toplam en fazla 1 + maxFu mail
      if (o.step < maxFu && fus[o.step] && +fus[o.step].days > 0)
        run("INSERT INTO outbox(campaign_id,contact_id,step,to_email,subject,body,status,scheduled_at,user_id,sender_id) VALUES(?,?,?,?,?,'','sırada',?,?,?)",
          o.campaign_id, o.contact_id, o.step + 1, o.to_email, '', new Date(Date.now() + fus[o.step].days * 864e5).toISOString(), o.user_id, sender.id);
    }
    event('sent', `${o.name} (${o.company}) → ${o.to_email}\n"${msg.subject}"${o.step >= 100 ? ' · yanıt' : o.step ? ` · takip ${o.step}` : ''}${opener ? ' · kişisel cümleli' : ''} · ${sender.email}`, o.campaign_id);
    return 'sent';
  } catch (e) {
    // Geçici ağ hatası: mail kaybolmasın, 15 dk sonra (en fazla 3 kez) yeniden dene
    const tries = +(String(o.error || '').match(/^ağ hatası, deneme (\d)/) || [])[1] || 0;
    if (/ECONNRESET|ETIMEDOUT|ESOCKET|EPIPE|ECONNECTION|EAI_AGAIN|socket hang up|Connection closed|Greeting never received/i.test(e.message) && tries < 3) {
      run("UPDATE outbox SET error=?, scheduled_at=? WHERE id=?", `ağ hatası, deneme ${tries + 1}: ${e.message.slice(0, 200)}`, new Date(Date.now() + 15 * 60e3).toISOString(), o.id);
      console.error('mail yeniden denenecek', o.to_email, sender.email, e.message);
      return 'skip';
    }
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

module.exports = { isTR, isBig, intlOnly, isCompetitor, senderDaily, PROVIDERS, serverOf, detectProvider, imapOf, plainSig, OPTOUT, start, sendNow, deliver, pickSender, senders, transportFor, testSender, testGmail, transport, effectiveDaily, senderStats, fill, html, withOpener,
  scheduleState, schedule, SCHED_DEF, suppressed, cancelSuppressed, tick, nowTR, dayStart, migrateSenders };
