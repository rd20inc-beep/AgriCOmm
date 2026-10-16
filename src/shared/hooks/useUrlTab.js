import { useSearchParams } from 'react-router-dom';

/**
 * Pick the tab a `?tab=` value asks for: the value when it is allowed, the
 * default otherwise (a stale or hand-typed tab must not render a blank page).
 * `allowedTabs` omitted/empty = any non-empty value is accepted.
 */
export function resolveTab(raw, defaultTab, allowedTabs) {
  if (!raw) return defaultTab;
  if (Array.isArray(allowedTabs) && allowedTabs.length && !allowedTabs.includes(raw)) return defaultTab;
  return raw;
}

/**
 * The search string after selecting `tab` — other params are kept, and the
 * default tab drops `?tab=` so the plain URL stays the canonical one.
 */
export function nextTabParams(prev, tab, defaultTab) {
  const next = new URLSearchParams(prev);
  if (!tab || tab === defaultTab) next.delete('tab');
  else next.set('tab', tab);
  return next;
}

/**
 * Tab state backed by the URL (`?tab=`), so a refresh, a shared link or Back
 * from a drill-down lands on the same tab. Uses `replace`, so flicking through
 * tabs does not fill the Back stack.
 *
 *   const [tab, setTab] = useUrlTab('overview', ['overview', 'documents']);
 */
export function useUrlTab(defaultTab, allowedTabs) {
  const [params, setParams] = useSearchParams();
  const tab = resolveTab(params.get('tab'), defaultTab, allowedTabs);
  const setTab = (value) => {
    setParams((prev) => {
      const current = resolveTab(prev.get('tab'), defaultTab, allowedTabs);
      const target = typeof value === 'function' ? value(current) : value;
      return nextTabParams(prev, target, defaultTab);
    }, { replace: true });
  };
  return [tab, setTab];
}

export default useUrlTab;
