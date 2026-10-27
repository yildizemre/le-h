// Zamanlı içgörüler: pazartesi haftalık rapor, her sabah geri arama hatırlatması, haftalık haber/sinyal taraması
const { all, get, run, setting, setSetting } = require('./db');
const { event, sendTelegram } = require('./notify');
const mailer = require('./mailer');
const ai = require('./ai');
const { jsonSetting } = require('./db');

// AI kampanya önerileri (günlük önbellek) — panel ve otomatik kampanya ortak kullanır
async function getIdeas(fresh) {
  const cache = jsonSetting('ideas_cache', {});
  const intl = mailer.intlOnly();
  if (!fresh && cache.t && Date.now() - cache.t < 864e5 && cache.list?.length && !!cache.intl === intl) return cache.list;
  const p = ai.project(), done = all('SELECT name, sector, location FROM campaigns').map(c => [c.sector, c.location, c.name].filter(Boolean).join(' / '));
  const r = await ai.ask(`Sen B2B büyüme stratejistisin. Aşağıdaki şirket için soğuk mail kampanyası önerileri üret.
Şirket: ${p.company || ''} — ${p.description || ''}
Teklif: ${p.offer || ''}
Yetenekler: ${String(p.capabilities || '').slice(0, 800)}
Mevcut kampanyalar (tekrar etme): ${done.slice(-60).join('; ') || '-'}
${intl ? "8 öneri ver, HEPSİ yurt dışı (Türkiye KESİNLİKLE yok): tüm dünyadan, imalat sanayisi olan HER ülke olabilir (Avrupa, ABD/Kanada, Latin Amerika, Körfez, Kuzey Afrika, Güney/Güneydoğu Asya, Doğu Asya, Okyanusya…). Öneriler farklı ülke ve kıtalara yayılsın, aynı ülkeyi tekrar etme; ülke ülke, mümkünse sanayi bölgesi/şehir ile. Hedef: kendi fabrikasında üretim yapan orta ölçekli firmalar (dev markalar değil)." : "8 öneri ver: yarısı Türkiye'de farklı sanayi bölgeleri/sektörler, yarısı yurt dışı (ülke ülke, Türkiye'ye yakın ve üretim yoğun pazarlar)."}
Her biri farklı bir sektör+bölge kombinasyonu olsun; neden şimdi mantıklı olduğunu somut yaz (mevzuat, yoğunluk, kaza riski, ihracat vb.).
Sadece JSON: {"ideas":[{"name":"kısa ad","sector":"","location":"şehir/bölge (boş olabilir)","country":"Türkiye veya ülke adı (Türkçe)","why":"1 cümle","titles":"aranacak 3-4 unvan, virgülle","modules":"öne çıkacak 2-3 modül"}]}`, { kind: 'öneri' });
  const list = (r.ideas || []).filter(x => x.sector && !(intl && /t[uü]rkiye|turkey/i.test(x.country || '')));
  setSetting('ideas_cache', JSON.stringify({ t: Date.now(), list, intl }));
  return list;
}

const AUTO_DEF = { enabled: true, count: 20, lookup: true, hour: 8, per_day: 3, tr_only: false }; // per_day: günde kaç otomatik kampanya
const autoCfg = () => ({ ...AUTO_DEF, ...jsonSetting('auto_daily', {}) });

// Her iş günü bir otomatik kampanya: AI önerilerinden daha önce yapılmamış ilk sektör+bölge
async function autoCampaign(force) {
  const cfg = autoCfg();
  let ideas = await getIdeas();
  // Türkçe harfleri ve boşlukları normalize ederek karşılaştır (SQLite lower() "İ"yi çevirmiyor)
  const norm = v => String(v || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
  const used = new Set(all('SELECT sector, location FROM campaigns').map(r => norm(r.sector) + '|' + norm(r.location)));
  const key = x => norm(x.sector) + '|' + norm([x.location, x.country && x.country !== 'Türkiye' ? x.country : ''].filter(Boolean).join(', '));
  const ok = x => !used.has(key(x)) && (mailer.intlOnly() ? x.country && x.country !== 'Türkiye' : !cfg.tr_only || x.country === 'Türkiye');
  let pick = ideas.find(ok);
  if (!pick) { ideas = await getIdeas(true); pick = ideas.find(ok); }
  if (!pick) return null;
  const id = await require('./worker').createQuick({ sector: pick.sector, location: pick.location || '', country: pick.country || '', titles: pick.titles || '',
    count: cfg.count, people: true, lookup: cfg.lookup, auto: 1, note: pick.why || '' }, 1);
  if (!force) setSetting('auto_daily_done', mailer.nowTR().date);
  return { id, idea: pick };
}

// Akşam özeti: bugün bulunan yetkililer + LinkedIn profilleri
function linkedinDigest() {
  const today = mailer.nowTR().date;
  const rows = all(`SELECT c.name, c.title, c.company, c.linkedin, c.email FROM contacts c WHERE date(c.created, '+3 hours')=? AND c.linkedin<>'' ORDER BY (c.email<>'') DESC, c.id DESC`, today);
  if (!rows.length) return '';
  return `👤 Bugün bulunan ${rows.length} yetkili (${rows.filter(r => r.email).length} maili var):\n` +
    rows.slice(0, 20).map(r => `• ${r.name} — ${r.title || ''} @ ${r.company}${r.email ? ' ✉️' : ''}\n  ${r.linkedin}`).join('\n') + (rows.length > 20 ? `\n… +${rows.length - 20} kişi (Kişilerim)` : '');
}

// Sinyal taraması: günde 1 kez (09:00), her seferinde sıradaki aktif kampanya
async function signalSlot(n) {
  const slot = [9].filter(h => n.hour >= h).pop(); // maliyet için günde 1 tarama (önce 09/13/17)
  if (slot === undefined || setting('sig_slot') === n.date + '-' + slot) return;
  setSetting('sig_slot', n.date + '-' + slot);
  const camps = all("SELECT id, user_id FROM campaigns WHERE status='aktif' AND kind<>'partner' AND (sector<>'' OR brief<>'') ORDER BY id");
  if (!camps.length) return;
  const i = (+setting('sig_rr') || 0) % camps.length; setSetting('sig_rr', String(i + 1));
  require('./worker').enqueue('signals', { campaign_id: camps[i].id, slot: n.date + '-' + slot }, camps[i].id, camps[i].user_id);
}

const weekKey = () => { const d = new Date(Date.now() + 3 * 3600e3); const j = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return d.getUTCFullYear() + '-' + Math.ceil(((d - j) / 864e5 + j.getUTCDay() + 1) / 7); };
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

// Şablon performansı: gönderilen ilk mail sayısı ve gerçek yanıt (otomatik cevap hariç) oranı
function templateStats(sinceIso = '1970-01-01') {
  return all(`SELECT t.id, t.name,
      (SELECT count(*) FROM outbox o WHERE o.template_id=t.id AND o.step=0 AND o.status='gönderildi' AND o.sent_at>=?) AS sent,
      (SELECT count(DISTINCT r.contact_id) FROM replies r JOIN outbox o ON o.contact_id=r.contact_id AND o.template_id=t.id AND o.step=0 AND o.status='gönderildi'
         WHERE r.label NOT IN ('otomatik cevap','') AND o.sent_at>=?) AS replied,
      (SELECT count(DISTINCT r.contact_id) FROM replies r JOIN outbox o ON o.contact_id=r.contact_id AND o.template_id=t.id AND o.step=0 AND o.status='gönderildi'
         WHERE r.label IN ('ilgileniyor','soru') AND o.sent_at>=?) AS positive
    FROM templates t ORDER BY t.id`, sinceIso, sinceIso, sinceIso).map(x => ({ ...x, rate: pct(x.replied, x.sent), prate: pct(x.positive, x.sent) }));
}

function weekly() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString(), sinceSql = since.replace('T', ' ').slice(0, 19);
  const n = (sql, ...a) => get(sql, ...a).n;
  const companies = n('SELECT count(*) n FROM companies WHERE created>=?', sinceSql);
  const people = n('SELECT count(*) n FROM contacts WHERE created>=?', sinceSql);
  const mails = n("SELECT count(*) n FROM contacts WHERE email<>'' AND updated>=?", sinceSql);
  const sent = n("SELECT count(*) n FROM outbox WHERE status='gönderildi' AND step<100 AND sent_at>=?", since);
  const first = n("SELECT count(*) n FROM outbox WHERE status='gönderildi' AND step=0 AND sent_at>=?", since);
  const byLabel = all("SELECT label, count(*) n FROM replies WHERE received_at>=? GROUP BY label", since);
  const lab = l => byLabel.find(x => x.label === l)?.n || 0;
  const real = byLabel.filter(x => x.label && x.label !== 'otomatik cevap').reduce((a, b) => a + b.n, 0);
  const bounces = n("SELECT count(*) n FROM outbox WHERE status='geri döndü' AND sent_at>=?", since);
  const tpl = templateStats(since).filter(t => t.sent >= 5).sort((a, b) => b.rate - a.rate)[0];
  const camp = all(`SELECT k.name, k.sector, count(DISTINCT o.contact_id) s, count(DISTINCT r.contact_id) r FROM campaigns k JOIN outbox o ON o.campaign_id=k.id AND o.status='gönderildi' AND o.step=0 AND o.sent_at>=?
      LEFT JOIN replies r ON r.contact_id=o.contact_id AND r.label NOT IN ('otomatik cevap','') GROUP BY k.id HAVING s>=5 ORDER BY (1.0*r/s) DESC LIMIT 1`, since)[0];
  const calls = n("SELECT count(*) n FROM companies WHERE called_at>=?", since);
  const meet = n("SELECT count(*) n FROM companies WHERE call_status='görüşüldü' AND called_at>=?", since);
  return [
    `📊 <b>Haftalık özet</b> (son 7 gün)`,
    `🏭 ${companies} yeni firma · 👤 ${people} yetkili · ✉️ ${mails} mail bulundu`,
    `📤 ${sent} mail gönderildi (${first} ilk mail)${bounces ? ` · ⚠️ ${bounces} geri döndü` : ''}`,
    `💬 ${real} gerçek yanıt (%${pct(real, first)}) — 🔥 ${lab('ilgileniyor')} ilgileniyor · ❓ ${lab('soru')} soru · 🕓 ${lab('sonra yaz')} sonra · ↪️ ${lab('yanlış kişi')} yönlendirme · 🚫 ${lab('ilgisiz')} ilgisiz`,
    calls ? `📞 ${calls} firma arandı · ${meet} görüşme` : '',
    tpl ? `🏆 En iyi şablon: ${tpl.name} — %${tpl.rate} yanıt (${tpl.sent} gönderim)` : '',
    camp ? `🎯 En iyi kampanya: ${camp.name} — %${pct(camp.r, camp.s)} yanıt` : '',
    `Lead-AI · lead.hypevisionlab.com`,
  ].filter(Boolean).join('\n');
}

async function sendWeekly(force) {
  const text = weekly();
  if (setting('tg_token') && setting('tg_chat')) await sendTelegram(text);
  run('INSERT INTO events(type,text) VALUES(?,?)', 'job', text.replace(/<[^>]+>/g, ''));
  if (!force) setSetting('weekly_sent', weekKey());
  return text;
}

function callbacksDue() {
  const end = new Date(mailer.nowTR().date + 'T23:59:59+03:00').toISOString();
  return all("SELECT * FROM companies WHERE call_status='geri ara' AND callback_at IS NOT NULL AND callback_at<=? ORDER BY callback_at", end);
}

async function loop() {
  try {
    const n = mailer.nowTR();
    // Pazartesi 09:00 sonrası haftalık rapor
    if (n.day === 1 && n.hour >= 9 && setting('weekly_sent') !== weekKey()) await sendWeekly();
    const work = n.day >= 1 && n.day <= 5;
    // Otomatik kampanyalar (iş günleri): günde per_day adet, saatte bir; sonuncusu ayarlanan saatte (09:38 otopilotundan önce kişiler bulunsun)
    const cfg = autoCfg(), per = Math.max(1, +cfg.per_day || 1), first = (cfg.hour || 8) - (per - 1);
    const doneN = setting('auto_daily_done') === n.date ? Math.max(1, +setting('auto_daily_n') || 1) : 0;
    if (work && cfg.enabled && doneN < per && n.hour >= first + doneN) {
      setSetting('auto_daily_done', n.date); setSetting('auto_daily_n', String(doneN + 1));
      try { await autoCampaign(true); } catch (e) { event('error', 'Otomatik kampanya kurulamadı: ' + e.message.slice(0, 120)); }
    }
    // Günde 3 sinyal taraması
    if (work) await signalSlot(n);
    // 18:00 LinkedIn özeti
    if (work && n.hour >= 18 && setting('li_digest') !== n.date) { setSetting('li_digest', n.date); const t = linkedinDigest(); if (t) event('found', t); }
    // Her iş günü 09:00 sonrası: bugün geri aranacaklar
    if (n.day >= 1 && n.day <= 5 && n.hour >= 9 && setting('callbacks_sent') !== n.date) {
      setSetting('callbacks_sent', n.date);
      const due = callbacksDue();
      if (due.length) event('info', `📞 Bugün geri aranacak ${due.length} firma:\n` + due.slice(0, 15).map(c => `• ${c.name}${c.phone ? ' — ' + c.phone : ''}${c.call_note ? ' (' + c.call_note.slice(0, 60) + ')' : ''}`).join('\n'));
    }
  } catch (e) { console.error('insights', e.message); }
}

function start() { setInterval(loop, 10 * 60e3); setTimeout(loop, 60e3); }

module.exports = { getIdeas, autoCampaign, autoCfg, AUTO_DEF, linkedinDigest, start, weekly, sendWeekly, templateStats, callbacksDue };
