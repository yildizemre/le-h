// Arka plan kuyruğu: AI firma bulma, firmada kişi arama, mail lookup, AI taslak + Excel toplu işleri
const { all, get, run } = require('./db');
const rr = require('./rr');
const ai = require('./ai');
const { event } = require('./notify');
const mailer = require('./mailer');

const LIMIT_OF = { lookup: 'lookup', company_people: 'arama', manual_find: 'lookup' };

function enqueue(type, payload, campaign_id = null, user_id = null) {
  // Aynı işi iki kez kuyruğa koyma
  const p = JSON.stringify(payload);
  if (get("SELECT 1 FROM tasks WHERE type=? AND payload=? AND status IN ('sırada','çalışıyor')", type, p)) return 0;
  return Number(run('INSERT INTO tasks(type,payload,campaign_id,user_id) VALUES(?,?,?,?)', type, p, campaign_id, user_id).lastInsertRowid);
}

function setStage(campaign_id, contact_id, stage) {
  if (campaign_id) run('UPDATE leads SET stage=? WHERE campaign_id=? AND contact_id=?', stage, campaign_id, contact_id);
}

async function draftFor(campaign_id, contact_id, user_id, autoSend) {
  const c = get('SELECT * FROM contacts WHERE id=?', contact_id), camp = get('SELECT * FROM campaigns WHERE id=?', campaign_id);
  if (!c?.email || !camp) return 'mail yok';
  if (get("SELECT 1 FROM outbox WHERE campaign_id=? AND contact_id=? AND step=0 AND status<>'iptal'", campaign_id, contact_id)) return 'zaten var';
  if (mailer.suppressed(c)) { setStage(campaign_id, contact_id, 'engelli'); return 'engel listesinde'; }
  const d = await ai.draftEmail(camp, c, 0);
  run('INSERT INTO outbox(campaign_id,contact_id,step,to_email,subject,body,status,user_id) VALUES(?,?,0,?,?,?,?,?)',
    campaign_id, contact_id, c.email, d.subject, d.body, autoSend ? 'sırada' : 'taslak', user_id);
  setStage(campaign_id, contact_id, autoSend ? 'sırada' : 'taslak');
  return 'taslak hazır';
}

const HANDLERS = {
  async ai_companies(t, p) {
    const camp = get('SELECT * FROM campaigns WHERE id=?', t.campaign_id); if (!camp) return 'kampanya yok';
    const exclude = all('SELECT domain FROM companies WHERE campaign_id=?', camp.id).map(r => r.domain);
    const own = (ai.project().website || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*/, '');
    const list = await ai.findCompanies(camp, p.count || 20, [...exclude, own, ...String(ai.project().competitors || '').split(',').map(s => s.trim())]);
    let added = 0;
    for (const x of list) {
      const domain = String(x.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
      if (!domain || domain === own) continue;
      if (get("SELECT 1 FROM suppress WHERE type='domain' AND value=?", domain)) continue;
      const r = run('INSERT OR IGNORE INTO companies(campaign_id,name,domain,city,sector,size,reason,score) VALUES(?,?,?,?,?,?,?,?)',
        camp.id, x.name, domain, x.city || '', x.sector || '', String(x.size || ''), x.reason || '', +x.score || 0);
      if (r.changes) { added++; if (p.people) enqueue('company_people', { company_id: Number(r.lastInsertRowid) }, camp.id, t.user_id); }
    }
    event('company', `${camp.name}: AI ${added} yeni firma buldu`, camp.id);
    return `${added} firma eklendi`;
  },

  async company_people(t, p) {
    const co = get('SELECT * FROM companies WHERE id=?', p.company_id); if (!co) return 'firma yok';
    const camp = get('SELECT * FROM campaigns WHERE id=?', co.campaign_id);
    let titles = ai.list(camp?.titles);
    if (!titles.length && camp) { // unvan listesi yoksa AI'dan üret
      const s = await ai.suggestCampaign(camp.brief || camp.name).catch(() => ({}));
      titles = s.titles || []; run('UPDATE campaigns SET titles=? WHERE id=?', JSON.stringify(titles), camp.id);
    }
    run("UPDATE companies SET status='kişi aranıyor' WHERE id=?", co.id);
    let profiles = [];
    // Arama kotası kıt (saatte 50, günde 500): önce unvan filtresiyle, bulamazsa sadece alan adıyla
    const tries = [titles.length && { company_domain: [co.domain], current_title: titles }, { company_domain: [co.domain] }].filter(Boolean);
    for (const q of tries) {
      const r = await rr.search(q, 1, p.max || 5);
      profiles = r.profiles || []; if (profiles.length) break;
    }
    for (const x of profiles) {
      const cid = rr.saveCandidate(x, t.user_id, 'kampanya: ' + (camp?.name || ''));
      const ins = run('INSERT OR IGNORE INTO leads(campaign_id,contact_id,company_id,stage) VALUES(?,?,?,?)', co.campaign_id, cid, co.id, 'aday');
      const c = get('SELECT email FROM contacts WHERE id=?', cid);
      if (ins.changes && c.email) setStage(co.campaign_id, cid, 'mail var');
      else if (ins.changes && camp?.auto_lookup) enqueue('lookup', { contact_id: cid }, co.campaign_id, t.user_id);
    }
    run('UPDATE companies SET status=?, people=(SELECT count(*) FROM leads WHERE company_id=?) WHERE id=?', profiles.length ? 'kişi bulundu' : 'kişi yok', co.id, co.id);
    if (profiles.length) event('found', `${co.name}: ${profiles.length} kişi bulundu (${profiles.map(x => x.name).slice(0, 3).join(', ')}${profiles.length > 3 ? '…' : ''})`, co.campaign_id);
    return `${profiles.length} kişi`;
  },

  async lookup(t, p) {
    const c = get('SELECT * FROM contacts WHERE id=?', p.contact_id); if (!c) return 'kişi yok';
    setStage(t.campaign_id, c.id, 'mail aranıyor');
    let prof = null;
    if (c.rr_id) prof = await rr.lookup({ id: c.rr_id });
    else if (c.linkedin) prof = await rr.lookup({ linkedin_url: c.linkedin });
    if (prof) rr.saveContact(prof, t.user_id, c.source);
    const n = get('SELECT * FROM contacts WHERE id=?', c.id);
    if (n.email) {
      setStage(t.campaign_id, c.id, 'mail var');
      event('found', `Mail bulundu: ${n.name} — ${n.title} @ ${n.company}\n${n.email}`, t.campaign_id);
      const camp = t.campaign_id && get('SELECT * FROM campaigns WHERE id=?', t.campaign_id);
      if (camp?.auto_draft || camp?.auto_send) enqueue('draft', { contact_id: c.id, send: !!camp.auto_send }, t.campaign_id, t.user_id);
      return 'mail: ' + n.email;
    }
    if (n.status === 'mail bekleniyor') { setStage(t.campaign_id, c.id, 'mail bekleniyor'); return 'RocketReach hazırlıyor, 5 dk içinde kontrol edilecek'; }
    if (n.status === 'aday') run("UPDATE contacts SET status='mail yok' WHERE id=?", c.id);
    setStage(t.campaign_id, c.id, 'mail yok');
    return 'mail yok';
  },

  async manual_find(t, p) {
    const r = await rr.findPerson(p, t.user_id, 'kuyruk');
    if (r.contact_id) {
      const n = get('SELECT * FROM contacts WHERE id=?', r.contact_id);
      if (t.campaign_id) run('INSERT OR IGNORE INTO leads(campaign_id,contact_id,stage) VALUES(?,?,?)', t.campaign_id, r.contact_id, n.email ? 'mail var' : 'mail yok');
      if (n.email) event('found', `Mail bulundu: ${n.name} @ ${n.company}\n${n.email}`, t.campaign_id);
    }
    return r.status;
  },

  async draft(t, p) { return draftFor(t.campaign_id, p.contact_id, t.user_id, p.send); },
};

let busy = false;
async function loop() {
  if (busy) return; busy = true;
  try {
    for (let n = 0; n < 50; n++) {
      const blocked = Object.entries(LIMIT_OF).filter(([, w]) => rr.remaining(w) > 0).map(([k]) => k);
      const t = get(`SELECT * FROM tasks WHERE status='sırada' ${blocked.length ? `AND type NOT IN (${blocked.map(() => '?').join(',')})` : ''} ORDER BY
        CASE type WHEN 'ai_companies' THEN 0 WHEN 'draft' THEN 1 WHEN 'company_people' THEN 2 ELSE 3 END, id LIMIT 1`, ...blocked);
      if (!t) break;
      run("UPDATE tasks SET status='çalışıyor' WHERE id=?", t.id);
      try {
        const res = await HANDLERS[t.type](t, JSON.parse(t.payload || '{}'));
        run("UPDATE tasks SET status='bitti', result=?, done_at=CURRENT_TIMESTAMP WHERE id=?", String(res ?? ''), t.id);
      } catch (e) {
        if (e instanceof rr.Throttled) {
          run("UPDATE tasks SET status='sırada', result=? WHERE id=?", e.message, t.id);
          if (!limitNotified[e.what] || Date.now() - limitNotified[e.what] > 3600e3) { limitNotified[e.what] = Date.now(); event('limit', e.message); }
        } else run("UPDATE tasks SET status='hata', result=?, done_at=CURRENT_TIMESTAMP WHERE id=?", e.message.slice(0, 300), t.id);
      }
    }
  } finally { busy = false; }
}
const limitNotified = {};

// ---- Excel toplu işleri ----
let jobBusy = false;
async function jobLoop() {
  if (jobBusy) return; jobBusy = true;
  try {
    for (;;) {
      const j = get("SELECT * FROM jobs WHERE state IN ('queued','running','paused') ORDER BY id LIMIT 1"); if (!j) break;
      if (rr.remaining('lookup') > 0) { run("UPDATE jobs SET state='paused', note=? WHERE id=?", `RocketReach limiti, ~${Math.ceil(rr.remaining('lookup') / 60)} dk sonra devam`, j.id); break; }
      run("UPDATE jobs SET state='running', note='' WHERE id=?", j.id);
      const row = get("SELECT * FROM job_rows WHERE job_id=? AND status='' ORDER BY idx LIMIT 1", j.id);
      if (!row) {
        run("UPDATE jobs SET state='done' WHERE id=?", j.id);
        event('job', `Excel işi bitti: ${j.file} — ${get('SELECT found FROM jobs WHERE id=?', j.id).found}/${j.total} mail bulundu`);
        continue;
      }
      const q = JSON.parse(row.q); let r;
      if (!q.name && !q.linkedin) r = { status: 'atlandı' };
      else try { r = await rr.findPerson(q, j.user_id, 'excel: ' + j.file); }
      catch (e) {
        if (e instanceof rr.Throttled) { run("UPDATE jobs SET state='paused', note=? WHERE id=?", e.message, j.id); break; }
        r = { status: 'hata: ' + e.message.slice(0, 120) };
      }
      run('UPDATE job_rows SET status=?, contact_id=? WHERE job_id=? AND idx=?', r.status + (r.match ? ` (${r.match})` : ''), r.contact_id || null, j.id, row.idx);
      if (r.contact_id) { const c = get('SELECT * FROM contacts WHERE id=?', r.contact_id); if (c.email) event('found', `Mail bulundu (Excel): ${c.name} @ ${c.company}\n${c.email}`); }
      run(`UPDATE jobs SET done=(SELECT count(*) FROM job_rows WHERE job_id=? AND status<>''),
        found=(SELECT count(*) FROM job_rows r JOIN contacts c ON c.id=r.contact_id WHERE r.job_id=? AND c.email<>'') WHERE id=?`, j.id, j.id, j.id);
      if (get('SELECT state FROM jobs WHERE id=?', j.id)?.state === 'cancelled') continue;
    }
  } catch (e) { console.error('job', e.message); }
  finally { jobBusy = false; }
}

// 'mail bekleniyor' kişileri tek çağrıda kontrol et, sonuçları kampanyalara yansıt
async function pendingLoop() {
  try {
    const done = await rr.refreshPending();
    for (const id of done) {
      const n = get('SELECT * FROM contacts WHERE id=?', id);
      for (const l of all('SELECT * FROM leads WHERE contact_id=?', id)) {
        setStage(l.campaign_id, id, n.email ? 'mail var' : 'mail yok');
        const camp = get('SELECT * FROM campaigns WHERE id=?', l.campaign_id);
        if (n.email && (camp?.auto_draft || camp?.auto_send)) enqueue('draft', { contact_id: id, send: !!camp.auto_send }, l.campaign_id, camp.user_id);
      }
      if (n.email) event('found', `Mail bulundu: ${n.name} — ${n.title} @ ${n.company}
${n.email}`);
    }
    for (const j of all("SELECT DISTINCT job_id FROM job_rows r JOIN contacts c ON c.id=r.contact_id WHERE r.status LIKE 'mail bekleniyor%' AND c.status<>'mail bekleniyor'")) {
      run(`UPDATE job_rows SET status=(SELECT CASE WHEN c.email<>'' THEN 'mail bulundu' ELSE 'mail yok' END FROM contacts c WHERE c.id=job_rows.contact_id)
        WHERE job_id=? AND status LIKE 'mail bekleniyor%' AND contact_id IN (SELECT id FROM contacts WHERE status<>'mail bekleniyor')`, j.job_id);
      run(`UPDATE jobs SET found=(SELECT count(*) FROM job_rows r JOIN contacts c ON c.id=r.contact_id WHERE r.job_id=? AND c.email<>'') WHERE id=?`, j.job_id, j.job_id);
    }
  } catch (e) { if (!(e instanceof rr.Throttled)) console.error('pending', e.message); }
}

function start() {
  setInterval(pendingLoop, 5 * 60e3); setTimeout(pendingLoop, 20e3);
  run("UPDATE tasks SET status='sırada' WHERE status='çalışıyor'");
  run("UPDATE jobs SET state='queued' WHERE state='running'");
  setInterval(loop, 5000); setInterval(jobLoop, 15000); setTimeout(loop, 1500); setTimeout(jobLoop, 2500);
}

module.exports = { start, pendingLoop, enqueue, loop, jobLoop, draftFor };
