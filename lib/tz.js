// Alıcının saat dilimi: kişi konumu ("Lodz, PL", "Ohio, US", "Prague, Czechia"), kampanya coğrafyası ve mail uzantısından tahmin.
// Yurt dışı modunda mail, alıcının kendi mesai saatinde (schedule.start–end, yerel) gönderilir.
const C = { // ülke kodu → saat dilimi
  de: 'Europe/Berlin', at: 'Europe/Vienna', ch: 'Europe/Zurich', nl: 'Europe/Amsterdam', be: 'Europe/Brussels', lu: 'Europe/Luxembourg', fr: 'Europe/Paris',
  it: 'Europe/Rome', es: 'Europe/Madrid', pt: 'Europe/Lisbon', pl: 'Europe/Warsaw', cz: 'Europe/Prague', sk: 'Europe/Bratislava', hu: 'Europe/Budapest',
  ro: 'Europe/Bucharest', bg: 'Europe/Sofia', gr: 'Europe/Athens', si: 'Europe/Ljubljana', hr: 'Europe/Zagreb', rs: 'Europe/Belgrade', ba: 'Europe/Sarajevo',
  gb: 'Europe/London', uk: 'Europe/London', ie: 'Europe/Dublin', se: 'Europe/Stockholm', dk: 'Europe/Copenhagen', no: 'Europe/Oslo', fi: 'Europe/Helsinki',
  ee: 'Europe/Tallinn', lv: 'Europe/Riga', lt: 'Europe/Vilnius', ua: 'Europe/Kyiv', md: 'Europe/Chisinau',
  us: 'America/New_York', ca: 'America/Toronto', mx: 'America/Mexico_City', br: 'America/Sao_Paulo', ar: 'America/Argentina/Buenos_Aires', cl: 'America/Santiago', co: 'America/Bogota', pe: 'America/Lima',
  ae: 'Asia/Dubai', sa: 'Asia/Riyadh', qa: 'Asia/Qatar', kw: 'Asia/Kuwait', om: 'Asia/Muscat', bh: 'Asia/Bahrain', eg: 'Africa/Cairo', ma: 'Africa/Casablanca', za: 'Africa/Johannesburg',
  az: 'Asia/Baku', ge: 'Asia/Tbilisi', kz: 'Asia/Almaty', uz: 'Asia/Tashkent', iq: 'Asia/Baghdad', in: 'Asia/Kolkata', id: 'Asia/Jakarta', my: 'Asia/Kuala_Lumpur',
  sg: 'Asia/Singapore', th: 'Asia/Bangkok', vn: 'Asia/Ho_Chi_Minh', jp: 'Asia/Tokyo', kr: 'Asia/Seoul', cn: 'Asia/Shanghai', au: 'Australia/Sydney', nz: 'Pacific/Auckland', tr: 'Europe/Istanbul',
};
const NAMES = [ // ülke adı (İngilizce + Türkçe) → kod
  [/germany|almanya|deutschland/, 'de'], [/austria|avusturya/, 'at'], [/switzerland|isviçre|isvicre/, 'ch'], [/netherlands|holland|hollanda/, 'nl'], [/belgium|belçika|belcika/, 'be'],
  [/france|fransa/, 'fr'], [/italy|italya|i̇talya/, 'it'], [/spain|ispanya|i̇spanya/, 'es'], [/portugal|portekiz/, 'pt'], [/poland|polonya/, 'pl'], [/czech|çekya|cekya/, 'cz'],
  [/slovakia|slovakya/, 'sk'], [/hungary|macaristan/, 'hu'], [/romania|romanya/, 'ro'], [/bulgaria|bulgaristan/, 'bg'], [/greece|yunanistan/, 'gr'], [/slovenia/, 'si'], [/croatia|hırvatistan/, 'hr'], [/serbia|sırbistan/, 'rs'],
  [/united kingdom|england|scotland|wales|ingiltere|i̇ngiltere|\buk\b/, 'gb'], [/ireland|irlanda|i̇rlanda/, 'ie'], [/sweden|isveç|i̇sveç/, 'se'], [/denmark|danimarka/, 'dk'], [/norway|norveç/, 'no'], [/finland|finlandiya/, 'fi'],
  [/united states|\busa\b|abd|amerika/, 'us'], [/canada|kanada/, 'ca'], [/mexico|meksika/, 'mx'], [/brazil|brezilya/, 'br'], [/argentina|arjantin/, 'ar'], [/chile|şili/, 'cl'], [/colombia|kolombiya/, 'co'],
  [/emirates|\buae\b|bae|dubai|abu dhabi/, 'ae'], [/saudi|suudi/, 'sa'], [/qatar|katar/, 'qa'], [/egypt|mısır/, 'eg'], [/morocco|fas\b/, 'ma'], [/south africa|güney afrika/, 'za'],
  [/azerbaijan|azerbaycan/, 'az'], [/georgia|gürcistan/, 'ge'], [/kazakhstan|kazakistan/, 'kz'], [/uzbekistan|özbekistan/, 'uz'], [/iraq|irak/, 'iq'], [/india|hindistan/, 'in'],
  [/indonesia|endonezya/, 'id'], [/malaysia|malezya/, 'my'], [/singapore|singapur/, 'sg'], [/japan|japonya/, 'jp'], [/korea|kore/, 'kr'], [/china|çin\b/, 'cn'], [/australia|avustralya/, 'au'],
  [/turkey|türkiye|turkiye/, 'tr'],
];
// ABD/Kanada eyalete göre (RocketReach "City, ST, US" yazar)
const US = { pac: 'America/Los_Angeles', mtn: 'America/Denver', cen: 'America/Chicago', az: 'America/Phoenix' };
const US_ST = { ca: 'pac', wa: 'pac', or: 'pac', nv: 'pac', az: 'az', co: 'mtn', ut: 'mtn', nm: 'mtn', id: 'mtn', mt: 'mtn', wy: 'mtn',
  tx: 'cen', il: 'cen', wi: 'cen', mn: 'cen', mo: 'cen', ia: 'cen', ks: 'cen', ok: 'cen', ne: 'cen', ar: 'cen', la: 'cen', ms: 'cen', al: 'cen', tn: 'cen', nd: 'cen', sd: 'cen' };
const US_NAME = [[/california|washington state|oregon|nevada|seattle|los angeles|san francisco|san diego|san jose/, 'pac'], [/arizona|phoenix/, 'az'], [/colorado|utah|new mexico|idaho|montana|denver/, 'mtn'],
  [/texas|illinois|wisconsin|minnesota|missouri|iowa|kansas|oklahoma|nebraska|arkansas|louisiana|mississippi|alabama|tennessee|chicago|houston|dallas|austin|milwaukee/, 'cen']];
const CA_ST = { bc: 'America/Vancouver', ab: 'America/Edmonton', sk: 'America/Regina', mb: 'America/Winnipeg', ns: 'America/Halifax', nb: 'America/Moncton', nl: 'America/St_Johns' };

function tzOf(...texts) {
  const parts = texts.map(t => String(t || '').trim()).filter(Boolean);
  for (const raw of parts) {
    const s = raw.toLocaleLowerCase('tr'), seg = s.split(',').map(x => x.trim()).filter(Boolean), last = seg[seg.length - 1] || '';
    let cc = /^[a-z]{2}$/.test(last) && C[last] ? last : (NAMES.find(([re]) => re.test(s)) || [])[1];
    if (!cc) continue;
    if (cc === 'us') {
      const st = seg.length >= 3 ? seg[seg.length - 2] : '';
      const k = US_ST[st] || (US_NAME.find(([re]) => re.test(s)) || [])[1];
      return k ? US[k] : C.us;
    }
    if (cc === 'ca') { const st = seg.length >= 3 ? seg[seg.length - 2] : ''; return CA_ST[st] || (/british columbia|vancouver/.test(s) ? CA_ST.bc : /alberta|calgary|edmonton/.test(s) ? CA_ST.ab : C.ca); }
    return C[cc];
  }
  return null;
}
// Kişi için saat dilimi: önce kişi konumu, sonra kampanya coğrafyası, sonra mail/alan adı uzantısı
function tzFor(c, camp) {
  const tld = (String(c.email || c.to_email || '').split('@')[1] || String(c.domain || '')).toLowerCase().split('.').pop();
  return tzOf(c.location, camp?.location, camp?.geography) || (tld && tld.length === 2 && C[tld]) || null;
}
function localNow(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hour: +p.hour % 24 };
}
// AB/AEA + İngiltere + İsviçre: GDPR kapsamı (çıkış cümlesi zorunlu tutulur)
const EU_TZ = /^Europe\/(?!Istanbul|Kyiv|Chisinau|Belgrade|Sarajevo)/;
const isEU = tz => !!tz && EU_TZ.test(tz);

module.exports = { tzOf, tzFor, localNow, isEU };
