// Load .env if present (no extra dependency)
try { process.loadEnvFile(require('path').join(__dirname, '.env')); } catch {}

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { sendWhatsApp } = require('./whatsapp');

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TZ_OFFSET = process.env.TZ_OFFSET || '+05:30';
const CC = process.env.DEFAULT_COUNTRY_CODE || '91';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || '').replace(/\D/g, '');

if (ADMIN_PASSWORD === 'change-me') {
  console.warn('WARNING: ADMIN_PASSWORD is the default. Set a real one in .env before going live.');
}

const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const sha = (s) => crypto.createHash('sha256').update(s).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// Stateless admin session: HMAC-signed token valid for 12h
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
function signToken() {
  const exp = Date.now() + 12 * 3600 * 1000;
  const sig = crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}
function validToken(t = '') {
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = crypto.createHmac('sha256', SECRET).update(exp).digest('hex');
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function requireAdmin(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!validToken(t)) return res.status(401).json({ error: 'Admin login required' });
  next();
}

// Basic in-memory rate limit (per IP, per route group)
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + req.baseUrl + req.path;
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    arr.push(now); hits.set(k, arr); next();
  };
}
setInterval(() => hits.clear(), 3600 * 1000).unref();

function normalizePhone(raw = '') {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10) d = CC + d; // local number without country code
  return d.length >= 11 && d.length <= 15 ? d : null;
}
const toStart = (date, time) => new Date(`${date}T${time}:00${TZ_OFFSET}`).getTime();
const fmt = (s) =>
  new Date(s.start_ts).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

const slotRow = db.prepare(`
  SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.status='booked') AS booked
  FROM slots s WHERE s.id = ?`);

// ---------- public API ----------
app.get('/api/slots', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.date, s.time, s.start_ts, s.duration_min, s.capacity, s.note,
      (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.status='booked') AS booked
    FROM slots s WHERE s.start_ts > ? ORDER BY s.start_ts`).all(Date.now());
  res.json(rows.map((r) => ({ ...r, left: Math.max(0, r.capacity - r.booked) })));
});

app.post('/api/book', limit(10, 3600 * 1000), async (req, res) => {
  const name = clean(req.body.name, 80);
  const phone = normalizePhone(req.body.phone);
  const request = clean(req.body.request, 500);
  const slotId = Number(req.body.slotId);
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!phone) return res.status(400).json({ error: 'Please enter a valid WhatsApp number.' });
  if (!Number.isInteger(slotId)) return res.status(400).json({ error: 'Invalid slot.' });

  const token = crypto.randomBytes(16).toString('hex');
  let slot, bookingId;
  try {
    db.exec('BEGIN IMMEDIATE'); // atomic seat check + insert: no double booking
    slot = slotRow.get(slotId);
    if (!slot || slot.start_ts <= Date.now()) throw new Error('This slot is no longer available.');
    if (slot.booked >= slot.capacity) throw new Error('Sorry, this slot was just taken. Please pick another.');
    const dup = db.prepare(`SELECT 1 FROM bookings WHERE slot_id=? AND phone=? AND status='booked'`).get(slotId, phone);
    if (dup) throw new Error('You have already booked this slot.');
    const r = db.prepare(`INSERT INTO bookings (slot_id,name,phone,request,token,created_at) VALUES (?,?,?,?,?,?)`)
      .run(slotId, name, phone, request, token, Date.now());
    bookingId = Number(r.lastInsertRowid);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    return res.status(409).json({ error: e.message });
  }

  const cancelUrl = `${BASE_URL}/manage.html?t=${token}`;
  sendWhatsApp(phone,
    `🙏 Shalom ${name}!\nYour prayer slot is confirmed:\n📅 ${fmt(slot)} (${slot.duration_min} min)\n` +
    `We will send a reminder before your slot.\nTo cancel or view: ${cancelUrl}`);
  if (ADMIN_WHATSAPP) {
    sendWhatsApp(ADMIN_WHATSAPP,
      `🆕 New prayer booking\n${name} (+${phone})\n📅 ${fmt(slot)}${request ? `\n📝 ${request}` : ''}`);
  }
  res.json({ ok: true, bookingId, token, manageUrl: cancelUrl, when: fmt(slot) });
});

// Booking self-service (via token from the WhatsApp link)
app.get('/api/booking/:token', (req, res) => {
  const b = db.prepare(`SELECT b.name,b.status,b.token,s.id sid,s.start_ts,s.duration_min FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.token=?`).get(req.params.token);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ name: b.name, status: b.status, when: fmt(b), past: b.start_ts <= Date.now() });
});

app.post('/api/booking/:token/cancel', limit(10, 3600 * 1000), async (req, res) => {
  const b = db.prepare(`SELECT b.*,s.start_ts,s.duration_min FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.token=?`).get(req.params.token);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  if (b.status === 'cancelled') return res.json({ ok: true });
  if (b.start_ts <= Date.now()) return res.status(400).json({ error: 'This slot has already passed.' });
  db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=?`).run(b.id);
  sendWhatsApp(b.phone, `Your prayer slot on ${fmt(b)} has been cancelled. You are welcome to book again anytime. 🙏`);
  if (ADMIN_WHATSAPP) sendWhatsApp(ADMIN_WHATSAPP, `❌ Booking cancelled: ${b.name} (+${b.phone}) – ${fmt(b)}`);
  res.json({ ok: true });
});

// ---------- admin API ----------
app.post('/api/admin/login', limit(8, 15 * 60 * 1000), (req, res) => {
  if (!safeEq(String(req.body.password || ''), ADMIN_PASSWORD)) return res.status(401).json({ error: 'Wrong password.' });
  res.json({ token: signToken() });
});

app.get('/api/admin/slots', requireAdmin, (req, res) => {
  const slots = db.prepare(`SELECT * FROM slots ORDER BY start_ts DESC LIMIT 300`).all();
  const bookings = db.prepare(`SELECT id,slot_id,name,phone,request,status,created_at FROM bookings WHERE status='booked' ORDER BY created_at`).all();
  res.json(slots.map((s) => ({ ...s, bookings: bookings.filter((b) => b.slot_id === s.id), past: s.start_ts <= Date.now() })));
});

// Create one slot, or many: { date, times:["06:00","07:00"], duration_min, capacity, note, repeatWeeks }
app.post('/api/admin/slots', requireAdmin, (req, res) => {
  const { date, duration_min = 30, capacity = 1, repeatWeeks = 1 } = req.body;
  const times = Array.isArray(req.body.times) ? req.body.times : [req.body.time];
  const note = clean(req.body.note, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Pick a valid date.' });
  if (!times.length || !times.every((t) => /^\d{2}:\d{2}$/.test(t || ''))) return res.status(400).json({ error: 'Enter at least one valid time.' });
  const dur = Math.min(Math.max(parseInt(duration_min) || 30, 5), 240);
  const cap = Math.min(Math.max(parseInt(capacity) || 1, 1), 100);
  const weeks = Math.min(Math.max(parseInt(repeatWeeks) || 1, 1), 26);

  const ins = db.prepare(`INSERT INTO slots (date,time,start_ts,duration_min,capacity,note,created_at) VALUES (?,?,?,?,?,?,?)`);
  const exists = db.prepare(`SELECT 1 FROM slots WHERE start_ts=?`);
  let created = 0;
  for (let w = 0; w < weeks; w++) {
    const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * w);
    const ds = d.toISOString().slice(0, 10);
    for (const t of times) {
      const ts = toStart(ds, t);
      if (Number.isNaN(ts) || ts <= Date.now() || exists.get(ts)) continue;
      ins.run(ds, t, ts, dur, cap, note, Date.now()); created++;
    }
  }
  if (!created) return res.status(400).json({ error: 'No slots created (past times or already exist).' });
  res.json({ ok: true, created });
});

// Delete a slot; everyone booked is notified on WhatsApp
app.delete('/api/admin/slots/:id', requireAdmin, async (req, res) => {
  const s = slotRow.get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Slot not found.' });
  const people = db.prepare(`SELECT name,phone FROM bookings WHERE slot_id=? AND status='booked'`).all(s.id);
  db.prepare(`DELETE FROM slots WHERE id=?`).run(s.id);
  if (s.start_ts > Date.now()) {
    for (const p of people) {
      sendWhatsApp(p.phone, `Shalom ${p.name}, we are sorry – your prayer slot on ${fmt(s)} has been cancelled by the church. Please book another time: ${BASE_URL} 🙏`);
    }
  }
  res.json({ ok: true, notified: people.length });
});

app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const b = db.prepare(`SELECT b.*,s.start_ts FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=?`).get(Number(req.params.id));
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=?`).run(b.id);
  sendWhatsApp(b.phone, `Shalom ${b.name}, your prayer slot on ${fmt(b)} was cancelled by the church. Please book another time: ${BASE_URL} 🙏`);
  res.json({ ok: true });
});

// ---------- reminders: ~24h and the day-of, sent once ----------
setInterval(() => {
  const now = Date.now();
  const due = db.prepare(`
    SELECT b.id,b.name,b.phone,s.start_ts,s.duration_min FROM bookings b JOIN slots s ON s.id=b.slot_id
    WHERE b.status='booked' AND b.reminded=0 AND s.start_ts > ? AND s.start_ts <= ?`).all(now, now + 24 * 3600 * 1000);
  for (const b of due) {
    db.prepare(`UPDATE bookings SET reminded=1 WHERE id=?`).run(b.id);
    sendWhatsApp(b.phone, `🔔 Reminder: Shalom ${b.name}, your prayer slot is ${fmt(b)}. God bless you! 🙏`);
  }
}, 5 * 60 * 1000).unref();

app.listen(PORT, () => console.log(`Prayer booking running at ${BASE_URL}`));
