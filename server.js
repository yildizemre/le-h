process.removeAllListeners('warning');
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const crypto = require('crypto');
const { db, all, get, run, setting, setSetting, jsonSetting, hash, verify } = require('./lib/db');
const rr = require('./lib/rr');
const ai = require('./lib/ai');
const mailer = require('./lib/mailer');
const worker = require('./lib/worker');
const { event, sendTelegram } = require('./lib/notify');

const PORT = process.env.PORT || 5230;
if (setting('tpl_seed') !== 'v1') {
  for (const t of require('./lib/templates-seed'))
    if (!get('SELECT 1 FROM templates WHERE name=?', t.name)) run('INSERT INTO templates(user_id,name,subject,body) VALUES(1,?,?,?)', t.name, t.subject, t.body);
  setSetting('tpl_seed', 'v1');
}
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

// ---------------- Auth ----------------
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]));
app.use('/api', (req, res, next) => {
  const t = cookie(req).sid;
  req.user = (t && get('SELECT u.id,u.username,u.name,u.role,u.signature FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1', t)) || null;
  next();
});
const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Giriş gerekli' });
const admin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Yalnızca yönetici' });
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.message, wait: e.wait }); });

const fails = {};
app.post('/api/login', (req, res) => {
  const ip = req.ip, f = fails[ip] || { n: 0, t: 0 };
  if (f.n >= 8 && Date.now() - f.t < 10 * 60e3) return res.status(429).json({ error: 'Çok fazla hatalı deneme, 10 dk bekle' });
  const username = String(req.body?.user || '').trim().toLocaleLowerCase('tr'), pass = String(req.body?.pass || '').trim();
  const u = get('SELECT * FROM users WHERE lower(username)=? AND active=1', username);
  if (!u || !verify(pass, u.pass)) { fails[ip] = { n: f.n + 1, t: Date.now() }; return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' }); }
  delete fails[ip];
  const t = crypto.randomBytes(24).toString('hex');
  run('INSERT INTO sessions(token,user_id) VALUES(?,?)', t, u.id);
  res.setHeader('Set-Cookie', `sid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { run('DELETE FROM sessions WHERE token=?', cookie(req).sid || ''); res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ user: req.user }));
app.put('/api/me', auth, (req, res) => {
  const { name, signature, password } = req.body;
  if (name !== undefined) run('UPDATE users SET name=? WHERE id=?', name, req.user.id);
  if (signature !== undefined) run('UPDATE users SET signature=? WHERE id=?', signature, req.user.id);
  if (password) run('UPDATE users SET pass=? WHERE id=?', hash(password), req.user.id);
  res.json({ ok: true });
});

// ---------------- Users ----------------
app.get('/api/users', auth, admin, (req, res) => res.json(all('SELECT id,username,name,role,active,created FROM users ORDER BY id')));
app.post('/api/users', auth, admin, (req, res) => {
  const { username, name, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
  try { run('INSERT INTO users(username,name,pass,role) VALUES(?,?,?,?)', username.trim().toLocaleLowerCase('tr'), name || username, hash(password), role === 'admin' ? 'admin' : 'user'); }
  catch { return res.status(400).json({ error: 'Bu kullanıcı adı zaten var' }); }
  res.json({ ok: true });
});
app.put('/api/users/:id', auth, admin, (req, res) => {
  const { name, password, role, active } = req.body, id = +req.params.id;
  if (id === req.user.id && (role === 'user' || active === 0)) return res.status(400).json({ error: 'Kendi yetkini kaldıramazsın' });
  if (name !== undefined) run('UPDATE users SET name=? WHERE id=?', name, id);
  if (password) run('UPDATE users SET pass=? WHERE id=?', hash(password), id);
  if (role) run('UPDATE users SET role=? WHERE id=?', role === 'admin' ? 'admin' : 'user', id);
  if (active !== undefined) { run('UPDATE users SET active=? WHERE id=?', active ? 1 : 0, id); if (!active) run('DELETE FROM sessions WHERE user_id=?', id); }
  res.json({ ok: true });
});
app.delete('/api/users/:id', auth, admin, (req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: 'Kendini silemezsin' });
  run('DELETE FROM users WHERE id=?', +req.params.id); run('DELETE FROM sessions WHERE user_id=?', +req.params.id); res.json({ ok: true });
});

// ---------------- Settings / integrations ----------------
const mask = k => k ? k.slice(0, 5) + '•••' + k.slice(-4) : '';
app.get('/api/settings', auth, (req, res) => res.json({
  rr_key: mask(setting('rr_api_key')), openai_key: mask(setting('openai_key')), openai_model: setting('openai_model') || 'gpt-4.1-mini',
  gmail_user: setting('gmail_user'), gmail_pass: setting('gmail_pass') ? '••••••••' : '', from_name: setting('from_name'),
  tg_token: mask(setting('tg_token')), tg_chat: setting('tg_chat'), tg_mute: setting('tg_mute'),
  schedule: mailer.schedule(), sending_paused: setting('sending_paused') === '1',
}));
app.put('/api/settings', auth, admin, (req, res) => {
  const b = req.body;
  for (const [k, key] of [['rr_key', 'rr_api_key'], ['openai_key', 'openai_key'], ['tg_token', 'tg_token'], ['gmail_pass', 'gmail_pass']])
    if (b[k]) setSetting(key, k === 'gmail_pass' ? b[k].replace(/\s+/g, '') : b[k].trim());
  for (const k of ['openai_model', 'gmail_user', 'from_name', 'tg_chat', 'tg_mute']) if (b[k] !== undefined) setSetting(k, String(b[k]).trim());
  if (b.gmail_user !== undefined || b.gmail_pass) setSetting('sending_paused', '0');
  if (b.sending_paused !== undefined) setSetting('sending_paused', b.sending_paused ? '1' : '0');
  if (b.schedule) {
    const s = { ...mailer.SCHED_DEF, ...b.schedule };
    s.days = (s.days || []).map(Number); s.start = Math.min(23, Math.max(0, +s.start)); s.end = Math.min(24, Math.max(s.start + 1, +s.end));
    s.daily = Math.max(1, Math.min(500, +s.daily)); s.warmup = !!s.warmup; s.per_domain = Math.max(1, Math.min(10, +s.per_domain || 2)); s.min_delay = Math.max(20, +s.min_delay); s.max_delay = Math.max(s.min_delay, +s.max_delay);
    setSetting('schedule', JSON.stringify(s));
  }
  res.json({ ok: true });
});
app.get('/api/account', auth, wrap(async (req, res) => { const { status, body } = await rr.rr('/account/'); res.status(status).json(body); }));
app.post('/api/test/gmail', auth, wrap(async (req, res) => res.json(await mailer.testGmail(req.body.to, req.user.signature))));
app.post('/api/test/telegram', auth, wrap(async (req, res) => {
  await sendTelegram('✅ <b>Lead-AI</b> Telegram bildirimleri çalışıyor.', { token: req.body.token || setting('tg_token'), chat: req.body.chat || setting('tg_chat') });
  res.json({ ok: true });
}));
app.post('/api/test/telegram/chats', auth, wrap(async (req, res) => { // bot'a yazılan son mesajlardan chat id bul
  const token = req.body.token || setting('tg_token');
  if (!token) throw Object.assign(new Error('Önce bot token gir'), { status: 400 });
  const j = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json();
  if (!j.ok) throw Object.assign(new Error('Telegram: ' + j.description), { status: 400 });
  const chats = {};
  for (const u of j.result || []) { const c = (u.message || u.channel_post || u.my_chat_member || {}).chat; if (c) chats[c.id] = c.title || [c.first_name, c.last_name].join(' ') || c.username; }
  res.json(Object.entries(chats).map(([id, name]) => ({ id, name })));
}));
app.post('/api/test/openai', auth, wrap(async (req, res) => res.json({ ok: true, text: await ai.ask('Sadece "tamam" yaz.', { json: false }) })));

// ---------------- Project profile ----------------
app.get('/api/project', auth, (req, res) => res.json(ai.project()));
app.put('/api/project', auth, (req, res) => { setSetting('project', JSON.stringify({ ...ai.project(), ...req.body })); res.json({ ok: true }); });
app.post('/api/project/research', auth, wrap(async (req, res) => {
  const url = req.body.url || ai.project().website;
  if (!url) throw Object.assign(new Error('Web sitesi gir'), { status: 400 });
  res.json(await ai.profileFromWebsite(url));
}));

// ---------------- Campaigns ----------------
const CAMP_FIELDS = ['sector', 'location', 'name', 'status', 'brief', 'offer', 'problem', 'clients', 'positive', 'negative', 'keywords', 'geography', 'size', 'roles', 'titles', 'instructions', 'followups', 'auto_lookup', 'auto_draft', 'auto_send'];
const campStats = `(SELECT count(*) FROM companies WHERE campaign_id=c.id) AS companies, (SELECT count(*) FROM leads WHERE campaign_id=c.id) AS leads,
  (SELECT count(*) FROM leads l JOIN contacts k ON k.id=l.contact_id WHERE l.campaign_id=c.id AND k.email<>'') AS with_email,
  (SELECT count(*) FROM outbox WHERE campaign_id=c.id AND status='gönderildi') AS sent,
  (SELECT count(*) FROM leads WHERE campaign_id=c.id AND stage='yanıtladı') AS replied,
  (SELECT count(*) FROM tasks WHERE campaign_id=c.id AND status IN ('sırada','çalışıyor')) AS pending`;
app.get('/api/campaigns', auth, (req, res) => res.json(all(`SELECT c.*, ${campStats} FROM campaigns c ORDER BY c.id DESC`)));
app.get('/api/campaigns/:id', auth, (req, res) => {
  const c = get(`SELECT c.*, ${campStats} FROM campaigns c WHERE c.id=?`, +req.params.id);
  c ? res.json(c) : res.status(404).json({ error: 'Kampanya yok' });
});
const campVals = b => CAMP_FIELDS.filter(k => b[k] !== undefined).map(k => [k, Array.isArray(b[k]) ? JSON.stringify(b[k]) : typeof b[k] === 'boolean' ? +b[k] : b[k]]);
app.post('/api/campaigns', auth, (req, res) => {
  const v = campVals({ name: 'Yeni kampanya', ...req.body });
  const id = Number(run(`INSERT INTO campaigns(${v.map(x => x[0]).join(',')},user_id) VALUES(${v.map(() => '?').join(',')},?)`, ...v.map(x => x[1]), req.user.id).lastInsertRowid);
  res.json({ id });
});
app.put('/api/campaigns/:id', auth, (req, res) => {
  const v = campVals(req.body); if (!v.length) return res.json({ ok: true });
  run(`UPDATE campaigns SET ${v.map(x => x[0] + '=?').join(',')} WHERE id=?`, ...v.map(x => x[1]), +req.params.id);
  res.json({ ok: true });
});
app.delete('/api/campaigns/:id', auth, (req, res) => {
  const id = +req.params.id;
  run('DELETE FROM campaigns WHERE id=?', id); run('DELETE FROM companies WHERE campaign_id=?', id); run('DELETE FROM leads WHERE campaign_id=?', id);
  run("DELETE FROM tasks WHERE campaign_id=? AND status IN ('sırada','hata')", id); run("UPDATE outbox SET status='iptal' WHERE campaign_id=? AND status IN ('sırada','taslak')", id);
  res.json({ ok: true });
});
// Hızlı kampanya: sektör ve/veya konum yeter; AI hedeflemeyi doldurur, firma aramasını hemen başlatır
app.post('/api/campaigns/quick', auth, wrap(async (req, res) => {
  let { sector = '', location = '', country = 'Türkiye', size = '', note = '', count = 20, people = true, lookup = true, titles = '' } = req.body;
  if (country && country !== 'Türkiye') location = [location, country].filter(Boolean).join(', ');
  if (!sector.trim() && !location.trim()) throw Object.assign(new Error('Sektör veya konumdan en az birini yaz'), { status: 400 });
  const brief = [sector ? sector + ' sektöründeki' : 'Üretim yapan', 'firmalar / fabrikalar', location ? '(' + location + ')' : '', size ? '— ' + size : '', note].filter(Boolean).join(' ');
  let s = {};
  try { s = await ai.suggestCampaign(brief); } catch (e) { console.error('suggest', e.message); }
  const name = [sector || 'Fabrikalar', location].filter(Boolean).join(' · ');
  if (titles) s.titles = String(titles).split(',').map(x => x.trim()).filter(Boolean).concat(s.titles || []);
  const v = campVals({ ...s, name, brief, sector, location, geography: location || country || 'Türkiye', size: size || s.size || '', auto_lookup: lookup ? 1 : 0 });
  const id = Number(run(`INSERT INTO campaigns(${v.map(x => x[0]).join(',')},user_id) VALUES(${v.map(() => '?').join(',')},?)`, ...v.map(x => x[1]), req.user.id).lastInsertRowid);
  const n = Math.min(200, Math.max(5, +count || 20));
  for (let left = n, i = 0; left > 0; left -= 20, i++) worker.enqueue('ai_companies', { count: Math.min(20, left), people: !!people, n: Date.now() + i }, id, req.user.id);
  worker.loop();
  event('info', `Yeni kampanya: ${name} — AI ${n} firma arıyor`, id);
  res.json({ id });
}));
// Firma listesinden kampanya: yapıştırılan her satır bir firma, hepsinde yetkili aranır
app.post('/api/campaigns/from-list', auth, wrap(async (req, res) => {
  const { name, text = '', titles = '', lookup = true } = req.body;
  const lines = String(text).split(/\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw Object.assign(new Error('En az bir firma yaz'), { status: 400 });
  const tl = String(titles).split(',').map(x => x.trim()).filter(Boolean);
  const id = Number(run('INSERT INTO campaigns(name,brief,titles,auto_lookup,user_id) VALUES(?,?,?,?,?)', name || `Firma listesi (${lines.length})`, 'Elle verilen firma listesi',
    JSON.stringify(tl.length ? tl : ['Genel Müdür', 'Fabrika Müdürü', 'İSG Müdürü', 'Üretim Müdürü', 'CEO', 'General Manager', 'Plant Manager', 'HSE Manager', 'Operations Director']), lookup ? 1 : 0, req.user.id).lastInsertRowid);
  for (const line of lines) {
    const parts = line.split(/[,;\t]/).map(p => p.trim()).filter(Boolean);
    const domain = (parts.find(p => /\.[a-z]{2,}/i.test(p) && !/\s/.test(p)) || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const cname = parts.find(p => p.toLowerCase() !== domain && !/^(https?:|www\.)/i.test(p)) || domain;
    const r = run('INSERT OR IGNORE INTO companies(campaign_id,name,domain,reason) VALUES(?,?,?,?)', id, cname, domain || cname.toLowerCase(), 'listeden eklendi');
    if (r.changes) worker.enqueue('company_people', { company_id: Number(r.lastInsertRowid), max: 5 }, id, req.user.id);
  }
  worker.loop();
  event('info', `Firma listesinden kampanya: ${lines.length} firma, yetkililer aranıyor`, id);
  res.json({ id });
}));
app.get('/api/companies/:id', auth, (req, res) => {
  const co = get('SELECT * FROM companies WHERE id=?', +req.params.id); if (!co) return res.status(404).json({ error: 'Firma yok' });
  co.people = all('SELECT l.stage, c.* FROM leads l JOIN contacts c ON c.id=l.contact_id WHERE l.company_id=? ORDER BY c.email DESC', co.id);
  res.json(co);
});
app.get('/api/rr/quota', auth, wrap(async (req, res) => res.json({ list: await rr.quotas(req.query.force), limits: { lookup: Math.ceil(rr.remaining('lookup') / 60), arama: Math.ceil(rr.remaining('arama') / 60) } })));
// AI kampanya önerileri: şirket profiline + mevcut kampanyalara bakıp yeni hedef pazarlar önerir (günlük önbellek)
app.get('/api/ai/ideas', auth, wrap(async (req, res) => {
  const cache = jsonSetting('ideas_cache', {});
  if (!req.query.fresh && cache.t && Date.now() - cache.t < 864e5 && cache.list?.length) return res.json(cache.list);
  const p = ai.project(), done = all('SELECT name, sector, location FROM campaigns').map(c => [c.sector, c.location, c.name].filter(Boolean).join(' / '));
  const r = await ai.ask(`Sen B2B büyüme stratejistisin. Aşağıdaki şirket için soğuk mail kampanyası önerileri üret.
Şirket: ${p.company || ''} — ${p.description || ''}
Teklif: ${p.offer || ''}
Yetenekler: ${String(p.capabilities || '').slice(0, 800)}
Mevcut kampanyalar (tekrar etme): ${done.join('; ') || '-'}
8 öneri ver: yarısı Türkiye'de farklı sanayi bölgeleri/sektörler, yarısı yurt dışı (ülke ülke, Türkiye'ye yakın ve üretim yoğun pazarlar).
Her biri farklı bir sektör+bölge kombinasyonu olsun; neden şimdi mantıklı olduğunu somut yaz (mevzuat, yoğunluk, kaza riski, ihracat vb.).
Sadece JSON: {"ideas":[{"name":"kısa ad","sector":"","location":"şehir/bölge (boş olabilir)","country":"Türkiye veya ülke adı (Türkçe)","why":"1 cümle","titles":"aranacak 3-4 unvan, virgülle","modules":"öne çıkacak 2-3 modül"}]}`);
  const list = (r.ideas || []).filter(x => x.sector);
  setSetting('ideas_cache', JSON.stringify({ t: Date.now(), list }));
  res.json(list);
}));
app.post('/api/ai/suggest', auth, wrap(async (req, res) => res.json(await ai.suggestCampaign(req.body.brief || ''))));

app.post('/api/campaigns/:id/find-companies', auth, (req, res) => {
  const id = +req.params.id, count = Math.min(200, Math.max(5, +req.body.count || 20));
  // Büyük istekleri 20'lik parçalara böl (AI kalitesi için)
  for (let left = count, i = 0; left > 0; left -= 20, i++) worker.enqueue('ai_companies', { count: Math.min(20, left), people: !!req.body.people, n: Date.now() + i }, id, req.user.id);
  worker.loop(); res.json({ ok: true });
});
app.get('/api/campaigns/:id/companies', auth, (req, res) => res.json(all(`SELECT co.*, (SELECT count(*) FROM leads l JOIN contacts c ON c.id=l.contact_id WHERE l.company_id=co.id AND c.email<>'') AS mails,
  (SELECT json_object('id',c.id,'name',c.name,'title',c.title,'email',c.email,'linkedin',c.linkedin,'stage',l.stage) FROM leads l JOIN contacts c ON c.id=l.contact_id WHERE l.company_id=co.id ORDER BY (c.email<>'') DESC LIMIT 1) AS person
  FROM companies co WHERE co.campaign_id=? ORDER BY co.score DESC, co.id DESC`, +req.params.id)));
app.post('/api/campaigns/:id/companies', auth, (req, res) => { // elle firma ekle (satır satır "Ad, domain")
  let n = 0;
  for (const line of String(req.body.text || '').split(/\n/)) {
    const parts = line.split(/[,;\t]/).map(s => s.trim()).filter(Boolean); if (!parts.length) continue;
    const domain = (parts.find(p => /\.[a-z]{2,}/i.test(p)) || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const name = parts.find(p => p !== domain && !/\.[a-z]{2,}$/i.test(p)) || domain;
    if (!domain && !name) continue;
    n += run('INSERT OR IGNORE INTO companies(campaign_id,name,domain,reason) VALUES(?,?,?,?)', +req.params.id, name, domain || name.toLowerCase(), 'elle eklendi').changes;
  }
  res.json({ added: n });
});
app.post('/api/companies/people', auth, (req, res) => {
  let n = 0;
  for (const id of req.body.ids || []) {
    const co = get('SELECT * FROM companies WHERE id=?', +id); if (!co) continue;
    n += worker.enqueue('company_people', { company_id: co.id, ...(req.body.more ? { more: 1 } : {}) }, co.campaign_id, req.user.id) ? 1 : 0;
    run("UPDATE companies SET status='kuyrukta' WHERE id=? AND status IN ('yeni','kişi yok')", co.id);
  }
  worker.loop(); res.json({ queued: n });
});
app.delete('/api/companies', auth, (req, res) => {
  for (const id of req.body.ids || []) { run('DELETE FROM companies WHERE id=?', +id); run("DELETE FROM tasks WHERE type='company_people' AND status='sırada' AND payload LIKE ?", `{"company_id":${+id},%`); }
  res.json({ ok: true });
});

app.get('/api/campaigns/:id/leads', auth, (req, res) => res.json(all(`SELECT l.stage, l.company_id, l.created AS added, c.*, (f.contact_id IS NOT NULL) AS fav,
  (SELECT status FROM outbox o WHERE o.campaign_id=l.campaign_id AND o.contact_id=c.id ORDER BY o.id DESC LIMIT 1) AS mail_status
  FROM leads l JOIN contacts c ON c.id=l.contact_id LEFT JOIN favorites f ON f.contact_id=c.id AND f.user_id=? WHERE l.campaign_id=? ORDER BY l.created DESC`, req.user.id, +req.params.id)));
app.post('/api/campaigns/:id/leads', auth, (req, res) => { // Kişilerim'den kampanyaya ekle
  let n = 0;
  for (const cid of req.body.contact_ids || []) {
    const c = get('SELECT * FROM contacts WHERE id=?', +cid); if (!c) continue;
    n += run('INSERT OR IGNORE INTO leads(campaign_id,contact_id,stage) VALUES(?,?,?)', +req.params.id, c.id, c.email ? 'mail var' : 'aday').changes;
  }
  res.json({ added: n });
});
app.post('/api/campaigns/:id/leads/remove', auth, (req, res) => {
  for (const cid of req.body.contact_ids || []) {
    run('DELETE FROM leads WHERE campaign_id=? AND contact_id=?', +req.params.id, +cid);
    run("UPDATE outbox SET status='iptal' WHERE campaign_id=? AND contact_id=? AND status IN ('sırada','taslak')", +req.params.id, +cid);
  }
  res.json({ ok: true });
});
app.post('/api/campaigns/:id/leads/stage', auth, (req, res) => {
  for (const cid of req.body.contact_ids || []) {
    run('UPDATE leads SET stage=? WHERE campaign_id=? AND contact_id=?', req.body.stage, +req.params.id, +cid);
    if (req.body.stage === 'yanıtladı') run("UPDATE outbox SET status='iptal', error='yanıtladı' WHERE campaign_id=? AND contact_id=? AND status='sırada'", +req.params.id, +cid);
  }
  res.json({ ok: true });
});

// ---------------- Lookup queue ----------------
app.post('/api/queue/lookup', auth, (req, res) => {
  let n = 0; const skip = { 'maili zaten var': 0, 'daha önce sorgulandı': 0, 'zaten kuyrukta': 0 };
  for (const cid of [...new Set(req.body.contact_ids || [])]) {
    const c = get('SELECT id,email,status FROM contacts WHERE id=?', +cid); if (!c) continue;
    if (c.email) { skip['maili zaten var']++; continue; }
    if (worker.LOOKED.includes(c.status) && !req.body.force) { skip['daha önce sorgulandı']++; continue; }
    const q = worker.enqueue('lookup', { contact_id: c.id, ...(req.body.force ? { force: 1 } : {}) }, req.body.campaign_id || null, req.user.id);
    if (!q) { skip['zaten kuyrukta']++; continue; }
    n++;
    if (req.body.campaign_id) run("UPDATE leads SET stage='mail kuyrukta' WHERE campaign_id=? AND contact_id=? AND stage IN ('aday','mail yok')", +req.body.campaign_id, c.id);
  }
  for (const p of req.body.people || []) { // { name, company, linkedin }
    if (!p.name && !p.linkedin) continue;
    n += worker.enqueue('manual_find', { name: p.name || '', company: p.company || '', linkedin: p.linkedin || '' }, req.body.campaign_id || null, req.user.id) ? 1 : 0;
  }
  worker.loop(); res.json({ queued: n, skipped: skip });
});
app.post('/api/queue/rr', auth, (req, res) => { // arama sonucundan (rr_id) kuyruğa ekle
  let n = 0;
  for (const p of req.body.profiles || []) {
    const cid = rr.saveCandidate({ id: p.rr_id, name: p.name, current_title: p.title, current_employer: p.company, current_employer_domain: p.domain, location: p.location, linkedin_url: p.linkedin }, req.user.id, 'arama');
    if (req.body.campaign_id) run('INSERT OR IGNORE INTO leads(campaign_id,contact_id,stage) VALUES(?,?,?)', +req.body.campaign_id, cid, 'mail kuyrukta');
    const c = get('SELECT email,status FROM contacts WHERE id=?', cid);
    if (!c.email && !worker.LOOKED.includes(c.status)) n += worker.enqueue('lookup', { contact_id: cid }, req.body.campaign_id || null, req.user.id) ? 1 : 0;
  }
  worker.loop(); res.json({ queued: n });
});
app.get('/api/tasks', auth, (req, res) => {
  const q = req.query.campaign ? 'WHERE t.campaign_id=?' : '', a = req.query.campaign ? [+req.query.campaign] : [];
  res.json({
    counts: all(`SELECT type, status, count(*) n FROM tasks t ${q} GROUP BY type, status`, ...a),
    recent: all(`SELECT t.*, c.name AS campaign FROM tasks t LEFT JOIN campaigns c ON c.id=t.campaign_id ${q} ORDER BY CASE WHEN t.status IN ('çalışıyor','sırada') THEN 0 ELSE 1 END, t.id DESC LIMIT 200`, ...a),
    limits: { lookup: Math.ceil(rr.remaining('lookup') / 60), arama: Math.ceil(rr.remaining('arama') / 60) },
  });
});
app.post('/api/tasks/clear', auth, (req, res) => {
  if (req.body.what === 'done') run("DELETE FROM tasks WHERE status IN ('bitti','hata')");
  if (req.body.what === 'queued') run("DELETE FROM tasks WHERE status='sırada'");
  if (req.body.what === 'retry') run("UPDATE tasks SET status='sırada' WHERE status='hata'");
  worker.loop(); res.json({ ok: true });
});

// ---------------- RocketReach search / lookup ----------------
const contactsByRr = ids => ids.length ? Object.fromEntries(all(`SELECT * FROM contacts WHERE rr_id IN (${ids.map(() => '?').join(',')})`, ...ids).map(c => [c.rr_id, c])) : {};
app.post('/api/search', auth, wrap(async (req, res) => {
  const f = req.body || {}, query = {};
  const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  const map = { name: 'name', company: 'current_employer', title: 'current_title', industry: 'company_industry', location: 'location', keyword: 'keyword', domain: 'company_domain' };
  for (const [k, q] of Object.entries(map)) if (f[k]) query[q] = list(f[k]);
  if (!Object.keys(query).length) return res.status(400).json({ error: 'En az bir alan doldur' });
  const page = Math.max(1, +f.page || 1), size = 25;
  const body = await rr.search(query, (page - 1) * size + 1, size);
  const saved = contactsByRr((body.profiles || []).map(p => p.id));
  const favs = new Set(all('SELECT contact_id FROM favorites WHERE user_id=?', req.user.id).map(r => r.contact_id));
  const profiles = (body.profiles || []).map(p => {
    const c = saved[p.id];
    return { rr_id: p.id, name: p.name, title: p.current_title, company: p.current_employer, domain: p.current_employer_domain, location: p.location,
      linkedin: p.linkedin_url, teaser: p.teaser?.professional_emails?.length ? 'iş maili var' : (p.teaser?.personal_emails?.length ? 'kişisel mail var' : ''),
      contact: c ? { id: c.id, email: c.email, status: c.status, fav: favs.has(c.id) } : null };
  });
  const total = body.pagination?.total || 0;
  if (page === 1) run('INSERT INTO searches(user_id,params,total) VALUES(?,?,?)', req.user.id, JSON.stringify(f), total);
  res.json({ total, page, pages: Math.ceil(total / size), profiles });
}));
app.post('/api/lookup', auth, wrap(async (req, res) => {
  const { rr_id, name, company, linkedin } = req.body;
  if (!rr_id) {
    const r = await rr.findPerson({ name, company, linkedin }, req.user.id, 'manuel');
    return res.json(r.contact_id ? { ...r, contact: get('SELECT * FROM contacts WHERE id=?', r.contact_id) } : r);
  }
  const p = await rr.lookup({ id: rr_id });
  if (!p) return res.json({ status: 'bulunamadı' });
  const id = rr.saveContact(p, req.user.id, 'arama');
  const c = get('SELECT * FROM contacts WHERE id=?', id);
  if (c.email) event('found', `Mail bulundu: ${c.name} — ${c.title} @ ${c.company}\n${c.email}`);
  res.json({ status: 'ok', contact: c });
}));
app.get('/api/history', auth, (req, res) => res.json(all(`SELECT s.*, u.name AS user FROM searches s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 200`)));
app.delete('/api/history/:id', auth, (req, res) => { run('DELETE FROM searches WHERE id=?', +req.params.id); res.json({ ok: true }); });

// ---------------- Contacts ----------------
function contactQuery(req) {
  const { q, fav, email, job, ids } = req.query;
  let sql = `SELECT c.*, (f.contact_id IS NOT NULL) AS fav, u.name AS owner FROM contacts c
    LEFT JOIN favorites f ON f.contact_id=c.id AND f.user_id=? LEFT JOIN users u ON u.id=c.owner_id WHERE 1=1`; const a = [req.user.id];
  if (q) { sql += ` AND (c.name LIKE ? OR c.company LIKE ? OR c.title LIKE ? OR c.email LIKE ? OR c.industry LIKE ? OR c.location LIKE ?)`; a.push(...Array(6).fill('%' + q + '%')); }
  if (fav === '1') sql += ' AND f.contact_id IS NOT NULL';
  if (email === '1') sql += " AND c.email <> ''";
  if (email === '0') sql += " AND (c.email IS NULL OR c.email = '')";
  if (job) { sql += ' AND c.id IN (SELECT contact_id FROM job_rows WHERE job_id=?)'; a.push(+job); }
  if (ids) { const l = String(ids).split(',').map(Number).filter(Boolean); sql += ` AND c.id IN (${l.map(() => '?').join(',') || 'NULL'})`; a.push(...l); }
  return all(sql + ' ORDER BY c.updated DESC LIMIT 5000', ...a);
}
app.get('/api/contacts', auth, (req, res) => res.json(contactQuery(req)));
app.post('/api/contacts/:id/fav', auth, (req, res) => {
  const id = +req.params.id, on = get('SELECT 1 FROM favorites WHERE user_id=? AND contact_id=?', req.user.id, id);
  if (on) run('DELETE FROM favorites WHERE user_id=? AND contact_id=?', req.user.id, id); else run('INSERT INTO favorites VALUES(?,?)', req.user.id, id);
  res.json({ fav: !on });
});
app.put('/api/contacts/:id', auth, (req, res) => {
  const { email, note } = req.body;
  if (email !== undefined) run("UPDATE contacts SET email=?, status=CASE WHEN ?<>'' THEN 'mail var' ELSE status END WHERE id=?", email, email, +req.params.id);
  if (note !== undefined) run('UPDATE contacts SET note=? WHERE id=?', note, +req.params.id);
  res.json({ ok: true });
});
app.delete('/api/contacts/:id', auth, (req, res) => {
  const id = +req.params.id;
  run('DELETE FROM contacts WHERE id=?', id); run('DELETE FROM favorites WHERE contact_id=?', id); run('DELETE FROM leads WHERE contact_id=?', id);
  run("UPDATE outbox SET status='iptal' WHERE contact_id=? AND status IN ('sırada','taslak')", id);
  res.json({ ok: true });
});

const toRow = c => ({ 'Ad Soyad': c.name, 'Ünvan': c.title, 'Şirket': c.company, 'Sektör': c.industry, 'Lokasyon': c.location, 'Mail': c.email, 'Mail Kalitesi': c.email_grade,
  'Diğer Mailler': JSON.parse(c.emails || '[]').map(e => e.email).filter(e => e !== c.email).join(', '), 'Telefon': c.phones, 'LinkedIn': c.linkedin, 'Durum': c.stage || c.status, 'Not': c.note });
const sendXlsx = (res, sheets, name) => {
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), n);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.type('xlsx').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
};
app.get('/api/contacts/export', auth, (req, res) => sendXlsx(res, [['Kişiler', contactQuery(req).map(toRow)]], 'kisiler.xlsx'));
app.get('/api/campaigns/:id/export', auth, (req, res) => {
  const leads = all('SELECT l.stage, c.* FROM leads l JOIN contacts c ON c.id=l.contact_id WHERE l.campaign_id=?', +req.params.id);
  const cos = all('SELECT name AS Firma, domain AS Alan, city AS Şehir, sector AS Sektör, size AS Büyüklük, score AS Skor, reason AS Neden, status AS Durum, people AS Kişi FROM companies WHERE campaign_id=?', +req.params.id);
  sendXlsx(res, [['Kişiler', leads.map(toRow)], ['Firmalar', cos]], 'kampanya.xlsx');
});

// ---------------- Excel jobs ----------------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const pending = {};
const findCol = (cols, ...keys) => cols.find(c => keys.some(k => c.toLocaleLowerCase('tr').includes(k))) || '';
app.post('/api/jobs/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yok' });
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheets = wb.SheetNames.map(n => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }), cols = rows.length ? Object.keys(rows[0]) : [];
    return { name: n, count: rows.length, cols, guess: { name: findCol(cols, 'ad soyad', 'isim', 'name', 'ad'), company: findCol(cols, 'şirket', 'firma', 'company', 'employer'), linkedin: findCol(cols, 'linkedin') } };
  });
  const key = crypto.randomUUID(); pending[key] = { wb, file: Buffer.from(req.file.originalname, 'latin1').toString('utf8'), t: Date.now() };
  for (const [k, v] of Object.entries(pending)) if (Date.now() - v.t > 3600e3) delete pending[k];
  res.json({ key, file: pending[key].file, sheets });
});
app.post('/api/jobs', auth, (req, res) => {
  const { key, sheet, map, limit } = req.body, p = pending[key];
  if (!p) return res.status(400).json({ error: 'Dosyayı tekrar yükle' });
  let rows = XLSX.utils.sheet_to_json(p.wb.Sheets[sheet], { defval: '' });
  if (limit) rows = rows.slice(0, +limit);
  const id = Number(run('INSERT INTO jobs(user_id,file,total,state) VALUES(?,?,?,?)', req.user.id, p.file, rows.length, 'queued').lastInsertRowid);
  const ins = db.prepare('INSERT INTO job_rows(job_id,idx,input,q,status) VALUES(?,?,?,?,?)');
  rows.forEach((r, i) => ins.run(id, i, JSON.stringify(r), JSON.stringify({ name: String(r[map.name] || '').trim(), company: String(r[map.company] || '').trim(), linkedin: String(r[map.linkedin] || '').trim() }), ''));
  delete pending[key]; worker.jobLoop();
  res.json({ id });
});
app.get('/api/jobs', auth, (req, res) => res.json(all('SELECT j.*, u.name AS user FROM jobs j LEFT JOIN users u ON u.id=j.user_id ORDER BY j.id DESC')));
app.get('/api/jobs/:id', auth, (req, res) => {
  const j = get('SELECT * FROM jobs WHERE id=?', +req.params.id); if (!j) return res.status(404).json({ error: 'Yok' });
  j.rows = all(`SELECT r.idx, r.q, r.status, c.id AS cid, c.name, c.title, c.company, c.email, c.linkedin FROM job_rows r LEFT JOIN contacts c ON c.id=r.contact_id WHERE r.job_id=? ORDER BY r.idx`, j.id);
  res.json(j);
});
app.post('/api/jobs/:id/:act', auth, (req, res) => {
  const id = +req.params.id, act = req.params.act;
  if (act === 'cancel') run("UPDATE jobs SET state='cancelled' WHERE id=?", id);
  if (act === 'resume') run("UPDATE jobs SET state='queued', note='' WHERE id=?", id);
  if (act === 'retry') {
    run("UPDATE job_rows SET status='' WHERE job_id=? AND contact_id IS NULL", id);
    run("UPDATE jobs SET state='queued', note='', done=(SELECT count(*) FROM job_rows WHERE job_id=? AND status<>'') WHERE id=?", id, id);
  }
  worker.jobLoop(); res.json({ ok: true });
});
app.delete('/api/jobs/:id', auth, (req, res) => { run('DELETE FROM jobs WHERE id=?', +req.params.id); run('DELETE FROM job_rows WHERE job_id=?', +req.params.id); res.json({ ok: true }); });
app.get('/api/jobs/:id/download', auth, (req, res) => {
  const j = get('SELECT * FROM jobs WHERE id=?', +req.params.id); if (!j) return res.status(404).end();
  const rows = all('SELECT r.input, r.status AS rstatus, r.contact_id, c.* FROM job_rows r LEFT JOIN contacts c ON c.id=r.contact_id WHERE r.job_id=? ORDER BY r.idx', j.id);
  const full = rows.map(r => {
    const o = { ...JSON.parse(r.input), 'RR Durum': r.rstatus };
    if (r.contact_id) for (const [k, v] of Object.entries(toRow(r))) o['RR ' + k] = v;
    return o;
  });
  sendXlsx(res, [['Sonuçlar', full], ['Mail Listesi', rows.filter(r => r.email).map(toRow)]], j.file.replace(/\.\w+$/, '') + '_sonuc.xlsx');
});

// ---------------- Outbox / sending ----------------
app.post('/api/outbox/draft', auth, (req, res) => { // AI taslak üret (kuyruğa)
  let n = 0;
  for (const cid of req.body.contact_ids || []) n += worker.enqueue('draft', { contact_id: +cid, send: !!req.body.send }, +req.body.campaign_id, req.user.id) ? 1 : 0;
  worker.loop(); res.json({ queued: n });
});
app.post('/api/outbox/compose', auth, (req, res) => { // aynı metni (şablon) seçilenlere kuyruğa al
  const { contact_ids = [], subject, body, campaign_id, send } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'Konu ve içerik gerekli' });
  let n = 0, skipped = 0;
  for (const cid of contact_ids) {
    const c = get('SELECT * FROM contacts WHERE id=?', +cid);
    if (!c?.email || mailer.suppressed(c)) { skipped++; continue; }
    run('INSERT INTO outbox(campaign_id,contact_id,step,to_email,subject,body,status,user_id) VALUES(?,?,0,?,?,?,?,?)', campaign_id || null, c.id, c.email, subject, body, send ? 'sırada' : 'taslak', req.user.id);
    if (campaign_id) run('INSERT INTO leads(campaign_id,contact_id,stage) VALUES(?,?,?) ON CONFLICT DO UPDATE SET stage=excluded.stage', +campaign_id, c.id, send ? 'sırada' : 'taslak');
    n++;
  }
  res.json({ added: n, skipped });
});
app.get('/api/maillist', auth, (req, res) => {
  const { campaign, q, state } = req.query; const a = [];
  let sql = `SELECT c.id, c.name, c.title, c.company, c.domain, c.location, c.email, c.email_grade, c.linkedin,
    (SELECT group_concat(k.name, ', ') FROM leads l JOIN campaigns k ON k.id=l.campaign_id WHERE l.contact_id=c.id) AS campaigns,
    (SELECT o.status FROM outbox o WHERE o.contact_id=c.id ORDER BY o.id DESC LIMIT 1) AS last_status,
    (SELECT max(o.sent_at) FROM outbox o WHERE o.contact_id=c.id AND o.status='gönderildi') AS last_sent,
    EXISTS(SELECT 1 FROM leads l WHERE l.contact_id=c.id AND l.stage='yanıtladı') AS replied
    FROM contacts c WHERE c.email<>''`;
  if (campaign) { sql += ' AND c.id IN (SELECT contact_id FROM leads WHERE campaign_id=?)'; a.push(+campaign); }
  if (q) { sql += ' AND (c.name LIKE ? OR c.company LIKE ? OR c.title LIKE ? OR c.email LIKE ?)'; a.push(...Array(4).fill('%' + q + '%')); }
  let rows = all(sql + ' ORDER BY c.updated DESC LIMIT 3000', ...a);
  if (state === 'new') rows = rows.filter(r => !r.last_status || r.last_status === 'iptal');
  if (state === 'sent') rows = rows.filter(r => r.last_sent);
  rows.forEach(r => r.blocked = mailer.suppressed(r));
  res.json(rows);
});
// Kişi başına şablon seçerek toplu kuyruk. Aynı kişiye 60 gün içinde ilk mail tekrar gitmez.
app.post('/api/outbox/compose-multi', auth, (req, res) => {
  const { items = [], send = true, campaign_id = null, force = false } = req.body;
  const out = { added: 0, skipped: [] };
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  for (const it of items) {
    const c = get('SELECT * FROM contacts WHERE id=?', +it.contact_id), t = get('SELECT * FROM templates WHERE id=?', +it.template_id);
    if (!c?.email) { out.skipped.push({ id: it.contact_id, why: 'mail yok' }); continue; }
    if (!t) { out.skipped.push({ id: c.id, why: 'şablon seçilmedi' }); continue; }
    if (mailer.suppressed(c)) { out.skipped.push({ id: c.id, why: 'engel listesinde' }); continue; }
    if (!force && get("SELECT 1 FROM outbox WHERE lower(to_email)=? AND step=0 AND (status IN ('sırada','taslak') OR (status='gönderildi' AND sent_at>=?))", c.email.toLowerCase(), since)) {
      out.skipped.push({ id: c.id, why: 'son 60 günde zaten mail gitti / kuyrukta' }); continue;
    }
    const camp = campaign_id || get('SELECT campaign_id FROM leads WHERE contact_id=? ORDER BY created DESC LIMIT 1', c.id)?.campaign_id || null;
    run('INSERT INTO outbox(campaign_id,contact_id,step,to_email,subject,body,status,user_id) VALUES(?,?,0,?,?,?,?,?)', camp, c.id, c.email, t.subject, t.body, send ? 'sırada' : 'taslak', req.user.id);
    if (camp) run('UPDATE leads SET stage=? WHERE campaign_id=? AND contact_id=?', send ? 'sırada' : 'taslak', camp, c.id);
    out.added++;
  }
  mailer.tick();
  res.json(out);
});
app.get('/api/outbox', auth, (req, res) => {
  const { status, campaign } = req.query; let sql = `SELECT o.*, c.name, c.company, c.title, k.name AS campaign FROM outbox o LEFT JOIN contacts c ON c.id=o.contact_id
    LEFT JOIN campaigns k ON k.id=o.campaign_id WHERE 1=1`; const a = [];
  if (status) { sql += ' AND o.status IN (' + status.split(',').map(() => '?').join(',') + ')'; a.push(...status.split(',')); }
  if (campaign) { sql += ' AND o.campaign_id=?'; a.push(+campaign); }
  res.json(all(sql + " ORDER BY CASE o.status WHEN 'taslak' THEN 0 WHEN 'sırada' THEN 1 ELSE 2 END, COALESCE(o.sent_at, o.created) DESC LIMIT 2000", ...a));
});
app.put('/api/outbox/:id', auth, (req, res) => {
  const { subject, body } = req.body;
  run("UPDATE outbox SET subject=COALESCE(?,subject), body=COALESCE(?,body) WHERE id=? AND status IN ('taslak','sırada','hata')", subject ?? null, body ?? null, +req.params.id);
  res.json({ ok: true });
});
app.post('/api/outbox/action', auth, (req, res) => {
  const { ids = [], action } = req.body;
  const st = { approve: ["sırada", "('taslak','hata')"], cancel: ["iptal", "('taslak','sırada','hata')"], draft: ["taslak", "('sırada')"] }[action];
  if (action === 'delete') for (const id of ids) run("DELETE FROM outbox WHERE id=? AND status<>'gönderildi'", +id);
  else if (st) for (const id of ids) {
    run(`UPDATE outbox SET status=?, error=NULL, scheduled_at=CASE WHEN step=0 THEN NULL ELSE scheduled_at END WHERE id=? AND status IN ${st[1]}`, st[0], +id);
    const o = get('SELECT * FROM outbox WHERE id=?', +id);
    if (o?.campaign_id && o.step === 0) run('UPDATE leads SET stage=? WHERE campaign_id=? AND contact_id=?', { sırada: 'sırada', iptal: 'mail var', taslak: 'taslak' }[st[0]], o.campaign_id, o.contact_id);
  }
  mailer.tick(); res.json({ ok: true });
});
app.post('/api/outbox/send-now/:id', auth, wrap(async (req, res) => { await mailer.sendNow(+req.params.id); res.json({ ok: true }); }));
app.get('/api/sending', auth, (req, res) => res.json({
  ...mailer.scheduleState(),
  counts: Object.fromEntries(all('SELECT status, count(*) n FROM outbox GROUP BY status').map(r => [r.status, r.n])),
}));
app.post('/api/sending/check-replies', auth, wrap(async (req, res) => { await mailer.checkReplies(); res.json({ ok: true }); }));

// Eski "şablonlu gönder" sayfası için şablonlar
app.get('/api/templates', auth, (req, res) => res.json(all('SELECT * FROM templates ORDER BY id DESC')));
app.post('/api/templates', auth, (req, res) => {
  const { id, name, subject, body } = req.body;
  if (id) run('UPDATE templates SET name=?,subject=?,body=? WHERE id=?', name, subject, body, id);
  else run('INSERT INTO templates(user_id,name,subject,body) VALUES(?,?,?,?)', req.user.id, name, subject, body);
  res.json({ ok: true });
});
app.delete('/api/templates/:id', auth, (req, res) => { run('DELETE FROM templates WHERE id=?', +req.params.id); res.json({ ok: true }); });
app.post('/api/mail/preview', auth, (req, res) => {
  const c = get('SELECT * FROM contacts WHERE id=?', +req.body.contact_id || 0) || { name: 'Ahmet Yılmaz', company: 'Örnek A.Ş.', title: 'Genel Müdür' };
  res.json({ subject: mailer.fill(req.body.subject, c, req.user), html: mailer.html(mailer.fill(req.body.body, c, req.user), req.user.signature) });
});
app.post('/api/mail/ai-preview', auth, wrap(async (req, res) => { // kampanya talimatıyla örnek mail
  const camp = get('SELECT * FROM campaigns WHERE id=?', +req.body.campaign_id || 0) || {};
  const c = get('SELECT * FROM contacts WHERE id=?', +req.body.contact_id || 0) || { name: 'Ahmet Yılmaz', company: 'Örnek Otomotiv A.Ş.', title: 'İSG Müdürü', location: 'Kocaeli' };
  const d = await ai.draftEmail({ ...camp, ...(req.body.overrides || {}) }, c, 0);
  res.json({ ...d, html: mailer.html(d.body, req.user.signature) });
}));

// ---------------- Suppress list ----------------
const norm = (type, v) => {
  v = String(v || '').trim().toLocaleLowerCase('tr');
  if (type === 'domain') v = v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/^.*@/, '');
  return v;
};
app.get('/api/suppress', auth, (req, res) => res.json(all('SELECT * FROM suppress ORDER BY id DESC')));
app.post('/api/suppress', auth, (req, res) => {
  let n = 0;
  for (const raw of String(req.body.text || '').split(/[\n,;]+/)) {
    let v = raw.trim(); if (!v) continue;
    let type = req.body.type;
    if (!type || type === 'auto') type = /linkedin\.com/i.test(v) ? 'linkedin' : v.includes('@') ? 'email' : /\.[a-z]{2,}$/i.test(v) ? 'domain' : 'name';
    v = norm(type, v); if (!v || /^(e-?mail|domain|alan adı)$/i.test(v)) continue;
    n += run('INSERT OR IGNORE INTO suppress(type,value) VALUES(?,?)', type, v).changes;
  }
  mailer.cancelSuppressed();
  res.json({ added: n });
});
app.post('/api/suppress/upload', auth, upload.single('file'), (req, res) => {
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  let n = 0;
  for (const name of wb.SheetNames) for (const row of XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })) for (const cell of row) {
    const v = String(cell).trim(); if (!v) continue;
    const type = req.body.type === 'domain' ? 'domain' : /linkedin\.com/i.test(v) ? 'linkedin' : v.includes('@') ? 'email' : /^[\w.-]+\.[a-z]{2,}$/i.test(v) ? 'domain' : null;
    if (type) n += run('INSERT OR IGNORE INTO suppress(type,value) VALUES(?,?)', type, norm(type, v)).changes;
  }
  mailer.cancelSuppressed();
  res.json({ added: n });
});
app.delete('/api/suppress/:id', auth, (req, res) => { run('DELETE FROM suppress WHERE id=?', +req.params.id); res.json({ ok: true }); });

// ---------------- Dashboard ----------------
app.get('/api/stats', auth, (req, res) => res.json({
  contacts: get('SELECT count(*) n FROM contacts').n, withEmail: get("SELECT count(*) n FROM contacts WHERE email<>''").n,
  favs: get('SELECT count(*) n FROM favorites WHERE user_id=?', req.user.id).n, sent: get("SELECT count(*) n FROM outbox WHERE status='gönderildi'").n,
  replied: get("SELECT count(*) n FROM leads WHERE stage='yanıtladı'").n, companies: get('SELECT count(*) n FROM companies').n,
  queued: get("SELECT count(*) n FROM outbox WHERE status='sırada'").n, drafts: get("SELECT count(*) n FROM outbox WHERE status='taslak'").n,
  tasks: get("SELECT count(*) n FROM tasks WHERE status IN ('sırada','çalışıyor')").n,
  jobs: get("SELECT count(*) n FROM jobs WHERE state IN ('queued','running','paused')").n,
  limits: { lookup: Math.ceil(rr.remaining('lookup') / 60), arama: Math.ceil(rr.remaining('arama') / 60) },
  sending: mailer.scheduleState(),
  setup: { rr: !!setting('rr_api_key'), openai: !!setting('openai_key'), gmail: !!(setting('gmail_user') && setting('gmail_pass')), telegram: !!(setting('tg_token') && setting('tg_chat')), project: !!ai.project().company },
}));
app.get('/api/events', auth, (req, res) => {
  const c = req.query.campaign;
  res.json(c ? all('SELECT * FROM events WHERE campaign_id=? ORDER BY id DESC LIMIT 200', +c) : all('SELECT e.*, k.name AS campaign FROM events e LEFT JOIN campaigns k ON k.id=e.campaign_id ORDER BY e.id DESC LIMIT 200'));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı' }));
// Kod dosyaları her açılışta doğrulansın (güncelleme sonrası eski sürüm takılı kalmasın); görseller 7 gün önbellekte
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], setHeaders: (res, p) => res.setHeader('Cache-Control', /\.(html|js|css|webmanifest)$/.test(p) ? 'no-cache' : 'public, max-age=604800') }));
app.listen(PORT, () => {
  console.log(`Lead-AI: http://localhost:${PORT}`);
  worker.start(); mailer.start();
});
