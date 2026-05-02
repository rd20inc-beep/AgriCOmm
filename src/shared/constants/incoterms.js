// Incoterms 2020 — single source of truth for the entire frontend.
// Backend mirrors this list in backend/src/middleware/schemas.js.
//
// Each entry includes:
//   code        — the 3-letter abbreviation as it appears on contracts
//   name        — full descriptive name (used in document footers, tooltips)
//   transport   — 'sea' | 'any' | 'land_air' — the mode the term suits best
//   sellerPays  — 'minimal' | 'origin' | 'export_clearance' | 'freight' |
//                 'freight_insurance' | 'destination' | 'all'
//                 (rolls up who pays which costs; used for the buyer-pays-first
//                 vs. seller-pays-first heuristic in payment recommendations)
//   payment     — recommended payment-term phrase (CAD, D/P, LC, advance)
//   description — one-line plain-English summary for hint tooltips

export const INCOTERMS = [
  {
    code: 'EXW',
    name: 'Ex Works',
    transport: 'any',
    sellerPays: 'minimal',
    payment: 'Advance / 100% before pickup',
    description: 'Buyer collects from your premises and pays everything from there. Cheapest for you, riskiest for buyer.',
  },
  {
    code: 'FCA',
    name: 'Free Carrier',
    transport: 'land_air',
    sellerPays: 'origin',
    payment: 'CAD or D/P (Documentary Collection)',
    description: "Best for air or road freight. You deliver to the buyer's carrier at a named place.",
  },
  {
    code: 'FAS',
    name: 'Free Alongside Ship',
    transport: 'sea',
    sellerPays: 'origin',
    payment: 'CAD or D/P',
    description: 'You deliver alongside the vessel at the port of loading. Buyer handles loading and onward freight.',
  },
  {
    code: 'FOB',
    name: 'Free On Board',
    transport: 'sea',
    sellerPays: 'export_clearance',
    payment: 'CAD or D/P (Documentary Collection)',
    description: 'Best for ocean freight. You deliver loaded onto the vessel; risk passes once on board.',
  },
  {
    code: 'CFR',
    name: 'Cost and Freight',
    transport: 'sea',
    sellerPays: 'freight',
    payment: 'CAD or LC at sight',
    description: 'You pay freight to destination port; risk transfers when goods are on board.',
  },
  {
    code: 'CNF',
    name: 'Cost and Freight (alt. spelling)',
    transport: 'sea',
    sellerPays: 'freight',
    payment: 'CAD or LC at sight',
    description: 'Same as CFR — common alternate abbreviation in South Asia.',
  },
  {
    code: 'CIF',
    name: 'Cost, Insurance and Freight',
    transport: 'sea',
    sellerPays: 'freight_insurance',
    payment: 'CAD or LC at sight',
    description: 'You pay freight + insurance to destination port; risk transfers when goods are on board.',
  },
  {
    code: 'CPT',
    name: 'Carriage Paid To',
    transport: 'any',
    sellerPays: 'freight',
    payment: 'CAD or LC',
    description: "You pay freight to the named place; risk transfers when goods are handed to the first carrier.",
  },
  {
    code: 'CIP',
    name: 'Carriage and Insurance Paid To',
    transport: 'any',
    sellerPays: 'freight_insurance',
    payment: 'CAD or LC',
    description: 'You pay freight + insurance to the named place; risk transfers at first carrier.',
  },
  {
    code: 'DAP',
    name: 'Delivered at Place',
    transport: 'any',
    sellerPays: 'destination',
    payment: 'LC or partial advance',
    description: 'You deliver to the named destination ready for unloading. Buyer handles import duties.',
  },
  {
    code: 'DPU',
    name: 'Delivered at Place Unloaded',
    transport: 'any',
    sellerPays: 'destination',
    payment: 'LC or partial advance',
    description: 'Like DAP but you also unload at destination. Buyer handles import duties.',
  },
  {
    code: 'DDP',
    name: 'Delivered Duty Paid',
    transport: 'any',
    sellerPays: 'all',
    payment: 'LC or partial advance — high seller risk',
    description: 'You deliver everything done — including import duties. Maximum buyer convenience, maximum seller cost & risk.',
  },
];

// Fast lookup map for renderers / hints.
export const INCOTERM_MAP = Object.fromEntries(INCOTERMS.map((i) => [i.code, i]));

// Codes only — for dropdowns / Joi.
export const INCOTERM_CODES = INCOTERMS.map((i) => i.code);

// Full-name lookup for doc renderers (replaces hardcoded ternaries).
export function incotermLabel(code) {
  if (!code) return '';
  const entry = INCOTERM_MAP[code];
  return entry ? `${code} - ${entry.name}` : code;
}

// One-line hint string for the form helper text.
export function incotermHint(code) {
  const entry = INCOTERM_MAP[code];
  if (!entry) return '';
  return `${entry.name} · ${entry.description} Payment: ${entry.payment}.`;
}
