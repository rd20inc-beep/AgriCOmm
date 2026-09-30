/**
 * Move the 25 kg P.P. bags out of the katta item they were filed under.
 *
 * KATTA-25 "Katta 25kg" holds 1,826 units on production that are not katta —
 * they are 25 kg P.P. bags. The item existed at all because reconcileBatchKatta
 * used to mint a katta for whatever size it freed (fixed in migration 305), and
 * it was then the only 25 kg packaging item with a price, so a single manual
 * stock edit of 1,826 landed there. Confirmed with the user: they are P.P. bags.
 *
 * They move to BAG-25KG-PP "PP Bag 25kg (Empty)", which is the generic 25 kg
 * P.P. bag and was sitting at zero — with no capacity and no price, which would
 * have made it unusable for packing and invisible to the katta/bag split. Both
 * are set from what KATTA-25 carried, since that is the figure the mill entered.
 *
 * The brand bags (25KG AENOS, PP25KG WHITE HORSE at Rs 43.92) are deliberately
 * NOT the target: those are printed bags at four times the price, and folding
 * unbranded stock into one would misstate both the count and the value.
 *
 * KATTA-25 itself is left in place at zero. A lot genuinely arriving in 25 kg
 * sacks is a real thing, and migration 305 means it will only be used when the
 * sack really is a katta.
 *
 * Idempotent: keyed on its own movement reference, so a re-run moves nothing.
 */
const SOURCE = 'KATTA-25';
const TARGET = 'BAG-25KG-PP';
const REF = 'reclass_katta25_to_pp25';

exports.up = async (knex) => {
  const source = await knex('mill_items').where({ code: SOURCE }).first();
  // Nothing to do on a database that never had the mis-filed item — a fresh
  // install, or one where this already ran.
  if (!source) return;

  // The target is a user-created item on production, so it cannot be assumed to
  // exist elsewhere. Create it rather than skipping: a migration that silently
  // does nothing because a row is missing is how a correction gets lost.
  let target = await knex('mill_items').where({ code: TARGET }).first();
  if (!target) {
    await knex('mill_items').insert({
      code: TARGET, name: 'PP Bag 25kg (Empty)', category: 'packaging', unit: 'pcs',
      capacity_kg: 25, tare_weight_kg: source.tare_weight_kg,
      avg_cost_per_unit: source.avg_cost_per_unit,
      pack_type: 'pp_bag', size_value: 25, size_unit: 'kg',
      reorder_level: 0, is_active: true,
      notes: 'Generic 25kg P.P. bag. Set the cost per bag in Mill Store; costing reads it from there.',
    });
    target = await knex('mill_items').where({ code: TARGET }).first();
  }

  const already = await knex('mill_stock_movements').where({ reference_type: REF }).first('id');
  if (already) return;

  const rows = await knex('mill_stock').where({ item_id: source.id });
  const perUnit = parseFloat(source.avg_cost_per_unit) || 0;
  let moved = 0;

  for (const row of rows) {
    const qty = parseFloat(row.quantity_available) || 0;
    if (qty <= 0) continue;

    // Out of the katta.
    await knex('mill_stock').where({ id: row.id }).update({ quantity_available: 0, updated_at: knex.fn.now() });
    await knex('mill_stock_movements').insert({
      item_id: source.id, warehouse_id: row.warehouse_id, movement_type: 'adjustment',
      quantity: -qty, cost_per_unit: perUnit, total_cost: Number((qty * perUnit).toFixed(2)),
      reference_type: REF, reference_id: target.id,
      reason: `Reclassified: ${qty} x 25kg P.P. bags were filed under ${SOURCE}. Moved to ${TARGET}.`,
    });

    // Into the P.P. bag, at the same location.
    const destRow = await knex('mill_stock').where({ item_id: target.id, warehouse_id: row.warehouse_id }).first();
    if (destRow) {
      await knex('mill_stock').where({ id: destRow.id })
        .update({ quantity_available: knex.raw('quantity_available + ?', [qty]), updated_at: knex.fn.now() });
    } else {
      await knex('mill_stock').insert({
        item_id: target.id, warehouse_id: row.warehouse_id,
        quantity_available: qty, quantity_reserved: 0,
      });
    }
    await knex('mill_stock_movements').insert({
      item_id: target.id, warehouse_id: row.warehouse_id, movement_type: 'adjustment',
      quantity: qty, cost_per_unit: perUnit, total_cost: Number((qty * perUnit).toFixed(2)),
      reference_type: REF, reference_id: source.id,
      reason: `Reclassified in from ${SOURCE}: these are 25kg P.P. bags, not katta.`,
    });
    moved += qty;
  }

  if (moved > 0) {
    // The target was seeded with no capacity and no price — unusable for packing
    // (which requires a capacity) and invisible to the katta/bag split (which
    // divides by it). Carry across what the mill actually recorded on KATTA-25.
    await knex('mill_items').where({ id: target.id }).update({
      capacity_kg: parseFloat(target.capacity_kg) > 0 ? target.capacity_kg : 25,
      size_value: parseFloat(target.size_value) > 0 ? target.size_value : 25,
      size_unit: 'kg',
      tare_weight_kg: parseFloat(target.tare_weight_kg) > 0 ? target.tare_weight_kg : source.tare_weight_kg,
      avg_cost_per_unit: parseFloat(target.avg_cost_per_unit) > 0 ? target.avg_cost_per_unit : perUnit,
      pack_type: 'pp_bag',
      updated_at: knex.fn.now(),
    });
  }
};

// Puts the stock back where it was. The reclassification is a correction, not a
// schema change, so down() only has to be able to undo it cleanly.
exports.down = async (knex) => {
  const moves = await knex('mill_stock_movements').where({ reference_type: REF });
  for (const m of moves) {
    const row = await knex('mill_stock').where({ item_id: m.item_id, warehouse_id: m.warehouse_id }).first();
    if (row) {
      await knex('mill_stock').where({ id: row.id })
        .update({ quantity_available: knex.raw('GREATEST(quantity_available - ?, 0)', [parseFloat(m.quantity) || 0]) });
    }
  }
  await knex('mill_stock_movements').where({ reference_type: REF }).del();
};
