const db = require('../../config/database');

/**
 * Resolving an order's packing spec to a mill-store item, in ONE place.
 *
 * Two features need the same answer and must never disagree: the export order's
 * material requirements (what to buy) and the export documents' gross weight
 * (what the bags weigh). They were separate before, which is how a plain-bag
 * order came to be priced against the printed SKU.
 *
 * Candidates are ranked on ORDERED KEYS rather than weighted points:
 *   1. printing intent - a plain order must never resolve to a printed SKU,
 *      whatever its name looks like (printed stock is buyer-specific and is
 *      bought through the printed-bag vendor flow, not the mill store)
 *   2. name match  - exact > prefix > word-boundary > loose substring. "PP Bag"
 *      is a SUBSTRING of "BOPP Bag", so a loose match counts for almost nothing
 *   3. stock on hand - buying what you already hold is waste
 *   4. id, so the result is stable (the old code took rows[0] of a query with
 *      no ORDER BY, making the pick arbitrary AND unstable across vacuums)
 */

function nameScore(name, hint) {
  if (!hint) return 0;
  if (name === hint) return 3;
  if (name.startsWith(hint)) return 2;
  if (new RegExp(`\\b${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)) return 1;
  return name.includes(hint) ? 0 : -1;
}

function rankKeys(r, hint, wantsPrinted) {
  const name = String(r.name || '').toLowerCase();
  const isPrinted = /print/.test(name);
  return [
    isPrinted === wantsPrinted ? 1 : 0,
    nameScore(name, hint),
    (parseFloat(r.avail) || 0) > 0 ? 1 : 0,
  ];
}

function byRank(hint, wantsPrinted) {
  return (a, b) => {
    const ka = rankKeys(a, hint, wantsPrinted);
    const kb = rankKeys(b, hint, wantsPrinted);
    for (let i = 0; i < ka.length; i += 1) if (kb[i] !== ka[i]) return kb[i] - ka[i];
    return a.id - b.id;
  };
}

const EMPTY = {
  itemId: null, itemName: null, itemCode: null, unit: 'pcs',
  cost: null, available: 0, tareKg: null, candidates: 0, alternatives: [],
};

/** Does this order call for printed bags? */
function wantsPrintedBags(order) {
  return !!(String(order.bag_printing || '').trim() || String(order.bag_brand || '').trim());
}

/**
 * Find the packaging item an order line should consume.
 * @param {{capacityKg?: number, code?: string, materialHint?: string, wantsPrinted?: boolean}} opts
 */
async function matchPackagingItem({ capacityKg = null, code = null, materialHint = null, wantsPrinted = false }, conn = db) {
  const base = () => conn('mill_items as i')
    .leftJoin('mill_stock as s', function joinStock() { this.on('s.item_id', 'i.id').andOnNull('s.warehouse_id'); })
    .where('i.category', 'packaging')
    .where('i.is_active', true)
    .select('i.id', 'i.code', 'i.name', 'i.unit', 'i.avg_cost_per_unit', 'i.tare_weight_kg',
      conn.raw('COALESCE(s.quantity_available, 0) as avail'));

  let rows = [];
  if (code) rows = await base().where('i.code', code);
  if (!rows.length && capacityKg) rows = await base().where('i.capacity_kg', capacityKg);
  if (!rows.length) return { ...EMPTY };

  const hint = String(materialHint || '').trim().toLowerCase();
  const ranked = [...rows].sort(byRank(hint, wantsPrinted));
  const r = ranked[0];
  return {
    itemId: r.id,
    itemName: r.name,
    itemCode: r.code,
    unit: r.unit || 'pcs',
    cost: r.avg_cost_per_unit != null ? parseFloat(r.avg_cost_per_unit) : null,
    available: parseFloat(r.avail) || 0,
    // Empty-bag weight from the item master, in KG. This is where the mill
    // records bag weights, so the documents read it rather than asking for the
    // same fact again per order.
    tareKg: r.tare_weight_kg != null ? parseFloat(r.tare_weight_kg) : null,
    candidates: rows.length,
    alternatives: ranked.slice(1, 4).map((x) => `${x.code} — ${x.name}`),
  };
}

/**
 * The retail bag and master bag an order ships in, with their tare weights.
 * Used by the document engine to build a gross weight.
 */
async function resolveOrderPackaging(order, conn = db) {
  const wantsPrinted = wantsPrintedBags(order);
  const bagSizeKg = parseFloat(order.bag_size_kg) || 0;
  const masterBagSizeKg = parseFloat(order.master_bag_size_kg) || 0;

  const retail = bagSizeKg > 0
    ? await matchPackagingItem({
      capacityKg: bagSizeKg,
      materialHint: order.bag_material || order.bag_type || null,
      wantsPrinted,
    }, conn)
    : { ...EMPTY };

  const master = masterBagSizeKg > 0
    ? await matchPackagingItem({
      code: `MASTER-${masterBagSizeKg}`,
      capacityKg: masterBagSizeKg,
      wantsPrinted,
    }, conn)
    : { ...EMPTY };

  return { retail, master, wantsPrinted };
}

module.exports = { matchPackagingItem, resolveOrderPackaging, wantsPrintedBags };
