// Etkinlik kaydı + Telegram bildirimi
const { run, setting } = require('./db');

const queue = [];
let busy = false;

async function sendTelegram(text, { token = setting('tg_token'), chat = setting('tg_chat') } = {}) {
  if (!token || !chat) throw new Error('Telegram bot token / chat id girilmemiş');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('Telegram: ' + (j.description || r.status));
}

async function pump() {
  if (busy) return; busy = true;
  while (queue.length) {
    const text = queue.shift();
    try { await sendTelegram(text); } catch (e) { console.error(e.message); }
    await new Promise(r => setTimeout(r, 1200)); // Telegram grup limiti ~20 msg/dk
  }
  busy = false;
}

const escH = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// type: found | sent | reply | job | limit | error | info
const ICON = { found: '🔎', sent: '📤', reply: '💬', job: '✅', limit: '⏳', error: '⚠️', info: 'ℹ️', company: '🏭' };

function event(type, text, campaign_id = null) {
  run('INSERT INTO events(type,text,campaign_id) VALUES(?,?,?)', type, text, campaign_id);
  const off = (setting('tg_mute') || '').split(',');
  if (setting('tg_token') && setting('tg_chat') && !off.includes(type)) { queue.push(`${ICON[type] || '•'} <b>Lead-AI</b>\n${escH(text)}`); pump(); }
}

async function sendPhoto(buf, caption) {
  const token = setting('tg_token'), chat = setting('tg_chat'); if (!token || !chat) return;
  const fd = new FormData(); fd.append('chat_id', chat); fd.append('caption', caption); fd.append('parse_mode', 'HTML');
  fd.append('photo', new Blob([buf], { type: 'image/jpeg' }), 'icerik.jpg');
  const j = await (await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd })).json().catch(() => ({}));
  if (!j.ok) throw new Error('Telegram foto: ' + (j.description || ''));
}

module.exports = { event, sendTelegram, sendPhoto, escH };
