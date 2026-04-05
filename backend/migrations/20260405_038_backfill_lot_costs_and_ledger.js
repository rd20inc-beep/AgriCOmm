/**
 * Backfill: Fix zero-cost lots and create opening balance ledger entries.
 *
 * 1. For each finished/byproduct lot, derive cost from linked milling batch
 * 2. For each lot with no lot_transactions, create an opening_balance entry
 * 3. Flag any lot that still has zero cost as cost_incomplete=true
 */
exports.up = async function (knex) {
  const lots = await knex('inventory_lots').select('*');

  for (const lot of lots) {
    let costPerKg = parseFloat(lot.rate_per_kg) || parseFloat(lot.landed_cost_per_kg) || 0;

    // Try to derive cost from milling batch
    if (costPerKg === 0 && lot.batch_ref) {
      const batchId = lot.batch_ref.replace('batch-', '');
      const batch = await knex('milling_batches').where('id', parseInt(batchId)).first();

      if (batch) {
        const costs = await knex('milling_costs').where('batch_id', batch.id);
        const totalBatchCost = costs.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
        const finishedMT = parseFloat(batch.actual_finished_mt) || 0;
        const finishedKg = finishedMT * 1000;

        if (lot.type === 'finished' && finishedKg > 0) {
          costPerKg = totalBatchCost / finishedKg;
        } else if (lot.type === 'byproduct') {
          // Market-value allocation for byproducts
          const finishedPrice = parseFloat(batch.finished_price_per_mt) || 72800;
          const brokenPrice = parseFloat(batch.broken_price_per_mt) || 38000;
          const branPrice = parseFloat(batch.bran_price_per_mt) || 28000;
          const huskPrice = parseFloat(batch.husk_price_per_mt) || 8400;

          const name = (lot.item_name || '').toLowerCase();
          let myPrice = huskPrice;
          if (name.includes('broken')) myPrice = brokenPrice;
          else if (name.includes('bran')) myPrice = branPrice;

          const myQtyMT = parseFloat(lot.qty) || 0;
          const myMarketValue = myQtyMT * myPrice;

          const totalMarketValue =
            finishedMT * finishedPrice +
            (parseFloat(batch.broken_mt) || 0) * brokenPrice +
            (parseFloat(batch.bran_mt) || 0) * branPrice +
            (parseFloat(batch.husk_mt) || 0) * huskPrice;

          if (totalMarketValue > 0 && myQtyMT > 0) {
            const allocatedCost = totalBatchCost * (myMarketValue / totalMarketValue);
            costPerKg = allocatedCost / (myQtyMT * 1000);
          }
        }
      }
    }

    // Update lot cost fields
    if (costPerKg > 0) {
      const qtyKg = (parseFloat(lot.qty) || 0) * 1000;
      await knex('inventory_lots').where('id', lot.id).update({
        rate_per_kg: costPerKg,
        landed_cost_per_kg: costPerKg,
        landed_cost_total: costPerKg * qtyKg,
        cost_per_unit: costPerKg * 1000, // per MT
        total_value: costPerKg * qtyKg,
        cost_incomplete: false,
      });
    } else {
      await knex('inventory_lots').where('id', lot.id).update({
        cost_incomplete: true,
      });
    }

    // Create opening_balance ledger entry if lot has no transactions
    const txnCount = await knex('lot_transactions').where('lot_id', lot.id).count('id as c').first();
    if (parseInt(txnCount.c) === 0) {
      const qtyKg = (parseFloat(lot.qty) || 0) * 1000;
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const seq = await knex('lot_transactions').count('id as c').first();
      const txnNo = `TXN-${today}-${String((parseInt(seq.c) || 0) + 1).padStart(4, '0')}`;

      await knex('lot_transactions').insert({
        transaction_no: txnNo,
        transaction_date: lot.created_at || new Date(),
        lot_id: lot.id,
        transaction_type: 'opening_balance',
        quantity_kg: qtyKg,
        balance_kg: qtyKg,
        remarks: `Opening balance: ${lot.qty} MT ${lot.item_name} (backfilled)`,
        unit_cost: costPerKg > 0 ? costPerKg : null,
        total_cost: costPerKg > 0 ? costPerKg * qtyKg : null,
        entity_from: null,
        entity_to: lot.entity,
        performed_at: lot.created_at || new Date(),
        reference_module: lot.batch_ref ? 'milling_batch' : 'purchase',
        reference_no: lot.batch_ref || null,
        currency: 'PKR',
      });
    }
  }

  // Log the repair
  const repairedCount = await knex('inventory_lots').where('cost_incomplete', false).where('rate_per_kg', '>', 0).count('id as c').first();
  const incompleteCount = await knex('inventory_lots').where('cost_incomplete', true).count('id as c').first();

  await knex('historical_cost_repair_log').insert({
    issue_type: 'batch_backfill_zero_cost_lots',
    old_value_json: JSON.stringify({ zero_cost_lots: lots.filter(l => !(parseFloat(l.rate_per_kg) > 0)).length }),
    new_value_json: JSON.stringify({ repaired: parseInt(repairedCount.c), still_incomplete: parseInt(incompleteCount.c) }),
    repaired_at: new Date(),
    notes: 'Automated backfill from migration 038: derived costs from milling batch data using market-value allocation for byproducts',
  });
};

exports.down = async function (knex) {
  // Remove opening_balance transactions
  await knex('lot_transactions').where('transaction_type', 'opening_balance').del();
  // Clear cost_incomplete flags
  await knex('inventory_lots').update({ cost_incomplete: false });
};
