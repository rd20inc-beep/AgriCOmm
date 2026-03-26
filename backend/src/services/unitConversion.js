/**
 * RiceFlow ERP — Unit Conversion Engine
 *
 * All inventory is stored internally in KG.
 * Pakistani rice trading units:
 *   1 katta = 1 bag = 50 kg (default, configurable per lot)
 *   1 maund (mund) = 40 kg
 *   1 ton (MT) = 1000 kg
 *
 * Rules:
 *   - All quantities saved in kg
 *   - All rates saved per kg
 *   - Display units are derived from kg at read time
 *   - Rounding: kg to 3 decimals, rates to 4 decimals, display units to 2
 */

const MAUND_KG = 40;
const TON_KG = 1000;
const DEFAULT_KATTA_KG = 50;

// ─── Quantity Conversions (to KG) ───

function kattaToKg(katta, bagWeightKg = DEFAULT_KATTA_KG) {
  return round3(katta * bagWeightKg);
}

function maundToKg(maund) {
  return round3(maund * MAUND_KG);
}

function tonToKg(ton) {
  return round3(ton * TON_KG);
}

function bagsToKg(bags, bagWeightKg = DEFAULT_KATTA_KG) {
  return round3(bags * bagWeightKg);
}

// ─── Quantity Conversions (from KG) ───

function kgToKatta(kg, bagWeightKg = DEFAULT_KATTA_KG) {
  return round2(kg / bagWeightKg);
}

function kgToMaund(kg) {
  return round2(kg / MAUND_KG);
}

function kgToTon(kg) {
  return round3(kg / TON_KG);
}

function kgToBags(kg, bagWeightKg = DEFAULT_KATTA_KG) {
  return round2(kg / bagWeightKg);
}

// ─── Rate Conversions (to per KG) ───

function ratePerKattaToKg(ratePerKatta, bagWeightKg = DEFAULT_KATTA_KG) {
  return round4(ratePerKatta / bagWeightKg);
}

function ratePerMaundToKg(ratePerMaund) {
  return round4(ratePerMaund / MAUND_KG);
}

function ratePerTonToKg(ratePerTon) {
  return round4(ratePerTon / TON_KG);
}

// ─── Rate Conversions (from per KG) ───

function ratePerKgToKatta(ratePerKg, bagWeightKg = DEFAULT_KATTA_KG) {
  return round2(ratePerKg * bagWeightKg);
}

function ratePerKgToMaund(ratePerKg) {
  return round2(ratePerKg * MAUND_KG);
}

function ratePerKgToTon(ratePerKg) {
  return round2(ratePerKg * TON_KG);
}

// ─── Universal Converter ───

/**
 * Convert any quantity to KG.
 * @param {number} value
 * @param {string} unit - 'kg','katta','bag','maund','ton','mt'
 * @param {number} bagWeightKg - actual bag weight (default 50)
 * @returns {number} value in KG
 */
function toKg(value, unit, bagWeightKg = DEFAULT_KATTA_KG) {
  const v = parseFloat(value) || 0;
  const u = (unit || 'kg').toLowerCase().trim();
  if (u === 'kg') return round3(v);
  if (u === 'katta' || u === 'bag' || u === 'bags') return kattaToKg(v, bagWeightKg);
  if (u === 'maund' || u === 'mund') return maundToKg(v);
  if (u === 'ton' || u === 'mt') return tonToKg(v);
  return round3(v); // default: assume kg
}

/**
 * Convert KG to any display unit.
 * @param {number} kg
 * @param {string} unit - target unit
 * @param {number} bagWeightKg
 * @returns {number}
 */
function fromKg(kg, unit, bagWeightKg = DEFAULT_KATTA_KG) {
  const v = parseFloat(kg) || 0;
  const u = (unit || 'kg').toLowerCase().trim();
  if (u === 'kg') return round3(v);
  if (u === 'katta' || u === 'bag' || u === 'bags') return kgToKatta(v, bagWeightKg);
  if (u === 'maund' || u === 'mund') return kgToMaund(v);
  if (u === 'ton' || u === 'mt') return kgToTon(v);
  return round3(v);
}

/**
 * Convert rate per input unit to rate per KG.
 */
function rateToPerKg(rate, unit, bagWeightKg = DEFAULT_KATTA_KG) {
  const r = parseFloat(rate) || 0;
  const u = (unit || 'kg').toLowerCase().trim();
  if (u === 'kg') return round4(r);
  if (u === 'katta' || u === 'bag' || u === 'bags') return ratePerKattaToKg(r, bagWeightKg);
  if (u === 'maund' || u === 'mund') return ratePerMaundToKg(r);
  if (u === 'ton' || u === 'mt') return ratePerTonToKg(r);
  return round4(r);
}

/**
 * Convert rate per KG to rate per display unit.
 */
function rateFromPerKg(ratePerKg, unit, bagWeightKg = DEFAULT_KATTA_KG) {
  const r = parseFloat(ratePerKg) || 0;
  const u = (unit || 'kg').toLowerCase().trim();
  if (u === 'kg') return round4(r);
  if (u === 'katta' || u === 'bag' || u === 'bags') return ratePerKgToKatta(r, bagWeightKg);
  if (u === 'maund' || u === 'mund') return ratePerKgToMaund(r);
  if (u === 'ton' || u === 'mt') return ratePerKgToTon(r);
  return round4(r);
}

/**
 * Get all equivalent quantities for a given KG value.
 * Useful for display in UI / reports.
 */
function allEquivalents(kg, bagWeightKg = DEFAULT_KATTA_KG) {
  const v = parseFloat(kg) || 0;
  return {
    kg: round3(v),
    katta: kgToKatta(v, bagWeightKg),
    bags: kgToKatta(v, bagWeightKg), // alias
    maund: kgToMaund(v),
    ton: kgToTon(v),
  };
}

/**
 * Get all equivalent rates for a given per-KG rate.
 */
function allRateEquivalents(ratePerKg, bagWeightKg = DEFAULT_KATTA_KG) {
  const r = parseFloat(ratePerKg) || 0;
  return {
    perKg: round4(r),
    perKatta: ratePerKgToKatta(r, bagWeightKg),
    perBag: ratePerKgToKatta(r, bagWeightKg),
    perMaund: ratePerKgToMaund(r),
    perTon: ratePerKgToTon(r),
  };
}

// ─── Rounding Helpers ───

function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
function round4(v) { return Math.round(v * 10000) / 10000; }

// ─── Constants ───

const UNITS = ['kg', 'katta', 'maund', 'ton'];
const UNIT_LABELS = {
  kg: 'KG',
  katta: 'Katta',
  bag: 'Bag',
  bags: 'Bags',
  maund: 'Maund',
  mund: 'Mund',
  ton: 'Ton',
  mt: 'MT',
};

module.exports = {
  // Constants
  MAUND_KG, TON_KG, DEFAULT_KATTA_KG, UNITS, UNIT_LABELS,
  // Specific conversions
  kattaToKg, maundToKg, tonToKg, bagsToKg,
  kgToKatta, kgToMaund, kgToTon, kgToBags,
  ratePerKattaToKg, ratePerMaundToKg, ratePerTonToKg,
  ratePerKgToKatta, ratePerKgToMaund, ratePerKgToTon,
  // Universal converters
  toKg, fromKg, rateToPerKg, rateFromPerKg,
  // Bulk equivalents
  allEquivalents, allRateEquivalents,
  // Rounding
  round2, round3, round4,
};
