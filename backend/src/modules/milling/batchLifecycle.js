// Milling batch lifecycle rules — status transitions, the yield guard, the
// fields a generic edit may touch, and releasing source-lot holds. Kept apart
// from milling.controller.js so the rules can be exercised directly in tests.

// Statuses (chk_milling_batches_status_valid): Queued, In Progress,
// Pending Approval (legacy — new batches no longer wait for the Owner),
// Completed, Cancelled, Rejected, On Hold.

// Yield may be recorded (or re-recorded) only on a batch that is running or
// done. On Hold / Cancelled / Rejected batches are refused: before this guard a
// yield on a held batch skipped the re-yield branch (it required 'Completed')
// and re-posted the production output and the milling_completion journal.
const YIELDABLE_STATUSES = ['Queued', 'In Progress', 'Pending', 'Pending Approval', 'Completed'];

/**
 * Decide what a yield save does.
 *   'refuse'  — the batch is not in a state that can take a yield
 *   'reyield' — output lots already exist: update quantities + resync the lots
 *   'first'   — no outputs yet: consume raw, create output lots, post journals
 * Re-yield is keyed on facts, not on the status — the status can drift (legacy
 * rows, manual edits); duplicate outputs and journals cannot. The facts are the
 * output lots existing OR the batch's completion journal already being Posted:
 * a batch whose output lots were retired (a re-yield of all zeros) has still
 * consumed its raw and capitalised its cost, so a later save is a re-yield, not
 * a second first-yield (that double-posted M-004's completion on prod).
 */
function yieldMode({ status, hasOutputs, hasCompletion = false }) {
  if (!YIELDABLE_STATUSES.includes(status)) return 'refuse';
  return (hasOutputs || hasCompletion) ? 'reyield' : 'first';
}

// A batch's yield outputs are the finished/by-product lots stamped with
// batch_ref = 'batch-<id>' (the raw lot a truck receipt creates carries the
// same ref, so type filters it out).
async function batchHasOutputLots(q, batchId) {
  const row = await q('inventory_lots')
    .where({ batch_ref: `batch-${batchId}` })
    .whereIn('type', ['finished', 'byproduct'])
    .count('id as c')
    .first();
  return (parseInt(row && row.c, 10) || 0) > 0;
}

// Fields the generic PUT /batches/:id may change. 'status' is deliberately
// absent: status moves only through the routes that check the transition
// (hold / resume / cancel / approve / reject / yield).
const EDITABLE_BATCH_FIELDS = ['supplier_id', 'raw_qty_kg', 'planned_finished_kg', 'milling_fee_per_kg',
  'mill_id', 'machine_line', 'shift', 'notes', 'variance_status', 'batch_name'];

function pickBatchEdits(body) {
  const updates = {};
  for (const key of EDITABLE_BATCH_FIELDS) {
    if (body && body[key] !== undefined) updates[key] = body[key];
  }
  return updates;
}

// Allowed transitions for the explicit status routes.
const TRANSITIONS = {
  hold: { from: ['Queued', 'In Progress'], to: 'On Hold' },
  resume: { from: ['On Hold'], to: 'Queued' },
  cancel: { from: ['Queued', 'In Progress', 'Pending Approval', 'On Hold'], to: 'Cancelled' },
};

/**
 * Check a status transition. Returns null when allowed, otherwise
 * { status: 409, message }.
 */
function checkTransition(action, batch, { hasYield = false } = {}) {
  const t = TRANSITIONS[action];
  if (!t) return { status: 400, message: `Unknown action '${action}'.` };
  if (action === 'cancel' && (hasYield || batch.status === 'Completed')) {
    return {
      status: 409,
      message: `Batch ${batch.batch_no} already has yield recorded and cannot be cancelled. Delete it from the Danger Zone if it must go.`,
    };
  }
  if (!t.from.includes(batch.status)) {
    return { status: 409, message: `Cannot ${action} batch ${batch.batch_no} — it is ${batch.status}.` };
  }
  return null;
}

// A batch_source_lots row whose qty was hard-reserved on the lot when it was
// committed. Every row written by commitLotToBatch carries lot_type, so lot_type
// is the marker. Rows without it come from the lot-first (Start Milling) path
// before it reserved: they hold nothing, so releasing or consuming them must not
// take milling_reserved_qty that belongs to another batch on the same lot.
function isReservedSource(s) {
  return !!(s && s.lot_type);
}

const num = (v) => parseFloat(v) || 0;
const fmtKg = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

/**
 * Commit qtyKg of a lot to a milling batch — the ONE way a source lot joins a
 * batch (the New Batch drawer and Start Milling on a lot both call it). Locks
 * the lot, refuses more than is available, links it in batch_source_lots and
 * hard-reserves the qty (P6a): milling_reserved_qty goes up and available_qty
 * down, so the rice can't be sold or export-allocated before yield. Yield
 * (consumeForMilling) consumes exactly this qty; delete/cancel releases it
 * (releaseBatchSources).
 *
 * `row` carries extra batch_source_lots columns (costs, variety, notes…).
 * Returns { lot, qty } with the lot as read before the update.
 */
async function commitLotToBatch(trx, { batchId, lotId, qtyKg, row = {} }) {
  const lot = await trx('inventory_lots').where({ id: lotId }).forUpdate().first();
  if (!lot) throw httpError(404, `Source lot ${lotId} not found.`);
  const qty = num(qtyKg);
  if (!(qty > 0)) throw httpError(400, 'Quantity to mill must be greater than zero.');
  const held = num(lot.milling_reserved_qty);
  const avail = Math.max(0, num(lot.qty) - num(lot.reserved_qty) - held);
  if (qty > avail + 1e-6) {
    throw httpError(400, `Lot ${lot.lot_no || lot.id}: only ${fmtKg(avail)} kg available, requested ${fmtKg(qty)} kg.`);
  }
  await trx('batch_source_lots').insert({
    batch_id: batchId,
    lot_id: lot.id,
    qty_kg: qty,
    ...row,
    lot_type: row.lot_type || lot.type || 'raw',
  });
  await trx('inventory_lots').where({ id: lot.id }).update({
    milling_status: 'In Milling',
    milling_reserved_qty: held + qty,
    available_qty: Math.max(0, avail - qty),
    updated_at: trx.fn.now(),
  });
  return { lot, qty };
}

/**
 * Release the milling holds a batch placed on its source lots (P6a): drop the
 * batch's committed qty from milling_reserved_qty, give it back to
 * available_qty, and clear the 'In Milling' flag once nothing else holds the
 * lot. Used when a batch is deleted, cancelled or rejected — in every case
 * before yield, so nothing was drawn down. Only lots still 'In Milling' are
 * touched (a consumed lot has nothing held), and only what THIS batch reserved
 * is released (see isReservedSource). Returns the lot ids released.
 */
async function releaseBatchSources(trx, batchId) {
  const released = [];
  const sources = await trx('batch_source_lots').where({ batch_id: batchId });
  for (const s of sources) {
    const lot = await trx('inventory_lots').where({ id: s.lot_id }).forUpdate().first();
    if (!lot || lot.milling_status !== 'In Milling') continue;
    const heldNow = num(lot.milling_reserved_qty);
    const heldQty = isReservedSource(s) ? Math.min(num(s.qty_kg), heldNow) : 0;
    const heldAfter = Math.max(0, heldNow - heldQty);
    await trx('inventory_lots').where({ id: s.lot_id }).update({
      milling_status: heldAfter > 1e-6 ? 'In Milling' : null,
      status: 'Available',
      milling_reserved_qty: heldAfter,
      available_qty: Math.max(0, num(lot.qty) - num(lot.reserved_qty) - heldAfter),
      updated_at: trx.fn.now(),
    });
    released.push(s.lot_id);
  }
  return released;
}

module.exports = {
  YIELDABLE_STATUSES,
  yieldMode,
  batchHasOutputLots,
  EDITABLE_BATCH_FIELDS,
  pickBatchEdits,
  TRANSITIONS,
  checkTransition,
  isReservedSource,
  commitLotToBatch,
  releaseBatchSources,
  httpError,
};
