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

module.exports = db;
