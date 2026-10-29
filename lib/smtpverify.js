// Ücretsiz mail doğrulama: alıcının mail sunucusuna (MX) bağlanıp mail GÖNDERMEDEN "bu adres var mı?" diye sorar (RCPT TO).
// Rastgele bir adresi de sorarak "her adresi kabul eden" (catch-all) sunucuları ayırt eder. Sonuçlar 30 gün önbellekte tutulur.
// Kendi IP'mizi korumak için yavaş çalışır: alan adı başına dakikada 1 bağlantı, dakikada en fazla 20, günde en fazla 400 sorgu.
const net = require('net');
const dns = require('dns').promises;
const crypto = require('crypto');
const { db, get, run, setting } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS smtp_checks(email TEXT PRIMARY KEY, result TEXT, code INTEGER, msg TEXT, checked TEXT DEFAULT CURRENT_TIMESTAMP)`);
db.exec(`CREATE TABLE IF NOT EXISTS smtp_domains(domain TEXT PRIMARY KEY, catch_all INTEGER, mx TEXT, checked TEXT DEFAULT CURRENT_TIMESTAMP)`);

const HELO = () => setting('smtp_verify_helo') || 'vulut.com'; // sunucunun ters DNS (PTR) adı
const lastDomain = {}; let minute = { t: 0, n: 0 };
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const dailyUsed = () => get("SELECT count(*) n FROM smtp_checks WHERE checked>=?", today() + ' 00:00:00')?.n || 0;

async function mxOf(domain) {
  const recs = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority);
  if (!recs.length) throw new Error('MX yok');
  return recs[0].exchange;
}

// Tek bağlantıda birden fazla RCPT sorar: [{to, code, msg}]
function probe(mx, rcpts) {
  return new Promise(resolve => {
    const out = [], sock = net.createConnection(25, mx); let buf = '', step = 0, done = false;
    const finish = err => { if (done) return; done = true; try { sock.write('QUIT\r\n'); } catch {} sock.destroy(); resolve(err ? { error: err, out } : { out }); };
    sock.setTimeout(15000, () => finish('zaman aşımı'));
    sock.on('error', e => finish(e.message));
    sock.on('close', () => finish('bağlantı kapandı')); // sunucu sessizce kapatınca söz hiç çözülmüyor, iş kuyruğu kilitleniyordu
    setTimeout(() => finish('toplam süre aşımı'), 60e3).unref();
    const send = l => sock.write(l + '\r\n');
    sock.on('data', d => {
      buf += d.toString();
      // yanıt tamamlanınca son satır "NNN metin" olur (çok satırlılarda ara satırlar "NNN-metin")
      const m = buf.match(/(?:^|\r\n)(\d{3}) ([^\r\n]*)\r\n$/); if (!m) return;
      const last = m[1] + ' ' + m[2]; buf = '';
      const code = parseInt(last.slice(0, 3), 10);
      if (step === 0) { if (code !== 220) return finish('karşılama ' + code); step = 1; return send('EHLO ' + HELO()); }
      if (step === 1) { if (code !== 250) return finish('EHLO ' + code); step = 2; return send('MAIL FROM:<>'); }
      if (step === 2) { if (code !== 250) return finish('MAIL FROM ' + code + ' ' + last.slice(4, 80)); step = 3; return send(`RCPT TO:<${rcpts[0]}>`); }
      if (step >= 3) {
        out.push({ to: rcpts[step - 3], code, msg: last.slice(4, 120) });
        if (step - 3 + 1 < rcpts.length) { step++; return send(`RCPT TO:<${rcpts[step - 3]}>`); }
        return finish();
      }
    });
  });
}

// result: ok | invalid | catch_all | unknown
async function verify(email) {
  email = String(email).toLowerCase().trim();
  const domain = email.split('@')[1]; if (!domain) return { result: 'invalid', reason: 'geçersiz biçim' };
  const cached = get("SELECT * FROM smtp_checks WHERE email=? AND checked>=datetime('now','-30 day')", email);
  if (cached) return { result: cached.result, code: cached.code, cached: true };
  if (setting('smtp_verify_off') === '1') return { result: 'unknown', reason: 'kapalı' };
  if (dailyUsed() >= (+setting('smtp_verify_daily') || 400)) return { result: 'unknown', reason: 'günlük sınır' };
  const now = Date.now();
  if (now - minute.t > 60e3) minute = { t: now, n: 0 };
  if (minute.n >= 20) return { result: 'unknown', reason: 'dakika sınırı' };
  const wait = 60e3 - (now - (lastDomain[domain] || 0));
  if (wait > 0) await new Promise(r => setTimeout(r, wait)); // aynı alan adına dakikada 1 bağlantı
  lastDomain[domain] = Date.now(); minute.n++;
  let mx; try { mx = await mxOf(domain); } catch (e) { run('INSERT OR REPLACE INTO smtp_checks(email,result,code,msg) VALUES(?,?,?,?)', email, 'invalid', 0, 'MX yok'); return { result: 'invalid', reason: 'alan adının mail sunucusu yok' }; }
  const dom = get("SELECT * FROM smtp_domains WHERE domain=? AND checked>=datetime('now','-30 day')", domain);
  const fake = `zz${crypto.randomBytes(5).toString('hex')}@${domain}`;
  const rcpts = dom ? [email] : [email, fake];
  const r = await probe(mx, rcpts);
  if (r.error || !r.out.length) return { result: 'unknown', reason: r.error || 'yanıt yok', mx };
  const t = r.out[0], f = r.out[1];
  let catchAll = dom ? !!dom.catch_all : null;
  if (f) { catchAll = f.code >= 200 && f.code < 300; run('INSERT OR REPLACE INTO smtp_domains(domain,catch_all,mx) VALUES(?,?,?)', domain, catchAll ? 1 : 0, mx); }
  let result = 'unknown';
  if (t.code >= 200 && t.code < 300) result = catchAll ? 'catch_all' : 'ok';
  else if ([550, 551, 553].includes(t.code) || /5\.1\.1|does not exist|no such user|unknown user|user unknown|not found|invalid recipient|mailbox unavailable/i.test(t.msg)) result = 'invalid';
  if (result !== 'unknown') run('INSERT OR REPLACE INTO smtp_checks(email,result,code,msg) VALUES(?,?,?,?)', email, result, t.code, t.msg);
  return { result, code: t.code, msg: t.msg, mx };
}


// Aynı alan adındaki birden fazla tahmini TEK bağlantıda sorar (+ catch-all testi). Dönen: { results: {email: result}, catchAll, error }
async function verifyMany(emails) {
  emails = [...new Set(emails.map(e => String(e).toLowerCase().trim()))].filter(e => e.includes('@'));
  if (!emails.length) return { results: {} };
  const domain = emails[0].split('@')[1], results = {};
  const todo = [];
  for (const e of emails) { const c = get("SELECT * FROM smtp_checks WHERE email=? AND checked>=datetime('now','-30 day')", e); if (c) results[e] = c.result; else todo.push(e); }
  if (!todo.length) return { results, cached: true };
  if (setting('smtp_verify_off') === '1' || dailyUsed() >= (+setting('smtp_verify_daily') || 400)) { todo.forEach(e => results[e] = 'unknown'); return { results, error: 'sınır/kapalı' }; }
  const now = Date.now(); if (now - minute.t > 60e3) minute = { t: now, n: 0 };
  if (minute.n >= 20) { todo.forEach(e => results[e] = 'unknown'); return { results, error: 'dakika sınırı' }; }
  const wait = 60e3 - (now - (lastDomain[domain] || 0)); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastDomain[domain] = Date.now(); minute.n++;
  let mx; try { mx = await mxOf(domain); } catch { todo.forEach(e => { results[e] = 'invalid'; run('INSERT OR REPLACE INTO smtp_checks(email,result,code,msg) VALUES(?,?,?,?)', e, 'invalid', 0, 'MX yok'); }); return { results, error: 'MX yok' }; }
  const dom = get("SELECT * FROM smtp_domains WHERE domain=? AND checked>=datetime('now','-30 day')", domain);
  const fake = `zz${crypto.randomBytes(5).toString('hex')}@${domain}`;
  const r = await probe(mx, dom ? todo : [...todo, fake]);
  if (r.error && !r.out.length) { todo.forEach(e => results[e] = 'unknown'); return { results, error: r.error }; }
  // Microsoft vb. bağlantı başına tek alıcıya izin verir (452 "too many recipients"): kalanları tek tek, ayrı bağlantıda sor
  for (const x of r.out.filter(o => o.code === 452 || /too many recipients/i.test(o.msg))) {
    await new Promise(z => setTimeout(z, 2500));
    const one = await probe(mx, [x.to]);
    if (one.out[0]) Object.assign(x, one.out[0]);
  }
  let catchAll = dom ? !!dom.catch_all : null;
  const f = r.out.find(x => x.to === fake);
  // catch-all kararı sadece net cevapta: 2xx → herkesi kabul ediyor, 5xx → gerçekten kontrol ediyor; 4xx/cevapsız → bilinmiyor
  if (f && f.code >= 200 && f.code < 300) catchAll = true; else if (f && f.code >= 500) catchAll = false; else if (f) catchAll = null;
  if (f && catchAll != null) run('INSERT OR REPLACE INTO smtp_domains(domain,catch_all,mx) VALUES(?,?,?)', domain, catchAll ? 1 : 0, mx);
  for (const e of todo) {
    const t = r.out.find(x => x.to === e); let res = 'unknown';
    if (t && t.code >= 200 && t.code < 300) res = catchAll == null ? 'unknown' : catchAll ? 'catch_all' : 'ok';
    else if (t && ([550, 551, 553].includes(t.code) || /5\.1\.1|does not exist|no such user|unknown user|user unknown|not found|invalid recipient|mailbox unavailable/i.test(t.msg))) res = 'invalid';
    results[e] = res;
    if (res !== 'unknown') run('INSERT OR REPLACE INTO smtp_checks(email,result,code,msg) VALUES(?,?,?,?)', e, res, t.code, t.msg);
  }
  return { results, catchAll, mx };
}

module.exports = { verify, verifyMany, dailyUsed };
