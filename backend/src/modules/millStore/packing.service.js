const db = require('../../config/database');
const accountingService = require('../accounting/accounting.service');
const inventoryService = require('../inventory/inventory.service');
const { NotFoundError, ValidationError } = require('../../shared/errors');

// Packing a milling batch's finished rice into bags. Consumes bags from store
// stock, records the packed (net) / tare / gross weight, and posts the bag cost
// to the P&L (mirrors mill-store consumption GL: DR 6000 / CR 1250).
const packingService = {
  // Summary of what's already been packed for a batch + how much finished rice
  // remains unpacked.
  async history(batchId) {
    const batch = await db('milling_batches').where('id', batchId).first();
    if (!batch) throw new NotFoundError('Batch not found.');

    const logs = await db('mill_packing_logs as pl')
      .leftJoin('mill_items as mi', 'mi.id', 'pl.bag_item_id')
      .leftJoin('users as u', 'u.id', 'pl.packed_by')
      .where('pl.batch_id', batchId)
      .select('pl.*', 'mi.name as bag_item_name', 'mi.code as bag_item_code', 'u.full_name as packed_by_name')
      .orderBy('pl.created_at', 'desc');

    const finishedKg = (Number(batch.actual_finished_mt) || 0) * 1000;
    const packedKg = logs.reduce((s, l) => s + (Number(l.packed_weight_kg) || 0), 0);
    const totalBags = logs.reduce((s, l) => s + (Number(l.bags_count) || 0), 0);

    return {
      batchId: Number(batchId),
      batchNo: batch.batch_no,
      finishedKg,
      packedKg: Number(packedKg.toFixed(3)),
      remainingKg: Number(Math.max(0, finishedKg - packedKg).toFixed(3)),
      totalBags,
      logs,
    };
  },

  // Pack `bagsCount` bags of `bagItemId` against a batch.
  async pack(batchId, { bag_item_id, bags_count, warehouse_id = null, notes }, userId, { allowOverPack = false } = {}) {
    const bagsCount = Number(bags_count);
    if (!bagsCount || bagsCount <= 0) throw new ValidationError('Bag count must be greater than zero.');

    return db.transaction(async (trx) => {
      const batch = await trx('milling_batches').where('id', batchId).first();
      if (!batch) throw new NotFoundError('Batch not found.');

      const item = await trx('mill_items').where('id', bag_item_id).first();
      if (!item) throw new NotFoundError('Bag item not found.');

      const capacity = Number(item.capacity_kg) || 0;
      if (capacity <= 0) {
        throw new ValidationError(`Set a bag capacity (kg per bag) for "${item.name}" before packing.`);
      }
      const tare = Number(item.tare_weight_kg) || 0;
      const warehouseId = warehouse_id || null;

      // Bag stock must cover the count (no over-consume).
      const stockRow = await trx('mill_stock')
        .where({ item_id: bag_item_id, warehouse_id: warehouseId })
        .first();
      const available = Number(stockRow?.quantity_available || 0);
      if (available < bagsCount) {
        throw new ValidationError(
          `Insufficient bags for "${item.name}": ${available} ${item.unit} in stock, ${bagsCount} needed.`
        );
      }

      const packedKg = Number((bagsCount * capacity).toFixed(3));   // net rice
      const tareKg = Number((bagsCount * tare).toFixed(4));         // packaging
      const grossKg = Number((packedKg + tareKg).toFixed(3));

      // Don't pack more net rice than the batch produced (small tolerance).
      const finishedKg = (Number(batch.actual_finished_mt) || 0) * 1000;
      if (!allowOverPack && finishedKg > 0) {
        const alreadyPacked = Number((await trx('mill_packing_logs')
          .where('batch_id', batchId).sum({ s: 'packed_weight_kg' }).first())?.s || 0);
        if (alreadyPacked + packedKg > finishedKg * 1.01) {
          throw new ValidationError(
            `Over-pack: batch produced ${finishedKg.toLocaleString()} kg, already packed ${alreadyPacked.toLocaleString()} kg, this adds ${packedKg.toLocaleString()} kg.`
          );
        }
      }

      const costPerBag = Number(item.avg_cost_per_unit) || 0;
      const totalCost = Number((bagsCount * costPerBag).toFixed(2));

      // Deduct bags from stock.
      await trx('mill_stock').where('id', stockRow.id).update({
        quantity_available: trx.raw('GREATEST(quantity_available - ?, 0)', [bagsCount]),
        updated_at: trx.fn.now(),
      });

      const [log] = await trx('mill_packing_logs').insert({
        batch_id: batchId,
        bag_item_id,
        warehouse_id: warehouseId,
        bags_count: bagsCount,
        capacity_kg_per_bag: capacity,
        tare_kg_per_bag: tare,
        packed_weight_kg: packedKg,
        tare_weight_kg: tareKg,
        gross_weight_kg: grossKg,
        cost_per_bag: costPerBag,
        total_cost: totalCost,
        notes: notes || null,
        packed_by: userId,
      }).returning('*');

      // Packing consumes bags; movement_type is constrained to a fixed set, so
      // record it as 'consumption' and distinguish it via reference_type='packing'.
      await trx('mill_stock_movements').insert({
        item_id: bag_item_id,
        warehouse_id: warehouseId,
        movement_type: 'consumption',
        quantity: -bagsCount,
        cost_per_unit: costPerBag,
        total_cost: totalCost,
        reference_type: 'packing',
        reference_id: log.id,
        reason: `Packed ${bagsCount} bag(s) for ${batch.batch_no || `batch ${batchId}`}`,
        performed_by: userId,
      });

      // GL: recognise the bag cost — DR 6000 Operating Expenses / CR 1250 Bags &
      // Packaging (same treatment as store consumption). Best-effort.
      if (totalCost > 0) {
        try {
          const opEx = await trx('chart_of_accounts').where({ code: '6000' }).first();
          const storeInv = await trx('chart_of_accounts').where({ code: '1250' }).first();
          if (opEx && storeInv) {
            const journal = await accountingService.createJournal(trx, {
              date: new Date().toISOString().slice(0, 10),
              entity: 'mill',
              refType: 'Mill Packing',
              refNo: batch.batch_no || `BATCH-${batchId}`,
              description: `Packing ${bagsCount} bag(s) for batch ${batch.batch_no || batchId} — Rs ${Math.round(totalCost).toLocaleString('en-PK')}`,
              currency: 'PKR',
              fxRate: 1,
              isAuto: true,
              userId,
              lines: [
                { account_id: opEx.id, account: opEx.name, debit: totalCost, credit: 0, narration: `DR 6000 Operating Expenses — ${batch.batch_no || batchId} packing` },
                { account_id: storeInv.id, account: storeInv.name, debit: 0, credit: totalCost, narration: `CR 1250 Bags & Packaging — bags used for ${batch.batch_no || batchId}` },
              ],
            });
            if (journal?.id) await accountingService.postJournal(trx, journal.id);
          }
        } catch (jeErr) {
          console.error('Packing journal post failed (packing still recorded):', jeErr.message);
        }
      }

      // Fold the bag cost into the batch as a 'packaging' milling_cost so it shows
      // in Mill Finance (Operating / Costs) and rolls into the residual finished-
      // rice cost. This is OPERATIONAL only (milling_costs is not a GL posting):
      // the GL recognises the bag expense once via the 6000/1250 journal above,
      // and local-sale COGS isn't GL-posted, so there's no GL double-count.
      if (totalCost > 0) {
        await trx('milling_costs').insert({
          batch_id: batchId, category: 'packaging', amount: totalCost, currency: 'PKR',
          notes: `Packing: ${bagsCount} × ${item.name} (log #${log.id})`,
          created_by: userId || null,
        });
        // Re-cost the batch's outputs so the finished cost/kg includes the bags
        // (no-op if the batch hasn't yielded yet).
        if ((Number(batch.actual_finished_mt) || 0) > 0) {
          try { await inventoryService.recomputeBatchOutputsAfterPriceChange(trx, batchId, { userId }); }
          catch (e) { console.error('Packing cost reallocation failed:', e.message); }
        }
      }

      return log;
    });
  },
};

module.exports = packingService;
