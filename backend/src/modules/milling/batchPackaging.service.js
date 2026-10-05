const db = require('../../config/database');
const { NotFoundError, ValidationError } = require('../../shared/errors');
const { formatPackSize } = require('../../shared/packagingTypes');

/**
 * Packaging recorded on a milling batch (migration 307).
 *
 * A batch could only ever state ONE bag size, so "300 katta and 500 P.P. bags"
 * could not be said and the katta reconciler inferred everything from the raw
 * lots — which is what filed 25 kg P.P. bags as katta. A line here names an
 * actual packaging item, so its pack_type decides which stock it belongs to and
 * its own price decides what it costs.
 *
 *   received  empty bags that come free as the rice is milled out of them → into store
 *   consumed  bags drawn from store to pack this batch's output → out of store
 *
 * Saving is a REPLACE of the batch's lines, and stock is moved by the DIFFERENCE
 * against what was there before. Editing a line from 300 to 320 posts 20, not
 * another 320 — the same reason reconcileBatchKatta reverses itself before
 * recomputing. Every movement carries reference_type='batch_packaging' and the
 * line id, so it can always be traced back and undone.
 */

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Inbound uses 'return' and outbound 'consumption': mill_stock_movements.
// movement_type is CHECK-constrained to purchase/consumption/adjustment/
// reservation/return, so these are the only two that fit what is happening.
const MOVEMENT_FOR = { received: 'return', consumed: 'consumption' };
const REF = 'batch_packaging';

// Only a KATTA or a P.P. BAG can be RECEIVED on a batch. Confirmed with the
// client: a master bag and a polythene sheet are bought into store and only ever
// used — nothing frees them, because no rice arrives in them. Katta and P.P.
// bags do come free as the rice is milled out of them.
//
// This is a validation, not just a costing rule. A "received 80 masters" line
// would add 80 masters to store stock that nobody bought, and then credit their
// cost against the batch — inventing both the stock and the saving.
const RECEIVABLE_PACK_TYPES = ['katta', 'pp_bag'];

async function itemsById(conn, ids) {
  if (!ids.length) return {};
  const rows = await conn('mill_items').whereIn('id', ids)
    .select('id', 'code', 'name', 'unit', 'category', 'pack_type', 'capacity_kg',
      'size_value', 'size_unit', 'avg_cost_per_unit');
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

// Move store stock by a signed amount, creating the row if this item has never
// been stocked at this location. Never goes below zero: a consumption bigger
// than the stock on hand is a shortage to record, not a negative balance.
async function moveStock(trx, { itemId, warehouseId = null, delta }) {
  if (!delta) return;
  const row = await trx('mill_stock').where({ item_id: itemId, warehouse_id: warehouseId }).first();
  if (row) {
    await trx('mill_stock').where({ id: row.id }).update({
      quantity_available: trx.raw('GREATEST(quantity_available + ?, 0)', [delta]),
      updated_at: trx.fn.now(),
    });
  } else {
    await trx('mill_stock').insert({
      item_id: itemId, warehouse_id: warehouseId,
      quantity_available: Math.max(0, delta), quantity_reserved: 0,
    });
  }
}

const batchPackagingService = {
  /** Every packaging line on a batch, with the item it names. */
  async list(batchId, conn = db) {
    const rows = await conn('milling_batch_packaging as bp')
      .join('mill_items as mi', 'mi.id', 'bp.mill_item_id')
      .where('bp.batch_id', batchId)
      .select(
        'bp.*',
        'mi.code as item_code', 'mi.name as item_name', 'mi.unit as item_unit',
        'mi.pack_type', 'mi.capacity_kg', 'mi.size_value', 'mi.size_unit',
        'mi.avg_cost_per_unit as current_cost',
      )
      .orderBy(['bp.direction', 'mi.pack_type', 'mi.code']);
    return rows.map((r) => ({
      ...r,
      quantity: Number(r.quantity),
      unitCostPkr: r.unit_cost_pkr == null ? null : Number(r.unit_cost_pkr),
      totalCostPkr: r.total_cost_pkr == null ? null : Number(r.total_cost_pkr),
      sizeLabel: formatPackSize(r.size_value, r.size_unit),
    }));
  },

  /**
   * Replace a batch's packaging lines and move store stock by the difference.
   *
   * @param {Array<{mill_item_id:number, direction:string, quantity:number,
   *   output_type?:string, unit_cost_pkr?:number, notes?:string}>} lines
   */
  async save(batchId, lines, userId, conn = null) {
    const run = async (trx) => {
      const batch = await trx('milling_batches').where('id', batchId).first();
      if (!batch) throw new NotFoundError('Milling batch not found.');

      const incoming = (Array.isArray(lines) ? lines : []).filter((l) => Number(l.quantity) > 0);
      const ids = [...new Set(incoming.map((l) => Number(l.mill_item_id)).filter(Boolean))];
      const items = await itemsById(trx, ids);
      for (const l of incoming) {
        const item = items[Number(l.mill_item_id)];
        if (!item) throw new ValidationError(`Packaging item ${l.mill_item_id} not found.`);
        if (!MOVEMENT_FOR[l.direction]) throw new ValidationError(`Unknown direction '${l.direction}'.`);
        // A by-product line only makes sense on the way out; nothing is received
        // "for a by-product".
        if (l.direction === 'received' && l.output_type) {
          throw new ValidationError('A received line is not against an output — leave the output blank.');
        }
        if (l.direction === 'received' && !RECEIVABLE_PACK_TYPES.includes(item.pack_type)) {
          throw new ValidationError(
            `${item.name} cannot be received on a batch — nothing frees a ${item.pack_type === 'master_bag' ? 'master bag' : item.pack_type === 'polythene' ? 'polythene sheet' : 'item of this kind'}.`
            + ' Record it as used, and buy it into store through Mill Store.',
          );
        }
      }

      // What the batch had, so stock can move by the difference rather than
      // being posted again in full on every edit.
      const existing = await trx('milling_batch_packaging').where('batch_id', batchId);
      const keyOf = (l) => `${Number(l.mill_item_id)}|${l.direction}|${l.output_type || ''}`;
      const wasBy = new Map(existing.map((e) => [keyOf(e), e]));

      // Stock deltas are ACCUMULATED per item and applied once at the end, not
      // as each line is walked. moveStock clamps at zero so store stock can
      // never go negative, and that clamp destroys quantity if an intermediate
      // step dips below zero: dropping a "500 received / 400 consumed" pair left
      // 400 bags behind, because removing the 500 clamped 100 to 0 before the
      // 400 came back. The net is what actually happened; the order is not.
      const stockDelta = new Map();
      const bump = (itemId, delta) => {
        if (!delta) return;
        stockDelta.set(itemId, (stockDelta.get(itemId) || 0) + delta);
      };
      // The ledger still gets a row per line, so every change stays traceable.
      const movements = [];

      const kept = new Set();
      const saved = [];
      for (const l of incoming) {
        const key = keyOf(l);
        kept.add(key);
        const item = items[Number(l.mill_item_id)];
        const qty = round3(l.quantity);
        // The price is snapshot: Mill Store prices change, and what this batch
        // cost must not move when someone corrects a price next month.
        const unitCost = l.unit_cost_pkr != null && l.unit_cost_pkr !== ''
          ? Number(l.unit_cost_pkr)
          : (Number(item.avg_cost_per_unit) || 0);
        const row = {
          batch_id: batchId,
          mill_item_id: item.id,
          direction: l.direction,
          output_type: l.output_type || null,
          quantity: qty,
          unit_cost_pkr: unitCost,
          total_cost_pkr: round2(qty * unitCost),
          notes: l.notes || null,
          created_by: userId || null,
          updated_at: trx.fn.now(),
        };

        const prev = wasBy.get(key);
        let lineId;
        if (prev) {
          await trx('milling_batch_packaging').where('id', prev.id).update(row);
          lineId = prev.id;
        } else {
          const [ins] = await trx('milling_batch_packaging').insert(row).returning('id');
          lineId = ins?.id || ins;
        }

        // received adds to store, consumed takes away — and only the CHANGE moves.
        const sign = l.direction === 'received' ? 1 : -1;
        const delta = (qty - round3(prev?.quantity || 0)) * sign;
        if (delta !== 0) {
          bump(item.id, delta);
          movements.push({
            item_id: item.id, warehouse_id: null,
            movement_type: MOVEMENT_FOR[l.direction],
            quantity: delta,
            cost_per_unit: unitCost,
            total_cost: round2(Math.abs(delta) * unitCost),
            reference_type: REF, reference_id: lineId,
            reason: `${l.direction === 'received' ? 'Freed into store' : 'Used to pack'}`
              + ` — ${batch.batch_no || `batch ${batchId}`}`
              + `: ${qty} x ${item.name}${l.output_type ? ` (${l.output_type})` : ''}`
              + `${prev ? ` (was ${round3(prev.quantity)})` : ''}`,
            performed_by: userId || null,
          });
        }
        saved.push({ id: lineId, ...row });
      }

      // Lines the user removed: put their stock back the way it was.
      for (const [key, prev] of wasBy) {
        if (kept.has(key)) continue;
        const sign = prev.direction === 'received' ? 1 : -1;
        const delta = -round3(prev.quantity) * sign;
        bump(prev.mill_item_id, delta);
        movements.push({
          item_id: prev.mill_item_id, warehouse_id: null,
          movement_type: MOVEMENT_FOR[prev.direction],
          quantity: delta,
          cost_per_unit: prev.unit_cost_pkr,
          total_cost: round2(Math.abs(delta) * (Number(prev.unit_cost_pkr) || 0)),
          reference_type: REF, reference_id: prev.id,
          reason: `Removed from ${batch.batch_no || `batch ${batchId}`}: ${round3(prev.quantity)} x item ${prev.mill_item_id}`,
          performed_by: userId || null,
        });
        await trx('milling_batch_packaging').where('id', prev.id).del();
      }

      // One stock move per item, for the net of everything above.
      for (const [itemId, delta] of stockDelta) {
        await moveStock(trx, { itemId, delta: round3(delta) });
      }
      if (movements.length) await trx('mill_stock_movements').insert(movements);

      return batchPackagingService.list(batchId, trx);
    };
    return conn ? run(conn) : db.transaction(run);
  },

  /**
   * The packaging totals a batch's costing needs, grouped the way the formula is
   * written:
   *
   *   Final expenses = Total
   *                  − katta received      (empty sacks that went into store)
   *                  − P.P. bags received
   *                  + katta consumed on by-products
   *
   * Received packaging is store stock the mill now holds, so its cost does not
   * belong in this batch's expenses; katta spent bagging by-products is gone and
   * does. Prices are each line's own snapshot, never a rate typed in here.
   */
  async costAdjustments(batchId, conn = db) {
    const rows = await conn('milling_batch_packaging as bp')
      .join('mill_items as mi', 'mi.id', 'bp.mill_item_id')
      .where('bp.batch_id', batchId)
      .select('bp.direction', 'bp.output_type', 'bp.quantity', 'bp.total_cost_pkr', 'mi.pack_type');

    const bucket = {
      receivedKatta: { qty: 0, cost: 0 },
      receivedBags: { qty: 0, cost: 0 },
      byproductKatta: { qty: 0, cost: 0 },
      consumedOther: { qty: 0, cost: 0 },
    };
    const add = (b, r) => { b.qty += Number(r.quantity) || 0; b.cost += Number(r.total_cost_pkr) || 0; };

    for (const r of rows) {
      if (r.direction === 'received') {
        // Only katta and P.P. bags can be here — save() refuses anything else.
        if (r.pack_type === 'katta') add(bucket.receivedKatta, r);
        else if (r.pack_type === 'pp_bag') add(bucket.receivedBags, r);
      } else if (r.pack_type === 'katta' && r.output_type === 'byproduct') {
        add(bucket.byproductKatta, r);
      } else {
        add(bucket.consumedOther, r);
      }
    }

    // Katta and P.P. bags freed into store are stock the mill now holds, so
    // their cost leaves this batch. Nothing else can be received, so nothing
    // else is credited — which is exactly the client's formula:
    //   Final = Total − katta received − P.P. bags received + by-product katta
    const receivedCost = bucket.receivedKatta.cost + bucket.receivedBags.cost;
    return {
      ...bucket,
      receivedCost: round2(receivedCost),
      byproductKattaCost: round2(bucket.byproductKatta.cost),
      // What to apply to the batch's total expenses. Negative reduces them.
      netAdjustmentPkr: round2(bucket.byproductKatta.cost - receivedCost),
      hasLines: rows.length > 0,
    };
  },

  // The store-stock move every packaging line uses — exposed so deleting a
  // batch can put back what its packing runs drew with the same clamp rules.
  moveStock,
};

module.exports = batchPackagingService;
