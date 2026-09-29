// Weight units for EXPORT DOCUMENTS only.
//
// The engine stores kilograms everywhere and that is not negotiable — lots,
// movements, packing logs, costing and every report are KG. This module exists
// because shipments to the USA and Canada state their weights in POUNDS on the
// commercial paperwork, while Africa, the EU and the Gulf expect kilograms.
//
// So the unit is a PRESENTATION choice carried on the export order
// (`doc_weight_unit`), applied at the last moment by the document renderers.
// Nothing converts on the way into the database, and nothing outside
// src/modules/exportOrders/components/DocumentCenter.jsx should import this.

// International avoirdupois pound, exact by definition: 1 lb = 0.45359237 kg.
// Using the exact figure matters on a 24 MT container, where a 5-decimal
// approximation drifts by grams and a rounded 2.2 drifts by ~113 kg.
export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 1 / KG_PER_LB;

export const WEIGHT_UNITS = [
  {
    code: 'kg',
    label: 'Kilograms (KG)',
    short: 'KG',
    // Some documents print the unit in a heading ("WEIGHT (IN KGS)") where the
    // plural reads better than the symbol.
    plural: 'KGS',
    description: 'Standard for Africa, the EU, the Gulf and most destinations.',
  },
  {
    code: 'lb',
    label: 'Pounds (LBS)',
    short: 'LBS',
    plural: 'LBS',
    description: 'Used for shipments to the USA and Canada.',
  },
];

export const WEIGHT_UNIT_MAP = Object.fromEntries(WEIGHT_UNITS.map((u) => [u.code, u]));
export const WEIGHT_UNIT_CODES = WEIGHT_UNITS.map((u) => u.code);

// An unknown or missing code is KG — the engine's own unit, and what every
// order written before this setting existed was printed in.
export function weightUnit(code) {
  return WEIGHT_UNIT_MAP[code] || WEIGHT_UNIT_MAP.kg;
}

// Convert a KG figure held by the engine into the document's unit.
export function fromKg(kg, code) {
  const n = parseFloat(kg) || 0;
  return code === 'lb' ? n * LB_PER_KG : n;
}

/**
 * Format a weight for a document: the converted number plus its unit.
 *
 *   fmtWeight(24000, 'kg')  → "24,000.00 KG"
 *   fmtWeight(24000, 'lb')  → "52,910.94 LBS"
 *
 * `decimals` follows what each document already printed in kg, so switching
 * unit changes the unit and nothing else about the layout.
 */
export function formatWeight(kg, code, { decimals = 2, withUnit = true, plural = false } = {}) {
  const u = weightUnit(code);
  const v = fromKg(kg, u.code);
  const n = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (!withUnit) return n;
  return `${n} ${plural ? u.plural : u.short}`;
}

/**
 * Format a BAG or PACK size — "50 KG", "8 LBS".
 *
 * Pack sizes are whole or near-whole numbers that people say out loud, so they
 * print without forced decimals: a 50 kg sack is "110.23 LBS", not
 * "110.23113 LBS", and an 8 lb retail bag stored as 3.6288 kg comes back "8 LBS"
 * rather than "8.00 LBS".
 */
export function formatPackSize(kg, code, { withUnit = true } = {}) {
  const u = weightUnit(code);
  const v = fromKg(kg, u.code);
  const n = Math.abs(v - Math.round(v)) < 0.005
    ? String(Math.round(v))
    : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return withUnit ? `${n} ${u.plural}` : n;
}

// Tonnes are the trading unit and do not change with the document's weight
// unit — a contract is priced per METRIC TON whichever way the weights print.
// Kept here so a renderer reaching for a weight helper finds the rule stated.
export const TRADE_UNIT = 'MT';
