const db = require('../../config/database');
const { NotFoundError, ValidationError } = require('../../shared/errors');

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

    const rawQtyMT = Number(batch.raw_qty_mt) || 0;
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
          .where('mb.raw_qty_mt', '>', 0)
          .orderBy('cl.created_at', 'desc')
          .limit(5)
          .select('cl.quantity_used', 'mb.raw_qty_mt');

        if (history.length > 0) {
          const avgPerMT = history.reduce((s, h) =>
            s + (Number(h.quantity_used) / Number(h.raw_qty_mt)), 0) / history.length;
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
   * @param {boolean} allowNegative - override for insufficient stock
   */
  async confirm(batchId, lines, userId, allowNegative = false) {
    if (!lines || lines.length === 0) throw new ValidationError('At least one item is required.');

    const batch = await db('milling_batches').where('id', batchId).first();
    if (!batch) throw new NotFoundError('Batch not found.');
    if (batch.status === 'Closed') throw new ValidationError('Cannot consume against a closed batch.');

    return db.transaction(async (trx) => {
      const logs = [];
      const costByCategory = {};

      for (const line of lines) {
        const qty = Number(line.quantity);
        if (!qty || qty <= 0) continue;

        const item = await trx('mill_items').where('id', line.item_id).first();
        if (!item) throw new NotFoundError(`Item id ${line.item_id} not found.`);

        const warehouseId = line.warehouse_id || null;
        const costPerUnit = Number(item.avg_cost_per_unit) || 0;
        const totalCost = Number((qty * costPerUnit).toFixed(2));

        // Check stock
        const stockRow = await trx('mill_stock')
          .where({ item_id: item.id, warehouse_id: warehouseId })
          .first();
        const available = Number(stockRow?.quantity_available || 0);

        if (available < qty && !allowNegative) {
          throw new ValidationError(
            `Insufficient stock for ${item.name}: ${available} ${item.unit} available, ${qty} requested.`
          );
        }

        // Deduct stock
        if (stockRow) {
          await trx('mill_stock')
            .where('id', stockRow.id)
            .update({
              quantity_available: trx.raw('GREATEST(quantity_available - ?, 0)', [qty]),
              updated_at: trx.fn.now(),
            });
        }

        // Consumption log
        const [log] = await trx('mill_consumption_logs').insert({
          batch_id: batchId,
          item_id: item.id,
          warehouse_id: warehouseId,
          quantity_used: qty,
          cost_per_unit: costPerUnit,
          total_cost: totalCost,
          used_by: userId,
        }).returning('*');
        logs.push(log);

        // Stock movement
        await trx('mill_stock_movements').insert({
          item_id: item.id,
          warehouse_id: warehouseId,
          movement_type: 'consumption',
          quantity: -qty,
          cost_per_unit: costPerUnit,
          total_cost: totalCost,
          reference_type: 'batch',
          reference_id: batchId,
          performed_by: userId,
        });

        // Accumulate by milling_costs category
        const costCat = CATEGORY_MAP[item.category] || item.category;
        costByCategory[costCat] = (costByCategory[costCat] || 0) + totalCost;
      }

      // Upsert milling_costs — one row per category
      for (const [category, amount] of Object.entries(costByCategory)) {
        const existing = await trx('milling_costs')
          .where({ batch_id: batchId, category })
          .first();

        if (existing) {
          await trx('milling_costs')
            .where('id', existing.id)
            .update({
              amount: trx.raw('amount + ?', [amount]),
              notes: 'Updated via mill store consumption',
              updated_at: trx.fn.now(),
            });
        } else {
          await trx('milling_costs').insert({
            batch_id: batchId,
            category,
            amount,
            currency: 'PKR',
            notes: 'Auto-created via mill store consumption',
          });
        }
      }

      // Recompute total_cost_per_kg_finished if batch has finished output
      const allCosts = await trx('milling_costs').where('batch_id', batchId);
      const totalBatchCost = allCosts.reduce((s, c) => s + (Number(c.amount) || 0), 0);
      const finishedKg = (Number(batch.actual_finished_mt) || 0) * 1000;
      if (finishedKg > 0) {
        await trx('milling_batches').where('id', batchId).update({
          total_cost_per_kg_finished: Number((totalBatchCost / finishedKg).toFixed(4)),
        });
      }

      return {
        batch_id: batchId,
        lines_consumed: logs.length,
        total_cost: Object.values(costByCategory).reduce((s, v) => s + v, 0),
        cost_by_category: costByCategory,
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
