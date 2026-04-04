/**
 * One-time seed: create inventory_lots from completed milling batches
 * that don't already have corresponding lots.
 */
exports.up = async function (knex) {
  const batches = await knex('milling_batches').where('actual_finished_mt', '>', 0);

  let seq = await knex('inventory_lots').count('id as c').first();
  let lotSeq = parseInt(seq.c) + 1;

  for (const b of batches) {
    const batchRef = 'batch-' + b.id;

    // Skip if lots already exist for this batch
    const existing = await knex('inventory_lots').where({ batch_ref: batchRef }).first();
    if (existing) continue;

    // Create finished rice lot
    if (parseFloat(b.actual_finished_mt) > 0) {
      await knex('inventory_lots').insert({
        lot_no: 'LOT-F-' + String(lotSeq++).padStart(4, '0'),
        item_name: 'Finished Rice',
        type: 'finished',
        entity: 'mill',
        supplier_id: b.supplier_id || null,
        batch_ref: batchRef,
        qty: parseFloat(b.actual_finished_mt),
        available_qty: parseFloat(b.actual_finished_mt),
        reserved_qty: 0,
        unit: 'MT',
        status: 'Available',
        net_weight_kg: parseFloat(b.actual_finished_mt) * 1000,
        gross_weight_kg: parseFloat(b.actual_finished_mt) * 1000,
        created_at: b.completed_at || b.created_at || new Date(),
        updated_at: new Date(),
      });
    }

    // Create byproduct lots
    if (parseFloat(b.broken_mt) > 0) {
      await knex('inventory_lots').insert({
        lot_no: 'LOT-B-' + String(lotSeq++).padStart(4, '0'),
        item_name: 'Broken Rice', type: 'byproduct', entity: 'mill',
        supplier_id: b.supplier_id, batch_ref: batchRef,
        qty: parseFloat(b.broken_mt), available_qty: parseFloat(b.broken_mt),
        reserved_qty: 0, unit: 'MT', status: 'Available',
        net_weight_kg: parseFloat(b.broken_mt) * 1000,
        gross_weight_kg: parseFloat(b.broken_mt) * 1000,
        created_at: b.completed_at || b.created_at || new Date(), updated_at: new Date(),
      });
    }

    if (parseFloat(b.bran_mt) > 0) {
      await knex('inventory_lots').insert({
        lot_no: 'LOT-N-' + String(lotSeq++).padStart(4, '0'),
        item_name: 'Rice Bran', type: 'byproduct', entity: 'mill',
        supplier_id: b.supplier_id, batch_ref: batchRef,
        qty: parseFloat(b.bran_mt), available_qty: parseFloat(b.bran_mt),
        reserved_qty: 0, unit: 'MT', status: 'Available',
        net_weight_kg: parseFloat(b.bran_mt) * 1000,
        gross_weight_kg: parseFloat(b.bran_mt) * 1000,
        created_at: b.completed_at || b.created_at || new Date(), updated_at: new Date(),
      });
    }

    if (parseFloat(b.husk_mt) > 0) {
      await knex('inventory_lots').insert({
        lot_no: 'LOT-H-' + String(lotSeq++).padStart(4, '0'),
        item_name: 'Rice Husk', type: 'byproduct', entity: 'mill',
        supplier_id: b.supplier_id, batch_ref: batchRef,
        qty: parseFloat(b.husk_mt), available_qty: parseFloat(b.husk_mt),
        reserved_qty: 0, unit: 'MT', status: 'Available',
        net_weight_kg: parseFloat(b.husk_mt) * 1000,
        gross_weight_kg: parseFloat(b.husk_mt) * 1000,
        created_at: b.completed_at || b.created_at || new Date(), updated_at: new Date(),
      });
    }
  }
};

exports.down = function () {
  // No rollback — these are seed data
};
