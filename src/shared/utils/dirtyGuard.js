/**
 * Pure pieces of the unsaved-changes guard (P5-07). The React parts live in
 * SlideDrawer / Modal (`dirty` prop) and `useDirtyGuard`; the decisions are
 * here so they can be tested without a DOM.
 */

export const DISCARD_TITLE = 'Discard unsaved changes?';
export const DISCARD_CONSEQUENCE = 'What you have entered on this form will be lost.';

/**
 * A close request for a drawer/modal: closes straight away when clean, asks
 * first when dirty. `ask(onConfirmed)` shows the in-app confirm.
 */
export function requestClose({ dirty, onClose, ask }) {
  if (dirty) { ask(() => onClose?.()); return 'asked'; }
  onClose?.();
  return 'closed';
}

/**
 * Escape handling for an overlay. While its own discard prompt is showing the
 * overlay ignores Escape (the prompt handles it — it cancels the prompt, it does
 * not close the form underneath).
 */
export function escapeAction(e, { asking }) {
  if (e?.key !== 'Escape') return null;
  if (asking) return null;
  return 'request-close';
}

/** Does navigating to `to` leave the current page (pathname differs)? */
export function leavesPage(to, currentPathname, base = 'http://app.local') {
  if (to === undefined || to === null) return false;
  if (typeof to === 'number') return to !== 0;
  let pathname;
  if (typeof to === 'string') {
    try { pathname = new URL(to, base + currentPathname).pathname; } catch { return true; }
  } else {
    pathname = to.pathname;
    if (!pathname) return false; // search/hash-only change (e.g. ?tab=)
  }
  return pathname !== currentPathname;
}

/**
 * Wrap a react-router navigator (BrowserRouter's history adapter) so push /
 * replace / go that would leave the page ask first while `isDirty()`.
 * Search-only changes (tabs, filters) pass through. Returns a restore function.
 *
 * Used because the app mounts <BrowserRouter>, where useBlocker is not
 * available; under a data router useDirtyGuard uses useBlocker instead.
 */
export function guardNavigator(navigator, { isDirty, ask, currentPathname }) {
  const original = { push: navigator.push, replace: navigator.replace, go: navigator.go };
  const wrap = (name, getTarget) => function guarded(...args) {
    const run = () => original[name].apply(navigator, args);
    if (!isDirty() || !leavesPage(getTarget(args), currentPathname())) return run();
    ask(run);
    return undefined;
  };
  navigator.push = wrap('push', (a) => a[0]);
  navigator.replace = wrap('replace', (a) => a[0]);
  if (typeof original.go === 'function') navigator.go = wrap('go', (a) => a[0]);
  return () => {
    navigator.push = original.push;
    navigator.replace = original.replace;
    if (typeof original.go === 'function') navigator.go = original.go;
  };
}

/** beforeunload listener that triggers the browser's own "Leave site?" prompt. */
export function beforeUnloadHandler(isDirty) {
  return (e) => {
    if (!isDirty()) return undefined;
    e.preventDefault();
    // Chrome/Edge still need returnValue set.
    e.returnValue = '';
    return '';
  };
}

/**
 * Shallow-ish "has this form changed" check: JSON comparison of the current
 * values against the values the form opened with. Good enough for plain form
 * state objects/arrays.
 */
export function isFormDirty(initial, current) {
  try { return JSON.stringify(initial) !== JSON.stringify(current); } catch { return true; }
}
