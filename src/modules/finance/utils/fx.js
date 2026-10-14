// Single source of truth for the system FX rate.
//
// Previously 280 was hardcoded in 6 places (MoneyIn, MoneyOut, Profit,
// CostAllocation, InternalTransfers, FinanceOverview bucketize). The
// "real" rate already lives in the finance overview summary, but every
// caller did its own `|| 280` fallback — so changing the default meant
// 6 edits, and the per-row fallback in Overview's bucketize silently
// disagreed with the rate shown in the hero band.

import { useFinanceOverviewSummary } from '../../../api/queries';

// Owner decision D-10 (P2-20): there is NO default rate. The display rate is
// the latest one in Finance › Rates, shown as an estimate; with none on file a
// foreign figure has no PKR equivalent (null → shown as "—"), never one at a
// made-up 280.

// Hook: the latest USD/PKR rate the finance overview reports, or null while
// loading / when no rate is on file.
export function useFxRate() {
  const { data: summary = {} } = useFinanceOverviewSummary();
  return parseFloat(summary?.currentFxRate) || null;
}

// "1 USD = 281.5 PKR (estimated, 12 Oct)" / "(estimated, old rate)" / "No USD rate on file".
export function fxRateLabel(rate, { stale = false, date = null, currency = 'USD' } = {}) {
  const r = parseFloat(rate);
  if (!(r > 0)) return `No ${currency} rate on file`;
  const bits = ['estimated'];
  if (date) bits.push(String(date).slice(0, 10));
  if (stale) bits.push('old rate');
  return `1 ${currency} = ${r} PKR (${bits.join(', ')})`;
}

// Convert any foreign amount to PKR using whichever rate the caller has
// available (a stamped row rate wins; otherwise the given rate). Pure —
// used in places that can't call hooks. null when there is no rate.
export function toPkr(amount, currency, fxRate, fallbackRate = null) {
  const n = parseFloat(amount) || 0;
  const cur = String(currency || 'PKR').toUpperCase();
  if (cur === 'PKR') return n;
  const r = parseFloat(fxRate) || parseFloat(fallbackRate);
  return r > 0 ? n * r : null;
}
