const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'app.db'));

db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, name TEXT, pass TEXT, role TEXT DEFAULT 'user', signature TEXT DEFAULT '', active INTEGER DEFAULT 1, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY, rr_id INTEGER UNIQUE, name TEXT, title TEXT, company TEXT, domain TEXT, industry TEXT, location TEXT,
  linkedin TEXT, email TEXT DEFAULT '', email_grade TEXT, emails TEXT, phones TEXT, status TEXT, source TEXT, owner_id INTEGER, note TEXT DEFAULT '',
  created TEXT DEFAULT CURRENT_TIMESTAMP, updated TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER, contact_id INTEGER, PRIMARY KEY(user_id, contact_id));
CREATE TABLE IF NOT EXISTS searches(id INTEGER PRIMARY KEY, user_id INTEGER, params TEXT, total INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, user_id INTEGER, file TEXT, total INTEGER, done INTEGER DEFAULT 0, found INTEGER DEFAULT 0, state TEXT, note TEXT DEFAULT '', created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS job_rows(job_id INTEGER, idx INTEGER, input TEXT, q TEXT, contact_id INTEGER, status TEXT, PRIMARY KEY(job_id, idx));
CREATE TABLE IF NOT EXISTS templates(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, subject TEXT, body TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS mails(id INTEGER PRIMARY KEY, user_id INTEGER, contact_id INTEGER, to_email TEXT, subject TEXT, status TEXT, error TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS campaigns(id INTEGER PRIMARY KEY, name TEXT, status TEXT DEFAULT 'aktif', brief TEXT DEFAULT '', offer TEXT DEFAULT '', problem TEXT DEFAULT '',
  clients TEXT DEFAULT '[]', positive TEXT DEFAULT '[]', negative TEXT DEFAULT '[]', keywords TEXT DEFAULT '[]', geography TEXT DEFAULT 'Türkiye', size TEXT DEFAULT '',
  roles TEXT DEFAULT '', titles TEXT DEFAULT '[]', instructions TEXT DEFAULT '', followups TEXT DEFAULT '[{"days":3},{"days":5}]',
  auto_lookup INTEGER DEFAULT 1, auto_draft INTEGER DEFAULT 0, auto_send INTEGER DEFAULT 0, user_id INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY, campaign_id INTEGER, name TEXT, domain TEXT, city TEXT, sector TEXT, size TEXT, reason TEXT, score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'yeni', people INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS companies_uq ON companies(campaign_id, domain);
CREATE TABLE IF NOT EXISTS leads(campaign_id INTEGER, contact_id INTEGER, company_id INTEGER, stage TEXT DEFAULT 'aday', created TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(campaign_id, contact_id));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, type TEXT, payload TEXT, status TEXT DEFAULT 'sırada', result TEXT DEFAULT '', campaign_id INTEGER, user_id INTEGER,
  created TEXT DEFAULT CURRENT_TIMESTAMP, done_at TEXT);
CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY, campaign_id INTEGER, contact_id INTEGER, step INTEGER DEFAULT 0, to_email TEXT, subject TEXT, body TEXT,
  status TEXT DEFAULT 'taslak', scheduled_at TEXT, sent_at TEXT, error TEXT, message_id TEXT, user_id INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS suppress(id INTEGER PRIMARY KEY, type TEXT, value TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(type, value));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, type TEXT, text TEXT, campaign_id INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS senders(id INTEGER PRIMARY KEY, email TEXT UNIQUE, pass TEXT, name TEXT DEFAULT '', daily INTEGER DEFAULT 40, active INTEGER DEFAULT 1,
  imap_last_uid INTEGER DEFAULT 0, note TEXT DEFAULT '', created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS replies(id INTEGER PRIMARY KEY, sender_id INTEGER, contact_id INTEGER, outbox_id INTEGER, campaign_id INTEGER, from_email TEXT, from_name TEXT,
  subject TEXT, text TEXT, message_id TEXT, received_at TEXT, label TEXT DEFAULT '', summary TEXT DEFAULT '', draft TEXT DEFAULT '', return_date TEXT, status TEXT DEFAULT 'yeni',
  created TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(sender_id, message_id));
CREATE TABLE IF NOT EXISTS signals(id INTEGER PRIMARY KEY, campaign_id INTEGER, company TEXT, domain TEXT, city TEXT, event TEXT, kind TEXT, date TEXT, url TEXT,
  status TEXT DEFAULT 'yeni', created TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(domain, event));
`);
// Sonradan eklenen kolonlar
for (const [t, c] of [['campaigns', "sector TEXT DEFAULT ''"], ['campaigns', "location TEXT DEFAULT ''"], ['campaigns', "kind TEXT DEFAULT ''"],
  ['contacts', "opener TEXT DEFAULT ''"], ['contacts', "email_check TEXT DEFAULT ''"],
  ['outbox', 'sender_id INTEGER'], ['outbox', 'template_id INTEGER'], ['outbox', 'personal INTEGER DEFAULT 0'], ['outbox', "opener TEXT DEFAULT ''"], ['outbox', 'reply_to_id INTEGER'],
  ['companies', "phone TEXT DEFAULT ''"], ['companies', "gen_email TEXT DEFAULT ''"], ['companies', "call_status TEXT DEFAULT ''"], ['companies', "call_note TEXT DEFAULT ''"],
  ['companies', 'called_at TEXT'], ['companies', 'callback_at TEXT'], ['companies', "kind TEXT DEFAULT ''"],
  ['senders', "signature TEXT DEFAULT ''"], ['contacts', 'teaser INTEGER DEFAULT -1'], ['contacts', 'pending_tries INTEGER DEFAULT 0'],
  ['signals', 'score INTEGER DEFAULT 0'], ['signals', "why TEXT DEFAULT ''"], ['signals', "angle TEXT DEFAULT ''"], ['campaigns', 'auto INTEGER DEFAULT 0']])
  { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch {} }


const all = (sql, ...a) => db.prepare(sql).all(...a);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const setting = k => get('SELECT value FROM settings WHERE key=?', k)?.value ?? '';
const setSetting = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v ?? ''));
const jsonSetting = (k, def) => { try { return { ...def, ...JSON.parse(setting(k) || '{}') }; } catch { return def; } };

const hash = (p, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(p, salt, 32).toString('hex');
const verify = (p, h) => { const [s] = String(h).split(':'); return hash(p, s) === h; };

if (!get('SELECT 1 FROM users')) run('INSERT INTO users(username,name,pass,role) VALUES(?,?,?,?)', process.env.APP_USER || 'emre', 'Emre', hash(process.env.APP_PASS || 'emre'), 'admin');
for (const [k, env] of [['rr_api_key', 'RR_API_KEY'], ['openai_key', 'OPENAI_API_KEY'], ['tg_token', 'TELEGRAM_TOKEN'], ['tg_chat', 'TELEGRAM_CHAT_ID']])
  if (!setting(k) && process.env[env]) setSetting(k, process.env[env]);

module.exports = { db, all, get, run, setting, setSetting, jsonSetting, hash, verify, DATA };
