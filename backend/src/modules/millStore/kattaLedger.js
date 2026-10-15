const accountingService = require('../accounting/accounting.service');
const { postProcessingDelta } = require('../milling/millingCompletionJournal');
const { moveStock, postStoreJournal, r2, r4 } = require('./storeStock');

// ─── Katta reconcile: what it moves, applied as a signed delta (P3-05) ──────
//
// The yield reconcile (and the repack credit of a local sale) used to undo its
// earlier movements — `quantity_available - prior` with no clamp — delete them,
// and write the new set. Once freed katta had been sold or packed, the undo
// took stock below zero, the mill_stock_available_non_neg CHECK fired, and the
// whole pack / run edit / re-yield failed (MIL-22). The deleted rows also took
// the history with them.
//
// Now the caller states what the reference SHOULD have moved (its plan) and
// this applies only the difference against what it has already moved, as new
// movement rows (append-only). Each plan line is one of:
//   family 'freed' (movement_type 'return')      — sacks freed into the store
//   family 'draw'  (movement_type 'consumption') — sacks taken out of it
// and is valued as:
//   'zero'     no value (freed sacks; by-weight katta) — today's basis
//   'gl'       at average cost, booked DR 6000 / CR 1250 here and charged to
//              the batch as its 'katta_reconcile' packaging cost line
//   'prepaid'  at average cost, already booked by a 'pack' packing run
// A take-back of freed sacks that are no longer in the store is LEDGERED: the
// reference's own row records the full take-back and a 'batch_katta_shortfall'
// adjustment row records that the store could not give them back, so the
// reference converges and the stock ledger still adds up to on-hand. A draw
// the store cannot cover is flagged as a shortage and drawn on a later run.
//
// Movements written before this (valuation NULL) were all unvalued: a
// reference that has any keeps its unvalued basis for everything but 'gl'
// lines, so an old batch is never re-costed retroactively.

const FAMILY_TYPE = { freed: 'return', draw: 'consumption' };
const EPS = 1e-6;

function keyOf(itemId, warehouseId, family, cls) {
  return `${itemId}|${warehouseId ?? ''}|${family}|${cls}`;
}

/**
 * plan: [{ itemId, warehouseId, family, cls, qty (> 0), reason, item? }]
 * Returns { shortages, ledgered, glValue, costDelta }.
 */
async function applyKattaPlan(trx, {
  referenceType, referenceId, plan, userId = null, batch = null, shortfallReason = null,
}) {
  const prior = await trx('mill_stock_movements')
    .where({ reference_type: referenceType, reference_id: referenceId })
    .select('item_id', 'warehouse_id', 'movement_type', 'quantity', 'valuation', 'cost_per_unit', 'total_cost');
  const legacy = prior.some((m) => m.valuation == null);
  const classOf = (cls) => (legacy && cls === 'prepaid' ? 'zero' : cls);

  // Target per key (signed: freed +, draw −) and what has moved per key.
  const keys = new Map();
  const slot = (itemId, warehouseId, family, cls) => {
    const k = keyOf(itemId, warehouseId, family, cls);
    if (!keys.has(k)) keys.set(k, { itemId: Number(itemId), warehouseId: warehouseId ?? null, family, cls, target: 0, done: 0, doneValue: 0, reason: null, item: null });
    return keys.get(k);
  };
  for (const p of plan) {
    if (!(Number(p.qty) > 0)) continue;
    const s = slot(p.itemId, p.warehouseId, p.family, classOf(p.cls));
    s.target += p.family === 'freed' ? Number(p.qty) : -Number(p.qty);
    s.reason = s.reason || p.reason;
    s.item = s.item || p.item || null;
  }
  for (const m of prior) {
    const family = m.movement_type === 'return' ? 'freed' : 'draw';
    const s = slot(m.item_id, m.warehouse_id, family, m.valuation == null ? 'zero' : classOf(m.valuation));
    const q = Number(m.quantity) || 0;
    s.done += q;
    // Value signed like the quantity (into the store +).
    const v = m.total_cost != null ? Number(m.total_cost) : Math.abs(q) * (Number(m.cost_per_unit) || 0);
    s.doneValue += q >= 0 ? v : -v;
  }

  // Additions first, then take-backs of freed sacks, then draws (prepaid, gl,
  // by-weight) — a draw that cannot be met waits for stock; a take-back of
  // sacks already gone is ledgered.
  const order = (s) => {
    const d = s.target - s.done;
    if (d > 0) return 0;
    if (s.family === 'freed') return 1;
    return { prepaid: 2, gl: 3, zero: 4 }[s.cls] || 5;
  };
  const slots = [...keys.values()].filter((s) => Math.abs(s.target - s.done) > EPS).sort((a, b) => order(a) - order(b));

  const shortages = [];
  const ledgered = [];
  const stranded = []; // value an unvalued move left behind when it emptied an item
  let glValue = 0; // value that left the store on 'gl' lines this run (+ out)
  for (const s of slots) {
    const delta = r4(s.target - s.done);
    const reason = s.reason || `Katta re-reconciled (${referenceType} ${referenceId})`;
    const movement = {
      movement_type: FAMILY_TYPE[s.family], reference_type: referenceType, reference_id: referenceId,
      reason, performed_by: userId || null, valuation: s.cls,
    };
    const valuation = s.cls === 'zero' ? 'zero' : delta > 0 ? 'cost' : 'avg';
    // A return of valued sacks comes back at the value they left at.
    const unitCost = s.cls !== 'zero' && delta > 0 && Math.abs(s.done) > EPS ? Math.abs(s.doneValue / s.done) : null;
    const res = await moveStock(trx, {
      itemId: s.itemId, warehouseId: s.warehouseId, qty: delta, valuation, unitCost, clamp: true, movement,
    });
    if (s.cls === 'gl') glValue = r2(glValue - res.value);
    if (res.stranded > 0) stranded.push({ name: res.item && res.item.name, value: res.stranded });
    if (res.short > 0) {
      const name = res.item && res.item.name;
      if (s.family === 'freed') {
        // Freed sacks already sold / packed: record the take-back in full and
        // the store's shortfall against it — no stock moves, no value.
        await trx('mill_stock_movements').insert([
          { item_id: s.itemId, warehouse_id: s.warehouseId, quantity: -res.short, cost_per_unit: 0, total_cost: 0, ...movement, reason: `${reason} — ${res.short} no longer in store` },
          {
            item_id: s.itemId, warehouse_id: s.warehouseId, movement_type: 'adjustment', quantity: res.short,
            cost_per_unit: 0, total_cost: 0, valuation: 'zero',
            reference_type: `${referenceType}_shortfall`, reference_id: referenceId,
            reason: shortfallReason || `${res.short} freed katta (${name}) were already used or sold before ${referenceType} ${referenceId} was re-reconciled`,
            performed_by: userId || null,
          },
        ]);
        ledgered.push({ item: name, itemId: s.itemId, short: res.short });
      } else {
        const it = (res.item || s.item || {});
        shortages.push({ size: Number(it.capacity_kg) || 0, item: name, needed: -delta, available: -res.moved, short: res.short });
      }
    }
  }

  // An unvalued move that emptied an item took the last of its value with it
  // (the sacks are gone): written off like a stock-count loss, DR 6000 / CR
  // 1250, so 1250 does not keep value the store no longer holds.
  const strandedValue = r2(stranded.reduce((t, x) => t + x.value, 0));
  if (strandedValue >= 0.01) {
    await postStoreJournal(trx, {
      amount: strandedValue,
      refType: 'Mill Store Adjustment',
      refNo: `${referenceType}-${referenceId}`.slice(0, 50),
      description: `Remaining value of ${stranded.map((x) => x.name).join(', ')} written off — the last units left with ${referenceType} ${referenceId}`,
      userId,
      what: 'The katta reconcile',
    });
  }

  // The 1250 side of what the 'gl' lines moved, and the batch's own cost line
  // for that katta (MIL-23: one owner per line).
  let costDelta = 0;
  if (batch) {
    const refNo = batch.batch_no || `BATCH-${batch.id}`;
    if (Math.abs(glValue) >= 0.01) {
      await postStoreJournal(trx, {
        amount: glValue,
        refType: 'Mill Packing',
        refNo,
        description: `Katta ${glValue > 0 ? 'drawn' : 'returned'} at yield for the packing runs of batch ${refNo} — Rs ${Math.round(Math.abs(glValue)).toLocaleString('en-PK')}`,
        userId,
        what: 'The katta reconcile',
      });
    }
    const glRows = await trx('mill_stock_movements')
      .where({ reference_type: referenceType, reference_id: referenceId, valuation: 'gl' })
      .select('quantity', 'total_cost');
    const total = r2(glRows.reduce((t, m) => t + (Number(m.quantity) < 0 ? 1 : -1) * (Number(m.total_cost) || 0), 0));
    const row = await trx('milling_costs')
      .where({ batch_id: batch.id, source: 'katta_reconcile', source_id: batch.id }).first();
    const before = row ? r2(row.amount) : 0;
    costDelta = r2(total - before);
    if (Math.abs(costDelta) >= 0.01) {
      if (total > 0 && row) {
        await trx('milling_costs').where({ id: row.id }).update({ amount: total, updated_at: trx.fn.now() });
      } else if (total > 0) {
        await trx('milling_costs').insert({
          batch_id: batch.id, category: 'packaging', amount: total, currency: 'PKR',
          notes: `Katta drawn at yield for packing runs (batch ${refNo})`,
          source: 'katta_reconcile', source_id: batch.id, created_by: userId || null,
        });
      } else if (row) {
        await trx('milling_costs').where({ id: row.id }).del();
      }
      await postProcessingDelta(trx, accountingService, {
        batch, delta: costDelta, label: 'packaging (katta at yield)', userId,
      });
    }
  }

  return { shortages, ledgered, glValue, costDelta, strandedValue };
}

module.exports = { applyKattaPlan };
