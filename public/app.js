// Lead-AI SPA
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('main');
let ME = null, CAMPS = [];
const sel = new Set(); // Kişilerim'de seçili kişi id'leri

function netDown(on) {
  let b = document.querySelector('.netbar');
  if (on && !b) { b = document.createElement('div'); b.className = 'netbar'; b.textContent = 'Sunucuya ulaşılamıyor — internet bağlantını kontrol et, otomatik tekrar denenecek'; document.body.append(b); }
  if (!on && b) b.remove();
}
async function api(url, opts = {}) {
  const isForm = opts.body instanceof FormData;
  let r;
  try { r = await fetch(url, { ...opts, headers: isForm ? {} : { 'Content-Type': 'application/json' }, body: isForm || typeof opts.body === 'string' || opts.body === undefined ? opts.body : JSON.stringify(opts.body) }); }
  catch { netDown(true); throw Object.assign(new Error('Sunucuya ulaşılamıyor'), { net: true }); }
  netDown(false);
  if (r.status === 401 && !url.endsWith('/login')) { boot(); throw new Error('Oturum kapandı, tekrar giriş yap'); }
  const ct = r.headers.get('content-type') || '';
  const j = ct.includes('json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error(j.error || j.detail || `Hata ${r.status}`);
  return j;
}
const post = (u, b = {}) => api(u, { method: 'POST', body: b });
const put = (u, b = {}) => api(u, { method: 'PUT', body: b });
const del = (u, b) => api(u, { method: 'DELETE', body: b });
function toast(msg, bad) { if ([...$('toasts').children].some(x => x.textContent === msg)) return; const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; $('toasts').append(t); setTimeout(() => t.remove(), bad ? 7000 : 3200); }
const tryT = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (!e.net) toast(e.message, true); } };
async function busyBtn(btn, fn, label = 'Çalışıyor') {
  const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${label}`;
  try { return await fn(); } catch (e) { if (!e.net) toast(e.message, true); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = html; } }
}
const fmtDate = s => { if (!s) return ''; const d = new Date(/Z|T.*[+-]\d\d/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return isNaN(d) ? s : d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); };
const ago = s => { if (!s) return ''; const d = new Date(/Z|T.*[+-]\d\d/.test(s) ? s : s.replace(' ', 'T') + 'Z'), m = Math.round((Date.now() - d) / 60000); return m < 1 ? 'şimdi' : m < 60 ? m + ' dk' : m < 1440 ? Math.round(m / 60) + ' sa' : Math.round(m / 1440) + ' g'; };
const li = u => u ? `<a class="li" href="${esc(/^https?:/.test(u) ? u : 'https://' + u)}" target="_blank" rel="noopener" title="LinkedIn profili">in</a>` : '';
const J = v => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch { return []; } };
const PILL = { ok: /mail (var|bulundu)|gönderildi|bitti|yanıtladı|kişi bulundu|aktif|done/, warn: /emin|limit|paused|bekle|sırada|kuyruk|aranıyor|taslak|çalışıyor|takip/, bad: /hata|bulunamad|cancel|iptal|mail yok|kişi yok|engel|durdur/, info: /aday|yeni/ };
const pill = s => { s = String(s || ''); const c = Object.keys(PILL).find(k => PILL[k].test(s)) || ''; return `<span class="pill ${c}">${esc(s || '—')}</span>`; };
const lookupMsg = r => { const sk = Object.entries(r.skipped || {}).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`); return `${r.queued} kişi mail aramasına alındı${sk.length ? ' · atlandı: ' + sk.join(', ') : ''}`; };
const empty = (t, s = '') => `<div class="card empty"><b>${t}</b>${s}</div>`;

// ---------------- Modal ----------------
function modal(title, html, onMount) {
  $('mTitle').textContent = title; $('mBody').innerHTML = html; $('modal').classList.remove('hide');
  onMount?.($('mBody'));
}
const closeModal = () => $('modal').classList.add('hide');
$('mClose').onclick = closeModal; $('modal').onclick = e => { if (e.target === $('modal')) closeModal(); };
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------------- Chip input ----------------
function chipInput(el, values, { suggestions = [], placeholder = 'ekle ve Enter' } = {}) {
  let vals = [...values];
  const draw = () => {
    el.innerHTML = `<div class="chipbox">${vals.map((v, i) => `<span class="chip">${esc(v)}<button type="button" data-x="${i}">✕</button></span>`).join('')}<input placeholder="${esc(placeholder)}"></div>
      ${suggestions.length ? `<div class="chips" style="margin-top:6px">${suggestions.map(s => `<span class="chip sug ${vals.includes(s) ? 'on' : ''}" data-s="${esc(s)}">${vals.includes(s) ? '✓' : '+'} ${esc(s)}</span>`).join('')}</div>` : ''}`;
    const inp = el.querySelector('input');
    inp.onkeydown = e => {
      if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) { e.preventDefault(); inp.value.split(',').map(s => s.trim()).filter(Boolean).forEach(v => vals.includes(v) || vals.push(v)); draw(); el.querySelector('input').focus(); }
      if (e.key === 'Backspace' && !inp.value && vals.length) { vals.pop(); draw(); el.querySelector('input').focus(); }
    };
    inp.onblur = () => { if (inp.value.trim()) { inp.value.split(',').map(s => s.trim()).filter(Boolean).forEach(v => vals.includes(v) || vals.push(v)); draw(); } };
  };
  el.onclick = e => {
    const x = e.target.closest('[data-x]'); if (x) { vals.splice(+x.dataset.x, 1); draw(); }
    const s = e.target.closest('[data-s]'); if (s) { const v = s.dataset.s; vals = vals.includes(v) ? vals.filter(a => a !== v) : [...vals, v]; draw(); }
  };
  draw();
  return { get: () => { const i = el.querySelector('input'); if (i?.value.trim()) { i.value.split(',').map(s => s.trim()).filter(Boolean).forEach(v => vals.includes(v) || vals.push(v)); i.value = ''; } return vals; }, set: v => { vals = [...v]; draw(); } };
}

// ---------------- Boot / auth / nav ----------------
async function boot() {
  const { user } = await api('/api/me').catch(() => ({ user: null }));
  ME = user;
  $('login').classList.toggle('hide', !!user); $('shell').classList.toggle('hide', !user);
  if (!user) { setTimeout(() => $('u').focus(), 50); return; }
  $('meName').textContent = user.name || user.username; $('meRole').textContent = user.role === 'admin' ? 'Yönetici' : 'Kullanıcı';
  $('av').textContent = (user.name || user.username)[0].toUpperCase();
  document.querySelectorAll('.adm').forEach(a => a.classList.toggle('hide', user.role !== 'admin'));
  await loadCamps(); route(); badges(); clearInterval(window._b); window._b = setInterval(badges, 15000);
}
async function loadCamps() {
  CAMPS = await api('/api/campaigns').catch(() => []);
  $('bC').textContent = CAMPS.length || '';
  markNav();
}
async function badges() {
  try {
    const s = await api('/api/stats');
    $('bOut').textContent = s.drafts ? s.drafts : ''; $('bOut').title = 'taslak';
    $('bQ').textContent = s.tasks + s.jobs || ''; if ($('bR')) $('bR').textContent = s.replies || ''; if ($('bCall')) $('bCall').textContent = s.callsToday || '';
    const lim = Math.max(s.limits.lookup, s.limits.arama);
    $('tbLimit').innerHTML = lim ? `<span class="pill warn">RR limit ${lim} dk</span>` : '';
  } catch {}
}
$('lf').onsubmit = async e => {
  e.preventDefault();
  try { await post('/api/login', { user: $('u').value, pass: $('p').value }); $('le').textContent = ''; $('p').value = ''; boot(); }
  catch (er) { $('le').textContent = er.message; }
};
$('out').onclick = async () => { await post('/api/logout'); boot(); };
$('theme').onclick = () => {
  const cur = document.documentElement.dataset.theme || 'light';
  const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('theme', next); } catch {}
};
const drawer = open => { $('side').classList.toggle('open', open); $('scrim').classList.toggle('open', open); };
$('scrim').onclick = () => drawer(false);
$('tabbar').onclick = e => { const a = e.target.closest('a[data-p]'); if (!a) return; e.preventDefault(); if (a.dataset.p === 'menu') drawer(true); else { location.hash = a.dataset.p; drawer(false); } };
$('nav').onclick = e => { const a = e.target.closest('a[data-p]'); if (a) { location.hash = a.dataset.p; drawer(false); } };
addEventListener('hashchange', () => ME && route());
function markNav() {
  let h = decodeURIComponent(location.hash.slice(1) || 'dash'); if (h.startsWith('c/')) h = 'campaigns'; h = h.replace(/^(templates|replies|calls)\/.*$/, '$1');
  document.querySelectorAll('#nav a, #tabbar a').forEach(a => a.classList.toggle('on', h === a.dataset.p || h.startsWith(a.dataset.p + '/') || (a.dataset.p === 'contacts' && h === 'favs') || (a.dataset.p === 'search' && h === 'history')));
}
let timer;
function route() {
  clearInterval(timer); main.onclick = main.onchange = main.oninput = null;
  closeModal();
  const [p, ...args] = (location.hash.slice(1) || 'dash').split('/');
  markNav(); window.scrollTo(0, 0);
  (PAGES[p] || PAGES.dash)(...args);
}
const head = (title, sub = '', actions = '') => `<div class="ph"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="row">${actions}</div></div>`;

const PAGES = {};

// ================= Panel =================
const EVI = { found: '🔎', sent: '📤', reply: '💬', job: '✅', limit: '⏳', error: '⚠️', info: 'ℹ️', company: '🏭' };
const feedHtml = ev => ev.length ? `<div class="feed">${ev.map(e => `<div><span class="ic">${EVI[e.type] || '•'}</span><span class="tx">${esc(e.text)}${e.campaign ? ` <small class="mut">· ${esc(e.campaign)}</small>` : ''}</span><time>${ago(e.created)}</time></div>`).join('')}</div>` : '<p class="mut">Henüz hareket yok</p>';
const QN = { person_lookup: 'Mail bulma (lookup)', person_search: 'Kişi arama' }, QD = { one_minute: 'dakika', one_hour: 'saat', one_day: 'gün', one_month: 'ay' };
async function quotaCard() {
  const el = $('quota'); if (!el) return;
  try {
    const q = await api('/api/rr/quota');
    const rows = q.list.filter(r => ['one_hour', 'one_day', 'one_month'].includes(r.duration));
    el.innerHTML = `<div class="card-h"><h3>RocketReach kotası</h3><span class="mut" style="font-size:12px">canlı</span></div>
      ${Object.keys(QN).map(a => `<p style="margin:10px 0 6px;font-weight:600">${QN[a]}</p><div class="quota">${rows.filter(r => r.action === a).map(r => {
        const p = r.limit ? Math.min(100, r.used / r.limit * 100) : 0;
        return `<span>${QD[r.duration]}</span><span class="${p >= 100 ? 'err' : 'mut'}">${r.used} / ${r.limit}</span><div class="bar"><i style="width:${p}%;${p >= 100 ? 'background:var(--bad)' : ''}"></i></div>`;
      }).join('')}</div>`).join('')}
      <p class="mut" style="font-size:12px;margin:8px 0 0">Kota RocketReach planına bağlı (API key başına). Dolduğunda kuyruk bekler, açılınca kendiliğinden devam eder. Daha yüksek limit için RocketReach planını yükseltmek gerekir.</p>`;
  } catch (e) { el.innerHTML = '<h3>RocketReach kotası</h3><p class="mut">' + esc(e.message) + '</p>'; }
}

// ================= Şirket profili =================
PAGES.project = tryT(async () => {
  const p = await api('/api/project');
  const F = (k, label, ph = '', ta = 0) => `<label>${label}${ta ? `<textarea name="${k}" rows="${ta}" placeholder="${esc(ph)}">${esc(p[k])}</textarea>` : `<input name="${k}" value="${esc(p[k])}" placeholder="${esc(ph)}">`}</label>`;
  const INSTR = ['Toplantı değil cevap iste', 'Kısa tut', 'Teklifimizden bahset', 'İndirim önerme', 'Profesyonel ton', 'Samimi ton', 'Somut bir rakam/sonuç ver', 'Mevcut kameralarla çalıştığını vurgula'];
  main.innerHTML = head('Şirket Profili', 'AI tüm kampanyalarda, maillerde ve firma aramada bu bilgileri kullanır. Ne kadar dolu, o kadar isabetli.',
    `<button class="btn" id="research">✨ Web sitesinden AI ile doldur</button><button class="btn pri" id="psave">Kaydet</button>`) +
  `<form id="pf"><div class="grid g2" style="align-items:start"><div>
    <div class="card"><h3>Şirket</h3><p class="hint">Her kampanya, mail ve yanıtın temeli.</p><div class="grid g2">
      ${F('company', 'Şirket adı', 'Hype Vision')}${F('website', 'Web sitesi', 'hypevisionlab.com')}${F('founded', 'Kuruluş', '2021')}${F('employees', 'Çalışan', '6')}
      ${F('location', 'Lokasyon', 'Gebze, TR')}${F('industry', 'Sektör', 'Yapay zeka / video analitik')}</div>
      <div class="grid" style="margin-top:14px">${F('description', 'Açıklama', 'Mevcut IP kameraları analiz eden yapay zeka platformu…', 3)}${F('offer', 'Ne sunuyoruz (tek cümle)', 'KKD eksiklerini tespit eder, güvensiz davranışları anlık uyarır')}
      ${F('competitors', 'Rakipler (virgülle alan adları)', 'percepvision.com, synapsi.ai')}</div></div>
    <div class="card"><h3>Mail dili ve gönderen</h3><p class="hint">Tüm ilk mail, takip ve yanıtlar için geçerli.</p><div class="grid g2">
      <label>Dil<select name="language">${['Türkçe', 'English', 'Deutsch'].map(l => `<option ${p.language === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${F('sender_name', 'Gönderen adı', 'Emre Yıldız')}</div>
      <label style="margin-top:14px">Talimatlar <span class="mut" style="font-weight:400">(opsiyonel, en iyi pratiklerle birleştirilir)</span><textarea name="instructions" id="instr" rows="4" maxlength="3000">${esc(p.instructions)}</textarea></label>
      <div class="chips" style="margin-top:8px">${INSTR.map(s => `<span class="chip sug" data-ins="${esc(s)}">+ ${esc(s)}</span>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button type="button" class="btn" id="pv">Örnek maili önizle</button></div><div id="pvOut" style="margin-top:12px"></div></div>
  </div><div>
    <div class="card"><h3>Yanıt bilgileri</h3><p class="hint">AI mail yazarken bunlara dayanır: fiyat, yetenekler, kanıt.</p><div class="grid">
      ${F('pricing', 'Fiyatlandırma', 'Kamera başı aylık … / pilot ücretsiz 30 gün', 2)}${F('capabilities', 'Yetenekler & entegrasyonlar', 'KKD tespiti, forklift-yaya yakınlık, ERP entegrasyonu, …', 3)}
      ${F('proof', 'Referanslar & vaka çalışmaları', 'X fabrikasında kaza bildirimlerinde %40 azalma…', 3)}${F('docs', 'Diğer belgeler / notlar', 'AI\'ın bilmesini istediğin her şey', 6)}</div></div>
  </div></div></form>`;
  const f = $('pf');
  main.onclick = e => { const s = e.target.closest('[data-ins]'); if (s) { const t = $('instr'); t.value = (t.value.trim() ? t.value.trim() + '\n' : '') + '- ' + s.dataset.ins; } };
  const save = async () => { await put('/api/project', Object.fromEntries(new FormData(f))); };
  $('psave').onclick = e => busyBtn(e.currentTarget, async () => { await save(); toast('Profil kaydedildi'); }, 'Kaydediliyor');
  $('research').onclick = e => busyBtn(e.currentTarget, async () => {
    const url = f.website.value || prompt('Web sitesi adresi'); if (!url) return;
    const r = await post('/api/project/research', { url });
    for (const [k, v] of Object.entries(r)) if (f[k] && v && !f[k].value) f[k].value = Array.isArray(v) ? v.join(', ') : v;
    toast('AI profili doldurdu — kontrol edip Kaydet\'e bas');
  }, 'Site inceleniyor (~30 sn)');
  $('pv').onclick = e => busyBtn(e.currentTarget, async () => {
    await save(); const r = await post('/api/mail/ai-preview', {});
    $('pvOut').innerHTML = `<div class="preview"><b>${esc(r.subject)}</b><hr style="border:0;border-top:1px solid #eee">${r.html}</div>`;
  }, 'AI yazıyor');
});

// ================= Kampanyalar =================
const COUNTRIES = ['Türkiye', 'Almanya', 'Avusturya', 'İsviçre', 'Hollanda', 'Belçika', 'Fransa', 'İtalya', 'İspanya', 'Polonya', 'Çekya', 'Romanya', 'Bulgaristan', 'Macaristan', 'İngiltere', 'İrlanda', 'İsveç', 'Danimarka', 'Norveç', 'ABD', 'Kanada', 'Meksika', 'Brezilya', 'BAE', 'Suudi Arabistan', 'Katar', 'Mısır', 'Fas', 'Azerbaycan', 'Kazakistan', 'Özbekistan', 'Gürcistan', 'Irak', 'Hindistan', 'Endonezya', 'Malezya', 'Güney Afrika'];
const SECTORS = ['Otomotiv yan sanayi', 'Metal / döküm', 'Gıda üretimi', 'Tekstil', 'Plastik / kauçuk', 'Kimya', 'Beyaz eşya / elektronik', 'Mobilya', 'Ambalaj', 'İnşaat malzemesi', 'Lojistik / depo', 'Enerji', 'Tersane', 'İlaç'];
const PLACES = ['Kocaeli', 'Bursa', 'İstanbul', 'Sakarya', 'Tekirdağ', 'Manisa', 'İzmir', 'Ankara', 'Konya', 'Kayseri', 'Gaziantep', 'Denizli', 'Trabzon', 'Eskişehir'];
PAGES.campaigns = tryT(async () => {
  await loadCamps();
  main.innerHTML = head('Kampanyalar', 'Satıra tıkla: bulunan firmalar, kişiler, mailler.', '<a class="btn pri" href="#newcamp">＋ Yeni kampanya</a>') +
  (CAMPS.length ? `<div class="tw"><table><thead><tr><th>Kampanya</th><th class="hide-m">Sektör</th><th class="hide-m">Konum</th><th>Firma</th><th>Kişi</th><th>Mail</th><th>Gönderilen</th><th>Yanıt</th><th>Durum</th><th class="hide-m">Oluşturma</th></tr></thead><tbody>
  ${CAMPS.map(c => `<tr class="click" data-href="c/${c.id}/companies"><td class="w"><div class="n">${esc(c.name)}</div>${c.pending ? `<small><span class="spin"></span> ${c.pending} iş çalışıyor</small>` : ''}</td>
    <td class="hide-m">${esc(c.sector || '—')}</td><td class="hide-m">${esc(c.location || c.geography || '—')}</td><td><b>${c.companies}</b></td><td><b>${c.leads}</b></td>
    <td><b style="color:var(--ok)">${c.with_email}</b></td><td>${c.sent}</td><td>${c.replied}</td><td>${pill(c.status)}</td><td class="mut hide-m">${fmtDate(c.created)}</td></tr>`).join('')}</tbody></table></div>`
  : empty('Henüz kampanya yok', '<a href="#newcamp">Firma Bul</a> ile başla: sadece sektör veya konum yazman yeter.'));
  main.onclick = e => { const r = e.target.closest('[data-href]'); if (r) location.hash = r.dataset.href; };
  timer = setInterval(() => location.hash === '#campaigns' && PAGES.campaigns(), 20000);
});

// Firma detayı: yetkililer + mailleri
async function companyModal(id, campId, onChange) {
  const co = await api('/api/companies/' + id);
  modal(co.name, `<p class="mut" style="margin-top:0"><a href="https://${esc(co.domain)}" target="_blank" rel="noopener">${esc(co.domain)}</a> · ${esc(co.city || '')} · ${esc(co.sector || '')}${co.size ? ' · ' + esc(co.size) : ''}</p>
    ${co.reason ? `<p style="margin-top:0">${esc(co.reason)}</p>` : ''}
    <div class="row" style="margin-bottom:12px">${co.phone ? `<a class="btn sm pri" href="tel:${esc(String(co.phone).replace(/[^\d+]/g, ''))}">📞 ${esc(co.phone)}</a>` : '<button class="btn sm" id="cmTel">📞 Santral numarasını bul</button>'}${co.gen_email ? `<a class="btn sm" href="mailto:${esc(co.gen_email)}">${esc(co.gen_email)}</a>` : ''}${co.call_status ? pill(co.call_status) : ''}<a class="btn sm ghost" href="#calls">Arama listesi →</a></div>
    <div class="row" style="margin-bottom:12px"><button class="btn sm" id="cmP">👥 Yetkilileri bul</button>${co.people.some(p => !p.email) ? '<button class="btn sm" id="cmL">🔎 Mailleri bul</button>' : ''}
      ${co.people.some(p => p.email) ? '<button class="btn sm pri" id="cmD">✨ AI mail yaz</button>' : ''}<span class="sp"></span>${pill(co.status)}</div>
    ${co.people.length ? `<div class="tw" style="max-height:50vh"><table><tbody>${co.people.map(p => `<tr><td><div class="n">${esc(p.name)}</div><small>${esc(p.title)}</small></td><td>${li(p.linkedin)}</td>
      <td>${p.email ? `<span class="mail">${esc(p.email)}</span>` : pill(p.stage)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Henüz kişi yok. "Yetkilileri bul" ile RocketReach\'te ara.</p>'}`, b => {
    const done = msg => { toast(msg); closeModal(); onChange?.(); };
    if (b.querySelector('#cmTel')) b.querySelector('#cmTel').onclick = tryT(async () => { await post('/api/companies/contact-info', { ids: [id] }); done('Santral numarası aranıyor (~20 sn)'); });
    b.querySelector('#cmP').onclick = tryT(async () => { const r = await post('/api/companies/people', { ids: [id], max: 5 }); done(r.queued ? 'Yetkili araması kuyruğa alındı' : 'Zaten kuyrukta'); });
    if (b.querySelector('#cmL')) b.querySelector('#cmL').onclick = tryT(async () => { const r = await post('/api/queue/lookup', { contact_ids: co.people.filter(p => !p.email).map(p => p.id), campaign_id: campId }); done(lookupMsg(r)); });
    if (b.querySelector('#cmD')) b.querySelector('#cmD').onclick = tryT(async () => { const r = await post('/api/outbox/draft', { contact_ids: co.people.filter(p => p.email).map(p => p.id), campaign_id: campId }); done(r.queued + ' AI taslak yazılıyor → Mailler'); });
  });
}

const CTABS = [['companies', 'Firmalar'], ['people', 'Kişiler'], ['emails', 'Mailler'], ['overview', 'Pipeline'], ['targeting', 'Ayarlar'], ['activity', 'Akış']];
PAGES.c = tryT(async (id, tab = 'companies', sub) => {
  const c = await api('/api/campaigns/' + id);
  main.innerHTML = `<div class="ph"><div><div class="row"><h1>${esc(c.name)}</h1>${pill(c.status)}</div><p class="sub">${esc([c.sector, c.location].filter(Boolean).join(' · ') || c.brief || '')}</p></div>
    <div class="row"><button class="btn" id="cToggle">${c.status === 'aktif' ? '❚❚ Duraklat' : '▶ Devam et'}</button><a class="btn" href="/api/campaigns/${c.id}/export">Excel</a><button class="icon" id="cDel" title="Kampanyayı sil">🗑</button></div></div>
    <div class="kstrip"><span><b>${c.companies}</b>firma</span><span><b>${c.leads}</b>kişi</span><span><b style="color:var(--ok)">${c.with_email}</b>mail bulundu</span><span><b>${c.sent}</b>gönderildi</span><span><b>${c.replied}</b>yanıt</span>${c.pending ? `<span><span class="spin"></span> ${c.pending} iş çalışıyor</span>` : ''}</div>
    <div class="tabs" style="margin-bottom:18px">${CTABS.map(([k, l]) => `<a href="#c/${c.id}/${k}" class="${tab === k ? 'on' : ''}">${l}${k === 'companies' ? `<span class="cnt">${c.companies}</span>` : k === 'people' ? `<span class="cnt">${c.leads}</span>` : ''}</a>`).join('')}</div><div id="ctab"></div>`;
  $('cToggle').onclick = tryT(async () => { await put('/api/campaigns/' + c.id, { status: c.status === 'aktif' ? 'duraklatıldı' : 'aktif' }); await loadCamps(); route(); });
  $('cDel').onclick = tryT(async () => { if (!confirm(`"${c.name}" kampanyası silinsin mi? (Kişiler Kişilerim'de kalır)`)) return; await del('/api/campaigns/' + c.id); await loadCamps(); location.hash = 'dash'; });
  await (CTAB[tab] || CTAB.companies)(c, $('ctab'), sub);
});
const CTAB = {};

CTAB.overview = async (c, el) => {
  const [ev, t] = await Promise.all([api('/api/events?campaign=' + c.id), api('/api/tasks?campaign=' + c.id)]);
  const st = k => t.counts.filter(x => x.status === k).reduce((a, b) => a + b.n, 0);
  el.innerHTML = `<div class="grid g5 kpis" style="margin-bottom:16px">${[[c.companies, 'Firma'], [c.leads, 'Kişi'], [c.with_email, 'Mail bulundu', 'var(--ok)'], [c.sent, 'Gönderildi', 'var(--pri)'], [c.replied, 'Yanıt', '#f59e0b']]
    .map(([n, l, col]) => `<div class="card kpi"><b style="${col ? 'color:' + col : ''}">${n}</b><span>${l}</span></div>`).join('')}</div>
  <div class="grid g2" style="align-items:start"><div>
    <div class="card"><h3>Pipeline</h3><p class="hint">Adım adım ya da tek tıkla tam otomatik çalıştır.</p>
      <div class="steps">
        <div class="step ${c.offer ? 'done' : ''}"><span class="ck">${c.offer ? '✓' : '1'}</span><span>Hedefleme</span><a class="btn sm" href="#c/${c.id}/targeting">Düzenle</a></div>
        <div class="step ${c.companies ? 'done' : ''}"><span class="ck">${c.companies ? '✓' : '2'}</span><span>Firma bul (AI + web)</span><button class="btn sm" data-run="companies">Bul</button></div>
        <div class="step ${c.leads ? 'done' : ''}"><span class="ck">${c.leads ? '✓' : '3'}</span><span>Firmalarda kişileri bul (RocketReach)</span><a class="btn sm" href="#c/${c.id}/companies">Firmalar</a></div>
        <div class="step ${c.with_email ? 'done' : ''}"><span class="ck">${c.with_email ? '✓' : '4'}</span><span>Mailleri bul (lookup)</span><a class="btn sm" href="#c/${c.id}/people">Kişiler</a></div>
        <div class="step ${c.sent ? 'done' : ''}"><span class="ck">${c.sent ? '✓' : '5'}</span><span>AI mail yaz → onayla → kuyrukla gönder</span><a class="btn sm" href="#c/${c.id}/emails">Mailler</a></div>
      </div>
      <div class="row" style="margin-top:14px"><label>Firma sayısı<select id="ovCount" style="width:auto">${[10, 20, 30, 40].map(n => `<option ${n === 20 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="btn pri" id="ovAll" style="align-self:flex-end">🚀 Tam otomatik çalıştır</button></div>
      <p class="mut" style="font-size:12px;margin:8px 0 0">Firma bul → her firmada kişi ara → mail bul${c.auto_draft || c.auto_send ? ' → AI taslak' : ''}${c.auto_send ? ' → otomatik kuyruğa al' : ''}. Ayarlar Hedefleme sekmesinde.</p></div>
    <div class="card"><h3>Arka plan işleri</h3><div class="row" style="margin-top:10px">${pill('sırada ' + st('sırada'))}${pill('çalışıyor ' + st('çalışıyor'))}${pill('bitti ' + st('bitti'))}${st('hata') ? pill('hata ' + st('hata')) : ''}
      ${t.limits.lookup || t.limits.arama ? `<span class="pill warn">RR limit: ${t.limits.lookup || t.limits.arama} dk</span>` : ''}<span class="sp"></span><a href="#queue" class="btn sm">Kuyruk</a></div></div>
  </div><div class="card"><h3 style="margin-bottom:10px">Akış</h3>${feedHtml(ev.slice(0, 30))}</div></div>`;
  const runCompanies = (people) => post(`/api/campaigns/${c.id}/find-companies`, { count: +$('ovCount').value, people });
  el.querySelector('[data-run=companies]').onclick = e => busyBtn(e.currentTarget, async () => { await runCompanies(false); toast('AI firma araması kuyruğa alındı (~1 dk)'); }, 'Kuyruğa');
  $('ovAll').onclick = e => busyBtn(e.currentTarget, async () => {
    if (!c.auto_lookup) await put('/api/campaigns/' + c.id, { auto_lookup: 1 });
    await runCompanies(true); toast('Pipeline başladı — Telegram\'a bildirim gelecek');
  }, 'Başlatılıyor');
  timer = setInterval(() => location.hash === `#c/${c.id}` || location.hash === `#c/${c.id}/overview` ? CTAB.overview(c, el) : 0, 20000);
};

const GEO = ['Türkiye', 'İstanbul', 'Kocaeli', 'Bursa', 'İzmir', 'Ankara', 'Manisa', 'Tekirdağ', 'Gaziantep', 'Kayseri', 'Konya', 'Almanya (DACH)', 'AB + İngiltere', 'ABD'];
const SIZE = ['Startup (1–50)', 'Orta ölçek (51–500)', 'Kurumsal (500+)', '200 altı KOBİ', 'Tek kişilik firmaları hariç tut'];
const ROLES = ['İSG / HSE yöneticileri', 'Fabrika / tesis müdürleri', 'Üretim müdürleri', 'Kurucular ve CEO\'lar', 'BT karar vericileri', 'Bakım müdürleri', 'Operasyon direktörleri', 'Bireysel çalışanları hariç tut'];
CTAB.targeting = async (c, el) => {
  el.innerHTML = `<div class="grid g2" style="align-items:start"><div>
    <div class="card"><h3>Teklifin</h3><p class="hint">Bu kampanyada neyi, hangi soruna sunuyorsun?</p>
      <label>Hedef tarifi<textarea id="tBrief" rows="2">${esc(c.brief)}</textarea></label>
      <div class="row" style="margin:8px 0 14px"><button class="btn sm" id="tAi">✨ AI ile yeniden doldur</button></div>
      <div class="grid"><label>Kampanya adı<input id="tName" value="${esc(c.name)}"></label>
      <label>Ne sunuyoruz<textarea id="tOffer" rows="2">${esc(c.offer)}</textarea></label><label>Müşterinin sorunu<textarea id="tProblem" rows="2">${esc(c.problem)}</textarea></label>
      <label>Örnek müşteriler<div id="tClients"></div></label></div></div>
    <div class="card"><h3>İdeal müşteri</h3><div class="grid" style="margin-top:12px"><label>Olumlu kriterler<div id="tPos"></div></label><label>Olumsuz kriterler<div id="tNeg"></div></label><label>Anahtar kelimeler<div id="tKw"></div></label></div></div>
  </div><div>
    <div class="card"><h3>Nerede ve ne büyüklükte</h3><div class="grid" style="margin-top:12px"><label>Coğrafya<div id="tGeo"></div></label><label>Şirket büyüklüğü<div id="tSize"></div></label></div></div>
    <div class="card"><h3>Kime ulaşılacak</h3><div class="grid" style="margin-top:12px"><label>Hedef rol (tarif)<input id="tRoles" value="${esc(c.roles)}" placeholder="vardiyalı sahada İSG ve KKD uygulamasından sorumlu kişiler"></label>
      <label>Hızlı seçim<div id="tRolesQ"></div></label>
      <label>RocketReach'te aranacak unvanlar<div id="tTitles"></div></label></div></div>
    <div class="card"><h3>Mail dizisi</h3><p class="hint">İlk mail + takipler. Yanıt gelirse takipler otomatik iptal olur.</p>
      <label>Kampanyaya özel talimat<textarea id="tInstr" rows="3" placeholder="ör. Kocaeli'deki ziyaretimizden bahset, 30 gün ücretsiz pilot öner">${esc(c.instructions)}</textarea></label>
      <div id="tFu" style="margin-top:12px"></div><button class="btn sm" id="tFuAdd" style="margin-top:8px">＋ Takip maili ekle</button>
      <div class="row" style="margin-top:14px"><button class="btn sm" id="tPrev">Örnek mail önizle</button></div><div id="tPrevOut" style="margin-top:10px"></div></div>
    <div class="card"><h3>Otomasyon</h3>
      ${[['auto_lookup', 'Bulunan kişilerin mailini otomatik ara', 'Firmada kişi bulununca RocketReach lookup kuyruğa girer'], ['auto_draft', 'Mail bulununca AI taslak yaz', 'Taslaklar Mailler sekmesinde onayını bekler'], ['auto_send', 'Taslakları onaysız kuyruğa al', 'Dikkat: AI maili gözden geçirmeden takvime göre gönderilir']]
      .map(([k, t, s]) => `<div class="toggle-row"><div><b>${t}</b><small>${s}</small></div><label class="switch"><input type="checkbox" id="t_${k}" ${c[k] ? 'checked' : ''}><i></i></label></div>`).join('')}</div>
  </div></div>
  <div class="selbar"><span>Değişiklikleri kaydetmeyi unutma</span><span class="sp"></span><button class="btn" id="tSave">Kaydet</button></div>`;
  const ci = {
    clients: chipInput($('tClients'), J(c.clients)), positive: chipInput($('tPos'), J(c.positive)), negative: chipInput($('tNeg'), J(c.negative)),
    keywords: chipInput($('tKw'), J(c.keywords)), titles: chipInput($('tTitles'), J(c.titles), { placeholder: 'unvan yaz, Enter' }),
    geo: chipInput($('tGeo'), String(c.geography || '').split(',').map(s => s.trim()).filter(Boolean), { suggestions: GEO }),
    size: chipInput($('tSize'), String(c.size || '').split(',').map(s => s.trim()).filter(Boolean), { suggestions: SIZE }),
    rolesQ: chipInput($('tRolesQ'), [], { suggestions: ROLES, placeholder: 'rol ekle' }),
  };
  let fus = J(c.followups);
  const drawFu = () => {
    $('tFu').innerHTML = fus.map((f, i) => `<div class="row" style="margin-bottom:8px"><span class="pill pri">Takip ${i + 1}</span><input type="number" min="1" max="30" value="${f.days || 3}" data-fd="${i}" style="width:70px"><span class="mut">gün sonra</span>
      <input data-fi="${i}" value="${esc(f.instructions || '')}" placeholder="talimat (opsiyonel)" style="flex:1;min-width:140px"><button class="icon" data-fx="${i}">✕</button></div>`).join('') || '<p class="mut" style="margin:0">Takip yok — sadece ilk mail gider.</p>';
  };
  drawFu();
  $('tFu').oninput = e => { const d = e.target.dataset; if (d.fd) fus[+d.fd].days = +e.target.value; if (d.fi) fus[+d.fi].instructions = e.target.value; };
  $('tFu').onclick = e => { const x = e.target.closest('[data-fx]'); if (x) { fus.splice(+x.dataset.fx, 1); drawFu(); } };
  $('tFuAdd').onclick = () => { if (fus.length < 4) { fus.push({ days: fus.length ? 5 : 3 }); drawFu(); } };
  const collect = () => {
    const rq = ci.rolesQ.get();
    return {
      name: $('tName').value, brief: $('tBrief').value, offer: $('tOffer').value, problem: $('tProblem').value, roles: [$('tRoles').value, ...rq].filter(Boolean).join('; '),
      clients: ci.clients.get(), positive: ci.positive.get(), negative: ci.negative.get(), keywords: ci.keywords.get(), titles: ci.titles.get(),
      geography: ci.geo.get().join(', '), size: ci.size.get().join(', '), instructions: $('tInstr').value, followups: fus,
      auto_lookup: $('t_auto_lookup').checked, auto_draft: $('t_auto_draft').checked, auto_send: $('t_auto_send').checked,
    };
  };
  $('tSave').onclick = e => busyBtn(e.currentTarget, async () => { await put('/api/campaigns/' + c.id, collect()); await loadCamps(); toast('Hedefleme kaydedildi'); }, 'Kaydediliyor');
  $('tAi').onclick = e => busyBtn(e.currentTarget, async () => {
    const s = await post('/api/ai/suggest', { brief: $('tBrief').value || c.name });
    if (s.offer) $('tOffer').value = s.offer; if (s.problem) $('tProblem').value = s.problem; if (s.roles) $('tRoles').value = s.roles;
    for (const k of ['clients', 'positive', 'negative', 'keywords', 'titles']) if (s[k]?.length) ci[k].set(s[k]);
    if (s.size) ci.size.set(String(s.size).split(',').map(x => x.trim()));
    toast('AI doldurdu — Kaydet\'e basmayı unutma');
  }, 'AI düşünüyor');
  $('tPrev').onclick = e => busyBtn(e.currentTarget, async () => {
    const r = await post('/api/mail/ai-preview', { campaign_id: c.id, overrides: collect() });
    $('tPrevOut').innerHTML = `<div class="preview"><b>${esc(r.subject)}</b><hr style="border:0;border-top:1px solid #eee">${r.html}</div>`;
  }, 'AI yazıyor');
};

const STAGES = ['aday', 'mail kuyrukta', 'mail aranıyor', 'mail var', 'mail yok', 'taslak', 'sırada', 'gönderildi', 'takip 1', 'takip 2', 'yanıtladı', 'engelli'];
CTAB.people = async (c, el) => {
  let filter = '', q = '';
  const draw = async () => {
    const all = await api(`/api/campaigns/${c.id}/leads`);
    const cnt = s => all.filter(x => x.stage === s).length;
    const list = all.filter(x => (!filter || (filter === 'email' ? x.email : x.stage === filter)) && (!q || [x.name, x.company, x.title, x.email].join(' ').toLocaleLowerCase('tr').includes(q)));
    el.innerHTML = `<div class="row" style="margin-bottom:12px"><input id="lq" placeholder="Ara…" value="${esc(q)}" style="max-width:260px">
      <div class="tabs" id="lf2"><button data-f="" class="${!filter ? 'on' : ''}">Tümü<span class="cnt">${all.length}</span></button><button data-f="email" class="${filter === 'email' ? 'on' : ''}">Maili var<span class="cnt">${all.filter(x => x.email).length}</span></button>
      ${STAGES.filter(cnt).map(s => `<button data-f="${s}" class="${filter === s ? 'on' : ''}">${s}<span class="cnt">${cnt(s)}</span></button>`).join('')}</div><span class="sp"></span>
      <button class="btn sm" id="lAdd">＋ Kişilerim'den ekle</button></div>
    ${list.length ? `<div class="tw"><table><thead><tr><th class="c"><input type="checkbox" id="lAll"></th><th>Kişi</th><th>Firma</th><th>LinkedIn</th><th>Mail</th><th>Aşama</th></tr></thead><tbody>
    ${list.map(x => `<tr><td class="c"><input type="checkbox" data-l="${x.id}"></td><td class="w"><div class="ent">${avatar(x.name)}<div><div class="n">${esc(x.name)}</div><small>${esc(x.title)}</small></div></div></td>
      <td>${esc(x.company)}<small>${esc(x.location)}</small></td><td>${li(x.linkedin)}</td><td>${x.email ? `<span class="mail">${esc(x.email)}</span>` : '<span class="mut">—</span>'}</td><td>${pill(x.stage)}</td></tr>`).join('')}</tbody></table></div>
    <div class="selbar"><b id="lN"></b><span class="sp"></span><button class="btn" data-a="lookup">🔎 Mail bul</button><button class="btn" data-a="draft">✨ AI mail yaz</button><button class="btn" data-a="compose">✉ Şablonla yaz</button>
      <button class="btn" data-a="replied">💬 Yanıtladı</button><button class="btn" data-a="remove">Çıkar</button></div>`
    : empty('Kişi yok', 'Firmalar sekmesinden "Kişileri bul" de ya da Kişilerim\'den ekle.')}`;
    const ids = () => [...el.querySelectorAll('[data-l]:checked')].map(x => +x.dataset.l);
    const upd = () => { if ($('lN')) $('lN').textContent = ids().length ? ids().length + ' kişi seçili' : 'Kişi seç'; };
    upd();
    $('lq').oninput = e => { q = e.target.value.toLocaleLowerCase('tr'); clearTimeout(window._lq); window._lq = setTimeout(async () => { await draw(); $('lq').focus(); $('lq').setSelectionRange(99, 99); }, 300); };
    $('lf2').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } };
    el.onchange = e => { if (e.target.id === 'lAll') el.querySelectorAll('[data-l]').forEach(x => x.checked = e.target.checked); upd(); };
    $('lAdd').onclick = () => { sessionStorage.setItem('addToCamp', c.id); location.hash = 'contacts'; toast('Kişileri seç → "Kampanyaya ekle"'); };
    el.querySelector('.selbar')?.addEventListener('click', tryT(async e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const sel2 = ids(); if (!sel2.length) return toast('Önce kişi seç', true);
      const rows = all.filter(x => sel2.includes(x.id));
      if (b.dataset.a === 'lookup') { const r = await post('/api/queue/lookup', { contact_ids: sel2, campaign_id: c.id }); toast(lookupMsg(r)); }
      if (b.dataset.a === 'draft') { const ok = rows.filter(x => x.email).map(x => x.id); if (!ok.length) return toast('Seçilenlerin maili yok', true); const r = await post('/api/outbox/draft', { contact_ids: ok, campaign_id: c.id }); toast(`${r.queued} AI taslak yazılıyor → Mailler sekmesi`); }
      if (b.dataset.a === 'compose') return composeModal(rows.filter(x => x.email).map(x => x.id), c.id);
      if (b.dataset.a === 'replied') await post(`/api/campaigns/${c.id}/leads/stage`, { contact_ids: sel2, stage: 'yanıtladı' });
      if (b.dataset.a === 'remove') { if (!confirm(sel2.length + ' kişi kampanyadan çıkarılsın mı?')) return; await post(`/api/campaigns/${c.id}/leads/remove`, { contact_ids: sel2 }); }
      draw();
    }));
    clearInterval(timer); timer = setInterval(() => { if (location.hash === `#c/${c.id}/people` && !ids().length && document.activeElement?.id !== 'lq') draw(); }, 20000);
  };
  await draw();
};

CTAB.emails = async (c, el, sub) => outboxView(el, { campaign: c.id, status: sub });
CTAB.activity = async (c, el) => {
  const [ev, t] = await Promise.all([api('/api/events?campaign=' + c.id), api('/api/tasks?campaign=' + c.id)]);
  el.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card"><h3 style="margin-bottom:10px">Olaylar</h3>${feedHtml(ev)}</div><div class="card"><h3 style="margin-bottom:10px">İşler</h3>${tasksTable(t.recent)}</div></div>`;
};

// ================= Mail kutusu (outbox) =================
const OST = [['taslak', 'Taslaklar'], ['sırada', 'Sırada'], ['gönderildi', 'Gönderilen'], ['hata', 'Hatalı'], ['iptal', 'İptal']];
async function outboxView(el, { campaign, status = 'taslak' } = {}) {
  status = decodeURIComponent(status || 'taslak');
  const [list, all, sch] = await Promise.all([api(`/api/outbox?status=${encodeURIComponent(status)}${campaign ? '&campaign=' + campaign : ''}`), api(`/api/outbox${campaign ? '?campaign=' + campaign : ''}`), api('/api/sending')]);
  const cnt = s => all.filter(x => x.status === s).length;
  const base = campaign ? `#c/${campaign}/emails/` : '#outbox/';
  el.innerHTML = `${!sch.ok ? `<div class="banner">⏸ ${esc(sch.why)} — kuyruktaki mailler uygun zamanda gönderilir. <a href="#${sch.why.includes('Gmail') ? 'settings' : 'schedule'}">Ayarla →</a></div>` : `<div class="banner ok">● Gönderim açık · bugün ${sch.today}/${sch.daily} · sırada ${sch.queued}</div>`}
    <div class="row" style="margin-bottom:12px"><div class="tabs">${OST.map(([s, l]) => `<a href="${base}${s}" class="${status === s ? 'on' : ''}">${l}<span class="cnt">${cnt(s)}</span></a>`).join('')}</div></div>
    ${list.length ? `<div class="row" style="margin-bottom:10px"><label class="inline"><input type="checkbox" id="oAll"> tümünü seç</label><span class="sp"></span>
      ${status === 'taslak' ? '<button class="btn pri sm" data-oa="approve">✓ Onayla → kuyruğa al</button>' : ''}${status === 'sırada' ? '<button class="btn sm" data-oa="draft">Taslağa geri al</button>' : ''}
      ${status === 'hata' ? '<button class="btn sm" data-oa="approve">Tekrar dene</button>' : ''}${['taslak', 'sırada', 'hata'].includes(status) ? '<button class="btn sm" data-oa="cancel">İptal</button>' : ''}
      ${['iptal', 'taslak', 'hata'].includes(status) ? '<button class="btn sm danger" data-oa="delete">Sil</button>' : ''}</div>
    ${list.map(o => `<div class="mailcard" data-o="${o.id}"><div class="row"><input type="checkbox" data-oc="${o.id}"><div class="sp" style="min-width:0"><b>${esc(o.name)}</b> <span class="mut">· ${esc(o.title || '')} @ ${esc(o.company || '')}</span><br><span class="mail">${esc(o.to_email)}</span></div>
      ${o.step ? `<span class="pill pri">takip ${o.step}</span>` : ''}${!campaign && o.campaign ? `<span class="pill">${esc(o.campaign)}</span>` : ''}${pill(o.status)}
      <small class="mut">${o.sent_at ? fmtDate(o.sent_at) : o.scheduled_at ? '⏰ ' + fmtDate(o.scheduled_at) : ''}</small></div>
      ${o.body ? `<div class="subj" style="margin-top:8px">${esc(o.subject)}</div><div class="body">${esc(o.body)}</div>` : '<p class="mut" style="margin:8px 0 0">Takip maili gönderim anında AI tarafından yazılacak.</p>'}
      ${o.error ? `<p class="err" style="margin-top:6px;font-size:12px">${esc(o.error)}</p>` : ''}
      <div class="row" style="margin-top:10px">${o.body ? '<button class="btn sm ghost" data-more>Tamamını gör</button>' : ''}${['taslak', 'sırada', 'hata'].includes(o.status) && o.body ? '<button class="btn sm" data-edit>Düzenle</button>' : ''}
        ${['taslak', 'sırada', 'hata'].includes(o.status) && o.body ? '<button class="btn sm" data-now>Hemen gönder</button>' : ''}${o.status === 'taslak' ? '<button class="btn sm pri" data-ok>Onayla</button>' : ''}</div></div>`).join('')}`
    : empty('Burada mail yok', status === 'taslak' ? 'Kişiler sekmesinde "AI mail yaz" ile taslak oluştur.' : '')}`;
  const ids = () => [...el.querySelectorAll('[data-oc]:checked')].map(x => +x.dataset.oc);
  const redraw = () => outboxView(el, { campaign, status });
  el.onchange = e => { if (e.target.id === 'oAll') el.querySelectorAll('[data-oc]').forEach(x => x.checked = e.target.checked); };
  el.onclick = tryT(async e => {
    const card = e.target.closest('[data-o]'), id = card && +card.dataset.o, o = id && list.find(x => x.id === id);
    const oa = e.target.closest('[data-oa]');
    if (oa) { const s = ids(); if (!s.length) return toast('Mail seç', true); if (oa.dataset.oa === 'delete' && !confirm(s.length + ' mail silinsin mi?')) return; await post('/api/outbox/action', { ids: s, action: oa.dataset.oa }); toast('Tamam'); return redraw(); }
    if (e.target.closest('[data-more]')) { card.classList.toggle('open'); return; }
    if (e.target.closest('[data-ok]')) { await post('/api/outbox/action', { ids: [id], action: 'approve' }); toast('Kuyruğa alındı'); return redraw(); }
    if (e.target.closest('[data-now]')) { const b = e.target.closest('[data-now]'); if (!confirm(`${o.to_email} adresine şimdi gönderilsin mi?`)) return; return busyBtn(b, async () => { await post('/api/outbox/send-now/' + id); toast('Gönderildi ✓'); redraw(); }, 'Gönderiliyor'); }
    if (e.target.closest('[data-edit]')) modal('Maili düzenle', `<label>Konu<input id="eS" value="${esc(o.subject)}"></label><label style="margin-top:10px">İçerik<textarea id="eB" rows="12">${esc(o.body)}</textarea></label>
      <div class="row" style="margin-top:12px"><span class="mut" style="font-size:12px">İmzan otomatik eklenir</span><span class="sp"></span><button class="btn pri" id="eGo">Kaydet</button></div>`,
      b => b.querySelector('#eGo').onclick = tryT(async () => { await put('/api/outbox/' + id, { subject: b.querySelector('#eS').value, body: b.querySelector('#eB').value }); closeModal(); redraw(); }));
  });
}
PAGES.outbox = tryT(async status => {
  main.innerHTML = head('Mail Kutusu', 'Tüm kampanyaların taslak, kuyruk ve gönderilen mailleri. Gönderim takvime ve günlük limite göre otomatik yapılır.', '<a class="btn" href="#schedule">Gönderim takvimi</a>') + '<div id="ob"></div>';
  await outboxView($('ob'), { status });
});

// Şablonla mail yaz (seçilen kişilere aynı içerik, değişkenlerle)
const VARS = ['ad', 'soyad', 'adsoyad', 'sirket', 'unvan', 'gonderen'];
async function composeModal(contactIds, campaignId) {
  if (!contactIds.length) return toast('Seçilenlerde maili olan kişi yok', true);
  const tpls = await api('/api/templates');
  modal(`${contactIds.length} kişiye mail`, `<div class="row" style="margin-bottom:10px"><select id="cT" style="flex:1"><option value="">— şablon seç —</option>${tpls.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><button class="btn sm" id="cTS">Şablon olarak kaydet</button></div>
    <label>Konu<input id="cS" placeholder="{{sirket}} için kısa bir soru"></label><label style="margin-top:10px">İçerik<textarea id="cB" rows="9" placeholder="Merhaba {{ad}},&#10;&#10;…"></textarea></label>
    <div class="chips" style="margin-top:8px">${VARS.map(v => `<span class="chip var" data-v="${v}">{{${v}}}</span>`).join('')}</div>
    <div class="preview" id="cP" style="margin-top:12px"></div>
    <div class="row" style="margin-top:14px"><span class="sp"></span><button class="btn" id="cDraft">Taslak olarak ekle</button><button class="btn pri" id="cQ">Kuyruğa al</button></div>`, b => {
    let focus = b.querySelector('#cB');
    b.querySelector('#cS').onfocus = e => focus = e.target; b.querySelector('#cB').onfocus = e => focus = e.target;
    const pv = tryT(async () => { const r = await post('/api/mail/preview', { subject: b.querySelector('#cS').value, body: b.querySelector('#cB').value, contact_id: contactIds[0] }); b.querySelector('#cP').innerHTML = `<b>${esc(r.subject)}</b><hr style="border:0;border-top:1px solid #eee">${r.html}`; });
    let t; b.oninput = () => { clearTimeout(t); t = setTimeout(pv, 300); }; pv();
    b.onclick = e => { const v = e.target.closest('[data-v]'); if (v) { const s = focus.selectionStart ?? focus.value.length; focus.value = focus.value.slice(0, s) + `{{${v.dataset.v}}}` + focus.value.slice(focus.selectionEnd ?? s); focus.focus(); pv(); } };
    b.querySelector('#cT').onchange = e => { const x = tpls.find(y => y.id == e.target.value); if (x) { b.querySelector('#cS').value = x.subject; b.querySelector('#cB').value = x.body; pv(); } };
    b.querySelector('#cTS').onclick = tryT(async () => { const n = prompt('Şablon adı'); if (n) { await post('/api/templates', { name: n, subject: b.querySelector('#cS').value, body: b.querySelector('#cB').value }); toast('Şablon kaydedildi'); } });
    const go = send => tryT(async () => {
      const r = await post('/api/outbox/compose', { contact_ids: contactIds, subject: b.querySelector('#cS').value, body: b.querySelector('#cB').value, campaign_id: campaignId || null, send });
      closeModal(); toast(`${r.added} mail ${send ? 'kuyruğa alındı' : 'taslak olarak eklendi'}${r.skipped ? ` · ${r.skipped} atlandı (mail yok/engelli)` : ''}`); route();
    });
    b.querySelector('#cDraft').onclick = go(false); b.querySelector('#cQ').onclick = go(true);
  });
}

// ================= Kişi Ara =================
let lastSearch = null;
PAGES.search = () => {
  main.innerHTML = head('Kişi Ara', 'RocketReach veritabanında ara. Virgülle birden fazla değer yazabilirsin. Arama ücretsiz; mail için lookup harcanır.', '<a class="btn" href="#history">↺ Arama geçmişi</a>') +
  `<form class="card" id="sf"><div class="grid g3">
    <label>Ad Soyad<input name="name" placeholder="ör. Celil Hekimoğlu"></label><label>Şirket<input name="company" placeholder="ör. Farplas"></label>
    <label>Şirket alan adı<input name="domain" placeholder="ör. farplas.com"></label><label>Unvan<input name="title" placeholder="ör. İSG Müdürü, Plant Manager"></label>
    <label>Sektör<input name="industry" placeholder="ör. Automotive, Manufacturing"></label><label>Lokasyon<input name="location" placeholder="ör. Kocaeli, Turkey"></label>
    <label class="span2">Anahtar kelime<input name="keyword" placeholder="serbest metin"></label>
    <div style="align-self:end" class="row"><button class="btn pri" style="flex:1">Ara</button><button type="button" class="btn" id="sclear">Temizle</button></div></div></form>
  <div id="sres"></div>
  <div class="card"><h3>Tek kişiyi bul</h3><p class="hint">İsim + şirket ya da LinkedIn linki. Hemen bulur veya kuyruğa ekler (limit doluysa).</p><form id="one" class="grid g4" style="align-items:end">
    <label>Ad Soyad<input name="name"></label><label>Şirket<input name="company"></label><label>LinkedIn URL<input name="linkedin" placeholder="linkedin.com/in/…"></label>
    <div class="row"><button class="btn pri" style="flex:1">Bul</button><button type="button" class="btn" id="oneQ" title="Arka planda bul">Kuyruğa</button></div></form><div id="oneRes" style="margin-top:12px"></div></div>`;
  const f = $('sf');
  const pre = sessionStorage.getItem('qs'); sessionStorage.removeItem('qs');
  const init = pre ? JSON.parse(pre) : lastSearch?.f;
  if (init) { for (const [k, v] of Object.entries(init)) if (f[k] && k !== 'page') f[k].value = v; if (pre) doSearch(init); else if (lastSearch) renderResults(lastSearch); }
  f.onsubmit = e => { e.preventDefault(); doSearch(Object.fromEntries(new FormData(f))); };
  $('sclear').onclick = () => { f.reset(); lastSearch = null; $('sres').innerHTML = ''; };
  const one = $('one');
  one.onsubmit = e => { e.preventDefault(); busyBtn(one.querySelector('button'), async () => {
    const r = await post('/api/lookup', Object.fromEntries(new FormData(one))), c = r.contact;
    $('oneRes').innerHTML = c ? `<div class="row">${pill(r.status)}<b>${esc(c.name)}</b><span class="mut">${esc(c.title)} · ${esc(c.company)}</span>${c.email ? `<span class="mail">${esc(c.email)}</span>` : ''}${li(c.linkedin)}<a href="#contacts">Kişilerim →</a></div>` : pill(r.status);
  }, 'Aranıyor'); };
  $('oneQ').onclick = tryT(async () => { const p = Object.fromEntries(new FormData(one)); if (!p.name && !p.linkedin) return toast('İsim veya LinkedIn gir', true); await post('/api/queue/lookup', { people: [p] }); toast('Kuyruğa alındı — bulununca Telegram\'a bildirim gelir'); one.reset(); });
};
async function doSearch(f) {
  $('sres').innerHTML = '<div class="card empty"><span class="spin"></span> Aranıyor…</div>';
  try { const r = await post('/api/search', f); lastSearch = { f, ...r }; renderResults(lastSearch); }
  catch (e) { $('sres').innerHTML = `<div class="card empty"><b>Arama yapılamadı</b><span class="err">${esc(e.message)}</span></div>`; }
}
const campOpts = (none = '— kampanyasız —') => `<option value="">${none}</option>` + CAMPS.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
function renderResults(r) {
  if (!r.profiles.length) return $('sres').innerHTML = empty('Sonuç yok', 'Filtreleri genişlet (ör. sadece unvan + lokasyon).');
  const mailCell = (p, i) => p.contact ? (p.contact.email ? `<span class="mail">${esc(p.contact.email)}</span>` : pill(p.contact.status))
    : `<button class="btn sm" data-find="${i}">Mail bul</button> ${p.teaser ? `<span class="pill pri">${esc(p.teaser)}</span>` : ''}`;
  $('sres').innerHTML = `<div class="row" style="margin-bottom:10px"><b>${r.total.toLocaleString('tr')} sonuç</b><span class="mut">sayfa ${r.page}/${r.pages}</span><span class="sp"></span>
    <button class="btn sm" id="pPrev" ${r.page <= 1 ? 'disabled' : ''}>‹ Önceki</button><button class="btn sm" id="pNext" ${r.page >= r.pages ? 'disabled' : ''}>Sonraki ›</button></div>
  <div class="tw"><table><thead><tr><th class="c"><input type="checkbox" id="rAll"></th><th>Kişi</th><th>Şirket</th><th class="hide-m">Lokasyon</th><th>LinkedIn</th><th>Mail</th><th></th></tr></thead><tbody>
  ${r.profiles.map((p, i) => `<tr data-i="${i}"><td class="c"><input type="checkbox" data-r="${i}"></td><td class="w"><div class="ent">${avatar(p.name)}<div><div class="n">${esc(p.name)}</div><small>${esc(p.title)}</small></div></div></td><td>${esc(p.company)}<small>${esc(p.domain || '')}</small></td>
    <td class="mut hide-m">${esc(p.location)}</td><td>${li(p.linkedin)}</td><td class="mc">${mailCell(p, i)}</td>
    <td class="fc">${p.contact ? `<button class="star ${p.contact.fav ? 'on' : ''}" data-fav="${p.contact.id}">★</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
  <div class="selbar"><b id="rN">Kişi seç</b><span class="sp"></span><select id="rCamp">${campOpts()}</select><button class="btn" id="rQ">⧗ Kuyruğa ekle (mail bul)</button></div>`;
  $('pPrev').onclick = () => doSearch({ ...r.f, page: r.page - 1 });
  $('pNext').onclick = () => doSearch({ ...r.f, page: r.page + 1 });
  const ids = () => [...document.querySelectorAll('#sres [data-r]:checked')].map(x => +x.dataset.r);
  $('sres').onchange = e => { if (e.target.id === 'rAll') document.querySelectorAll('#sres [data-r]').forEach(x => x.checked = e.target.checked); $('rN').textContent = ids().length ? ids().length + ' kişi seçili' : 'Kişi seç'; };
  $('rQ').onclick = tryT(async () => {
    const list = ids().map(i => r.profiles[i]); if (!list.length) return toast('Kişi seç', true);
    const res = await post('/api/queue/rr', { profiles: list, campaign_id: $('rCamp').value || null });
    toast(`${res.queued} kişi mail kuyruğuna eklendi`); list.forEach(p => p.contact = p.contact || { status: 'mail kuyrukta' }); renderResults(r);
  });
  $('sres').onclick = tryT(async e => {
    const b = e.target.closest('[data-find]');
    if (b) {
      const i = +b.dataset.find, p = r.profiles[i], tr = b.closest('tr'), cell = tr.querySelector('.mc');
      cell.innerHTML = '<span class="spin"></span> aranıyor…';
      try { const { contact: c } = await post('/api/lookup', { rr_id: p.rr_id }); p.contact = c ? { id: c.id, email: c.email, status: c.status, fav: false } : { status: 'bulunamadı' }; }
      catch (er) { p.contact = null; toast(er.message, true); }
      cell.innerHTML = mailCell(p, i); if (p.contact?.id) tr.querySelector('.fc').innerHTML = `<button class="star" data-fav="${p.contact.id}">★</button>`;
    }
    const s = e.target.closest('[data-fav]'); if (s) favToggle(s);
  });
}
async function favToggle(btn) { const r = await post(`/api/contacts/${btn.dataset.fav}/fav`); btn.classList.toggle('on', r.fav); toast(r.fav ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı'); }

// ================= Kişilerim / Favoriler =================
PAGES.favs = () => contactsPage(true);
PAGES.contacts = () => contactsPage(false);
function contactsPage(favOnly) {
  const addTo = sessionStorage.getItem('addToCamp');
  main.innerHTML = head(favOnly ? 'Favoriler' : 'Kişilerim', favOnly ? 'Yıldızladığın kişiler' : 'Ekibin bulduğu tüm kişiler — kampanyadan, aramadan ve Excel\'den', `<div class="tabs"><a href="#contacts" class="${favOnly ? '' : 'on'}">Tümü</a><a href="#favs" class="${favOnly ? 'on' : ''}">★ Favoriler</a></div>`) +
  `${addTo ? `<div class="banner info">Kampanyaya eklemek için kişileri seç ve aşağıdan "Kampanyaya ekle"ye bas. <a href="#" id="cancelAdd">vazgeç</a></div>` : ''}
  <div class="row" style="margin-bottom:12px"><input id="cq" placeholder="İsim, şirket, unvan, mail, sektör…" style="max-width:360px">
    <div class="tabs" id="cf"><button data-v="" class="on">Tümü</button><button data-v="1">Maili olan</button><button data-v="0">Maili olmayan</button></div><span class="sp"></span>
    <button class="btn sm" id="cexp">Excel indir</button></div><div id="clist"></div>`;
  if ($('cancelAdd')) $('cancelAdd').onclick = e => { e.preventDefault(); sessionStorage.removeItem('addToCamp'); route(); };
  let emailF = '', t;
  const load = tryT(async () => {
    const q = new URLSearchParams({ q: $('cq').value, email: emailF, fav: favOnly ? '1' : '' });
    $('cexp').onclick = () => location.href = '/api/contacts/export?' + q;
    renderContacts(await api('/api/contacts?' + q));
  });
  $('cq').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  $('cf').onclick = e => { const b = e.target.closest('button'); if (!b) return; emailF = b.dataset.v; $('cf').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); load(); };
  load();
}
function renderContacts(list) {
  if (!list.length) return $('clist').innerHTML = empty('Kayıt yok', '<a href="#search">Kişi Ara</a>, <a href="#bulk">Toplu Excel</a> veya bir kampanya ile kişi ekle.');
  const addTo = sessionStorage.getItem('addToCamp');
  $('clist').innerHTML = `<div class="tw"><table><thead><tr><th class="c"><input type="checkbox" id="call"></th><th class="c"></th><th>Kişi</th><th>Şirket</th><th>Mail</th><th class="hide-m">Telefon</th><th>LinkedIn</th><th class="hide-m">Kaynak</th><th></th></tr></thead><tbody>
  ${list.map(c => `<tr><td class="c"><input type="checkbox" data-sel="${c.id}" ${sel.has(c.id) ? 'checked' : ''}></td><td class="c"><button class="star ${c.fav ? 'on' : ''}" data-fav="${c.id}">★</button></td>
    <td class="w"><div class="ent">${avatar(c.name)}<div><div class="n">${esc(c.name)}</div><small>${esc(c.title)}</small></div></div></td><td>${esc(c.company)}<small>${esc(c.location)}</small></td>
    <td>${c.email ? `<span class="mail">${esc(c.email)}</span>${c.email_grade ? ` <span class="pill ok">${esc(c.email_grade)}</span>` : ''}` : `${pill(c.status)} <button class="btn sm ghost" data-edit="${c.id}" title="Elle mail ekle">✎</button>`}</td>
    <td class="mut hide-m">${esc(c.phones)}</td><td>${li(c.linkedin)}</td><td class="hide-m"><small>${esc(c.source)}${c.owner ? ' · ' + esc(c.owner) : ''}</small></td>
    <td><button class="icon" data-del="${c.id}" title="Sil">✕</button></td></tr>`).join('')}</tbody></table></div>
  <div class="selbar ${sel.size || addTo ? '' : 'hide'}" id="sbar"><b id="scount"></b><span class="sp"></span><button class="btn" data-a="clear">Temizle</button><button class="btn" data-a="lookup">🔎 Mail bul (kuyruk)</button>
    <select id="sCamp">${campOpts('— kampanya seç —')}</select><button class="btn" data-a="camp">Kampanyaya ekle</button><button class="btn" data-a="mail">✉ Mail yaz</button></div>`;
  if (addTo) $('sCamp').value = addTo;
  const upd = () => { $('sbar').classList.toggle('hide', !sel.size && !addTo); $('scount').textContent = sel.size + ' kişi seçili'; };
  upd();
  $('call').onchange = e => { document.querySelectorAll('[data-sel]').forEach(x => { x.checked = e.target.checked; sel[e.target.checked ? 'add' : 'delete'](+x.dataset.sel); }); upd(); };
  $('clist').onchange = e => { const x = e.target.closest('[data-sel]'); if (x) { sel[x.checked ? 'add' : 'delete'](+x.dataset.sel); upd(); } };
  $('clist').onclick = tryT(async e => {
    const f = e.target.closest('[data-fav]'); if (f) return favToggle(f);
    const d = e.target.closest('[data-del]'); if (d && confirm('Kişi silinsin mi?')) { await del('/api/contacts/' + d.dataset.del); d.closest('tr').remove(); return; }
    const ed = e.target.closest('[data-edit]'); if (ed) { const m = prompt('Mail adresi'); if (m) { await put('/api/contacts/' + ed.dataset.edit, { email: m.trim() }); ed.parentElement.innerHTML = `<span class="mail">${esc(m.trim())}</span>`; } return; }
    const a = e.target.closest('[data-a]'); if (!a) return;
    const ids = [...sel];
    if (a.dataset.a === 'clear') { sel.clear(); document.querySelectorAll('[data-sel]').forEach(x => x.checked = false); return upd(); }
    if (!ids.length) return toast('Önce kişi seç', true);
    if (a.dataset.a === 'lookup') { const r = await post('/api/queue/lookup', { contact_ids: ids }); toast(lookupMsg(r)); }
    if (a.dataset.a === 'camp') { const cid = $('sCamp').value; if (!cid) return toast('Kampanya seç', true); const r = await post(`/api/campaigns/${cid}/leads`, { contact_ids: ids }); toast(`${r.added} kişi kampanyaya eklendi`); sessionStorage.removeItem('addToCamp'); sel.clear(); location.hash = `c/${cid}/people`; }
    if (a.dataset.a === 'mail') composeModal(list.filter(c => sel.has(c.id) && c.email).map(c => c.id), $('sCamp').value || null);
  });
}

// ================= Toplu Excel =================
const stateTr = s => ({ queued: 'sırada', running: 'çalışıyor', paused: 'limit – bekliyor', done: 'bitti', cancelled: 'durduruldu' }[s] || s);
PAGES.bulk = tryT(async id => {
  if (id) return jobPage(+id);
  main.innerHTML = head('Toplu Excel', 'Excel yükle, isim + şirket sütununu seç. Her kişi bulunup mailiyle kaydedilir; sayfayı kapatsan da arka planda devam eder.') +
  `<div class="card"><h3>Yeni dosya</h3><p class="hint">.xlsx, .xls veya .csv</p><input type="file" id="file" accept=".xlsx,.xls,.csv"><div id="map" style="margin-top:14px"></div></div>
  <div class="card"><h3 style="margin-bottom:12px">İşler</h3><div id="jobs"></div></div>`;
  $('file').onchange = tryT(async () => {
    const fd = new FormData(); fd.append('file', $('file').files[0]);
    const u = await api('/api/jobs/upload', { method: 'POST', body: fd });
    const opt = (cols, v) => '<option value="">— yok —</option>' + cols.map(c => `<option ${c === v ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('map').innerHTML = `<div class="grid g3" style="align-items:end"><label>Sayfa<select id="msh">${u.sheets.map(s => `<option value="${esc(s.name)}">${esc(s.name)} (${s.count} satır)</option>`).join('')}</select></label>
      <label>İsim sütunu<select id="mn"></select></label><label>Şirket sütunu<select id="mc"></select></label><label>LinkedIn sütunu<select id="ml"></select></label>
      <label>Satır sınırı (boş = hepsi)<input id="mlim" type="number" min="1"></label><button class="btn pri" id="mgo">Başlat</button></div>`;
    const fillCols = () => { const s = u.sheets.find(x => x.name === $('msh').value); $('mn').innerHTML = opt(s.cols, s.guess.name); $('mc').innerHTML = opt(s.cols, s.guess.company); $('ml').innerHTML = opt(s.cols, s.guess.linkedin); };
    $('msh').onchange = fillCols; fillCols();
    $('mgo').onclick = tryT(async () => {
      if (!$('mn').value && !$('ml').value) return toast('İsim veya LinkedIn sütunu seç', true);
      const r = await post('/api/jobs', { key: u.key, sheet: $('msh').value, limit: $('mlim').value, map: { name: $('mn').value, company: $('mc').value, linkedin: $('ml').value } });
      location.hash = 'bulk/' + r.id;
    });
  });
  const loadJobs = async () => {
    const jobs = await api('/api/jobs');
    $('jobs').innerHTML = jobs.length ? `<div class="tw"><table><thead><tr><th>Dosya</th><th>İlerleme</th><th>Mail</th><th>Durum</th><th class="hide-m">Başlatan</th><th class="hide-m">Tarih</th></tr></thead><tbody>
      ${jobs.map(j => `<tr style="cursor:pointer" onclick="location.hash='bulk/${j.id}'"><td class="n">${esc(j.file)}</td><td style="min-width:140px"><div class="bar"><i style="width:${j.total ? j.done / j.total * 100 : 0}%"></i></div><small>${j.done}/${j.total}</small></td>
      <td><b style="color:var(--ok)">${j.found}</b></td><td>${pill(stateTr(j.state))}</td><td class="hide-m">${esc(j.user)}</td><td class="mut hide-m">${fmtDate(j.created)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Henüz iş yok</p>';
  };
  await loadJobs(); timer = setInterval(tryT(loadJobs), 5000);
});
async function jobPage(id) {
  const draw = async () => {
    const j = await api('/api/jobs/' + id);
    const pct = j.total ? Math.round(j.done / j.total * 100) : 0;
    main.innerHTML = `<p style="margin:0 0 8px"><a href="#bulk">← Toplu Excel</a></p>` + head(esc(j.file), `${pill(stateTr(j.state))} ${esc(j.note || '')}`) +
    `<div class="card"><div class="row"><div class="sp"><div class="bar"><i style="width:${pct}%"></i></div></div><b>%${pct}</b></div>
      <div class="grid g4" style="margin-top:14px"><div><b style="font-size:22px">${j.done}/${j.total}</b><div class="mut">işlenen</div></div>
      <div><b style="font-size:22px;color:var(--ok)">${j.found}</b><div class="mut">mail bulundu</div></div>
      <div><b style="font-size:22px">${j.rows.filter(r => r.cid && !r.email).length}</b><div class="mut">profil var, mail yok</div></div>
      <div><b style="font-size:22px;color:var(--bad)">${j.rows.filter(r => r.status && !r.cid).length}</b><div class="mut">bulunamadı / emin değil</div></div></div>
      <div class="row" style="margin-top:16px"><a class="btn pri" href="/api/jobs/${id}/download">Excel indir</a><button class="btn" id="toC">Bulunanları seç → Kişilerim</button>
        ${['running', 'queued', 'paused'].includes(j.state) ? '<button class="btn" id="jc">Durdur</button>' : `${j.state === 'cancelled' ? '<button class="btn" id="jres">Devam ettir</button>' : ''}<button class="btn" id="jr">Bulunamayanları tekrar dene</button>`}
        <span class="sp"></span><button class="btn danger" id="jd">İşi sil</button></div></div>
    <div class="tw"><table><thead><tr><th>#</th><th>Excel'deki</th><th>Bulunan kişi</th><th>Mail</th><th>LinkedIn</th><th>Durum</th></tr></thead><tbody>
    ${j.rows.map(r => { const q = JSON.parse(r.q); return `<tr><td class="mut">${r.idx + 1}</td><td><div class="n">${esc(q.name)}</div><small>${esc(q.company)}</small></td>
      <td>${r.cid ? `${esc(r.name)}<small>${esc(r.title)} · ${esc(r.company)}</small>` : ''}</td><td>${r.email ? `<span class="mail">${esc(r.email)}</span>` : ''}</td>
      <td>${li(r.linkedin)}</td><td>${r.status ? pill(r.status) : (j.state === 'running' ? '<span class="spin"></span>' : '<span class="pill">sırada</span>')}</td></tr>`; }).join('')}</tbody></table></div>`;
    $('toC').onclick = () => { j.rows.forEach(r => r.cid && sel.add(r.cid)); location.hash = 'contacts'; };
    if ($('jc')) $('jc').onclick = tryT(async () => { await post(`/api/jobs/${id}/cancel`); draw(); });
    if ($('jr')) $('jr').onclick = tryT(async () => { await post(`/api/jobs/${id}/retry`); draw(); });
    if ($('jres')) $('jres').onclick = tryT(async () => { await post(`/api/jobs/${id}/resume`); draw(); });
    $('jd').onclick = tryT(async () => { if (confirm('İş silinsin mi? (Bulunan kişiler Kişilerim\'de kalır)')) { await del('/api/jobs/' + id); location.hash = 'bulk'; } });
  };
  await draw(); timer = setInterval(tryT(draw), 6000);
}

// ================= İş kuyruğu =================
const TT = { ai_companies: '🏭 AI firma bulma', company_people: '👥 Firmada kişi arama', lookup: '🔎 Mail bulma', manual_find: '🔎 Kişi bulma', draft: '✨ AI mail taslağı' };
const tasksTable = list => list.length ? `<div class="tw" style="max-height:60vh"><table><thead><tr><th>İş</th><th>Durum</th><th>Sonuç</th><th>Zaman</th></tr></thead><tbody>
  ${list.map(t => `<tr><td>${TT[t.type] || t.type}${t.campaign ? `<small>${esc(t.campaign)}</small>` : ''}</td><td>${pill(t.status)}</td><td><small>${esc(t.result)}</small></td><td class="mut">${ago(t.done_at || t.created)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">İş yok</p>';
PAGES.queue = tryT(async () => {
  const draw = async () => {
    const [t, jobs] = await Promise.all([api('/api/tasks'), api('/api/jobs')]);
    const by = {}; for (const c of t.counts) (by[c.type] ||= {})[c.status] = c.n;
    main.innerHTML = head('İş Kuyruğu', 'Arka planda sırayla çalışan işler. RocketReach limiti dolunca bekler, açılınca kendiliğinden devam eder.',
      `<button class="btn sm" id="qRetry">Hatalıları tekrar dene</button><button class="btn sm" id="qClean">Bitenleri temizle</button><button class="btn sm danger" id="qDrop">Sıradakileri iptal et</button>`) +
    `${t.limits.lookup || t.limits.arama ? `<div class="banner">⏳ RocketReach limit — lookup: ${t.limits.lookup ? t.limits.lookup + ' dk' : 'açık'}, arama: ${t.limits.arama ? t.limits.arama + ' dk' : 'açık'}</div>` : ''}
    <div class="grid g5 kpis" style="margin-bottom:16px">${Object.keys(TT).filter(k => k !== 'manual_find').map(k => `<div class="card kpi"><b>${(by[k]?.['sırada'] || 0) + (by[k]?.['çalışıyor'] || 0)}</b><span>${TT[k]} bekliyor</span></div>`).join('')}
      <div class="card kpi"><b>${jobs.filter(j => ['queued', 'running', 'paused'].includes(j.state)).length}</b><span>⇪ Excel işi</span></div></div>
    <div class="card"><h3 style="margin-bottom:12px">Son işler</h3>${tasksTable(t.recent)}</div>`;
    $('qRetry').onclick = tryT(async () => { await post('/api/tasks/clear', { what: 'retry' }); draw(); });
    $('qClean').onclick = tryT(async () => { await post('/api/tasks/clear', { what: 'done' }); draw(); });
    $('qDrop').onclick = tryT(async () => { if (confirm('Sıradaki tüm işler iptal edilsin mi?')) { await post('/api/tasks/clear', { what: 'queued' }); draw(); } });
  };
  await draw(); timer = setInterval(tryT(draw), 8000);
});

// ================= Gönderim takvimi =================
const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
PAGES.schedule = tryT(async () => {
  const [s, st] = await Promise.all([api('/api/settings'), api('/api/sending')]), sc = s.schedule;
  main.innerHTML = head('Gönderim Takvimi', 'Gmail\'den ban yememek için mailler insan gibi gönderilir: mesai saatinde, günlük limitle, aralarında rastgele bekleme ile.') +
  `<div class="grid g2" style="align-items:start"><div class="card"><h3>Kurallar</h3><p class="hint">Önerilen: yeni Gmail hesabında günde 20–30, ısınmış hesapta 40–60. Workspace hesabında 100'ü geçme.</p>
    <label>Gönderim günleri</label><div class="chips" id="sDays" style="margin:6px 0 14px">${[1, 2, 3, 4, 5, 6, 0].map(d => `<span class="chip sug ${sc.days.includes(d) ? 'on' : ''}" data-d="${d}">${DAYS[d]}</span>`).join('')}</div>
    <div class="grid g2"><label>Başlangıç saati<input type="number" id="sStart" min="0" max="23" value="${sc.start}"></label><label>Bitiş saati<input type="number" id="sEnd" min="1" max="24" value="${sc.end}"></label>
    <label>Günlük maksimum mail<input type="number" id="sDaily" min="1" max="500" value="${sc.daily}"></label><div></div>
    <div class="toggle-row" style="grid-column:1/-1"><div><b>Isınma modu (önerilir)</b><small>Yeni hesapta günde 10 mail ile başlar, her gün +3 artar; günlük limite ulaşınca sabitlenir.</small></div><label class="switch"><input type="checkbox" id="sWarm" ${sc.warmup !== false ? 'checked' : ''}><i></i></label></div>
    <div class="toggle-row" style="grid-column:1/-1"><div><b>🛡️ Güvenli mod (önerilir)</b><small>Sadece RocketReach'in doğruladığı (geçerli, A/B notlu) adreslere gönderir. Geri dönen mail = ban riski; bu en etkili koruma.</small></div><label class="switch"><input type="checkbox" id="sSafe" ${sc.safe_mode !== false ? 'checked' : ''}><i></i></label></div>
    <div class="toggle-row" style="grid-column:1/-1"><div><b>İlk mailde sade imza</b><small>İlk mailde logo ve link olmadan düz metin imza; takip ve cevaplarda tam imza. Spam puanını düşürür.</small></div><label class="switch"><input type="checkbox" id="sPlain" ${sc.plain_first !== false ? 'checked' : ''}><i></i></label></div>
    <div class="toggle-row" style="grid-column:1/-1"><div><b>Çıkış cümlesi</b><small>İlk maile "uygun değilse yazmanız yeterli, tekrar rahatsız etmem" eklenir. Spam şikâyetini azaltır.</small></div><label class="switch"><input type="checkbox" id="sOpt" ${sc.optout !== false ? 'checked' : ''}><i></i></label></div>
    <label>Aynı firmaya günde en fazla<input type="number" id="sDom" min="1" max="10" value="${sc.per_domain || 2}"></label><div></div>
    <label>Mailler arası en az (sn)<input type="number" id="sMin" min="20" value="${sc.min_delay}"></label><label>En fazla (sn)<input type="number" id="sMax" min="20" value="${sc.max_delay}"></label></div>
    <div class="toggle-row" style="margin-top:14px"><div><b>Gönderimi duraklat</b><small>Tüm kuyruk bekler</small></div><label class="switch"><input type="checkbox" id="sPause" ${s.sending_paused ? 'checked' : ''}><i></i></label></div>
    <button class="btn pri" id="sSave" style="margin-top:10px" ${ME.role !== 'admin' ? 'disabled title="Yönetici"' : ''}>Kaydet</button></div>
  <div><div class="card"><h3 style="margin-bottom:12px">Şu an</h3><dl class="dl"><dt>Durum</dt><dd>${st.ok ? '<span class="pill ok">● Gönderiyor</span>' : `<span class="pill warn">${esc(st.why)}</span>`}</dd>
    <dt>Bugün gönderilen</dt><dd>${st.today} / ${st.daily}${st.warmup ? ` <span class="pill info">ısınma · hedef ${st.max}</span>` : ''}</dd><dt>Sırada</dt><dd>${st.queued}</dd><dt>Taslak</dt><dd>${st.counts['taslak'] || 0}</dd><dt>Toplam gönderilen</dt><dd>${st.counts['gönderildi'] || 0}</dd><dt>Hatalı</dt><dd>${st.counts['hata'] || 0}</dd></dl>
    <div class="row" style="margin-top:14px"><a href="#outbox/sırada" class="btn sm">Kuyruğu gör</a><button class="btn sm" id="sReply">Yanıtları şimdi kontrol et</button></div></div>
    <div class="card"><h3>Ban yememek için</h3><ul class="mut" style="margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.7">
      <li>Gmail'de 2 adımlı doğrulama + <b>uygulama şifresi</b> kullan.</li><li><b>Isınma modu</b> yeni hesapta yavaş başlar; <b>aynı firmaya günde 2</b>'den fazla mail gitmez.</li>
      <li>Aynı kişiye 60 gün içinde ikinci ilk-mail gitmez. Geri dönen (bounce) adresler otomatik engellenir; 24 saatte 3 geri dönüşte gönderim kendini durdurur.</li><li>Kişiye özel, kısa, linksiz ilk mail (AI böyle yazıyor).</li>
      <li>Yanıt gelen kişiye takip otomatik durur (gelen kutusu 5 dk'da bir taranır).</li><li>Engel listesindeki adres/domainlere asla gönderilmez.</li>
      <li>Kendi alan adınla (Workspace) gönderirsen SPF/DKIM/DMARC ayarlı olsun.</li></ul></div></div></div>`;
  main.onclick = e => { const d = e.target.closest('[data-d]'); if (d) d.classList.toggle('on'); };
  $('sReply').onclick = e => busyBtn(e.currentTarget, async () => { await post('/api/sending/check-replies'); toast('Gelen kutusu tarandı'); }, 'Taranıyor');
  $('sSave').onclick = e => busyBtn(e.currentTarget, async () => {
    const days = [...document.querySelectorAll('#sDays .on')].map(x => +x.dataset.d);
    await put('/api/settings', { schedule: { days, start: +$('sStart').value, end: +$('sEnd').value, daily: +$('sDaily').value, min_delay: +$('sMin').value, max_delay: +$('sMax').value, warmup: $('sWarm').checked, per_domain: +$('sDom').value, safe_mode: $('sSafe').checked, plain_first: $('sPlain').checked, optout: $('sOpt').checked }, sending_paused: $('sPause').checked });
    toast('Takvim kaydedildi'); PAGES.schedule();
  }, 'Kaydediliyor');
});

// ================= Engel listesi =================
PAGES.suppress = tryT(async () => {
  const list = await api('/api/suppress');
  const people = list.filter(x => x.type !== 'domain'), doms = list.filter(x => x.type === 'domain');
  const tbl = l => l.length ? `<div class="tw" style="max-height:340px;margin-top:12px"><table><tbody>${l.map(x => `<tr><td><span class="pill">${x.type}</span> ${esc(x.value)}</td><td class="mut">${fmtDate(x.created)}</td><td style="text-align:right"><button class="icon" data-sd="${x.id}">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Liste boş</p>';
  main.innerHTML = head('Engel Listesi', 'Tüm ekip ve kampanyalar için tek liste. Kuyruktaki mailler de iptal edilir, sadece gelecektekiler değil.') +
  `<div class="grid g2" style="align-items:start"><div class="card"><h3>Kişiler</h3><p class="hint">Asla mail atılmayacak kişiler — mail, LinkedIn linki veya "Ad Soyad|Şirket".</p>
    <textarea id="spP" rows="4" placeholder="ali@firma.com&#10;linkedin.com/in/ali-veli"></textarea><div class="row" style="margin-top:10px"><button class="btn pri" id="spPAdd">Ekle</button><label class="btn">CSV/Excel yükle<input type="file" id="spPF" accept=".csv,.xlsx,.xls" hidden></label></div>${tbl(people)}</div>
  <div class="card"><h3>Firmalar</h3><p class="hint">Alan adını ekle; o firmada çalışan kimseye mail gitmez, AI da o firmayı önermez.</p>
    <textarea id="spD" rows="4" placeholder="acme.com veya bütün listeyi yapıştır"></textarea><div class="row" style="margin-top:10px"><button class="btn pri" id="spDAdd">Ekle</button><label class="btn">CSV/Excel yükle<input type="file" id="spDF" accept=".csv,.xlsx,.xls" hidden></label></div>${tbl(doms)}</div></div>`;
  const add = (type, el) => tryT(async () => { const r = await post('/api/suppress', { text: $(el).value, type }); toast(r.added + ' kayıt eklendi'); PAGES.suppress(); });
  $('spPAdd').onclick = add('auto', 'spP'); $('spDAdd').onclick = add('domain', 'spD');
  const up = (type, el) => tryT(async () => { const fd = new FormData(); fd.append('file', $(el).files[0]); fd.append('type', type); const r = await api('/api/suppress/upload', { method: 'POST', body: fd }); toast(r.added + ' kayıt eklendi'); PAGES.suppress(); });
  $('spPF').onchange = up('auto', 'spPF'); $('spDF').onchange = up('domain', 'spDF');
  main.onclick = tryT(async e => { const d = e.target.closest('[data-sd]'); if (d) { await del('/api/suppress/' + d.dataset.sd); d.closest('tr').remove(); } });
});

// ================= Geçmiş =================
const FL = { name: 'İsim', company: 'Şirket', title: 'Unvan', industry: 'Sektör', location: 'Lokasyon', keyword: 'Kelime', domain: 'Alan adı' };
PAGES.history = tryT(async () => {
  const h = await api('/api/history');
  main.innerHTML = head('Arama Geçmişi', 'Ekibin yaptığı aramalar. "Tekrar ara" ile aynı aramayı çalıştır.', '<a class="btn" href="#search">← Kişi Ara</a>') +
  (h.length ? `<div class="tw"><table><thead><tr><th>Arama</th><th>Sonuç</th><th class="hide-m">Kim</th><th>Ne zaman</th><th></th></tr></thead><tbody>
  ${h.map(s => { const f = JSON.parse(s.params); return `<tr><td><div class="chips">${Object.entries(f).filter(([k, v]) => v && k !== 'page').map(([k, v]) => `<span class="pill pri">${FL[k] || k}: ${esc(v)}</span>`).join('')}</div></td>
    <td>${(s.total || 0).toLocaleString('tr')}</td><td class="hide-m">${esc(s.user)}</td><td class="mut">${fmtDate(s.created)}</td>
    <td style="white-space:nowrap"><button class="btn sm" data-re="${esc(s.params)}">Tekrar ara</button><button class="icon" data-hdel="${s.id}">✕</button></td></tr>`; }).join('')}</tbody></table></div>` : empty('Henüz arama yok'));
  main.onclick = tryT(async e => {
    const r = e.target.closest('[data-re]'); if (r) { const f = JSON.parse(r.dataset.re); delete f.page; sessionStorage.setItem('qs', JSON.stringify(f)); location.hash = 'search'; }
    const d = e.target.closest('[data-hdel]'); if (d) { await del('/api/history/' + d.dataset.hdel); d.closest('tr').remove(); }
  });
});

// ================= Entegrasyonlar =================
const EVT = [['found', 'Kişi/mail bulundu'], ['company', 'Firma bulundu'], ['sent', 'Mail gönderildi'], ['reply', 'Yanıt geldi'], ['job', 'İş bitti'], ['limit', 'Limit uyarısı'], ['error', 'Hata']];
PAGES.settings = tryT(async () => {
  const s = await api('/api/settings'), adm = ME.role === 'admin', me = (await api('/api/me')).user;
  const dis = adm ? '' : 'disabled';
  const mute = String(s.tg_mute || '').split(',');
  main.innerHTML = head('Entegrasyonlar', adm ? 'API anahtarları ve bağlantılar tüm ekip için ortaktır. Anahtarlar sunucuda saklanır, tarayıcıya gönderilmez.' : 'API/Gmail/Telegram ayarlarını yalnızca yönetici değiştirebilir.') +
  `<div class="grid g2" style="align-items:start"><div>
    <div class="card"><div class="card-h"><h3>RocketReach</h3>${s.rr_key ? '<span class="pill ok">bağlı</span>' : '<span class="pill bad">yok</span>'}</div>
      <p class="mut" style="margin-top:0;font-size:13px">Kayıtlı: <b>${esc(s.rr_key) || '—'}</b></p>${adm ? '<label>Yeni API key<input id="rk" placeholder="değiştirmek için yapıştır" autocomplete="off"></label>' : ''}
      <div class="row" style="margin-top:12px">${adm ? '<button class="btn pri" id="rks">Kaydet</button>' : ''}<button class="btn" id="rkt">Bağlantıyı test et</button></div><p id="rki" class="mut" style="margin:10px 0 0"></p></div>
    <div class="card"><div class="card-h"><h3>OpenAI (ChatGPT)</h3>${s.openai_key ? '<span class="pill ok">bağlı</span>' : '<span class="pill bad">yok</span>'}</div><p class="hint">Firma bulma (web araması), kampanya hedefleme ve mail yazımı.</p>
      <p class="mut" style="margin-top:0;font-size:13px">Kayıtlı: <b>${esc(s.openai_key) || '—'}</b></p>
      <div class="grid g2">${adm ? '<label>Yeni API key<input id="ok" placeholder="sk-…" autocomplete="off"></label>' : ''}<label>Model<select id="om" ${dis}>${['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o', 'gpt-5-mini', 'gpt-5'].map(m => `<option ${s.openai_model === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
      <div class="row" style="margin-top:12px">${adm ? '<button class="btn pri" id="oks">Kaydet</button>' : ''}<button class="btn" id="okt">Test et</button></div><p id="oki" class="mut" style="margin:10px 0 0"></p></div>
    <div class="card"><div class="card-h"><h3>Telegram bildirimleri</h3>${s.tg_token && s.tg_chat ? '<span class="pill ok">bağlı</span>' : '<span class="pill bad">yok</span>'}</div>
      <p class="hint">1) Telegram'da <b>@BotFather</b> → /newbot → token'ı kopyala. 2) Botu grubuna ekle ve gruba bir mesaj yaz. 3) "Chat'leri bul"a bas, grubu seç.</p>
      <div class="grid"><label>Bot token<input id="tt" placeholder="${s.tg_token ? esc(s.tg_token) + ' (kayıtlı)' : '123456:ABC-…'}" ${dis} autocomplete="off"></label>
      <label>Chat / grup ID<div class="row"><input id="tc" value="${esc(s.tg_chat)}" placeholder="-100…" style="flex:1" ${dis}><button class="btn sm" id="tfind" ${dis}>Chat'leri bul</button></div></label><div id="tchats"></div>
      <label>Bildirim türleri</label><div class="chips" id="tmute">${EVT.map(([k, l]) => `<span class="chip sug ${mute.includes(k) ? '' : 'on'}" data-ev="${k}">${l}</span>`).join('')}</div></div>
      <div class="row" style="margin-top:12px">${adm ? '<button class="btn pri" id="tsave">Kaydet</button>' : ''}<button class="btn" id="ttest">Test mesajı gönder</button><button class="btn" id="wrep">📊 Haftalık raporu gönder</button></div>
      <p class="mut" style="font-size:12px;margin:10px 0 0">Haftalık özet her pazartesi 09:00'da, "bugün geri aranacaklar" her iş günü 09:00'da otomatik gelir.</p></div>
  </div><div>
    <div class="card" id="sendersCard"></div>
    <div class="card" id="autoCard"></div>
    <div class="card" id="dhCard"></div>
    <div class="card"><h3>İmzam</h3><p class="hint">Gönderdiğin her mailin altına eklenir. HTML kullanabilirsin (logo için &lt;img src="https://…" height="40"&gt;).</p>
      <textarea id="sig" rows="6" placeholder="Emre Yıldız&lt;br&gt;Hype Vision · hypevisionlab.com&lt;br&gt;+90 …">${esc(me.signature)}</textarea><div class="preview" id="sigp" style="margin-top:10px;min-height:50px"></div>
      <button class="btn pri" id="sigs" style="margin-top:12px">İmzayı kaydet</button></div>
    <div class="card"><h3>Hesabım</h3><div class="grid g2" style="margin-top:12px"><label>Ad<input id="myn" value="${esc(me.name)}"></label><label>Yeni şifre<input id="myp" type="password" placeholder="boş = değişmez" autocomplete="new-password"></label></div>
      <button class="btn pri" id="mys" style="margin-top:12px">Kaydet</button></div>
  </div></div>`;
  const sp = () => $('sigp').innerHTML = $('sig').value || '<span style="color:#999">İmza yok</span>';
  $('sig').oninput = sp; sp();
  $('sigs').onclick = tryT(async () => { await put('/api/me', { signature: $('sig').value }); toast('İmza kaydedildi'); });
  $('mys').onclick = tryT(async () => { await put('/api/me', { name: $('myn').value, password: $('myp').value }); toast('Kaydedildi'); boot(); });
  $('rkt').onclick = e => busyBtn(e.currentTarget, async () => {
    try { const a = await api('/api/account'); $('rki').innerHTML = `<span class="pill ok">Bağlı</span> ${esc(a.email)}<br><small>${esc((a.credit_usage || []).filter(x => x.allocated !== 0 && x.allocated !== '0').map(x => `${x.credit_type}: ${x.remaining}`).join(' · '))}</small>`; }
    catch (er) { $('rki').innerHTML = `<span class="pill bad">${esc(er.message)}</span>`; }
  }, 'Test');
  $('okt').onclick = e => busyBtn(e.currentTarget, async () => {
    try { const r = await post('/api/test/openai'); $('oki').innerHTML = `<span class="pill ok">Çalışıyor</span> ${esc(r.text)}`; } catch (er) { $('oki').innerHTML = `<span class="pill bad">${esc(er.message)}</span>`; }
  }, 'Test');
  renderSenders($('sendersCard')); renderDomain($('dhCard')); autoCard($('autoCard'));
  $('wrep').onclick = e => busyBtn(e.currentTarget, async () => { await post('/api/report/weekly'); toast('Haftalık rapor Telegram\'a gönderildi'); }, 'Gönderiliyor');
  $('ttest').onclick = e => busyBtn(e.currentTarget, async () => { await post('/api/test/telegram', { token: $('tt').value.trim(), chat: $('tc').value.trim() }); toast('Telegram mesajı gönderildi ✓'); }, 'Gönderiliyor');
  $('tmute').onclick = e => { const c = e.target.closest('[data-ev]'); if (c && adm) c.classList.toggle('on'); };
  if (adm) {
    $('rks').onclick = tryT(async () => { if (!$('rk').value.trim()) return toast('Key gir', true); await put('/api/settings', { rr_key: $('rk').value }); toast('Kaydedildi'); PAGES.settings(); });
    $('oks').onclick = tryT(async () => { await put('/api/settings', { openai_key: $('ok').value, openai_model: $('om').value }); toast('Kaydedildi'); PAGES.settings(); });
    $('tsave').onclick = tryT(async () => {
      const off = [...document.querySelectorAll('#tmute [data-ev]:not(.on)')].map(x => x.dataset.ev).join(',');
      await put('/api/settings', { tg_token: $('tt').value, tg_chat: $('tc').value, tg_mute: off }); toast('Telegram kaydedildi'); PAGES.settings();
    });
    $('tfind').onclick = e => busyBtn(e.currentTarget, async () => {
      const r = await post('/api/test/telegram/chats', { token: $('tt').value.trim() });
      $('tchats').innerHTML = r.length ? `<div class="chips">${r.map(c => `<span class="chip sug" data-chat="${esc(c.id)}">${esc(c.name)} · ${esc(c.id)}</span>`).join('')}</div>` : '<p class="mut" style="margin:0">Mesaj bulunamadı — botu gruba ekleyip gruba bir mesaj yaz, tekrar dene.</p>';
      $('tchats').onclick = ev => { const c = ev.target.closest('[data-chat]'); if (c) $('tc').value = c.dataset.chat; };
    }, 'Aranıyor');
  }
});

// ================= Kullanıcılar =================
PAGES.users = tryT(async () => {
  if (ME.role !== 'admin') return (location.hash = 'dash');
  const us = await api('/api/users');
  main.innerHTML = head('Kullanıcılar', 'Ekip üyelerini ekle, yetki ver, şifre sıfırla. Yönetici: API/Gmail/Telegram ayarları + kullanıcı yönetimi.') +
  `<form class="card" id="nu"><h3 style="margin-bottom:12px">Yeni kullanıcı</h3><div class="grid g4" style="align-items:end">
    <label>Kullanıcı adı<input name="username" required autocapitalize="none"></label><label>Ad Soyad<input name="name"></label>
    <label>Şifre<input name="password" required autocomplete="new-password"></label><label>Rol<select name="role"><option value="user">Kullanıcı</option><option value="admin">Yönetici</option></select></label></div>
    <button class="btn pri" style="margin-top:12px">Ekle</button></form>
  <div class="tw"><table><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Durum</th><th class="hide-m">Eklenme</th><th></th></tr></thead><tbody>
  ${us.map(u => `<tr><td><div class="n">${esc(u.name)}</div><small>@${esc(u.username)}</small></td>
    <td><select data-role="${u.id}" style="width:auto">${['user', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r === 'admin' ? 'Yönetici' : 'Kullanıcı'}</option>`).join('')}</select></td>
    <td>${pill(u.active ? 'aktif' : 'pasif')}</td><td class="mut hide-m">${fmtDate(u.created)}</td>
    <td style="white-space:nowrap;text-align:right"><button class="btn sm" data-pw="${u.id}">Şifre</button> ${u.id !== ME.id ? `<button class="btn sm" data-act="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? 'Pasifleştir' : 'Aktifleştir'}</button> <button class="icon" data-udel="${u.id}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $('nu').onsubmit = tryT(async e => { e.preventDefault(); await post('/api/users', Object.fromEntries(new FormData(e.target))); toast('Kullanıcı eklendi'); PAGES.users(); });
  main.onchange = tryT(async e => { const r = e.target.closest('[data-role]'); if (r) { await put('/api/users/' + r.dataset.role, { role: r.value }); toast('Rol güncellendi'); } });
  main.onclick = tryT(async e => {
    const p = e.target.closest('[data-pw]'); if (p) { const pw = prompt('Yeni şifre'); if (pw) { await put('/api/users/' + p.dataset.pw, { password: pw }); toast('Şifre güncellendi'); } }
    const a = e.target.closest('[data-act]'); if (a) { await put('/api/users/' + a.dataset.act, { active: +a.dataset.v }); PAGES.users(); }
    const d = e.target.closest('[data-udel]'); if (d && confirm('Kullanıcı silinsin mi?')) { await del('/api/users/' + d.dataset.udel); PAGES.users(); }
  });
});


// ---------- görsel yardımcılar ----------
const favicon = d => d ? `<img class="fav" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'fav fb',textContent:'${esc(String(d)[0] || '?').toUpperCase()}'}))">` : '<span class="fav fb">?</span>';
const AVC = ['#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#14b8a6'];
const avatar = n => { n = String(n || '?').trim(); const i = n.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `<span class="avt" style="--c:${AVC[h % AVC.length]}">${esc(i)}</span>`; };
const ISO = { 'Türkiye':'tr','Almanya':'de','Avusturya':'at','İsviçre':'ch','Hollanda':'nl','Belçika':'be','Fransa':'fr','İtalya':'it','İspanya':'es','Polonya':'pl','Çekya':'cz','Romanya':'ro','Bulgaristan':'bg','Macaristan':'hu','İngiltere':'gb','Birleşik Krallık':'gb','İrlanda':'ie','İsveç':'se','Danimarka':'dk','Norveç':'no','ABD':'us','Amerika':'us','Kanada':'ca','Meksika':'mx','Brezilya':'br','BAE':'ae','Suudi Arabistan':'sa','Katar':'qa','Mısır':'eg','Fas':'ma','Azerbaycan':'az','Kazakistan':'kz','Özbekistan':'uz','Gürcistan':'ge','Irak':'iq','Hindistan':'in','Endonezya':'id','Malezya':'my','Güney Afrika':'za','Yunanistan':'gr','Sırbistan':'rs','Slovakya':'sk','Slovenya':'si','Hırvatistan':'hr','Portekiz':'pt','Finlandiya':'fi','Ukrayna':'ua','Rusya':'ru','Çin':'cn','Japonya':'jp','Güney Kore':'kr','Vietnam':'vn','Tayland':'th' };
const flagImg = c => ISO[c] ? `<img class="flagi" src="https://flagcdn.com/w40/${ISO[c]}.png" alt="${c}" loading="lazy">` : '🌍';
const FLAG = { 'Türkiye': '🇹🇷', 'Almanya': '🇩🇪', 'Avusturya': '🇦🇹', 'İsviçre': '🇨🇭', 'Hollanda': '🇳🇱', 'Belçika': '🇧🇪', 'Fransa': '🇫🇷', 'İtalya': '🇮🇹', 'İspanya': '🇪🇸', 'Polonya': '🇵🇱', 'Çekya': '🇨🇿', 'Romanya': '🇷🇴', 'Bulgaristan': '🇧🇬', 'Macaristan': '🇭🇺', 'İngiltere': '🇬🇧', 'İrlanda': '🇮🇪', 'İsveç': '🇸🇪', 'Danimarka': '🇩🇰', 'Norveç': '🇳🇴', 'ABD': '🇺🇸', 'Kanada': '🇨🇦', 'Meksika': '🇲🇽', 'Brezilya': '🇧🇷', 'BAE': '🇦🇪', 'Suudi Arabistan': '🇸🇦', 'Katar': '🇶🇦', 'Mısır': '🇪🇬', 'Fas': '🇲🇦', 'Azerbaycan': '🇦🇿', 'Kazakistan': '🇰🇿', 'Özbekistan': '🇺🇿', 'Gürcistan': '🇬🇪', 'Irak': '🇮🇶', 'Hindistan': '🇮🇳', 'Endonezya': '🇮🇩', 'Malezya': '🇲🇾', 'Güney Afrika': '🇿🇦' };
const PTYPES = ['OSGB (ortak sağlık güvenlik birimi)', 'İSG danışmanlık firması', 'CCTV / güvenlik sistemleri entegratörü', 'Endüstriyel otomasyon firması', 'MES / ERP / İSG yazılımı firması', 'Elektrik-elektronik taahhüt firması'];
const COUNTS = [10, 20, 40, 60, 100, 150, 200];
const ico = (id, cls = '') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;

// ---------- AI kampanya önerileri ----------
async function ideasInto(el, fresh) {
  el.innerHTML = `<div class="ideas">${Array(4).fill('<div class="idea sk"></div>').join('')}</div>`;
  try {
    const list = await api('/api/ai/ideas' + (fresh ? '?fresh=1' : ''));
    el.innerHTML = `<div class="ideas">${list.map((x, i) => `<div class="idea" data-idea="${i}">
      <div class="idea-top"><span class="flag">${flagImg(x.country)}</span><span class="mut">${esc([x.location, x.country].filter(Boolean).join(', '))}</span></div>
      <h4>${esc(x.sector)}</h4><p>${esc(x.why)}</p>${x.modules ? `<div class="chips">${String(x.modules).split(',').slice(0, 3).map(m => `<span class="chip">${esc(m.trim())}</span>`).join('')}</div>` : ''}
      <button class="btn sm pri" data-go="${i}">Bu kampanyayı başlat →</button></div>`).join('')}</div>`;
    el.onclick = e => {
      const b = e.target.closest('[data-go]'); if (!b) return; const x = list[+b.dataset.go];
      busyBtn(b, async () => {
        const { id } = await post('/api/campaigns/quick', { sector: x.sector, location: x.location || '', country: x.country || 'Türkiye', titles: x.titles || '', count: 40, people: true, lookup: true });
        await loadCamps(); location.hash = `c/${id}/companies`; toast('Kampanya başladı — AI firmaları arıyor');
      }, 'Başlatılıyor');
    };
  } catch (e) { el.innerHTML = `<p class="mut">${esc(e.message)}</p>`; }
}

// ================= Panel =================
PAGES.dash = tryT(async () => {
  const [s, ev] = await Promise.all([api('/api/stats'), api('/api/events')]);
  const steps = [[s.setup.project, 'Şirket profili', 'project'], [s.setup.openai, 'OpenAI', 'settings'], [s.setup.rr, 'RocketReach', 'settings'], [s.setup.gmail, 'Gmail', 'settings'], [s.setup.telegram, 'Telegram', 'settings']];
  const lim = Math.max(s.limits.lookup, s.limits.arama);
  const K = (icon, n, l, c) => `<div class="kcard" style="--k:${c}"><span class="kic">${ico(icon)}</span><b>${n}</b><span>${l}</span></div>`;
  main.innerHTML = `<section class="hero">
    <div class="hero-txt"><span class="eyebrow">Merhaba ${esc(ME.name)}</span><h1>Bugün hangi pazara açılıyoruz?</h1><p>Sektör ya da şehir yaz; AI firmaları bulsun, her firmadan en doğru tek yetkiliyi ve mailini çıkarsın.</p>
      <form class="hero-form" id="hq"><input name="sector" placeholder="Sektör · ör. Gıda üretimi"><input name="location" placeholder="Şehir / ülke · ör. Bursa"><button class="btn pri">${ico('search')} Bul</button></form></div>
    <div class="hero-stats">${K('building', s.companies, 'Firma', '#06b6d4')}${K('users', s.contacts, 'Yetkili', '#3b82f6')}${K('mail', s.withEmail, 'Mail bulundu', '#10b981')}${K('inbox', s.sent, 'Gönderildi', '#8b5cf6')}</div></section>
  ${lim ? `<div class="banner">⏳ RocketReach limiti: ~${lim} dk sonra kuyruk kendiliğinden devam edecek.</div>` : ''}
  <div class="dgrid">
    <div class="card span2"><div class="card-h"><h3>✨ AI'ın önerdiği kampanyalar</h3><button class="btn sm ghost" id="ideaRe">Yenile</button></div><div id="ideas"></div></div>
    <div class="card"><div class="card-h"><h3>Kampanyalar</h3><a href="#campaigns" class="btn sm ghost">Tümü →</a></div>
      ${CAMPS.length ? `<div class="clist">${CAMPS.slice(0, 6).map(c => { const p = c.companies ? Math.round(c.with_email / c.companies * 100) : 0; return `<a href="#c/${c.id}/companies" class="citem"><div><b>${esc(c.name)}</b><small>${c.companies} firma · ${c.with_email} mail · ${c.sent} gönderildi</small></div><div class="ring" style="--p:${p}"><span>${p}%</span></div></a>`; }).join('')}</div>` : '<p class="mut">Henüz kampanya yok.</p>'}</div>
    <div class="card"><div class="card-h"><h3>Gönderim</h3><a href="#schedule" class="btn sm ghost">Takvim →</a></div>
      <div class="row" style="margin-bottom:10px">${s.sending.ok ? '<span class="pill ok">● Açık</span>' : `<span class="pill warn">${esc(s.sending.why)}</span>`}<span class="sp"></span><b>${s.sending.today}<span class="mut">/${s.sending.daily}</span></b></div>
      <div class="bar"><i style="width:${Math.min(100, s.sending.today / Math.max(1, s.sending.daily) * 100)}%"></i></div>
      <div class="mini3"><a href="#outbox/taslak"><b>${s.drafts}</b>Taslak</a><a href="#outbox/sırada"><b>${s.queued}</b>Sırada</a><a href="#queue"><b>${s.tasks + s.jobs}</b>Arka plan</a></div>
      <div class="mini3" style="grid-template-columns:1fr 1fr"><a href="#replies"><b style="${s.replies ? 'color:var(--ok)' : ''}">${s.replies}</b>Yanıt bekliyor</a><a href="#calls/bug%C3%BCn"><b>${s.callsToday}</b>Bugün aranacak</a></div>
      ${steps.some(x => !x[0]) ? `<div class="setup">${steps.map(([ok, t, h]) => `<a href="#${h}" class="${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${t}</a>`).join('')}</div>` : ''}</div>
    <div class="card" id="usage"><h3>Kullanım ve bütçe</h3><p class="mut"><span class="spin"></span></p></div>
    <div class="card" id="quota"><h3>RocketReach kotası</h3><p class="mut"><span class="spin"></span></p></div>
    <div class="card span2"><div class="card-h"><h3>Son hareketler</h3><span class="mut" style="font-size:12px">Telegram'a da gider</span></div>${feedHtml(ev.slice(0, 14))}</div>
  </div>`;
  $('hq').onsubmit = e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!f.sector && !f.location) return toast('Sektör ya da şehir yaz', true); sessionStorage.setItem('nc', JSON.stringify(f)); location.hash = 'newcamp'; };
  ideasInto($('ideas')); $('ideaRe').onclick = () => ideasInto($('ideas'), true);
  quotaCard(); usageCard($('usage'));
});

// ================= Firma Bul =================
PAGES.newcamp = () => {
  const pre = JSON.parse(sessionStorage.getItem('nc') || '{}'); sessionStorage.removeItem('nc');
  main.innerHTML = head('Firma Bul', 'Sektör, şehir ya da ülke — biri yeter. AI web\'den gerçek firmaları bulur; her firmadan en uygun <b>tek</b> yetkiliyi ve mailini çıkarır.') +
  `<div class="seg" id="seg"><button class="on" data-m="ai">✨ AI ile bul</button><button data-m="list">📋 Listemi ver</button><button data-m="partner">🤝 Çözüm ortağı</button><button data-m="ideas">💡 Öneriler</button></div>
  <form class="card quick" id="qf"><div class="grid g3 big">
    <label>Sektör<input name="sector" id="qS" value="${esc(pre.sector || '')}" placeholder="ör. Otomotiv yan sanayi" autocomplete="off"></label>
    <label>Şehir / bölge<input name="location" id="qL" value="${esc(pre.location || '')}" placeholder="ör. Gebze OSB" autocomplete="off"></label>
    <label>Ülke<select name="country" id="qC">${COUNTRIES.map(c => `<option value="${c}">${FLAG[c] || ''} ${c}</option>`).join('')}</select></label></div>
    <div class="chips" style="margin-top:12px">${SECTORS.map(x => `<span class="chip sug" data-qs="${esc(x)}">${esc(x)}</span>`).join('')}</div>
    <div class="chips" style="margin-top:8px">${PLACES.map(x => `<span class="chip sug" data-ql="${esc(x)}">📍 ${esc(x)}</span>`).join('')}</div>
    <div class="countpick"><span>Kaç firma?</span>${COUNTS.map(n => `<label><input type="radio" name="count" value="${n}" ${n === 40 ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
    <div class="grid g2" style="margin-top:12px"><label>Büyüklük<select name="size"><option value="">Farketmez</option><option>50+ çalışan</option><option>100+ çalışan</option><option>250+ çalışan</option><option>500+ çalışan (kurumsal)</option></select></label>
      <label>Ek not (opsiyonel)<input name="note" placeholder="ör. OSB içindekiler, ihracatçılar"></label></div>
    <div class="row" style="margin-top:14px"><label class="inline"><input type="checkbox" name="people" checked> Her firmadan en uygun yetkiliyi bul</label><label class="inline"><input type="checkbox" name="lookup" checked> Mailini de çıkar</label></div>
    <div class="row" style="margin-top:18px"><button class="btn pri lg">${ico('search')} Firmaları bul</button><span class="mut" style="font-size:12.5px">20 firmalık turlar halinde arar (~1 dk/tur); 200 firma ~10 dk sürer, arka planda devam eder.</span></div></form>
  <form class="card quick hide" id="lf2"><h3>Firma listesini sen ver</h3><p class="hint">Her satıra bir firma: <code>Firma adı, alanadi.com</code>. Her firmadan en uygun tek yetkili bulunur.</p>
    <textarea name="text" rows="7" placeholder="Farplas Otomotiv, farplas.com&#10;Assan Hanil, assanhanil.com.tr&#10;Bosch Bursa, bosch.com.tr"></textarea>
    <div class="grid g2" style="margin-top:12px"><label>Kampanya adı<input name="name" placeholder="ör. Bursa otomotiv listem"></label><label>Öncelikli unvanlar (virgülle)<input name="titles" placeholder="İSG Müdürü, Fabrika Müdürü, Plant Manager"></label></div>
    <div class="row" style="margin-top:14px"><label class="inline"><input type="checkbox" name="lookup" checked> Mailini de çıkar</label><span class="sp"></span><button class="btn pri">${ico('users')} Yetkilileri bul</button></div></form>
  <form class="card quick hide" id="pf2"><h3>Çözüm ortağı bul</h3><p class="hint">Katalogdaki ortaklık modeli: OSGB'ler, CCTV entegratörleri, otomasyon ve yazılım firmaları kendi müşterilerine Hype Vision satar. Bir ortak onlarca tesis demektir. Her firmadan genel müdür / kurucu / iş geliştirme yetkilisi ve santral numarası bulunur.</p>
    <label>Ortak türü</label><div class="chips" id="ptypes" style="margin:6px 0 14px">${PTYPES.map((t, i) => `<span class="chip sug ${i < 2 ? 'on' : ''}" data-pt="${esc(t)}">${esc(t)}</span>`).join('')}</div>
    <div class="grid g2"><label>Şehir / bölge<input name="location" placeholder="ör. Kocaeli, Bursa, İstanbul Anadolu"></label><label>Ülke<select name="country">${COUNTRIES.map(c => `<option value="${c}">${c}</option>`).join('')}</select></label></div>
    <div class="countpick"><span>Kaç firma?</span>${COUNTS.map(n => `<label><input type="radio" name="count" value="${n}" ${n === 40 ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
    <div class="row" style="margin-top:18px"><button class="btn pri lg">🤝 Ortak adaylarını bul</button><span class="mut" style="font-size:12.5px">Mail için "Çözüm ortaklığı · OSGB" şablonunu kullan; Arama Listesi'nden telefonla da ulaş.</span></div></form>
  <div class="card hide" id="ideaCard"><div class="card-h"><h3>✨ Şirket profiline göre AI önerileri</h3><button class="btn sm ghost" id="ideaRe2">Yeni öneriler</button></div><div id="ideas2"></div></div>`;
  $('seg').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; $('seg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('qf').classList.toggle('hide', b.dataset.m !== 'ai'); $('lf2').classList.toggle('hide', b.dataset.m !== 'list'); $('pf2').classList.toggle('hide', b.dataset.m !== 'partner'); $('ideaCard').classList.toggle('hide', b.dataset.m !== 'ideas');
    if (b.dataset.m === 'ideas' && !$('ideas2').innerHTML) ideasInto($('ideas2')); };
  $('ideaRe2').onclick = () => ideasInto($('ideas2'), true);
  $('ptypes').onclick = e => { const c = e.target.closest('[data-pt]'); if (c) c.classList.toggle('on'); };
  $('pf2').onsubmit = e => { e.preventDefault(); busyBtn(e.target.querySelector('.btn.pri'), async () => {
    const types = [...document.querySelectorAll('#ptypes .on')].map(x => x.dataset.pt); if (!types.length) return toast('En az bir ortak türü seç', true);
    const f = Object.fromEntries(new FormData(e.target));
    const { id } = await post('/api/campaigns/quick', { ...f, sector: types.join(', '), kind: 'partner', people: true, lookup: true, note: 'çözüm ortağı / bayi adayı' });
    await loadCamps(); location.hash = `c/${id}/companies`; toast('AI ortak adaylarını arıyor…');
  }, 'Hazırlanıyor'); };
  main.onclick = e => {
    const a = e.target.closest('[data-qs]'); if (a) $('qS').value = a.dataset.qs;
    const b = e.target.closest('[data-ql]'); if (b) $('qL').value = $('qL').value && !$('qL').value.includes(b.dataset.ql) ? $('qL').value + ', ' + b.dataset.ql : b.dataset.ql;
  };
  $('lf2').onsubmit = e => { e.preventDefault(); busyBtn(e.target.querySelector('.btn.pri'), async () => {
    const f = Object.fromEntries(new FormData(e.target)); f.lookup = !!f.lookup;
    const { id } = await post('/api/campaigns/from-list', f); await loadCamps(); location.hash = `c/${id}/companies`; toast('Yetkililer aranıyor…');
  }, 'Hazırlanıyor'); };
  $('qf').onsubmit = e => { e.preventDefault(); busyBtn(e.target.querySelector('.btn.pri'), async () => {
    const f = Object.fromEntries(new FormData(e.target)); f.people = !!f.people; f.lookup = !!f.lookup;
    const { id } = await post('/api/campaigns/quick', f); await loadCamps(); location.hash = `c/${id}/companies`; toast(`AI ${f.count} firma arıyor…`);
  }, 'Hazırlanıyor'); };
};

// ================= Kampanya · Firmalar (firma başı tek yetkili, aynı satırda) =================
CTAB.companies = async (c, el) => {
  const draw = async () => {
    const cos = await api(`/api/campaigns/${c.id}/companies`);
    cos.forEach(x => { try { x.p = x.person ? JSON.parse(x.person) : null; } catch { x.p = null; } });
    const pending = cos.some(x => ['kuyrukta', 'kişi aranıyor'].includes(x.status)) || c.pending;
    el.innerHTML = `<div class="toolbar"><div class="countpick sm"><span>Daha fazla firma</span>${COUNTS.map(n => `<label><input type="radio" name="fcc" value="${n}" ${n === 40 ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
      <span class="sp"></span><button class="btn pri" id="fcGo">✨ Firma bul</button><button class="btn" id="fcManual">＋ Elle ekle</button></div>
    ${cos.length ? `<div class="tw"><table class="tbl"><thead><tr><th class="c"><input type="checkbox" id="fAll"></th><th>Firma</th><th>Yetkili</th><th>Mail</th><th class="hide-m">Uygunluk</th><th>Durum</th></tr></thead><tbody>
    ${cos.map(x => `<tr class="click" data-cm="${x.id}"><td class="c"><input type="checkbox" data-co="${x.id}"></td>
      <td class="w"><div class="ent">${favicon(x.domain)}<div><div class="n">${esc(x.name)}</div><small>${esc([x.city, x.sector].filter(Boolean).join(' · '))} · <a href="https://${esc(x.domain)}" target="_blank" rel="noopener">${esc(x.domain)}</a></small></div></div></td>
      <td>${x.p ? `<div class="ent">${avatar(x.p.name)}<div><div class="n">${esc(x.p.name)} ${li(x.p.linkedin)}</div><small>${esc(x.p.title)}</small></div></div>` : `<span class="mut">${['kuyrukta', 'kişi aranıyor'].includes(x.status) ? '<span class="spin"></span> aranıyor' : '—'}</span>`}</td>
      <td>${x.p?.email ? `<span class="mail">${esc(x.p.email)}</span>` : x.p ? pill(x.p.stage) : ''}</td>
      <td class="hide-m">${x.score ? `<div class="score"><i style="width:${x.score * 10}%"></i></div><small title="${esc(x.reason)}">${esc(String(x.reason || '').slice(0, 70))}${String(x.reason || '').length > 70 ? '…' : ''}</small>` : ''}</td>
      <td>${pill(x.status)}</td></tr>`).join('')}</tbody></table></div>
    <div class="selbar"><b id="fN"></b><span class="sp"></span><button class="btn" id="fPeople">${ico('users')} Yetkiliyi bul</button><button class="btn" id="fLook">${ico('mail')} Mailini bul</button><button class="btn" id="fDel">Sil</button></div>`
    : empty(pending ? '<span class="spin"></span> AI firmaları arıyor…' : 'Henüz firma yok', pending ? 'Her tur ~1 dk; liste kendiliğinden dolacak.' : '"Firma bul" ile AI web\'den firmaları getirsin.')}`;
    const ids = () => [...el.querySelectorAll('[data-co]:checked')].map(x => +x.dataset.co);
    const upd = () => { if ($('fN')) $('fN').textContent = ids().length ? ids().length + ' firma seçili' : 'Seçmezsen: yetkilisi olmayan tüm firmalar'; };
    upd();
    el.onchange = e => { if (e.target.id === 'fAll') el.querySelectorAll('[data-co]').forEach(x => x.checked = e.target.checked); upd(); };
    el.onclick = e => { const r = e.target.closest('[data-cm]'); if (r && !e.target.closest('input,a,button,label')) companyModal(+r.dataset.cm, c.id, draw); };
    $('fcGo').onclick = ev => busyBtn(ev.currentTarget, async () => { const n = +el.querySelector('[name=fcc]:checked').value; await post(`/api/campaigns/${c.id}/find-companies`, { count: n, people: true }); toast(`AI ${n} firma daha arıyor`); }, 'Kuyruğa');
    $('fcManual').onclick = () => modal('Elle firma ekle', `<p class="mut" style="margin-top:0">Her satıra bir firma: <code>Firma Adı, alanadi.com</code></p><textarea id="mText" rows="8" placeholder="Farplas Otomotiv, farplas.com&#10;EKU Fren, eku.com.tr"></textarea><div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn pri" id="mGo">Ekle</button></div>`,
      b => b.querySelector('#mGo').onclick = tryT(async () => { const r = await post(`/api/campaigns/${c.id}/companies`, { text: b.querySelector('#mText').value }); closeModal(); toast(r.added + ' firma eklendi'); draw(); }));
    if ($('fPeople')) {
      $('fPeople').onclick = ev => busyBtn(ev.currentTarget, async () => {
        const list = ids().length ? ids() : cos.filter(x => !x.p && ['yeni', 'kişi yok'].includes(x.status)).map(x => x.id);
        if (!list.length) return toast('Yetkilisi aranacak firma yok', true);
        const r = await post('/api/companies/people', { ids: list }); toast(`${r.queued} firmada yetkili aranıyor (firma başı 1 kişi)`); draw();
      }, 'Kuyruğa');
      $('fLook').onclick = ev => busyBtn(ev.currentTarget, async () => {
        const sel = ids().length ? cos.filter(x => ids().includes(x.id)) : cos;
        const people = sel.filter(x => x.p && !x.p.email).map(x => x.p.id);
        if (!people.length) return toast('Maili aranacak yetkili yok', true);
        toast(lookupMsg(await post('/api/queue/lookup', { contact_ids: people, campaign_id: c.id }))); draw();
      }, 'Kuyruğa');
      $('fDel').onclick = tryT(async () => { if (!ids().length || !confirm(ids().length + ' firma silinsin mi?')) return; await del('/api/companies', { ids: ids() }); draw(); });
    }
    clearInterval(timer);
    timer = setInterval(() => { if ([`#c/${c.id}/companies`, `#c/${c.id}`].includes(location.hash) && !el.querySelector('[data-co]:checked') && $('modal').classList.contains('hide')) draw(); }, pending || !cos.length ? 8000 : 20000);
  };
  await draw();
};


// ================= v9 · Gönderen hesaplar + alan adı sağlığı (Entegrasyonlar içinde) =================
async function renderSenders(el) {
  const list = await api('/api/senders'), adm = ME.role === 'admin';
  el.innerHTML = `<div class="card-h"><h3>Gönderen Gmail hesapları</h3><span class="pill ${list.some(s => s.active) ? 'ok' : 'bad'}">${list.filter(s => s.active).length} aktif</span></div>
    <p class="hint">Mailler hesaplar arasında sırayla dağıtılır; her hesabın kendi günlük limiti ve ısınması vardır. Takip mailleri ilk maili atan hesaptan aynı zincirde gider.
      Uygulama şifresi: Google Hesabı → Güvenlik → 2 Adımlı Doğrulama → <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Uygulama şifreleri</a>.</p>
    ${list.length ? `<div class="tw" style="margin-bottom:14px"><table><thead><tr><th>Hesap</th><th>Bugün</th><th>Limit</th><th>Durum</th><th></th></tr></thead><tbody>
    ${list.map(s => `<tr><td><div class="ent">${avatar(s.email)}<div><div class="n">${esc(s.email)}</div><small>${esc(s.name || '—')}${s.note ? ' · ' + esc(s.note) : ''}</small></div></div></td>
      <td><b>${s.today}</b><span class="mut">/${s.eff}</span>${s.eff < s.daily ? ' <span class="pill info">ısınma</span>' : ''}</td>
      <td>${adm ? `<input type="number" min="5" max="200" value="${s.daily}" data-sd="${s.id}" style="width:76px;height:32px">` : s.daily}</td>
      <td>${adm ? `<label class="switch"><input type="checkbox" data-sa="${s.id}" ${s.active ? 'checked' : ''}><i></i></label>` : pill(s.active ? 'aktif' : 'pasif')}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-st="${s.id}">Test</button>${adm ? ` <button class="icon" data-sx="${s.id}" title="Kaldır">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${adm ? `<details ${list.length ? '' : 'open'}><summary class="btn sm" style="list-style:none;display:inline-flex">＋ Hesap ekle</summary>
      <div class="grid g2" style="margin-top:12px"><label>Gmail / Workspace adresi<input id="nsE" placeholder="ad@hypevisionlab.com" autocomplete="off"></label>
      <label>Uygulama şifresi (16 hane)<input id="nsP" type="password" placeholder="xxxx xxxx xxxx xxxx" autocomplete="new-password"></label>
      <label>Gönderen adı<input id="nsN" placeholder="Emre Yıldız"></label><label>Günlük limit<input id="nsD" type="number" value="40" min="5" max="200"></label></div>
      <div class="row" style="margin-top:12px"><button class="btn pri" id="nsGo">Bağlan ve test maili gönder</button><span class="mut" style="font-size:12.5px">Önce bağlantı doğrulanır, hesabın kendisine test maili gider.</span></div></details>` : ''}`;
  el.onclick = tryT(async e => {
    const t = e.target.closest('[data-st]'); if (t) return busyBtn(t, async () => { const r = await post(`/api/senders/${t.dataset.st}/test`, {}); toast('Test maili gönderildi → ' + r.to); }, '…');
    const x = e.target.closest('[data-sx]'); if (x && confirm('Hesap kaldırılsın mı? (Gönderim geçmişi olan hesap pasife alınır)')) { await del('/api/senders/' + x.dataset.sx); renderSenders(el); }
  });
  el.onchange = tryT(async e => {
    const a = e.target.closest('[data-sa]'); if (a) { await put('/api/senders/' + a.dataset.sa, { active: a.checked }); toast(a.checked ? 'Hesap aktif' : 'Hesap pasif'); }
    const d = e.target.closest('[data-sd]'); if (d) { await put('/api/senders/' + d.dataset.sd, { daily: +d.value }); toast('Limit kaydedildi'); renderSenders(el); }
  });
  if ($('nsGo')) $('nsGo').onclick = ev => busyBtn(ev.currentTarget, async () => {
    await post('/api/senders', { email: $('nsE').value, pass: $('nsP').value, name: $('nsN').value, daily: $('nsD').value });
    toast('Hesap eklendi ✓ test maili gönderildi'); renderSenders(el); renderDomain($('dhCard'));
  }, 'Bağlanıyor');
}
async function renderDomain(el, domain) {
  el.innerHTML = '<h3>Alan adı sağlığı</h3><p class="mut"><span class="spin"></span> DNS kontrol ediliyor…</p>';
  try {
    const d = await api('/api/domain-health' + (domain ? '?domain=' + encodeURIComponent(domain) : ''));
    el.innerHTML = `<div class="card-h"><h3>Alan adı sağlığı · ${esc(d.domain)}</h3><span class="pill ${d.score === d.of ? 'ok' : d.score >= 3 ? 'warn' : 'bad'}">${d.score}/${d.of}</span></div>
      <p class="hint">Spam klasörüne düşmemenin temeli. Eksik olanı DNS panelinde (Netlify/IHS) aşağıdaki gibi ekle.</p>
      ${d.note ? `<div class="banner info">${esc(d.note)}</div>` : ''}
      <div class="steps">${d.checks.map(c => `<div class="step ${c.ok ? 'done' : ''}" style="align-items:flex-start"><span class="ck">${c.ok ? '✓' : '!'}</span><span><b>${c.key}</b> <small class="mut" style="word-break:break-all">${esc(c.value)}</small>
        ${c.ok ? '' : `<div style="margin-top:6px;font-size:12.5px;color:var(--txt2)">${esc(c.fix)}</div>`}</span></div>`).join('')}</div>
      <div class="row" style="margin-top:12px"><input id="dhD" placeholder="başka alan adı" style="max-width:220px"><button class="btn sm" id="dhGo">Kontrol et</button></div>`;
    $('dhGo').onclick = () => renderDomain(el, $('dhD').value);
  } catch (e) { el.innerHTML = '<h3>Alan adı sağlığı</h3><p class="mut">Kontrol için alan adı gir (gönderen hesap eklenince otomatik yapılır).</p><div class="row"><input id="dhD" placeholder="hypevisionlab.com" style="max-width:220px"><button class="btn sm" id="dhGo">Kontrol et</button></div>'; $('dhGo').onclick = () => renderDomain(el, $('dhD').value); }
}

// ================= Yanıtlar =================
const RL = [['', 'Tümü'], ['ilgileniyor', '🔥 İlgileniyor'], ['soru', '❓ Soru'], ['yanlış kişi', '↪️ Yanlış kişi'], ['sonra yaz', '🕓 Sonra yaz'], ['otomatik cevap', '🏖️ Otomatik'], ['ilgisiz', '🚫 İlgisiz']];
const LPILL = { 'ilgileniyor': 'ok', 'soru': 'info', 'yanlış kişi': 'pri', 'sonra yaz': 'warn', 'otomatik cevap': '', 'ilgisiz': 'bad' };
PAGES.replies = tryT(async (lab = '') => {
  lab = decodeURIComponent(lab || '');
  const { list, counts } = await api('/api/replies' + (lab ? '?label=' + encodeURIComponent(lab) : ''));
  const cnt = l => counts.filter(c => !l || c.label === l).reduce((a, b) => a + b.n, 0);
  const open = counts.filter(c => c.status === 'yeni' && ['ilgileniyor', 'soru', 'yanlış kişi', 'sonra yaz'].includes(c.label)).reduce((a, b) => a + b.n, 0);
  main.innerHTML = head('Yanıtlar', 'Gönderdiğin maillere gelen cevaplar. AI her yanıtı etiketler, özetler ve cevap taslağı hazırlar; otomatik cevapta takibi erteler, ilgisizi engeller, yönlendirmede önerilen kişiyi ekler.',
    `<button class="btn" id="rqCheck">↻ Gelen kutusunu kontrol et</button>`) +
  `${open ? `<div class="banner info">${open} yanıt cevap bekliyor</div>` : ''}
  <div class="tabs" style="margin-bottom:14px">${RL.map(([k, l]) => `<a href="#replies/${encodeURIComponent(k)}" class="${lab === k ? 'on' : ''}">${l}<span class="cnt">${cnt(k)}</span></a>`).join('')}</div>
  ${list.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Kişi</th><th>Etiket</th><th>Özet</th><th class="hide-m">Geldi</th><th>Durum</th></tr></thead><tbody>
  ${list.map(r => `<tr class="click" data-rp="${r.id}"><td class="w"><div class="ent">${avatar(r.name || r.from_email)}<div><div class="n">${esc(r.name || r.from_name || r.from_email)}</div><small>${esc(r.title || '')}${r.company ? ' @ ' + esc(r.company) : ''}</small></div></div></td>
    <td><span class="pill ${LPILL[r.label] || ''}">${esc(r.label || 'analiz ediliyor')}</span></td><td style="max-width:420px"><small style="color:var(--txt2)">${esc(r.summary || r.subject)}</small></td>
    <td class="hide-m mut">${ago(r.received_at)}</td><td>${pill(r.status)}</td></tr>`).join('')}</tbody></table></div>`
  : empty('Henüz yanıt yok', 'Gelen kutusu 5 dakikada bir taranır. Yanıt gelince Telegram\'a da düşer.')}`;
  $('rqCheck').onclick = e => busyBtn(e.currentTarget, async () => { const r = await post('/api/inbox/check'); toast(r.fresh ? r.fresh + ' yeni yanıt' : 'Yeni yanıt yok'); PAGES.replies(lab); }, 'Taranıyor');
  main.onclick = e => { const r = e.target.closest('[data-rp]'); if (r) replyModal(+r.dataset.rp, () => PAGES.replies(lab)); };
});
async function replyModal(id, onDone) {
  const r = await api('/api/replies/' + id);
  modal(`${r.name || r.from_email} · ${r.company || ''}`, `<div class="row" style="margin-bottom:10px"><span class="pill ${LPILL[r.label] || ''}">${esc(r.label)}</span><span class="mut" style="font-size:12.5px">${fmtDate(r.received_at)} · ${esc(r.from_email)}</span><span class="sp"></span>
      <select id="rpL" style="width:auto;height:30px">${RL.slice(1).map(([k, l]) => `<option value="${esc(k)}" ${r.label === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <p style="margin:0 0 8px;font-weight:600">${esc(r.summary)}</p>
    <div class="preview" style="white-space:pre-wrap;max-height:220px;overflow:auto;font-size:13.5px">${esc(r.text || '(metin alınamadı)')}</div>
    ${r.thread?.length ? `<details style="margin-top:10px"><summary class="mut" style="cursor:pointer;font-size:12.5px">Gönderdiğimiz ${r.thread.length} mail</summary>${r.thread.map(t => `<div class="mailcard" style="margin-top:8px"><div class="subj">${esc(t.subject)}</div><div class="body" style="max-height:none">${esc(t.body)}</div></div>`).join('')}</details>` : ''}
    <label style="margin-top:14px">Cevabın (AI taslağı — düzenleyebilirsin, imzan eklenir)<textarea id="rpT" rows="8">${esc(r.draft || '')}</textarea></label>
    <div class="row" style="margin-top:12px"><button class="btn sm" id="rpRe">✨ Yeniden analiz et</button><button class="btn sm" id="rpDone">Tamamlandı</button><span class="sp"></span><button class="btn pri" id="rpSend">Cevabı gönder</button></div>`, b => {
    const done = msg => { toast(msg); closeModal(); onDone?.(); };
    b.querySelector('#rpSend').onclick = e => busyBtn(e.currentTarget, async () => { if (!confirm(`${r.from_email} adresine şimdi gönderilsin mi?`)) return; await post(`/api/replies/${id}/send`, { text: b.querySelector('#rpT').value }); done('Cevap gönderildi ✓'); }, 'Gönderiliyor');
    b.querySelector('#rpDone').onclick = tryT(async () => { await put('/api/replies/' + id, { status: 'tamam', draft: b.querySelector('#rpT').value }); done('Tamamlandı'); });
    b.querySelector('#rpRe').onclick = e => busyBtn(e.currentTarget, async () => { await post(`/api/replies/${id}/reclassify`); closeModal(); replyModal(id, onDone); }, 'AI');
    b.querySelector('#rpL').onchange = tryT(async e => { await put('/api/replies/' + id, { label: e.target.value }); toast('Etiket değişti — ilgili işlem uygulandı'); });
  });
}

// ================= Arama listesi =================
const CST = [['bekleyen', 'Aranacak'], ['bugün', 'Bugün geri ara'], ['geri ara', 'Geri arama'], ['görüşüldü', 'Görüşüldü'], ['toplantı', 'Toplantı'], ['', 'Tümü']];
const CALLS = ['', 'arandı', 'ulaşılamadı', 'geri ara', 'görüşüldü', 'toplantı', 'ilgisiz', 'yanlış numara'];
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
PAGES.calls = tryT(async (st = 'bekleyen') => {
  st = decodeURIComponent(st); await loadCamps();
  let f = { status: st, campaign: sessionStorage.getItem('callCamp') || '', q: '' };
  main.innerHTML = head('Arama Listesi', 'Firmaların web sitesinde yayınlanan santral numaraları ve (varsa) yetkili telefonları. Telefonda numaraya dokun, arandıktan sonra durumunu ve notunu gir.',
    '<button class="btn" id="clFind">📞 Eksik santral numaralarını bul</button>') +
  `<div class="row" style="margin-bottom:12px"><div class="tabs">${CST.map(([k, l]) => `<a href="#calls/${encodeURIComponent(k)}" class="${st === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <select id="clC" style="width:auto">${campOpts('Tüm kampanyalar')}</select><input id="clQ" placeholder="Firma / şehir ara…" style="max-width:220px"></div><div id="clT"></div>`;
  $('clC').value = f.campaign;
  let rows = [];
  const draw = async () => {
    rows = await api('/api/calls?' + new URLSearchParams(f));
    rows.forEach(x => { try { x.p = x.person ? JSON.parse(x.person) : null; } catch { x.p = null; } });
    $('clT').innerHTML = rows.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Firma</th><th>Telefon</th><th class="hide-m">Yetkili</th><th>Durum</th><th>Not / geri arama</th></tr></thead><tbody>
    ${rows.map(x => { const pp = (x.p?.phones || '').split(',').map(s => s.trim()).filter(Boolean); return `<tr data-cl="${x.id}">
      <td class="w"><div class="ent">${favicon(x.domain)}<div><div class="n">${esc(x.name)}</div><small>${esc([x.city, x.sector].filter(Boolean).join(' · '))}${x.campaign ? ' · ' + esc(x.campaign) : ''}</small></div></div></td>
      <td>${x.phone ? `<a class="btn sm pri" href="${telHref(x.phone)}">📞 ${esc(x.phone)}</a>` : `<span class="mut">—</span>`}${pp.map(p => `<a class="btn sm" style="margin-top:4px" href="${telHref(p)}">👤 ${esc(p)}</a>`).join('')}
        ${x.gen_email ? `<small><a href="mailto:${esc(x.gen_email)}">${esc(x.gen_email)}</a></small>` : ''}</td>
      <td class="hide-m">${x.p ? `<div class="n">${esc(x.p.name)} ${li(x.p.linkedin)}</div><small>${esc(x.p.title || '')}</small>${x.p.email ? `<small class="mail">${esc(x.p.email)}</small>` : ''}` : '<span class="mut">—</span>'}</td>
      <td><select data-cs="${x.id}" style="width:auto;min-width:130px;height:32px">${CALLS.map(s => `<option value="${s}" ${x.call_status === s ? 'selected' : ''}>${s || '— aranmadı'}</option>`).join('')}</select>
        ${x.called_at ? `<small>${ago(x.called_at)} önce</small>` : ''}</td>
      <td style="min-width:220px"><input data-cn="${x.id}" value="${esc(x.call_note)}" placeholder="not…" style="height:32px">
        <input type="datetime-local" data-cb="${x.id}" value="${x.callback_at ? new Date(new Date(x.callback_at).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : ''}" style="height:32px;margin-top:4px;${x.call_status === 'geri ara' ? '' : 'display:none'}"></td></tr>`; }).join('')}</tbody></table></div>`
    : empty('Bu filtrede firma yok', 'Kampanyalardaki firmalar burada listelenir. Numarası olmayanlar için "Eksik santral numaralarını bul".');
  };
  const save = async id => {
    const tr = main.querySelector(`[data-cl="${id}"]`), st2 = tr.querySelector('[data-cs]').value, cb = tr.querySelector('[data-cb]');
    cb.style.display = st2 === 'geri ara' ? '' : 'none';
    await put(`/api/companies/${id}/call`, { call_status: st2, call_note: tr.querySelector('[data-cn]').value, callback_at: st2 === 'geri ara' && cb.value ? new Date(cb.value).toISOString() : null });
  };
  main.onchange = tryT(async e => {
    if (e.target.id === 'clC') { f.campaign = e.target.value; sessionStorage.setItem('callCamp', f.campaign); return draw(); }
    const id = e.target.closest('[data-cl]')?.dataset.cl; if (!id) return;
    if (e.target.matches('[data-cs]') && e.target.value === 'geri ara') { const cb = main.querySelector(`[data-cb="${id}"]`); cb.style.display = ''; if (!cb.value) { const d = new Date(Date.now() + 864e5); d.setHours(10, 0, 0, 0); cb.value = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); } }
    await save(id); toast('Kaydedildi');
  });
  let t; $('clQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; draw(); }, 300); };
  $('clFind').onclick = ev => busyBtn(ev.currentTarget, async () => {
    const ids = rows.filter(x => !x.phone).map(x => x.id).slice(0, 60);
    if (!ids.length) return toast('Listede numarası eksik firma yok');
    const r = await post('/api/companies/contact-info', { ids }); toast(`${r.queued} firmanın santral numarası aranıyor (~20 sn/firma)`);
  }, 'Kuyruğa');
  await draw();
});

// ================= Sinyaller =================
const SK = { 'yatırım': '💰', 'yeni tesis': '🏗️', 'kapasite': '📈', 'iş kazası': '⚠️', 'sertifika': '🏅', 'ihracat': '🚢', 'dijitalleşme': '🤖' };
PAGES.signals = tryT(async () => {
  await loadCamps();
  const list = await api('/api/signals');
  main.innerHTML = head('Sinyaller', 'AI son haberleri tarar: yeni fabrika, kapasite artışı, yatırım, iş kazası, sertifika… Bu firmalar şu an görüntü işleme yatırımına en açık olanlar — "şimdi yaz" listesi. Her pazartesi aktif kampanyalar için otomatik taranır.',
    `<select id="sgC" style="width:auto">${campOpts('Tüm aktif kampanyalar')}</select><button class="btn pri" id="sgScan">📰 Şimdi tara</button>`) +
  (list.length ? `<div class="ideas">${list.map(s => `<div class="idea" data-sg="${s.id}"><div class="idea-top"><span style="font-size:18px">${SK[s.kind] || '📰'}</span><span class="pill">${esc(s.kind || 'haber')}</span><span class="mut">${esc(s.date || '')}</span></div>
    <div class="ent">${favicon(s.domain)}<div><h4>${esc(s.company)}</h4><small class="mut">${esc(s.city || '')}${s.campaign ? ' · ' + esc(s.campaign) : ''}</small></div></div>
    <p>${esc(s.event)}</p>${s.url ? `<a href="${esc(String(s.url).replace(/^\(?\[?[^\]]*\]?\(?/, '').replace(/\)+$/, '') || s.url)}" target="_blank" rel="noopener" style="font-size:12px">Haberi aç ↗</a>` : ''}
    <div class="row">${s.status === 'eklendi' ? pill('kampanyaya eklendi') : `<button class="btn sm pri" data-sa="${s.id}">Kampanyaya ekle + yetkiliyi bul</button>`}<button class="btn sm ghost" data-sh="${s.id}">Gizle</button></div></div>`).join('')}</div>`
  : empty('Henüz sinyal yok', '"Şimdi tara" ile aktif kampanyalarının sektör ve bölgesinde son haberleri tarat (~1 dk/kampanya).'));
  $('sgScan').onclick = e => busyBtn(e.currentTarget, async () => { const r = await post('/api/signals/scan', { campaign_id: $('sgC').value || null }); toast(r.queued ? `${r.queued} kampanya taranıyor — bitince Telegram'a haber gelir` : 'Aktif kampanya yok'); }, 'Kuyruğa');
  main.onclick = tryT(async e => {
    const a = e.target.closest('[data-sa]'); if (a) { await post(`/api/signals/${a.dataset.sa}/add`, { campaign_id: $('sgC').value || null }); toast('Firma eklendi; yetkili ve santral numarası aranıyor'); return PAGES.signals(); }
    const h = e.target.closest('[data-sh]'); if (h) { await put('/api/signals/' + h.dataset.sh, { status: 'gizli' }); h.closest('.idea').remove(); }
  });
});


// ================= Mail Listesi (kişi başına şablon + kişisel ilk cümle + A/B) =================
let TPLS = [], TSTATS = {};
const tplOpts = (sel, none = '— şablon seç —') => `<option value="">${none}</option>` + TPLS.map(t => `<option value="${t.id}" ${+sel === t.id ? 'selected' : ''}>${esc(t.name)}${TSTATS[t.id]?.sent >= 5 ? ` · %${TSTATS[t.id].rate}` : ''}</option>`).join('');
const autoTpl = c => {
  const t = `${c.title || ''} ${c.company || ''}`.toLowerCase(), en = /@[^@]+\.(com|de|co\.uk|fr|it|nl|es|us|pl|hu|ro|cz|at|ch|be|se|dk|no|ie|ca|mx|br|ae|sa|qa)$/.test(c.email || '') && !/[çğıöşü]/i.test((c.name || '') + (c.company || '')) && !/\.tr$/.test(c.email || '');
  const pick = re => TPLS.find(x => re.test(x.name))?.id;
  if (en) return /plant|production|operation|manufactur/.test(t) ? pick(/^EN · Downtime/) : pick(/^EN · Safety/);
  if (/osgb|isg danışman|güvenlik sistem|cctv|entegrat|otomasyon/.test(t)) return pick(/^Çözüm ortaklığı/);
  if (/isg|iş güvenliği|hse|ehs|safety|güvenlik/.test(t)) return pick(/^İSG · KKD/);
  if (/kalite|quality/.test(t)) return pick(/^Kalite/);
  if (/lojistik|depo|warehouse|logistic|sevkiyat/.test(t)) return pick(/Forklift/);
  if (/üretim|production|plant|fabrika|operasyon|operation/.test(t)) return pick(/^Verimlilik/);
  if (/genel müdür|ceo|general manager|kurucu|founder|owner|sahibi|yönetim kurulu|managing/.test(t)) return pick(/^Üst yönetim/);
  return pick(/^Genel ·/);
};
// A/B: iki şablon arasında dağıt; ikisi de ≥15 gönderime ulaştıysa kazanana %70 ver
function abSplit(ids, a, b) {
  const sa = TSTATS[a] || {}, sb = TSTATS[b] || {};
  let wa = .5;
  if ((sa.sent || 0) >= 15 && (sb.sent || 0) >= 15 && sa.rate !== sb.rate) wa = sa.rate > sb.rate ? .7 : .3;
  const out = {}; let ca = 0;
  ids.forEach((id, i) => { const useA = ca / Math.max(1, i) < wa || i === 0; out[id] = useA ? a : b; if (useA) ca++; });
  return { map: out, wa };
}
PAGES.maillist = tryT(async () => {
  const [tp, st] = await Promise.all([api('/api/templates'), api('/api/templates/stats')]); await loadCamps();
  TPLS = tp; TSTATS = Object.fromEntries(st.map(x => [x.id, x]));
  let rows = [], choice = {}, f = { campaign: '', q: '', state: 'new' };
  let personal = (() => { try { return localStorage.getItem('personal') !== '0'; } catch { return true; } })();
  main.innerHTML = head('Mail Listesi', 'Maili bulunan herkes. Kişileri seç, herkese ayrı şablon ata (ya da A/B testi yap), kuyruğa al. Göndermeden önce adresler doğrulanır; gönderim Gmail\'i korumak için hesaplara yayılarak yavaş yapılır.',
    '<a class="btn" href="#templates">Şablonlar</a><a class="btn" href="#outbox/sırada">Kuyruk</a>') +
  `<div class="toolbar"><input id="mlq" placeholder="İsim, firma, unvan, mail…" style="max-width:260px"><select id="mlc" style="width:auto">${campOpts('Tüm kampanyalar')}</select>
    <div class="tabs" id="mls"><button data-s="new" class="on">Hiç mail atılmamış</button><button data-s="">Tümü</button><button data-s="sent">Mail atılmış</button></div><span class="sp"></span>
    <label class="inline" title="AI her firmanın sitesine/haberlerine bakıp mailin başına tek bir kişisel cümle ekler"><span class="switch"><input type="checkbox" id="mlP" ${personal ? 'checked' : ''}><i></i></span> ✨ Kişiye özel ilk cümle</label></div>
  <div id="mlt"></div>
  <div class="selbar"><b id="mlN">Kişi seç</b><span class="sp"></span><select id="mlAll" style="max-width:250px">${tplOpts('', 'Seçilenlere şablon…')}</select>
    <button class="btn" id="mlAuto">✨ Unvana göre</button><button class="btn" id="mlAB">A/B</button><button class="btn" id="mlPrev">Önizle</button><button class="btn" id="mlGo">✉ Kuyruğa al</button></div>`;
  const ids = () => [...main.querySelectorAll('[data-ml]:checked')].map(x => +x.dataset.ml);
  const upd = () => { const n = ids().length; $('mlN').textContent = n ? `${n} kişi seçili` : 'Kişi seç'; };
  const setTpl = (id, v) => { choice[id] = v; const el = main.querySelector(`[data-tp="${id}"]`); if (el) el.value = v; };
  const draw = async () => {
    rows = await api('/api/maillist?' + new URLSearchParams(f));
    $('mlt').innerHTML = rows.length ? `<div class="tw"><table class="tbl"><thead><tr><th class="c"><input type="checkbox" id="mlA"></th><th>Kişi</th><th>Firma</th><th>Mail</th><th class="hide-m">Son durum</th><th style="min-width:230px">Şablon</th></tr></thead><tbody>
    ${rows.map(r => { let chk = {}; try { chk = JSON.parse(r.email_check || '{}'); } catch {} return `<tr><td class="c"><input type="checkbox" data-ml="${r.id}" ${r.blocked ? 'disabled title="Engel listesinde"' : ''}></td>
      <td class="w"><div class="ent">${avatar(r.name)}<div><div class="n">${esc(r.name)} ${li(r.linkedin)}</div><small>${esc(r.title)}</small></div></div></td>
      <td><div class="ent">${favicon(r.domain || String(r.email).split('@')[1])}<div><div class="n" style="font-weight:500">${esc(r.company)}</div><small>${esc(r.campaigns || '')}</small></div></div></td>
      <td><span class="mail">${esc(r.email)}</span>${chk.status ? `<small><span class="pill ${chk.status === 'ok' ? 'ok' : chk.status === 'riskli' ? 'warn' : 'bad'}" title="${esc(chk.reason)}">${chk.status === 'ok' ? 'doğrulandı' : esc(chk.status)}</span></small>` : ''}</td>
      <td class="hide-m">${r.blocked ? pill('engelli') : r.replied ? pill('yanıtladı') : r.last_status ? pill(r.last_status) : '<span class="mut">yeni</span>'}${r.last_sent ? `<small>${fmtDate(r.last_sent)}</small>` : ''}</td>
      <td><select data-tp="${r.id}" style="height:34px">${tplOpts(choice[r.id])}</select></td></tr>`; }).join('')}</tbody></table></div>`
      : empty('Bu filtrede maili olan kişi yok', 'Kampanyalardan ya da Kişi Ara\'dan mail bulduğunda burada listelenir.');
    upd();
  };
  let t; $('mlq').oninput = e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; draw(); }, 300); };
  $('mls').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; f.state = b.dataset.s; $('mls').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  main.onchange = e => {
    if (e.target.id === 'mlc') { f.campaign = e.target.value; return draw(); }
    if (e.target.id === 'mlP') { personal = e.target.checked; try { localStorage.setItem('personal', personal ? '1' : '0'); } catch {} return; }
    if (e.target.id === 'mlA') main.querySelectorAll('[data-ml]:not(:disabled)').forEach(x => x.checked = e.target.checked);
    const tp = e.target.closest('[data-tp]'); if (tp) { choice[tp.dataset.tp] = tp.value; const cb = main.querySelector(`[data-ml="${tp.dataset.tp}"]`); if (cb && tp.value && !cb.disabled) cb.checked = true; }
    upd();
  };
  $('mlAll').onchange = e => { const v = e.target.value; if (!v) return; const s = ids(); if (!s.length) { toast('Önce kişi seç', true); e.target.value = ''; return; } s.forEach(id => setTpl(id, v)); e.target.value = ''; toast(`${s.length} kişiye şablon atandı`); };
  $('mlAuto').onclick = () => { const s = ids().length ? ids() : rows.filter(r => !r.blocked).map(r => r.id); let n = 0; for (const id of s) { const v = autoTpl(rows.find(x => x.id === id)); if (v) { setTpl(id, v); n++; } } toast(`${n} kişiye unvanına göre şablon seçildi`); };
  $('mlAB').onclick = () => {
    const s = ids(); if (s.length < 2) return toast('A/B için en az 2 kişi seç', true);
    modal('A/B şablon testi', `<p class="mut" style="margin-top:0">Seçili ${s.length} kişiye iki şablon dönüşümlü atanır. İkisi de 15+ gönderime ulaştığında yanıt oranı yüksek olana otomatik %70 pay verilir.</p>
      <div class="grid g2"><label>Şablon A<select id="abA">${tplOpts('')}</select></label><label>Şablon B<select id="abB">${tplOpts('')}</select></label></div>
      <div id="abInfo" class="mut" style="margin-top:10px;font-size:12.5px"></div><div class="row" style="margin-top:14px"><span class="sp"></span><button class="btn pri" id="abGo">Ata</button></div>`, b => {
      const info = () => { const a = +b.querySelector('#abA').value, bb = +b.querySelector('#abB').value; const A = TSTATS[a], B = TSTATS[bb];
        b.querySelector('#abInfo').textContent = a && bb ? `A: ${A?.sent || 0} gönderim, %${A?.rate || 0} yanıt · B: ${B?.sent || 0} gönderim, %${B?.rate || 0} yanıt` : ''; };
      b.onchange = info;
      b.querySelector('#abGo').onclick = () => { const a = b.querySelector('#abA').value, bb = b.querySelector('#abB').value; if (!a || !bb || a === bb) return toast('İki farklı şablon seç', true);
        const { map, wa } = abSplit(s, a, bb); Object.entries(map).forEach(([id, v]) => setTpl(+id, v)); closeModal(); toast(`A/B atandı (A %${Math.round(wa * 100)} / B %${Math.round((1 - wa) * 100)})`); };
    });
  };
  $('mlPrev').onclick = tryT(async () => {
    const id = ids()[0] || rows[0]?.id, tp = choice[id]; if (!id || !tp) return toast('Şablonu seçilmiş bir kişi seç', true);
    const T = TPLS.find(x => x.id === +tp), who = rows.find(x => x.id === id);
    modal('Önizleme · ' + (who?.name || ''), `<div id="pvBox"><p class="mut"><span class="spin"></span> ${personal ? 'AI firmayı araştırıp kişisel cümle yazıyor…' : 'Hazırlanıyor…'}</p></div>`);
    let opener = '';
    if (personal) { try { opener = (await post('/api/ai/opener', { contact_id: id, lang: /^EN/.test(T.name) ? 'English' : 'Türkçe' })).opener || ''; } catch {} }
    const body = personal && opener ? (T.body.includes('{{kisisel}}') ? T.body.replace(/\{\{\s*kisisel\s*\}\}/, opener) : T.body.replace(/^([^\n]{0,80}[,!:])\s*\n\s*\n/, `$1\n\n${opener}\n\n`)) : T.body.replace(/\{\{\s*kisisel\s*\}\}\n*/g, '');
    const r = await post('/api/mail/preview', { subject: T.subject, body, contact_id: id });
    if ($('pvBox')) $('pvBox').innerHTML = `${personal ? (opener ? `<div class="banner ok">✨ Kişisel cümle: “${esc(opener)}”</div>` : '<div class="banner">Bu firma için güvenilir bir güncel bilgi bulunamadı — mail şablonla aynen gider.</div>') : ''}
      <div class="preview"><b>${esc(r.subject)}</b><hr style="border:0;border-top:1px solid #eee">${r.html}</div>`;
  });
  $('mlGo').onclick = e => busyBtn(e.currentTarget, async () => {
    const s = ids(); if (!s.length) return toast('Kişi seç', true);
    const missing = s.filter(id => !choice[id]); if (missing.length) return toast(`${missing.length} kişiye şablon seçilmedi ("Seçilenlere şablon", "Unvana göre" ya da "A/B")`, true);
    const st2 = await api('/api/sending');
    if (!confirm(`${s.length} kişi kuyruğa alınacak${personal ? ' (kişiye özel ilk cümleyle)' : ''}.\n\nGmail'i korumak için bugün en fazla ${Math.max(0, st2.daily - st2.today)} mail daha gider (${st2.senders?.length || 0} hesap, toplam limit ${st2.daily}${st2.warmup ? ', ısınma modu' : ''}); mailler arası 2–5 dk beklenir, aynı firmaya günde en fazla 2 mail gider. Kalanlar sonraki iş günlerine kalır. Göndermeden önce her adres doğrulanır.\n\nDevam?`)) return;
    const r = await post('/api/outbox/compose-multi', { items: s.map(id => ({ contact_id: id, template_id: +choice[id] })), send: true, personal });
    const why = {}; r.skipped.forEach(x => why[x.why] = (why[x.why] || 0) + 1);
    toast(`${r.added} mail kuyruğa alındı${r.risky ? ` (${r.risky} riskli adres)` : ''}${r.skipped.length ? ' · atlanan: ' + Object.entries(why).map(([k, v]) => `${v} ${k}`).join(', ') : ''}`);
    draw();
  }, 'Doğrulanıyor');
  await draw();
});

// ================= Şablonlar (+ performans) =================
PAGES.templates = tryT(async (sel) => {
  const [tp, st] = await Promise.all([api('/api/templates'), api('/api/templates/stats')]);
  TPLS = tp; TSTATS = Object.fromEntries(st.map(x => [x.id, x]));
  const best = st.filter(x => x.sent >= 10).sort((a, b) => b.rate - a.rate)[0];
  let cur = TPLS.find(t => t.id === +sel) || TPLS[0] || { id: 0, name: '', subject: '', body: '' };
  const draw = () => {
    main.innerHTML = head('Mail Şablonları', 'Değişkenler alıcıya göre dolar: {{ad}} {{adsoyad}} {{sirket}} {{unvan}} {{gonderen}}. {{kisisel}} yazarsan AI\'ın kişisel cümlesi tam oraya girer (yazmazsan selamlamanın altına eklenir). İmzan otomatik eklenir.', '<button class="btn pri" id="tNew">＋ Yeni şablon</button>') +
    `<div class="grid" style="grid-template-columns:minmax(240px,340px) 1fr;align-items:start" id="tGrid">
      <div class="card" style="padding:8px">${TPLS.map(t => { const s = TSTATS[t.id] || {}; return `<a class="step" href="#templates/${t.id}" style="margin:4px;color:inherit;text-decoration:none;${t.id === cur.id ? 'border-color:var(--txt);box-shadow:var(--sh2)' : ''}">
        <span><span style="display:block;font-weight:550">${esc(t.name)}${best?.id === t.id ? ' 🏆' : ''}</span><small class="mut">${s.sent ? `${s.sent} gönderim · %${s.rate} yanıt · %${s.prate} olumlu` : 'henüz gönderilmedi'}</small></span></a>`; }).join('') || '<p class="mut" style="padding:12px">Şablon yok</p>'}</div>
      <div class="card"><label>Şablon adı<input id="tN" value="${esc(cur.name)}"></label><label style="margin-top:10px">Konu<input id="tS" value="${esc(cur.subject)}"></label>
        <label style="margin-top:10px">İçerik<textarea id="tB" rows="16">${esc(cur.body)}</textarea></label>
        <div class="chips" style="margin-top:8px">${[...VARS, 'kisisel'].map(v => `<span class="chip var" data-v="${v}">{{${v}}}</span>`).join('')}</div>
        <div class="row" style="margin-top:14px"><button class="btn pri" id="tSv">Kaydet</button><button class="btn" id="tPv">Önizle</button><span class="sp"></span>${cur.id ? '<button class="btn danger" id="tDl">Sil</button>' : ''}</div>
        <div id="tPo" style="margin-top:12px"></div></div></div>`;
    if (innerWidth < 860) $('tGrid').style.gridTemplateColumns = '1fr';
    let focus = $('tB'); $('tS').onfocus = e => focus = e.target; $('tB').onfocus = e => focus = e.target;
    main.onclick = e => { const v = e.target.closest('[data-v]'); if (v) { const p = focus.selectionStart ?? focus.value.length; focus.value = focus.value.slice(0, p) + `{{${v.dataset.v}}}` + focus.value.slice(focus.selectionEnd ?? p); focus.focus(); } };
    $('tNew').onclick = () => { cur = { id: 0, name: 'Yeni şablon', subject: '', body: 'Sayın {{adsoyad}},\n\n{{kisisel}}\n\n\n\nSaygılarımla,\n{{gonderen}}' }; draw(); };
    $('tSv').onclick = tryT(async () => {
      await post('/api/templates', { id: cur.id || undefined, name: $('tN').value, subject: $('tS').value, body: $('tB').value });
      TPLS = await api('/api/templates'); cur = TPLS.find(t => t.name === $('tN').value) || TPLS[0]; toast('Şablon kaydedildi'); draw();
    });
    $('tPv').onclick = tryT(async () => { const r = await post('/api/mail/preview', { subject: $('tS').value, body: $('tB').value.replace(/\{\{\s*kisisel\s*\}\}/, '[AI kişisel cümlesi buraya gelecek]') }); $('tPo').innerHTML = `<div class="preview"><b>${esc(r.subject)}</b><hr style="border:0;border-top:1px solid #eee">${r.html}</div>`; });
    if ($('tDl')) $('tDl').onclick = tryT(async () => { if (!confirm('Şablon silinsin mi?')) return; await del('/api/templates/' + cur.id); TPLS = await api('/api/templates'); cur = TPLS[0] || { id: 0, name: '', subject: '', body: '' }; draw(); });
  };
  draw();
});


// ================= v10 · hesap başı imza, kapasite planı, kullanım/bütçe, otomatik kampanya, puanlı sinyaller =================
const SIG_ADDR = 'Muallimköy Mah. Deniz Cad. No: 143/8 1.1.C1 Blok Zemin Kat<br>Kapı No: Z01 Gebze / KOCAELİ';
function buildSignature({ name = '', title = '', phone = '', address = SIG_ADDR, web = 'hypevisionlab.com', logo = 'https://hypevisionlab.com/hypevisionlogo.png' }) {
  const tel = String(phone).replace(/[^\d+]/g, '');
  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:13px;line-height:1.5">
  <tr>
    <td style="padding-right:16px;border-right:3px solid #12c2d9;vertical-align:middle">
      <a href="https://${esc(web)}" target="_blank"><img src="${esc(logo)}" alt="Hype Vision" width="150" style="display:block;border:0;width:150px;height:auto"></a>
    </td>
    <td style="padding-left:16px;vertical-align:middle">
      <div style="font-size:16px;font-weight:bold;color:#0f2a5c">${esc(name)}</div>
      ${title ? `<div style="color:#12a3b8;font-weight:bold;margin-bottom:6px">${esc(title)}</div>` : ''}
      ${phone ? `<div><a href="tel:${esc(tel)}" style="color:#1f2937;text-decoration:none">${esc(phone)}</a></div>` : ''}
      <div><a href="https://${esc(web)}" target="_blank" style="color:#0f2a5c;text-decoration:none;font-weight:bold">${esc(web)}</a></div>
      ${address ? `<div style="color:#6b7280;font-size:12px;margin-top:4px">${address}</div>` : ''}
    </td>
  </tr>
</table>`;
}
function signatureModal(s, onSaved) {
  const name = s.name || '';
  modal('İmza · ' + s.email, `<p class="mut" style="margin-top:0">Bu hesaptan giden her mailin altına eklenir. Boş bırakırsan kullanıcının kendi imzası kullanılır.</p>
    <div class="grid g2"><label>Ad Soyad<input id="sgN" value="${esc(name)}"></label><label>Unvan<input id="sgT" placeholder="ör. Satış Müdürü"></label>
    <label>Telefon<input id="sgP" placeholder="+90 5xx xxx xx xx"></label><label>Web<input id="sgW" value="hypevisionlab.com"></label></div>
    <label style="margin-top:10px">Adres (HTML, &lt;br&gt; ile satır)<input id="sgA" value="${esc(SIG_ADDR)}"></label>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="sgB">↻ Bu bilgilerle Hype Vision imzası oluştur</button></div>
    <label style="margin-top:12px">İmza HTML<textarea id="sgH" rows="7" style="font:12px ui-monospace,Consolas,monospace">${esc(s.signature || '')}</textarea></label>
    <div class="preview" id="sgV" style="margin-top:10px"></div>
    <div class="row" style="margin-top:14px"><button class="btn danger sm" id="sgX">İmzayı kaldır</button><span class="sp"></span><button class="btn pri" id="sgS">Kaydet</button></div>`, b => {
    const pv = () => b.querySelector('#sgV').innerHTML = b.querySelector('#sgH').value || '<span style="color:#999">İmza yok — kullanıcının imzası kullanılır</span>';
    b.querySelector('#sgH').oninput = pv; pv();
    b.querySelector('#sgB').onclick = () => { b.querySelector('#sgH').value = buildSignature({ name: b.querySelector('#sgN').value, title: b.querySelector('#sgT').value, phone: b.querySelector('#sgP').value, web: b.querySelector('#sgW').value, address: b.querySelector('#sgA').value }); pv(); };
    if (!s.signature) b.querySelector('#sgB').click();
    const save = v => tryT(async () => { await put('/api/senders/' + s.id, { signature: v, name: b.querySelector('#sgN').value }); closeModal(); toast('İmza kaydedildi'); onSaved?.(); });
    b.querySelector('#sgS').onclick = () => save(b.querySelector('#sgH').value)();
    b.querySelector('#sgX').onclick = () => save('')();
  });
}
renderSenders = async function (el) {
  const [list, st] = await Promise.all([api('/api/senders'), api('/api/sending')]), adm = ME.role === 'admin';
  const act = list.filter(s => s.active), cap = act.reduce((a, s) => a + s.eff, 0), left = Math.max(0, cap - act.reduce((a, s) => a + s.today, 0));
  const fullCap = act.reduce((a, s) => a + s.daily, 0), days = cap ? Math.ceil(Math.max(0, st.queued - left) / Math.max(1, cap)) + (st.queued > 0 ? 0 : 0) : 0;
  el.innerHTML = `<div class="card-h"><h3>Gönderen Gmail hesapları</h3><span class="pill ${act.length ? 'ok' : 'bad'}">${act.length} aktif</span></div>
    <div class="mini3" style="margin:0 0 14px"><a><b>${cap}</b>Bugünkü kapasite</a><a><b>${left}</b>Bugün kalan</a><a><b>${st.queued}</b>Sırada${st.queued > left && cap ? ` · ~${days + 1} iş günü` : ''}</a></div>
    <p class="hint">Sistem otomatik planlar: her mail o an en az kullanılmış hesaptan gider, dolan hesap atlanır, takipler ilk maili atan hesaptan aynı zincirde gider. Her hesap kendi ısınmasıyla
      günde 10'dan başlayıp her gün +3 artar ve <b>Limit</b> değerine kadar çıkar${fullCap > cap ? ` (tam kapasite ${fullCap}/gün)` : ''}. Bir hesaptan 24 saatte 2 mail geri dönerse yalnızca o hesap durur.</p>
    ${list.length ? `<div class="tw" style="margin-bottom:14px"><table><thead><tr><th>Hesap</th><th>Bugün</th><th>Limit</th><th>İmza</th><th>Aktif</th><th></th></tr></thead><tbody>
    ${list.map(s => `<tr><td><div class="ent">${avatar(s.name || s.email)}<div><div class="n">${esc(s.email)}</div><small>${esc(s.name || '—')}${s.note ? ' · <span style="color:var(--bad)">' + esc(s.note) + '</span>' : ''}</small></div></div></td>
      <td><b>${s.today}</b><span class="mut">/${s.eff}</span>${s.eff < s.daily ? ' <span class="pill info">ısınma</span>' : ''}</td>
      <td>${adm ? `<input type="number" min="5" max="200" value="${s.daily}" data-sd="${s.id}" style="width:72px;height:32px">` : s.daily}</td>
      <td><button class="btn sm" data-sig="${s.id}">${s.signature ? '✓ Düzenle' : '＋ Ekle'}</button></td>
      <td>${adm ? `<label class="switch"><input type="checkbox" data-sa="${s.id}" ${s.active ? 'checked' : ''}><i></i></label>` : pill(s.active ? 'aktif' : 'pasif')}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-st="${s.id}">Test</button>${adm ? ` <button class="icon" data-sx="${s.id}" title="Kaldır">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${list.length && list.every(s => s.daily <= 10) ? '<div class="banner info">Öneri: limitleri 30–40 yap. Isınma modu açık olduğu için hesaplar yine 10\'dan başlayıp günde +3 ile kendiliğinden yükselir; elle artırmana gerek kalmaz.</div>' : ''}
    ${adm ? `<details ${list.length ? '' : 'open'}><summary class="btn sm" style="list-style:none;display:inline-flex">＋ Hesap ekle</summary>
      <div class="grid g2" style="margin-top:12px"><label>Gmail / Workspace adresi<input id="nsE" placeholder="ad@hypevisionlab.com" autocomplete="off"></label>
      <label>Uygulama şifresi (16 hane)<input id="nsP" type="password" placeholder="xxxx xxxx xxxx xxxx" autocomplete="new-password"></label>
      <label>Gönderen adı<input id="nsN" placeholder="Ad Soyad"></label><label>Günlük limit<input id="nsD" type="number" value="40" min="5" max="200"></label></div>
      <div class="row" style="margin-top:12px"><button class="btn pri" id="nsGo">Bağlan ve test maili gönder</button></div></details>` : ''}`;
  el.onclick = tryT(async e => {
    const g = e.target.closest('[data-sig]'); if (g) return signatureModal(list.find(s => s.id === +g.dataset.sig), () => renderSenders(el));
    const t = e.target.closest('[data-st]'); if (t) return busyBtn(t, async () => { const r = await post(`/api/senders/${t.dataset.st}/test`, {}); toast('Test maili (imzalı) gönderildi → ' + r.to); }, '…');
    const x = e.target.closest('[data-sx]'); if (x && confirm('Hesap kaldırılsın mı? (Gönderim geçmişi olan hesap pasife alınır)')) { await del('/api/senders/' + x.dataset.sx); renderSenders(el); }
  });
  el.onchange = tryT(async e => {
    const a = e.target.closest('[data-sa]'); if (a) { await put('/api/senders/' + a.dataset.sa, { active: a.checked }); toast(a.checked ? 'Hesap aktif' : 'Hesap pasif'); renderSenders(el); }
    const d = e.target.closest('[data-sd]'); if (d) { await put('/api/senders/' + d.dataset.sd, { daily: +d.value }); toast('Limit kaydedildi'); renderSenders(el); }
  });
  if ($('nsGo')) $('nsGo').onclick = ev => busyBtn(ev.currentTarget, async () => {
    await post('/api/senders', { email: $('nsE').value, pass: $('nsP').value, name: $('nsN').value, daily: $('nsD').value });
    toast('Hesap eklendi ✓ test maili gönderildi'); renderSenders(el); renderDomain($('dhCard'));
  }, 'Bağlanıyor');
};

// Panel: RocketReach bütçesi + OpenAI maliyeti
async function usageCard(el) {
  if (!el) return;
  try {
    const u = await api('/api/usage'), b = u.rr || {}, today = u.ai[0] || { usd: 0, web: 0, calls: 0, by: {} };
    const m30 = u.ai.reduce((a, d) => a + (d.usd || 0), 0), by = Object.entries(today.by || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const p = (a, c) => Math.min(100, c ? a / c * 100 : 0);
    el.innerHTML = `<div class="card-h"><h3>Kullanım ve bütçe</h3><span class="mut" style="font-size:12px">bugün</span></div>
      ${b.daily ? `<p style="margin:0 0 4px;font-weight:600;font-size:13px">RocketReach mail sorgusu</p>
      <div class="quota"><span>Bugün (günlük pay)</span><span class="${b.today >= b.daily ? 'err' : 'mut'}">${b.today} / ${b.daily}</span><div class="bar"><i style="width:${p(b.today, b.daily)}%"></i></div>
      <span>Bu ay</span><span class="mut">${b.month} / ${b.cap} · ${b.daysLeft} gün kaldı</span><div class="bar"><i style="width:${p(b.month, b.cap)}%"></i></div></div>` : ''}
      <p style="margin:6px 0 4px;font-weight:600;font-size:13px">OpenAI</p>
      <div class="quota"><span>Bugün</span><span class="mut">$${(today.usd || 0).toFixed(2)} ·${today.calls || 0} çağrı · ${today.web || 0} web araması</span>
      <span>Son 30 gün</span><span class="mut">$${m30.toFixed(2)}</span></div>
      ${by.length ? `<div class="chips" style="margin-top:8px">${by.map(([k, v]) => `<span class="chip" style="height:24px;font-size:11.5px">${esc(k)} $${v.toFixed(2)}</span>`).join('')}</div>` : ''}`;
  } catch (e) { el.innerHTML = '<h3>Kullanım</h3><p class="mut">' + esc(e.message) + '</p>'; }
}

// Entegrasyonlar: otomatik günlük kampanya + RocketReach aylık bütçe
async function autoCard(el) {
  const [a, u] = await Promise.all([api('/api/auto-daily'), api('/api/usage')]), adm = ME.role === 'admin', dis = adm ? '' : 'disabled';
  el.innerHTML = `<div class="card-h"><h3>🤖 Otomatik günlük kampanya</h3>${a.enabled ? '<span class="pill ok">açık</span>' : '<span class="pill">kapalı</span>'}</div>
    <p class="hint">Her iş günü belirlenen saatte AI şirket profiline göre yeni bir sektör + bölge seçer, firmaları bulur, her firmadan en uygun yetkiliyi (LinkedIn profiliyle) çıkarır. Akşam 18:00'de bulunanların LinkedIn listesi Telegram'a gelir. Mail sorgusu günlük RocketReach bütçesi içinde kalır.</p>
    <div class="toggle-row"><div><b>Açık</b><small>Her iş günü bir kampanya</small></div><label class="switch"><input type="checkbox" id="adE" ${a.enabled ? 'checked' : ''} ${dis}><i></i></label></div>
    <div class="toggle-row"><div><b>Mailleri de bul</b><small>Kapalıysa sadece firmalar + yetkililer + LinkedIn (RocketReach mail kotası harcanmaz)</small></div><label class="switch"><input type="checkbox" id="adL" ${a.lookup ? 'checked' : ''} ${dis}><i></i></label></div>
    <div class="toggle-row"><div><b>Sadece Türkiye</b><small>Kapalıysa yurt dışı önerileri de sıraya girer</small></div><label class="switch"><input type="checkbox" id="adT" ${a.tr_only ? 'checked' : ''} ${dis}><i></i></label></div>
    <div class="grid g3" style="margin-top:8px"><label>Firma sayısı<input type="number" id="adC" value="${a.count}" min="5" max="60" ${dis}></label><label>Saat<input type="number" id="adH" value="${a.hour}" min="6" max="16" ${dis}></label>
      <label>RocketReach aylık mail sorgusu bütçesi<input type="number" id="adB" value="${u.rr_month_budget || u.rr?.cap || 5000}" min="0" ${dis}></label></div>
    <p class="mut" style="font-size:12px;margin:8px 0 0">Bütçe ay sonuna eşit yayılır: bugünkü pay <b>${u.rr?.daily ?? '—'}</b> sorgu. Son otomatik kampanya: ${a.list?.[0] ? esc(a.list[0].name) : '—'}</p>
    <div class="row" style="margin-top:12px">${adm ? '<button class="btn pri" id="adS">Kaydet</button>' : ''}<button class="btn" id="adR">Şimdi bir kampanya başlat</button></div>`;
  if (adm) $('adS').onclick = tryT(async () => {
    await put('/api/auto-daily', { enabled: $('adE').checked, lookup: $('adL').checked, tr_only: $('adT').checked, count: +$('adC').value, hour: +$('adH').value });
    await put('/api/usage', { rr_month_budget: +$('adB').value }); toast('Kaydedildi'); autoCard(el);
  });
  $('adR').onclick = e => busyBtn(e.currentTarget, async () => { const r = await post('/api/auto-daily/run'); toast(`Başladı: ${r.idea.sector}${r.idea.location ? ' · ' + r.idea.location : ''}`); location.hash = `c/${r.id}/companies`; }, 'AI seçiyor');
}

// Sinyaller: puanlı
PAGES.signals = tryT(async () => {
  await loadCamps();
  const list = await api('/api/signals');
  const sc = n => n >= 8 ? 'ok' : n >= 6 ? 'warn' : '';
  main.innerHTML = head('Sinyaller', 'AI günde 3 kez (09:00, 13:00, 17:00) aktif kampanyalarının sektör ve bölgesinde son haberleri tarar ve her sinyale satış fırsatı puanı verir. 8 ve üstü sinyaller Telegram\'a "güçlü sinyal" olarak düşer.',
    `<select id="sgC" style="width:auto">${campOpts('Sıradaki kampanya')}</select><button class="btn pri" id="sgScan">📰 Şimdi tara</button>`) +
  (list.length ? `<div class="ideas">${list.map(s => `<div class="idea" data-sg="${s.id}"><div class="idea-top"><span class="pill ${sc(s.score)}" style="font-size:12px">★ ${s.score || '?'}/10</span><span class="pill">${SK[s.kind] || '📰'} ${esc(s.kind || 'haber')}</span><span class="mut">${esc(s.date || '')}</span></div>
    <div class="ent">${favicon(s.domain)}<div><h4>${esc(s.company)}</h4><small class="mut">${esc(s.city || '')}${s.campaign ? ' · ' + esc(s.campaign) : ''}</small></div></div>
    <p style="color:var(--txt)">${esc(s.event)}</p>${s.why ? `<p><b>Neden şimdi:</b> ${esc(s.why)}</p>` : ''}${s.angle ? `<p><b>Nasıl girilir:</b> ${esc(s.angle)}</p>` : ''}
    ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" style="font-size:12px">Haberi aç ↗</a>` : ''}
    <div class="row">${s.status === 'eklendi' ? pill('kampanyaya eklendi') : `<button class="btn sm pri" data-sa="${s.id}">Kampanyaya ekle + yetkiliyi bul</button>`}<button class="btn sm ghost" data-sh="${s.id}">Gizle</button></div></div>`).join('')}</div>`
  : empty('Henüz sinyal yok', 'Tarama günde 3 kez otomatik çalışır. Beklemek istemiyorsan "Şimdi tara".'));
  $('sgScan').onclick = e => busyBtn(e.currentTarget, async () => { const r = await post('/api/signals/scan', { campaign_id: $('sgC').value || null }); toast(r.queued ? `${r.queued} kampanya taranıyor — güçlü sinyaller Telegram'a gelir` : 'Aktif kampanya yok'); }, 'Kuyruğa');
  main.onclick = tryT(async e => {
    const a = e.target.closest('[data-sa]'); if (a) { await post(`/api/signals/${a.dataset.sa}/add`, { campaign_id: $('sgC').value || null }); toast('Firma eklendi; yetkili ve santral numarası aranıyor'); return PAGES.signals(); }
    const h = e.target.closest('[data-sh]'); if (h) { await put('/api/signals/' + h.dataset.sh, { status: 'gizli' }); h.closest('.idea').remove(); }
  });
});

boot();
