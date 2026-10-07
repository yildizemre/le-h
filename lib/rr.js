// RocketReach API: saatlik limit durumu tüm işçiler arasında paylaşılır
const { get, run, setting } = require('./db');

const RR = 'https://api.rocketreach.co/api/v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const blockedUntil = { lookup: 0, arama: 0, istek: 0 };

class Throttled extends Error {
  constructor(wait, what) {
    super(`RocketReach ${what} limiti doldu, ~${Math.max(1, Math.ceil(wait / 60))} dk sonra devam`);
    this.status = 429; this.wait = wait; this.what = what;
  }
}
const remaining = what => Math.max(0, (blockedUntil[what] - Date.now()) / 1000);

// RocketReach dakikada 15 lookup / 15 arama kabul ediyor: aynı türde iki çağrı arasında en az 4.2 sn bırak
const lastCall = {}, GAP = { lookup: 4200, arama: 4200, istek: 300 };
async function pace(what) {
  const wait = (lastCall[what] || 0) + (GAP[what] || 300) - Date.now();
  lastCall[what] = Date.now() + Math.max(0, wait);
  if (wait > 0) await sleep(wait);
}

async function rr(pathq, opts = {}, what = 'istek') {
  const key = setting('rr_api_key');
  if (!key) throw Object.assign(new Error('Ayarlar → RocketReach API key girilmemiş'), { status: 400 });
  if (remaining(what) > 0) throw new Throttled(remaining(what), what);
  for (let i = 0; i < 4; i++) {
    await pace(what);
    const r = await fetch(RR + pathq, { ...opts, headers: { 'Api-Key': key, 'Content-Type': 'application/json' } });
    const body = await r.json().catch(() => ({}));
    if (r.status === 429) {
      const wait = +body.wait || +r.headers.get('retry-after') || 2;
      if (wait > 20) { blockedUntil[what] = Date.now() + wait * 1000; throw new Throttled(wait, what); }
      await sleep(wait * 1000 + 300); continue;
    }
    return { status: r.status, body };
  }
  throw new Throttled(60, what);
}

const fold = s => String(s || '').replace(/ı/g, 'i').replace(/İ/g, 'I').normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = s => fold(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
const qs = o => Object.entries(o).filter(([, v]) => v).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
const STOP = ['san', 'tic', 'ltd', 'sti', 'sanayi', 'ticaret', 'anonim', 'sirketi', 'limited', 'ins', 'holding', 'grubu', 'group', 'com', 'www'];

// Lookup profilini kişiler tablosuna yaz/güncelle
function saveContact(p, userId, source) {
  const emails = (p.emails || []).filter(e => e?.email);
  const best = p.recommended_professional_email || p.current_work_email || p.recommended_email
    || emails.find(e => e.type === 'professional' && e.smtp_valid !== 'invalid')?.email || emails.find(e => e.smtp_valid !== 'invalid')?.email || '';
  const grade = emails.find(e => e.email === best)?.grade || '';
  const phones = (p.phones || []).map(x => x.number).filter(Boolean).join(', ');
  const status = best ? 'mail var' : p.pending ? 'mail bekleniyor' : (p.status === 'failed' ? 'bulunamadı' : 'mail yok');
  const v = [p.name || '', p.current_title || '', p.current_employer || '', p.current_employer_domain || '', p.current_employer_industry || '',
    p.location || '', p.linkedin_url || '', best, grade, JSON.stringify(emails.map(e => ({ email: e.email, type: e.type, grade: e.grade, valid: e.smtp_valid }))), phones, status];
  const ex = p.id && get('SELECT id FROM contacts WHERE rr_id=?', p.id);
  if (ex) {
    run(`UPDATE contacts SET name=?,title=?,company=?,domain=?,industry=?,location=?,linkedin=?,email=?,email_grade=?,emails=?,phones=?,status=?,updated=CURRENT_TIMESTAMP WHERE id=?`, ...v, ex.id);
    return ex.id;
  }
  return Number(run(`INSERT INTO contacts(name,title,company,domain,industry,location,linkedin,email,email_grade,emails,phones,status,rr_id,source,owner_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ...v, p.id || null, source, userId).lastInsertRowid);
}

// Arama sonucundaki profili (mailsiz) aday olarak kaydet; mevcutsa dokunma
const teaserOf = p => !p.teaser ? -1 : (p.teaser.professional_emails || []).length ? 1 : 0;
function saveCandidate(p, userId, source) {
  const ex = get('SELECT id FROM contacts WHERE rr_id=?', p.id);
  if (ex) { if (p.teaser) run('UPDATE contacts SET teaser=? WHERE id=? AND teaser=-1', teaserOf(p), ex.id); return ex.id; }
  return Number(run(`INSERT INTO contacts(rr_id,name,title,company,domain,location,linkedin,status,source,owner_id,teaser) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    p.id, p.name || '', p.current_title || '', p.current_employer || '', p.current_employer_domain || '', p.location || '', p.linkedin_url || '', 'aday', source, userId, teaserOf(p)).lastInsertRowid);
}

// Tek lookup çağrısı. Profil hazırlanıyorsa beklemeyiz: kişi 'mail bekleniyor' olur,
// refreshPending() 5 dk'da bir hepsini tek checkStatus çağrısıyla toplar (her checkStatus da lookup kotasından düşer).
async function lookup(q) {
  let { status, body } = await rr('/person/lookup?' + qs(q), {}, 'lookup');
  if (status === 404) return null;
  if (status >= 400) throw Object.assign(new Error(body.detail || JSON.stringify(body).slice(0, 200)), { status });
  if (!(body.emails || []).length && !['complete', 'failed'].includes(body.status)) body.pending = true;
  return body;
}

async function refreshPending() {
  const db = require('./db');
  for (const r of db.all("SELECT id FROM contacts WHERE status='mail bekleniyor' AND pending_tries>=3")) run("UPDATE contacts SET status='mail yok', updated=CURRENT_TIMESTAMP WHERE id=?", r.id);
  const rows = db.all("SELECT id, rr_id FROM contacts WHERE status='mail bekleniyor' AND rr_id IS NOT NULL AND pending_tries<3 ORDER BY updated LIMIT 50");
  if (!rows.length || remaining('lookup') > 0) return [];
  run(`UPDATE contacts SET pending_tries=pending_tries+1 WHERE id IN (${rows.map(() => '?').join(',')})`, ...rows.map(r => r.id));
  const { status, body } = await rr('/person/checkStatus?ids=' + rows.map(r => r.rr_id).join(','), {}, 'lookup');
  if (status >= 400 || !Array.isArray(body)) return [];
  const done = [];
  for (const p of body) {
    const row = rows.find(r => r.rr_id === p.id); if (!row) continue;
    if ((p.emails || []).length || ['complete', 'failed'].includes(p.status)) { saveContact(p, null, null); done.push(row.id); }
    else run('UPDATE contacts SET updated=CURRENT_TIMESTAMP WHERE id=?', row.id);
  }
  return done;
}

// RocketReach'in gerçek kota tablosu (account endpoint'i kota harcamaz)
let quota = { t: 0, list: [] };
async function quotas(force) {
  if (!force && Date.now() - quota.t < 120e3) return quota.list;
  try {
    const { status, body } = await rr('/account/');
    if (status < 400) quota = { t: Date.now(), list: (body.rate_limits || []).filter(r => /person_(lookup|search)/.test(r.action)) };
  } catch {}
  return quota.list;
}

async function search(query, start = 1, size = 25) {
  const { status, body } = await rr('/person/search', { method: 'POST', body: JSON.stringify({ query, start, page_size: size }) }, 'arama');
  if (status >= 400) throw Object.assign(new Error(body.detail || JSON.stringify(body).slice(0, 200)), { status });
  return body;
}

// İsim+şirket ile kişiyi bul (Excel satırı / manuel)
async function findPerson(q, userId, source) {
  let p = null, match = '';
  if (q.linkedin) { p = await lookup({ linkedin_url: q.linkedin }); match = 'linkedin'; }
  if (!p && q.name && q.company) {
    try { p = await lookup({ name: q.name, current_employer: q.company }); match = 'isim+şirket'; }
    catch (e) { if (e instanceof Throttled) throw e; }
  }
  // Kişi başı tek lookup: profil bulunduysa (maili olmasa da) tekrar arama/lookup yapma; sadece hiç bulunamadıysa isimle ara
  if (!p && q.name) {
    let list = null;
    try { list = (await search({ name: [q.name] }, 1, 10)).profiles || []; }
    catch (e) { if (!(e instanceof Throttled)) throw e; if (!p) throw e; }
    if (list) {
      const cw = words(q.company).filter(w => !STOP.includes(w)), nm = words(q.name).join(' ');
      const scored = list.filter(x => words(x.name).join(' ') === nm).map(x => {
        const emp = words(x.current_employer + ' ' + (x.current_employer_domain || ''));
        return { x, sc: cw.filter(w => emp.some(e => e.includes(w) || w.includes(e))).length * 10 + (x.country_code === 'TR' ? 3 : 0) + ((x.teaser?.professional_emails || []).length ? 1 : 0) };
      }).sort((a, b) => b.sc - a.sc);
      const best = scored[0] && (scored[0].sc >= 10 || (scored.length === 1 && scored[0].x.country_code === 'TR')) ? scored[0] : null;
      if (best && best.x.id !== p?.id) { p = await lookup({ id: best.x.id }); match = best.sc >= 10 ? 'arama: isim+şirket' : 'arama: yalnız isim (TR)'; }
      else if (!p && scored.length) return { status: `emin değil (${scored.length} aday)` };
    }
  }
  if (!p) return { status: 'bulunamadı' };
  const id = saveContact(p, userId, source);
  return { status: (p.emails || []).length ? 'mail bulundu' : p.pending ? 'mail bekleniyor' : 'mail yok', contact_id: id, match };
}

// Aylık mail sorgusu bütçesi: kalan kota kalan güne yayılır (ayın sonuna kadar her gün eşit pay)
function block(what, ms) { blockedUntil[what] = Math.max(blockedUntil[what] || 0, Date.now() + ms); }
async function lookupBudget() {
  const q = await quotas();
  const m = q.find(r => r.action === 'person_lookup' && r.duration === 'one_month'), d = q.find(r => r.action === 'person_lookup' && r.duration === 'one_day');
  if (!m) return { ok: true, daily: null };
  const cap = Math.min(m.limit, +setting('rr_month_budget') || m.limit);
  const now = new Date(), daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  const usedBefore = m.used - (d?.used || 0);
  const daily = Math.max(5, Math.floor((cap - usedBefore) / daysLeft));
  return { ok: (d?.used || 0) < daily && m.used < cap, daily, today: d?.used || 0, month: m.used, cap, daysLeft };
}
module.exports = { block, lookupBudget, teaserOf, rr, lookup, refreshPending, quotas, search, findPerson, saveContact, saveCandidate, Throttled, remaining, words, STOP, fold };
