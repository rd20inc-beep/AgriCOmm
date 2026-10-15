// When a price / cost edit is still allowed (P2-08: INV-08, MIL-03, MIL-07,
// MIL-38). Register choice — the CONSERVATIVE one: once rice has been milled
// (yield recorded) or sold, its purchase price and the batch's raw cost are
// REFUSED rather than re-posted downstream. Re-posting would mean moving value
// through 1210 → 1220 / 1240 → COGS and re-opening sold figures, an accounting
// policy nobody has decided. Before that point an edit is allowed and posts its
// own signed delta (the lot / cost-sheet handlers already do).
//
// Each assert throws an Error with status 409 and a message that names the
// blocking batch / lot, so the business user knows what to do instead.

// Ledger movements that take rice OUT of a lot (lot_transactions types): once
// any of them exists, value has left the lot at the old cost.
const OUTBOUND_TXN_TYPES = [
  'milling_issue', 'local_sale_out', 'export_dispatch_out', 'warehouse_transfer_out',
  'damage_out', 'shortage_out', 'stock_adjustment_minus',
];

function conflict(message) {
  const e = new Error(message);
  e.status = 409; e.statusCode = 409;
  return e;
}

/** A batch has its yield on the books: output lots exist or its completion journal is Posted. */
async function batchYielded(q, batch) {
  if (!batch) return false;
  const out = await q('inventory_lots')
    .where({ batch_ref: `batch-${batch.id}` }).whereIn('type', ['finished', 'byproduct']).first('id');
  if (out) return true;
  const posted = await q('journal_entries')
    .where({ ref_type: 'Milling Batch', ref_no: batch.batch_no, status: 'Posted' }).first('id');
  return !!posted;
}

/** First output lot of the batch that has been sold / dispatched / re-milled / moved, or null. */
async function consumedOutputLot(q, batchId) {
  const outs = await q('inventory_lots')
    .where({ batch_ref: `batch-${batchId}` }).whereIn('type', ['finished', 'byproduct'])
    .select('id', 'lot_no', 'sold_weight_kg');
  if (!outs.length) return null;
  const sold = outs.find((l) => (parseFloat(l.sold_weight_kg) || 0) > 0.001);
  if (sold) return sold;
  const moved = await q('lot_transactions')
    .whereIn('lot_id', outs.map((l) => l.id)).whereIn('transaction_type', OUTBOUND_TXN_TYPES)
    .first('lot_id');
  return moved ? outs.find((l) => l.id === moved.lot_id) : null;
}

/**
 * A raw lot's price / received qty / landed costs may change only while none of
 * its rice has left it: not milled (yield recorded), sold, dispatched, moved or
 * written off. Committed to a batch that has NOT yielded yet is fine — the batch
 * picks up the new cost at yield.
 */
async function assertLotCostEditable(q, lot) {
  if (!lot) return;
  const sources = await q('batch_source_lots as bsl')
    .join('milling_batches as mb', 'mb.id', 'bsl.batch_id')
    .where('bsl.lot_id', lot.id).select('mb.id', 'mb.batch_no');
  for (const b of sources) {
    if (await batchYielded(q, b)) {
      throw conflict(`Lot ${lot.lot_no} has already been milled in batch ${b.batch_no} (yield recorded), so its price and costs are locked — the finished rice and its costing were built on them. If the supplier's price really changed, ask Finance to record the difference against the supplier.`);
    }
  }
  const out = await q('lot_transactions')
    .where({ lot_id: lot.id }).whereIn('transaction_type', OUTBOUND_TXN_TYPES)
    .first('transaction_type');
  if (out) {
    const what = out.transaction_type === 'milling_issue' ? 'milled'
      : /sale|dispatch/.test(out.transaction_type) ? 'sold' : 'moved out of stock';
    throw conflict(`Rice from lot ${lot.lot_no} has already been ${what}, so its price and costs are locked — that rice left stock at the recorded cost. If the supplier's price really changed, ask Finance to record the difference against the supplier.`);
  }
}

/** The batch's RAW cost (arrival price, raw_rice cost line) is fixed once its yield is recorded. */
async function assertBatchRawCostEditable(q, batch) {
  if (await batchYielded(q, batch)) {
    throw conflict(`Batch ${batch.batch_no} already has its yield recorded, so its raw rice cost is locked — the supplier bill and the finished rice were booked at it. If the supplier's price really changed, ask Finance to record the difference against the supplier.`);
  }
}

/** Processing costs may still change after yield (a signed delta is posted) — until an output is sold or used. */
async function assertBatchOutputsUnsold(q, batch) {
  const lot = await consumedOutputLot(q, batch.id);
  if (lot) {
    throw conflict(`Output lot ${lot.lot_no} of batch ${batch.batch_no} has already been sold or used, so the batch's costs are locked — that rice left stock at the recorded cost.`);
  }
}

module.exports = {
  OUTBOUND_TXN_TYPES,
  batchYielded,
  consumedOutputLot,
  assertLotCostEditable,
  assertBatchRawCostEditable,
  assertBatchOutputsUnsold,
};
