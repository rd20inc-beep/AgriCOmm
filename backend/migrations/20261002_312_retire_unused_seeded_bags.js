/**
 * Retire the seeded bag items nobody uses.
 *
 * Migration 057 seeded a bag item for every row in bag_types, which left the
 * master with several duplicates of the same sack at the same size — three
 * different "Katta 50kg", three 100 kg katta, two spare 25 kg bags. They carry no
 * price, no stock and no history, and they clutter every packaging picker and
 * every per-type section of the stock report.
 *
 * Confirmed with the user: prices are maintained by hand and are not fixed, so
 * pricing the duplicates is not the answer — retiring them is.
 *
 * RETIRED, NOT DELETED. is_active = false. Every picker and the katta reconciler
 * already filter on it, and the stock report only lists what holds stock, so a
 * retired item simply stops being offered. Nothing is lost: reactivating it is a
 * tick in Mill Store, and deleting rows that movements or ratios might one day
 * reference would be the irreversible version of the same tidy-up.
 *
 * The criteria are COMPUTED, not a hardcoded list, so this cannot retire
 * something that is in use on another database:
 *
 *   - a seeded code (`BAG-%`, the hyphenated family migration 057 generated —
 *     user-created items are named differently: KATTA-50, 10KG FIZZA,
 *     BAG25KGPENTRADE);
 *   - no price set;
 *   - no stock, now or ever (no stock movements);
 *   - no consumption ratio pointing at it;
 *   - never used in a packing run or on a batch packaging line;
 *   - a bag or a liner, not thread or labels — those are consumables the mill may
 *     well still buy, and they were never part of what was being tidied.
 *
 * On production that is 9 items. Everything with stock, history, a price or a
 * ratio survives, including the three 50 kg katta that are actually in use.
 */
exports.up = async (knex) => {
  const candidates = await knex('mill_items as mi')
    .where('mi.category', 'packaging')
    .andWhere('mi.is_active', true)
    .andWhere('mi.code', 'like', 'BAG-%')
    .whereIn('mi.pack_type', ['katta', 'pp_bag', 'master_bag', 'polythene'])
    .where(function () { this.whereNull('mi.avg_cost_per_unit').orWhere('mi.avg_cost_per_unit', 0); })
    .whereNotExists(function () {
      this.select('*').from('mill_stock').whereRaw('mill_stock.item_id = mi.id').andWhere('quantity_available', '>', 0);
    })
    .whereNotExists(function () {
      this.select('*').from('mill_stock_movements').whereRaw('mill_stock_movements.item_id = mi.id');
    })
    .whereNotExists(function () {
      this.select('*').from('mill_consumption_ratios').whereRaw('mill_consumption_ratios.item_id = mi.id');
    })
    .whereNotExists(function () {
      this.select('*').from('mill_purchase_items').whereRaw('mill_purchase_items.item_id = mi.id');
    })
    .whereNotExists(function () {
      this.select('*').from('mill_packing_logs')
        .whereRaw('mill_packing_logs.bag_item_id = mi.id')
        .orWhereRaw('mill_packing_logs.master_bag_item_id = mi.id')
        .orWhereRaw('mill_packing_logs.poly_item_id = mi.id');
    })
    .whereNotExists(function () {
      this.select('*').from('milling_batch_packaging').whereRaw('milling_batch_packaging.mill_item_id = mi.id');
    })
    .select('mi.id', 'mi.code', 'mi.name');

  if (candidates.length === 0) return;

  await knex('mill_items')
    .whereIn('id', candidates.map((c) => c.id))
    .update({
      is_active: false,
      notes: knex.raw(
        "COALESCE(NULLIF(notes, ''), '') || ?",
        ['Retired: seeded duplicate with no price, no stock and no history. Reactivate in Mill Store if it is needed.'],
      ),
      updated_at: knex.fn.now(),
    });

  // Worth seeing in the deploy log — this changes what the pickers offer.
  console.log(`[312] Retired ${candidates.length} unused seeded packaging item(s): ${candidates.map((c) => c.code).join(', ')}`);
};

// Reactivates exactly what this retired, identified by the note it left.
exports.down = async (knex) => {
  await knex('mill_items')
    .where('notes', 'like', '%Retired: seeded duplicate%')
    .update({ is_active: true, updated_at: knex.fn.now() });
};
