// Zamanlı içgörüler: pazartesi haftalık rapor, her sabah geri arama hatırlatması, haftalık haber/sinyal taraması
const { all, get, run, setting, setSetting } = require('./db');
const { event, sendTelegram } = require('./notify');
const mailer = require('./mailer');

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
    // Pazartesi 09:00 sonrası haftada bir rapor + aktif kampanyalar için sinyal taraması
    if (n.day === 1 && n.hour >= 9 && setting('weekly_sent') !== weekKey()) {
      await sendWeekly();
      const w = require('./worker');
      for (const c of all("SELECT id, user_id FROM campaigns WHERE status='aktif' AND kind<>'partner'")) w.enqueue('signals', { campaign_id: c.id, wk: weekKey() }, c.id, c.user_id);
    }
    // Her iş günü 09:00 sonrası: bugün geri aranacaklar
    if (n.day >= 1 && n.day <= 5 && n.hour >= 9 && setting('callbacks_sent') !== n.date) {
      setSetting('callbacks_sent', n.date);
      const due = callbacksDue();
      if (due.length) event('info', `📞 Bugün geri aranacak ${due.length} firma:\n` + due.slice(0, 15).map(c => `• ${c.name}${c.phone ? ' — ' + c.phone : ''}${c.call_note ? ' (' + c.call_note.slice(0, 60) + ')' : ''}`).join('\n'));
    }
  } catch (e) { console.error('insights', e.message); }
}

function start() { setInterval(loop, 10 * 60e3); setTimeout(loop, 60e3); }

module.exports = { start, weekly, sendWeekly, templateStats, callbacksDue };
