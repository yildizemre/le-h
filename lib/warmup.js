// Isınma (warm-up): kendi kutularımız birbirine doğal iş mailleri atar; alan kutu okur, yıldızlar, "önemli" işaretler,
// spam'e düştüyse gelen kutusuna taşır ve bir kısmını yanıtlar. Böylece Gmail kutuyu "gerçek kişi" olarak tanır.
// Aynı zamanda her kutunun maillerinin gelen kutusuna mı spam'e mi düştüğü ölçülür (sağlık skoru buna dayanır).
// Kural: ısınmanın ilk 7 günü kutudan hiç soğuk mail gitmez, 8-14. günler en fazla 5; sonra normal ısınma rampası.
const { ImapFlow } = require('imapflow');
const { all, get, run, setting } = require('./db');
const { event } = require('./notify');

const pick = a => a[Math.floor(Math.random() * a.length)];
const SUBJ = ['Yarınki toplantı', 'Haftalık plan', 'Teklif dosyası hakkında', 'Kısa bir soru', 'Rapor taslağı', 'Pazartesi görüşmesi', 'Sunum notları', 'Müşteri ziyareti',
  'Fatura detayı', 'Proje takvimi', 'Saha ziyareti planı', 'Toplantı notları', 'Revize dosya', 'Ekip toplantısı', 'Bilgi notu', 'Demo hazırlığı', 'Kamera listesi',
  'Pilot süreci', 'Takvim güncellemesi', 'Öğle arası', 'Ziyaret sonrası', 'Bugünkü görüşme', 'Dosya kontrolü', 'Ayın özeti', 'Yeni hafta'];
const OPEN = ['Merhaba {ad},', 'Selam {ad},', 'Günaydın {ad},', 'Merhaba {ad} Bey/Hanım,', 'İyi günler {ad},', '{ad} merhaba,'];
const MID = [
  'Dünkü görüşmenin notlarını derledim, akşama kadar paylaşırım.', 'Yarınki toplantıyı 14:00\'e alabilir miyiz? Sabah saha ziyaretim var.',
  'Teklif dosyasının son halini kontrol ettim, iki küçük düzeltme dışında hazır görünüyor.', 'Müşteri tarafından geri dönüş geldi, detayları yarın konuşalım.',
  'Haftalık planı güncelledim, perşembe gününü ziyaretlere ayırdım.', 'Sunumdaki rakamları bir kez daha kontrol eder misin?', 'Pilot için kamera listesini çıkardım, toplam 6 kamera görünüyor.',
  'Raporu inceledim, genel olarak gayet iyi. Sadece özet kısmını biraz kısaltabiliriz.', 'Önümüzdeki hafta Gebze tarafında iki ziyaret planlıyorum.',
  'Dosyayı ortak klasöre yükledim, uygun olduğunda bakarsın.', 'Toplantı odasını 15:00 için ayırdım.', 'Demo için örnek görüntüleri hazırladım, istersen yarın birlikte bakalım.',
  'Takvimde salı öğleden sonra boş görünüyor, o saat uygun mu?', 'Fatura bilgilerini muhasebeye ilettim, bu hafta içinde dönüş yaparlar.',
  'Saha ziyaretinden sonra kısa bir not düşerim.', 'Geçen haftaki maliyet tablosunu güncelledim.', 'Ekip toplantısını cuma sabahına çekebilir miyiz?'];
const ASK = ['Senin için uygun mu?', 'Ne düşünürsün?', 'Bir göz atabilir misin?', 'Dönüşünü bekliyorum.', 'Uygun olduğunda haber verirsin.', 'Ekleyeceğin bir şey var mı?', ''];
const CLOSE = ['Teşekkürler,', 'Kolay gelsin,', 'Görüşmek üzere,', 'İyi çalışmalar,', 'Sevgiler,', 'Saygılarımla,'];
const REPLY = ['Tamam, uygun. Teşekkürler.', 'Baktım, gayet iyi görünüyor.', 'Olur, o saatte görüşelim.', 'Teşekkürler, aldım. Akşama dönüş yaparım.', 'Harika, eline sağlık.',
  'Anlaştık, takvime ekliyorum.', 'Bir iki noktayı yarın konuşalım, genel olarak iyi.', 'Tamamdır, bilgi için teşekkürler.', 'Süper, ben de notlarımı eklerim.', 'Evet, uygun görünüyor.'];
const first = n => String(n || '').trim().split(/\s+/)[0] || '';

function compose(from, to) {
  const ad = first(to.name) || to.email.split(/[.@]/)[0];
  const body = [pick(OPEN).replace('{ad}', ad.charAt(0).toUpperCase() + ad.slice(1)), [pick(MID), Math.random() < .5 ? pick(MID) : '', pick(ASK)].filter(Boolean).join(' '), `${pick(CLOSE)}\n${first(from.name) || from.email.split('@')[0]}`].join('\n\n');
  return { subject: pick(SUBJ), text: body };
}

const DAY = 864e5;
const dayOf = s => s.warmup_start ? Math.floor((Date.now() - Date.parse(s.warmup_start)) / DAY) : 999;
const inWarmup = s => !!s.warmup_on && dayOf(s) < 14;
// Isınmada soğuk mail üst sınırı: 0-6. gün 0, 7-13. gün 5, sonrası sınırsız (diğer kurallar geçerli)
function coldCap(s) { if (!s.warmup_on || !s.warmup_start) return Infinity; const d = dayOf(s); return d < 7 ? 0 : d < 14 ? 5 : Infinity; }
// Günlük ısınma maili hedefi: 2'den başlar her gün +1 (en çok 12), 14 günden sonra bakım: günde 3
const target = s => !s.warmup_on ? 0 : dayOf(s) < 14 ? Math.min(12, 2 + dayOf(s)) : 3;
const pool = () => all('SELECT * FROM senders WHERE active=1 AND warmup_on=1 ORDER BY id');
const sentTodayWarm = id => get("SELECT count(*) n FROM warmup_mails WHERE from_id=? AND depth=0 AND sent_at>=?", id, new Date(new Date().setHours(0, 0, 0, 0)).toISOString()).n;

const nextAt = {};
let sending = false;
async function sendTick() {
  if (sending || setting('warmup_paused') === '1') return; sending = true;
  try {
    const mailer = require('./mailer');
    const h = mailer.nowTR().hour; if (h < 8 || h >= 20) return; // gece gönderme
    const ps = pool(); if (ps.length < 2) return;
    for (const s of ps) {
      if (Date.now() < (nextAt[s.id] || 0)) continue;
      const left = target(s) - sentTodayWarm(s.id); if (left <= 0) continue;
      const to = pick(ps.filter(x => x.id !== s.id));
      const m = compose(s, to);
      try {
        const { t, from } = mailer.transportFor(s);
        const info = await t.sendMail({ from, to: to.email, subject: m.subject, text: m.text });
        run('INSERT OR IGNORE INTO warmup_mails(from_id,to_id,message_id,depth,subject,sent_at) VALUES(?,?,?,0,?,?)', s.id, to.id, info.messageId, m.subject, new Date().toISOString());
      } catch (e) { console.error('warmup send', s.email, e.message); }
      // kalan hedefi günün kalanına yay (20:00'ye kadar), ±%50 sapma
      const end = new Date(); end.setHours(17, 0, 0, 0); // sunucu UTC: 17:00 UTC = 20:00 TR
      nextAt[s.id] = Date.now() + Math.max(15 * 60e3, (end - Date.now()) / Math.max(1, left) * (0.5 + Math.random()));
      break; // tur başına tek mail
    }
  } finally { sending = false; }
}

// Alıcı tarafı: gelen kutusu + spam klasöründe ısınma maillerini bul, spam'den kurtar, okundu + yıldız + önemli, bir kısmını yanıtla
let checking = false;
async function processSender(s) {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: s.email, pass: s.pass }, logger: false });
  const replies = [];
  try {
    await client.connect();
    const boxes = await client.list();
    const spamBox = boxes.find(b => b.specialUse === '\\Junk')?.path || '[Gmail]/Spam';
    for (const [path, where] of [[spamBox, 'spam'], ['INBOX', 'gelen kutusu']]) {
      let lock; try { lock = await client.getMailboxLock(path); } catch { continue; }
      try {
        const uids = (await client.search({ since: new Date(Date.now() - 4 * DAY) }, { uid: true })) || [];
        if (!uids.length) continue;
        const found = [];
        for await (const m of client.fetch(uids.join(','), { envelope: true, uid: true }, { uid: true })) {
          const w = m.envelope?.messageId && get("SELECT * FROM warmup_mails WHERE message_id=? AND to_id=? AND state='gönderildi'", m.envelope.messageId, s.id);
          if (w) found.push({ uid: m.uid, w });
        }
        for (const { uid, w } of found) {
          run("UPDATE warmup_mails SET state=?, checked_at=? WHERE id=?", where, new Date().toISOString(), w.id);
          try { await client.messageFlagsAdd(String(uid), ['\\Seen', '\\Flagged'], { uid: true }); } catch {}
          try { await client.messageFlagsAdd(String(uid), ['\\Important'], { uid: true, useLabels: true }); } catch {}
          if (where === 'spam') { try { await client.messageMove(String(uid), 'INBOX', { uid: true }); } catch {} }
          if (w.depth < 2 && Math.random() < 0.45) replies.push(w);
        }
      } finally { lock.release(); }
    }
    await client.logout();
  } catch (e) { console.error('warmup imap', s.email, e.message); try { await client.logout(); } catch {} }
  // yanıtlar (aynı zincirde)
  const mailer = require('./mailer');
  for (const w of replies) {
    const to = get('SELECT * FROM senders WHERE id=?', w.from_id); if (!to?.active) continue;
    try {
      const { t, from } = mailer.transportFor(s);
      const info = await t.sendMail({ from, to: to.email, subject: /^re:/i.test(w.subject) ? w.subject : 'Re: ' + w.subject, text: pick(REPLY) + '\n\n' + (first(s.name) || ''),
        inReplyTo: w.message_id, references: [w.message_id] });
      run('INSERT OR IGNORE INTO warmup_mails(from_id,to_id,message_id,root_id,depth,subject,sent_at) VALUES(?,?,?,?,?,?,?)', s.id, to.id, info.messageId, w.root_id || w.id, w.depth + 1, w.subject, new Date().toISOString());
      run("UPDATE warmup_mails SET state='yanıtlandı' WHERE id=? AND state='gelen kutusu'", w.id);
      await new Promise(r => setTimeout(r, 20000 + Math.random() * 40000));
    } catch (e) { console.error('warmup reply', e.message); }
  }
}
async function checkTick() {
  if (checking) return; checking = true;
  try { for (const s of pool()) await processSender(s); } finally { checking = false; }
}

// Kutu başı ısınma istatistiği (son 14 gün): gönderilen, kontrol edilen, spam'e düşen, yerleşim oranı
function stats(id) {
  const since = new Date(Date.now() - 14 * DAY).toISOString();
  const r = get(`SELECT count(*) sent, sum(state<>'gönderildi') checked, sum(state='spam') spam FROM warmup_mails WHERE from_id=? AND sent_at>=?`, id, since);
  const today = sentTodayWarm(id);
  return { sent: r.sent || 0, checked: r.checked || 0, spam: r.spam || 0, inbox: r.checked ? Math.round((r.checked - r.spam) / r.checked * 100) : null, today };
}

function start() {
  // ısınma bilgisi olmayan aktif kutular: bugünden itibaren 14 günlük ısınmaya alınır (yeni kutular için de geçerli)
  for (const s of all('SELECT id FROM senders WHERE warmup_start IS NULL')) run('UPDATE senders SET warmup_start=?, warmup_on=1 WHERE id=?', new Date().toISOString(), s.id);
  setInterval(sendTick, 3 * 60e3); setTimeout(sendTick, 30e3);
  setInterval(checkTick, 12 * 60e3); setTimeout(checkTick, 90e3);
}

module.exports = { start, sendTick, checkTick, stats, dayOf, inWarmup, coldCap, target, pool };
