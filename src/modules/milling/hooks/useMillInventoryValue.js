import { useMemo } from 'react';
import { useApp } from '../../../context/AppContext';
import { useCommodityRates } from '../../../api/queries';

/**
 * Canonical mill inventory valuation — single source of truth.
 * Uses actual lot costs where available, commodity rates for market-value fallback.
 */

const FALLBACK_RATES_PER_KG = { broken: 38, bran: 28, husk: 8.4 };

function getRatePerKG(rates, rateType, fallback) {
  if (!Array.isArray(rates)) return fallback;
  const found = rates.find(r => r.rate_type === rateType || r.rateType === rateType);
  return found ? (parseFloat(found.rate_value || found.rateValue) || fallback * 1000) / 1000 : fallback;
}

export function useMillInventoryValue() {
  const { inventory } = useApp();
  const { data: rates = [] } = useCommodityRates();

  return useMemo(() => {
    const lots = Array.isArray(inventory) ? inventory : [];

    const rawLots = lots.filter(l => l.type === 'raw' && l.entity === 'mill');
    const finishedLots = lots.filter(l => l.type === 'finished' && l.entity === 'mill');
    const byproductLots = lots.filter(l => l.type === 'byproduct' && l.entity === 'mill');

    // Rate per KG from commodity rates (converted from per-MT)
    const brokenRateKG = getRatePerKG(rates, 'broken_rice', FALLBACK_RATES_PER_KG.broken);
    const branRateKG = getRatePerKG(rates, 'bran', FALLBACK_RATES_PER_KG.bran);
    const huskRateKG = getRatePerKG(rates, 'husk', FALLBACK_RATES_PER_KG.husk);

    const rawQty = rawLots.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
    const rawValue = rawLots.reduce((s, l) => {
      const rateKG = parseFloat(l.ratePerKg) || parseFloat(l.landedCostPerKg) || 0;
      const weightKG = parseFloat(l.netWeightKg) || (parseFloat(l.qty) || 0) * 1000;
      return s + rateKG * weightKG;
    }, 0);

    const finishedQty = finishedLots.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
    const finishedValue = finishedLots.reduce((s, l) => {
      const rateKG = parseFloat(l.ratePerKg) || parseFloat(l.landedCostPerKg) || parseFloat(l.costPerUnit) / 1000 || 0;
      const weightKG = parseFloat(l.netWeightKg) || (parseFloat(l.qty) || 0) * 1000;
      return s + rateKG * weightKG;
    }, 0);

    const byproductQty = byproductLots.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
    const byproductValue = byproductLots.reduce((s, l) => {
      const name = (l.itemName || '').toLowerCase();
      const marketRate = name.includes('broken') ? brokenRateKG : name.includes('bran') ? branRateKG : huskRateKG;
      const rateKG = parseFloat(l.ratePerKg) || parseFloat(l.landedCostPerKg) || marketRate;
      const weightKG = parseFloat(l.netWeightKg) || (parseFloat(l.qty) || 0) * 1000;
      return s + rateKG * weightKG;
    }, 0);

    return {
      raw: { qty: rawQty, value: rawValue, lots: rawLots.length },
      finished: { qty: finishedQty, value: finishedValue, lots: finishedLots.length },
      byproduct: { qty: byproductQty, value: byproductValue, lots: byproductLots.length },
      total: rawValue + finishedValue + byproductValue,
      priceSource: rates.length > 0 ? 'commodity_rate_master' : 'fallback',
    };
  }, [inventory, rates]);
}
