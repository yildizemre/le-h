// Arka plan kuyruğu: AI firma bulma, firmada kişi arama, mail lookup, AI taslak + Excel toplu işleri
const { all, get, run } = require('./db');
const rr = require('./rr');
const ai = require('./ai');
const { event } = require('./notify');
const mailer = require('./mailer');
const guess = require('./emailguess');

const fold = s => String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
const SENIOR = [[/genel mudur|general manager|ceo|chief executive|managing director|country manager|kurucu|founder|owner|sahibi/, 30],
  [/fabrika mudur|plant manager|plant director|tesis mudur|site manager|operations director|operasyon direktor/, 26],
  [/direktor|director|head of|vp |vice president|bas(ka)?n/, 20], [/mudur|manager|sef|chief|lead|lider/, 12], [/uzman|specialist|engineer|muhendis/, 4]];
const JUNIOR = /stajyer|intern|asistan|assistant|teknisyen|technician|operator|isci|student|ogrenci/;
// Hedef birim filtresi: sadece yönetim / üretim / kalite / İSG / bakım-tesis / operasyon. Muhasebe, İK, satış vb. hiç alınmaz.
const ROLE_DEF = {
  allow: ['genel müdür', 'general manager', 'ceo', 'coo', 'managing director', 'kurucu', 'founder', 'owner', 'sahibi', 'yönetim kurulu', 'board member', 'ortak', 'partner',
    'fabrika', 'plant', 'tesis', 'site manager', 'üretim', 'production', 'manufacturing', 'imalat', 'operasyon', 'operations', 'kalite', 'quality', 'qhse', 'qa ', 'qc ',
    'isg', 'iş güvenliği', 'is guvenligi', 'iş sağlığı', 'hse', 'ehs', 'shes', 'safety', 'çevre', 'environment', 'bakım', 'maintenance', 'teknik müdür', 'technical director',
    'teknik direktör', 'mühendislik müdürü', 'engineering manager', 'proses', 'process', 'endüstri mühendis', 'industrial engineer', 'lean', 'yalın', 'sürekli iyileştirme', 'continuous improvement', 'depo', 'warehouse', 'lojistik müdürü', 'supply chain director'],
  block: ['muhasebe', 'accounting', 'accountant', 'finans', 'finance', 'financial', 'mali işler', 'mali müşavir', 'cfo', 'controller', 'bütçe', 'treasury', 'vergi', 'tax',
    'insan kaynakları', 'human resources', ' hr', 'hr ', 'ik müdür', 'işe alım', 'recruit', 'talent', 'bordro', 'payroll', 'satış', 'sales', 'pazarlama', 'marketing', 'ihracat', 'export',
    'dış ticaret', 'foreign trade', 'müşteri', 'customer', 'key account', 'business development', 'iş geliştirme', 'satın alma', 'satınalma', 'purchasing', 'procurement', 'buyer',
    'hukuk', 'legal', 'avukat', 'lawyer', 'bilgi işlem', 'bilgi teknolojileri', 'information technology', 'it manager', 'it müdür', 'yazılım', 'software', 'developer', 'sistem yöneticisi',
    'kurumsal iletişim', 'corporate communication', 'halkla ilişkiler', 'public relations', 'sekreter', 'secretary', 'resepsiyon', 'receptionist', 'stajyer', 'intern', 'öğrenci', 'student'],
  // "asistan", "tasarım", "ar-ge" gibi kelimeler yasak değil: unvanda izinli birim yoksa kişi zaten alınmaz,
  // varsa ("Assistant Production Manager", "Tasarım ve İmalat Müdürü") alınır.
};
// Üretici olmayan (rakip / tedarikçi / hizmet) firmalar: normal kampanyalarda hiç listelenmez
const NOT_PRODUCER = /g[oö]r[uü]nt[uü] i[sş]leme|computer vision|machine vision|yapay zeka|artificial intelligence|\bai\b|video anali|kamera sistem|camera system|cctv|g[uü]venlik sistem|security system|guvenlik kamera|elektronik g[uü]venlik|entegrat[oö]r|integrator|sistem entegr|yaz[iı]l[iı]m|software|\bsaas\b|bili[sş]im|it hizmet|dan[iı][sş]manl[iı]k|consult|distrib[uü]t|bayi|dealer|osgb|ortak sa[gğ]l[iı]k|isg hizmet/i;
const notProducer = (x, domain = '') => NOT_PRODUCER.test([x.name, x.sector, x.reason, domain].join(' '));

const roleCfg = () => { try { return { ...ROLE_DEF, ...JSON.parse(require('./db').setting('role_filter') || '{}') }; } catch { return ROLE_DEF; } };
function roleOk(title, cfg = roleCfg()) {
  const t = ' ' + fold(title) + ' ';
  if (!t.trim()) return false;
  if (cfg.block.some(k => k.trim() && t.includes(fold(k)))) return false;
  return cfg.allow.some(k => k.trim() && t.includes(fold(k)));
}

// Rol grubu: aynı firmadan farklı birimlerden kişi seçmek için (İSG + üretim/fabrika + kalite + yönetim)
const GROUP = t => /isg|is guvenligi|hse|ehs|shes|safety|cevre|environment/.test(t) ? 'safety' : /kalite|quality|qhse|qa |qc /.test(t) ? 'quality'
  : /fabrika|plant|tesis|site manager|uretim|production|manufacturing|imalat|operasyon|operations|bakim|maintenance|depo|warehouse/.test(t) ? 'ops' : 'mgmt';
// Firmadan en uygun N kişi: önce her rol grubundan en iyisi, sonra kalan en yüksek puanlılar
function bestPeople(list, titles, n = 1) {
  const cfg = roleCfg(), seen = new Set();
  list = list.filter(x => roleOk(x.current_title, cfg) && x.id && !seen.has(x.id) && seen.add(x.id));
  if (!list.length) return [];
  const ranked = list.map(x => [scoreOf(x, titles), x]).sort((a, b) => b[0] - a[0]).map(r => r[1]);
  const out = [], groups = new Set();
  for (const x of ranked) { const g = GROUP(' ' + fold(x.current_title) + ' '); if (out.length < n && !groups.has(g)) { out.push(x); groups.add(g); } }
  for (const x of ranked) if (out.length < n && !out.includes(x)) out.push(x);
  return out;
}
function scoreOf(x, titles) {
  const tl = titles.map(fold);
  const score = x => {
    const t = fold(x.current_title);
    let s = 0;
    const i = tl.findIndex(k => k && t.includes(k)); if (i >= 0) s += 40 - Math.min(i, 20);
    for (const [re, v] of SENIOR) if (re.test(t)) { s += v; break; }
    if (JUNIOR.test(t)) s -= 40;
    if ((x.teaser?.professional_emails || []).length) s += 6; // maili bulunma ihtimali yüksek
    if (x.linkedin_url) s += 2;
    return s;
  };
  return score(x);
}
const peoplePerCompany = () => Math.max(1, Math.min(5, +require('./db').setting('people_per_company') || 3));
const LOOKED = ['mail yok', 'bulunamadı', 'mail bekleniyor', 'geçersiz mail'];
const LIMIT_OF = { lookup: 'lookup', company_people: 'arama', manual_find: 'lookup', rr_people: 'arama' };

function enqueue(type, payload, campaign_id = null, user_id = null) {
  // Aynı işi iki kez kuyruğa koyma
  const p = JSON.stringify(payload);
  if (get("SELECT 1 FROM tasks WHERE type=? AND payload=? AND status IN ('sırada','çalışıyor')", type, p)) return 0;
  if (payload.contact_id && get("SELECT 1 FROM tasks WHERE type=? AND status IN ('sırada','çalışıyor','rr bekliyor') AND json_extract(payload,'$.contact_id')=?", type, payload.contact_id)) return 0;
  if (payload.company_id && get("SELECT 1 FROM tasks WHERE type=? AND status IN ('sırada','çalışıyor') AND json_extract(payload,'$.company_id')=?", type, payload.company_id)) return 0;
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
    const minDate = Date.now() - 180 * 864e5; // 6 aydan eski haber "şimdi yaz" sinyali değildir
    const hot = [];
    for (const x of list) {
      if (x.date && Date.parse(x.date) < minDate) continue;
      if ((+x.score || 0) < 5) continue; // zayıf sinyalleri hiç kaydetme
      const domain = String(x.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
      if (!domain || domain === own) continue;
      if (camp.kind !== 'partner' && notProducer(x, domain)) continue; // görüntü işleme / CCTV / yazılım / entegratör firmalarını alma
      if (get("SELECT 1 FROM suppress WHERE type='domain' AND value=?", domain)) continue;
      const r = run('INSERT OR IGNORE INTO companies(campaign_id,name,domain,city,sector,size,reason,score,phone,gen_email,kind) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        camp.id, x.name, domain, x.city || '', x.sector || '', String(x.size || ''), x.reason || '', +x.score || 0, String(x.phone || '').trim(), String(x.email || '').trim().toLowerCase(), camp.kind || '');
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
    // Firmada zaten bir kişi varsa tekrar arama (kota israfı + aynı firmaya çoklu mail)
    const have = get('SELECT count(*) n, max(c.name) name FROM leads l JOIN contacts c ON c.id=l.contact_id WHERE l.company_id=?', co.id);
    if (have.n && !p.more) { run("UPDATE companies SET status='kişi bulundu', people=? WHERE id=?", have.n, co.id); return 'zaten kişi var: ' + have.name; }
    run("UPDATE companies SET status='kişi aranıyor' WHERE id=?", co.id);
    let profiles = [];
    // Arama kotası kıt (saatte 50, günde 500): önce unvan filtresiyle, bulamazsa sadece alan adıyla
    const tries = [titles.length && { company_domain: [co.domain], current_title: titles }, { company_domain: [co.domain] }].filter(Boolean);
    // Firma başına en uygun N kişi (varsayılan 3, farklı rol gruplarından); izinli birim (yönetim/üretim/kalite/İSG…) dışından kimse alınmaz.
    // Aynı firmaya günde en fazla 1 mail kuralı (schedule.per_domain) geçerli: kişiler farklı günlerde yazılır.
    const want = peoplePerCompany(); let seen = 0;
    for (const q of tries) {
      const r = await rr.search(q, 1, 25);
      seen += (r.profiles || []).length;
      profiles = bestPeople([...profiles, ...(r.profiles || [])], titles, want); if (profiles.length) break; // 2. arama sadece hiç kimse çıkmazsa (arama kotası kıt)
    }
    for (const x of profiles) {
      const cid = rr.saveCandidate(x, t.user_id, 'kampanya: ' + (camp?.name || ''));
      const ins = run('INSERT OR IGNORE INTO leads(campaign_id,contact_id,company_id,stage) VALUES(?,?,?,?)', co.campaign_id, cid, co.id, 'aday');
      const c = get('SELECT email FROM contacts WHERE id=?', cid);
      if (ins.changes && c.email) setStage(co.campaign_id, cid, 'mail var');
      else if (ins.changes && camp?.auto_lookup) enqueue('lookup', { contact_id: cid }, co.campaign_id, t.user_id);
    }
    run('UPDATE companies SET status=?, people=(SELECT count(*) FROM leads WHERE company_id=?) WHERE id=?', profiles.length ? 'kişi bulundu' : seen ? 'uygun yetkili yok' : 'kişi yok', co.id, co.id);
    // Yedek yol: RocketReach'te uygun kimse yoksa AI firmanın sitesinden/haberlerden yönetici bulsun (mail kalıp+doğrulamayla çıkar)
    if (!profiles.length && camp?.kind !== 'partner' && require('./db').setting('web_people') !== '0') enqueue('web_people', { company_id: co.id }, co.campaign_id, t.user_id);
    if (!profiles.length && seen) return `${seen} kişi var ama hedef birimden (yönetim/üretim/kalite/İSG) kimse yok → web'de aranacak`;
    const who = profiles.map(x => `${x.name} — ${x.current_title || ''}`).join(' · ');
    if (profiles.length) event('found', `${co.name}: ${who}`, co.campaign_id);
    return profiles.length ? who : '0 kişi → web\'de aranacak';
  },

  // Doğrudan RocketReach kişi araması: unvan + ülke + sektör (+ çalışan sayısı) ile tek aramada 25 hedef kişi.
  // Kişiler işverenlerine göre firmalara gruplanır (firma başına en fazla N), mail için normal lookup kuyruğuna girer.
  async rr_people(t, p) {
    const camp = get('SELECT * FROM campaigns WHERE id=?', t.campaign_id); if (!camp || camp.status !== 'aktif') return 'kampanya yok/pasif';
    let q = p.q;
    if (!q) { // ilk sayfa: sorguyu AI ile İngilizce RocketReach filtrelerine çevir, sonraki sayfalar aynı sorguyu kullanır
      const f = await ai.rrFilters(camp);
      const geo = f.country ? [f.country] : [];
      if (!geo.length || /turkey|türkiye/i.test(geo.join(' '))) return 'ülke belirlenemedi';
      q = { current_title: (f.titles || []).slice(0, 15), geo, company_industry: (f.industries || []).slice(0, 6), company_size: ['51-200', '201-500', '501-1000', '1001-5000'] };
    }
    const page = p.page || 1, per = peoplePerCompany();
    let r;
    try { r = await rr.search(q, (page - 1) * 25 + 1, 25); }
    catch (e) { // desteklenmeyen filtre: önce çalışan sayısını, sonra sektörü bırak
      if (e.status !== 400) throw e;
      if (q.company_size) { delete q.company_size; enqueue('rr_people', { ...p, q, page }, t.campaign_id, t.user_id); return 'filtre sadeleştirildi (çalışan sayısı), tekrar denenecek'; }
      if (q.company_industry) { delete q.company_industry; enqueue('rr_people', { ...p, q, page }, t.campaign_id, t.user_id); return 'filtre sadeleştirildi (sektör), tekrar denenecek'; }
      throw e;
    }
    const cfg = roleCfg(); let added = 0, skipped = 0;
    for (const x of r.profiles || []) {
      const dom = String(x.current_employer_domain || '').toLowerCase().replace(/^www\./, '');
      const c0 = { email: '', domain: dom, location: x.location };
      if (!roleOk(x.current_title, cfg) || !x.current_employer || mailer.isTR(c0) || mailer.isBig(c0) || notProducer({ name: x.current_employer, sector: x.current_employer_industry || '' }, dom)) { skipped++; continue; }
      if (get("SELECT 1 FROM contacts c JOIN leads l ON l.contact_id=c.id WHERE c.rr_id=?", x.id)) { skipped++; continue; } // başka kampanyada zaten var
      const key = dom || 'rr:' + fold(x.current_employer).replace(/[^a-z0-9]+/g, '-');
      run("INSERT OR IGNORE INTO companies(campaign_id,name,domain,city,sector,reason,score,status,kind) VALUES(?,?,?,?,?,?,7,'kişi bulundu',?)",
        camp.id, x.current_employer, key, String(x.location || '').split(',')[0], x.current_employer_industry || camp.sector || '', 'RocketReach doğrudan kişi araması', camp.kind || '');
      const co = get('SELECT id FROM companies WHERE campaign_id=? AND domain=?', camp.id, key);
      if (get('SELECT count(*) n FROM leads WHERE company_id=?', co.id).n >= per) { skipped++; continue; }
      const cid = rr.saveCandidate(x, t.user_id, 'kampanya: ' + camp.name);
      const ins = run('INSERT OR IGNORE INTO leads(campaign_id,contact_id,company_id,stage) VALUES(?,?,?,?)', camp.id, cid, co.id, 'aday');
      run('UPDATE companies SET people=(SELECT count(*) FROM leads WHERE company_id=?) WHERE id=?', co.id, co.id);
      if (!ins.changes) continue;
      added++;
      if (get('SELECT email FROM contacts WHERE id=?', cid)?.email) setStage(camp.id, cid, 'mail var');
      else if (camp.auto_lookup) enqueue('lookup', { contact_id: cid }, camp.id, t.user_id);
    }
    const total = r.pagination?.total || 0, maxPages = +(require('./db').setting('rr_people_pages') || 4);
    // Sonraki sayfa: bu sayfadan kişi çıktıysa ve sonuç bitmediyse
    if (added && page < maxPages && page * 25 < total) enqueue('rr_people', { q, page: page + 1 }, camp.id, t.user_id);
    if (page === 1 && !(r.profiles || []).length && q.company_industry) { delete q.company_industry; enqueue('rr_people', { q, page: 1, relaxed: 1 }, camp.id, t.user_id); }
    if (added) event('found', `${camp.name}: RocketReach doğrudan aramada ${added} yetkili bulundu (sayfa ${page}${total ? '/' + Math.ceil(total / 25) : ''})`, camp.id);
    return `sayfa ${page}: ${added} kişi eklendi, ${skipped} elendi${total ? ' · toplam sonuç ' + total : ''}`;
  },

  // Yedek yol: RocketReach'te kimse yoksa AI web araması (firma sitesi ekip sayfası, haberler, LinkedIn) ile yönetici bul
  async web_people(t, p) {
    const co = get('SELECT * FROM companies WHERE id=?', p.company_id); if (!co) return 'firma yok';
    if (get('SELECT 1 FROM leads WHERE company_id=?', co.id)) return 'firmada zaten kişi var';
    if (!co.domain || /^rr:/.test(co.domain)) return 'alan adı yok';
    const camp = get('SELECT * FROM campaigns WHERE id=?', co.campaign_id);
    const list = await ai.companyPeople(co, peoplePerCompany());
    const cfg = roleCfg(); let added = 0;
    for (const x of list) {
      if (!x.name || !/\s/.test(x.name.trim()) || !roleOk(x.title, cfg)) continue; // ad + soyad şart, hedef birim dışı alınmaz
      const ex = get('SELECT id FROM contacts WHERE lower(name)=lower(?) AND domain=?', x.name.trim(), co.domain);
      const cid = ex ? ex.id : Number(run("INSERT INTO contacts(name,title,company,domain,location,linkedin,status,source,owner_id,teaser) VALUES(?,?,?,?,?,?,'aday',?,?,-1)",
        x.name.trim(), x.title || '', co.name, co.domain, co.city || '', /linkedin\.com\/in\//.test(x.linkedin || '') ? x.linkedin : '', 'web: ' + (x.source || 'AI').slice(0, 120), t.user_id).lastInsertRowid);
      const ins = run('INSERT OR IGNORE INTO leads(campaign_id,contact_id,company_id,stage) VALUES(?,?,?,?)', co.campaign_id, cid, co.id, 'aday');
      if (ins.changes) { added++; if (camp?.auto_lookup) enqueue('lookup', { contact_id: cid }, co.campaign_id, t.user_id); }
    }
    run('UPDATE companies SET status=?, people=(SELECT count(*) FROM leads WHERE company_id=?) WHERE id=?', added ? 'kişi bulundu' : 'kişi yok', co.id, co.id);
    if (added) event('found', `${co.name}: web'de ${added} yetkili bulundu (${list.slice(0, 3).map(x => x.name + ' — ' + (x.title || '')).join(' · ')})`, co.campaign_id);
    return added ? `web: ${added} kişi` : 'web: bulunamadı';
  },

  async lookup(t, p) {
    const c = get('SELECT * FROM contacts WHERE id=?', p.contact_id); if (!c) return 'kişi yok';
    // Başka bir işte mail bulunmuş ya da zaten sorgulanmışsa RocketReach'e tekrar gitme
    if (c.email && c.status !== 'mail tahmini') { setStage(t.campaign_id, c.id, 'mail var'); return 'zaten maili var: ' + c.email; }
    if (LOOKED.includes(c.status) && !p.force) { setStage(t.campaign_id, c.id, c.status === 'mail bekleniyor' ? 'mail bekleniyor' : 'mail yok'); return 'daha önce sorgulandı (' + c.status + ')'; }

    // 1) Önce kalıp + doğrulama (MillionVerifier): RocketReach mail kotası harcanmaz
    const mode = require('./db').setting('mail_source') || 'guess_rr'; // guess_rr | guess | rr
    if (mode !== 'rr' && require('./db').setting('mv_key') && c.status !== 'mail tahmini' && !/"guess":"none"/.test(c.email_check || '')) {
      let dom = c.domain || get('SELECT co.domain FROM leads l JOIN companies co ON co.id=l.company_id WHERE l.contact_id=? LIMIT 1', c.id)?.domain;
      if (/^rr:/.test(dom || '')) dom = ''; // işvereni alan adsız (RocketReach doğrudan arama): kalıp tahmini yapılamaz, RR lookup'a geç
      if (dom) {
        setStage(t.campaign_id, c.id, 'mail aranıyor');
        const g = await guess.findEmail(c, dom).catch(e => ({ status: 'none', err: e.message }));
        if (g.status === 'ok') {
          run("UPDATE contacts SET email=?, emails=?, status='mail var', email_check='', updated=CURRENT_TIMESTAMP WHERE id=?", g.email,
            JSON.stringify([{ email: g.email, type: 'professional', grade: 'A', valid: 'valid', src: 'kalıp+doğrulama' }]), c.id);
          setStage(t.campaign_id, c.id, 'mail var');
          event('found', `Mail bulundu (kalıp+doğrulama, RocketReach kotası harcanmadı): ${c.name} — ${c.title} @ ${c.company}\n${g.email}`, t.campaign_id);
          const camp = t.campaign_id && get('SELECT * FROM campaigns WHERE id=?', t.campaign_id);
          if (camp?.auto_draft || camp?.auto_send) enqueue('draft', { contact_id: c.id, send: !!camp.auto_send }, t.campaign_id, t.user_id);
          return 'mail (kalıp+doğrulama): ' + g.email;
        }
        if (g.status === 'catch_all') // sunucu her adresi kabul ediyor: doğrulanamaz, güvenli mod göndermez
          run("UPDATE contacts SET email=?, emails=?, status='mail tahmini', updated=CURRENT_TIMESTAMP WHERE id=?", g.email,
            JSON.stringify([{ email: g.email, type: 'professional', grade: 'B', valid: 'inconclusive', src: 'kalıp (catch-all)' }]), c.id);
        if (g.status === 'none') run('UPDATE contacts SET email_check=? WHERE id=?', JSON.stringify({ guess: 'none', tried: g.tried, t: Date.now() }), c.id); // aynı kişiye tekrar doğrulama ücreti ödeme
        if (mode === 'guess') { setStage(t.campaign_id, c.id, g.status === 'catch_all' ? 'mail tahmini' : 'mail yok'); if (g.status !== 'catch_all') run("UPDATE contacts SET status='mail yok' WHERE id=?", c.id); return g.status === 'catch_all' ? 'tahmin (doğrulanamadı): ' + g.email : 'kalıpla bulunamadı'; }
      }
    }
    if (c.teaser === 0 && !p.force) { // RocketReach aramada iş maili göstermedi → sorgu boşa gider
      run("UPDATE contacts SET status='mail yok' WHERE id=?", c.id); setStage(t.campaign_id, c.id, 'mail yok');
      return 'RocketReach\'te iş maili yok — kota harcanmadı';
    }
    const bud = await rr.lookupBudget();
    if (!bud.ok) { // günlük pay doldu: yarın 08:00'e kadar mail sorgusu yok
      const tm = new Date(); tm.setDate(tm.getDate() + 1); tm.setHours(5, 0, 0, 0);
      rr.block('lookup', tm - Date.now());
      throw new rr.Throttled((tm - Date.now()) / 1000, `günlük bütçe (${bud.today}/${bud.daily}) dolu, lookup`);
    }
    setStage(t.campaign_id, c.id, 'mail aranıyor');
    let prof = null;
    if (c.rr_id) prof = await rr.lookup({ id: c.rr_id });
    else if (c.linkedin) prof = await rr.lookup({ linkedin_url: c.linkedin });
    const guessed = get("SELECT email, emails FROM contacts WHERE id=? AND status='mail tahmini' AND email<>''", c.id);
    if (prof) rr.saveContact(prof, t.user_id, c.source);
    // RocketReach mail vermediyse kalıp tahminini (catch-all) silme: "mail tahmini" olarak kalsın
    if (guessed && !get("SELECT 1 FROM contacts WHERE id=? AND email<>''", c.id)) {
      run("UPDATE contacts SET email=?, emails=?, status='mail tahmini' WHERE id=?", guessed.email, guessed.emails, c.id);
      setStage(t.campaign_id, c.id, 'mail tahmini');
      return 'tahmini (catch-all, doğrulanamadı): ' + guessed.email;
    }
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

  // Firmanın sitesindeki santral telefonu + genel mail
  async company_contact(t, p) {
    const co = get('SELECT * FROM companies WHERE id=?', p.company_id); if (!co) return 'firma yok';
    if (co.phone && !p.force) return 'zaten var: ' + co.phone;
    const r = await ai.companyContact(co);
    run("UPDATE companies SET phone=COALESCE(NULLIF(?,''),phone), gen_email=COALESCE(NULLIF(?,''),gen_email) WHERE id=?", r.phone, r.email, co.id);
    return r.phone || r.email ? [r.phone, r.email].filter(Boolean).join(' · ') : 'bulunamadı';
  },

  // Tetikleyici haber taraması
  async signals(t, p) {
    const camp = get('SELECT * FROM campaigns WHERE id=?', p.campaign_id); if (!camp) return 'kampanya yok';
    const ex = all('SELECT domain FROM companies WHERE campaign_id=? UNION SELECT domain FROM signals WHERE campaign_id=?', camp.id, camp.id).map(r => r.domain).filter(Boolean);
    const list = await ai.signals(camp, ex);
    let n = 0;
    const hot = [], minDate = Date.now() - 180 * 864e5; // 6 aydan eski haber "şimdi yaz" sinyali değildir
    for (const x of list) {
      if (x.date && Date.parse(x.date) < minDate) continue;
      if ((+x.score || 0) < 5) continue; // zayıf sinyalleri kaydetme
      const domain = String(x.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      const ch = run('INSERT OR IGNORE INTO signals(campaign_id,company,domain,city,event,kind,date,url,score,why,angle) VALUES(?,?,?,?,?,?,?,?,?,?,?)', camp.id, x.company, domain, x.city || '', x.event, x.kind || '', x.date || '',
        (String(x.url || '').match(/https?:\/\/[^\s)\]]+/) || [''])[0].replace(/[?&]utm_source=openai/, ''), Math.min(10, +x.score || 0), x.why || '', x.angle || '').changes;
      n += ch; if (ch && +x.score >= 8) hot.push(x);
    }
    if (hot.length) event('company', `🔥 ${hot.length} GÜÇLÜ SİNYAL (${camp.name}):\n` + hot.map(x => `• ${x.company} [${x.score}/10] — ${x.event}\n  → ${x.angle || x.why}`).join('\n'), camp.id);
    else if (n) event('company', `${camp.name}: ${n} yeni sinyal — Sinyaller sayfasına bak`, camp.id);
    return n + ' sinyal';
  },
};

let busy = false;
async function loop() {
  if (busy) return; busy = true;
  try {
    for (let n = 0; n < 50; n++) {
      // Kalıp+doğrulama açıksa mail işleri RocketReach limiti dolu olsa da çalışır (kalıbı dener); limit açılınca "RR bekliyor"lar kuyruğa döner
      const guessOn = !!require('./db').setting('mv_key') && (require('./db').setting('mail_source') || 'guess_rr') !== 'rr';
      if (rr.remaining('lookup') <= 0) run("UPDATE tasks SET status='sırada' WHERE status='rr bekliyor'");
      const blocked = Object.entries(LIMIT_OF).filter(([k, w]) => rr.remaining(w) > 0 && !(k === 'lookup' && guessOn)).map(([k]) => k);
      const t = get(`SELECT * FROM tasks WHERE status='sırada' ${blocked.length ? `AND type NOT IN (${blocked.map(() => '?').join(',')})` : ''}
        AND (campaign_id IS NULL OR campaign_id IN (SELECT id FROM campaigns WHERE status='aktif')) ORDER BY
        CASE type WHEN 'ai_companies' THEN 0 WHEN 'draft' THEN 1 WHEN 'rr_people' THEN 2 WHEN 'company_people' THEN 3 ELSE 4 END,
        CASE WHEN type='lookup' THEN -COALESCE((SELECT max(co.score) FROM leads l JOIN companies co ON co.id=l.company_id WHERE l.contact_id=json_extract(tasks.payload,'$.contact_id')),0) ELSE 0 END, id LIMIT 1`, ...blocked);
      if (!t) break;
      run("UPDATE tasks SET status='çalışıyor' WHERE id=?", t.id);
      try {
        const res = await HANDLERS[t.type](t, JSON.parse(t.payload || '{}'));
        run("UPDATE tasks SET status='bitti', result=?, done_at=CURRENT_TIMESTAMP WHERE id=?", String(res ?? ''), t.id);
      } catch (e) {
        if (e instanceof rr.Throttled) {
          run('UPDATE tasks SET status=?, result=? WHERE id=?', t.type === 'lookup' && guessOn ? 'rr bekliyor' : 'sırada', e.message, t.id);
          if (t.type === 'company_people') run("UPDATE companies SET status='kuyrukta' WHERE id=?", JSON.parse(t.payload).company_id);
          if (!limitNotified[e.what] || Date.now() - limitNotified[e.what] > 3600e3) { limitNotified[e.what] = Date.now(); event('limit', e.message); }
        } else {
          run("UPDATE tasks SET status='hata', result=?, done_at=CURRENT_TIMESTAMP WHERE id=?", e.message.slice(0, 300), t.id);
          if (t.type === 'company_people') run("UPDATE companies SET status='hata' WHERE id=?", JSON.parse(t.payload).company_id);
        }
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

// Hızlı kampanya (panel ve otomatik günlük kampanya ortak kullanır)
async function createQuick(o, userId) {
  let { sector = '', location = '', country = require('./db').setting('intl_only') !== '0' ? '' : 'Türkiye', size = '', note = '', count = 20, people = true, lookup = true, titles = '', kind = '', auto = 0 } = o;
  if (require('./db').setting('intl_only') !== '0' && /t[uü]rkiye|turkey/i.test(country + ' ' + location)) throw Object.assign(new Error('Yurt dışı modu açık: Türkiye için kampanya açılmıyor'), { status: 400 });
  if (country && country !== 'Türkiye') location = [location, country].filter(Boolean).join(', ');
  if (!String(sector).trim() && !String(location).trim()) throw Object.assign(new Error('Sektör veya konumdan en az birini yaz'), { status: 400 });
  const brief = [sector ? sector + ' sektöründeki' : 'Üretim yapan', 'firmalar / fabrikalar', location ? '(' + location + ')' : '', size ? '— ' + size : '', note].filter(Boolean).join(' ');
  let s = {};
  try { s = await ai.suggestCampaign(brief); } catch (e) { console.error('suggest', e.message); }
  const name = o.name || (auto ? '🤖 ' : '') + [sector || 'Fabrikalar', location].filter(Boolean).join(' · ');
  let tl = ai.list(s.titles);
  if (titles) tl = String(titles).split(',').map(x => x.trim()).filter(Boolean).concat(tl);
  if (kind === 'partner') tl = ['Genel Müdür', 'Kurucu', 'Kurucu Ortak', 'İş Geliştirme Müdürü', 'Satış Müdürü', 'Managing Director', 'Founder', 'Business Development'];
  const J = v => JSON.stringify(ai.list(v));
  const id = Number(run(`INSERT INTO campaigns(name,brief,sector,location,geography,size,kind,offer,problem,clients,positive,negative,keywords,roles,titles,auto_lookup,auto,user_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, name, brief, sector, location, location || country || '', size || s.size || '', kind, s.offer || '', s.problem || '',
    J(s.clients), J(s.positive), J(s.negative), J(s.keywords), s.roles || '', JSON.stringify(tl), lookup ? 1 : 0, auto ? 1 : 0, userId).lastInsertRowid);
  const n = Math.min(200, Math.max(5, +count || 20));
  for (let left = n, i = 0; left > 0; left -= 20, i++) enqueue('ai_companies', { count: Math.min(20, left), people: !!people, n: Date.now() + i }, id, userId);
  if (people && kind !== 'partner' && require('./db').setting('rr_direct') !== '0' && mailer.intlOnly()) enqueue('rr_people', { page: 1 }, id, userId);
  loop();
  event('info', `${auto ? '🤖 Otomatik günlük kampanya' : 'Yeni kampanya'}: ${name} — AI ${n} firma arıyor`, id);
  return id;
}

function start() {
  setInterval(pendingLoop, 30 * 60e3); setTimeout(pendingLoop, 60e3);
  run("UPDATE tasks SET status='sırada' WHERE status='çalışıyor'");
  run("UPDATE jobs SET state='queued' WHERE state='running'");
  setInterval(loop, 5000); setInterval(jobLoop, 15000); setTimeout(loop, 1500); setTimeout(jobLoop, 2500);
}

module.exports = { ROLE_DEF, roleCfg, roleOk, notProducer, createQuick, LOOKED, start, pendingLoop, enqueue, loop, jobLoop, draftFor };
