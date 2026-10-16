import { useContext, useEffect } from 'react';
import { UNSAFE_NavigationContext, useBlocker } from 'react-router-dom';
import { guardNavigator, leavesPage } from '../utils/dirtyGuard';

/**
 * Router adapters for useDirtyGuard. Which one renders is decided by whether a
 * data router is mounted — fixed for the app's lifetime, so the hooks inside
 * each are never called conditionally.
 */

/** <BrowserRouter>: wrap the navigator so in-app navigation asks first. */
export function NavigatorGuard({ isDirty, ask }) {
  const nav = useContext(UNSAFE_NavigationContext);
  const navigator = nav?.navigator;
  useEffect(() => {
    if (!navigator || typeof window === 'undefined') return undefined;
    return guardNavigator(navigator, {
      isDirty,
      ask: (run) => ask(run),
      currentPathname: () => window.location.pathname,
    });
  }, [navigator, isDirty, ask]);
  return null;
}

/** Data router: react-router's own blocker (also catches the browser Back button). */
export function BlockerGuard({ isDirty, ask }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    isDirty() && leavesPage(nextLocation, currentLocation.pathname)
  ));
  useEffect(() => {
    if (blocker.state === 'blocked') ask(() => blocker.proceed(), () => blocker.reset());
  }, [blocker, ask]);
  return null;
}
