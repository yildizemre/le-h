// OpenAI: şirket profili, kampanya önerisi, firma bulma (web araması), mail taslağı
const { setting, setSetting, jsonSetting, get } = require('./db');

const model = () => setting('openai_model') || 'gpt-4.1-mini';

function parseJson(t) {
  t = String(t || '').trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch {}
  // web aramalı yanıtlarda JSON'un etrafında kaynak notları ("[1]", markdown link) olabiliyor: { … } ve [ … ] adaylarını ayrı dene
  const tries = [];
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  const c = t.indexOf('[{'), d = t.lastIndexOf('}]'); if (c >= 0 && d > c) tries.push(t.slice(c, d + 2));
  for (const s of tries) {
    try { return JSON.parse(s); } catch {}
    try { return JSON.parse(s.replace(/\]\(https?:[^)]*\)/g, ']').replace(/,\s*([}\]])/g, '$1')); } catch {}
  }
  throw new Error('AI geçersiz JSON döndürdü');
}

// Kullanım takibi: günlük token + web araması sayısı ve tahmini maliyet (USD)
const PRICE = { 'gpt-4.1-mini': [0.4, 1.6], 'gpt-4.1-nano': [0.1, 0.4], 'gpt-4.1': [2, 8], 'gpt-4o-mini': [0.15, 0.6], 'gpt-4o': [2.5, 10], 'gpt-5-mini': [0.25, 2], 'gpt-5': [1.25, 10] };
const WEB_COST = { low: 0.025, medium: 0.0275, high: 0.03 }; // arama başı yaklaşık
function track(m, usage, webCalls, size, kind) {
  const day = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), key = 'ai_usage_' + day;
  const u = jsonSetting(key, { in: 0, out: 0, web: 0, calls: 0, usd: 0, by: {} });
  const [pi, po] = PRICE[m] || PRICE['gpt-4.1-mini'];
  const usd = (usage?.input_tokens || 0) / 1e6 * pi + (usage?.output_tokens || 0) / 1e6 * po + webCalls * (WEB_COST[size] || 0.0275);
  u.in += usage?.input_tokens || 0; u.out += usage?.output_tokens || 0; u.web += webCalls; u.calls++; u.usd = +(u.usd + usd).toFixed(4);
  u.by[kind] = +((u.by[kind] || 0) + usd).toFixed(4);
  setSetting(key, JSON.stringify(u));
}
function usage(days = 30) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() + 3 * 3600e3 - i * 864e5).toISOString().slice(0, 10);
    if (setting('ai_usage_' + d)) out.push({ day: d, ...jsonSetting('ai_usage_' + d, {}) });
    else if (i === 0) out.push({ day: d, in: 0, out: 0, web: 0, calls: 0, usd: 0, by: {} });
  }
  return out;
}

async function ask(input, { web = false, json = true, temperature, size = 'medium', small = false, kind = 'diğer' } = {}) {
  const key = setting('openai_key');
  if (!key) throw Object.assign(new Error('Ayarlar → OpenAI API key girilmemiş'), { status: 400 });
  const m = small ? (setting('openai_model_small') || 'gpt-4.1-nano') : model();
  const body = { model: m, input };
  if (web) body.tools = [{ type: 'web_search_preview', user_location: { type: 'approximate', country: 'TR' }, search_context_size: size }];
  const meta = arguments[1]?.meta; // doğrulama için: AI'ın gerçekten açtığı/alıntıladığı URL'ler
  if (temperature !== undefined && !web) body.temperature = temperature;
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('OpenAI: ' + (j.error?.message || r.status)), { status: 502 });
  const text = j.output_text ?? (j.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n');
  try { track(m, j.usage, (j.output || []).filter(o => o.type === 'web_search_call').length, size, kind); } catch {}
  if (meta) {
    meta.webCalls = (j.output || []).filter(o => o.type === 'web_search_call').length;
    meta.urls = [...new Set([
      ...(j.output || []).flatMap(o => o.content || []).flatMap(c => c.annotations || []).filter(a => a.url).map(a => a.url),
      ...(j.output || []).filter(o => o.type === 'web_search_call').flatMap(o => o.action?.sources || []).map(s => s.url).filter(Boolean),
    ].map(u => String(u).replace(/[?&]utm_source=openai.*$/, '')))];
    meta.text = text;
  }
  if (!json) return text;
  try { return parseJson(text); }
  catch (e) { // bir kez, web araması olmadan "sadece JSON" diye tekrar iste (ilk cevabı bağlam olarak ver)
    if (arguments[1]?._retry) throw e;
    return ask(`Aşağıdaki metindeki bilgiyi istenen JSON biçimine çevir. SADECE geçerli JSON yaz, başka hiçbir şey yazma.\nİSTENEN:\n${String(input).slice(-700)}\nMETİN:\n${String(text).slice(0, 6000)}`,
      { json: true, kind, small: true, _retry: true });
  }
}

const project = () => jsonSetting('project', {});
const projText = p => [
  `Şirket: ${p.company || ''} (${p.website || ''})`, p.description && `Açıklama: ${p.description}`, p.offer && `Teklif: ${p.offer}`,
  p.capabilities && `Yetenekler/entegrasyonlar: ${p.capabilities}`, p.pricing && `Fiyatlandırma: ${p.pricing}`, p.proof && `Referans/kanıt: ${p.proof}`,
  p.competitors && `Rakipler: ${p.competitors}`, p.docs && `Ek bilgiler: ${p.docs}`,
].filter(Boolean).join('\n');
const list = v => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); } };

async function profileFromWebsite(url) {
  return ask(`${url} web sitesini ve şirket hakkındaki kamuya açık bilgileri incele. Türkçe olarak şu JSON'u doldur (bilmediğini boş bırak, uydurma):
{"company":"","website":"","founded":"","employees":"","location":"","industry":"","description":"2-3 cümle","offer":"ne satıyorlar, 1 cümle","capabilities":"virgüllü liste","competitors":"virgüllü alan adları","proof":"bilinen müşteri/referanslar"}
Sadece JSON döndür.`, { web: true, kind: 'profil' });
}

async function suggestCampaign(brief) {
  const p = project();
  return ask(`Aşağıdaki şirket için B2B soğuk mail kampanyası hedeflemesi hazırla.
${projText(p)}
Kullanıcının hedef tarifi: "${brief}"
Türkçe JSON döndür:
{"name":"kısa kampanya adı","offer":"bu hedefe ne sunuyoruz (1 cümle)","problem":"müşterinin sorunu (1 cümle)","clients":["örnek müşteri tipi veya firma"],
"positive":["iyi müşteri kriteri"],"negative":["elenecek kriter"],"keywords":["anahtar kelime"],"roles":"kime ulaşmalıyız (1 cümle)",
"titles":["RocketReach'te aranacak unvanlar, hem Türkçe hem İngilizce, 8-14 adet, ör. İSG Müdürü, Fabrika Müdürü, Plant Manager, HSE Manager"],"size":"şirket büyüklüğü önerisi"}`);
}

async function findCompanies(c, count = 20, exclude = []) {
  const p = project();
  const res = await ask(`Sen B2B pazar araştırmacısısın. Web araması yaparak aşağıdaki kampanyaya uyan GERÇEK, aktif firmaları bul.
Satıcı: ${p.company || ''} ${p.website || ''} — ${p.description || ''}
Kampanya: ${c.name}
Sektör: ${c.sector || 'belirtilmedi — konumdaki fabrikalar, üretim tesisleri ve sanayi işletmeleri'}
Konum: ${c.location || c.geography || 'Türkiye'}
Hedef tarif: ${c.brief}
Teklif: ${c.offer}
Olumlu kriterler: ${list(c.positive).join('; ')}
Olumsuz kriterler: ${list(c.negative).join('; ')}
Anahtar kelimeler: ${list(c.keywords).join(', ')}
Coğrafya: ${c.location || c.geography || 'Türkiye'} (firmanın tesisi/fabrikası bu bölgede olmalı)  Büyüklük: ${c.size || 'belirtilmedi'}
Şu alan adlarını TEKRAR VERME: ${exclude.slice(0, 300).join(', ') || '-'}
${count} firma bul. Her firmanın kendi web sitesi alan adı doğru olmalı (www/https olmadan). Rakip firmaları ve satıcının kendisini ekleme. ${c.kind === "partner" ? "Bunlar ÇÖZÜM ORTAĞI adayları: hizmet/entegrasyon firmaları (OSGB, İSG danışmanlık, CCTV/güvenlik entegratörü, endüstriyel otomasyon, MES/ERP/İSG yazılımı). Üretici, dernek, kamu kurumu ve haber sitesi ekleme; mümkünse firmanın kaç müşteriye/işyerine hizmet verdiğini reason alanına yaz." : "SADECE kendi fabrikasında/tesisinde fiziksel ÜRETİM yapan imalatçı firmalar. Şunları KESİNLİKLE ekleme: görüntü işleme / yapay zeka / makine görüşü firmaları, kamera-CCTV-güvenlik sistemi firmaları ve entegratörleri, yazılım / bilişim / otomasyon entegratörü firmaları, danışmanlık, OSGB / İSG hizmet firmaları, bayi / distribütör / ithalatçı, OSB yönetimleri, dernekler, odalar, kamu kurumları ve haber siteleri (bunlar ya rakibimiz ya da müşteri değil)."}
Sadece JSON: {"companies":[{"name":"","domain":"","city":"","sector":"","size":"tahmini çalışan","reason":"neden uygun, 1 cümle","score":1-10,"phone":"sitedeki santral telefonu (+90...) yoksa boş","email":"sitedeki genel mail yoksa boş"}]}`, { web: true, kind: 'firma bulma' });
  return (res.companies || res || []).filter(x => x && x.name);
}

async function draftEmail(c, contact, step = 0, prev = null) {
  const p = project(), lang = p.language || 'Türkçe';
  const fu = list(c.followups)[step - 1] || {};
  const task = step === 0
    ? `İlk soğuk maili yaz.`
    : `Bu, ${step}. takip maili. Önceki mail konusu: "${prev?.subject || ''}". Önceki mail: """${(prev?.body || '').slice(0, 1500)}""". Kısa, yeni bir açıdan değer kat, önceki maili tekrar etme. ${fu.instructions || ''}`;
  return ask(`Sen deneyimli bir B2B satış yazarısın. ${lang} yaz.
Gönderen şirket:
${projText(p)}
Gönderen kişi: ${p.sender_name || ''}
Kampanya teklifi: ${c.offer || ''}
Müşteri sorunu: ${c.problem || ''}
Örnek müşteriler: ${list(c.clients).join(', ')}
Genel talimatlar: ${p.instructions || ''}
Kampanya talimatları: ${c.instructions || ''}
Alıcı: ${contact.name} — ${contact.title || ''} @ ${contact.company || ''} (${contact.location || ''}, sektör: ${contact.industry || ''})
${task}
Kurallar: 70-130 kelime, kişiye özel ilk cümle, tek net soru ile bitir (toplantı değil cevap iste), abartılı satış dili ve emoji yok, link koyma, imza yazma (otomatik eklenecek), "Sayın" yerine isimle hitap et (ör. "Merhaba ${String(contact.name || '').split(' ')[0]} Bey/Hanım" — cinsiyet bilinmiyorsa sadece "Merhaba ${String(contact.name || '').split(' ')[0]}").
Konu kuralları: 2-5 kelime, bir meslektaşa yazılmış sıradan iş maili gibi (ör. "Gebze hattı hakkında", "kısa bir soru", "KKD denetimi"); "X için …" kalıbı, şirket adı + ürün adı, büyük harfle başlayan her kelime, ünlem, "AI/yapay zeka çözümü" gibi pazarlama ifadesi KULLANMA.
Sadece JSON: {"subject":"kısa konu, 2-5 kelime","body":"düz metin, paragraflar \\n ile"}`, { temperature: 0.7, kind: 'mail yazımı' });
}

// 1) Kişiye özel ilk cümle: firmanın sitesine/haberlerine bakar, tek somut cümle yazar
async function opener(c, lang = 'Türkçe') {
  const p = project();
  if (c.domain) {
    const hit = get("SELECT opener FROM contacts WHERE domain=? AND opener<>'' AND opener<>'-' AND updated>=datetime('now','-30 day') LIMIT 1", c.domain);
    if (hit?.opener) return { opener: hit.opener, fact: 'aynı firma için önceden bulundu', source: '', cached: true };
  }
  const site = c.domain ? `Web sitesi: ${c.domain}` : '';
  const r = await ask(`${c.company} firmasını (${site} ${c.location || ''}) web'de kısaca araştır: yeni yatırım, tesis, hat, ürün, sertifika, büyüme, ihracat, işe alım gibi GÜNCEL ve SOMUT bir bilgi bul.
Sonra ${c.name} (${c.title || 'yönetici'}) kişisine yazılacak soğuk mailin İLK CÜMLESİNİ yaz (${lang}).
Kurallar: tek cümle, en fazla 28 kelime; bulduğun somut bilgiye atıf yapsın ("…gördüm/okudum" gibi doğal); iltifat klişesi yok ("harika işler" vb. yok);
selamlama yok (selam ayrıca yazılıyor); bizim ürünümüzden (${p.company || 'Hype Vision'}) bahsetme; bilgiden emin değilsen uydurma, opener alanını boş bırak.
Sadece JSON: {"opener":"","fact":"dayandığın bilgi","source":"url"}`, { web: true, size: 'low', kind: 'kişisel cümle' });
  return { opener: String(r.opener || '').trim(), fact: r.fact || '', source: r.source || '' };
}

// 2) Gelen yanıtı sınıflandır + cevap taslağı
const LABELS = ['ilgileniyor', 'soru', 'sonra yaz', 'ilgisiz', 'yanlış kişi', 'otomatik cevap'];
async function classifyReply({ text, subject, contact, sent }) {
  const p = project();
  const today = new Date().toISOString().slice(0, 10);
  const r = await ask(`Bir B2B soğuk mailine gelen yanıtı analiz et. Bugün: ${today}.
Bizim şirket: ${projText(p)}
Gönderdiğimiz mail konusu: "${sent?.subject || ''}"
Yanıtlayan: ${contact?.name || ''} — ${contact?.title || ''} @ ${contact?.company || ''}
Yanıt konusu: "${subject || ''}"
Yanıt metni (alıntılar kırpılmış): """${String(text || '').slice(0, 3500)}"""
Etiketlerden BİRİNİ seç: ${LABELS.join(' | ')}
- "otomatik cevap": izin/tatil/yıllık izin/ofis dışı/out-of-office/seyahat yanıtı. İçinde başka bir kişinin adresi geçse BİLE bu etiketi seç (o kişi sadece acil durum için verilmiştir; referral boş kalsın). Dönüş tarihi varsa return_date (YYYY-MM-DD).
- "sonra yaz": şu an değil, ileride ilgilenebilir. Uygun tarih varsa return_date, yoksa 30 gün sonrası.
- "yanlış kişi": başka birini önerdi ya da yetkili değil. Önerdiği kişi varsa referral doldur.
- "ilgisiz": istemiyor / listeden çıkar dedi.
- "soru": bilgi/fiyat/teknik soru sordu. "ilgileniyor": görüşme/demo/teklif istiyor ya da olumlu.
Cevap taslağı (draft): ilgileniyor/soru/yanlış kişi/sonra yaz için yanıtın dilinde, kısa, profesyonel; sorulara şirket bilgilerine dayanarak cevap ver, bilmediğin rakamı uydurma ("görüşmede netleştirelim" de);
ilgileniyor ise 2 somut görüşme zamanı öner (önümüzdeki iş günleri, 10:00 ya da 14:00); imza yazma. ilgisiz ve otomatik cevap için draft boş.
Sadece JSON: {"label":"","summary":"tek cümle Türkçe özet","return_date":"","referral":{"name":"","email":"","title":""},"draft":""}`, { temperature: 0.3, kind: 'yanıt analizi' });
  if (!LABELS.includes(r.label)) r.label = 'soru';
  return r;
}

// 3) Firmanın web sitesinde yayınlanan santral telefonu + genel mail (kişisel veri değil)
async function companyContact(co) {
  const r = await ask(`${co.name} (${co.domain}${co.city ? ', ' + co.city : ''}) firmasının KENDİ web sitesindeki iletişim sayfasında yayınlanan
santral/merkez telefon numarasını ve genel e-posta adresini bul. Fabrika/tesis telefonu varsa onu tercih et.
Uydurma; bulamazsan boş bırak. Telefonu uluslararası biçimde yaz (+90 ...).
Sadece JSON: {"phone":"","email":"","source":"url"}`, { web: true, size: 'low', kind: 'telefon' });
  const email = String(r.email || '').trim().toLowerCase();
  // "[email protected]" gibi sitelerin gizlediği / sahte adresleri kaydetme
  return { phone: String(r.phone || '').trim(), email: /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) && !/protected/.test(email) ? email : '', source: r.source || '' };
}

// 3b) Firmada hedef birimdeki yetkilileri web'den bul (RocketReach yerine): LinkedIn herkese açık profilleri,
// firmanın yönetim/hakkımızda sayfası, haberler, ticaret sicili. Uydurma YOK — sadece kaynakta geçen kişiler.
async function findPeople(co, titles = []) {
  const meta = {};
  const r = await ask(`${co.name} (${co.domain}${co.city ? ', ' + co.city : ''}) firmasında çalışan, aşağıdaki birimlerden birinde YÖNETİCİ olan kişileri web'de bul:
genel müdür / fabrika müdürü / üretim müdürü / kalite müdürü / İSG-HSE müdürü veya uzmanı / bakım-tesis müdürü / operasyon direktörü.
Öncelikli unvanlar: ${titles.slice(0, 10).join(', ') || '-'}
Kaynaklar: site:linkedin.com/in "${co.name}", firmanın kendi sitesindeki yönetim/hakkımızda/iletişim sayfası, haberler, Ticaret Sicili Gazetesi, konferans konuşmacı listeleri.
KURALLAR: Sadece kaynakta adı ve bu firmadaki görevi AÇIKÇA geçen GÜNCEL çalışanları yaz (eski çalışan değil). İsim veya unvan UYDURMA. Muhasebe, satış, İK, satın alma, IT çalışanlarını yazma.
Bulamazsan boş liste döndür. En fazla 4 kişi; en kıdemli/en ilgili olan önce.
Sadece JSON: {"people":[{"name":"Ad Soyad","title":"unvan","linkedin":"https://www.linkedin.com/in/... (yoksa boş)","source":"bilginin geçtiği url","confidence":1-10}]}`, { web: true, kind: 'kişi bulma', meta });
  if (!meta.webCalls) return []; // web araması yapılmadıysa hiçbir isme güvenme
  const norm = u => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.|tr\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  const cited = new Set(meta.urls.map(norm)), fold = s => String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  const out = [];
  for (const x of (r.people || [])) {
    if (!x?.name || !x.title || String(x.name).trim().split(/\s+/).length < 2 || (+x.confidence || 0) < 6) continue;
    const li = (String(x.linkedin || '').match(/https?:\/\/[^\s)\]]*linkedin\.com\/in\/[^\s)\]]+/) || [''])[0];
    const liOk = li && cited.has(norm(li)) && !/\d{6,}/.test(li); // sahte "…-12345678" linkleri at
    let verified = liOk || cited.has(norm(x.source));
    // kaynak alıntılanmamışsa sayfayı biz açıp ismin gerçekten geçtiğine bakalım (LinkedIn dışı kaynaklar)
    if (!verified && /^https?:\/\//.test(x.source || '') && !/linkedin\.com/.test(x.source)) {
      try {
        const page = await (await fetch(x.source, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
        const last = fold(x.name).split(/\s+/).pop();
        verified = fold(page.replace(/<[^>]+>/g, ' ')).includes(last) && fold(page).includes(fold(x.name).split(/\s+/)[0]);
      } catch {}
    }
    if (!verified) continue;
    out.push({ ...x, linkedin: liOk ? li : '', verified: true });
  }
  return out;
}

// LinkedIn bağlantı notu (maili doğrulanamayan yetkili için). Ücretsiz LinkedIn'de not sınırı 200 karakter.
async function linkedinNotes(people) {
  const p = project();
  const r = await ask(`LinkedIn bağlantı isteği notları yaz. Gönderen: ${p.sender_name || 'Emre'} — ${p.company || 'Hype Vision'} (${p.offer || p.description || ''}).
Her kişi için EN FAZLA 190 karakter, kişinin dilinde (Türk ise Türkçe, değilse İngilizce), samimi ve kısa; adıyla hitap; firmasına/unvanına özel tek bir bağlam;
satış dili, link, emoji, "harika profiliniz" gibi klişe YOK; sonunda kısa bir bağlantı gerekçesi (ör. "fabrika güvenliği üzerine fikir alışverişi için eklemek isterim").
Kişiler: ${JSON.stringify(people.map(x => ({ id: x.id, ad: x.name, unvan: x.title, firma: x.company, yer: x.location || '' })))}
Sadece JSON: {"notes":[{"id":0,"note":""}]}`, { kind: 'linkedin notu', temperature: 0.7 });
  const list = Array.isArray(r) ? r : (r.notes || r.notlar || r.items || Object.values(r).find(Array.isArray) || []);
  return (list || []).map(n => ({ id: +n.id, note: String(n.note || '').slice(0, 200) })).filter(n => n.id && n.note);
}

// 4) Tetikleyici haberler: yatırım, yeni tesis, kapasite artışı, iş kazası, sertifika...
async function signals(c, exclude = []) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await ask(`Bugün ${today}. Web'de SON 90 GÜNE ait (${new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)} sonrası) haberleri tara; daha eski haberleri KESİNLİKLE verme. Hedef: ${c.sector || c.brief || c.name} sektörü, ${c.location || c.geography || 'Türkiye'}.
Şu olaylardan birini yaşayan GERÇEK firmaları bul: yeni fabrika/tesis açılışı, kapasite artışı veya yeni hat yatırımı, büyük yatırım/teşvik belgesi, iş kazası haberi,
yeni ISO 45001 / iş güvenliği programı, büyük ihracat anlaşması, otomasyon/dijitalleşme projesi. Bunlar görüntü işleme ile İSG/verimlilik/kalite çözümü için doğru zamanı gösterir.
Bu alan adlarını tekrar verme: ${exclude.slice(0, 200).join(', ') || '-'}
En fazla 12 sonuç. Haber linki gerçek olmalı; emin olmadığını yazma.
Her sinyale 1-10 arası "score" ver (bizim için satış fırsatı değeri): 9-10 = yeni tesis/hat kuruluyor veya iş kazası oldu (karar şimdi verilecek, kamera altyapısı yeni kuruluyor);
7-8 = büyük yatırım / kapasite artışı / ISO 45001 süreci; 5-6 = ihracat anlaşması, dijitalleşme açıklaması; 1-4 = genel haber. "why": neden şimdi doğru zaman (1 cümle).
"angle": bu firmaya hangi Hype Vision modülüyle, hangi somut cümleyle girilmeli. Modüllerimiz: KKD/baret-yelek kontrolü, yasak/tehlikeli alan ihlali, forklift-yaya yakınlaşma,
yüksekte çalışma, düşme/bayılma tespiti, yangın-duman-gaz, acil çıkış blokajı, hat duruşu ve OEE, istasyon boşta kalma/çevrim süresi, yüzey kusuru/anomali, kaynak dikişi, dolum-etiket-OCR, depo dock time/palet sayımı.
"why" ve "angle" haberdeki SOMUT bilgiye (yer, yatırım tutarı, hat/ürün adı, kaza türü) atıf yapsın; "kamera altyapısı gerekir" gibi genel cümle yazma.
Örnek angle: "Gebze'ye eklenen yeni boyahanede kimyasal alan için yasak bölge + KKD (maske) kontrolü; hat devreye girmeden pilot önerelim."
Sadece JSON: {"signals":[{"company":"","domain":"firmanın kendi sitesi","city":"","kind":"yatırım|yeni tesis|kapasite|iş kazası|sertifika|ihracat|dijitalleşme","event":"tek cümle ne oldu","date":"YYYY-MM-DD","url":"","score":1-10,"why":"","angle":""}]}`, { web: true, kind: 'sinyal' });
  return (r.signals || []).filter(x => x.company && x.event);
}

module.exports = { linkedinNotes, findPeople, usage, ask, profileFromWebsite, suggestCampaign, findCompanies, draftEmail, list, project, opener, classifyReply, companyContact, signals, LABELS };
