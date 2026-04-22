import { useMemo } from 'react';
import { useCommodityRates } from '../../../api/queries';

/**
 * Shared hook for commodity prices — single source of truth.
 * Pulls from commodity_rate_master, falls back to defaults.
 * Use this instead of hardcoding 72800/42000/22400/8400.
 */

const FALLBACK = {
  finished_rice: 72800,
  broken_rice: 42000,
  bran: 22400,
  husk: 8400,
};

function getRate(rates, type, fallback) {
  if (!Array.isArray(rates)) return fallback;
  const found = rates.find(r => (r.rate_type || r.rateType) === type);
  return found ? parseFloat(found.rate_value || found.rateValue) || fallback : fallback;
}

export function useCommodityPrices() {
  const { data: rates = [] } = useCommodityRates();

  return useMemo(() => ({
    finished: getRate(rates, 'finished_rice', FALLBACK.finished_rice),
    broken: getRate(rates, 'broken_rice', FALLBACK.broken_rice),
    bran: getRate(rates, 'bran', FALLBACK.bran),
    husk: getRate(rates, 'husk', FALLBACK.husk),
    source: Array.isArray(rates) && rates.length > 0 ? 'live' : 'fallback',
  }), [rates]);
}
