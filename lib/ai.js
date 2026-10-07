// OpenAI: şirket profili, kampanya önerisi, firma bulma (web araması), mail taslağı
const { setting, jsonSetting } = require('./db');

const model = () => setting('openai_model') || 'gpt-4.1-mini';

function parseJson(t) {
  t = String(t || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/[\[{][\s\S]*[\]}]/); if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error('AI geçersiz JSON döndürdü');
}

async function ask(input, { web = false, json = true, temperature } = {}) {
  const key = setting('openai_key');
  if (!key) throw Object.assign(new Error('Ayarlar → OpenAI API key girilmemiş'), { status: 400 });
  const body = { model: model(), input };
  if (web) body.tools = [{ type: 'web_search_preview', user_location: { type: 'approximate', country: 'TR' }, search_context_size: 'medium' }];
  if (temperature !== undefined && !web) body.temperature = temperature;
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('OpenAI: ' + (j.error?.message || r.status)), { status: 502 });
  const text = j.output_text ?? (j.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n');
  return json ? parseJson(text) : text;
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
Sadece JSON döndür.`, { web: true });
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
${count} firma bul. Her firmanın kendi web sitesi alan adı doğru olmalı (www/https olmadan). Rakip firmaları ve satıcının kendisini ekleme. ${c.kind === "partner" ? "Bunlar ÇÖZÜM ORTAĞI adayları: hizmet/entegrasyon firmaları (OSGB, İSG danışmanlık, CCTV/güvenlik entegratörü, endüstriyel otomasyon, MES/ERP/İSG yazılımı). Üretici, dernek, kamu kurumu ve haber sitesi ekleme; mümkünse firmanın kaç müşteriye/işyerine hizmet verdiğini reason alanına yaz." : "OSB yönetimlerini, dernekleri, odaları, kamu kurumlarını, bayi/distribütörleri ve haber sitelerini ekleme; sadece kendi tesisinde ÜRETİM/operasyon yapan firmalar."}
Sadece JSON: {"companies":[{"name":"","domain":"","city":"","sector":"","size":"tahmini çalışan","reason":"neden uygun, 1 cümle","score":1-10,"phone":"sitedeki santral telefonu (+90...) yoksa boş","email":"sitedeki genel mail yoksa boş"}]}`, { web: true });
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
Sadece JSON: {"subject":"kısa konu, 3-7 kelime","body":"düz metin, paragraflar \\n ile"}`, { temperature: 0.7 });
}

// 1) Kişiye özel ilk cümle: firmanın sitesine/haberlerine bakar, tek somut cümle yazar
async function opener(c, lang = 'Türkçe') {
  const p = project();
  const site = c.domain ? `Web sitesi: ${c.domain}` : '';
  const r = await ask(`${c.company} firmasını (${site} ${c.location || ''}) web'de kısaca araştır: yeni yatırım, tesis, hat, ürün, sertifika, büyüme, ihracat, işe alım gibi GÜNCEL ve SOMUT bir bilgi bul.
Sonra ${c.name} (${c.title || 'yönetici'}) kişisine yazılacak soğuk mailin İLK CÜMLESİNİ yaz (${lang}).
Kurallar: tek cümle, en fazla 28 kelime; bulduğun somut bilgiye atıf yapsın ("…gördüm/okudum" gibi doğal); iltifat klişesi yok ("harika işler" vb. yok);
selamlama yok (selam ayrıca yazılıyor); bizim ürünümüzden (${p.company || 'Hype Vision'}) bahsetme; bilgiden emin değilsen uydurma, opener alanını boş bırak.
Sadece JSON: {"opener":"","fact":"dayandığın bilgi","source":"url"}`, { web: true });
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
Sadece JSON: {"label":"","summary":"tek cümle Türkçe özet","return_date":"","referral":{"name":"","email":"","title":""},"draft":""}`, { temperature: 0.3 });
  if (!LABELS.includes(r.label)) r.label = 'soru';
  return r;
}

// 3) Firmanın web sitesinde yayınlanan santral telefonu + genel mail (kişisel veri değil)
async function companyContact(co) {
  const r = await ask(`${co.name} (${co.domain}${co.city ? ', ' + co.city : ''}) firmasının KENDİ web sitesindeki iletişim sayfasında yayınlanan
santral/merkez telefon numarasını ve genel e-posta adresini bul. Fabrika/tesis telefonu varsa onu tercih et.
Uydurma; bulamazsan boş bırak. Telefonu uluslararası biçimde yaz (+90 ...).
Sadece JSON: {"phone":"","email":"","source":"url"}`, { web: true });
  return { phone: String(r.phone || '').trim(), email: String(r.email || '').trim().toLowerCase(), source: r.source || '' };
}

// 4) Tetikleyici haberler: yatırım, yeni tesis, kapasite artışı, iş kazası, sertifika...
async function signals(c, exclude = []) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await ask(`Bugün ${today}. Web'de SON 90 GÜNE ait (${new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)} sonrası) haberleri tara; daha eski haberleri KESİNLİKLE verme. Hedef: ${c.sector || c.brief || c.name} sektörü, ${c.location || c.geography || 'Türkiye'}.
Şu olaylardan birini yaşayan GERÇEK firmaları bul: yeni fabrika/tesis açılışı, kapasite artışı veya yeni hat yatırımı, büyük yatırım/teşvik belgesi, iş kazası haberi,
yeni ISO 45001 / iş güvenliği programı, büyük ihracat anlaşması, otomasyon/dijitalleşme projesi. Bunlar görüntü işleme ile İSG/verimlilik/kalite çözümü için doğru zamanı gösterir.
Bu alan adlarını tekrar verme: ${exclude.slice(0, 200).join(', ') || '-'}
En fazla 12 sonuç. Haber linki gerçek olmalı; emin olmadığını yazma.
Sadece JSON: {"signals":[{"company":"","domain":"firmanın kendi sitesi","city":"","kind":"yatırım|yeni tesis|kapasite|iş kazası|sertifika|ihracat|dijitalleşme","event":"tek cümle ne oldu","date":"YYYY-MM-DD","url":""}]}`, { web: true });
  return (r.signals || []).filter(x => x.company && x.event);
}

module.exports = { ask, profileFromWebsite, suggestCampaign, findCompanies, draftEmail, list, project, opener, classifyReply, companyContact, signals, LABELS };
