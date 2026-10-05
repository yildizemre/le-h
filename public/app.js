// emre-lead SPA
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('main');
let ME = null, CAMPS = [];
const sel = new Set(); // Kişilerim'de seçili kişi id'leri

async function api(url, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const r = await fetch(url, { ...opts, headers: isForm ? {} : { 'Content-Type': 'application/json' }, body: isForm || typeof opts.body === 'string' || opts.body === undefined ? opts.body : JSON.stringify(opts.body) });
  if (r.status === 401 && !url.endsWith('/login')) { boot(); throw new Error('Oturum kapandı, tekrar giriş yap'); }
  const ct = r.headers.get('content-type') || '';
  const j = ct.includes('json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error(j.error || j.detail || `Hata ${r.status}`);
  return j;
}
const post = (u, b = {}) => api(u, { method: 'POST', body: b });
const put = (u, b = {}) => api(u, { method: 'PUT', body: b });
const del = (u, b) => api(u, { method: 'DELETE', body: b });
function toast(msg, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; $('toasts').append(t); setTimeout(() => t.remove(), bad ? 7000 : 3200); }
const tryT = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
async function busyBtn(btn, fn, label = 'Çalışıyor') {
  const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${label}`;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = html; } }
}
const fmtDate = s => { if (!s) return ''; const d = new Date(/Z|T.*[+-]\d\d/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return isNaN(d) ? s : d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); };
const ago = s => { if (!s) return ''; const d = new Date(/Z|T.*[+-]\d\d/.test(s) ? s : s.replace(' ', 'T') + 'Z'), m = Math.round((Date.now() - d) / 60000); return m < 1 ? 'şimdi' : m < 60 ? m + ' dk' : m < 1440 ? Math.round(m / 60) + ' sa' : Math.round(m / 1440) + ' g'; };
const li = u => u ? `<a class="li" href="${esc(/^https?:/.test(u) ? u : 'https://' + u)}" target="_blank" rel="noopener" title="LinkedIn profili">in</a>` : '';
const J = v => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch { return []; } };
const PILL = { ok: /mail (var|bulundu)|gönderildi|bitti|yanıtladı|kişi bulundu|aktif|done/, warn: /emin|limit|paused|bekle|sırada|kuyruk|aranıyor|taslak|çalışıyor|takip/, bad: /hata|bulunamad|cancel|iptal|mail yok|kişi yok|engel|durdur/, info: /aday|yeni/ };
const pill = s => { s = String(s || ''); const c = Object.keys(PILL).find(k => PILL[k].test(s)) || ''; return `<span class="pill ${c}">${esc(s || '—')}</span>`; };
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
  $('campNav').innerHTML = CAMPS.map(c => `<a data-p="c/${c.id}"><span class="dot ${c.status === 'aktif' ? '' : 'off'}"></span><span class="t">${esc(c.name)}</span></a>`).join('')
    || '<a data-p="newcamp" class="mut"><i>＋</i>İlk kampanyanı oluştur</a>';
  markNav();
}
async function badges() {
  try {
    const s = await api('/api/stats');
    $('bOut').textContent = s.drafts ? s.drafts : ''; $('bOut').title = 'taslak';
    $('bQ').textContent = s.tasks + s.jobs || '';
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
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('theme', next); } catch {}
};
const drawer = open => { $('side').classList.toggle('open', open); $('scrim').classList.toggle('open', open); };
$('burger').onclick = () => drawer(true); $('scrim').onclick = () => drawer(false);
$('nav').onclick = e => { const a = e.target.closest('a[data-p]'); if (a) { location.hash = a.dataset.p; drawer(false); } };
$('newCamp').onclick = e => { e.stopPropagation(); location.hash = 'newcamp'; drawer(false); };
addEventListener('hashchange', () => ME && route());
function markNav() {
  const h = location.hash.slice(1) || 'dash';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', h === a.dataset.p || h.startsWith(a.dataset.p + '/')));
}
let timer;
function route() {
  clearInterval(timer); main.onclick = main.onchange = main.oninput = null;
  const [p, ...args] = (location.hash.slice(1) || 'dash').split('/');
  markNav(); window.scrollTo(0, 0);
  (PAGES[p] || PAGES.dash)(...args);
}
const head = (title, sub = '', actions = '') => `<div class="ph"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="row">${actions}</div></div>`;

const PAGES = {};

// ================= Panel =================
const EVI = { found: '🔎', sent: '📤', reply: '💬', job: '✅', limit: '⏳', error: '⚠️', info: 'ℹ️', company: '🏭' };
const feedHtml = ev => ev.length ? `<div class="feed">${ev.map(e => `<div><span class="ic">${EVI[e.type] || '•'}</span><span class="tx">${esc(e.text)}${e.campaign ? ` <small class="mut">· ${esc(e.campaign)}</small>` : ''}</span><time>${ago(e.created)}</time></div>`).join('')}</div>` : '<p class="mut">Henüz hareket yok</p>';
PAGES.dash = tryT(async () => {
  const [s, ev] = await Promise.all([api('/api/stats'), api('/api/events')]);
  const steps = [
    [s.setup.project, 'Şirket profilini doldur', 'project'], [s.setup.openai, 'OpenAI API key', 'settings'], [s.setup.rr, 'RocketReach API key', 'settings'],
    [s.setup.gmail, 'Gmail bağla ve test et', 'settings'], [s.setup.telegram, 'Telegram bildirimlerini bağla', 'settings'], [CAMPS.length > 0, 'İlk kampanyayı oluştur', 'newcamp'],
  ];
  const done = steps.filter(x => x[0]).length;
  main.innerHTML = head(`Merhaba ${esc(ME.name)} 👋`, 'Hedef bul → kişiyi çıkar → mailini bul → kuyrukla gönder', `<a class="btn pri" href="#newcamp">＋ Yeni kampanya</a>`) +
  `${Math.max(s.limits.lookup, s.limits.arama) ? `<div class="banner">⏳ RocketReach saatlik limit: lookup ${s.limits.lookup ? s.limits.lookup + ' dk' : 'açık'} · arama ${s.limits.arama ? s.limits.arama + ' dk' : 'açık'} — kuyruk kendiliğinden devam edecek.</div>` : ''}
  <div class="grid g5 kpis" style="margin-bottom:16px">
    <div class="card kpi"><b>${s.companies}</b><span>Hedef firma</span></div>
    <div class="card kpi"><b>${s.contacts}</b><span>Kişi</span></div>
    <div class="card kpi"><b style="color:var(--ok)">${s.withEmail}</b><span>Maili bulunan</span></div>
    <div class="card kpi"><b style="color:var(--pri)">${s.sent}</b><span>Gönderilen mail</span></div>
    <div class="card kpi"><b style="color:#f59e0b">${s.replied}</b><span>Yanıt</span></div>
  </div>
  <div class="grid g2" style="align-items:start">
    <div>
      ${done < steps.length ? `<div class="card"><div class="card-h"><h3>Kurulum</h3><span class="pill pri">${done}/${steps.length}</span></div><div class="steps">${steps.map(([ok, t, h]) => `<a class="step ${ok ? 'done' : ''}" href="#${h}" style="color:inherit;text-decoration:none"><span class="ck">${ok ? '✓' : ''}</span><span>${t}</span>${ok ? '' : '<span class="mut">→</span>'}</a>`).join('')}</div></div>` : ''}
      <div class="card"><div class="card-h"><h3>Gönderim durumu</h3><a href="#schedule" class="btn sm">Takvim</a></div>
        <div class="row" style="margin-bottom:10px">${s.sending.ok ? '<span class="pill ok">● Gönderim açık</span>' : `<span class="pill warn">${esc(s.sending.why)}</span>`}<span class="sp"></span><span class="mut">Bugün <b>${s.sending.today}/${s.sending.daily}</b></span></div>
        <div class="bar"><i style="width:${Math.min(100, s.sending.today / s.sending.daily * 100)}%"></i></div>
        <div class="row" style="margin-top:14px"><a href="#outbox/taslak" class="btn sm">Taslak <b>${s.drafts}</b></a><a href="#outbox/sırada" class="btn sm">Sırada <b>${s.queued}</b></a><a href="#queue" class="btn sm">Arka plan işi <b>${s.tasks + s.jobs}</b></a></div></div>
      <div class="card"><h3 style="margin-bottom:12px">Kampanyalar</h3>${CAMPS.length ? CAMPS.map(c => `<a href="#c/${c.id}" class="row" style="padding:9px 0;border-top:1px solid var(--line);color:inherit;text-decoration:none">
        <span class="sp"><b>${esc(c.name)}</b><br><small class="mut">${c.companies} firma · ${c.leads} kişi · ${c.with_email} mail · ${c.sent} gönderildi${c.replied ? ` · ${c.replied} yanıt` : ''}</small></span>${pill(c.status)}</a>`).join('') : '<p class="mut">Henüz kampanya yok. <a href="#newcamp">Oluştur →</a></p>'}</div>
    </div>
    <div class="card"><div class="card-h"><h3>Son hareketler</h3><span class="mut" style="font-size:12px">Telegram'a da gider</span></div>${feedHtml(ev.slice(0, 40))}</div>
  </div>`;
  timer = setInterval(() => location.hash.replace('#', '') in { '': 1, dash: 1 } && PAGES.dash(), 30000);
});

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
PAGES.newcamp = () => {
  main.innerHTML = head('Yeni kampanya', 'Kime satmak istediğini kendi cümlenle yaz; AI hedeflemeyi, unvanları ve kriterleri hazırlasın.') +
  `<div class="card" style="max-width:820px"><label>Hedef tarifi<textarea id="brief" rows="4" placeholder="ör. Kocaeli ve Bursa'daki 100+ çalışanlı otomotiv yan sanayi fabrikalarının İSG ve fabrika müdürleri. Vardiyalı çalışan, kamerası olan tesisler."></textarea></label>
  <div class="chips" style="margin-top:10px">${['Fabrika İSG yöneticileri', 'Gıda fabrikaları üretim müdürleri', 'Lojistik depo operasyon müdürleri', 'İnşaat şantiye İSG şefleri', 'Hastane güvenlik / tesis yöneticileri', 'AVM ve perakende zincir operasyon'].map(s => `<span class="chip sug" data-b="${esc(s)}">+ ${esc(s)}</span>`).join('')}</div>
  <div class="row" style="margin-top:16px"><button class="btn pri lg" id="mk">✨ AI ile kampanya oluştur</button><button class="btn" id="mkEmpty">Boş oluştur</button></div></div>`;
  main.onclick = e => { const b = e.target.closest('[data-b]'); if (b) $('brief').value = b.dataset.b; };
  $('mk').onclick = e => busyBtn(e.currentTarget, async () => {
    const brief = $('brief').value.trim(); if (!brief) return toast('Hedef tarifini yaz', true);
    const s = await post('/api/ai/suggest', { brief });
    const { id } = await post('/api/campaigns', { ...s, brief, name: s.name || brief.slice(0, 40) });
    await loadCamps(); location.hash = `c/${id}/targeting`; toast('Kampanya oluşturuldu — hedeflemeyi kontrol et');
  }, 'AI hedefleme hazırlıyor');
  $('mkEmpty').onclick = tryT(async () => { const { id } = await post('/api/campaigns', { name: $('brief').value.slice(0, 40) || 'Yeni kampanya', brief: $('brief').value }); await loadCamps(); location.hash = `c/${id}/targeting`; });
};

const CTABS = [['overview', 'Genel'], ['targeting', 'Hedefleme'], ['companies', 'Firmalar'], ['people', 'Kişiler'], ['emails', 'Mailler'], ['activity', 'Akış']];
PAGES.c = tryT(async (id, tab = 'overview', sub) => {
  const c = await api('/api/campaigns/' + id);
  main.innerHTML = `<div class="ph"><div><div class="row"><h1>${esc(c.name)}</h1>${pill(c.status)}</div><p class="sub">${esc(c.brief || c.offer || '')}</p></div>
    <div class="row"><button class="btn" id="cToggle">${c.status === 'aktif' ? '❚❚ Duraklat' : '▶ Devam et'}</button><a class="btn" href="/api/campaigns/${c.id}/export">Excel</a><button class="icon" id="cDel" title="Kampanyayı sil">🗑</button></div></div>
    <div class="tabs" style="margin-bottom:18px">${CTABS.map(([k, l]) => `<a href="#c/${c.id}/${k}" class="${tab === k ? 'on' : ''}">${l}${k === 'companies' ? `<span class="cnt">${c.companies}</span>` : k === 'people' ? `<span class="cnt">${c.leads}</span>` : ''}</a>`).join('')}</div><div id="ctab"></div>`;
  $('cToggle').onclick = tryT(async () => { await put('/api/campaigns/' + c.id, { status: c.status === 'aktif' ? 'duraklatıldı' : 'aktif' }); await loadCamps(); route(); });
  $('cDel').onclick = tryT(async () => { if (!confirm(`"${c.name}" kampanyası silinsin mi? (Kişiler Kişilerim'de kalır)`)) return; await del('/api/campaigns/' + c.id); await loadCamps(); location.hash = 'dash'; });
  await (CTAB[tab] || CTAB.overview)(c, $('ctab'), sub);
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

CTAB.companies = async (c, el) => {
  const draw = async () => {
    const cos = await api(`/api/campaigns/${c.id}/companies`);
    const pending = cos.some(x => ['kuyrukta', 'kişi aranıyor'].includes(x.status));
    el.innerHTML = `<div class="card"><div class="row"><label style="flex:1;min-width:200px">AI ile web'den firma bul<select id="fcCount">${[10, 20, 30, 40].map(n => `<option value="${n}" ${n === 20 ? 'selected' : ''}>${n} firma</option>`).join('')}</select></label>
      <label class="inline" style="align-self:flex-end;padding-bottom:8px"><input type="checkbox" id="fcPeople"> kişileri de bul</label>
      <button class="btn pri" id="fcGo" style="align-self:flex-end">✨ Firma bul</button><button class="btn" id="fcManual" style="align-self:flex-end">＋ Elle ekle</button></div>
      <p class="mut" style="font-size:12px;margin:8px 0 0">AI hedeflemedeki kriterlere göre web'de gerçek firmaları arar, daha önce bulunanları tekrar getirmez. Bir tur ~1 dk.</p></div>
    ${cos.length ? `<div class="tw"><table><thead><tr><th class="c"><input type="checkbox" id="fAll"></th><th>Firma</th><th class="hide-m">Şehir</th><th class="hide-m">Sektör</th><th>Skor</th><th class="hide-m">Neden uygun</th><th>Kişi</th><th>Durum</th></tr></thead><tbody>
    ${cos.map(x => `<tr><td class="c"><input type="checkbox" data-co="${x.id}"></td><td class="w"><div class="n">${esc(x.name)}</div><small><a href="https://${esc(x.domain)}" target="_blank" rel="noopener">${esc(x.domain)}</a>${x.size ? ' · ' + esc(x.size) : ''}</small></td>
      <td class="hide-m">${esc(x.city)}</td><td class="hide-m">${esc(x.sector)}</td><td>${x.score ? `<b>${x.score}</b>/10` : ''}</td><td class="hide-m" style="max-width:340px"><small>${esc(x.reason)}</small></td>
      <td>${x.people ? `<a href="#c/${c.id}/people">${x.people}</a>` : '—'}</td><td>${pill(x.status)}</td></tr>`).join('')}</tbody></table></div>
    <div class="selbar"><b id="fN">0 seçili</b><span class="sp"></span><select id="fMax"><option value="3">firma başı 3 kişi</option><option value="5" selected>5 kişi</option><option value="10">10 kişi</option></select>
      <button class="btn" id="fPeople">👥 Kişileri bul</button><button class="btn" id="fDel">Sil</button></div>`
    : empty('Henüz firma yok', '"Firma bul" ile AI web\'den aday firmaları getirsin.')}`;
    const ids = () => [...el.querySelectorAll('[data-co]:checked')].map(x => +x.dataset.co);
    const upd = () => { if ($('fN')) $('fN').textContent = ids().length ? ids().length + ' firma seçili' : 'Firma seç (veya tümü)'; };
    upd();
    el.onchange = e => { if (e.target.id === 'fAll') el.querySelectorAll('[data-co]').forEach(x => x.checked = e.target.checked); upd(); };
    $('fcGo').onclick = ev => busyBtn(ev.currentTarget, async () => { await post(`/api/campaigns/${c.id}/find-companies`, { count: +$('fcCount').value, people: $('fcPeople').checked }); toast('AI firma araması başladı, liste birazdan dolacak'); }, 'Kuyruğa');
    $('fcManual').onclick = () => modal('Elle firma ekle', `<p class="mut" style="margin-top:0">Her satıra bir firma: <code>Firma Adı, alanadi.com</code></p><textarea id="mText" rows="8" placeholder="Farplas Otomotiv, farplas.com&#10;EKU Fren, eku.com.tr"></textarea><div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn pri" id="mGo">Ekle</button></div>`,
      b => b.querySelector('#mGo').onclick = tryT(async () => { const r = await post(`/api/campaigns/${c.id}/companies`, { text: b.querySelector('#mText').value }); closeModal(); toast(r.added + ' firma eklendi'); draw(); }));
    if ($('fPeople')) {
      $('fPeople').onclick = ev => busyBtn(ev.currentTarget, async () => {
        const list = ids().length ? ids() : cos.filter(x => ['yeni', 'kişi yok'].includes(x.status)).map(x => x.id);
        if (!list.length) return toast('Seçili firma yok', true);
        const r = await post('/api/companies/people', { ids: list, max: +$('fMax').value }); toast(r.queued + ' firma kişi aramasına alındı'); draw();
      }, 'Kuyruğa');
      $('fDel').onclick = tryT(async () => { if (!ids().length || !confirm(ids().length + ' firma silinsin mi?')) return; await del('/api/companies', { ids: ids() }); draw(); });
    }
    clearInterval(timer);
    timer = setInterval(() => { if (location.hash === `#c/${c.id}/companies` && !el.querySelector('[data-co]:checked')) draw(); }, pending ? 8000 : 25000);
  };
  await draw();
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
    ${list.map(x => `<tr><td class="c"><input type="checkbox" data-l="${x.id}"></td><td class="w"><div class="n">${esc(x.name)}</div><small>${esc(x.title)}</small></td>
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
      if (b.dataset.a === 'lookup') { const r = await post('/api/queue/lookup', { contact_ids: sel2, campaign_id: c.id }); toast(`${r.queued} kişi mail aramasına alındı`); }
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
  main.innerHTML = head('Kişi Ara', 'RocketReach veritabanında ara. Virgülle birden fazla değer yazabilirsin. Arama ücretsiz; mail için lookup harcanır.') +
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
  ${r.profiles.map((p, i) => `<tr data-i="${i}"><td class="c"><input type="checkbox" data-r="${i}"></td><td class="w"><div class="n">${esc(p.name)}</div><small>${esc(p.title)}</small></td><td>${esc(p.company)}<small>${esc(p.domain || '')}</small></td>
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
  main.innerHTML = head(favOnly ? 'Favoriler' : 'Kişilerim', favOnly ? 'Yıldızladığın kişiler' : 'Ekibin bulduğu tüm kişiler — kampanyadan, aramadan ve Excel\'den') +
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
    <td class="w"><div class="n">${esc(c.name)}</div><small>${esc(c.title)}</small></td><td>${esc(c.company)}<small>${esc(c.location)}</small></td>
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
    if (a.dataset.a === 'lookup') { const r = await post('/api/queue/lookup', { contact_ids: ids }); toast(`${r.queued} kişi mail kuyruğuna alındı (maili olanlar atlandı)`); }
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
    <label>Mailler arası en az (sn)<input type="number" id="sMin" min="20" value="${sc.min_delay}"></label><label>En fazla (sn)<input type="number" id="sMax" min="20" value="${sc.max_delay}"></label></div>
    <div class="toggle-row" style="margin-top:14px"><div><b>Gönderimi duraklat</b><small>Tüm kuyruk bekler</small></div><label class="switch"><input type="checkbox" id="sPause" ${s.sending_paused ? 'checked' : ''}><i></i></label></div>
    <button class="btn pri" id="sSave" style="margin-top:10px" ${ME.role !== 'admin' ? 'disabled title="Yönetici"' : ''}>Kaydet</button></div>
  <div><div class="card"><h3 style="margin-bottom:12px">Şu an</h3><dl class="dl"><dt>Durum</dt><dd>${st.ok ? '<span class="pill ok">● Gönderiyor</span>' : `<span class="pill warn">${esc(st.why)}</span>`}</dd>
    <dt>Bugün gönderilen</dt><dd>${st.today} / ${st.daily}</dd><dt>Sırada</dt><dd>${st.queued}</dd><dt>Taslak</dt><dd>${st.counts['taslak'] || 0}</dd><dt>Toplam gönderilen</dt><dd>${st.counts['gönderildi'] || 0}</dd><dt>Hatalı</dt><dd>${st.counts['hata'] || 0}</dd></dl>
    <div class="row" style="margin-top:14px"><a href="#outbox/sırada" class="btn sm">Kuyruğu gör</a><button class="btn sm" id="sReply">Yanıtları şimdi kontrol et</button></div></div>
    <div class="card"><h3>Ban yememek için</h3><ul class="mut" style="margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.7">
      <li>Gmail'de 2 adımlı doğrulama + <b>uygulama şifresi</b> kullan.</li><li>Kişiye özel, kısa, linksiz ilk mail (AI böyle yazıyor).</li>
      <li>Yanıt gelen kişiye takip otomatik durur (gelen kutusu 5 dk'da bir taranır).</li><li>Engel listesindeki adres/domainlere asla gönderilmez.</li>
      <li>Kendi alan adınla (Workspace) gönderirsen SPF/DKIM/DMARC ayarlı olsun.</li></ul></div></div></div>`;
  main.onclick = e => { const d = e.target.closest('[data-d]'); if (d) d.classList.toggle('on'); };
  $('sReply').onclick = e => busyBtn(e.currentTarget, async () => { await post('/api/sending/check-replies'); toast('Gelen kutusu tarandı'); }, 'Taranıyor');
  $('sSave').onclick = e => busyBtn(e.currentTarget, async () => {
    const days = [...document.querySelectorAll('#sDays .on')].map(x => +x.dataset.d);
    await put('/api/settings', { schedule: { days, start: +$('sStart').value, end: +$('sEnd').value, daily: +$('sDaily').value, min_delay: +$('sMin').value, max_delay: +$('sMax').value }, sending_paused: $('sPause').checked });
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
  main.innerHTML = head('Arama Geçmişi', 'Ekibin yaptığı aramalar. "Tekrar ara" ile aynı aramayı çalıştır.') +
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
      <div class="row" style="margin-top:12px">${adm ? '<button class="btn pri" id="tsave">Kaydet</button>' : ''}<button class="btn" id="ttest">Test mesajı gönder</button></div></div>
  </div><div>
    <div class="card"><div class="card-h"><h3>Gmail gönderim</h3>${s.gmail_user && s.gmail_pass ? '<span class="pill ok">bağlı</span>' : '<span class="pill bad">yok</span>'}</div>
      <p class="hint">Google Hesabı → Güvenlik → 2 Adımlı Doğrulama açık olmalı → <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Uygulama şifreleri</a>'nden 16 haneli şifre oluştur. Yanıt takibi için aynı hesapta IMAP açık olmalı.</p>
      <div class="grid"><label>Gmail adresi<input id="gu" value="${esc(s.gmail_user)}" placeholder="ad@gmail.com veya ad@sirketin.com" ${dis}></label>
      <label>Uygulama şifresi<input id="gp" type="password" placeholder="${s.gmail_pass ? 'kayıtlı – değiştirmek için yaz' : 'xxxx xxxx xxxx xxxx'}" ${dis} autocomplete="new-password"></label>
      <label>Gönderen adı<input id="gf" value="${esc(s.from_name)}" placeholder="Emre Yıldız" ${dis}></label></div>
      <div class="row" style="margin-top:12px">${adm ? '<button class="btn pri" id="gs">Kaydet</button>' : ''}<input id="gto" placeholder="test alıcısı (boş = kendine)" style="flex:1;min-width:160px"><button class="btn" id="gt">✉ Test maili gönder</button></div>
      <p id="gi" style="margin:10px 0 0"></p></div>
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
  $('gt').onclick = e => busyBtn(e.currentTarget, async () => {
    try { const r = await post('/api/test/gmail', { to: $('gto').value }); $('gi').innerHTML = `<span class="pill ok">✓ Gönderildi</span> <span class="mut">${esc(r.to)} adresinin gelen kutusunu kontrol et</span>`; }
    catch (er) { $('gi').innerHTML = `<span class="pill bad">Gönderilemedi</span> <span class="err">${esc(er.message)}</span>`; }
  }, 'Gönderiliyor');
  $('ttest').onclick = e => busyBtn(e.currentTarget, async () => { await post('/api/test/telegram', { token: $('tt').value.trim(), chat: $('tc').value.trim() }); toast('Telegram mesajı gönderildi ✓'); }, 'Gönderiliyor');
  $('tmute').onclick = e => { const c = e.target.closest('[data-ev]'); if (c && adm) c.classList.toggle('on'); };
  if (adm) {
    $('rks').onclick = tryT(async () => { if (!$('rk').value.trim()) return toast('Key gir', true); await put('/api/settings', { rr_key: $('rk').value }); toast('Kaydedildi'); PAGES.settings(); });
    $('oks').onclick = tryT(async () => { await put('/api/settings', { openai_key: $('ok').value, openai_model: $('om').value }); toast('Kaydedildi'); PAGES.settings(); });
    $('gs').onclick = tryT(async () => { await put('/api/settings', { gmail_user: $('gu').value, gmail_pass: $('gp').value, from_name: $('gf').value }); toast('Gmail kaydedildi — şimdi test et'); PAGES.settings(); });
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

boot();
