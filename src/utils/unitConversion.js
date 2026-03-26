/**
 * RiceFlow ERP — Unit Conversion Engine (Frontend)
 *
 * All inventory stored in KG internally.
 *   1 katta = 1 bag = 50 kg (default, configurable per lot)
 *   1 maund (mund) = 40 kg
 *   1 ton (MT) = 1000 kg
 */

export const MAUND_KG = 40;
export const TON_KG = 1000;
export const DEFAULT_KATTA_KG = 50;

export const UNITS = ['kg', 'katta', 'maund', 'ton'];
export const UNIT_LABELS = { kg: 'KG', katta: 'Katta', bag: 'Bag', maund: 'Maund', ton: 'Ton', mt: 'MT' };

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

export const round2 = r2;
export const round3 = r3;
export const round4 = r4;

// ─── To KG ───
export function toKg(value, unit, bagWt = DEFAULT_KATTA_KG) {
  const v = parseFloat(value) || 0;
  const u = (unit || 'kg').toLowerCase().trim();
  if (u === 'kg') return r3(v);
  if (u === 'katta' || u === 'bag' || u === 'bags') return r3(v * bagWt);
  if (u === 'maund' || u === 'mund') return r3(v * MAUND_KG);
  if (u === 'ton' || u === 'mt') return r3(v * TON_KG);
  return r3(v);
}

// ─── From KG ───
export function fromKg(kg, unit, bagWt = DEFAULT_KATTA_KG) {
  const v = parseFloat(kg) || 0;
  const u = (unit || 'kg').toLowerCase().trim();
  if (u === 'kg') return r3(v);
  if (u === 'katta' || u === 'bag' || u === 'bags') return r2(v / bagWt);
  if (u === 'maund' || u === 'mund') return r2(v / MAUND_KG);
  if (u === 'ton' || u === 'mt') return r3(v / TON_KG);
  return r3(v);
}

// ─── Rate to per KG ───
export function rateToPerKg(rate, unit, bagWt = DEFAULT_KATTA_KG) {
  const r = parseFloat(rate) || 0;
  const u = (unit || 'kg').toLowerCase().trim();
  if (u === 'kg') return r4(r);
  if (u === 'katta' || u === 'bag' || u === 'bags') return r4(r / bagWt);
  if (u === 'maund' || u === 'mund') return r4(r / MAUND_KG);
  if (u === 'ton' || u === 'mt') return r4(r / TON_KG);
  return r4(r);
}

// ─── Rate from per KG ───
export function rateFromPerKg(ratePerKg, unit, bagWt = DEFAULT_KATTA_KG) {
  const r = parseFloat(ratePerKg) || 0;
  const u = (unit || 'kg').toLowerCase().trim();
  if (u === 'kg') return r4(r);
  if (u === 'katta' || u === 'bag' || u === 'bags') return r2(r * bagWt);
  if (u === 'maund' || u === 'mund') return r2(r * MAUND_KG);
  if (u === 'ton' || u === 'mt') return r2(r * TON_KG);
  return r4(r);
}

// ─── All equivalents for display ───
export function allEquivalents(kg, bagWt = DEFAULT_KATTA_KG) {
  const v = parseFloat(kg) || 0;
  return { kg: r3(v), katta: r2(v / bagWt), bags: r2(v / bagWt), maund: r2(v / MAUND_KG), ton: r3(v / TON_KG) };
}

export function allRateEquivalents(ratePerKg, bagWt = DEFAULT_KATTA_KG) {
  const r = parseFloat(ratePerKg) || 0;
  return { perKg: r4(r), perKatta: r2(r * bagWt), perBag: r2(r * bagWt), perMaund: r2(r * MAUND_KG), perTon: r2(r * TON_KG) };
}

/** Format quantity with unit label */
export function formatQty(kg, unit, bagWt = DEFAULT_KATTA_KG) {
  const val = fromKg(kg, unit, bagWt);
  const label = UNIT_LABELS[unit] || unit?.toUpperCase() || 'KG';
  return `${val.toLocaleString()} ${label}`;
}

/** Format rate with unit label */
export function formatRate(ratePerKg, unit, currency = 'Rs', bagWt = DEFAULT_KATTA_KG) {
  const val = rateFromPerKg(ratePerKg, unit, bagWt);
  const label = UNIT_LABELS[unit] || unit?.toUpperCase() || 'KG';
  return `${currency} ${val.toLocaleString()}/${label}`;
}
