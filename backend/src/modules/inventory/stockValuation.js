/**
 * Value stock held at its SELLING price, to show profit on what is still on hand.
 *
 * Cost already lives on every lot (cost_per_unit, per KG). Selling prices live in
 * commodity_rate_master, keyed here by product + grade:
 *   - by-products are priced per GRADE   (B2, B3, CSR, SWEEPING, STONE)
 *   - finished and raw are priced per PRODUCT (the variety); grade is null
 *
 * ⚠ UNITS. Lot costs are per KG. commodity_rate_master.unit defaults to 'per_mt'
 * — the one existing row is 35,000 per_mt, i.e. 35/kg. Mixing the two is how the
 * Mill Finance dashboard once reported Rs 88 billion of stock, so every rate is
 * normalised to per-kg here, once, and that conversion is the most-tested thing
 * in this file.
 *
 * A lot with no rate is reported as hasRate:false and contributes NOTHING to
 * market value or profit — it is never silently valued at cost, which would
 * understate profit and look like a real number.
 */

const PER_MT = 1000;

/** Rate rows arrive in whatever unit they were entered. Costs are per kg. */
function toPerKg(rateValue, unit) {
  const v = parseFloat(rateValue);
  if (!Number.isFinite(v)) return null;
  const u = String(unit || 'per_mt').toLowerCase().trim();
  if (u === 'per_kg' || u === 'kg' || u === 'per-kg') return v;
  if (u === 'per_mt' || u === 'mt' || u === 'per_ton' || u === 'ton' || u === 'per-mt') return v / PER_MT;
  return null;   // an unknown unit must not be guessed at
}

const keyOf = (productId, grade) => `${productId == null ? '' : productId}|${(grade || '').toUpperCase()}`;

/**
 * Index rate rows by product+grade, newest effective_date winning.
 * Falls back to a product-wide rate (grade null) when no grade-specific one exists.
 */
function buildRateIndex(rows) {
  const idx = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const perKg = toPerKg(r.rate_value ?? r.rateValue, r.unit);
    if (perKg === null) continue;
    const k = keyOf(r.product_id ?? r.productId, r.product_type ?? r.productType);
    const when = r.effective_date ?? r.effectiveDate ?? '';
    const prev = idx.get(k);
    if (!prev || String(when) >= String(prev.effectiveDate)) {
      idx.set(k, { perKg, effectiveDate: String(when), unit: r.unit, id: r.id });
    }
  }
  return idx;
}

/** The rate for a lot: exact product+grade first, then the product on its own. */
function rateForLot(lot, idx) {
  if (!idx || idx.size === 0) return null;
  return idx.get(keyOf(lot.product_id ?? lot.productId, lot.grade))
      || idx.get(keyOf(lot.product_id ?? lot.productId, null))
      || null;
}

/** Value one lot. qty is KG; cost and rate are per KG. */
function valueLot(lot, idx) {
  const qtyKg = parseFloat(lot.available_qty ?? lot.availableQty) || 0;
  const costPerKg = parseFloat(lot.cost_per_unit ?? lot.costPerUnit) || 0;
  const rate = rateForLot(lot, idx);
  const costValue = qtyKg * costPerKg;
  if (!rate) {
    return { qtyKg, costPerKg, sellingPerKg: null, costValue, marketValue: null, profit: null, hasRate: false };
  }
  const marketValue = qtyKg * rate.perKg;
  return {
    qtyKg, costPerKg, sellingPerKg: rate.perKg, costValue, marketValue,
    profit: marketValue - costValue, hasRate: true, rateEffectiveDate: rate.effectiveDate,
  };
}

/** Totals by lot type, plus how much stock is still unpriced. */
function summarise(lots, idx) {
  const out = { byType: {}, total: { costValue: 0, marketValue: 0, profit: 0, pricedCostValue: 0, unpricedCostValue: 0, unpricedLots: 0 } };
  for (const lot of Array.isArray(lots) ? lots : []) {
    const type = lot.type || 'unknown';
    const v = valueLot(lot, idx);
    const t = out.byType[type] || (out.byType[type] = { lots: 0, qtyKg: 0, costValue: 0, marketValue: 0, profit: 0, unpricedLots: 0, unpricedCostValue: 0 });
    t.lots += 1; t.qtyKg += v.qtyKg; t.costValue += v.costValue;
    out.total.costValue += v.costValue;
    if (v.hasRate) {
      t.marketValue += v.marketValue; t.profit += v.profit;
      out.total.marketValue += v.marketValue; out.total.profit += v.profit;
      out.total.pricedCostValue += v.costValue;
    } else {
      t.unpricedLots += 1; t.unpricedCostValue += v.costValue;
      out.total.unpricedLots += 1; out.total.unpricedCostValue += v.costValue;
    }
  }
  return out;
}

module.exports = { toPerKg, buildRateIndex, rateForLot, valueLot, summarise, keyOf };
