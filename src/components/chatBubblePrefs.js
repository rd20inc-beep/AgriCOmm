/**
 * Where the chat bubble sits, and whether it is shown at all.
 *
 * The bubble is fixed above everything (z-60) at the bottom-right, so it covers
 * whatever is underneath — table actions, totals, the last row of a report. This
 * lets a user drag it somewhere harmless or hide it entirely, and bring it back
 * from the user menu.
 *
 * Per-viewer preference, so localStorage is the right home: it never needs to
 * reach the server or another device. Every read and write is guarded because
 * localStorage throws in a private window and returns nothing with site data
 * cleared — the bubble must still render in its default corner.
 */

const HIDDEN_KEY = 'riceflow_chat_hidden';
const POS_KEY = 'riceflow_chat_pos';
export const CHAT_PREFS_EVENT = 'riceflow:chat-prefs';

function read(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* private window / blocked storage — preference just won't persist */ }
}

export function isChatHidden() {
  return read(HIDDEN_KEY) === '1';
}

export function setChatHidden(hidden) {
  write(HIDDEN_KEY, hidden ? '1' : null);
  announce();
}

/** {x, y} viewport coordinates of the bubble's top-left, or null for the default corner. */
export function getChatPos() {
  const raw = read(POS_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
  } catch { /* corrupt — fall back to the default corner */ }
  return null;
}

export function setChatPos(pos) {
  write(POS_KEY, pos ? JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }) : null);
  announce();
}

/** Keep a dragged bubble on screen — a window resize must not strand it. */
export function clampToViewport(pos, size = 56) {
  const maxX = Math.max(0, window.innerWidth - size - 4);
  const maxY = Math.max(0, window.innerHeight - size - 4);
  return { x: Math.min(Math.max(4, pos.x), maxX), y: Math.min(Math.max(4, pos.y), maxY) };
}

// The bubble and the user menus live in different trees, so a plain event keeps
// them in step without threading state through every layout.
function announce() {
  try { window.dispatchEvent(new CustomEvent(CHAT_PREFS_EVENT)); } catch { /* SSR / no window */ }
}

export function onChatPrefsChange(handler) {
  window.addEventListener(CHAT_PREFS_EVENT, handler);
  window.addEventListener('storage', handler);   // another tab changed it
  return () => {
    window.removeEventListener(CHAT_PREFS_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
