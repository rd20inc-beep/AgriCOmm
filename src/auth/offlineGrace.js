// Offline auth grace (Stage 9, R7). A session works offline only for a bounded
// window after the last SUCCESSFUL online authentication. Beyond it, the user is
// forced to reconnect (their queued work is preserved; nothing is wiped — grace
// expiry is not revocation). This bounds the risk of a lost/stolen device that
// holds a cached session.
const LAST_ONLINE_KEY = 'riceflow_last_online';

// 72 hours (owner-approved R7). Kept client-side; can be made server-driven later.
export const OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;

export function markOnlineAuth() {
  try { localStorage.setItem(LAST_ONLINE_KEY, String(Date.now())); } catch { /* noop */ }
}

export function lastOnlineAuth() {
  try {
    const v = parseInt(localStorage.getItem(LAST_ONLINE_KEY), 10);
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

export function clearOnlineAuth() {
  try { localStorage.removeItem(LAST_ONLINE_KEY); } catch { /* noop */ }
}

// Grandfather an existing session (cached before this feature shipped) so it gets
// a fresh window from now instead of being locked out immediately.
export function seedOnlineAuthIfMissing() {
  if (!lastOnlineAuth()) markOnlineAuth();
}

// True while offline access is still permitted.
export function isOfflineGraceValid(now = Date.now()) {
  const last = lastOnlineAuth();
  if (!last) return false; // never authenticated online → no offline grace
  return now - last < OFFLINE_GRACE_MS;
}

// Hours remaining in the window (0 if lapsed) — for the UI.
export function graceHoursRemaining(now = Date.now()) {
  const last = lastOnlineAuth();
  if (!last) return 0;
  return Math.max(0, Math.round((OFFLINE_GRACE_MS - (now - last)) / 3_600_000));
}
