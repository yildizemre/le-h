// Göndermeden önce adres kontrolü + gönderen alan adının SPF/DKIM/DMARC sağlığı.
// SMTP RCPT yoklaması YAPMIYORUZ: sunucu IP'sinin itibarını bozar. Söz dizimi, MX kaydı, rol adresi,
// tek kullanımlık alan adı ve RocketReach'in kendi doğrulama notu birlikte değerlendirilir.
const dns = require('dns').promises;
const { get, run } = require('./db');

const mxCache = new Map();
async function mx(domain) {
  const hit = mxCache.get(domain);
  if (hit && Date.now() - hit.t < 6 * 3600e3) return hit.v;
  let v;
  try { v = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map(x => x.exchange.toLowerCase()); }
  catch (e) { v = e.code === 'ENOTFOUND' || e.code === 'ENODATA' ? [] : null; } // null = bilinmiyor (geçici DNS hatası)
  mxCache.set(domain, { t: Date.now(), v });
  return v;
}

const ROLE = /^(info|bilgi|iletisim|contact|sales|satis|office|ofis|admin|support|destek|hr|ik|insankaynaklari|muhasebe|accounting|noreply|no-reply|webmaster|marketing|pazarlama|export|ihracat|kalite|quality|satinalma|purchasing)@/i;
const DISPOSABLE = /@(mailinator|guerrillamail|10minutemail|tempmail|yopmail|trashmail)\./i;
const SYNTAX = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

// Sonuç: { status: 'ok' | 'riskli' | 'geçersiz', reason }
async function checkEmail(email, contact = {}) {
  email = String(email || '').trim().toLowerCase();
  if (!SYNTAX.test(email)) return { status: 'geçersiz', reason: 'adres biçimi hatalı' };
  if (DISPOSABLE.test(email)) return { status: 'geçersiz', reason: 'geçici mail servisi' };
  let rr = [];
  try { rr = JSON.parse(contact.emails || '[]'); } catch {}
  const mine = rr.find(e => String(e.email).toLowerCase() === email);
  if (mine && (mine.valid === 'invalid' || /^F/i.test(mine.grade || ''))) return { status: 'geçersiz', reason: 'RocketReach geçersiz dedi' };
  const domain = email.split('@')[1];
  const m = await mx(domain);
  if (Array.isArray(m) && !m.length) return { status: 'geçersiz', reason: 'alan adının mail sunucusu (MX) yok' };
  if (ROLE.test(email)) return { status: 'riskli', reason: 'genel/rol adresi (info@ vb.)' };
  // verified: RocketReach adresi SMTP ile doğrulamış ve notu A/B → güvenli modda sadece bunlara gönderilir
  if (mine && /^[AB]/i.test(mine.grade || '') && mine.valid === 'valid') return { status: 'ok', verified: true, reason: 'RocketReach doğruladı (' + mine.grade + ')' };
  if (mine?.valid === 'valid' && !/^[CDF]/i.test(mine.grade || '')) return { status: 'ok', verified: true, reason: 'RocketReach doğruladı' };
  if (m === null) return { status: 'riskli', verified: false, reason: 'MX kontrol edilemedi' };
  return { status: 'ok', verified: false, reason: 'MX var ama adres doğrulanmamış' + (mine?.grade ? ' (not ' + mine.grade + ')' : '') };
}

// Sonucu kişiye yaz (aynı adres için 7 gün tekrar sorma)
async function checkContact(c) {
  if (!c?.email) return { status: 'geçersiz', reason: 'mail yok' };
  try {
    const old = JSON.parse(c.email_check || '{}');
    if (old.email === c.email && old.verified !== undefined && Date.now() - (old.t || 0) < 7 * 864e5) return old;
  } catch {}
  const r = { ...(await checkEmail(c.email, c)), email: c.email, t: Date.now() };
  run('UPDATE contacts SET email_check=? WHERE id=?', JSON.stringify(r), c.id);
  return r;
}

async function txt(name) { try { return (await dns.resolveTxt(name)).map(r => r.join('')); } catch { return []; } }

// Gönderen alan adı sağlığı: SPF, DKIM (google), DMARC, MX
async function domainHealth(domain) {
  domain = String(domain || '').toLowerCase().replace(/^.*@/, '').trim();
  if (!domain) throw Object.assign(new Error('Alan adı yok'), { status: 400 });
  const free = /^(gmail|googlemail|hotmail|outlook|yahoo|icloud|yandex)\./.test(domain);
  const [root, dmarc, dkim, mxs] = await Promise.all([txt(domain), txt('_dmarc.' + domain), txt('google._domainkey.' + domain), mx(domain)]);
  const spf = root.find(t => /^v=spf1/i.test(t)) || '';
  const dm = dmarc.find(t => /^v=DMARC1/i.test(t)) || '';
  const dk = dkim.find(t => /v=DKIM1|k=rsa|p=/i.test(t)) || '';
  const google = (mxs || []).some(x => /google|googlemail/.test(x));
  const checks = [
    { key: 'MX', ok: !!(mxs && mxs.length), value: (mxs || []).slice(0, 2).join(', ') || 'yok',
      fix: 'Alan adına mail sunucusu tanımlı değil. Google Workspace kullanıyorsan MX kayıtlarını Workspace yönetim panelindeki değerlerle ekle.' },
    { key: 'SPF', ok: /include:_spf\.google\.com/i.test(spf) || (!google && !!spf), value: spf || 'yok',
      fix: `TXT kaydı ekle (ad: @ ya da ${domain}): v=spf1 include:_spf.google.com ~all` + (spf ? ' — mevcut SPF kaydına include:_spf.google.com ekle, ikinci bir SPF kaydı açma.' : '') },
    { key: 'DKIM', ok: !!dk, value: dk ? 'google._domainkey bulundu' : 'yok',
      fix: 'Google Workspace yönetici paneli → Uygulamalar → Gmail → E-postanın kimliğini doğrula (DKIM) → anahtar oluştur → verilen TXT kaydını google._domainkey adıyla DNS\'e ekle → "Kimlik doğrulamayı başlat".' },
    { key: 'DMARC', ok: !!dm, value: dm || 'yok',
      fix: `TXT kaydı ekle (ad: _dmarc): v=DMARC1; p=none; rua=mailto:dmarc@${domain}; adkim=s; aspf=s  — birkaç hafta sorunsuz giderse p=quarantine yap.` },
  ];
  const score = checks.filter(c => c.ok).length;
  return { domain, free, google, score, of: checks.length, checks,
    note: free ? 'Ücretsiz Gmail adresi: SPF/DKIM/DMARC Google tarafından yönetilir. Soğuk mail için kendi alan adınla (Workspace) göndermek ve günlük 20-30 mailde kalmak daha güvenli.' : '' };
}

module.exports = { checkEmail, checkContact, domainHealth, mx };
