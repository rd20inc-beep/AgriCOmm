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

// ─── The MT ↔ KG document boundary ───
// Stock, milling and mill-side screens are KG (mig 228). Export orders,
// quotations, contracts and printed export documents keep metric tons
// (qty_mt, price_per_mt, USD/MT). Every crossing of that boundary goes
// through these four instead of an inline ×1000 / ÷1000.
//
// Unlike toKg/fromKg above these are EXACT — a plain ×1000 / ÷1000 on the
// parsed number, the same float operation the inline code did — so routing a
// call site through them never changes a figure. Round when displaying.
// null / undefined / '' / non-numeric count as 0, like `(parseFloat(x) || 0)`.
// Twin of backend/src/shared/units.js.
export const KG_PER_MT = TON_KG;
const num = (v) => parseFloat(v) || 0;
export const mtToKg = (mt) => num(mt) * KG_PER_MT;
export const kgToMt = (kg) => num(kg) / KG_PER_MT;
export const perMtToPerKg = (ratePerMt) => num(ratePerMt) / KG_PER_MT;
export const perKgToPerMt = (ratePerKg) => num(ratePerKg) * KG_PER_MT;

// ─── A lot's bag (katta) weight ───
// Twin of lotBagKg in backend/src/shared/units.js: bag_weight_kg, then
// bag_size_kg, then the 50 kg standard katta. Every kg ↔ katta/bag figure for a
// lot (or a group of lots — convert each lot with its OWN weight, then sum)
// goes through this, never a literal 50.
export function lotBagKg(lot) {
  if (!lot) return DEFAULT_KATTA_KG;
  const w = num(lot.bagWeightKg ?? lot.bag_weight_kg);
  if (w > 0) return w;
  const s = num(lot.bagSizeKg ?? lot.bag_size_kg);
  if (s > 0) return s;
  return DEFAULT_KATTA_KG;
}

// Σ fromKg over several lots, each converted with its own bag weight — the
// figure a grouped row shows. pickKg(lot) returns the KG to convert.
export function sumLotsFromKg(lots, pickKg, unit) {
  return (lots || []).reduce((s, l) => s + fromKg(pickKg(l), unit, lotBagKg(l)), 0);
}
