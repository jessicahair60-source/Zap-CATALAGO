// Banco de dados SQLite: um arquivo só, fácil de copiar para backup.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'vitrine.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  state TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  trial_until INTEGER,
  pro_until INTEGER,
  mp_preapproval TEXT,
  custom_domain TEXT UNIQUE,
  blocked INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  type TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, day, type, product_id)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  mp_id TEXT,
  amount REAL NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_links (
  phone TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_codes (
  code TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_pending (
  phone TEXT PRIMARY KEY,
  media TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  last_product TEXT,
  last_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wa_seen (
  msg_id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
`);

module.exports = { db, DATA_DIR };
