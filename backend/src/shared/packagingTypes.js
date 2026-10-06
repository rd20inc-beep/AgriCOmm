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

// Items whose type cannot be read from their name or code.
//
// BAG-50KG-PP used to be listed here: it was seeded as "Thread Roll" because a
// size-less "Thread Roll" row in bag_types fell through migration 057's
// `|| 50` / `|| 'PP'` defaults and claimed the code. Migration 309 gives the code
// back to the bag it names, and the override had to GO with it — left in place it
// would have classified the corrected "PP Bag 50kg (Empty)" as 'other'. Nothing
// is lost either way: the THREAD rule below already catches the old name, so a
// database that has not run 309 yet still types it correctly.
const EXPLICIT_BY_CODE = {
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

/**
 * Read a pack size out of an item's own code or name — "BAG-50KG-PP" → 50 kg,
 * "INNER BAG 25KG" → 25 kg, "NOORI 8LBS" → 8 lb.
 *
 * Migration 057 seeded eleven bags whose size is stated in their name and stored
 * NONE of it, because the seed never set capacity_kg at all. That field is what
 * pack() requires before it will pack, and what the stock report divides by to
 * count bags — so every one of them was unusable for packing and invisible to the
 * katta/bag split. The size was there to be read the whole time.
 *
 * Returns { value, unit } or null when the label states no size, which is the
 * right answer for a thread roll, a label or a polythene sheet.
 */
function deriveSizeFromLabel(item) {
  const text = `${item?.code || ''} ${item?.name || ''}`.toUpperCase();
  // Pounds first: a bag named in LB is a pound bag whatever else the text says.
  const lb = text.match(/(\d+(?:\.\d+)?)\s*LBS?\b/);
  if (lb) return { value: parseFloat(lb[1]), unit: 'lb' };
  // "50KG", "25 kg", "PP25KG". Deliberately not a bare number: "250g roll" and
  // "Appendix V-10A" must not read as sizes.
  const kg = text.match(/(\d+(?:\.\d+)?)\s*KGS?\b/);
  if (kg) {
    const v = parseFloat(kg[1]);
    if (v > 0) return { value: v, unit: 'kg' };
  }
  return null;
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

/**
 * Is a size or capacity figure actually missing?
 *
 * NULL and ZERO mean the same thing here, and treating them differently is what
 * let BAG-25KG-PP WOVEN sit at capacity 0 after a backfill that only filled
 * nulls. A zero is not a measurement — no bag holds nothing — it is a blank that
 * got saved as a number. pack() already treats them alike: it refuses on
 * `capacity <= 0`, so a zero blocks packing exactly as a null does.
 */
function isMissingSize(value) {
  if (value == null) return true;
  const v = parseFloat(value);
  return !Number.isFinite(v) || v <= 0;
}

// Does a capacity mean anything for this kind of item? It is "kg of rice this
// holds", so it belongs on a sack, a retail bag or a master — not on a sheet, a
// label or a roll of thread. A liner's size describes the bag it lines, which is
// worth showing but is not a capacity.
const CAPACITY_TYPES = ['katta', 'pp_bag', 'master_bag'];
function hasCapacity(packType) {
  return CAPACITY_TYPES.includes(packType);
}

/**
 * Is this item a KATTA — the sack whose store stock only the yield's katta
 * reconcile (inventoryService.reconcileBatchKatta) may move?
 *
 * The stored pack_type wins (migration 305); an item that has none yet is
 * classified the one way everything else classifies it.
 */
function isKattaItem(item) {
  if (!item) return false;
  return (item.pack_type || classifyPackaging(item)) === 'katta';
}

module.exports = {
  PACK_TYPES, PACK_TYPE_CODES, KG_PER_LB, CAPACITY_TYPES,
  classifyPackaging, resolveSize, sizeToKg, formatPackSize,
  deriveSizeFromLabel, hasCapacity, isMissingSize, isKattaItem,
};
