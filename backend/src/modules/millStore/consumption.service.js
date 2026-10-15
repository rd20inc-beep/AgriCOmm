const db = require('../../config/database');
const auditService = require('../admin/audit.service');
const accountingService = require('../accounting/accounting.service');
const { postProcessingDelta } = require('../milling/millingCompletionJournal');
const { assertBatchOutputsUnsold } = require('../milling/costEditLocks');
const { NotFoundError, ValidationError } = require('../../shared/errors');
const { ledgerFailure, missingAccounts } = require('../../shared/ledgerFailure');

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
   * @param {boolean} allowNegative - override for insufficient stock
   */
  async confirm(batchId, lines, userId, allowNegative = false, { req = null } = {}) {
    if (!lines || lines.length === 0) throw new ValidationError('At least one item is required.');

    const batch = await db('milling_batches').where('id', batchId).first();
    if (!batch) throw new NotFoundError('Batch not found.');
    // A real status guard (MIL-13): batches never reach 'Closed', so the old
    // check let cancelled / rejected batches take stock and cost.
    if (['Cancelled', 'Rejected'].includes(batch.status)) {
      throw new ValidationError(`Cannot consume against batch ${batch.batch_no || batchId} — it is ${batch.status}.`);
    }

    return db.transaction(async (trx) => {
      // After the yield, a consumption re-costs the output lots — refused once
      // an output has been sold or used (the same lock the Costs tab applies).
      await assertBatchOutputsUnsold(trx, batch);

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
        // Never merged into a business expense's own row (P2-21).
        const existing = await trx('milling_costs')
          .where({ batch_id: batchId, category })
          .whereNull('business_expense_id')
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


      // ── GL entry: move mill-store inventory → operating expense ──
      // store_purchase booked DR 1250 Bags & Packaging / CR 2010 Supplier
      // Payable on receipt. Consumption clears the inventory asset and
      // recognizes the cost on the P&L:
      //   DR 6000 Operating Expenses
      //   CR 1250 Bags & Packaging
      // The stock issue and its journal are one event (P2-02). A missing
      // account or a journal that cannot be posted used to be logged and
      // swallowed — the store stock left while 1250 kept it. Now the whole
      // consumption rolls back and the user is told why.
      const totalConsumed = Object.values(costByCategory).reduce((s, v) => s + v, 0);
      if (totalConsumed > 0) {
        const opEx     = await trx('chart_of_accounts').where({ code: '6000' }).first();
        const storeInv = await trx('chart_of_accounts').where({ code: '1250' }).first();
        if (!opEx || !storeInv) throw missingAccounts(['6000', '1250'], 'The consumption');
        try {
          const journal = await accountingService.createJournal(trx, {
            date: new Date().toISOString().slice(0, 10),
            entity: 'mill',
            refType: 'Mill Store Consumption',
            refNo: batch.batch_no || `BATCH-${batchId}`,
            description: `Mill store consumption for batch ${batch.batch_no || batchId} — ${logs.length} item${logs.length === 1 ? '' : 's'}, Rs ${Math.round(totalConsumed).toLocaleString('en-PK')}`,
            currency: 'PKR',
            fxRate: 1,
            isAuto: true,
            userId,
            lines: [
              { account_id: opEx.id,     account: opEx.name,     debit: totalConsumed, credit: 0,             narration: `DR 6000 Operating Expenses — ${batch.batch_no || batchId} consumption` },
              { account_id: storeInv.id, account: storeInv.name, debit: 0,             credit: totalConsumed, narration: `CR 1250 Bags & Packaging — stock issued to ${batch.batch_no || batchId}` },
            ],
          });
          if (journal?.id) await accountingService.postJournal(trx, journal.id);
        } catch (jeErr) {
          throw ledgerFailure(jeErr, 'The consumption');
        }
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
          result: { lines_consumed: logs.length, total_cost: totalConsumed },
        });
      }

      return {
        batch_id: batchId,
        lines_consumed: logs.length,
        total_cost: totalConsumed,
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
