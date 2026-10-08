// Hesap sağlık skoru + Google Postmaster Tools.
// Skor (0-100): geri dönüş, spam'e düşme (ısınma ölçümü), ilgisiz yanıt oranı, Gmail hataları; olumlu yanıt küçük artı.
// Günlük ayar: iyi giden kutunun limiti +2 (en çok 40), kötüleşen -3, skoru 50 altı olan kutu durur.
// Postmaster: alan adı itibarı MEDIUM → soğuk gönderim yarıya, LOW/BAD veya şikâyet oranı yüksek → soğuk gönderim durur.
const { all, get, run, setting, setSetting, jsonSetting } = require('./db');
const { event } = require('./notify');

const DAY = 864e5, MAX_CAP = 40;

function compute(s) {
  const since = new Date(Date.now() - 14 * DAY).toISOString();
  const cold = get("SELECT count(*) n, sum(status='geri döndü') b FROM outbox WHERE sender_id=? AND step<100 AND status IN ('gönderildi','geri döndü') AND sent_at>=?", s.id, since);
  const rep = get(`SELECT count(*) n, sum(label='ilgisiz') neg, sum(label IN ('ilgileniyor','soru')) pos FROM replies WHERE sender_id=? AND received_at>=? AND label NOT IN ('otomatik cevap','')`, s.id, since);
  const w = require('./warmup').stats(s.id);
  const errs = get("SELECT count(*) n FROM events WHERE type='error' AND created>=datetime('now','-7 day') AND text LIKE ? AND (text LIKE '%reddedildi%' OR text LIKE '%sınır%' OR text LIKE '%limit%')", '%' + s.email + '%').n;
  const sent = cold.n || 0, bounce = sent ? (cold.b || 0) / sent : 0, spam = w.checked ? w.spam / w.checked : 0;
  const neg = sent ? (rep.neg || 0) / sent : 0, pos = sent ? (rep.pos || 0) / sent : 0;
  let score = 100 - bounce * 800 - spam * 150 - neg * 60 - errs * 15 + Math.min(10, pos * 200);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const reasons = [];
  if (bounce) reasons.push(`geri dönüş %${(bounce * 100).toFixed(1)}`);
  if (w.checked) reasons.push(`gelen kutusu %${w.inbox}`);
  if (rep.neg) reasons.push(`${rep.neg} ilgisiz yanıt`);
  if (errs) reasons.push(`${errs} Gmail hatası`);
  if (rep.pos) reasons.push(`${rep.pos} olumlu yanıt`);
  return { score, sent, bounces: cold.b || 0, warm: w, neg: rep.neg || 0, pos: rep.pos || 0, errors: errs, little: sent < 10 && w.checked < 5, reasons };
}
function refreshAll() {
  for (const s of all('SELECT * FROM senders')) { const h = compute(s); run('UPDATE senders SET health=?, health_json=? WHERE id=?', h.score, JSON.stringify(h), s.id); }
}
// Günde bir kez: limitleri skora göre ayarla
function dailyAdjust() {
  refreshAll();
  for (const s of all('SELECT * FROM senders WHERE active=1')) {
    const h = JSON.parse(s.health_json || '{}');
    const sent7 = get("SELECT count(*) n FROM outbox WHERE sender_id=? AND step<100 AND status='gönderildi' AND sent_at>=?", s.id, new Date(Date.now() - 7 * DAY).toISOString()).n;
    if (h.score < 50 && !h.little) {
      run("UPDATE senders SET active=0, note=? WHERE id=?", `sağlık skoru ${h.score}: ${h.reasons.join(', ')}`, s.id);
      event('error', `🛡️ ${s.email} durduruldu — sağlık skoru ${h.score} (${h.reasons.join(', ')}). Diğer kutular devam ediyor.`);
    } else if (h.score < 70 && !h.little) {
      const d = Math.max(5, s.daily - 3); if (d !== s.daily) { run('UPDATE senders SET daily=? WHERE id=?', d, s.id); event('limit', `🛡️ ${s.email} yavaşlatıldı: limit ${s.daily}→${d} (skor ${h.score})`); }
    } else if (h.score >= 85 && sent7 >= 15 && !h.bounces && (h.warm.inbox === null || h.warm.inbox >= 90)) {
      const d = Math.min(MAX_CAP, s.daily + 2); if (d !== s.daily) { run('UPDATE senders SET daily=? WHERE id=?', d, s.id); event('info', `📈 ${s.email} iyi gidiyor: limit ${s.daily}→${d} (skor ${h.score})`); }
    }
  }
}
// Soğuk gönderim çarpanı (mailer.senderDaily kullanır)
function capFactor(s) {
  const pm = postmasterGate();
  if (pm === 0) return 0;
  const sc = s.health ?? 100;
  return (sc < 50 ? 0 : sc < 70 ? 0.5 : 1) * pm;
}

// ---------------- Google Postmaster Tools (OAuth) ----------------
const REDIRECT = () => (setting('public_url') || 'https://lead.hypevisionlab.com') + '/api/postmaster/callback';
function authUrl(state) {
  const id = setting('pm_client_id'); if (!id) throw Object.assign(new Error('Önce Google OAuth Client ID / Secret gir'), { status: 400 });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: id, redirect_uri: REDIRECT(), response_type: 'code',
    scope: 'https://www.googleapis.com/auth/postmaster.readonly', access_type: 'offline', prompt: 'consent', state });
}
async function exchange(code) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: setting('pm_client_id'), client_secret: setting('pm_client_secret'), redirect_uri: REDIRECT(), grant_type: 'authorization_code' }) });
  const j = await r.json(); if (!j.refresh_token) throw new Error('Google: ' + (j.error_description || j.error || 'refresh token alınamadı'));
  setSetting('pm_refresh', j.refresh_token);
}
async function token() {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: setting('pm_refresh'), client_id: setting('pm_client_id'), client_secret: setting('pm_client_secret'), grant_type: 'refresh_token' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('Google: ' + (j.error_description || j.error)); return j.access_token;
}
async function fetchPostmaster() {
  if (!setting('pm_refresh')) return null;
  const at = await token(), h = { Authorization: 'Bearer ' + at };
  const doms = (await (await fetch('https://gmailpostmastertools.googleapis.com/v1/domains', { headers: h })).json()).domains || [];
  const out = { t: Date.now(), domains: [] };
  for (const d of doms) {
    const name = d.name.replace('domains/', '');
    const st = (await (await fetch(`https://gmailpostmastertools.googleapis.com/v1/${d.name}/trafficStats?pageSize=14`, { headers: h })).json()).trafficStats || [];
    st.sort((a, b) => b.name.localeCompare(a.name));
    const last = st[0] || {};
    out.domains.push({ name, permission: d.permission, date: (last.name || '').split('/').pop(), reputation: last.domainReputation || null,
      spam: last.userReportedSpamRatio ?? null, spf: last.spfSuccessRatio ?? null, dkim: last.dkimSuccessRatio ?? null, dmarc: last.dmarcSuccessRatio ?? null,
      history: st.map(x => ({ date: x.name.split('/').pop(), rep: x.domainReputation || null, spam: x.userReportedSpamRatio ?? null })) });
  }
  const prev = jsonSetting('pm_last', {});
  setSetting('pm_last', JSON.stringify(out));
  // durum değiştiyse bildir
  for (const d of out.domains) {
    const old = (prev.domains || []).find(x => x.name === d.name);
    if (d.reputation && old?.reputation !== d.reputation) event(['LOW', 'BAD'].includes(d.reputation) ? 'error' : 'info', `📮 Postmaster: ${d.name} itibarı ${d.reputation}${['LOW', 'BAD'].includes(d.reputation) ? ' — SOĞUK GÖNDERİM DURDURULDU' : d.reputation === 'MEDIUM' ? ' — gönderim yarıya indirildi' : ''}`);
  }
  return out;
}
// 1 = normal, 0.5 = yavaş, 0 = dur. Veri yoksa (düşük hacimde Postmaster veri göstermez) normal.
function postmasterGate() {
  const p = jsonSetting('pm_last', {}); let g = 1;
  for (const d of p.domains || []) {
    if (['LOW', 'BAD'].includes(d.reputation) || (d.spam ?? 0) > 0.003) return 0;
    if (d.reputation === 'MEDIUM' || (d.spam ?? 0) > 0.001) g = 0.5;
  }
  return g;
}

let lastDay = '';
async function tick() {
  try {
    refreshAll();
    const day = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), h = new Date(Date.now() + 3 * 3600e3).getUTCHours();
    if (h >= 7 && lastDay !== day && setting('health_adjusted') !== day) { setSetting('health_adjusted', day); lastDay = day; dailyAdjust(); try { await fetchPostmaster(); } catch (e) { console.error('postmaster', e.message); } }
  } catch (e) { console.error('health', e.message); }
}
function start() { setInterval(tick, 30 * 60e3); setTimeout(tick, 45e3); }

module.exports = { start, compute, refreshAll, dailyAdjust, capFactor, postmasterGate, authUrl, exchange, fetchPostmaster, REDIRECT };
