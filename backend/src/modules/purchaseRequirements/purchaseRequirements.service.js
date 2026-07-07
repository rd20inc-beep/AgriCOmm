const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');

// Fields Finance is allowed to see — a masked purchase/payment request only.
// NEVER expose linked_ref / reason / department / raised_by / available_qty to
// Finance (those carry customer/order/rice/stock context).
const FINANCE_FIELDS = ['id', 'pr_no', 'item_name', 'unit', 'shortage_qty', 'est_unit_cost', 'est_amount', 'currency', 'status', 'approved_at', 'created_at'];

function maskForFinance(row) {
  const out = {};
  for (const f of FINANCE_FIELDS) out[f] = row[f];
  return out;
}

// Create (or top-up) a purchase requirement. De-dupes an open (pending/approved)
// PR for the same item + linked_ref so a repeated shortage doesn't spam requests.
async function raise(conn, { itemId = null, itemName, unit = 'pcs', qtyNeeded = 0, availableQty = 0, shortageQty, estUnitCost = null, department = 'Packing', linkedRef = null, reason = null, raisedBy = null }) {
  const trx = conn || db;
  const short = parseFloat(shortageQty);
  if (!(short > 0)) return null;
  const existing = await trx('purchase_requirements')
    .whereIn('status', ['pending', 'approved'])
    .where({ item_name: itemName, linked_ref: linkedRef || null })
    .first();
  if (existing) {
    // Keep the larger outstanding shortage; don't duplicate the request.
    if (short > parseFloat(existing.shortage_qty)) {
      const estAmount = estUnitCost != null ? Math.round(short * parseFloat(estUnitCost) * 100) / 100 : existing.est_amount;
      await trx('purchase_requirements').where('id', existing.id).update({
        qty_needed: qtyNeeded, available_qty: availableQty, shortage_qty: short, est_amount: estAmount, updated_at: trx.fn.now(),
      });
    }
    return existing;
  }
  const prNo = await nextDocNo(trx, { table: 'purchase_requirements', column: 'pr_no', prefix: 'PR-', pad: 4 });
  const estAmount = estUnitCost != null ? Math.round(short * parseFloat(estUnitCost) * 100) / 100 : null;
  const [row] = await trx('purchase_requirements').insert({
    pr_no: prNo, item_id: itemId, item_name: itemName, unit, qty_needed: qtyNeeded, available_qty: availableQty,
    shortage_qty: short, est_unit_cost: estUnitCost, est_amount: estAmount, department,
    linked_ref: linkedRef || null, reason: reason || null, status: 'pending', raised_by: raisedBy,
  }).returning('*');
  return row;
}

module.exports = { raise, maskForFinance, FINANCE_FIELDS };
