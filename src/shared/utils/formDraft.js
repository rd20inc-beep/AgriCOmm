/**
 * Local drafts for long forms (P5-07): the export-order wizard saves what has
 * been entered at each step, so a slipped Escape, a crash or a closed tab does
 * not lose a three-step order.
 *
 * Stored in localStorage, keyed per form AND per user — a shared office PC must
 * not offer one clerk's half-entered order to the next person who logs in.
 * Drafts are local convenience only: nothing here talks to the server, and a
 * draft never posts anything by itself.
 */

const PREFIX = 'riceflow_draft';
export const DRAFT_VERSION = 1;
// A draft older than this is not offered back (prices, FX and stock move on).
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function draftKey(formName, userId) {
  return `${PREFIX}:${formName}:${userId ?? 'anon'}`;
}

export function saveDraft(formName, userId, data, now = Date.now()) {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(draftKey(formName, userId), JSON.stringify({ v: DRAFT_VERSION, savedAt: now, data }));
    return true;
  } catch {
    return false; // quota / private mode — a draft is best-effort
  }
}

/** The saved draft `{ savedAt, data }`, or null when none / stale / unreadable. */
export function loadDraft(formName, userId, now = Date.now()) {
  const ls = storage();
  if (!ls) return null;
  const key = draftKey(formName, userId);
  try {
    const raw = ls.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== DRAFT_VERSION || !parsed.data) { ls.removeItem(key); return null; }
    if (now - (parsed.savedAt || 0) > DRAFT_MAX_AGE_MS) { ls.removeItem(key); return null; }
    return { savedAt: parsed.savedAt, data: parsed.data };
  } catch {
    ls.removeItem(key);
    return null;
  }
}

export function clearDraft(formName, userId) {
  const ls = storage();
  if (!ls) return;
  try { ls.removeItem(draftKey(formName, userId)); } catch { /* ignore */ }
}
