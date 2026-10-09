// Otopilot: her iş günü belirlenen saatte (varsayılan 09:38) her aktif gönderen kutu için 3-4 kişiye
// kişiye özel, toplantı isteyen mail hazırlar ve kuyruğa alır. Türk olmayanlara İngilizce yazar.
// Gönderimin kendisi mailer kuyruğunda gün içine yayılarak yapılır (ban kalkanı kuralları aynen geçerli).
const { all, get, run, setting, setSetting, jsonSetting } = require('./db');
const { event } = require('./notify');

const DEF = { enabled: true, time: '09:38', min: 3, max: 4, personal: true, partner_daily: 2 };
const cfg = () => ({ ...DEF, ...jsonSetting('autopilot', {}) });

const TR_HINT = /t[uü]rk|turkey|türkiye|istanbul|ankara|izmir|bursa|kocaeli|gebze|sakarya|tekirda[gğ]|manisa|konya|kayseri|gaziantep|denizli|trabzon|eski[sş]ehir|adana|mersin|antalya|osb/i;
function langOf(c) {
  const email = String(c.email || '').toLowerCase();
  if (/\.tr$/.test(email)) return 'Türkçe';
  if (TR_HINT.test([c.location, c.camp_location, c.camp_geo].join(' '))) return 'Türkçe';
  if (/[çğışöüİ]/.test(String(c.name || '') + String(c.company || ''))) return 'Türkçe';
  if (/\.(de|at|ch|pl|cz|sk|hu|ro|bg|it|es|fr|nl|be|uk|ie|se|dk|no|fi|pt|gr|rs|uz|kz|az|ge|ae|sa|qa|eg|ma|in|id|my|za|us|ca|mx|br|co)$/.test(email)) return 'English';
  return /[a-z]/i.test(String(c.location || '')) && !TR_HINT.test(c.location) && c.location ? 'English' : 'Türkçe';
}

const verified = c => {
  try { const m = JSON.parse(c.emails || '[]').find(e => String(e.email).toLowerCase() === String(c.email).toLowerCase()); return m && m.valid === 'valid' && !/^[CDF]/i.test(m.grade || ''); } catch { return false; }
};

function candidates(limit, partner = false) {
  const worker = require('./worker'), mailer = require('./mailer'), rcfg = worker.roleCfg();
  const rows = all(`SELECT c.*, l.campaign_id, k.location AS camp_location, k.geography AS camp_geo, co.score, co.domain AS co_domain
    FROM contacts c JOIN leads l ON l.contact_id=c.id JOIN campaigns k ON k.id=l.campaign_id LEFT JOIN companies co ON co.id=l.company_id
    WHERE k.status='aktif' AND ${partner ? "k.kind='partner'" : "k.kind NOT IN ('partner','meta')"} AND c.email<>'' AND c.status='mail var' AND c.manual_sent IS NULL
      AND NOT EXISTS(SELECT 1 FROM outbox o WHERE lower(o.to_email)=lower(c.email) AND o.step=0 AND o.status<>'iptal')
      AND NOT EXISTS(SELECT 1 FROM outbox o2 WHERE o2.contact_id=c.id AND o2.status IN ('sırada','taslak'))
    ORDER BY COALESCE(co.score,0) DESC, random() LIMIT 400`);
  const out = [], doms = new Set();
  for (const c of rows) {
    if (out.length >= limit) break;
    const dom = String(c.email).split('@')[1];
    if (doms.has(dom)) continue; // firma başı 1
    if ((!partner && !worker.roleOk(c.title, rcfg)) || !verified(c) || mailer.suppressed(c)) continue;
    doms.add(dom); out.push(c);
  }
  return out;
}

async function run1(force) {
  const c = cfg(), mailer = require('./mailer'), ai = require('./ai');
  const boxes = mailer.senders(); if (!boxes.length) return { queued: 0, why: 'aktif gönderen kutu yok' };
  const per = boxes.map(() => c.min + Math.floor(Math.random() * (c.max - c.min + 1)));
  const want = per.reduce((a, b) => a + b, 0);
  const doms = new Set(), list = [...candidates(want), ...(c.partner_daily > 0 ? candidates(c.partner_daily, true) : [])].filter(x => { const d = String(x.email).split('@')[1]; return doms.has(d) ? false : doms.add(d); });
  if (!list.length) { event('limit', '🤖 Otopilot: gönderilecek doğrulanmış yeni kişi kalmadı — yeni kampanya/firma bulmak gerekiyor'); return { queued: 0, why: 'aday yok' }; }
  let n = 0, en = 0, pn = 0; const errs = [];
  for (const p of list) {
    const camp = get('SELECT * FROM campaigns WHERE id=?', p.campaign_id) || {};
    const lang = langOf(p);
    try {
      const d = await ai.draftEmail(camp, p, 0, null, { lang, meeting: true });
      run("INSERT INTO outbox(campaign_id,contact_id,step,to_email,subject,body,status,user_id,personal) VALUES(?,?,0,?,?,?,'sırada',1,?)", p.campaign_id, p.id, p.email, d.subject, d.body, c.personal ? 1 : 0);
      run("UPDATE leads SET stage='sırada' WHERE campaign_id=? AND contact_id=?", p.campaign_id, p.id);
      n++; if (lang === 'English') en++; if (camp.kind === 'partner') pn++;
    } catch (e) { errs.push(e.message.slice(0, 80)); }
  }
  setSetting('autopilot_last', JSON.stringify({ t: Date.now(), n, en, want }));
  event('info', `🤖 Otopilot ${force ? '(elle)' : '09:38'}: ${n} kişiye kişiye özel toplantı maili sıraya alındı (${en} İngilizce${pn ? `, ${pn} çözüm ortağı` : ''}) · ${boxes.length} kutu × ${c.min}-${c.max}. Gün içine yayılarak gidecek.${errs.length ? ' Hata: ' + errs[0] : ''}`);
  mailer.tick();
  return { queued: n, en, want };
}

async function tick() {
  const c = cfg(); if (!c.enabled) return;
  const n = require('./mailer').nowTR(); if (n.day < 1 || n.day > 5) return;
  const [hh, mm] = String(c.time || '09:38').split(':').map(Number);
  const now = new Date(Date.now() + 3 * 3600e3), mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (mins < hh * 60 + mm || setting('autopilot_day') === n.date) return;
  setSetting('autopilot_day', n.date);
  try { await run1(false); } catch (e) { event('error', 'Otopilot hata: ' + e.message.slice(0, 150)); }
}
function start() { setInterval(tick, 60e3); setTimeout(tick, 20e3); }

module.exports = { start, run1, cfg, DEF, candidates, langOf };
