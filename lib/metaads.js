// Meta reklam analizi (Marketing API, sadece okuma): harcama / gösterim / tıklama / potansiyel müşteri / CPL,
// reklam bazında tablo + AI yorumu, sabah Telegram özeti ve Lead Ads formlarından gelen kişileri Lead-AI'a alma.
const { db, all, get, run, setting, setSetting, jsonSetting } = require('./db');
const { event } = require('./notify');
const ai = require('./ai');

db.exec(`CREATE TABLE IF NOT EXISTS meta_leads(id TEXT PRIMARY KEY, ad_id TEXT, ad_name TEXT, form_id TEXT, created TEXT, name TEXT, email TEXT, phone TEXT, company TEXT,
  title TEXT, city TEXT, raw TEXT, contact_id INTEGER, added TEXT DEFAULT CURRENT_TIMESTAMP)`);

const V = 'https://graph.facebook.com/v21.0';
const acct = () => { const a = String(setting('meta_ad_account') || '').trim(); return a ? (a.startsWith('act_') ? a : 'act_' + a) : ''; };
async function g(path, params = {}) {
  const tok = setting('meta_ads_token'); if (!tok || !acct()) throw Object.assign(new Error('Meta reklam hesabı bağlı değil'), { status: 400 });
  const u = new URL(V + path); for (const [k, v] of Object.entries({ ...params, access_token: tok })) u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const r = await fetch(u, { signal: AbortSignal.timeout(60000) }); const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw Object.assign(new Error('Meta: ' + (j.error?.error_user_msg || j.error?.message || r.status)), { status: 502 });
  return j;
}
async function all_(path, params) { let j = await g(path, params), out = [...(j.data || [])]; for (let i = 0; i < 10 && j.paging?.next; i++) { j = await (await fetch(j.paging.next)).json(); out.push(...(j.data || [])); } return out; }

const LEAD_ACT = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'leadgen_grouped'];
const num = v => +v || 0;
function leadsOf(row) { let n = 0; for (const a of row.actions || []) if (LEAD_ACT.includes(a.action_type)) n = Math.max(n, num(a.value)); return n; }
function msgOf(row) { let n = 0; for (const a of row.actions || []) if (/messaging_conversation_started|onsite_conversion\.messaging_first_reply/.test(a.action_type)) n = Math.max(n, num(a.value)); return n; }
const FIELDS = 'campaign_id,campaign_name,adset_name,ad_id,ad_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions';

async function me() { return g('/' + acct(), { fields: 'name,currency,account_status,amount_spent,timezone_name' }); }

async function report(preset = 'last_7d') {
  const [ads, daily, info] = await Promise.all([
    all_(`/${acct()}/insights`, { level: 'ad', date_preset: preset, fields: FIELDS, limit: '200' }),
    all_(`/${acct()}/insights`, { level: 'account', date_preset: preset, time_increment: '1', fields: 'spend,impressions,clicks,inline_link_clicks,actions' }),
    me().catch(() => ({})),
  ]);
  const rows = ads.map(r => {
    const spend = num(r.spend), leads = leadsOf(r), msgs = msgOf(r), link = num(r.inline_link_clicks);
    return { campaign: r.campaign_name, adset: r.adset_name, ad_id: r.ad_id, ad: r.ad_name, spend, impressions: num(r.impressions), reach: num(r.reach), frequency: +num(r.frequency).toFixed(2),
      clicks: num(r.clicks), link, ctr: +num(r.ctr).toFixed(2), cpc: +num(r.cpc).toFixed(2), cpm: +num(r.cpm).toFixed(2), leads, msgs, cpl: leads ? +(spend / leads).toFixed(2) : null };
  }).sort((a, b) => b.spend - a.spend);
  const T = rows.reduce((t, r) => ({ spend: t.spend + r.spend, impressions: t.impressions + r.impressions, link: t.link + r.link, clicks: t.clicks + r.clicks, leads: t.leads + r.leads, msgs: t.msgs + r.msgs }),
    { spend: 0, impressions: 0, link: 0, clicks: 0, leads: 0, msgs: 0 });
  T.ctr = T.impressions ? +(T.clicks / T.impressions * 100).toFixed(2) : 0; T.cpl = T.leads ? +(T.spend / T.leads).toFixed(2) : null; T.cpc = T.link ? +(T.spend / T.link).toFixed(2) : null;
  const days = daily.map(d => ({ date: d.date_start, spend: num(d.spend), clicks: num(d.inline_link_clicks), leads: leadsOf(d), impressions: num(d.impressions) }));
  const out = { preset, currency: info.currency || 'TRY', account: info.name || '', totals: T, rows, days, t: Date.now() };
  setSetting('meta_report_' + preset, JSON.stringify(out));
  return out;
}

async function analyze(preset = 'last_7d') {
  const r = await report(preset), p = ai.project();
  const crm = get(`SELECT count(*) n, sum(EXISTS(SELECT 1 FROM meetings m WHERE m.contact_id=ml.contact_id)) mt FROM meta_leads ml WHERE created>=datetime('now','-30 day')`) || {};
  const a = await ai.ask(`Sen B2B performans pazarlama uzmanısın. Hype Vision'ın Meta (Facebook/Instagram) reklam verilerini analiz et.
Şirket: ${p.description || 'fabrikalar için mevcut kameralarla yapay zeka İSG/verimlilik çözümü'} — hedef: fabrika/İSG/üretim yöneticilerinden potansiyel müşteri ve toplantı.
Dönem: ${preset}, para birimi ${r.currency}. Toplam: ${JSON.stringify(r.totals)}
Reklamlar (harcamaya göre): ${JSON.stringify(r.rows.slice(0, 25))}
Günlük: ${JSON.stringify(r.days)}
CRM: son 30 günde reklamdan gelen ${crm.n || 0} kişi, bunlardan ${crm.mt || 0} toplantı.
Türkçe, somut ve kısa yaz; rakamlara dayan, uydurma veri ekleme. B2B için makul kıyas: CTR %0.8-1.5, frekans 3'ü geçerse yorgunluk.
Sadece JSON: {"summary":"2-3 cümle genel durum","good":["iyi giden + neden"],"bad":["para yakan / sorunlu + neden"],"actions":[{"do":"yapılacak iş (ör. X reklamını durdur, bütçeyi Y'ye kaydır)","why":"","impact":"yüksek|orta|düşük"}],"creative":["yeni reklam/kreatif fikri (başlık + görsel/video önerisi)"],"audience":["hedefleme önerisi"]}`,
    { kind: 'reklam analizi', temperature: 0.3 });
  const out = { ...a, t: Date.now(), preset };
  setSetting('meta_ai_' + preset, JSON.stringify(out));
  return { report: r, ai: out };
}

// Lead Ads: reklam bazında formdan gelen kişileri çek → kişi + "Meta Reklam" kampanyası, Telegram 🔥
async function pullLeads() {
  if (!setting('meta_ads_token') || !acct()) return 0;
  const ads = await all_(`/${acct()}/ads`, { fields: 'id,name,effective_status', limit: '200', effective_status: ['ACTIVE', 'PAUSED'] });
  let camp = get("SELECT id FROM campaigns WHERE name='📣 Meta Reklam' LIMIT 1")?.id;
  if (!camp) camp = Number(run("INSERT INTO campaigns(name,brief,status,kind,auto_lookup) VALUES('📣 Meta Reklam','Meta potansiyel müşteri formlarından gelen kişiler','aktif','meta',0)").lastInsertRowid);
  let n = 0;
  for (const ad of ads) {
    let leads = []; try { leads = await all_(`/${ad.id}/leads`, { fields: 'id,created_time,field_data,form_id', limit: '100' }); } catch { continue; }
    for (const L of leads) {
      if (get('SELECT 1 FROM meta_leads WHERE id=?', L.id)) continue;
      const f = {}; for (const x of L.field_data || []) f[String(x.name).toLowerCase()] = (x.values || [])[0] || '';
      const pick = (...k) => { for (const key of Object.keys(f)) if (k.some(w => key.includes(w))) return f[key]; return ''; };
      const name = pick('full_name', 'ad_soyad', 'name', 'isim') || [pick('first_name'), pick('last_name')].filter(Boolean).join(' ');
      const email = pick('email', 'e-posta', 'eposta').toLowerCase(), phone = pick('phone', 'telefon'), company = pick('company', 'şirket', 'sirket', 'firma');
      const title = pick('job_title', 'unvan', 'pozisyon'), city = pick('city', 'şehir', 'sehir');
      let cid = email && get('SELECT id FROM contacts WHERE lower(email)=?', email)?.id;
      if (!cid) cid = Number(run("INSERT INTO contacts(name,title,company,location,email,status,source) VALUES(?,?,?,?,?,?,?)", name, title, company, city, email, email ? 'mail var' : 'mail yok', 'meta reklam').lastInsertRowid);
      run('INSERT OR IGNORE INTO leads(campaign_id,contact_id,stage) VALUES(?,?,?)', camp, cid, 'yanıtladı');
      run('INSERT INTO meta_leads(id,ad_id,ad_name,form_id,created,name,email,phone,company,title,city,raw,contact_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        L.id, ad.id, ad.name, L.form_id || '', L.created_time, name, email, phone, company, title, city, JSON.stringify(f), cid);
      if (phone && company) { const co = get('SELECT id FROM companies WHERE campaign_id=? AND name=?', camp, company); if (!co) run('INSERT INTO companies(campaign_id,name,phone,call_status) VALUES(?,?,?,?)', camp, company, phone, 'aranacak'); }
      event('reply', `🔥 META REKLAM FORMU: ${name || '-'}${company ? ' (' + company + ')' : ''}${title ? ' · ' + title : ''}\n${email}${phone ? ' · ' + phone : ''}\nReklam: ${ad.name}\nHemen ara — form dolduranlar ilk 1 saatte en sıcak.`);
      n++;
    }
  }
  return n;
}

// Sabah özeti (dün) + uyarılar
async function morning() {
  const y = await report('yesterday'), w = jsonSetting('meta_report_last_7d', null);
  const T = y.totals, cur = y.currency === 'TRY' ? '₺' : y.currency + ' ';
  const warn = y.rows.filter(r => r.frequency > 3).map(r => `"${r.ad}" frekans ${r.frequency} (yorgunluk)`)
    .concat(y.rows.filter(r => r.spend > 0 && !r.leads && r.spend > (T.spend / Math.max(1, y.rows.length)) * 1.5).map(r => `"${r.ad}" ${cur}${r.spend.toFixed(0)} harcadı, 0 sonuç`));
  event('info', `📣 Meta reklam · dün: ${cur}${T.spend.toFixed(0)} harcama, ${T.link} tıklama (CTR %${T.ctr}), ${T.leads} form${T.cpl ? ` (kişi başı ${cur}${T.cpl})` : ''}${T.msgs ? `, ${T.msgs} mesaj` : ''}.${w?.totals ? ` Son 7 gün: ${cur}${w.totals.spend.toFixed(0)} · ${w.totals.leads} form.` : ''}${warn.length ? '\n⚠️ ' + warn.slice(0, 3).join('\n⚠️ ') : ''}`);
}

async function tick() {
  if (!setting('meta_ads_token') || !acct()) return;
  const now = new Date(Date.now() + 3 * 3600e3), day = now.toISOString().slice(0, 10), h = now.getUTCHours();
  try { await pullLeads(); } catch (e) { console.error('meta leads', e.message); }
  if (h >= 9 && setting('meta_morning_day') !== day) {
    setSetting('meta_morning_day', day);
    try { await report('last_7d'); await morning(); } catch (e) { event('error', 'Meta reklam raporu alınamadı: ' + e.message.slice(0, 150)); }
  }
}
function start() { setInterval(tick, 10 * 60e3); setTimeout(tick, 45e3); }

module.exports = { start, me, report, analyze, pullLeads, morning, acct };
