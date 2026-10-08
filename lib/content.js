// İçerik Stüdyosu: her sabah AI 1 post + 2 story hazırlar (konu, görsel üstü başlık, açıklama, etiketler),
// gpt-image-1 ile yazısız görsel üretir, sunucuda Hype Vision tasarımı basar (logo + başlık + "temsili görsel" notu).
// Türkçe karakterler görselde bozulmasın diye yazı AI'a değil, Poppins fontuyla vektör olarak bizim tarafta çizilir.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const opentype = require('opentype.js');
const { db, all, get, run, setting, setSetting, jsonSetting, DATA } = require('./db');
const { event, sendPhoto, escH } = require('./notify');
const ai = require('./ai');

db.exec(`CREATE TABLE IF NOT EXISTS content(id INTEGER PRIMARY KEY, day TEXT, kind TEXT, theme TEXT, headline TEXT, sub TEXT, caption TEXT, hashtags TEXT,
  prompt TEXT, style TEXT, temsili INTEGER DEFAULT 1, image TEXT, status TEXT DEFAULT 'hazırlanıyor', error TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP)`);
for (const c of ['ig_id TEXT', 'ig_url TEXT', 'posted_at TEXT']) { try { db.exec('ALTER TABLE content ADD COLUMN ' + c); } catch {} }

const DIR = path.join(DATA, 'content'); fs.mkdirSync(DIR, { recursive: true });
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const BOLD = opentype.parse(fs.readFileSync(path.join(FONT_DIR, 'Poppins-Bold.ttf')).buffer);
const SEMI = opentype.parse(fs.readFileSync(path.join(FONT_DIR, 'Poppins-SemiBold.ttf')).buffer);
const LOGO = path.join(__dirname, '..', 'public', 'img', 'logo-light.png');
const SIZE = { post: { w: 1080, h: 1350, gen: '1024x1536' }, story: { w: 1080, h: 1920, gen: '1024x1536' } };
const COST = { low: 0.016, medium: 0.063, high: 0.25 }; // gpt-image-1, 1024x1536, yaklaşık USD
const DEF = { enabled: true, time: '08:30', posts: 1, stories: 2, quality: 'medium', telegram: true, ig_auto: false, ig_post_time: '12:30', ig_story_times: ['10:00', '16:30'] };
const cfg = () => ({ ...DEF, ...jsonSetting('content_cfg', {}) });

const THEMES = ['KKD (baret, yelek, eldiven) uyumu', 'forklift–yaya yakınlaşması', 'yasak / tehlikeli alan ihlali', 'yüksekte çalışma güvenliği', 'düşme ve bayılma tespiti',
  'yangın, duman ve gaz erken uyarı', 'acil çıkış önlerinin kapatılması', 'hat duruşu ve OEE', 'istasyon boşta kalma süresi', 'yüzey kusuru ve kalite kontrol',
  'depo dock time ve palet sayımı', 'KVKK uyumlu, yüz tanımasız analiz', 'mevcut kameralarla yapay zeka', 'İSG mevzuatı hatırlatması', 'iş kazası istatistiği ve önleme',
  'vardiya bazlı güvenlik raporu', 'pilot süreci: 30 günde ölçülebilir sonuç', 'gıda tesislerinde hijyen uyumu', 'sahadan bir gün: kurulum ve kalibrasyon'];

async function plan(n, kinds, topic) {
  const recent = all("SELECT theme FROM content WHERE created>=datetime('now','-14 day')").map(r => r.theme);
  const p = ai.project();
  const r = await ai.ask(`Hype Vision (${p.description || 'mevcut IP kameraları yapay zekayla analiz eden İSG / verimlilik / kalite platformu'}) için Instagram içerikleri planla.
Hedef kitle: Türkiye'de fabrika/tesis yöneticileri, İSG uzmanları, üretim ve kalite müdürleri.
${n} içerik: türleri sırasıyla ${kinds.join(', ')}. ${topic ? 'Konu: ' + topic : 'Konu havuzu (son 14 günde işlenenleri TEKRARLAMA: ' + recent.join('; ') + '): ' + THEMES.join('; ')}
Her içerik için:
- headline: görselin üstüne basılacak Türkçe başlık, EN FAZLA 42 karakter, çarpıcı ve net (ör. "Baret yoksa alarm var", "Forklift yaklaşınca 0,5 sn'de uyarı")
- sub: başlığın altında küçük Türkçe satır, en fazla 70 karakter (story için kısa çağrı da olabilir)
- caption: Instagram açıklaması, Türkçe, 350-700 karakter: somut fayda + kısa bilgi/istatistik (uydurma rakam yok; emin değilsen genel ifade) + çağrı ("Mevcut kameralarınızla neler mümkün? DM'den yazın / profildeki linkten ücretsiz ön değerlendirme")
- hashtags: 8-12 Türkçe+İngilizce etiket (#isg #işgüvenliği #yapayzeka #görüntüişleme #kkd #fabrika #industry40 …)
- style: "cctv" (güvenlik kamerası bakış açısı + algılama kutuları), "photo" (fotogerçekçi fabrika sahnesi) veya "dashboard" (modern analitik ekran / arayüz)
- prompt: İNGİLİZCE görsel üretim promptu. Dikey kompozisyon, alt %40'ı sade/karanlık bırak (yazı basılacak). Kesinlikle hiçbir yazı, harf, rakam, logo, marka, filigran OLMASIN.
  cctv stilinde: "high-angle security camera view of ..., subtle cyan computer-vision bounding boxes around workers/helmets, realistic lighting". Kişilerin yüzleri tanınmayacak şekilde uzak / arkadan.
  Renk dili: lacivert (#0b2448) ve turkuaz (#22d3ee) vurgular.
- temsili: AI ile üretilmiş, gerçek kayıt gibi algılanabilecek görsellerde true.
Sadece JSON: {"items":[{"kind":"post|story","theme":"","headline":"","sub":"","caption":"","hashtags":"","style":"","prompt":"","temsili":true}]}`, { kind: 'içerik planı', temperature: 0.8 });
  return (r.items || []).slice(0, n).map((x, i) => ({ ...x, kind: kinds[i] || x.kind || 'post' }));
}

async function genImage(prompt, quality) {
  const key = setting('openai_key'); if (!key) throw new Error('OpenAI API key yok');
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(240000),
    body: JSON.stringify({ model: setting('image_model') || 'gpt-image-1', prompt: prompt + '\nNo text, no letters, no numbers, no logos, no watermark.', size: '1024x1536', quality, n: 1 }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.data?.[0]?.b64_json) throw new Error('Görsel üretilemedi: ' + (j.error?.message || r.status));
  // maliyet kaydı (OpenAI kullanım kartında "görsel" olarak görünür)
  const day = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), k = 'ai_usage_' + day;
  const u = jsonSetting(k, { in: 0, out: 0, web: 0, calls: 0, usd: 0, by: {} }); const c = COST[quality] || COST.medium;
  u.calls++; u.usd = +(u.usd + c).toFixed(4); u.by['görsel'] = +((u.by['görsel'] || 0) + c).toFixed(4); setSetting(k, JSON.stringify(u));
  return Buffer.from(j.data[0].b64_json, 'base64');
}

// metni genişliğe göre satırlara böl
function wrap(font, text, size, maxW, maxLines) {
  const words = String(text || '').trim().split(/\s+/), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (font.getAdvanceWidth(t, size) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}
// opentype.js 2.x bazı glif/konumlarda NaN koordinat üretiyor (librsvg o glifi atlıyor): glif glif çiz, NaN olursa başka orijinde üretip kaydır
function pathOf(font, text, x, y, size) {
  let out = '';
  font.forEachGlyph(text, x, y, size, {}, (g, gx, gy) => {
    const d = g.getPath(gx, gy, size).toPathData(2);
    if (!d.includes('NaN')) { out += `<path d="${d}" FILL/>`; return; }
    for (let i = 1; i < 8; i++) {
      const ox = i * 7.3, dd = g.getPath(ox, 100, size).toPathData(2);
      if (!dd.includes('NaN')) { out += `<path transform="translate(${(gx - ox).toFixed(2)} ${(gy - 100).toFixed(2)})" d="${dd}" FILL/>`; return; }
    }
  });
  return out;
}
const draw = (font, text, x, y, size, attrs) => pathOf(font, text, x, y, size).replaceAll('FILL', attrs);

async function compose(raw, it) {
  const S = SIZE[it.kind] || SIZE.post, W = S.w, H = S.h, pad = 72;
  const base = await sharp(raw).resize(W, H, { fit: 'cover', position: 'centre' }).toBuffer();
  const hs = it.kind === 'story' ? 84 : 76, ss = it.kind === 'story' ? 40 : 36;
  let hl = wrap(BOLD, it.headline, hs, W - pad * 2, 3), size = hs;
  if (hl.length === 3) { size = hs - 12; hl = wrap(BOLD, it.headline, size, W - pad * 2, 3); }
  const sl = wrap(SEMI, it.sub, ss, W - pad * 2, 2);
  const lh = size * 1.18, sh = ss * 1.35, block = hl.length * lh + (sl.length ? 26 + sl.length * sh : 0);
  const bottom = H - (it.kind === 'story' ? 260 : 150), top = bottom - block;
  let y = top + size, paths = '';
  for (const l of hl) { paths += draw(BOLD, l, pad, y, size, 'fill="#ffffff"'); y += lh; }
  y += 26 - lh + size * 0.2 + ss;
  for (const l of sl) { paths += draw(SEMI, l, pad, y, ss, 'fill="#67e8f9"'); y += sh; }
  const foot = draw(SEMI, 'hypevisionlab.com', pad, H - (it.kind === 'story' ? 150 : 64), 30, 'fill="#cfe8f2"');
  const tem = it.temsili ? `<rect x="${W - 260}" y="${H - (it.kind === 'story' ? 186 : 100)}" width="196" height="46" rx="23" fill="#000" fill-opacity=".45"/>
    ${draw(SEMI, 'temsili görsel', W - 240, H - (it.kind === 'story' ? 154 : 68), 22, 'fill="#ffffff" fill-opacity=".85"')}` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#06101f" stop-opacity="0"/><stop offset=".55" stop-color="#06101f" stop-opacity=".78"/><stop offset="1" stop-color="#06101f" stop-opacity=".95"/></linearGradient>
    <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#06101f" stop-opacity=".55"/><stop offset="1" stop-color="#06101f" stop-opacity="0"/></linearGradient></defs>
    <rect y="${top - 220}" width="${W}" height="${H - top + 220}" fill="url(#g)"/><rect width="${W}" height="200" fill="url(#t)"/>
    <rect x="${pad}" y="${top - 34}" width="64" height="8" rx="4" fill="#22d3ee"/>${paths}${foot}${tem}</svg>`;
  const logo = await sharp(LOGO).resize({ width: 300 }).toBuffer();
  return sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }, { input: logo, top: it.kind === 'story' ? 120 : 64, left: pad }]).jpeg({ quality: 90 }).toBuffer();
}

async function makeOne(it) {
  const c = cfg(), day = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const id = Number(run('INSERT INTO content(day,kind,theme,headline,sub,caption,hashtags,prompt,style,temsili) VALUES(?,?,?,?,?,?,?,?,?,?)',
    day, it.kind, it.theme || '', it.headline || '', it.sub || '', it.caption || '', it.hashtags || '', it.prompt || '', it.style || '', it.temsili === false ? 0 : 1).lastInsertRowid);
  try {
    const raw = await genImage(it.prompt, c.quality);
    const out = await compose(raw, it), file = `${id}.jpg`;
    fs.writeFileSync(path.join(DIR, file), out);
    fs.writeFileSync(path.join(DIR, `${id}.raw.png`), raw); // metin değişirse yeniden basmak için
    run("UPDATE content SET image=?, status='hazır' WHERE id=?", file, id);
    if (c.telegram && setting('tg_token') && setting('tg_chat'))
      await sendPhoto(out, `📸 <b>${it.kind === 'story' ? 'Story' : 'Post'} hazır</b> · ${it.headline}\n\n${String(it.caption || '').slice(0, 700)}\n\n${it.hashtags || ''}`.slice(0, 1020)).catch(e => console.error('tg photo', e.message));
  } catch (e) { run("UPDATE content SET status='hata', error=? WHERE id=?", e.message.slice(0, 300), id); }
  return id;
}

let busy = false;
async function generate({ posts = 1, stories = 2, topic = '', kind } = {}) {
  if (busy) throw Object.assign(new Error('Şu an içerik üretiliyor, birkaç dakika bekle'), { status: 409 });
  busy = true;
  try {
    const kinds = kind ? [kind] : [...Array(posts).fill('post'), ...Array(stories).fill('story')];
    const items = await plan(kinds.length, kinds, topic);
    const ids = [];
    for (const it of items) ids.push(await makeOne(it));
    return ids;
  } finally { busy = false; }
}
// Metin değişince aynı görsele yeniden bas (yeni görsel üretmeden, ücretsiz)
async function rerender(id) {
  const it = get('SELECT * FROM content WHERE id=?', id); const rawF = path.join(DIR, `${id}.raw.png`);
  if (!it || !fs.existsSync(rawF)) throw Object.assign(new Error('Orijinal görsel yok'), { status: 404 });
  fs.writeFileSync(path.join(DIR, `${id}.jpg`), await compose(fs.readFileSync(rawF), { ...it, temsili: !!it.temsili }));
}
async function regenImage(id) {
  const it = get('SELECT * FROM content WHERE id=?', id); if (!it) throw Object.assign(new Error('Yok'), { status: 404 });
  const raw = await genImage(it.prompt, cfg().quality);
  fs.writeFileSync(path.join(DIR, `${id}.raw.png`), raw);
  fs.writeFileSync(path.join(DIR, `${id}.jpg`), await compose(raw, { ...it, temsili: !!it.temsili }));
  run("UPDATE content SET image=?, status='hazır', error=NULL WHERE id=?", `${id}.jpg`, id);
}
const file = id => path.join(DIR, `${id}.jpg`);

// ---- Instagram Graph API (resmi yol) ----
// Instagram API with Instagram Login (token "IG..." ile başlar → graph.instagram.com) ya da Facebook Login (graph.facebook.com) desteklenir.
// Meta görseli herkese açık bir URL'den çeker: imzalı, tahmin edilemez /ci/<id>-<imza>.jpg adresi verilir.
const crypto = require('crypto');
const pubSig = id => crypto.createHmac('sha256', setting('booking_secret') || (require('./booking').link(1), setting('booking_secret'))).update('ci' + id).digest('base64url').slice(0, 12);
const publicUrl = id => `${(setting('public_url') || 'https://lead.hypevisionlab.com').replace(/\/$/, '')}/ci/${id}-${pubSig(id)}.jpg`;
const pubOk = (id, sg) => sg === pubSig(id);
const igHost = tok => /^IG/.test(tok) ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0';
async function ig(pathq, params = {}, method = 'GET') {
  const tok = setting('ig_token'), uid = setting('ig_user_id'); if (!tok || !uid) throw Object.assign(new Error('Instagram bağlı değil: Ayarlar → Instagram'), { status: 400 });
  const u = new URL(igHost(tok) + pathq.replace('{ig}', uid)); const body = new URLSearchParams({ ...params, access_token: tok });
  const r = await fetch(method === 'GET' ? u + '?' + body : u, method === 'GET' ? { signal: AbortSignal.timeout(30000) } : { method, body, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw Object.assign(new Error('Instagram: ' + (j.error?.error_user_msg || j.error?.message || r.status)), { status: 502 });
  return j;
}
const igMe = () => ig('/{ig}', { fields: 'username,followers_count,media_count' });
async function igPublish(id) {
  const it = get('SELECT * FROM content WHERE id=?', id); if (!it?.image) throw Object.assign(new Error('Görsel yok'), { status: 404 });
  if (it.ig_id) throw Object.assign(new Error('Bu içerik zaten Instagram\'da'), { status: 409 });
  const cap = `${it.caption || ''}\n\n${it.hashtags || ''}`.trim().slice(0, 2150);
  const c = await ig('/{ig}/media', it.kind === 'story' ? { image_url: publicUrl(id), media_type: 'STORIES' } : { image_url: publicUrl(id), caption: cap }, 'POST');
  for (let i = 0; i < 20; i++) { // konteyner hazır olana kadar bekle
    const st = await ig('/' + c.id, { fields: 'status_code' }); if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error('Instagram görseli işleyemedi (' + st.status_code + ')');
    await new Promise(r => setTimeout(r, 3000));
  }
  const p = await ig('/{ig}/media_publish', { creation_id: c.id }, 'POST');
  let url = ''; try { url = (await ig('/' + p.id, { fields: 'permalink' })).permalink || ''; } catch {}
  run("UPDATE content SET ig_id=?, ig_url=?, status='paylaşıldı', posted_at=? WHERE id=?", p.id, url, new Date().toISOString(), id);
  return { id: p.id, url };
}
// Otomatik paylaşım: bugünün hazır içerikleri ayarlanan saatlerde (post 12:30, story'ler 10:00 / 16:30)
let igBusy = false;
async function igTick() {
  const c = cfg(); if (!c.ig_auto || igBusy || !setting('ig_token')) return;
  const now = new Date(Date.now() + 3 * 3600e3), day = now.toISOString().slice(0, 10), mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const at = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const items = all("SELECT * FROM content WHERE day=? AND status='hazır' AND ig_id IS NULL ORDER BY id", day);
  const due = [...items.filter(x => x.kind === 'post').slice(0, 1).filter(() => mins >= at(c.ig_post_time)),
    ...items.filter(x => x.kind === 'story').filter((x, i) => mins >= at((c.ig_story_times || [])[i] || '23:59'))];
  if (!due.length) return;
  igBusy = true;
  try { for (const x of due) { try { const r = await igPublish(x.id); event('info', `📸 Instagram'da paylaşıldı (${x.kind}): ${x.headline}${r.url ? '\n' + r.url : ''}`); } catch (e) { run("UPDATE content SET status='hata', error=? WHERE id=?", e.message.slice(0, 300), x.id); event('error', 'Instagram paylaşımı başarısız: ' + e.message.slice(0, 150)); } } }
  finally { igBusy = false; }
}
// "IG..." uzun ömürlü token 60 gün geçerli: haftada bir yenile
async function igRefresh() {
  const tok = setting('ig_token'); if (!/^IG/.test(tok || '')) return;
  const last = +setting('ig_refreshed') || 0; if (Date.now() - last < 7 * 864e5) return;
  try {
    const j = await (await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tok)}`)).json();
    if (j.access_token) { setSetting('ig_token', j.access_token); setSetting('ig_refreshed', String(Date.now())); }
    else if (j.error) event('error', 'Instagram token yenilenemedi: ' + (j.error.message || '').slice(0, 120));
  } catch {}
}

async function tick() {
  const c = cfg(); if (!c.enabled) return;
  const now = new Date(Date.now() + 3 * 3600e3), day = now.toISOString().slice(0, 10), mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [hh, mm] = String(c.time || '08:30').split(':').map(Number);
  if (mins < hh * 60 + mm || setting('content_day') === day) return;
  setSetting('content_day', day);
  try { const ids = await generate({ posts: c.posts, stories: c.stories }); event('info', `📸 İçerik Stüdyosu: bugünün ${ids.length} içeriği hazır (${c.posts} post, ${c.stories} story) — paylaşmak için İçerik Stüdyosu sayfası`); }
  catch (e) { event('error', 'İçerik üretilemedi: ' + e.message.slice(0, 150)); }
}
function start() { setInterval(tick, 60e3); setTimeout(tick, 30e3); setInterval(igTick, 60e3); setInterval(igRefresh, 6 * 3600e3); setTimeout(igRefresh, 60e3); }

module.exports = { igPublish, igMe, pubOk, publicUrl, start, generate, rerender, regenImage, file, cfg, DEF, compose, plan };
