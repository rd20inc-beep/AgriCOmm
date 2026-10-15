const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');
const notificationService = require('../../services/notificationService');

// Fields Finance is allowed to see — a masked purchase/payment request only.
// NEVER expose linked_ref / reason / department / raised_by / available_qty /
// review_note to Finance (those carry customer/order/rice/stock context).
const FINANCE_FIELDS = ['id', 'pr_no', 'item_name', 'unit', 'shortage_qty', 'est_unit_cost', 'est_amount', 'currency', 'status', 'review_required', 'approved_at', 'created_at'];

// A request is OPEN while nothing has been bought against it yet.
const OPEN_STATUSES = ['pending', 'approved'];

const qty = (v) => parseFloat(v) || 0;
const amountFor = (short, unitCost) => (unitCost != null ? Math.round(short * parseFloat(unitCost) * 100) / 100 : null);

function maskForFinance(row) {
  const out = {};
  for (const f of FINANCE_FIELDS) out[f] = row[f];
  return out;
}

// The open requests for one item against one reference (batch / order), locked
// so a concurrent approve, purchase or sync cannot interleave with ours.
async function openRowsFor(trx, itemName, linkedRef) {
  return trx('purchase_requirements')
    .whereIn('status', OPEN_STATUSES)
    .where({ item_name: itemName, linked_ref: linkedRef || null })
    .orderBy('id')
    .forUpdate();
}

async function insertPending(trx, { itemId, itemName, unit, qtyNeeded, availableQty, shortageQty, estUnitCost, department, linkedRef, reason, raisedBy }) {
  const prNo = await nextDocNo(trx, { table: 'purchase_requirements', column: 'pr_no', prefix: 'PR-', pad: 4 });
  const [row] = await trx('purchase_requirements').insert({
    pr_no: prNo, item_id: itemId, item_name: itemName, unit, qty_needed: qtyNeeded, available_qty: availableQty,
    shortage_qty: shortageQty, est_unit_cost: estUnitCost, est_amount: amountFor(shortageQty, estUnitCost), department,
    linked_ref: linkedRef || null, reason: reason || null, status: 'pending', raised_by: raisedBy,
  }).returning('*');
  return row;
}

// Runs `fn` in the caller's transaction, or in a new one when given the pool.
const inTrx = (conn, fn) => (conn && conn.isTransaction ? fn(conn) : (conn || db).transaction(fn));

// Make sure at least `shortageQty` is requested for an item + linked_ref. Never
// shrinks a request (a later, smaller shortage report is not a reason to buy
// less — use syncForRef for that) and never changes an APPROVED request: the
// approver signed off on its quantity, so a shortage that grows past it gets a
// new pending top-up for the difference, which needs its own approval.
async function raise(conn, { itemId = null, itemName, unit = 'pcs', qtyNeeded = 0, availableQty = 0, shortageQty, estUnitCost = null, department = 'Packing', linkedRef = null, reason = null, raisedBy = null }) {
  const short = parseFloat(shortageQty);
  if (!(short > 0)) return null;
  return inTrx(conn, async (trx) => {
    const open = await openRowsFor(trx, itemName, linkedRef);
    const approvedQty = open.filter((r) => r.status === 'approved').reduce((s, r) => s + qty(r.shortage_qty), 0);
    const pending = open.find((r) => r.status === 'pending');
    const need = Math.round((short - approvedQty) * 1000) / 1000;
    if (!(need > 0)) return pending || open[0];
    if (pending) {
      if (need > qty(pending.shortage_qty)) {
        const cost = estUnitCost != null ? estUnitCost : pending.est_unit_cost;
        await trx('purchase_requirements').where('id', pending.id).update({
          qty_needed: qtyNeeded, available_qty: availableQty, shortage_qty: need,
          est_amount: amountFor(need, cost), updated_at: trx.fn.now(),
        });
      }
      return pending;
    }
    return insertPending(trx, {
      itemId, itemName, unit, qtyNeeded, availableQty, shortageQty: need, estUnitCost, department, linkedRef,
      reason: approvedQty > 0 ? `${reason || 'Shortage'} — top-up over the approved request` : reason,
      raisedBy,
    });
  });
}

// Bring the open requests for ONE item + linked_ref to exactly `shortageQty`
// (0 = no longer needed). Pending requests follow the need up and down and are
// cancelled when it is gone. Approved ones are never changed here: if the need
// fell below what was approved, they are flagged for review and Finance is told
// to hold the purchase — a person decides (cancel, or buy anyway).
async function setNeed(trx, { itemId = null, itemName, unit = 'pcs', qtyNeeded = 0, availableQty = 0, shortageQty = 0, estUnitCost = null, department = 'Packing', linkedRef, reason = null, userId = null, why }) {
  const out = { raised: [], reduced: [], cancelled: [], flagged: [] };
  const short = Math.max(0, qty(shortageQty));
  const open = await openRowsFor(trx, itemName, linkedRef);
  const approved = open.filter((r) => r.status === 'approved');
  const approvedQty = approved.reduce((s, r) => s + qty(r.shortage_qty), 0);
  const pending = open.find((r) => r.status === 'pending');
  const need = Math.round((short - approvedQty) * 1000) / 1000;

  if (need > 0) {
    if (pending) {
      if (Math.abs(need - qty(pending.shortage_qty)) > 0.0005) {
        const cost = estUnitCost != null ? estUnitCost : pending.est_unit_cost;
        await trx('purchase_requirements').where('id', pending.id).update({
          qty_needed: qtyNeeded, available_qty: availableQty, shortage_qty: need,
          est_amount: amountFor(need, cost), updated_at: trx.fn.now(),
        });
        if (need < qty(pending.shortage_qty)) out.reduced.push(pending.pr_no); else out.raised.push(pending.pr_no);
      }
    } else {
      const row = await insertPending(trx, {
        itemId, itemName, unit, qtyNeeded, availableQty, shortageQty: need, estUnitCost, department, linkedRef,
        reason: approvedQty > 0 ? `${reason || 'Shortage'} — top-up over the approved request` : reason,
        raisedBy: userId,
      });
      out.raised.push(row.pr_no);
    }
  } else if (pending) {
    await trx('purchase_requirements').where({ id: pending.id, status: 'pending' }).update({
      status: 'cancelled', cancelled_at: trx.fn.now(), cancelled_by: userId,
      notes: trx.raw("COALESCE(notes || E'\\n', '') || ?", [`Cancelled: ${why}`]),
      updated_at: trx.fn.now(),
    });
    out.cancelled.push(pending.pr_no);
  }

  if (approvedQty - short > 0.0005) {
    const note = short > 0
      ? `${why}: now ${short} ${unit} needed against ${approvedQty} approved — review before buying.`
      : `${why}: no longer needed — review before buying.`;
    for (const r of approved) {
      await trx('purchase_requirements').where('id', r.id).update({
        review_required: true, review_note: note, updated_at: trx.fn.now(),
      });
      // Masked for Finance: PR no, item and quantity only.
      await notificationService.notifyFinance(trx, {
        title: 'Purchase request on hold',
        message: `${r.pr_no}: ${r.item_name} — the need has dropped; hold the purchase until it is reviewed.`,
        linkedRef: r.pr_no,
      });
      out.flagged.push(r.pr_no);
    }
  }
  return out;
}

// Sync every open request against `linkedRef` to the current shortage lines
// (export-order material lines). Items no longer short go to zero.
async function syncForRef(conn, linkedRef, lines, { userId = null, reason = null, why = 'Order changed', department = 'Packing' } = {}) {
  return inTrx(conn, async (trx) => {
    const result = { raised: [], reduced: [], cancelled: [], flagged: [] };
    const byItem = new Map();
    for (const l of lines || []) {
      const cur = byItem.get(l.item_name);
      if (cur) { cur.required += qty(l.required); cur.shortage += Math.max(0, qty(l.shortage)); } else {
        byItem.set(l.item_name, { ...l, required: qty(l.required), shortage: Math.max(0, qty(l.shortage)) });
      }
    }
    const openNames = (await trx('purchase_requirements').whereIn('status', OPEN_STATUSES)
      .where({ linked_ref: linkedRef }).distinct('item_name')).map((r) => r.item_name);
    for (const name of openNames) if (!byItem.has(name)) byItem.set(name, { item_name: name, shortage: 0, required: 0 });

    for (const l of byItem.values()) {
      if (!(l.shortage > 0) && !openNames.includes(l.item_name)) continue;
      // eslint-disable-next-line no-await-in-loop
      const r = await setNeed(trx, {
        itemId: l.item_id || null, itemName: l.item_name, unit: l.unit || 'pcs',
        qtyNeeded: l.required, availableQty: qty(l.available), shortageQty: l.shortage,
        estUnitCost: l.est_unit_cost != null ? parseFloat(l.est_unit_cost) : null,
        department, linkedRef, reason, userId, why,
      });
      for (const k of Object.keys(result)) result[k].push(...r[k]);
    }
    return result;
  });
}

// Cancel every open request against `linkedRef` (its export order was
// cancelled — an Owner-approved action, so APPROVED requests are cancelled too,
// the same rule as the order's purchase requisitions). Finance is told about
// the approved ones it may be about to buy. Purchased ones are counted for
// review, never touched.
async function cancelForRef(trx, linkedRef, { userId = null, why }) {
  const rows = await trx('purchase_requirements').where({ linked_ref: linkedRef })
    .whereIn('status', OPEN_STATUSES).forUpdate();
  for (const r of rows) {
    await trx('purchase_requirements').where('id', r.id).update({
      status: 'cancelled', cancelled_at: trx.fn.now(), cancelled_by: userId, review_required: false,
      notes: trx.raw("COALESCE(notes || E'\\n', '') || ?", [`Cancelled: ${why}`]),
      updated_at: trx.fn.now(),
    });
    if (r.status === 'approved') {
      await notificationService.notifyFinance(trx, {
        title: 'Purchase request cancelled',
        message: `${r.pr_no}: ${r.item_name} — cancelled, do not purchase.`,
        linkedRef: r.pr_no,
      });
    }
  }
  const purchased = await trx('purchase_requirements').where({ linked_ref: linkedRef, status: 'purchased' }).count('id as n').first();
  return { cancelled: rows.length, purchased: parseInt(purchased && purchased.n, 10) || 0 };
}

// Raise one request per packing-material shortage (MIL-48: every shortage,
// export batch or not). Each shortage is { item_id?, item, size?, unit,
// needed, available, short }; the store item is resolved by id, else by its
// katta code (size), else by name, for the unit and estimated cost.
async function raiseForShortages(trx, shortages, { linkedRef, reason, raisedBy = null }) {
  const raised = [];
  for (const s of shortages || []) {
    if (!(qty(s.short) > 0)) continue;
    let item = null;
    if (s.item_id) item = await trx('mill_items').where('id', s.item_id).first('id', 'name', 'unit', 'avg_cost_per_unit');
    if (!item && s.size) item = await trx('mill_items').where('code', `KATTA-${s.size}`).first('id', 'name', 'unit', 'avg_cost_per_unit');
    if (!item && s.item) item = await trx('mill_items').where('name', s.item).first('id', 'name', 'unit', 'avg_cost_per_unit');
    const pr = await raise(trx, {
      itemId: item?.id || null, itemName: item?.name || s.item || (s.size ? `Katta ${s.size}kg` : 'Packing material'),
      unit: item?.unit || s.unit || 'pcs',
      qtyNeeded: qty(s.needed), availableQty: qty(s.available), shortageQty: qty(s.short),
      estUnitCost: item?.avg_cost_per_unit != null ? parseFloat(item.avg_cost_per_unit) : null,
      department: 'Packing', linkedRef, reason, raisedBy,
    });
    if (pr) raised.push(pr.pr_no);
  }
  return raised;
}

module.exports = {
  raise, setNeed, syncForRef, cancelForRef, raiseForShortages, maskForFinance, FINANCE_FIELDS, OPEN_STATUSES,
};
