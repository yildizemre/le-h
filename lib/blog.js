// SEO blog: haftada bir (varsayılan salı 10:00) AI, aranma niyeti yüksek bir anahtar kelime için Türkçe makale taslağı yazar.
// Taslak panelde düzenlenir; HTML / Markdown olarak kopyalanıp hypevisionlab.com'a eklenir. Uydurma istatistik yasak.
const { db, all, get, run, setting, setSetting, jsonSetting } = require('./db');
const { event } = require('./notify');
const ai = require('./ai');
const pub = require('./blogpub');

db.exec(`CREATE TABLE IF NOT EXISTS blog(id INTEGER PRIMARY KEY, keyword TEXT, title TEXT, slug TEXT, meta TEXT, html TEXT, faq TEXT, tags TEXT, status TEXT DEFAULT 'taslak',
  url TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP)`);

const KEYWORDS = [
  'forklift yaya çarpışma önleme sistemi', 'yapay zeka ile KKD tespiti', 'baret ve yelek kontrolü kamera', 'iş güvenliği kamera sistemi yapay zeka',
  'fabrikada yasak alan ihlali tespiti', 'yüksekte çalışma emniyet kemeri tespiti', 'kamera ile yangın ve duman erken tespiti', 'OEE nasıl hesaplanır ve artırılır',
  'üretim hattı duruş analizi', 'görüntü işleme ile kalite kontrol', 'yüzey kusuru tespiti yapay zeka', 'depo dock time ölçümü',
  'iş kazalarını önlemek için teknoloji', 'İSG mevzuatı kamera ile denetim', 'KVKK uyumlu kamera analizi', 'mevcut CCTV kameralarına yapay zeka eklemek',
  'gıda fabrikasında hijyen uyumu kontrolü', 'acil çıkış önlerinin kapatılması tespiti', 'düşme ve bayılma tespiti kamera', 'vardiya bazlı iş güvenliği raporu',
  'endüstri 4.0 görüntü işleme uygulamaları', 'makine görüşü nedir', 'forklift hız ihlali tespiti', 'kişisel koruyucu donanım denetimi nasıl yapılır'];
const DEF = { enabled: true, weekday: 2, time: '10:00' };
const cfg = () => ({ ...DEF, ...jsonSetting('blog_cfg', {}) });
const slugify = s => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80);

function nextKeyword() {
  const used = new Set(all('SELECT keyword FROM blog').map(r => String(r.keyword).toLocaleLowerCase('tr')));
  const extra = String(setting('blog_keywords') || '').split('\n').map(s => s.trim()).filter(Boolean);
  return [...extra, ...KEYWORDS].find(k => !used.has(k.toLocaleLowerCase('tr'))) || null;
}

let busy = false;
async function write(keyword) {
  if (busy) throw Object.assign(new Error('Şu an bir yazı hazırlanıyor'), { status: 409 });
  busy = true;
  try {
    const paths = await pub.sitePaths().catch(() => new Set());
    const manual = String(keyword || '').trim();
    if (manual) keyword = manual;
    else {
      // sıradaki kelime: sitede aynı konuda yazı varsa atla (kendi sayfanla yarışmasın)
      const used = new Set(all('SELECT keyword FROM blog').map(r => String(r.keyword).toLocaleLowerCase('tr')));
      const extra = String(setting('blog_keywords') || '').split('\n').map(s => s.trim()).filter(Boolean);
      keyword = [...extra, ...KEYWORDS].find(k => !used.has(k.toLocaleLowerCase('tr')) && !pub.overlapsExisting(k, paths));
    }
    if (!keyword) throw Object.assign(new Error('Anahtar kelime listesi bitti — yeni kelime ekle'), { status: 400 });
    const siteLinks = [...paths].filter(x => x !== '/' && !/^\/(en|ru)(\/|$)|gizlilik|cerez|hizmet-sartlari/.test(x)).slice(0, 120).join(', ');
    const p = ai.project();
    const others = all("SELECT title, slug FROM blog ORDER BY id DESC LIMIT 12").map(b => `${b.title} (/blog/${b.slug})`).join('; ');
    const r = await ai.ask(`Hype Vision (hypevisionlab.com) için SEO uyumlu, Türkçe blog yazısı yaz.
Şirket: ${p.description || 'mevcut IP kameraları yapay zekayla analiz ederek İSG, verimlilik ve kalite olaylarını anlık tespit eden platform'}
Hedef anahtar kelime: "${keyword}"
Okuyucu: fabrika müdürü, İSG uzmanı, üretim/kalite müdürü. Arama niyetini tam karşıla: önce sorunun ne olduğu ve neden önemli, sonra yöntemler (geleneksel vs görüntü işleme), nasıl çalışır, kurulum adımları, dikkat edilmesi gerekenler (KVKK, kamera açısı, ışık), ölçülebilir faydalar, sonuç.
Kurallar:
- 1100-1600 kelime, sade ve uzman bir dil, pazarlama abartısı yok. Hype Vision'dan doğal şekilde 2-3 kez bahset, sonda kısa çağrı: "ücretsiz kamera uygunluk ön değerlendirmesi" (link: <a href="/kamera-degerlendirme">).
- İstatistik / mevzuat maddesi kullanırsan web'de doğrula ve kaynağını metinde belirt (ör. "SGK 2023 istatistiklerine göre"). Emin olmadığın rakamı YAZMA.
- Anahtar kelime: başlıkta, ilk paragrafta, en az bir H2'de ve doğal yoğunlukta geçsin.
- HTML: sadece <h2>, <h3>, <p>, <ul>, <li>, <strong>, <a> etiketleri. H1 yazma (başlık ayrı). En az 5 adet H2.
- İç linkler: SADECE aşağıdaki listede olan site adreslerine, göreli yolla ver (ör. <a href="/baret-tespit-sistemi">). 3-5 iç link; en az biri konuyla ilgili çözüm sayfasına (baret, KKD, forklift, düşme, kalite kontrol, ONVIF/RTSP vb.). Listede olmayan bir site adresi UYDURMA.
  Site adresleri: ${siteLinks || '/iletisim'}
- Önceki panel yazılarımız: ${others || 'yok'}
- YASAK (yazarsan yazı yayınlanamaz): Hype Vision hakkında rakamlı iddia (doğruluk yüzdesi, milisaniye, proje/müşteri sayısı, "onlarca/yüzlerce proje"), "24 saat içinde dönüş", "garanti", isimli müşteri. Hype Vision'ı yalnızca ne yaptığıyla anlat: mevcut IP kameralar, RTSP/ONVIF, Edge/Cloud, KVKK, panel/alarm, pilot ve keşif görüşmesi.
- faq: 4-5 soru-cevap (Google "Sık sorulan sorular" için), cevaplar 1-3 cümle.
Sadece JSON: {"title":"en fazla 60 karakter","meta":"meta description, 140-158 karakter","slug":"","tags":"virgülle 4-6 etiket","html":"","faq":[{"q":"","a":""}]}`,
      { web: true, size: 'medium', temperature: 0.6, kind: 'blog yazısı' });
    if (!r.html || String(r.html).length < 2000) throw new Error('Yazı eksik geldi, tekrar dene');
    // model çoğu zaman istenenden kısa yazıyor: 950 kelimenin altındaysa (en fazla 2 tur) aynı yapıyı koruyarak genişlet
    const wc = h => String(h).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    for (let k = 0; k < 2 && wc(r.html) < 950; k++) {
      const x = await ai.ask(`Aşağıdaki Türkçe blog yazısını "${keyword}" anahtar kelimesi için GENİŞLET: şu an ${wc(r.html)} kelime, hedef 1200-1500 kelime.
Her H2 bölümünü sahadan senaryolar (RAKAMSIZ: "%90 azaldı", "%35 düştü" gibi uydurma sonuç YAZMA), adım adım açıklamalar ve kontrol listeleriyle derinleştir; 1-2 yeni H2 ekleyebilirsin (ör. "Sık yapılan hatalar", "Pilot süreci nasıl planlanır").
Mevcut iç linkleri (<a href="/...">) aynen koru, yeni site adresi UYDURMA. Kurallar aynı: rakamlı Hype Vision iddiası, "garanti", isimli müşteri YOK; emin olmadığın istatistiği yazma.
Sadece <h2>, <h3>, <p>, <ul>, <li>, <strong>, <a> kullan. Sadece JSON: {"html":""}
YAZI:
${r.html}`, { temperature: 0.5, kind: 'blog yazısı' }).catch(() => ({}));
      if (x.html && wc(x.html) > wc(r.html)) r.html = x.html; else break;
    }
    let slug = slugify(r.slug || r.title || keyword), i = 2; const base = slug;
    while (get('SELECT 1 FROM blog WHERE slug=?', slug)) slug = `${base}-${i++}`;
    const id = Number(run('INSERT INTO blog(keyword,title,slug,meta,html,faq,tags) VALUES(?,?,?,?,?,?,?)', keyword, r.title || keyword, slug, r.meta || '', r.html, JSON.stringify(r.faq || []), r.tags || '').lastInsertRowid);
    try { const au = await pub.audit(get('SELECT * FROM blog WHERE id=?', id)); if (!au.ok || au.warnings.some(w => /yüzde/.test(w))) await fix(id); } catch (e) { console.error('blog autofix', e.message); }
    return id;
  } finally { busy = false; }
}

// "Sorunları düzelt": yayın kontrolünün bulduğu sorunları AI ile gider (uydurma yüzdeler, meta uzunluğu, kırık/eksik iç link, kısalık)
const clampMeta = m => { m = String(m || '').replace(/\s+/g, ' ').trim(); if (m.length <= 158) return m; const c = m.slice(0, 155); return c.slice(0, c.lastIndexOf(' ')).replace(/[,;:\-–]$/, '') + '.'; };
async function fix(id) {
  const b = get('SELECT * FROM blog WHERE id=?', id); if (!b) throw Object.assign(new Error('Yok'), { status: 404 });
  const a = await pub.audit(b), paths = await pub.sitePaths().catch(() => new Set());
  const siteLinks = [...paths].filter(x => x !== '/' && !/^\/(en|ru)(\/|$)|gizlilik|cerez|hizmet-sartlari/.test(x)).slice(0, 120).join(', ');
  let faq = []; try { faq = JSON.parse(b.faq || '[]'); } catch {}
  const r = await ai.ask(`Aşağıdaki Türkçe blog yazısını yayın kontrolünden geçecek şekilde DÜZELT. Anahtar kelime: "${b.keyword}".
Kontrolün bulduğu sorunlar: ${[...a.problems, ...a.warnings].join(' | ') || 'yok'}
Kurallar:
- Kaynağı belirtilmemiş TÜM yüzde ve rakamlı sonuçları kaldır (ör. "%90 azaltılmıştır", "%35 azalmış", "%70 oranında"). "Bir tesiste… %X" gibi uydurma vaka sonuçlarını rakamsız, genel ifadeye çevir ("hatalı ürünler hattan erken ayrılabilir" gibi). Sadece kaynağı açıkça yazan resmî istatistik (ör. SGK) kalabilir.
- Hype Vision hakkında rakamlı iddia, "garanti", isimli müşteri, "24 saat içinde" OLMASIN.
- İç linkler SADECE şu adreslerden, göreli yolla (<a href="/...">): ${siteLinks || '/iletisim'}. Kırık linkleri bunlardan uygun olanla değiştir ya da linki kaldır; toplam 3-5 iç link olsun. Sondaki çağrı linki <a href="/kamera-degerlendirme"> olabilir (listede varsa).
- Uzunluk en az 950 kelime kalsın; yapıyı (H2/H3) koru. Sadece <h2>, <h3>, <p>, <ul>, <li>, <strong>, <a>.
- title en fazla 60 karakter; meta 130-155 karakter, anahtar kelimeyi içersin.
- faq 4-5 soru, cevaplarda rakamlı iddia olmasın.
Sadece JSON: {"title":"","meta":"","html":"","faq":[{"q":"","a":""}]}
MEVCUT BAŞLIK: ${b.title}
MEVCUT META: ${b.meta}
MEVCUT SSS: ${JSON.stringify(faq)}
YAZI:
${b.html}`, { temperature: 0.3, kind: 'blog yazısı' });
  const wc = h => String(h).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const html = r.html && wc(r.html) >= Math.min(800, wc(b.html) * 0.8) ? r.html : b.html;
  run('UPDATE blog SET title=?, meta=?, html=?, faq=? WHERE id=?', String(r.title || b.title).slice(0, 70), clampMeta(r.meta || b.meta), html, JSON.stringify(Array.isArray(r.faq) && r.faq.length ? r.faq : faq), id);
  return pub.audit(get('SELECT * FROM blog WHERE id=?', id));
}

// Siteye eklenecek tam sayfa parçası: makale + FAQ + JSON-LD (Article + FAQPage)
function exportHtml(b) {
  let faq = []; try { faq = JSON.parse(b.faq || '[]'); } catch {}
  const url = `https://hypevisionlab.com/blog/${b.slug}`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'Article', headline: b.title, description: b.meta, inLanguage: 'tr', mainEntityOfPage: url,
    author: { '@type': 'Organization', name: 'Hype Vision' }, publisher: { '@type': 'Organization', name: 'Hype Vision', url: 'https://hypevisionlab.com' }, datePublished: String(b.created).slice(0, 10) }];
  if (faq.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!-- <title>${esc(b.title)} | Hype Vision</title>
<meta name="description" content="${esc(b.meta)}">
<link rel="canonical" href="${url}"> -->
<article>
<h1>${esc(b.title)}</h1>
${b.html}
${faq.length ? `<h2>Sık sorulan sorular</h2>\n${faq.map(f => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join('\n')}` : ''}
</article>
<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld)}</script>`;
}
function exportMd(b) {
  let faq = []; try { faq = JSON.parse(b.faq || '[]'); } catch {}
  const md = String(b.html).replace(/<h2>(.*?)<\/h2>/g, '\n## $1\n').replace(/<h3>(.*?)<\/h3>/g, '\n### $1\n').replace(/<li>(.*?)<\/li>/g, '- $1\n').replace(/<\/?ul>/g, '\n')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**').replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g, '[$2]($1)').replace(/<p>(.*?)<\/p>/gs, '$1\n\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n');
  return `---\ntitle: "${b.title.replace(/"/g, '\\"')}"\ndescription: "${String(b.meta).replace(/"/g, '\\"')}"\nslug: ${b.slug}\ndate: ${String(b.created).slice(0, 10)}\ntags: [${String(b.tags).split(',').map(t => `"${t.trim()}"`).join(', ')}]\n---\n\n# ${b.title}\n${md}${faq.length ? '\n## Sık sorulan sorular\n' + faq.map(f => `\n### ${f.q}\n\n${f.a}\n`).join('') : ''}`;
}

async function tick() {
  const c = cfg(); if (!c.enabled) return;
  const now = new Date(Date.now() + 3 * 3600e3), day = now.toISOString().slice(0, 10), wd = now.getUTCDay();
  const [hh, mm] = String(c.time).split(':').map(Number);
  if (wd !== +c.weekday || now.getUTCHours() * 60 + now.getUTCMinutes() < hh * 60 + mm || setting('blog_day') === day) return;
  setSetting('blog_day', day);
  try { const id = await write(); const b = get('SELECT title, keyword FROM blog WHERE id=?', id); event('info', `📝 Haftalık blog taslağı hazır: "${b.title}" (anahtar kelime: ${b.keyword}) — Lead-AI → Blog sayfasından kontrol edip siteye ekle`); }
  catch (e) { event('error', 'Blog yazısı üretilemedi: ' + e.message.slice(0, 150)); }
}
function start() { setInterval(tick, 5 * 60e3); setTimeout(tick, 60e3); }

module.exports = { fix, start, write, cfg, DEF, nextKeyword, exportHtml, exportMd, KEYWORDS, pub };
