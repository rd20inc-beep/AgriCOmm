/**
 * What KIND of packaging a mill_item is.
 *
 * Every report, every stock figure and every costing line has to keep katta,
 * P.P. bags and master bags apart, and until now nothing recorded which was
 * which — it was inferred from size. That is how a 25 kg P.P. bag came to be
 * filed as "Katta 25kg" (KATTA-25, 1,826 units of it on production): the katta
 * reconciler auto-creates a katta item for whatever size it frees, and a 25 kg
 * sack looked like a 25 kg katta.
 *
 * So the type is now stored on the item (migration 305) and this module is the
 * one place that decides it, used both by the backfill and by anything creating
 * a packaging item afterwards.
 */

const PACK_TYPES = [
  {
    code: 'katta',
    label: 'Katta / Bardana',
    // The sack paddy ARRIVES in and that is freed when it is milled. Jute or
    // woven PP, traditionally 50 kg. "Bardana" and "Bori" are the same thing.
    description: 'Intake sack — freed when the raw is milled.',
  },
  {
    code: 'pp_bag',
    label: 'P.P. / Retail Bag',
    // What finished rice LEAVES in: 25 kg PP, 5 kg BOPP, an 8 lb retail bag.
    description: 'Output bag the finished rice is packed into.',
  },
  {
    code: 'master_bag',
    label: 'Master (Outer) Bag',
    description: 'Outer sack that retail bags are collected into.',
  },
  { code: 'polythene', label: 'Polythene / Liner', description: 'Sheet or liner used with a bag.' },
  { code: 'other', label: 'Other', description: 'Thread, labels and anything that is not a bag.' },
];

const PACK_TYPE_CODES = PACK_TYPES.map((t) => t.code);

// Items whose type cannot be read from their name or code. Kept explicit rather
// than forced through a cleverer rule: BAG-50KG-PP is named "Thread Roll" in the
// live master, so its code and its name disagree and only a human can say which
// is right. The name wins here, and the item is worth correcting in Mill Store.
const EXPLICIT_BY_CODE = {
  'BAG-50KG-PP': 'other',          // named "Thread Roll" — code looks like a bag
  'BAG-50KG-PLASTIC': 'polythene', // "Liner Bag 50kg"
};

/**
 * Classify a packaging item. Order matters: the most specific signal first.
 *
 * @param {{code?:string, name?:string, category?:string}} item
 * @returns {string} one of PACK_TYPE_CODES
 */
function classifyPackaging(item) {
  const code = String(item?.code || '').toUpperCase().trim();
  const name = String(item?.name || '').toUpperCase().trim();
  if (item?.category && item.category !== 'packaging') return 'other';
  if (EXPLICIT_BY_CODE[code]) return EXPLICIT_BY_CODE[code];

  const has = (re) => re.test(code) || re.test(name);

  // Not bags at all.
  if (has(/\b(THREAD|LABEL|STITCH)/)) return 'other';
  if (has(/POLY|LINER/)) return 'polythene';
  // An outer bag, before the size rules — a "Master Bag 50kg" is not a katta.
  if (has(/MASTER/)) return 'master_bag';
  // The intake sack, by any of the names the trade uses for it.
  if (has(/KATTA|BARDANA|\bBORI\b|JUTE/)) return 'katta';
  // "PP WOVEN" is the woven sack paddy arrives in; plain "PP BAG" is an output
  // bag. The distinction is real and is why this is not one regex.
  if (has(/PP\s*WOVEN|WOVEN\s*PP/)) return code.includes('EXPORT') || name.includes('EXPORT') ? 'pp_bag' : 'katta';
  if (has(/BOPP|\bPP\b|NON\s*WOVEN|BAG|LBS?\b/)) return 'pp_bag';
  // A packaging item with a size that is none of the above is an output bag.
  // The commonest kind in the live master is a brand-named retail bag — "AENOS
  // 25KG", "NOORI 8LBS", "FIZZA 10KG" — which carries no "PP" or "BAG" in its
  // name at all, so a keyword rule alone filed them all as 'other'. Having a
  // capacity is the thing that makes it a bag rather than thread or a label.
  if (parseFloat(item?.capacity_kg) > 0) return 'pp_bag';
  return 'other';
}

// 1 lb = 0.45359237 kg exactly, the same figure the export documents use.
const KG_PER_LB = 0.45359237;

/**
 * The size to SHOW for an item, and the unit it is spoken in.
 *
 * Sizes are stored in kg because that is what the engine measures, but a retail
 * bag sold as "8 LBS" should never be shown as 3.63 kg. An item whose name says
 * LB is read in pounds and its stored kg is converted back, so 3.630 kg comes
 * out as the clean 8 LBS it was bought as.
 */
function resolveSize(item) {
  const name = `${item?.code || ''} ${item?.name || ''}`.toUpperCase();
  const kg = parseFloat(item?.capacity_kg);
  // An explicit LB figure in the name is the truth about what it is.
  const lbInName = name.match(/(\d+(?:\.\d+)?)\s*LBS?\b/);
  if (lbInName) return { value: parseFloat(lbInName[1]), unit: 'lb' };
  if (Number.isFinite(kg) && kg > 0) {
    // No LB anywhere: it is a kilogram bag, stated as it is stored.
    if (!/\bLBS?\b/.test(name)) return { value: kg, unit: 'kg' };
    const lb = kg / KG_PER_LB;
    const rounded = Math.round(lb * 100) / 100;
    return { value: Math.abs(rounded - Math.round(rounded)) < 0.02 ? Math.round(rounded) : rounded, unit: 'lb' };
  }
  return { value: null, unit: 'kg' };
}

// The size in KG, whatever unit it is spoken in — what every weight calculation
// needs, and what capacity_kg must hold.
function sizeToKg(value, unit) {
  const v = parseFloat(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  return unit === 'lb' ? Math.round(v * KG_PER_LB * 1000) / 1000 : v;
}

// "25 KG", "8 LBS" — for a label, a picker or a report column.
function formatPackSize(value, unit) {
  const v = parseFloat(value);
  if (!Number.isFinite(v) || v <= 0) return '';
  const n = Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
  return `${n} ${unit === 'lb' ? 'LBS' : 'KG'}`;
}

module.exports = {
  PACK_TYPES, PACK_TYPE_CODES, KG_PER_LB,
  classifyPackaging, resolveSize, sizeToKg, formatPackSize,
};
