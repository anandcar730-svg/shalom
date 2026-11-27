const express = require('express');
const crypto = require('crypto');
const path = require('path');
// Load .env if present (no extra dependency). Must run before the modules below read process.env.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}
const db = require('./db');
const { sendWhatsApp } = require('./whatsapp');
const { crowd, planHours, weekdayOf } = require('./crowd');

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TZ_OFFSET = process.env.TZ_OFFSET || '+05:30';
const CC = process.env.DEFAULT_COUNTRY_CODE || '91';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const RECEPTION_PASSWORD = process.env.RECEPTION_PASSWORD || '';
const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || '').replace(/\D/g, '');
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';

if (ADMIN_PASSWORD === 'change-me') console.warn('WARNING: ADMIN_PASSWORD is the default. Set a real one in .env before going live.');
if (RECEPTION_PASSWORD && RECEPTION_PASSWORD === ADMIN_PASSWORD) console.warn('WARNING: RECEPTION_PASSWORD should differ from ADMIN_PASSWORD.');

const app = express();
// keep the raw body so webhook signatures can be checked
app.use(express.json({ limit: '200kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- auth: signed tokens with a role (admin | reception) ----------
const sha = (s) => crypto.createHash('sha256').update(s).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
function signToken(role) {
  const body = `${Date.now() + 12 * 3600 * 1000}.${role}`;
  return `${body}.${sign(body)}`;
}
function tokenRole(t = '') {
  const [exp, role, sig] = t.split('.');
  if (!exp || !role || !sig || Number(exp) < Date.now()) return null;
  const good = sign(`${exp}.${role}`);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) ? role : null;
}
const requireRole = (...roles) => (req, res, next) => {
  const role = tokenRole((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!role || !roles.includes(role)) return res.status(401).json({ error: 'Login required' });
  req.role = role; next();
};
const requireAdmin = requireRole('admin');
const requireStaff = requireRole('admin', 'reception');

// Basic in-memory rate limit (per IP, per route)
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

// ---------- helpers ----------
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

// Prayer centers. `days` = weekdays the center is open (0=Sun..6=Sat).
const CENTERS = {
  kattakada: { en: 'Kattakada Shalom', ml: 'കാട്ടാക്കട ഷാലോം', days: [1, 2, 4, 5] }, // Mon, Tue, Thu, Fri
  thirumala: { en: 'Thirumala Shalom', ml: 'തിരുമല ഷാലോം', days: [2, 6] },          // Tuesday, Saturday
  poovar: { en: 'Poovar Shalom', ml: 'പൂവാർ ഷാലോം', days: [2] },                    // Tuesday
};
const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const centerDays = (c) => { const n = (CENTERS[c].days || []).map((d) => DAY_NAMES[d]); return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
const centerName = (c, lang = 'en') => (CENTERS[c] || CENTERS.kattakada)[lang];
const centerOpenOn = (c, date) => !!CENTERS[c] && CENTERS[c].days.includes(weekdayOf(date));
const istDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(ms);
const bookableDates = () => [istDate(Date.now()), istDate(Date.now() + 24 * 3600 * 1000)]; // today and tomorrow only
const LANGS = ['en', 'ml'];
const pickLang = (l) => (LANGS.includes(l) ? l : 'en');
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

const CROWD = {
  en: { red: '🔴 Busy', orange: '🟠 Moderate', green: '🟢 Quiet' },
  ml: { red: '🔴 തിരക്ക് കൂടുതൽ', orange: '🟠 മിതമായ തിരക്ക്', green: '🟢 തിരക്ക് കുറവ്' },
};
const crowdLabel = (slot, lang) => { const c = crowd(slot.date, slot.time); return c ? CROWD[lang][c.level] : ''; };

// WhatsApp texts the visitor receives, per language
const T = {
  en: {
    confirm: (n, w, m, u, c, k) => `🙏 Shalom ${n}!\nYour prayer appointment is confirmed:\n📍 ${c}\n📅 ${w} (${m} min)${k ? `\n🚦 Expected crowd: ${k}` : ''}\nWe will remind you 1 hour and 30 minutes before.\nTo view, change or cancel: ${u}`,
    cancelled: (w) => `Your prayer appointment on ${w} has been cancelled. You are welcome to book again anytime. 🙏`,
    churchCancel: (n, w, u) => `Shalom ${n}, we are sorry – your prayer appointment on ${w} has been cancelled by the church. Please book another time: ${u} 🙏`,
    reminder1h: (n, w, c) => `⏰ 1 hour to go: Shalom ${n}, your prayer appointment is at ${c}, ${w}. God bless you! 🙏`,
    reminder30: (n, w, c) => `⏰ 30 minutes to go: Shalom ${n}, your prayer appointment is at ${c}, ${w}. God bless you! 🙏`,
    arrival: (n, c, u) => `🙏 Are you here!! ${n}, your prayer appointment time at ${c} is now.\nReply "I am here" or "NO". Or tap: ${u}`,
    here: (n, c) => `Thank you, ${n}! 🙏 Welcome to ${c}.`,
    noChange: (n, u) => `No problem, ${n}. You can change your booking slot here: ${u}`,
  },
  ml: {
    confirm: (n, w, m, u, c, k) => `🙏 ഷാലോം ${n}!\nനിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് സ്ഥിരീകരിച്ചു:\n📍 ${c}\n📅 ${w} (${m} മിനിറ്റ്)${k ? `\n🚦 പ്രതീക്ഷിക്കുന്ന തിരക്ക്: ${k}` : ''}\n1 മണിക്കൂറും 30 മിനിറ്റും മുമ്പ് ഓർമ്മപ്പെടുത്തും.\nകാണാനോ മാറ്റാനോ റദ്ദാക്കാനോ: ${u}`,
    cancelled: (w) => `${w}-ലെ നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് റദ്ദാക്കി. ഏത് സമയത്തും വീണ്ടും ബുക്ക് ചെയ്യാം. 🙏`,
    churchCancel: (n, w, u) => `ഷാലോം ${n}, ക്ഷമിക്കണം – ${w}-ലെ നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് സഭ റദ്ദാക്കി. മറ്റൊരു സമയം ബുക്ക് ചെയ്യുക: ${u} 🙏`,
    reminder1h: (n, w, c) => `⏰ 1 മണിക്കൂർ ബാക്കി: ഷാലോം ${n}, നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് ${c}-ൽ ${w}. ദൈവം അനുഗ്രഹിക്കട്ടെ! 🙏`,
    reminder30: (n, w, c) => `⏰ 30 മിനിറ്റ് ബാക്കി: ഷാലോം ${n}, നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് ${c}-ൽ ${w}. ദൈവം അനുഗ്രഹിക്കട്ടെ! 🙏`,
    arrival: (n, c, u) => `🙏 നിങ്ങൾ എത്തിയോ!! ${n}, ${c}-ലെ നിങ്ങളുടെ പ്രാർത്ഥനാ അപ്പോയിന്റ്മെന്റ് സമയമായി.\n"ഞാൻ എത്തി" അല്ലെങ്കിൽ "ഇല്ല" എന്ന് മറുപടി നൽകുക. അല്ലെങ്കിൽ: ${u}`,
    here: (n, c) => `നന്ദി, ${n}! 🙏 ${c}-ലേക്ക് സ്വാഗതം.`,
    noChange: (n, u) => `സാരമില്ല, ${n}. നിങ്ങളുടെ ബുക്കിംഗ് സമയം ഇവിടെ മാറ്റാം: ${u}`,
  },
};

const slotRow = db.prepare(`
  SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.status='booked') AS booked
  FROM slots s WHERE s.id = ?`);

const manageUrl = (token, extra = '') => `${BASE_URL}/manage.html?t=${token}${extra}`;

function sendConfirmation(b, slot) {
  const lang = pickLang(b.lang);
  const label = crowdLabel(slot, lang);
  sendWhatsApp(b.phone,
    T[lang].confirm(b.name, fmt(slot, lang), slot.duration_min, manageUrl(b.token), centerName(slot.center, lang), label),
    { name: 'prayer_confirmed', lang, params: [b.name, centerName(slot.center, lang), fmt(slot, lang), slot.duration_min, manageUrl(b.token), label || '-'] });
}

// Create a booking safely (seat check + insert in one transaction, so a slot can never be overbooked).
// kind 'public' = website visitors, 'extra' = reception only. graceMs lets reception book a slot that just started.
function createBooking({ slotId, name, phone, place, lang, source, kind, graceMs = 0 }) {
  const token = crypto.randomBytes(16).toString('hex');
  try {
    db.exec('BEGIN IMMEDIATE');
    const slot = slotRow.get(slotId);
    if (!slot || slot.kind !== kind || slot.start_ts <= Date.now() - graceMs) throw new Error('This slot is no longer available.');
    if (!bookableDates().includes(slot.date)) throw new Error('Appointments can only be booked for today and tomorrow.');
    if (!centerOpenOn(slot.center, slot.date)) throw new Error(`${centerName(slot.center)} is open only on ${centerDays(slot.center)}.`);
    if (slot.booked >= slot.capacity) throw new Error('Sorry, this slot was just taken. Please pick another.');
    if (db.prepare(`SELECT 1 FROM bookings WHERE slot_id=? AND phone=? AND status='booked'`).get(slotId, phone)) throw new Error('This number is already booked for this slot.');
    const r = db.prepare(`INSERT INTO bookings (slot_id,name,phone,place,token,lang,source,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(slotId, name, phone, place, token, lang, source, Date.now());
    db.exec('COMMIT');
    return { b: { id: Number(r.lastInsertRowid), name, phone, place, token, lang }, slot };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

function readBookingBody(req) {
  const name = clean(req.body.name, 80), phone = normalizePhone(req.body.phone), place = clean(req.body.place, 80);
  const slotId = Number(req.body.slotId), lang = pickLang(req.body.lang);
  if (!name) return { error: 'Please enter the name.' };
  if (!phone) return { error: 'Please enter a valid WhatsApp number.' };
  if (!place) return { error: 'Please enter the place.' };
  if (!Number.isInteger(slotId)) return { error: 'Invalid slot.' };
  return { name, phone, place, slotId, lang };
}

function adminAlert(b, slot, tag = '') {
  if (!ADMIN_WHATSAPP) return;
  sendWhatsApp(ADMIN_WHATSAPP,
    `🆕 New prayer appointment${tag}\n${b.name} (+${b.phone})\n🏠 ${b.place}\n📍 ${centerName(slot.center)}\n📅 ${fmt(slot)}`,
    { name: 'admin_new_booking', lang: 'en', params: [b.name, '+' + b.phone, b.place, centerName(slot.center), fmt(slot)] });
}

// ---------- public API ----------
app.get('/api/slots', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.date, s.time, s.start_ts, s.duration_min, s.capacity, s.note, s.center,
      (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.status='booked') AS booked
    FROM slots s WHERE s.kind='public' AND s.start_ts > ? AND s.date IN (?, ?) ORDER BY s.start_ts`).all(Date.now(), ...bookableDates());
  res.json(rows
    .filter((r) => centerOpenOn(r.center, r.date))
    .map((r) => ({ ...r, left: Math.max(0, r.capacity - r.booked), level: crowd(r.date, r.time)?.level || null })));
});

app.post('/api/book', limit(10, 3600 * 1000), (req, res) => {
  const d = readBookingBody(req);
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const { b, slot } = createBooking({ ...d, source: 'web', kind: 'public' });
    sendConfirmation(b, slot); adminAlert(b, slot);
    res.json({ ok: true, bookingId: b.id, token: b.token, manageUrl: manageUrl(b.token), when: fmt(slot, d.lang) });
  } catch (e) { res.status(409).json({ error: e.message }); }
});

// ---------- a person's own booking (link from WhatsApp) ----------
const bookingByToken = db.prepare(`SELECT b.*, s.start_ts, s.date, s.time, s.duration_min, s.center, s.kind
  FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.token=?`);

app.get('/api/booking/:token', (req, res) => {
  const b = bookingByToken.get(req.params.token);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ name: b.name, status: b.status, when: fmt(b, b.lang), start_ts: b.start_ts, center: b.center, arrival: b.arrival, slot_id: b.slot_id,
    past: b.start_ts <= Date.now(), level: crowd(b.date, b.time)?.level || null, lang: b.lang });
});

app.post('/api/booking/:token/cancel', limit(10, 3600 * 1000), (req, res) => {
  const b = bookingByToken.get(req.params.token);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  if (b.status === 'cancelled') return res.json({ ok: true });
  if (b.start_ts <= Date.now()) return res.status(400).json({ error: 'This slot has already passed.' });
  db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=?`).run(b.id);
  const l = pickLang(b.lang);
  sendWhatsApp(b.phone, T[l].cancelled(fmt(b, l)), { name: 'prayer_cancelled', lang: l, params: [fmt(b, l)] });
  if (ADMIN_WHATSAPP) sendWhatsApp(ADMIN_WHATSAPP, `❌ Booking cancelled: ${b.name} (+${b.phone}) – ${fmt(b)}`,
    { name: 'admin_cancelled', lang: 'en', params: [b.name, '+' + b.phone, fmt(b)] });
  res.json({ ok: true });
});

// "I am here" / "NO" (from the WhatsApp buttons or the web page)
function setArrival(b, status) {
  const l = pickLang(b.lang);
  db.prepare(`UPDATE bookings SET arrival=?, arrival_at=? WHERE id=?`).run(status, Date.now(), b.id);
  if (status === 'here') sendWhatsApp(b.phone, T[l].here(b.name, centerName(b.center, l)));
  else sendWhatsApp(b.phone, T[l].noChange(b.name, manageUrl(b.token, '&change=1'))); // inside the 24h window after their reply
}
app.post('/api/booking/:token/arrival', limit(20, 3600 * 1000), (req, res) => {
  const b = bookingByToken.get(req.params.token);
  const status = req.body.status;
  if (!b || b.status !== 'booked') return res.status(404).json({ error: 'Booking not found.' });
  if (!['here', 'no'].includes(status)) return res.status(400).json({ error: 'Invalid answer.' });
  setArrival(b, status);
  res.json({ ok: true, status });
});

// Move a booking to another open slot
app.post('/api/booking/:token/change', limit(10, 3600 * 1000), (req, res) => {
  const old = bookingByToken.get(req.params.token);
  const slotId = Number(req.body.slotId);
  if (!old || old.status !== 'booked') return res.status(404).json({ error: 'Booking not found.' });
  if (old.start_ts < Date.now() - 2 * 3600 * 1000) return res.status(400).json({ error: 'This booking is too old to change.' });
  let slot;
  try {
    db.exec('BEGIN IMMEDIATE');
    slot = slotRow.get(slotId);
    if (!slot || slot.kind !== 'public' || slot.start_ts <= Date.now()) throw new Error('This slot is no longer available.');
    if (slot.id === old.slot_id) throw new Error('This is your current slot. Please choose a different one.');
    if (!bookableDates().includes(slot.date)) throw new Error('Appointments can only be booked for today and tomorrow.');
    if (!centerOpenOn(slot.center, slot.date)) throw new Error(`${centerName(slot.center)} is open only on ${centerDays(slot.center)}.`);
    if (slot.booked >= slot.capacity) throw new Error('Sorry, this slot was just taken. Please pick another.');
    if (db.prepare(`SELECT 1 FROM bookings WHERE slot_id=? AND phone=? AND status='booked'`).get(slot.id, old.phone)) throw new Error('This number is already booked for that slot.');
    db.prepare(`UPDATE bookings SET slot_id=?, arrival='', arrival_at=NULL, r1h=0, r30=0, asked=0 WHERE id=?`).run(slot.id, old.id);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    return res.status(409).json({ error: e.message });
  }
  sendConfirmation(old, slot);
  if (ADMIN_WHATSAPP) sendWhatsApp(ADMIN_WHATSAPP, `🔁 Booking moved: ${old.name} (+${old.phone}) now ${centerName(slot.center)} – ${fmt(slot)}`,
    { name: 'admin_moved', lang: 'en', params: [old.name, '+' + old.phone, centerName(slot.center), fmt(slot)] });
  res.json({ ok: true, when: fmt(slot, pickLang(old.lang)) });
});

// ---------- logins ----------
app.post('/api/admin/login', limit(8, 15 * 60 * 1000), (req, res) => {
  if (!safeEq(String(req.body.password || ''), ADMIN_PASSWORD)) return res.status(401).json({ error: 'Wrong password.' });
  res.json({ token: signToken('admin') });
});
app.post('/api/reception/login', limit(8, 15 * 60 * 1000), (req, res) => {
  if (!RECEPTION_PASSWORD) return res.status(503).json({ error: 'Reception login is not set up. Set RECEPTION_PASSWORD in .env.' });
  if (!safeEq(String(req.body.password || ''), RECEPTION_PASSWORD)) return res.status(401).json({ error: 'Wrong password.' });
  res.json({ token: signToken('reception') });
});

// ---------- admin API ----------
app.get('/api/admin/slots', requireAdmin, (req, res) => {
  const slots = db.prepare(`SELECT * FROM slots ORDER BY start_ts DESC LIMIT 400`).all();
  const bookings = db.prepare(`SELECT id,slot_id,name,phone,place,source,arrival,status,created_at FROM bookings WHERE status='booked' ORDER BY created_at`).all();
  res.json(slots.map((s) => ({ ...s, level: crowd(s.date, s.time)?.level || null, bookings: bookings.filter((b) => b.slot_id === s.id), past: s.start_ts <= Date.now() })));
});

// Slots per hour for a given slot length and people per slot, compared with the usual crowd for that weekday
app.get('/api/admin/plan', requireAdmin, (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Pick a valid date.' });
  const plan = planHours(date, req.query.minutes, req.query.people);
  res.json(plan ? { open: true, ...plan } : { open: false });
});

// Create slots: { center, kind:'public'|'extra', date, times:[...], duration_min, capacity, note, repeatWeeks }
app.post('/api/admin/slots', requireAdmin, (req, res) => {
  const { date, duration_min = 30, capacity = 1, repeatWeeks = 1 } = req.body;
  const times = Array.isArray(req.body.times) ? req.body.times : [req.body.time];
  const note = clean(req.body.note, 200);
  const center = CENTERS[req.body.center] ? req.body.center : 'kattakada';
  const kind = req.body.kind === 'extra' ? 'extra' : 'public';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Pick a valid date.' });
  if (!times.length || !times.every((t) => /^\d{2}:\d{2}$/.test(t || ''))) return res.status(400).json({ error: 'Enter at least one valid time.' });
  if (!centerOpenOn(center, date)) return res.status(400).json({ error: `${centerName(center)} slots can only be added on ${centerDays(center)}.` });
  const dur = Math.min(Math.max(parseInt(duration_min) || 30, 5), 240);
  const cap = Math.min(Math.max(parseInt(capacity) || 1, 1), 100);
  const weeks = Math.min(Math.max(parseInt(repeatWeeks) || 1, 1), 26);

  const ins = db.prepare(`INSERT INTO slots (date,time,start_ts,duration_min,capacity,note,center,kind,created_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  const exists = db.prepare(`SELECT 1 FROM slots WHERE start_ts=? AND center=? AND kind=?`);
  let created = 0;
  for (let w = 0; w < weeks; w++) {
    const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * w);
    const ds = d.toISOString().slice(0, 10);
    for (const t of times) {
      const ts = toStart(ds, t);
      if (Number.isNaN(ts) || ts <= Date.now() || exists.get(ts, center, kind)) continue;
      ins.run(ds, t, ts, dur, cap, note, center, kind, Date.now()); created++;
    }
  }
  if (!created) return res.status(400).json({ error: 'No slots created (past times or already exist).' });
  res.json({ ok: true, created });
});

// Delete a slot; everyone booked is notified on WhatsApp
app.delete('/api/admin/slots/:id', requireAdmin, (req, res) => {
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

function cancelByStaff(b) {
  db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=?`).run(b.id);
  const l = pickLang(b.lang);
  sendWhatsApp(b.phone, T[l].churchCancel(b.name, fmt(b, l), BASE_URL),
    { name: 'prayer_church_cancelled', lang: l, params: [b.name, fmt(b, l), BASE_URL] });
}
const bookingById = db.prepare(`SELECT b.*,s.start_ts FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=?`);
app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const b = bookingById.get(Number(req.params.id));
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  cancelByStaff(b); res.json({ ok: true });
});

// ---------- reception API: books the extra slots that visitors never see ----------
app.get('/api/reception/slots', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.date, s.time, s.start_ts, s.duration_min, s.capacity, s.note, s.center,
      (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.status='booked') AS booked
    FROM slots s WHERE s.kind='extra' AND s.start_ts > ? AND s.date IN (?, ?) ORDER BY s.start_ts`).all(Date.now() - 30 * 60 * 1000, ...bookableDates());
  res.json(rows.map((r) => ({ ...r, left: Math.max(0, r.capacity - r.booked), level: crowd(r.date, r.time)?.level || null })));
});
app.post('/api/reception/book', requireStaff, (req, res) => {
  const d = readBookingBody(req);
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    const { b, slot } = createBooking({ ...d, source: 'reception', kind: 'extra', graceMs: 30 * 60 * 1000 });
    sendConfirmation(b, slot); adminAlert(b, slot, ' (reception)');
    res.json({ ok: true, bookingId: b.id, when: fmt(slot, d.lang) });
  } catch (e) { res.status(409).json({ error: e.message }); }
});
// Everything booked for today and tomorrow (all centers), with arrival status
app.get('/api/reception/bookings', requireStaff, (req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.name, b.phone, b.place, b.source, b.arrival, s.start_ts, s.date, s.time, s.center, s.kind
    FROM bookings b JOIN slots s ON s.id=b.slot_id
    WHERE b.status='booked' AND s.date IN (?, ?) ORDER BY s.start_ts, b.created_at`).all(...bookableDates());
  res.json(rows);
});
app.delete('/api/reception/bookings/:id', requireStaff, (req, res) => {
  const b = bookingById.get(Number(req.params.id));
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  if (req.role !== 'admin' && b.source !== 'reception') return res.status(403).json({ error: 'Reception can only cancel bookings made at reception.' });
  cancelByStaff(b); res.json({ ok: true });
});

// ---------- WhatsApp webhook (button replies: "I am here" / "NO") ----------
app.get('/webhook', (req, res) => {
  const tok = String(req.query['hub.verify_token'] || '');
  if (META_VERIFY_TOKEN && req.query['hub.mode'] === 'subscribe' && safeEq(tok, META_VERIFY_TOKEN)) return res.status(200).send(String(req.query['hub.challenge'] || ''));
  res.sendStatus(403);
});
app.post('/webhook', (req, res) => {
  if (META_APP_SECRET) {
    const got = String(req.headers['x-hub-signature-256'] || '');
    const want = 'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(req.rawBody || Buffer.alloc(0)).digest('hex');
    if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return res.sendStatus(401);
  }
  res.sendStatus(200); // answer fast; Meta retries if we are slow
  try {
    for (const entry of req.body.entry || []) for (const ch of entry.changes || []) for (const m of ch.value?.messages || []) {
      const payload = m.type === 'button' ? m.button?.payload : m.type === 'interactive' ? m.interactive?.button_reply?.id : '';
      const hit = /^(here|no):([0-9a-f]{32})$/.exec(String(payload || ''));
      if (!hit) continue;
      const b = bookingByToken.get(hit[2]);
      if (!b || b.status !== 'booked' || b.phone !== String(m.from)) continue; // reply must come from the booked number
      setArrival(b, hit[1]);
    }
  } catch (e) { console.error('[webhook]', e.message); }
});

// ---------- reminders: 1 hour before, 30 minutes before, and "Are you here!!" at slot time ----------
const dueQuery = (where) => db.prepare(`
  SELECT b.id,b.name,b.phone,b.lang,b.token,s.start_ts,s.date,s.time,s.duration_min,s.center
  FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.status='booked' AND ${where}`);
const due1h = dueQuery(`b.r1h=0 AND s.start_ts > ? AND s.start_ts - ? <= 60*60000 AND b.created_at <= s.start_ts - 70*60000`);
const due30 = dueQuery(`b.r30=0 AND s.start_ts > ? AND s.start_ts - ? <= 30*60000 AND b.created_at <= s.start_ts - 35*60000`);
const dueAsk = dueQuery(`b.asked=0 AND b.arrival='' AND s.start_ts <= ? AND s.start_ts >= ? - 30*60000 AND b.created_at <= s.start_ts - 10*60000`);
function runReminders() {
  const now = Date.now();
  for (const b of due1h.all(now, now)) {
    db.prepare(`UPDATE bookings SET r1h=1 WHERE id=?`).run(b.id);
    const l = pickLang(b.lang);
    sendWhatsApp(b.phone, T[l].reminder1h(b.name, fmt(b, l), centerName(b.center, l)),
      { name: 'prayer_reminder_1h', lang: l, params: [b.name, centerName(b.center, l), fmt(b, l)] });
  }
  for (const b of due30.all(now, now)) {
    db.prepare(`UPDATE bookings SET r30=1, r1h=1 WHERE id=?`).run(b.id);
    const l = pickLang(b.lang);
    sendWhatsApp(b.phone, T[l].reminder30(b.name, fmt(b, l), centerName(b.center, l)),
      { name: 'prayer_reminder_30m', lang: l, params: [b.name, centerName(b.center, l), fmt(b, l)] });
  }
  for (const b of dueAsk.all(now, now)) {
    db.prepare(`UPDATE bookings SET asked=1 WHERE id=?`).run(b.id);
    const l = pickLang(b.lang);
    sendWhatsApp(b.phone, T[l].arrival(b.name, centerName(b.center, l), manageUrl(b.token, '&ask=1')),
      { name: 'prayer_arrival_check', lang: l, params: [b.name, centerName(b.center, l)], buttons: [`here:${b.token}`, `no:${b.token}`] });
  }
}
setInterval(() => { try { runReminders(); } catch (e) { console.error('[reminders]', e.message); } }, Number(process.env.TICK_MS) || 60 * 1000).unref();

app.listen(PORT, () => console.log(`Prayer booking running at ${BASE_URL}`));
