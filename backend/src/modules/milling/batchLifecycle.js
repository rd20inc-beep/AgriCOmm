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
 * Re-yield is keyed on the outputs existing, not on the status — the status
 * can drift (legacy rows, manual edits); duplicate outputs and journals cannot.
 */
function yieldMode({ status, hasOutputs }) {
  if (!YIELDABLE_STATUSES.includes(status)) return 'refuse';
  return hasOutputs ? 'reyield' : 'first';
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

/**
 * Release the milling holds a batch placed on its source lots (P6a): drop the
 * batch's committed qty from milling_reserved_qty, give it back to
 * available_qty, and clear the 'In Milling' flag once nothing else holds the
 * lot. Used when a batch is deleted, cancelled or rejected — in every case
 * before yield, so nothing was drawn down. Only lots still 'In Milling' are
 * touched (a consumed lot has nothing held). Returns the lot ids released.
 */
async function releaseBatchSources(trx, batchId) {
  const released = [];
  const sources = await trx('batch_source_lots').where({ batch_id: batchId });
  for (const s of sources) {
    const lot = await trx('inventory_lots').where({ id: s.lot_id }).forUpdate().first();
    if (!lot || lot.milling_status !== 'In Milling') continue;
    const heldQty = parseFloat(s.qty_kg) || 0;
    const heldAfter = Math.max(0, (parseFloat(lot.milling_reserved_qty) || 0) - heldQty);
    await trx('inventory_lots').where({ id: s.lot_id }).update({
      milling_status: heldAfter > 1e-6 ? 'In Milling' : null,
      status: 'Available',
      milling_reserved_qty: heldAfter,
      available_qty: Math.max(0, (parseFloat(lot.qty) || 0) - (parseFloat(lot.reserved_qty) || 0) - heldAfter),
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
  releaseBatchSources,
};
