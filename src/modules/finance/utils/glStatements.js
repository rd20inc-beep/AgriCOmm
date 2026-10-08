// Helpers for the read-only GL statement views. The general ledger is kept
// in PKR only, so every figure is rupees, from Posted journals only.
import { useSearchParams } from 'react-router-dom';
import { fmtPKR } from '../../../shared/utils/format';

export const ENTITIES = [
  ['all', 'All'], ['export', 'Export'], ['mill', 'Mill'], ['general', 'General'],
];

export const pkr = (v) => fmtPKR(Number(v) || 0, { decimals: 2 });

// The entity filter lives in the URL (?entity=) so the view can be shared.
export function useGlEntity() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('entity') || 'all';
  const entity = ENTITIES.some(([k]) => k === raw) ? raw : 'all';
  const setEntity = (next) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next && next !== 'all') p.set('entity', next); else p.delete('entity');
      return p;
    }, { replace: true });
  };
  return { entity, setEntity, apiEntity: entity === 'all' ? undefined : entity };
}

// Statement API params from the finance period (useFinanceDateRange's
// queryParams = { from_date, to_date } or {} for all time).
//   asOf   → { as_of_date }            (trial balance, balance sheet)
//   period → { period_start, period_end } (P&L)
export function glParams(mode, range = {}, entity) {
  const out = {};
  if (mode === 'asOf') {
    if (range.to_date) out.as_of_date = range.to_date;
  } else {
    if (range.from_date) out.period_start = range.from_date;
    if (range.to_date) out.period_end = range.to_date;
  }
  if (entity) out.entity = entity;
  return out;
}
