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
Hedef tarif: ${c.brief}
Teklif: ${c.offer}
Olumlu kriterler: ${list(c.positive).join('; ')}
Olumsuz kriterler: ${list(c.negative).join('; ')}
Anahtar kelimeler: ${list(c.keywords).join(', ')}
Coğrafya: ${c.geography || 'Türkiye'}  Büyüklük: ${c.size || 'belirtilmedi'}
Şu alan adlarını TEKRAR VERME: ${exclude.slice(0, 300).join(', ') || '-'}
${count} firma bul. Her firmanın kendi web sitesi alan adı doğru olmalı (www/https olmadan). Rakip firmaları ve satıcının kendisini ekleme.
Sadece JSON: {"companies":[{"name":"","domain":"","city":"","sector":"","size":"tahmini çalışan","reason":"neden uygun, 1 cümle","score":1-10}]}`, { web: true });
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

module.exports = { ask, profileFromWebsite, suggestCampaign, findCompanies, draftEmail, list, project };
