// Single source of truth for the system FX rate.
//
// Previously 280 was hardcoded in 6 places (MoneyIn, MoneyOut, Profit,
// CostAllocation, InternalTransfers, FinanceOverview bucketize). The
// "real" rate already lives in the finance overview summary, but every
// caller did its own `|| 280` fallback — so changing the default meant
// 6 edits, and the per-row fallback in Overview's bucketize silently
// disagreed with the rate shown in the hero band.

import { useFinanceOverviewSummary } from '../../../api/queries';

// Historical default — only used when the overview summary hasn't loaded
// or the row has no booked rate stamped on it. Kept here so there is
// exactly one place to change.
export const DEFAULT_FX_RATE = 280;

// Hook: returns the current USD/PKR rate the finance overview considers
// authoritative. Falls back to DEFAULT_FX_RATE while loading or when
// the summary endpoint hasn't been populated yet.
export function useFxRate() {
  const { data: summary = {} } = useFinanceOverviewSummary();
  return parseFloat(summary?.currentFxRate) || DEFAULT_FX_RATE;
}

// Convert any foreign amount to PKR using whichever rate the caller has
// available (a stamped row rate wins; otherwise the system rate). Pure
// function — used in places that can't call hooks (helpers, csv export).
export function toPkr(amount, currency, fxRate, fallbackRate = DEFAULT_FX_RATE) {
  const n = parseFloat(amount) || 0;
  const cur = String(currency || 'PKR').toUpperCase();
  if (cur === 'PKR') return n;
  const r = parseFloat(fxRate) || fallbackRate;
  return n * r;
}
