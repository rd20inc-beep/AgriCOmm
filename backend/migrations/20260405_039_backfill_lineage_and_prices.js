/**
 * Backfill: Create lot_source_mapping and milling_output_market_prices
 * from existing batch data.
 */
exports.up = async function (knex) {
  const batches = await knex('milling_batches').where('actual_finished_mt', '>', 0);

  for (const batch of batches) {
    const batchRef = 'batch-' + batch.id;

    // 1. Backfill milling_output_market_prices if not exists
    const existingPrice = await knex('milling_output_market_prices').where('batch_id', batch.id).first();
    if (!existingPrice) {
      const costs = await knex('milling_costs').where('batch_id', batch.id);
      const totalBatchCost = costs.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);

      const fp = parseFloat(batch.finished_price_per_mt) || 72800;
      const bp = parseFloat(batch.broken_price_per_mt) || 38000;
      const np = parseFloat(batch.bran_price_per_mt) || 28000;
      const hp = parseFloat(batch.husk_price_per_mt) || 8400;

      const fm = parseFloat(batch.actual_finished_mt) || 0;
      const bm = parseFloat(batch.broken_mt) || 0;
      const nm = parseFloat(batch.bran_mt) || 0;
      const hm = parseFloat(batch.husk_mt) || 0;

      const totalMV = fm * fp + bm * bp + nm * np + hm * hp;

      await knex('milling_output_market_prices').insert({
        batch_id: batch.id,
        finished_price_per_mt: fp,
        broken_price_per_mt: bp,
        bran_price_per_mt: np,
        husk_price_per_mt: hp,
        confirmed_at: batch.completed_at || batch.created_at,
        notes: JSON.stringify({
          totalBatchCost,
          totalMarketValue: totalMV,
          source: 'backfill_migration_039',
        }),
      });
    }

    // 2. Backfill lot_source_mapping
    const rawLots = await knex('inventory_lots').where({ batch_ref: batchRef, type: 'raw' });
    const outputLots = await knex('inventory_lots').where({ batch_ref: batchRef }).whereIn('type', ['finished', 'byproduct']);

    for (const rawLot of rawLots) {
      for (const outLot of outputLots) {
        const existing = await knex('lot_source_mapping')
          .where({ parent_lot_id: rawLot.id, child_lot_id: outLot.id, source_batch_id: batch.id })
          .first();
        if (!existing) {
          const outQtyKg = (parseFloat(outLot.qty) || 0) * 1000;
          const costShare = (parseFloat(outLot.rate_per_kg) || 0) * outQtyKg;
          await knex('lot_source_mapping').insert({
            parent_lot_id: rawLot.id,
            child_lot_id: outLot.id,
            source_batch_id: batch.id,
            quantity_kg: outQtyKg,
            cost_share_amount: costShare,
            mapping_type: 'milling_input_to_output',
          });
        }
      }
    }

    // If no raw lots found (seeded lots), create batch-only lineage for output lots
    if (rawLots.length === 0) {
      for (const outLot of outputLots) {
        const existing = await knex('lot_source_mapping')
          .where({ child_lot_id: outLot.id, source_batch_id: batch.id })
          .first();
        if (!existing) {
          const outQtyKg = (parseFloat(outLot.qty) || 0) * 1000;
          const costShare = (parseFloat(outLot.rate_per_kg) || 0) * outQtyKg;
          await knex('lot_source_mapping').insert({
            parent_lot_id: null, // no raw lot available (seeded data)
            child_lot_id: outLot.id,
            source_batch_id: batch.id,
            quantity_kg: outQtyKg,
            cost_share_amount: costShare,
            mapping_type: 'milling_input_to_output',
          });
        }
      }
    }
  }

  // Log
  const lineageCount = await knex('lot_source_mapping').count('id as c').first();
  const priceCount = await knex('milling_output_market_prices').count('id as c').first();
  await knex('historical_cost_repair_log').insert({
    issue_type: 'backfill_lineage_and_market_prices',
    new_value_json: JSON.stringify({ lineage_records: parseInt(lineageCount.c), price_snapshots: parseInt(priceCount.c) }),
    repaired_at: new Date(),
    notes: 'Migration 039: backfilled lot_source_mapping and milling_output_market_prices from existing batch data',
  });
};

exports.down = async function (knex) {
  await knex('lot_source_mapping').where('mapping_type', 'milling_input_to_output').del();
  await knex('milling_output_market_prices').del();
};
