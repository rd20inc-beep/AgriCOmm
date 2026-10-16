import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { resolveLocation, rememberedPeriod, rememberPeriod } from '../urlState';

/**
 * The Mill Finance screen state, read from and written to the URL.
 *
 * The period also lives in sessionStorage, so coming back to Mill Finance from
 * a lot, a batch or a statement (a link without ?period=) keeps the period the
 * user had picked instead of snapping back to "This month".
 */
export default function useMillFinanceLocation() {
  const [params, setParams] = useSearchParams();
  const loc = useMemo(() => resolveLocation(params, { fallbackPeriod: rememberedPeriod() }), [params]);

  // Merge `patch` into the URL. `null` deletes a key. A section change drops
  // the per-section keys of the old section so they never leak across.
  const go = useCallback((patch, { replace = false } = {}) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      // A legacy ?tab= link: write out where it resolved to, then drop it, so
      // the next change starts from the new keys.
      if (p.has('tab')) {
        p.delete('tab');
        if (!p.has('section') && !loc.workspace) {
          p.set('section', loc.section);
          if (loc.section === 'transactions') p.set('view', loc.view);
          if (loc.section === 'parties') p.set('party', loc.party);
          if (loc.cat) p.set('cat', loc.cat);
          if (loc.focus) p.set('focus', loc.focus);
        }
      }
      if (patch.section && patch.section !== prev.get('section')) {
        for (const k of ['view', 'party', 'cat', 'focus', 'supplier', 'customer', 'dir', 'status', 'q']) if (!(k in patch)) p.delete(k);
        p.delete('workspace');
      }
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') p.delete(k); else p.set(k, String(v));
      }
      if (!p.get('period') && !p.get('workspace')) p.set('period', loc.period);
      return p;
    }, { replace });
  }, [setParams, loc]);

  const setPeriod = useCallback((period) => {
    rememberPeriod(period);
    go({ period }, { replace: true });
  }, [go]);

  return { ...loc, go, setPeriod };
}
