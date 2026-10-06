// Hype Vision ürün kataloğundan (2026.07) türetilmiş hazır mail şablonları.
// Değişkenler: {{ad}} {{soyad}} {{adsoyad}} {{sirket}} {{unvan}} {{gonderen}}
// Kurallar: kısa, link yok (imzada var), tek net istek: 20 dk'lık görüşme.
module.exports = [
  {
    name: 'İSG · KKD ve alan ihlali (genel imalat)',
    subject: '{{sirket}} sahasında KKD denetimi',
    body: `Sayın {{adsoyad}},

{{sirket}} gibi vardiyalı çalışan tesislerde İSG uzmanının sahada gözle yaptığı KKD ve yasak alan denetimi, tur dışındaki saatleri kaçırıyor. Biz bu boşluğu mevcut IP kameralarınızla kapatıyoruz.

Hype Vision; baret, yelek, eldiven gibi KKD eksiklerini, yasak alan ihlallerini ve acil çıkış önlerinin kapatılmasını 7/24 tespit edip anında uyarı veren bir yazılım katmanı. Yeni kamera ya da kablo gerekmiyor, yüz tanıma kullanılmıyor; görüntü isterseniz tesisinizden hiç çıkmıyor.

Sahada ölçtüğümüz doğruluk alan ihlalinde %94–97, KKD'de %88–96. Abartmıyoruz, her modül için gerçek aralığı yazıyoruz.

Size uygun bir günde 20 dakikalık bir görüşmede, kendi kameralarınızdan birkaç örnek kayıt üzerinden neyin çalışıp neyin çalışmayacağını gösterebiliriz. Bu hafta ya da gelecek hafta hangi gün uygun olur?

Saygılarımla,
{{gonderen}}`,
  },
  {
    name: 'İSG · Forklift–yaya yakınlaşma (depo/lojistik)',
    subject: 'Forklift–yaya yakınlaşmasını kameradan yakalamak',
    body: `Sayın {{adsoyad}},

Depo ve sevkiyat alanlarında ölümlü kazaların başında forklift ile yayanın aynı koridorda karşılaşması geliyor. {{sirket}} için bunu mevcut kameralarınızla önceden görünür kılabiliriz.

Hype Vision, yaya ile iş makinesi arasındaki mesafe güvenli sınırın altına indiğinde ve kör nokta ihlallerinde anında uyarı veriyor; yakınlaşmaların en sık yaşandığı noktaları da haritalayarak rota ve yerleşim iyileştirmesine veri sağlıyor. Ek donanım veya kamera değişimi gerekmiyor, kimlik tespiti yapılmıyor.

4 kamera ve 1–2 modülle 30 günlük ölçümlü bir pilotla başlıyoruz; kabul kriteri baştan yazılı belirleniyor, karşılanmazsa devam yükümlülüğünüz olmuyor.

Size uygun bir vakitte 20 dakikalık kısa bir görüşmede nasıl çalıştığını anlatmak isterim. Hangi gün ve saat sizin için uygun?

Saygılarımla,
{{gonderen}}`,
  },
  {
    name: 'Verimlilik · Hat duruşu ve OEE (üretim müdürü)',
    subject: '{{sirket}} hatlarında duruş sebepleri',
    body: `Sayın {{adsoyad}},

Duruş kayıtları hâlâ vardiya sonunda forma elle yazılıyorsa, en sık duruş sebebi genellikle tahmin ediliyor demektir. Bunu {{sirket}} için mevcut kameralarınızdan ölçebiliriz.

Hype Vision; hattın durduğu anı otomatik yakalıyor, sebebini (malzeme bekleme, operatör yok, arıza, ayar) sınıflandırıyor, istasyon bazlı boşta kalma ve çevrim süresini kimlik tespiti yapmadan raporluyor. Darboğaz otomatik işaretleniyor, OEE kullanılabilirlik bileşeni doğrudan çıkıyor. Duruş tespitinde sahada ölçtüğümüz doğruluk %93–97.

Personel tarafında da direnç oluşmuyor: rapor "3 numaralı istasyonda 14 dakika boşta kalma" şeklinde, kişi bazlı değil.

Size uygun bir günde 20 dakikalık bir görüşmede bir hattınız üzerinden örnek bir analiz göstermek isterim. Hangi zaman uygun olur?

Saygılarımla,
{{gonderen}}`,
  },
  {
    name: 'Kalite · Yüzey kusuru ve %100 kontrol',
    subject: 'Numune kontrolünden %100 kontrole',
    body: `Sayın {{adsoyad}},

{{sirket}} hattında kalite kontrol numune bazlı yapılıyorsa, müşteriye giden kusurun büyük kısmı kontrol edilmeyen parçalardan çıkıyor.

Hype Vision; çizik, çatlak, ezik, pas, kaynak dikişi, eksik parça, etiket/OCR ve dolum seviyesi gibi kontrolleri hat üzerinde %100 yapıyor ve ayıklama (reject) sinyali veriyor. Yeterli kusurlu örneğiniz yoksa sadece sağlam ürün görüntüleriyle eğitilen anomali modeliyle az veriyle devreye alıyoruz. Sahada ölçtüğümüz aralık %92–97.

Kusur tipi bazlı istatistik ve zaman damgalı görüntü arşivi de kök neden analizini hızlandırıyor.

Size uygun bir vakitte 20 dakikalık bir görüşmede ürününüzden birkaç örnekle neyin mümkün olduğunu konuşabilir miyiz? Bu hafta veya gelecek hafta hangi gün uygun?

Saygılarımla,
{{gonderen}}`,
  },
  {
    name: 'Gıda · Hijyen uyumu ve dolum kontrolü',
    subject: '{{sirket}} için hijyen ve dolum kontrolü',
    body: `Sayın {{adsoyad}},

Gıda tesislerinde denetimlerde en sık çıkan iki konu hijyen ekipmanı uyumu (bone, eldiven, önlük) ve hat sonunda dolum/kapak hataları. İkisini de {{sirket}}'in mevcut kameralarıyla sürekli izleyebiliriz.

Hype Vision; hijyen bölgelerinde ekipman eksiklerini, yasak alan girişlerini ve kayma/düşme olaylarını anında bildiriyor; hat tarafında dolum seviyesi, ambalaj bütünlüğü ve etiket doğrulamasını %100 kontrol ediyor. Yüz tanıma yok, görüntü isterseniz tesisinizden çıkmıyor.

30 günlük, kabul kriteri baştan yazılı bir pilotla başlıyoruz.

Size uygun bir günde 20 dakikalık bir görüşmede nasıl çalıştığını anlatmak isterim. Hangi gün uygun olur?

Saygılarımla,
{{gonderen}}`,
  },
  {
    name: 'Genel · Ücretsiz kamera uygunluk ön değerlendirmesi',
    subject: 'Mevcut kameralarınız neler yapabilir?',
    body: `Sayın {{adsoyad}},

{{sirket}} tesisinde zaten kurulu olan güvenlik kameraları çoğu zaman sadece kayıt için kullanılıyor. Aynı görüntüden İSG ihlali, hat duruşu, kalite hatası ve depo doluluğu gibi ölçümler çıkarılabiliyor.

Hype Vision olarak 102 modüllük bir katalogla çalışıyoruz; ama önemli olan size uyan 3–5 modül. Bunu belirlemek için ücretsiz bir ön değerlendirme yapıyoruz: birkaç örnek kamera kaydınızı inceleyip üç iş günü içinde hangi kameranın hangi modüle uygun olduğunu yazılı olarak iletiyoruz.

Kamera değişimi gerekmiyor, yüz tanıma kullanılmıyor, sistem mevcut NVR kayıt düzeninize dokunmuyor.

Size uygun bir vakitte 20 dakikalık bir görüşmede süreci anlatayım; hangi gün ve saat uygun olur?

Saygılarımla,
{{gonderen}}`,
  },
  {
    name: 'Üst yönetim · Genel müdür / fabrika müdürü',
    subject: '{{sirket}} için kameralardan ölçülebilir veri',
    body: `Sayın {{adsoyad}},

Kısa yazacağım. Hype Vision, tesislerdeki mevcut IP kameraları İSG, verimlilik ve kalite için ölçüm aracına çeviren bir yapay zeka yazılımı. GTÜ Teknopark'tayız.

{{sirket}} için üç somut fayda görüyorum:
- KKD ve yasak alan ihlallerinin 7/24, kanıtlı kaydı (denetimde en sık yazılan uygunsuzluklar),
- hat duruşu ve boşta kalma sürelerinin elle değil ölçümle raporlanması,
- tek hatta 30 günlük pilot: kabul kriteri baştan yazılı, karşılanmazsa devam yükümlülüğü yok.

Yeni donanım yatırımı gerekmiyor; kamera ve modül bazlı lisanslanıyor.

Size uygun bir günde 20 dakikalık bir görüşmede ekibinizle birlikte nereden başlanacağını konuşmak isterim. Hangi zaman uygun olur?

Saygılarımla,
{{gonderen}}`,
  },
  {
    name: 'Çözüm ortaklığı · OSGB / İSG danışmanlık',
    subject: 'OSGB hizmetinize ekleyebileceğiniz bir kalem',
    body: `Sayın {{adsoyad}},

{{sirket}}'in müşterilerine sunduğu İSG hizmetine, sahadaki KKD ve alan denetimini 7/24 sürekli hale getiren bir kalem eklemeyi önermek istiyorum.

Hype Vision, müşterinizin mevcut kameralarıyla çalışan bir görüntü analizi yazılımı. Yazılım ya da teknik ekip gerekmiyor: isterseniz müşteriyi tanıştırıyorsunuz, süreci biz yürütüyoruz ve kapanan işten yönlendirme payı alıyorsunuz; isterseniz iş ortağı iskontosuyla kendiniz satıyorsunuz. Demo hesabı, sunum/teklif şablonları, ortak müşteri ziyareti ve KVKK dokümantasyon desteği bizden.

Rekabette sizi ayrıştıran, mevcut sözleşmenizin üzerine eklenen bir hizmet oluyor.

Size uygun bir vakitte 20 dakikalık bir görüşmede modeli anlatmak isterim. Hangi gün uygun olur?

Saygılarımla,
{{gonderen}}`,
  },
  {
    name: 'Otel / restoran · Doluluk ve servis süresi',
    subject: '{{sirket}} için servis süresi ve doluluk verisi',
    body: `Sayın {{adsoyad}},

Restoran ve otel operasyonunda masa devir süresi, sipariş–servis arası bekleme ve mutfak hijyen uyumu genellikle hissiyatla yönetiliyor. Bunları {{sirket}}'in mevcut kameralarından kimlik tespiti yapmadan ölçebiliriz.

Hype Vision; masa doluluğu ve devir süresini, oturma → sipariş → servis sürelerini, mutfak hijyen ekipmanı uyumunu ve ortak alan/otopark doluluğunu raporluyor. Yeni donanım gerekmiyor, misafir ve personel tanınmıyor.

Size uygun bir günde 20 dakikalık bir görüşmede bir şubeniz üzerinden örnek rapor göstermek isterim. Hangi zaman uygun olur?

Saygılarımla,
{{gonderen}}`,
  },
  {
    name: 'Takip · Kısa hatırlatma',
    subject: 'Re: önceki mailim',
    body: `Sayın {{adsoyad}},

Geçen hafta yazdığım maili yoğunlukta kaçırmış olabileceğinizi düşünerek kısaca hatırlatmak istedim.

Mevcut kameralarınızla İSG ihlallerini ve hat duruşlarını ölçmenin {{sirket}} için anlamlı olup olmadığını 20 dakikada netleştirebiliriz; uygun değilse bunu da açıkça söylüyoruz.

Bu konuyla ilgilenen doğru kişi siz değilseniz, kime yazmamı önerirsiniz?

Saygılarımla,
{{gonderen}}`,
  },
  {
    name: 'EN · Safety & PPE on existing cameras',
    subject: 'PPE and restricted-area alerts at {{sirket}}',
    body: `Hi {{ad}},

Safety walk-arounds only cover the minutes an inspector is on the floor. At {{sirket}} we could cover the rest of the shift with the IP cameras you already have.

Hype Vision is a computer vision layer that detects missing PPE, restricted-area entries, forklift–pedestrian near misses and blocked emergency exits in real time. No new cameras, no facial recognition, and with an on-site server the video never leaves your plant. We publish real field accuracy ranges per module (e.g. 94–97% for zone violations) instead of "99%" claims.

We usually start with a 30-day pilot on 4 cameras, with written acceptance criteria agreed up front.

Would you be open to a 20-minute call at a time that suits you? Happy to walk through a few sample clips from your own cameras.

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Downtime & OEE for plant managers',
    subject: 'Measuring line downtime at {{sirket}}',
    body: `Hi {{ad}},

If downtime is still logged by hand at the end of a shift, the top stoppage reason is usually a best guess. We can measure it from the cameras {{sirket}} already has.

Hype Vision detects the moment a line stops, classifies why (waiting for material, no operator, breakdown, changeover), and reports idle and cycle time per station without identifying anyone. Bottlenecks are flagged automatically and the OEE availability component comes out directly.

Would a 20-minute call next week work for you? I can show a sample analysis on one of your lines.

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Follow-up',
    subject: 'Re: previous email',
    body: `Hi {{ad}},

Just bringing my previous note back to the top of your inbox.

In 20 minutes we can tell whether using your existing cameras for safety and downtime measurement makes sense for {{sirket}}, and we will say so plainly if it doesn't.

If you're not the right person for this, who would you suggest I reach out to?

Best regards,
{{gonderen}}`,
  },
];
