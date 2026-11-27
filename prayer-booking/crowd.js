// Typical number of people per hour, by weekday (0=Sun..6=Sat), from the church's own records.
// Index 0 = 8-9 AM ... index 13 = 9-10 PM. null = closed / no data for that hour.
const FIRST_HOUR = 8;
const DATA = {
  1: [5, 9, 12, 11, 7, 5, 5, 5, 6, 8, 7, 9, 7, 3],               // Mon
  2: [2, 7, 11, 11, 6, 6, 5, 4, 6, 9, 8, 8, 4, null],             // Tue
  4: [3, 11, 13, 12, 9, 6, 5, 8, 6, 7, 9, 9, 5, 4],               // Thu
  5: [10, 15, 19, 16, 9, 7, 8, 7, 8, 11, 10, 11, 7, 4],           // Fri
  6: [2, 8, 8, 6, 7, 6, 6, 6, 2, null, null, null, null, null],   // Sat
};
const TOTAL = { 1: 99, 2: 87, 4: 107, 5: 142, 6: 51 };   // total per day (sum of the hours)
const AVG = { 1: 71, 2: 65, 4: 77, 5: 104, 6: 36 };      // average people per day

// Busy colors: red >= 10 people, orange 6-9, green <= 5
const RED_FROM = 10, ORANGE_FROM = 6;
const levelOf = (n) => (n == null ? null : n >= RED_FROM ? 'red' : n >= ORANGE_FROM ? 'orange' : 'green');
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

// Crowd info for a slot starting at `time` (HH:MM) on `date` (YYYY-MM-DD)
function crowd(date, time) {
  const row = DATA[weekdayOf(date)];
  if (!row) return null;
  const n = row[parseInt(time, 10) - FIRST_HOUR];
  return n == null ? null : { level: levelOf(n), people: n };
}

const pad = (n) => String(n).padStart(2, '0');

// How many slots fit in each open hour for a given slot length and people per slot.
function planHours(date, minutes, people) {
  const wd = weekdayOf(date), row = DATA[wd];
  if (!row) return null;
  const m = Math.min(Math.max(parseInt(minutes, 10) || 30, 5), 60);
  const p = Math.min(Math.max(parseInt(people, 10) || 1, 1), 100);
  const slots = Math.floor(60 / m);
  const hours = [];
  row.forEach((n, i) => {
    if (n == null) return;
    const h = FIRST_HOUR + i;
    const expected = Math.round((n * AVG[wd]) / TOTAL[wd]); // data scaled to the average day
    const capacity = slots * p;
    hours.push({
      hour: h, level: levelOf(n), people: n, expected, slots, capacity,
      short: Math.max(0, expected - capacity), leftover: 60 - slots * m,
      times: Array.from({ length: slots }, (_, k) => `${pad(h)}:${pad(k * m)}`),
    });
  });
  const sum = (k) => hours.reduce((a, h) => a + h[k], 0);
  return { weekday: wd, minutes: m, people: p, slotsPerHour: slots, peoplePerHour: slots * p, avgPerDay: AVG[wd],
    hours, totals: { slots: sum('slots'), capacity: sum('capacity'), expected: sum('expected') } };
}

module.exports = { crowd, planHours, levelOf, weekdayOf, DATA, AVG, TOTAL, FIRST_HOUR };
