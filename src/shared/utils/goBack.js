/**
 * Safe "Back" for in-app back buttons.
 *
 * A bare `navigate(-1)` leaves the app when the page was opened directly — a QR
 * scan, a link pasted into a new tab, a bookmark — and there is no earlier
 * entry of ours on the stack. react-router stamps every history entry it
 * creates with an `idx` (0 for the entry the app was loaded on), so `idx > 0`
 * means there is an in-app page to go back to.
 *
 *   <button onClick={() => goBack(navigate, '/export')}>Back</button>
 *
 * @param {Function} navigate  react-router's navigate()
 * @param {string}   fallback  where to go when there is no in-app history
 * @param {object}   [historyState]  defaults to window.history.state (tests pass one)
 */
export function hasInAppHistory(historyState) {
  const state = historyState === undefined
    ? (typeof window !== 'undefined' ? window.history?.state : null)
    : historyState;
  const idx = state?.idx;
  return typeof idx === 'number' && idx > 0;
}

export function goBack(navigate, fallback = '/', historyState) {
  if (hasInAppHistory(historyState)) {
    navigate(-1);
  } else {
    // replace, so the dead-end entry the user arrived on is not left behind
    // for a second Back to return to.
    navigate(fallback, { replace: true });
  }
}

export default goBack;
