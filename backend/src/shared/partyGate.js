/**
 * Master-data review is a real gate on money (P2-32 / INV-18).
 *
 * A supplier an approver REJECTED (or that is inactive) cannot be bought from:
 * a purchase would raise a payable and GL to a party the business turned down.
 * A PENDING supplier stays usable — quick-adds go live at once and walk-in
 * vendors auto-register as pending (owner decision 2026-10-06, fewer
 * approvals); the approver reviews them after the fact.
 *
 * Returns null when the supplier is usable, else a { status, code, message }
 * refusal the caller turns into its own error shape.
 */
async function supplierRefusal(q, supplierId) {
  if (supplierId == null || supplierId === '') return null;
  const s = await q('suppliers').where({ id: supplierId }).first();
  if (!s) return null; // an unknown id is the caller's existing validation / FK to report
  if (s.approval_status === 'rejected') {
    return { status: 409, code: 'SUPPLIER_REJECTED', message: `Supplier "${s.name}" was rejected in master-data review — purchases from it are blocked. Ask an approver to review it again.` };
  }
  if (s.is_active === false) {
    return { status: 409, code: 'SUPPLIER_INACTIVE', message: `Supplier "${s.name}" is inactive — purchases from it are blocked.` };
  }
  return null;
}

module.exports = { supplierRefusal };
