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
const fmt = (s, lang = 'en') =>
  new Date(s.start_ts).toLocaleString(lang === 'ml' ? 'ml-IN' : 'en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
// Prayer centers. `days` = weekdays when the center is open for booking (0=Sun..6=Sat); null = every day.
const CENTERS = {
  kattakada: { en: 'Kattakada Shalom', ml: 'കാട്ടാക്കട ഷാലോം', days: [1, 2, 4, 5] }, // Mon, Tue, Thu, Fri
  thirumala: { en: 'Thirumala Shalom', ml: 'തിരുമല ഷാലോം', days: [2, 6] }, // Tuesday, Saturday
  poovar: { en: 'Poovar Shalom', ml: 'പൂവാർ ഷാലോം', days: [2] },            // Tuesday
};
const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const centerDays = (c) => { const n = (CENTERS[c].days || []).map((d) => DAY_NAMES[d]); return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
const centerName = (c, lang = 'en') => (CENTERS[c] || CENTERS.kattakada)[lang];
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay(); // weekday of a calendar date
const centerOpenOn = (c, date) => !!CENTERS[c] && (!CENTERS[c].days || CENTERS[c].days.includes(weekdayOf(date)));
const istDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(ms);
// Visitors can only book today and tomorrow
const bookableDates = () => [istDate(Date.now()), istDate(Date.now() + 24 * 3600 * 1000)];
const LANGS = ['en', 'ml'];
const pickLang = (l) => (LANGS.includes(l) ? l : 'en');

// WhatsApp texts the visitor receives, per language
const T = {
  en: {
    confirm: (n, w, m, u, c) => `🙏 Shalom ${n}!\nYour prayer appointment is confirmed:\n📍 ${c}\n📅 ${w} (${m} min)\nWe will send a reminder before your appointment.\nTo cancel or view: ${u}`,
    cancelled: (w) => `Your prayer slot on ${w} has been cancelled. You are welcome to book again anytime. 🙏`,
    churchCancel: (n, w, u) => `Shalom ${n}, we are sorry – your prayer slot on ${w} has been cancelled by the church. Please book another time: ${u} 🙏`,
    reminder: (n, w, c) => `🔔 Reminder: Shalom ${n}, your prayer appointment is at ${c}, ${w}. God bless you! 🙏`,
  },
  ml: {
    confirm: (n, w, m, u, c) => `🙏 ഷാലോം ${n}!\nനിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിച്ചു:\n📍 ${c}\n📅 ${w} (${m} മിനിറ്റ്)\nസമയത്തിന് മുമ്പ് ഒരു ഓർമ്മപ്പെടുത്തൽ അയയ്ക്കും.\nകാണാനോ റദ്ദാക്കാനോ: ${u}`,
    cancelled: (w) => `${w}-ലെ നിങ്ങളുടെ പ്രാർത്ഥനാ സമയം റദ്ദാക്കി. ഏത് സമയത്തും വീണ്ടും ബുക്ക് ചെയ്യാം. 🙏`,
    churchCancel: (n, w, u) => `ഷാലോം ${n}, ക്ഷമിക്കണം – ${w}-ലെ നിങ്ങളുടെ പ്രാർത്ഥനാ സമയം സഭ റദ്ദാക്കി. മറ്റൊരു സമയം ബുക്ക് ചെയ്യുക: ${u} 🙏`,
    reminder: (n, w, c) => `🔔 ഓർമ്മപ്പെടുത്തൽ: ഷാലോം ${n}, നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് ${c}-ൽ ${w}. ദൈവം അനുഗ്രഹിക്കട്ടെ! 🙏`,
  },
};
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

const slotRow = db.prepare(`
  SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.status='booked') AS booked
  FROM slots s WHERE s.id = ?`);

// ---------- public API ----------
app.get('/api/slots', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.date, s.time, s.start_ts, s.duration_min, s.capacity, s.note, s.center,
      (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.status='booked') AS booked
    FROM slots s WHERE s.start_ts > ? AND s.date IN (?, ?) ORDER BY s.start_ts`).all(Date.now(), ...bookableDates());
  res.json(rows
    .filter((r) => centerOpenOn(r.center, r.date))
    .map((r) => ({ ...r, left: Math.max(0, r.capacity - r.booked) })));
});

app.post('/api/book', limit(10, 3600 * 1000), async (req, res) => {
  const name = clean(req.body.name, 80);
  const phone = normalizePhone(req.body.phone);
  const place = clean(req.body.place, 80);
  const slotId = Number(req.body.slotId);
  const lang = pickLang(req.body.lang);
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!phone) return res.status(400).json({ error: 'Please enter a valid WhatsApp number.' });
  if (!place) return res.status(400).json({ error: 'Please enter your place.' });
  if (!Number.isInteger(slotId)) return res.status(400).json({ error: 'Invalid slot.' });

  const token = crypto.randomBytes(16).toString('hex');
  let slot, bookingId;
  try {
    db.exec('BEGIN IMMEDIATE'); // atomic seat check + insert: no double booking
    slot = slotRow.get(slotId);
    if (!slot || slot.start_ts <= Date.now()) throw new Error('This slot is no longer available.');
    if (!bookableDates().includes(slot.date)) throw new Error('Appointments can only be booked for today and tomorrow.');
    if (!centerOpenOn(slot.center, slot.date)) throw new Error(`${centerName(slot.center)} is open only on ${centerDays(slot.center)}.`);
    if (slot.booked >= slot.capacity) throw new Error('Sorry, this slot was just taken. Please pick another.');
    const dup = db.prepare(`SELECT 1 FROM bookings WHERE slot_id=? AND phone=? AND status='booked'`).get(slotId, phone);
    if (dup) throw new Error('You have already booked this slot.');
    const r = db.prepare(`INSERT INTO bookings (slot_id,name,phone,place,token,lang,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(slotId, name, phone, place, token, lang, Date.now());
    bookingId = Number(r.lastInsertRowid);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    return res.status(409).json({ error: e.message });
  }

  const cancelUrl = `${BASE_URL}/manage.html?t=${token}`;
  sendWhatsApp(phone, T[lang].confirm(name, fmt(slot, lang), slot.duration_min, cancelUrl, centerName(slot.center, lang)),
    { name: 'prayer_confirmed', lang, params: [name, centerName(slot.center, lang), fmt(slot, lang), slot.duration_min, cancelUrl] });
  if (ADMIN_WHATSAPP) {
    sendWhatsApp(ADMIN_WHATSAPP,
      `🆕 New prayer appointment\n${name} (+${phone})\n🏠 ${place}\n📍 ${centerName(slot.center)}\n📅 ${fmt(slot)}`,
      { name: 'admin_new_booking', lang: 'en', params: [name, '+' + phone, place, centerName(slot.center), fmt(slot)] });
  }
  res.json({ ok: true, bookingId, token, manageUrl: cancelUrl, when: fmt(slot, lang) });
});

// Booking self-service (via token from the WhatsApp link)
app.get('/api/booking/:token', (req, res) => {
  const b = db.prepare(`SELECT b.name,b.status,b.token,b.lang,s.id sid,s.start_ts,s.duration_min,s.center FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.token=?`).get(req.params.token);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ name: b.name, status: b.status, when: fmt(b, b.lang), start_ts: b.start_ts, center: b.center, past: b.start_ts <= Date.now() });
});

app.post('/api/booking/:token/cancel', limit(10, 3600 * 1000), async (req, res) => {
  const b = db.prepare(`SELECT b.*,s.start_ts,s.duration_min FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.token=?`).get(req.params.token);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  if (b.status === 'cancelled') return res.json({ ok: true });
  if (b.start_ts <= Date.now()) return res.status(400).json({ error: 'This slot has already passed.' });
  db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=?`).run(b.id);
  sendWhatsApp(b.phone, T[pickLang(b.lang)].cancelled(fmt(b, pickLang(b.lang))),
    { name: 'prayer_cancelled', lang: pickLang(b.lang), params: [fmt(b, pickLang(b.lang))] });
  if (ADMIN_WHATSAPP) sendWhatsApp(ADMIN_WHATSAPP, `❌ Booking cancelled: ${b.name} (+${b.phone}) – ${fmt(b)}`,
    { name: 'admin_cancelled', lang: 'en', params: [b.name, '+' + b.phone, fmt(b)] });
  res.json({ ok: true });
});

// ---------- admin API ----------
app.post('/api/admin/login', limit(8, 15 * 60 * 1000), (req, res) => {
  if (!safeEq(String(req.body.password || ''), ADMIN_PASSWORD)) return res.status(401).json({ error: 'Wrong password.' });
  res.json({ token: signToken() });
});

app.get('/api/admin/slots', requireAdmin, (req, res) => {
  const slots = db.prepare(`SELECT * FROM slots ORDER BY start_ts DESC LIMIT 300`).all();
  const bookings = db.prepare(`SELECT id,slot_id,name,phone,place,status,created_at FROM bookings WHERE status='booked' ORDER BY created_at`).all();
  res.json(slots.map((s) => ({ ...s, bookings: bookings.filter((b) => b.slot_id === s.id), past: s.start_ts <= Date.now() })));
});

// Create one slot, or many: { date, times:["06:00","07:00"], duration_min, capacity, note, repeatWeeks }
app.post('/api/admin/slots', requireAdmin, (req, res) => {
  const { date, duration_min = 30, capacity = 1, repeatWeeks = 1 } = req.body;
  const times = Array.isArray(req.body.times) ? req.body.times : [req.body.time];
  const note = clean(req.body.note, 200);
  const center = CENTERS[req.body.center] ? req.body.center : 'kattakada';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Pick a valid date.' });
  if (!times.length || !times.every((t) => /^\d{2}:\d{2}$/.test(t || ''))) return res.status(400).json({ error: 'Enter at least one valid time.' });
  if (!centerOpenOn(center, date)) return res.status(400).json({ error: `${centerName(center)} slots can only be added on ${centerDays(center)}.` });
  const dur = Math.min(Math.max(parseInt(duration_min) || 30, 5), 240);
  const cap = Math.min(Math.max(parseInt(capacity) || 1, 1), 100);
  const weeks = Math.min(Math.max(parseInt(repeatWeeks) || 1, 1), 26);

  const ins = db.prepare(`INSERT INTO slots (date,time,start_ts,duration_min,capacity,note,center,created_at) VALUES (?,?,?,?,?,?,?,?)`);
  const exists = db.prepare(`SELECT 1 FROM slots WHERE start_ts=? AND center=?`);
  let created = 0;
  for (let w = 0; w < weeks; w++) {
    const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * w);
    const ds = d.toISOString().slice(0, 10);
    for (const t of times) {
      const ts = toStart(ds, t);
      if (Number.isNaN(ts) || ts <= Date.now() || exists.get(ts, center)) continue;
      ins.run(ds, t, ts, dur, cap, note, center, Date.now()); created++;
    }
  }
  if (!created) return res.status(400).json({ error: 'No slots created (past times or already exist).' });
  res.json({ ok: true, created });
});

// Delete a slot; everyone booked is notified on WhatsApp
app.delete('/api/admin/slots/:id', requireAdmin, async (req, res) => {
  const s = slotRow.get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Slot not found.' });
  const people = db.prepare(`SELECT name,phone,lang FROM bookings WHERE slot_id=? AND status='booked'`).all(s.id);
  db.prepare(`DELETE FROM slots WHERE id=?`).run(s.id);
  if (s.start_ts > Date.now()) {
    for (const p of people) {
      const l = pickLang(p.lang);
      sendWhatsApp(p.phone, T[l].churchCancel(p.name, fmt(s, l), BASE_URL),
        { name: 'prayer_church_cancelled', lang: l, params: [p.name, fmt(s, l), BASE_URL] });
    }
  }
  res.json({ ok: true, notified: people.length });
});

app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const b = db.prepare(`SELECT b.*,s.start_ts FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=?`).get(Number(req.params.id));
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=?`).run(b.id);
  const l = pickLang(b.lang);
  sendWhatsApp(b.phone, T[l].churchCancel(b.name, fmt(b, l), BASE_URL),
    { name: 'prayer_church_cancelled', lang: l, params: [b.name, fmt(b, l), BASE_URL] });
  res.json({ ok: true });
});

// ---------- reminders: sent once, 2 hours before (only if the booking was made 3+ hours ahead) ----------
setInterval(() => {
  const now = Date.now();
  const due = db.prepare(`
    SELECT b.id,b.name,b.phone,b.lang,s.start_ts,s.duration_min,s.center FROM bookings b JOIN slots s ON s.id=b.slot_id
    WHERE b.status='booked' AND b.reminded=0 AND s.start_ts > ? AND s.start_ts <= ?
      AND b.created_at <= s.start_ts - 3 * 3600 * 1000`).all(now, now + 2 * 3600 * 1000);
  for (const b of due) {
    db.prepare(`UPDATE bookings SET reminded=1 WHERE id=?`).run(b.id);
    const l = pickLang(b.lang);
    sendWhatsApp(b.phone, T[l].reminder(b.name, fmt(b, l), centerName(b.center, l)),
      { name: 'prayer_reminder', lang: l, params: [b.name, centerName(b.center, l), fmt(b, l)] });
  }
}, 5 * 60 * 1000).unref();

app.listen(PORT, () => console.log(`Prayer booking running at ${BASE_URL}`));
