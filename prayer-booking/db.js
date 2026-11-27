const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'prayer.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,            -- YYYY-MM-DD
  time TEXT NOT NULL,            -- HH:MM
  start_ts INTEGER NOT NULL,     -- epoch ms
  duration_min INTEGER NOT NULL DEFAULT 30,
  capacity INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,           -- digits with country code
  request TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'booked',  -- booked | cancelled
  reminded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slots_start ON slots(start_ts);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id, status);
`);

// migration: remember each person's language for WhatsApp messages
try { db.exec(`ALTER TABLE bookings ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'`); } catch {}

// migrations: prayer center per slot, place (town) per booking
try { db.exec(`ALTER TABLE slots ADD COLUMN center TEXT NOT NULL DEFAULT 'kattakada'`); } catch {}
try { db.exec(`ALTER TABLE bookings ADD COLUMN place TEXT NOT NULL DEFAULT ''`); } catch {}

// migrations: extra (reception-only) slots, booking source, reminders and arrival check
for (const sql of [
  `ALTER TABLE slots ADD COLUMN kind TEXT NOT NULL DEFAULT 'public'`,          // public | extra
  `ALTER TABLE bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'web'`,        // web | reception
  `ALTER TABLE bookings ADD COLUMN arrival TEXT NOT NULL DEFAULT ''`,          // '' | here | no
  `ALTER TABLE bookings ADD COLUMN arrival_at INTEGER`,
  `ALTER TABLE bookings ADD COLUMN r1h INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE bookings ADD COLUMN r30 INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE bookings ADD COLUMN asked INTEGER NOT NULL DEFAULT 0`,
]) { try { db.exec(sql); } catch {} }

module.exports = db;
