// Blog → hypevisionlab.com yayını (tek tıkla onay).
// Taslak (lib/blog.js) panelde kontrol edilir; "Siteye yayınla" ile sitenin rehber modeline (Guide JSON) çevrilir ve
// GitHub'a src/data/guides/auto/<slug>.json olarak yazılır → Netlify derler → /blog/<slug> yayında.
// Token yalnızca sunucu .env'inde: BLOG_GH_TOKEN (yalnızca hype-vision-web reposuna "contents: write").
const { get, run } = require('./db');
const { event } = require('./notify');

const SITE = 'https://hypevisionlab.com';
const REPO = process.env.BLOG_GH_REPO || 'yildizemre/hype-vision-web';
const BRANCH = process.env.BLOG_GH_BRANCH || 'main';
const DIR = 'src/data/guides/auto';
const token = () => process.env.BLOG_GH_TOKEN || '';

const trSlug = s => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80);
const decode = s => String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// ---------- Canlı site haritası (1 saat önbellek) ----------
let cache = { at: 0, paths: new Set() };
async function sitePaths() {
  if (Date.now() - cache.at < 3600e3 && cache.paths.size) return cache.paths;
  const r = await fetch(`${SITE}/sitemap.xml`, { headers: { 'User-Agent': 'emre-lead blog' } });
  if (!r.ok) throw new Error('Site haritası okunamadı: ' + r.status);
  const xml = await r.text();
  const paths = new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(SITE, '') || '/'));
  cache = { at: Date.now(), paths };
  return paths;
}

/** Anahtar kelime sitedeki bir /blog yazısıyla aynı konuyu mu hedefliyor? (kelime örtüşmesi) */
function overlapsExisting(keyword, paths) {
  const stop = new Set(['ve', 'ile', 'icin', 'nasil', 'nedir', 'yapay', 'zeka', 'sistemi', 'kamera', 'tespiti', 'bir', 'de', 'da']);
  const toks = s => new Set(trSlug(s).split('-').filter(t => t.length > 2 && !stop.has(t)));
  const k = toks(keyword);
  if (!k.size) return null;
  for (const p of paths) {
    if (!p.startsWith('/blog/') && !/^\/[a-z0-9-]+$/.test(p)) continue;
    const t = toks(p.split('/').pop());
    const common = [...k].filter(x => t.has(x)).length;
    if (common >= 2 && common / Math.min(k.size, t.size) >= 0.6) return p;
  }
  return null;
}

// ---------- HTML → Guide blokları ----------
function inline(html) {
  return decode(String(html)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
      const h = href.startsWith(SITE) ? href.slice(SITE.length) || '/' : href;
      return `[${t.replace(/<[^>]+>/g, '').trim()}](${h})`;
    })
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim());
}
function toBlocks(html) {
  const blocks = [], ids = new Set();
  const re = /<(h2|h3|p|ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const tag = m[1].toLowerCase(), body = m[2];
    if (tag === 'h2') {
      let id = trSlug(body.replace(/<[^>]+>/g, '')) || 'bolum', base = id, i = 2;
      while (ids.has(id)) id = `${base}-${i++}`;
      ids.add(id); blocks.push({ type: 'h2', id, text: inline(body) });
    } else if (tag === 'h3') blocks.push({ type: 'h3', text: inline(body) });
    else if (tag === 'p') { const t = inline(body); if (t) blocks.push({ type: 'p', text: t }); }
    else {
      const items = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(x => inline(x[1])).filter(Boolean);
      if (items.length) blocks.push({ type: tag, items });
    }
  }
  return blocks;
}
const linksIn = blocks => blocks.flatMap(b => [b.text, ...(b.items || [])].filter(Boolean)).flatMap(t => [...t.matchAll(/\]\(([^)]+)\)/g)].map(x => x[1]));

// Anahtar kelime → sitedeki çözüm kimliği (GuidePage "İlgili çözümler" kutusu)
const SOLUTION_HINTS = [
  [/baret|kkd|ppe|yelek|eldiven|koruyucu/, 'ppe-detection'], [/forklift|yaya/, 'forklift-pedestrian-detection'],
  [/yasak|tehlikeli bölge|alan ihlal/, 'restricted-area-monitoring'], [/düşme|bayılma/, 'fall-detection'],
  [/yangın|duman/, 'fire-smoke-detection'], [/kalite|kusur|hata tespit/, 'visual-quality-inspection'],
  [/oee|duruş|hat izleme|üretim hattı/, 'production-line-monitoring'], [/sayım|sayma|palet/, 'product-counting'],
  [/verimlilik|boşta|idle|personel/, 'workforce-analytics'], [/kuyruk/, 'queue-analytics'],
];

// ---------- Yayın öncesi kontrol ----------
const FORBIDDEN = [
  [/(onlarca|yüzlerce|binlerce)\s+(saha\s+)?(proje|müşteri|kurulum|tesis)/i, 'Doğrulanmamış ölçek iddiası ("onlarca/yüzlerce proje/müşteri")'],
  [/\b\d{2,4}\s?(–|-)?\s?\d{0,4}\s?ms\b/i, 'Milisaniye düzeyinde gecikme iddiası'],
  [/24 saat içinde/i, '"24 saat içinde dönüş" taahhüdü'],
  [/%\s?(9[7-9]|100)(?:[.,]\d+)?\s*(doğruluk|başarı|isabet)/i, '%97 ve üzeri doğruluk iddiası (katalog sınırı %97)'],
  [/garanti(li|ler|)\b/i, '"Garanti" ifadesi'],
  [/müşterimiz\s+[A-ZÇĞİÖŞÜ]/, 'İsimli müşteri referansı'],
];
async function audit(b) {
  const problems = [], warnings = [];
  const paths = await sitePaths().catch(e => { problems.push(e.message); return new Set(); });
  const blocks = toBlocks(b.html);
  const text = String(b.html).replace(/<[^>]+>/g, ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!b.title || b.title.length > 70) problems.push('Başlık boş ya da 70 karakterden uzun');
  if (!b.meta || b.meta.length < 110 || b.meta.length > 165) problems.push('Meta açıklama 110–165 karakter olmalı (şu an ' + String(b.meta || '').length + ')');
  if (words < 800) problems.push(`Yazı kısa (${words} kelime, en az 800)`);
  if (blocks.filter(x => x.type === 'h2').length < 4) problems.push('En az 4 ara başlık (H2) olmalı');
  if (/<(script|style|iframe|img|form|h1)\b/i.test(b.html)) problems.push('İzin verilmeyen HTML etiketi (script/style/iframe/img/form/h1)');
  const sp = `/blog/${b.slug}`;
  if (b.status !== 'yayında' && paths.has(sp)) problems.push(`${sp} adresi sitede zaten var`);
  const dup = b.status !== 'yayında' && overlapsExisting(b.keyword || b.title, [...paths].filter(p => p !== sp));
  if (dup) warnings.push(`Sitedeki ${dup} ile aynı konuyu hedefliyor olabilir (kendi sayfanla yarışma riski)`);
  for (const href of linksIn(blocks)) {
    if (href.startsWith('/')) { if (!paths.has(href.replace(/\/+$/, '') || '/') && !href.startsWith('/#')) problems.push(`Kırık iç link: ${href}`); }
    else if (!/^https:\/\//.test(href)) problems.push(`Geçersiz link: ${href}`);
  }
  const internal = linksIn(blocks).filter(h => h.startsWith('/')).length;
  if (internal < 2) warnings.push('2’den az iç link var (çözüm sayfalarına bağlantı önerilir)');
  for (const [re, msg] of FORBIDDEN) if (re.test(text)) problems.push(msg);
  const pcts = [...text.matchAll(/%\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?%/g)].length;
  if (pcts) warnings.push(`${pcts} yüzde değeri var — kaynağıyla birlikte doğru olduğundan emin ol`);
  return { ok: problems.length === 0, problems: [...new Set(problems)], warnings, words };
}

function toGuide(b, words) {
  let faq = []; try { faq = JSON.parse(b.faq || '[]'); } catch {}
  const blocks = [...toBlocks(b.html), { type: 'cta' }];
  const kw = String(b.keyword || '').toLocaleLowerCase('tr');
  const solutions = [...new Set(SOLUTION_HINTS.filter(([re]) => re.test(kw + ' ' + String(b.title).toLocaleLowerCase('tr'))).map(([, id]) => id))].slice(0, 3);
  const related = [...new Set(linksIn(blocks).filter(h => h.startsWith('/') && !h.startsWith('/#') && h !== '/iletisim'))].slice(0, 4);
  const metaTitle = `${b.title} | Hype Vision`.length <= 70 ? `${b.title} | Hype Vision` : b.title;
  const tags = String(b.tags || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    slug: b.slug, title: b.title, metaTitle, metaDescription: b.meta, excerpt: b.meta,
    category: 'Rehber', lang: 'tr', solutions,
    isoDate: (/^\d{4}-\d{2}-\d{2}/.test(String(b.created)) ? String(b.created) : new Date().toISOString()).slice(0, 10),
    readMinutes: Math.max(3, Math.round(words / 200)),
    keywords: [...new Set([b.keyword, ...tags].filter(Boolean))],
    blocks, faq: faq.filter(f => f && f.q && f.a).map(f => ({ q: String(f.q), a: String(f.a) })), related,
  };
}

// ---------- GitHub ----------
async function gh(method, path, body) {
  if (!token()) throw Object.assign(new Error('BLOG_GH_TOKEN tanımlı değil (sunucu .env)'), { status: 400 });
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method, headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json', 'User-Agent': 'emre-lead', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (method === 'GET' && r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${j.message || ''}`);
  return j;
}

async function publish(id) {
  const b = get('SELECT * FROM blog WHERE id=?', id);
  if (!b) throw Object.assign(new Error('Yazı yok'), { status: 404 });
  const a = await audit(b);
  if (!a.ok) throw Object.assign(new Error('Yayın engellendi: ' + a.problems.join(' · ')), { status: 422 });
  const guide = toGuide(b, a.words);
  const path = `${DIR}/${b.slug}.json`;
  const cur = await gh('GET', `${path}?ref=${BRANCH}`);
  const content = Buffer.from(JSON.stringify(guide, null, 2) + '\n', 'utf8').toString('base64');
  await gh('PUT', path, { message: `blog: ${cur ? 'güncelle' : 'yayınla'} /blog/${b.slug}`, content, branch: BRANCH, ...(cur ? { sha: cur.sha } : {}) });
  const url = `${SITE}/blog/${b.slug}`;
  run("UPDATE blog SET status='yayında', url=? WHERE id=?", url, id);
  event('info', `📝 Blog yayına gönderildi: "${b.title}" → ${url} (Netlify derlemesi birkaç dakika sürer)`);
  watchLive(url, b.title);
  return { url, warnings: a.warnings };
}

async function unpublish(id) {
  const b = get('SELECT * FROM blog WHERE id=?', id);
  if (!b) throw Object.assign(new Error('Yazı yok'), { status: 404 });
  const path = `${DIR}/${b.slug}.json`;
  const cur = await gh('GET', `${path}?ref=${BRANCH}`);
  if (cur) await gh('DELETE', path, { message: `blog: yayından kaldır /blog/${b.slug}`, sha: cur.sha, branch: BRANCH });
  run("UPDATE blog SET status='taslak', url=NULL WHERE id=?", id);
  event('info', `Blog yayından kaldırıldı: "${b.title}"`);
  return { ok: true };
}

/** Netlify derlemesi bitince haber ver (en fazla ~25 dk dener) */
function watchLive(url, title, n = 0) {
  setTimeout(async () => {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status === 200) return event('info', `✅ Blog canlıda: "${title}" — ${url}`);
    } catch {}
    if (n < 10) watchLive(url, title, n + 1);
    else event('error', `Blog 25 dk içinde canlıya çıkmadı, Netlify derlemesini kontrol et: ${url}`);
  }, 150e3);
}

module.exports = { audit, publish, unpublish, sitePaths, overlapsExisting, toBlocks, toGuide, configured: () => !!token(), REPO };
