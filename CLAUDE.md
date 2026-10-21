# emre-lead — lead.hypevisionlab.com

Hype Vision'ın satış/lead platformu: hedef firma bul (OpenAI + web araması) → firmadaki kişileri bul (RocketReach) → mail çıkar/doğrula → AI ile kişiye özel mail yaz → Gmail/SMTP kuyruğuyla zamanlı gönder → yanıtları IMAP ile yakala → Telegram bildirimi. Ek modüller: içerik/Instagram, blog yayını (GitHub), Meta Ads, toplantı rezervasyonu, sinyal taraması, takip masası, autopilot.

## Yerel
- Bu klasör (`C:\Users\Fahrihan\Desktop\rocketreach`) = sunucudaki `/opt/emre-lead/app`. Git repo burada, sunucuda git yok.
- `npm run dev` → http://localhost:8090 (Node 22.13+, yerleşik `node:sqlite`). Ayarlar `.env` (bkz. `.env.example`) veya arayüzde Entegrasyonlar.
- Tek dosya backend: `server.js` (Express 5, tüm `/api/*` rotaları). Frontend: `public/index.html` + `public/app.js` (vanilla JS SPA).
- `lib/`: `db.js` (SQLite şema + yardımcılar), `ai.js` (OpenAI), `rr.js` (RocketReach), `worker.js` (iş kuyruğu/Excel), `mailer.js` (gönderim kuyruğu), `inbox.js` (yanıtlar), `notify.js` (olay + Telegram), `autopilot.js`, `warmup.js`, `verify.js`/`smtpverify.js`/`emailguess.js` (mail doğrulama/tahmin), `content.js`, `blog.js`/`blogpub.js`, `metaads.js`, `booking.js`, `osb.js`, `insights.js`, `results.js`, `health.js`, `detector.js` (onnx).
- İş kuralları (commit geçmişinden): görüntü işleme/yapay zeka/yazılım/bilişim firmalarına soğuk mail gitmez; mail metinlerinde yüzde/doğruluk/ms gibi rakamlı iddia yok; toplantı maili gün/saat önermez.

## Sunucu (104.249.19.177, SSH port 25416, root, anahtarla giriş)
- Kod: `/opt/emre-lead/app` · Veri: `/opt/emre-lead/data` (app.db) · Yedekler: `app.old`, `app.bak-*`
- Servis: `emre-lead.service` (systemd, `node server.js`, port 8090) → nginx `lead.hypevisionlab.com` proxy.
- Deploy: değişen dosyaları scp ile `/opt/emre-lead/app`'e kopyala (sahip `emrelead`), `systemctl restart emre-lead`, `journalctl -u emre-lead -n 50`.
- 2026-10-21 itibarıyla yerel kod sunucudan ileride (11 dosya farklı: ai, db, emailguess, notify, osb, results, rr, smtpverify, verify, public/app.js…). Deploy etmeden önce kontrol et.

## Aynı sunucudaki diğer projeler
- task.hypevisionlab.com → `/opt/hype-task`, yerel: `Desktophype-task` (bkz. CLAUDE.md orada)
- Hype Live → `/opt/hype-live/template`, yerel: `Desktophype-live`
- Ayrıca: `orbisoft-api` (app.orbisoft.com.tr), Docker'da `parca-ai` (parca.hypevisionlab.com, :3010) ve `evolution` (WhatsApp API, :8099).
