// The canonical milling cost-sheet categories (P3-07 / MIL-11). The residual
// cost engine, the completion journal and the payables feed key off these
// exact strings: 'raw_rice' is the rice purchase (its own guard, payable and
// blend logic), 'packaging' is the always-added bag cost, and everything else
// is a processing cost. A category typed any other way — the Costs drawer
// used to send its own key 'rawRice' when the batch had no raw row yet — was
// stored verbatim and treated as a processing cost: raw rice booked as an
// accrued expense (Cr 2110) and missed by the raw-price guard.
//
// The cost-sheet endpoints accept a category only through
// canonicalCostCategory(): a known alias is mapped to its canonical key and
// anything unknown is refused.

const RAW_RICE = 'raw_rice';
const PACKAGING = 'packaging';

// Cost-sheet categories a user may enter (the Costs drawer) plus the ones the
// system itself writes onto a batch (mill-store consumption, utilities,
// business expenses), so a stored row can always be edited back.
const MILLING_COST_CATEGORIES = Object.freeze([
  RAW_RICE,
  'transport', 'unloading', 'labor', 'drying', 'processing', 'sortex',
  PACKAGING, 'stitching', 'electricity', 'commission',
  'rent', 'maintenance', 'other',
  // written by mill-store consumption / utilities / business expenses
  'chemicals', 'diesel', 'water', 'gas', 'utility',
  'fumigation', 'inspection', 'insurance', 'salaries', 'miscellaneous',
]);

// Spellings that mean a canonical category.
const ALIASES = Object.freeze({
  rawrice: RAW_RICE,
  rawricepurchase: RAW_RICE,
  packing: PACKAGING,       // the drawer's "Bagging / Packing" is the bag cost
  bagging: PACKAGING,
  bags: PACKAGING,
  labour: 'labor',
  power: 'electricity',
  fuel: 'diesel',
  operational: 'chemicals',
  misc: 'miscellaneous',
});

const squash = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/[\s_\-/]+/g, '');

/**
 * The canonical key for a cost-sheet category, or null when it is not one.
 * Matching ignores case, spaces, underscores and dashes ('Raw Rice',
 * 'rawRice', 'raw_rice' → 'raw_rice').
 */
function canonicalCostCategory(category) {
  const k = squash(category);
  if (!k) return null;
  const direct = MILLING_COST_CATEGORIES.find((c) => squash(c) === k);
  if (direct) return direct;
  return ALIASES[k] || null;
}

/** An Error (status 400) naming the category that is not on the list. */
function unknownCategoryError(category) {
  const e = new Error(`Unknown cost category '${category}'. Use one of: ${MILLING_COST_CATEGORIES.join(', ')}.`);
  e.status = 400;
  e.statusCode = 400;
  return e;
}

module.exports = {
  RAW_RICE,
  PACKAGING,
  MILLING_COST_CATEGORIES,
  canonicalCostCategory,
  unknownCategoryError,
};
