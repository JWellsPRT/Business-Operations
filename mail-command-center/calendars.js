// Combined calendar: reads each account's calendar through its private iCal
// address ("Secret address in iCal format" in Google Calendar settings) and
// merges the next couple of weeks into one agenda.
//
// Anyone who has a secret iCal address can read that calendar, so the addresses
// are stored encrypted with safeStorage (DPAPI on Windows, Keychain on macOS),
// like saved passwords. They are only ever sent to the calendar's own server,
// and the UI only learns how many are connected.

const { app, net, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const ICAL = require('ical.js');

const DAYS_AHEAD = 14;
const REFRESH_EVERY_MS = 15 * 60 * 1000;
const MAX_OCCURRENCES = 50_000; // per recurring event, so a bad rule can't loop forever

const file = () => path.join(app.getPath('userData'), 'calendars.json');
let store = null; // accountId -> [base64 ciphertext of a feed URL]

function load() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { store = {}; }
  return store;
}
function persist() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

const available = () => safeStorage.isEncryptionAvailable();
const count = (id) => (load()[id] || []).length;

// Accepts pasted text: one address per line. Google shows the address with an
// https:// or webcal:// prefix; both are fetched over https.
function parseFeedList(text) {
  const urls = [];
  for (const line of String(text || '').split(/\s+/)) {
    if (!line) continue;
    const u = line.replace(/^webcals?:\/\//i, 'https://');
    let parsed;
    try { parsed = new URL(u); } catch { throw new Error(`"${line.slice(0, 60)}" isn't a web address.`); }
    if (parsed.protocol !== 'https:') throw new Error('Calendar addresses must start with https:// (or webcal://).');
    urls.push(parsed.toString());
  }
  return [...new Set(urls)];
}

// Replace an account's feeds. Throws (saving nothing) if the text is invalid or
// secure storage isn't available.
function setFeeds(id, text) {
  const urls = parseFeedList(text);
  const s = load();
  if (!urls.length) { delete s[id]; persist(); return 0; }
  if (!available()) throw new Error("Secure storage isn't available on this computer, so calendar addresses can't be saved.");
  s[id] = urls.map((u) => safeStorage.encryptString(u).toString('base64'));
  persist();
  return urls.length;
}

function remove(id) {
  const s = load();
  if (s[id]) { delete s[id]; persist(); }
}

function feedsFor(id) {
  if (!available()) return [];
  return (load()[id] || []).map((c) => {
    try { return safeStorage.decryptString(Buffer.from(c, 'base64')); } catch { return null; }
  }).filter(Boolean);
}

// ---------- Parsing ----------
const ymd = (t) => `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

// Expand an iCalendar document into the occurrences that overlap [from, to).
// Handles time zones (VTIMEZONE), all-day events, RRULE/RDATE/EXDATE recurrence,
// moved or edited single occurrences (RECURRENCE-ID) and cancelled ones.
function parseICS(text, from, to) {
  const cal = new ICAL.Component(ICAL.parse(text));
  for (const tz of cal.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch { /* malformed zone: times fall back to floating */ }
  }

  const groups = new Map(); // UID -> { master, exceptions[] }
  for (const ve of cal.getAllSubcomponents('vevent')) {
    const uid = ve.getFirstPropertyValue('uid') || `nouid-${groups.size}`;
    const g = groups.get(uid) || { master: null, exceptions: [] };
    if (ve.hasProperty('recurrence-id')) g.exceptions.push(ve); else g.master = ve;
    groups.set(uid, g);
  }

  const out = [];
  const add = (start, end, item) => {
    if (String(item.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    const allDay = start.isDate;
    let endTime = end || start;
    if (allDay && (!end || end.compare(start) <= 0)) { endTime = start.clone(); endTime.day += 1; }
    const s = start.toJSDate(), e = endTime.toJSDate();
    if (e <= from || s >= to) return;
    out.push({
      uid: item.uid,
      title: item.summary || '(No title)',
      location: item.location || '',
      allDay,
      start: allDay ? ymd(start) : s.toISOString(),
      end: allDay ? ymd(endTime) : e.toISOString(), // all-day end is exclusive, as in iCalendar
    });
  };

  for (const g of groups.values()) {
    if (!g.master) { // edited occurrences whose series isn't in the feed
      for (const ex of g.exceptions) { const e = new ICAL.Event(ex); add(e.startDate, e.endDate, e); }
      continue;
    }
    const event = new ICAL.Event(g.master);
    for (const ex of g.exceptions) event.relateException(ex);
    if (!event.isRecurring()) { add(event.startDate, event.endDate, event); continue; }

    const it = event.iterator();
    for (let next, n = 0; (next = it.next()) && n < MAX_OCCURRENCES; n++) {
      const occ = event.getOccurrenceDetails(next);
      if (occ.startDate.toJSDate() >= to) break;
      add(occ.startDate, occ.endDate, occ.item);
    }
  }
  return out;
}

// ---------- Fetching ----------
let latest = { events: [], errors: [], updatedAt: null, loading: false };
let timer = null;

function windowRange() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + DAYS_AHEAD + 1);
  return { from, to };
}

// Describe a failure without ever including the secret address.
function describe(err, res) {
  if (res) {
    if (res.status === 404) return 'Calendar address not found. It may have been reset in Google Calendar; paste the new one.';
    if (res.status === 401 || res.status === 403) return 'Access denied. The address may have been reset, or your organization may block secret addresses.';
    return `The calendar server answered ${res.status}.`;
  }
  return /parse|unexpected|invalid/i.test(err?.message || '') ? "That address didn't return a calendar." : 'Could not reach the calendar server.';
}

async function refresh(accounts, onUpdate) {
  latest = { ...latest, loading: true };
  onUpdate(latest);
  const { from, to } = windowRange();
  const events = [], errors = [];
  await Promise.all(accounts.flatMap((a) => feedsFor(a.id).map(async (url, i) => {
    let res = null;
    try {
      res = await net.fetch(url, { headers: { Accept: 'text/calendar' }, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) throw new Error('parse: not a calendar');
      for (const ev of parseICS(text, from, to)) events.push({ ...ev, accountId: a.id });
    } catch (err) {
      errors.push({ accountId: a.id, feed: i + 1, message: describe(err, res && !res.ok ? res : null) });
    }
  })));
  // The same event can be on several connected calendars (e.g. an invite).
  const seen = new Set();
  const unique = events.filter((e) => {
    const k = `${e.accountId}|${e.uid}|${e.start}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  unique.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : (y.allDay - x.allDay)));
  latest = { events: unique, errors, updatedAt: new Date().toISOString(), loading: false, days: DAYS_AHEAD };
  onUpdate(latest);
  return latest;
}

function start(getAccounts, onUpdate) {
  const run = () => refresh(getAccounts(), onUpdate).catch(() => {});
  setTimeout(run, 3000);
  clearInterval(timer);
  timer = setInterval(run, REFRESH_EVERY_MS);
  return run;
}

module.exports = { available, count, setFeeds, remove, start, current: () => latest, parseICS, parseFeedList };
