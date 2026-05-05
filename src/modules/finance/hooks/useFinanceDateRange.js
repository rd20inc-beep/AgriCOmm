import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// Reads the global ?range= param set by FinanceLayout's date dropdown
// (today / week / month / quarter / year / '' for all-time) and
// resolves it into ISO date strings the backend list endpoints accept
// as from_date / to_date.
//
// Returns an object that's safe to spread directly into the React-
// Query hooks (useReceivables / usePayables / useJournalEntries /
// useBankTransactions / useExpenses):
//
//   const { rangeKey, queryParams } = useFinanceDateRange();
//   const { data } = useReceivables(queryParams);
//
// queryParams is empty {} when range is empty so all-time queries
// don't get an unnecessary cache key; rangeKey is forwarded to the
// query for cache uniqueness.

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function isoDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function resolveRange(key) {
  if (!key) return null;
  const now = new Date();
  switch (key) {
    case 'today': {
      return { from: startOfDay(now), to: endOfDay(now) };
    }
    case 'week': {
      // Monday-start week.
      const day = now.getDay() || 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: startOfDay(monday), to: endOfDay(sunday) };
    }
    case 'month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: startOfDay(first), to: endOfDay(last) };
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      const first = new Date(now.getFullYear(), q * 3, 1);
      const last  = new Date(now.getFullYear(), q * 3 + 3, 0);
      return { from: startOfDay(first), to: endOfDay(last) };
    }
    case 'year': {
      const first = new Date(now.getFullYear(), 0, 1);
      const last  = new Date(now.getFullYear(), 11, 31);
      return { from: startOfDay(first), to: endOfDay(last) };
    }
    default:
      return null;
  }
}

export function useFinanceDateRange() {
  const [params] = useSearchParams();
  const rangeKey = params.get('range') || '';

  return useMemo(() => {
    const range = resolveRange(rangeKey);
    if (!range) {
      return { rangeKey, from: null, to: null, queryParams: {} };
    }
    const from_date = isoDateOnly(range.from);
    const to_date   = isoDateOnly(range.to);
    return {
      rangeKey,
      from: range.from,
      to: range.to,
      queryParams: { from_date, to_date },
    };
  }, [rangeKey]);
}
