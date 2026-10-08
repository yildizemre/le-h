// Mail tahmini + doğrulama: RocketReach mail sorgusu (ayda 5000) yerine.
// 1) Firmada bildiğimiz doğrulanmış maillerden kalıbı (ad.soyad, asoyad, ...) çıkar
// 2) Kişi için aday adres(ler) üret
// 3) MillionVerifier ile doğrula (adres başı ~$0.004). "ok" çıkan = doğrulanmış mail.
const { all, get, run, setting, setSetting, jsonSetting } = require('./db');

const tr = s => String(s || '').toLocaleLowerCase('tr').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s-]/g, '').trim();
function nameParts(name) {
  const p = tr(name).split(/[\s-]+/).filter(w => w.length > 1 && !/^(dr|prof|mr|mrs|ms|muh|av)$/.test(w));
  return p.length >= 2 ? { f: p[0], l: p[p.length - 1], m: p.slice(1, -1) } : null;
}
// Kalıplar: {f}=ad, {l}=soyad, {fi}=adın baş harfi, {li}=soyadın baş harfi
const PATTERNS = ['{f}.{l}', '{fi}{l}', '{f}{l}', '{f}', '{fi}.{l}', '{l}.{f}', '{f}_{l}', '{f}-{l}', '{l}{fi}', '{l}', '{f}{li}'];
const apply = (pat, n) => pat.replace('{fi}', n.f[0]).replace('{li}', n.l[0]).replace('{f}', n.f).replace('{l}', n.l);

// Firmada (alan adında) doğrulanmış maillerden kalıp sayımı
function domainPatterns(domain) {
  const rows = all(`SELECT name, email, emails FROM contacts WHERE lower(email) LIKE ? AND status='mail var'`, '%@' + domain.toLowerCase());
  const count = {};
  for (const r of rows) {
    const n = nameParts(r.name); if (!n) continue;
    const local = r.email.split('@')[0].toLowerCase();
    const hit = PATTERNS.find(p => apply(p, n) === local);
    if (hit) count[hit] = (count[hit] || 0) + 1;
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}
// Genel (tüm veride) en sık kalıplar: firmada örnek yoksa bunlar denenir
function globalPatterns() {
  const c = jsonSetting('email_pattern_stats', null);
  if (c && Date.now() - c.t < 864e5) return c.list;
  const count = {};
  for (const r of all("SELECT name, email FROM contacts WHERE status='mail var' AND email<>''")) {
    const n = nameParts(r.name); if (!n) continue;
    const hit = PATTERNS.find(p => apply(p, n) === r.email.split('@')[0].toLowerCase());
    if (hit) count[hit] = (count[hit] || 0) + 1;
  }
  const list = Object.entries(count).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  for (const p of ['{f}.{l}', '{fi}{l}', '{f}{l}', '{f}']) if (!list.includes(p)) list.push(p);
  setSetting('email_pattern_stats', JSON.stringify({ t: Date.now(), list, count }));
  return list;
}
function candidates(name, domain, max = 3) {
  const n = nameParts(name); if (!n || !domain) return [];
  const dom = domainPatterns(domain), glob = globalPatterns();
  const order = [...dom, ...glob.filter(p => !dom.includes(p))];
  return [...new Set(order.map(p => apply(p, n) + '@' + domain.toLowerCase()))].slice(0, dom.length ? Math.max(1, Math.min(max, 2)) : max);
}

// MillionVerifier: result = ok | catch_all | unknown | invalid | disposable
async function mvVerify(email) {
  const key = setting('mv_key'); if (!key) return null;
  const r = await fetch(`https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}&timeout=20`, { signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error('MillionVerifier: ' + j.error);
  const day = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), u = jsonSetting('mv_usage_' + day, { n: 0 }); u.n++; setSetting('mv_usage_' + day, JSON.stringify(u));
  return { result: j.result || 'unknown', sub: j.subresult || '', credits: j.credits };
}
async function mvCredits() {
  const key = setting('mv_key'); if (!key) throw Object.assign(new Error('MillionVerifier API key girilmemiş'), { status: 400 });
  const j = await (await fetch(`https://api.millionverifier.com/api/v3/credits?api=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) })).json();
  if (j.error) throw Object.assign(new Error('MillionVerifier: ' + j.error), { status: 400 });
  return j;
}

// Kişi için doğrulanmış mail bul. Dönen: { email, status:'ok'|'catch_all'|'none', tried }
async function findEmail(c, domain) {
  const cands = candidates(c.name, domain || c.domain);
  if (!cands.length || !setting('mv_key')) return { status: 'none', tried: 0 };
  let catchAll = '';
  for (let i = 0; i < cands.length; i++) {
    const v = await mvVerify(cands[i]);
    if (v.result === 'ok') return { email: cands[i], status: 'ok', tried: i + 1 };
    if (v.result === 'catch_all') { catchAll = cands[0]; break; } // her adresi kabul eden sunucu: diğerlerini denemek boşa
  }
  return catchAll ? { email: catchAll, status: 'catch_all', tried: cands.length } : { status: 'none', tried: cands.length };
}

module.exports = { findEmail, candidates, domainPatterns, globalPatterns, mvVerify, mvCredits, nameParts };
