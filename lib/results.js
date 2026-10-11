// Sonuç Ölçümü: 2 aylık deneme (Hype Vision kendi satışı) — gönderilen, ulaşılan kişi, geri dönen, cevap, olumlu cevap, toplantı;
// kampanya / gönderen kutu / şablon / hafta kırılımı ve hedeflere göre durum. Açılma takibi bilinçli olarak yok (piksel spam sinyali).
const { all, get, setting, setSetting } = require('./db');
const { event } = require('./notify');

const TARGET = { reply: 2, meet1000: 2.5, minSent: 1000 }; // cevap oranı %, 1000 mailde toplantı, anlamlı örneklem
const DEF_START = '2026-10-11';
const window_ = () => {
  const start = setting('trial_start') || DEF_START, end = setting('trial_end') || new Date(Date.parse(start + 'T00:00:00+03:00') + 61 * 864e5).toISOString().slice(0, 10);
  return { start, end };
};
const iso = d => new Date(Date.parse(d + 'T00:00:00+03:00')).toISOString();
const POS = "('ilgileniyor','soru')";

// f: { camp, sender, tpl (0 = AI kişiye özel) }
function metrics(from, to, f = {}) {
  let ow = '', oa = [], rw = '', ra = [], mw = '', ma = [];
  if (f.camp != null) { ow += ' AND o.campaign_id=?'; oa.push(f.camp); rw += ' AND o.campaign_id=?'; ra.push(f.camp); mw += ' AND o.campaign_id=?'; ma.push(f.camp); }
  if (f.sender != null) { ow += ' AND o.sender_id=?'; oa.push(f.sender); rw += ' AND o.sender_id=?'; ra.push(f.sender); }
  if (f.tpl != null) { ow += f.tpl ? ' AND o.template_id=?' : ' AND o.template_id IS NULL'; if (f.tpl) oa.push(f.tpl);
    rw += ` AND o.contact_id IN (SELECT contact_id FROM outbox WHERE step=0 AND ${f.tpl ? 'template_id=?' : 'template_id IS NULL'})`; if (f.tpl) ra.push(f.tpl); }
  const noMeet = f.sender != null || f.tpl != null;
  const s = get(`SELECT count(*) sent, sum(step=0) first, count(DISTINCT CASE WHEN step=0 THEN contact_id END) people, sum(status='geri döndü') bounced
    FROM outbox o WHERE step<100 AND status IN ('gönderildi','geri döndü') AND sent_at>=? AND sent_at<?${ow}`, from, to, ...oa) || {};
  const r = get(`SELECT count(DISTINCT contact_id) replies, count(DISTINCT CASE WHEN label IN ${POS} THEN contact_id END) positive, count(DISTINCT CASE WHEN label='ilgisiz' THEN contact_id END) negative
    FROM replies o WHERE label<>'otomatik cevap' AND COALESCE(received_at, created)>=? AND COALESCE(received_at, created)<?${rw}`, from, to, ...ra) || {};
  const m = noMeet ? {} : get(`SELECT count(*) n FROM meetings o WHERE status<>'iptal' AND created>=? AND created<?${mw}`, from.replace('T', ' ').slice(0, 19), to.replace('T', ' ').slice(0, 19), ...ma) || {};
  const sent = s.sent || 0, people = s.people || 0, replies = r.replies || 0;
  return { sent, first: s.first || 0, people, bounced: s.bounced || 0, replies, positive: r.positive || 0, negative: r.negative || 0, meetings: noMeet ? null : (m.n || 0),
    replyRate: people ? +(replies / people * 100).toFixed(1) : 0, posRate: people ? +((r.positive || 0) / people * 100).toFixed(1) : 0,
    bounceRate: sent ? +((s.bounced || 0) / sent * 100).toFixed(1) : 0, meet1000: sent ? +((m.n || 0) / sent * 1000).toFixed(1) : 0 };
}

function verdict(t, daysLeft) {
  if (t.sent < TARGET.minSent) return { level: 'erken', text: `Henüz erken: ${t.sent} mail gitti, anlamlı sonuç için en az ${TARGET.minSent} gerekiyor.` };
  const okR = t.replyRate >= TARGET.reply, okM = t.meet1000 >= TARGET.meet1000;
  if (okR && okM) return { level: 'iyi', text: 'Hedefte: cevap oranı ve toplantı sayısı hedefin üstünde. Bu gidişle "hizmet olarak satış" aşamasına geçilebilir.' };
  if (okR || okM) return { level: 'orta', text: `Kısmen: ${okR ? 'cevap oranı hedefte ama toplantıya dönüşüm düşük — cevaplara hızlı dönüş ve randevu linki önemli' : 'toplantı hedefte ama cevap oranı düşük — hedef kitle / ilk cümle / konu satırı denenmeli'}.` };
  return { level: 'kotu', text: `Hedefin altında.${daysLeft > 14 ? ' Henüz zaman var: kampanya, unvan ve şablon kırılımına bakıp zayıf olanları kapat.' : ' Deneme bitmek üzere — sonuç böyle kalırsa ürünleştirmeye geçme.'}` };
}

function report(opt = {}) {
  const w = window_(), from = iso(opt.from || w.start), to = iso(opt.to || new Date(Date.now() + 3 * 3600e3 + 864e5).toISOString().slice(0, 10));
  const total = metrics(from, to);
  const camps = all(`SELECT DISTINCT o.campaign_id id, k.name, k.kind FROM outbox o JOIN campaigns k ON k.id=o.campaign_id WHERE o.step<100 AND o.status IN ('gönderildi','geri döndü') AND o.sent_at>=? AND o.sent_at<?`, from, to)
    .map(c => ({ ...c, ...metrics(from, to, { camp: c.id }) })).sort((a, b) => b.sent - a.sent);
  const senders = all('SELECT id, email, name FROM senders ORDER BY id').map(s => ({ ...s, ...metrics(from, to, { sender: s.id }) })).filter(s => s.sent);
  const tpls = all(`SELECT DISTINCT COALESCE(o.template_id,0) id, COALESCE(t.name, 'AI kişiye özel (otopilot)') name FROM outbox o LEFT JOIN templates t ON t.id=o.template_id
    WHERE o.step=0 AND o.status IN ('gönderildi','geri döndü') AND o.sent_at>=? AND o.sent_at<?`, from, to)
    .map(t => ({ ...t, ...metrics(from, to, { tpl: t.id }) })).sort((a, b) => b.sent - a.sent);
  // haftalık seri (pazartesi başlangıçlı)
  const weeks = []; let d = new Date(Date.parse(from));
  d = new Date(d.getTime() - ((new Date(d.getTime() + 3 * 3600e3).getUTCDay() + 6) % 7) * 864e5);
  while (d.toISOString() < to && weeks.length < 12) { const e = new Date(d.getTime() + 7 * 864e5); weeks.push({ week: new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10), ...metrics(d.toISOString(), e.toISOString()) }); d = e; }
  const extra = {
    manual: get('SELECT count(*) n FROM contacts WHERE manual_sent>=?', from)?.n || 0,
    meta: (() => { try { return get('SELECT count(*) n FROM meta_leads WHERE created>=?', from)?.n || 0; } catch { return 0; } })(),
    upcoming: get("SELECT count(*) n FROM meetings WHERE status='planlandı' AND start>=?", new Date().toISOString())?.n || 0,
  };
  const now = Date.now(), endT = Date.parse(w.end + 'T23:59:59+03:00'), startT = Date.parse(w.start + 'T00:00:00+03:00');
  const daysLeft = Math.max(0, Math.ceil((endT - now) / 864e5)), day = Math.min(61, Math.max(1, Math.ceil((now - startT) / 864e5)));
  return { window: w, day, daysLeft, target: TARGET, total, verdict: verdict(total, daysLeft), campaigns: camps, senders, templates: tpls, weeks, extra };
}

// Pazartesi 09:30: geçen haftanın sonuçları + deneme durumu Telegram'a
function tick() {
  const n = new Date(Date.now() + 3 * 3600e3), day = n.toISOString().slice(0, 10);
  if (n.getUTCDay() !== 1 || n.getUTCHours() * 60 + n.getUTCMinutes() < 570 || setting('results_week') === day) return;
  setSetting('results_week', day);
  const r = report(), lw = r.weeks[r.weeks.length - 2] || r.weeks[r.weeks.length - 1] || {}, t = r.total;
  event('info', `📊 Deneme ${r.day}. gün (${r.daysLeft} gün kaldı)\nGeçen hafta: ${lw.sent || 0} mail · ${lw.replies || 0} cevap · ${lw.positive || 0} olumlu · ${lw.meetings || 0} toplantı\nToplam: ${t.sent} mail, ${t.people} kişi, cevap %${t.replyRate} (hedef %${TARGET.reply}), 1000 mailde ${t.meet1000} toplantı (hedef ${TARGET.meet1000})\n${r.verdict.text}`);
}
function start() { setInterval(tick, 10 * 60e3); }

module.exports = { report, start, TARGET };
