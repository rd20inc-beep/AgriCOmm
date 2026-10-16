import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext } from 'react-router-dom';
import DiscardChangesDialog from '../components/DiscardChangesDialog';
import { BlockerGuard, NavigatorGuard } from '../components/DirtyGuardHosts';
import { beforeUnloadHandler } from '../utils/dirtyGuard';

/**
 * Unsaved-changes guard for long pages (P5-07).
 *
 *   const guard = useDirtyGuard(dirty);
 *   …on a successful save, before navigating away: guard.release();
 *   return (<>{guard.dialog} …</>);
 *
 * While `dirty`:
 *  - closing / reloading the tab gets the browser's own "Leave site?" prompt
 *    (beforeunload — browsers do not allow a custom dialog there);
 *  - leaving the page inside the app (sidebar link, Back button in the page,
 *    any navigate()) shows the in-app "Discard unsaved changes?" prompt.
 *    Under a data router this is react-router's useBlocker (which also catches
 *    the browser Back button); under <BrowserRouter>, which the app mounts
 *    today, the router's navigator is wrapped instead — the browser's own Back
 *    button is not interceptable there.
 *  - search-only changes (`?tab=`, filters) never prompt.
 *
 * `release()` switches the guard off (e.g. right before navigating to the
 * record a successful save created) without waiting for a re-render.
 * `confirmDiscard()` resolves true/false — for a page's own Cancel button.
 */
export default function useDirtyGuard(dirty, { consequence } = {}) {
  const dirtyRef = useRef(!!dirty);
  const releasedRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = !!dirty;
    // Becoming clean re-arms the guard for the next edit after a release.
    if (!dirty) releasedRef.current = false;
  }, [dirty]);
  const isDirty = useCallback(() => dirtyRef.current && !releasedRef.current, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = beforeUnloadHandler(isDirty);
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const [pending, setPending] = useState(null); // { proceed, cancel }
  const ask = useCallback((proceed, cancel) => setPending({ proceed, cancel }), []);

  const release = useCallback(() => { releasedRef.current = true; }, []);
  const confirmDiscard = useCallback(() => new Promise((resolve) => {
    if (!isDirty()) { resolve(true); return; }
    ask(() => resolve(true), () => resolve(false));
  }), [ask, isDirty]);

  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const Guard = dataRouter ? BlockerGuard : NavigatorGuard;

  const dialog = (
    <>
      <Guard isDirty={isDirty} ask={ask} />
      <DiscardChangesDialog
        open={!!pending}
        consequence={consequence}
        onDiscard={() => {
          const p = pending; setPending(null);
          // Leaving deliberately: the navigation it runs must not re-prompt.
          releasedRef.current = true;
          p?.proceed?.();
        }}
        onKeep={() => { const p = pending; setPending(null); p?.cancel?.(); }}
      />
    </>
  );

  return { dialog, release, confirmDiscard, isDirty };
}
