// Per-account (per-email) failed sign-in throttle, in memory.
//
// Known accounts are also locked in the DB (users.locked_until), which survives a
// restart. This in-memory twin exists so an UNKNOWN email behaves exactly like a
// real one — 5 misses → 15-minute "too many attempts" — and the lockout response
// can't be used to discover which emails have accounts.
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 10000; // bound memory under an email-spraying attack

const entries = new Map(); // key → { count, lockedUntil, last }

function keyOf(email) {
  return String(email || '').trim().toLowerCase();
}

function prune(now) {
  if (entries.size < MAX_ENTRIES) return;
  for (const [k, e] of entries) {
    if ((e.lockedUntil || 0) < now && now - e.last > LOCKOUT_MS) entries.delete(k);
  }
  // Still full (all active) — drop the oldest to stay bounded.
  while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
}

function isLocked(email, now = Date.now()) {
  const e = entries.get(keyOf(email));
  return !!(e && e.lockedUntil && e.lockedUntil > now);
}

function recordFailure(email, now = Date.now()) {
  const k = keyOf(email);
  prune(now);
  let e = entries.get(k);
  // A failure streak older than the lockout window starts over.
  if (!e || (now - e.last > LOCKOUT_MS && !(e.lockedUntil > now))) e = { count: 0, lockedUntil: 0, last: now };
  e.count += 1;
  e.last = now;
  if (e.count >= MAX_FAILURES) { e.lockedUntil = now + LOCKOUT_MS; e.count = 0; }
  entries.set(k, e);
  return e.lockedUntil > now;
}

function clear(email) {
  entries.delete(keyOf(email));
}

function _reset() { entries.clear(); }

module.exports = { isLocked, recordFailure, clear, MAX_FAILURES, LOCKOUT_MS, _reset };
