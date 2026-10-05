# emre-lead

Hedef firma bul (OpenAI + web araması) → firmada kişileri bul (RocketReach) → mailini çıkar → AI ile kişiye özel mail yaz → Gmail üzerinden zamanlı kuyrukla gönder. Telegram'a bildirim atar, yanıtları gelen kutusundan yakalar.

## Çalıştırma

```bash
cp .env.example .env   # anahtarları doldur (ya da sonra arayüzden Entegrasyonlar sayfasından gir)
npm install
npm run dev            # http://localhost:8090  (varsayılan giriş: emre / emre)
```

Node 22.13+ gerekir (yerleşik `node:sqlite`). Veriler `data/app.db` içinde.

## Modüller
- `lib/ai.js` — şirket profili, kampanya hedefleme, firma bulma, mail taslağı (OpenAI Responses + web_search)
- `lib/rr.js` — RocketReach arama/lookup, saatlik limit paylaşımı
- `lib/worker.js` — arka plan iş kuyruğu + Excel toplu işleri (limit dolunca bekler, kendiliğinden devam eder)
- `lib/mailer.js` — Gmail SMTP kuyruğu (gün/saat penceresi, günlük limit, rastgele bekleme, takip mailleri), IMAP yanıt takibi
- `lib/notify.js` — olay kaydı + Telegram
