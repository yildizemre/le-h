// Yurt dışı (global) İngilizce şablon seti — hypevisionlab.com/en dilinden türetildi (2026-10).
// Değişkenler: {{ad}} {{soyad}} {{adsoyad}} {{sirket}} {{unvan}} {{gonderen}} · {{kisisel}} = AI'ın bulduğu kişiye özel ilk cümle
// Kurallar: kısa, link yok (imzada var), rakamlı iddia yok, gün/saat önerme yok; tek istek: 15–20 dk online sunum (ekran paylaşımlı demo).
module.exports = [
  {
    name: 'EN · Safety · PPE & restricted zones (manufacturing)',
    subject: 'PPE checks at {{sirket}}',
    body: `Hi {{ad}},

{{kisisel}}

On most shift-based sites, PPE and restricted-area checks still depend on someone walking the floor, so whatever happens between rounds goes unseen.

Hype Vision closes that gap with the IP cameras you already have. Our AI software runs on top of your existing CCTV and flags, in real time:

- missing hard hats, vests or gloves
- people entering restricted or hazardous zones
- blocked emergency exits

No new cameras or cabling, no facial recognition, and with an on-premise setup the video never leaves your building.

I'd be glad to show you in a short 15–20 minute online presentation what this would look like on cameras like yours. Would you be open to a call at a time that suits you?

If this isn't your area, I'd appreciate a pointer to the right person.

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Safety · Forklift–pedestrian (warehouse/logistics)',
    subject: 'Forklift near misses',
    body: `Hi {{ad}},

{{kisisel}}

Forklifts and pedestrians sharing the same aisles remain one of the most serious risks in warehouses and shipping areas — and near misses are rarely reported, so the pattern stays invisible until something happens.

Hype Vision uses your existing cameras to:

- alert the moment a forklift and a person get too close
- catch blind-spot and walkway violations
- map where near misses happen most, so routes and layouts can be fixed with data

It works on your current CCTV (RTSP/ONVIF), with no extra hardware and no identification of individuals.

Could I show you how it works in a quick 15–20 minute online demo? Happy to fit around your schedule.

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Productivity · Downtime & OEE (plant/production manager)',
    subject: 'Line stoppages at {{sirket}}',
    body: `Hi {{ad}},

{{kisisel}}

When downtime is still written on a form at the end of the shift, the most common stoppage reason is usually a best guess.

Hype Vision measures it directly from the cameras you already have:

- detects automatically when a line or station stops
- shows idle time and cycle time per station, second by second
- highlights the bottleneck, feeding the availability side of OEE

Reports are per station, not per person ("station 3 was idle this morning"), which keeps the shop floor on board.

Would you be open to a 15–20 minute online presentation where we walk through a sample analysis on a line like yours?

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Quality · Visual inspection on the line',
    subject: 'From sampling to full inspection',
    body: `Hi {{ad}},

{{kisisel}}

If quality checks on your lines are sample-based, most of the defects that reach customers come from the parts nobody looked at.

Hype Vision inspects every unit on the line with cameras and AI:

- surface defects such as scratches, cracks, dents and rust
- missing parts and assembly errors
- label, print and fill-level checks, with a reject signal to the line

If you don't have many defect samples, we can start with an anomaly model trained only on good products.

I'd be happy to show you live in a short 15–20 minute online demo. Is there a time that works for you?

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Food & beverage · Hygiene and line checks',
    subject: 'Hygiene compliance on your lines',
    body: `Hi {{ad}},

{{kisisel}}

In food production, hygiene rules and line checks are only as good as the last audit.

With the cameras {{sirket}} already has, Hype Vision can continuously check:

- hairnets, masks, gloves and protective clothing in hygiene zones
- product counting and grading on the conveyor
- line idle time between batches

Everything runs on your existing CCTV, can stay fully on-premise, and does not use facial recognition.

Would a 15–20 minute online presentation be useful to see what this looks like in a plant like yours?

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Executive · General / plant manager overview',
    subject: 'Your cameras, as live plant data',
    body: `Hi {{ad}},

{{kisisel}}

Most plants already have dozens of cameras, but they are only watched after something goes wrong.

Hype Vision turns that existing CCTV into live operational data on a single screen, from one station up to every site:

- Safety: PPE, restricted zones, forklift–pedestrian proximity
- Productivity: line stoppages, idle and cycle time per station
- Quality: visual inspection and counting on the line

There are no new cameras or cabling, and it can run fully on-premise. You can also ask our assistant questions in plain language, such as "which line was idle the most this week?", and get the answer with video evidence.

I'd welcome the chance to give you a 15–20 minute online presentation. Would you be open to a call at a time that suits you?

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Chemical & process plants · Hazardous areas',
    subject: 'Hazardous area monitoring',
    body: `Hi {{ad}},

{{kisisel}}

In chemical and process plants, the riskiest moments are often in areas that are hard to supervise around the clock.

Hype Vision adds a 24/7 AI layer to your existing cameras:

- restricted and danger-zone entry
- PPE compliance, including masks and protective suits
- early smoke and leak indications, plus 5S checks

Every event is logged with video evidence, and the system can run entirely on-premise.

Could I show you how this works in a short 15–20 minute online demo?

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Partnership · Integrators / safety consultancies',
    subject: 'Something to add to your offering',
    body: `Hi {{ad}},

{{kisisel}}

{{sirket}} already works with industrial sites that have cameras installed. We'd like to explore a partnership where you offer our AI video analytics on top of that infrastructure.

Hype Vision analyses existing CCTV for safety (PPE, restricted zones, forklift–pedestrian), productivity (downtime, idle time) and quality. For partners, that means:

- recurring revenue on projects you already deliver
- white-label option and partner pricing
- demo, technical setup and support from our side

I'd be glad to walk you through the partner model and a live demo in a 20-minute online call. Would that be of interest?

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Short intro (any role)',
    subject: 'Quick question',
    body: `Hi {{ad}},

{{kisisel}}

Quick question: is anyone at {{sirket}} using your existing cameras for more than security recordings?

We help manufacturers turn their current CCTV into real-time alerts and reports for workplace safety, line downtime and quality — with no new hardware and no facial recognition.

If it's relevant, I'd be happy to show you in a 15–20 minute online presentation. If not, just let me know.

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Follow-up 1 · New angle',
    subject: 'Re: previous email',
    body: `Hi {{ad}},

A quick follow-up to my last note. One thing teams often find useful: every alert comes with the video clip, so investigations and audits rely on evidence instead of memory.

If a short online demo would be helpful, I'm happy to find a time that suits you.

Best regards,
{{gonderen}}`,
  },
  {
    name: 'EN · Follow-up 2 · Close the loop',
    subject: 'Re: previous email',
    body: `Hi {{ad}},

I don't want to fill your inbox, so this will be my last note for now.

If improving safety or production visibility with your existing cameras becomes a priority at {{sirket}}, just reply to this email and I'll set up a short online presentation.

Best regards,
{{gonderen}}`,
  },
];
