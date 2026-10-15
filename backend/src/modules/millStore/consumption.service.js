const db = require('../../config/database');
const auditService = require('../admin/audit.service');
const accountingService = require('../accounting/accounting.service');
const { postProcessingDelta } = require('../milling/millingCompletionJournal');
const { assertBatchOutputsUnsold } = require('../milling/costEditLocks');
const { NotFoundError, ValidationError } = require('../../shared/errors');
const { moveStock, postStoreJournal } = require('./storeStock');

// A batch in one of these can no longer take store stock.
const CLOSED_BATCH_STATUSES = ['Cancelled', 'Rejected'];

const CATEGORY_MAP = {
  packaging: 'packaging',
  operational: 'chemicals',
  fuel: 'diesel',
  maintenance: 'maintenance',
};

const consumptionService = {
  /**
   * Suggest materials for a batch based on consumption ratios and batch raw qty.
   * Falls back to historical average if no ratio defined.
   */
  async suggest(batchId) {
    const batch = await db('milling_batches').where('id', batchId).first();
    if (!batch) throw new NotFoundError('Batch not found.');

    // raw_qty_kg is KG (Phase 5c); consumption ratios are per-MT, so work in MT here.
    const rawQtyMT = (Number(batch.raw_qty_kg) || 0) / 1000;
    if (rawQtyMT <= 0) throw new ValidationError('Batch has no raw quantity.');

    const productId = batch.linked_export_order_id
      ? (await db('export_orders').where('id', batch.linked_export_order_id).select('product_id').first())?.product_id
      : null;

    // Get all active items
    const items = await db('mill_items').where('is_active', true).orderBy('category').orderBy('name');

    const suggestions = [];

    for (const item of items) {
      // Try product-specific ratio first, then generic
      let ratio = null;
      if (productId) {
        ratio = await db('mill_consumption_ratios')
          .where({ item_id: item.id, product_id: productId, is_active: true })
          .first();
      }
      if (!ratio) {
        ratio = await db('mill_consumption_ratios')
          .where({ item_id: item.id, is_active: true })
          .whereNull('product_id')
          .first();
      }

      let suggestedQty = 0;
      let source = 'none';

      if (ratio) {
        suggestedQty = Number((rawQtyMT * Number(ratio.unit_per_mt)).toFixed(3));
        source = 'ratio';
      } else {
        // Fallback: average of last 5 completed-batch consumptions for this item
        const history = await db('mill_consumption_logs as cl')
          .join('milling_batches as mb', 'mb.id', 'cl.batch_id')
          .where('cl.item_id', item.id)
          .where('mb.status', 'Completed')
          .where('mb.raw_qty_kg', '>', 0)
          .orderBy('cl.created_at', 'desc')
          .limit(5)
          .select('cl.quantity_used', 'mb.raw_qty_kg');

        if (history.length > 0) {
          const avgPerMT = history.reduce((s, h) =>
            s + (Number(h.quantity_used) / (Number(h.raw_qty_kg) / 1000)), 0) / history.length;
          suggestedQty = Number((rawQtyMT * avgPerMT).toFixed(3));
          source = 'history';
        }
      }

      if (suggestedQty <= 0) continue;

      // Current on-hand
      const stockRow = await db('mill_stock')
        .where('item_id', item.id)
        .sum({ total: 'quantity_available' })
        .first();
      const onHand = Number(stockRow?.total || 0);

      suggestions.push({
        item_id: item.id,
        item_code: item.code,
        item_name: item.name,
        category: item.category,
        unit: item.unit,
        suggested_qty: suggestedQty,
        suggestion_source: source,
        on_hand: onHand,
        avg_cost_per_unit: Number(item.avg_cost_per_unit) || 0,
        estimated_cost: Number((suggestedQty * (Number(item.avg_cost_per_unit) || 0)).toFixed(2)),
        sufficient: onHand >= suggestedQty,
      });
    }

    return {
      batch_id: batchId,
      batch_no: batch.batch_no,
      raw_qty_mt: rawQtyMT,
      suggestions,
    };
  },

  /**
   * Confirm consumption: deduct stock, log, post to milling_costs.
   * @param {number} batchId
   * @param {Array} lines - [{item_id, quantity, warehouse_id?}]
   * @param {number} userId
   * @param {boolean} allowNegative - override for insufficient stock: issue
   *   what the store holds and report the rest as short. Nothing is booked for
   *   stock that was not there (INV-44: the old override clamped the stock at
   *   zero but still logged, costed and journalled the full quantity).
   */
  async confirm(batchId, lines, userId, allowNegative = false, { req = null } = {}) {
    if (!lines || lines.length === 0) throw new ValidationError('At least one item is required.');

    return db.transaction(async (trx) => {
      const batch = await trx('milling_batches').where('id', batchId).forUpdate().first();
      if (!batch) throw new NotFoundError('Batch not found.');
      // The guard used to test for 'Closed', a status batches never have, so
      // store stock could be issued to a Cancelled or Rejected batch.
      if (CLOSED_BATCH_STATUSES.includes(batch.status)) {
        throw new ValidationError(`Cannot consume against a ${String(batch.status).toLowerCase()} batch — ${batch.batch_no || `batch ${batchId}`} is ${batch.status}.`);
      }
      // After the yield, a consumption re-costs the output lots — refused once
      // an output has been sold or used (the same lock the Costs tab applies).
      await assertBatchOutputsUnsold(trx, batch);

      const logs = [];
      const shortages = [];
      const costByCategory = {};
      const label = batch.batch_no || `batch ${batchId}`;

      for (const line of lines) {
        const qty = Number(line.quantity);
        if (!qty || qty <= 0) continue;

        const item = await trx('mill_items').where('id', line.item_id).first();
        if (!item) throw new NotFoundError(`Item id ${line.item_id} not found.`);
        const warehouseId = line.warehouse_id || null;

        // Issued at the item's average cost, under a lock on its stock row and
        // item (INV-47), never below zero.
        const issue = await moveStock(trx, {
          itemId: item.id, warehouseId, qty: -qty, valuation: 'avg', clamp: true,
          movement: {
            movement_type: 'consumption', reference_type: 'batch', reference_id: batchId,
            performed_by: userId,
          },
        });
        if (issue.short > 0) {
          if (!allowNegative) {
            throw new ValidationError(
              `Insufficient stock for ${item.name}: ${Number((qty - issue.short).toFixed(3))} ${item.unit} available, ${qty} requested.`
            );
          }
          shortages.push({ item: item.name, unit: item.unit, needed: qty, issued: -issue.moved, short: issue.short });
        }
        const used = -issue.moved;
        if (!(used > 0)) continue;
        const totalCost = Math.abs(issue.value);

        const [log] = await trx('mill_consumption_logs').insert({
          batch_id: batchId,
          item_id: item.id,
          warehouse_id: warehouseId,
          quantity_used: used,
          cost_per_unit: issue.unitCost,
          total_cost: totalCost,
          used_by: userId,
        }).returning('*');
        logs.push(log);

        // One cost line per issue, owned by it (MIL-23). This used to ADD into
        // the batch's first row of the category — which could be a packing
        // run's row (wiping its tag) or the cost sheet's own figure.
        const costCat = CATEGORY_MAP[item.category] || item.category;
        costByCategory[costCat] = (costByCategory[costCat] || 0) + totalCost;
        if (totalCost > 0) {
          await trx('milling_costs').insert({
            batch_id: batchId,
            category: costCat,
            amount: totalCost,
            currency: 'PKR',
            notes: `Mill store issue: ${used} ${item.unit} ${item.name}`,
            source: 'store_consumption',
            source_id: log.id,
            created_by: userId || null,
          });
        }
      }


      // ── GL entry: move mill-store inventory → operating expense ──
      // store_purchase booked DR 1250 Bags & Packaging / CR 2010 Supplier
      // Payable on receipt. Consumption clears the inventory asset and
      // recognizes the cost on the P&L — DR 6000 / CR 1250 — for exactly what
      // left the store. The stock issue and its journal are one event (P2-02):
      // a journal that cannot be posted rolls the consumption back.
      const totalConsumed = Math.round(Object.values(costByCategory).reduce((s, v) => s + v, 0) * 100) / 100;
      if (totalConsumed > 0) {
        await postStoreJournal(trx, {
          amount: totalConsumed,
          refType: 'Mill Store Consumption',
          refNo: batch.batch_no || `BATCH-${batchId}`,
          description: `Mill store consumption for batch ${label} — ${logs.length} item${logs.length === 1 ? '' : 's'}, Rs ${Math.round(totalConsumed).toLocaleString('en-PK')}`,
          userId,
          what: 'The consumption',
        });
      }

      // After the batch's completion the issued stock is absorbed into its
      // finished goods straight away (Dr 1220 / Cr 6000); before it, the
      // completion absorbs the whole cost sheet (A3b).
      if (totalConsumed > 0) {
        await postProcessingDelta(trx, accountingService, {
          batch, delta: totalConsumed, label: 'mill store consumption', userId,
        });
      }

      // After the yield, re-run the residual allocation (P3-07 / MIL-13) so the
      // output lots, the batch's cost per kg and the 1220 / 1240 split carry
      // the new cost — it used to overwrite total_cost_per_kg_finished with a
      // plain Σ cost ÷ finished (not residual) and leave the lots stale.
      // No-op before the yield (the yield allocates the whole sheet).
      const inventoryService = require('../inventory/inventory.service');
      const realloc = await inventoryService.recomputeBatchOutputsAfterPriceChange(trx, batchId, { userId });
      if (realloc && realloc.reallocated && realloc.finishedCostPerKg != null) {
        await trx('milling_batches').where({ id: batchId }).update({ finished_price_per_kg: realloc.finishedCostPerKg });
      }

      // Audited inside the transaction (P2-30) when called over HTTP.
      if (req) {
        await auditService.logInTrx(trx, req, {
          action: 'confirm_consumption', entityType: 'milling_batch', entityId: batchId,
          result: { lines_consumed: logs.length, total_cost: totalConsumed, shortages },
        });
      }

      return {
        batch_id: batchId,
        lines_consumed: logs.length,
        total_cost: totalConsumed,
        cost_by_category: costByCategory,
        shortages,
        logs,
      };
    });
  },

  /**
   * Get consumption history for a batch.
   */
  async history(batchId) {
    const batch = await db('milling_batches').where('id', batchId).first();
    if (!batch) throw new NotFoundError('Batch not found.');

    const logs = await db('mill_consumption_logs as cl')
      .join('mill_items as mi', 'mi.id', 'cl.item_id')
      .leftJoin('users as u', 'u.id', 'cl.used_by')
      .leftJoin('warehouses as w', 'w.id', 'cl.warehouse_id')
      .where('cl.batch_id', batchId)
      .select(
        'cl.*',
        'mi.code as item_code',
        'mi.name as item_name',
        'mi.category',
        'mi.unit',
        'u.full_name as used_by_name',
        'w.name as warehouse_name'
      )
      .orderBy('cl.created_at', 'desc');

    const totalCost = logs.reduce((s, l) => s + (Number(l.total_cost) || 0), 0);

    return {
      batch_id: batchId,
      batch_no: batch.batch_no,
      logs,
      total_consumption_cost: totalCost,
    };
  },
};

module.exports = consumptionService;
module.exports.CLOSED_BATCH_STATUSES = CLOSED_BATCH_STATUSES;
