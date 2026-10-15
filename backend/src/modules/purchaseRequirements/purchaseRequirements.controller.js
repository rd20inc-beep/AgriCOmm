const db = require('../../config/database');
const notificationService = require('../../services/notificationService');
const prService = require('./purchaseRequirements.service');

async function callerRole(req) {
  if (req.user?._roleName) return req.user._roleName;
  if (req.user?.role_id) { const r = await db('roles').where({ id: req.user.role_id }).first('name'); return r?.name; }
  return null;
}

module.exports = {
  // Manually raise a purchase requirement (mill/store side).
  async create(req, res) {
    try {
      const { item_id, item_name, unit, qty_needed, available_qty, shortage_qty, est_unit_cost, department, linked_ref, reason } = req.body;
      if (!item_name && !item_id) return res.status(400).json({ success: false, message: 'item_name (or item_id) is required.' });
      let name = item_name, u = unit, cost = est_unit_cost;
      if (item_id) {
        const it = await db('mill_items').where('id', item_id).first();
        if (it) { name = name || it.name; u = u || it.unit; if (cost == null) cost = it.avg_cost_per_unit || null; }
      }
      const shortage = shortage_qty != null ? shortage_qty : Math.max(0, (parseFloat(qty_needed) || 0) - (parseFloat(available_qty) || 0));
      const row = await prService.raise(db, {
        itemId: item_id || null, itemName: name, unit: u || 'pcs',
        qtyNeeded: parseFloat(qty_needed) || 0, availableQty: parseFloat(available_qty) || 0, shortageQty: shortage,
        estUnitCost: cost != null ? parseFloat(cost) : null, department: department || 'Packing',
        linkedRef: linked_ref || null, reason: reason || null, raisedBy: req.user?.id || null,
      });
      if (!row) return res.status(400).json({ success: false, message: 'A positive shortage quantity is required.' });
      return res.status(201).json({ success: true, data: { requirement: row } });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
  },

  // Role-masked list. Finance Manager sees a masked purchase/payment request only.
  async list(req, res) {
    try {
      const role = await callerRole(req);
      const financeMasked = role === 'Finance Manager';
      let q = db('purchase_requirements').orderBy('created_at', 'desc');
      if (req.query.status && req.query.status !== 'all') q = q.where('status', req.query.status);
      // Finance only needs things it can act on (approved → pay; purchased).
      if (financeMasked && !req.query.status) q = q.whereIn('status', ['approved', 'purchased']);
      const rows = await q;
      const data = financeMasked ? rows.map(prService.maskForFinance) : rows;
      return res.json({ success: true, data: { requirements: data, masked: financeMasked } });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
  },

  async count(req, res) {
    try {
      const r = await db('purchase_requirements').where('status', 'pending').count('id as c').first();
      return res.json({ success: true, data: { pending: parseInt(r?.c, 10) || 0 } });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
  },

  // Mill Manager / Owner approves → Finance is notified with a MASKED request.
  async approve(req, res) {
    try {
      const pr = await db('purchase_requirements').where('id', req.params.id).first();
      if (!pr) return res.status(404).json({ success: false, message: 'Purchase requirement not found.' });
      if (pr.status !== 'pending') return res.status(409).json({ success: false, message: `Already ${pr.status}.` });
      // Guarded on 'pending': an approve racing a reject, a cancel or an order
      // sync must not resurrect a request that changed meanwhile.
      const [row] = await db('purchase_requirements').where({ id: pr.id, status: 'pending' }).update({
        status: 'approved', approved_by: req.user?.id || null, approved_at: db.fn.now(), updated_at: db.fn.now(),
      }).returning('*');
      if (!row) return res.status(409).json({ success: false, message: 'This requirement changed meanwhile — refresh and try again.' });
      // Masked message — item, qty, est amount, PR no only. No customer/order/rice.
      const amt = row.est_amount != null ? ` (est ${row.currency} ${Math.round(row.est_amount).toLocaleString()})` : '';
      await notificationService.notifyFinance(null, {
        title: 'Purchase request approved',
        message: `${row.pr_no}: ${Math.round(row.shortage_qty)} ${row.unit} ${row.item_name}${amt} — pending purchase/payment.`,
        linkedRef: row.pr_no,
      });
      return res.json({ success: true, data: { requirement: row } });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
  },

  async reject(req, res) {
    try {
      const pr = await db('purchase_requirements').where('id', req.params.id).first();
      if (!pr) return res.status(404).json({ success: false, message: 'Purchase requirement not found.' });
      if (pr.status !== 'pending') return res.status(409).json({ success: false, message: `Already ${pr.status}.` });
      const [row] = await db('purchase_requirements').where({ id: pr.id, status: 'pending' }).update({
        status: 'rejected', notes: req.body.reason || pr.notes, approved_by: req.user?.id || null, approved_at: db.fn.now(), updated_at: db.fn.now(),
      }).returning('*');
      if (!row) return res.status(409).json({ success: false, message: 'This requirement changed meanwhile — refresh and try again.' });
      return res.json({ success: true, data: { requirement: row } });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
  },

  // Finance/store marks an APPROVED PR as purchased (material bought). A pending
  // requirement has not been signed off by the Mill Manager / Owner yet, so it
  // cannot skip straight to purchased.
  async markPurchased(req, res) {
    try {
      const pr = await db('purchase_requirements').where('id', req.params.id).first();
      if (!pr) return res.status(404).json({ success: false, message: 'Purchase requirement not found.' });
      if (pr.status !== 'approved') {
        const why = pr.status === 'pending' ? ' — it has to be approved first' : '';
        return res.status(409).json({ success: false, message: `Cannot mark a ${pr.status} requirement as purchased${why}.` });
      }
      const [row] = await db('purchase_requirements').where({ id: pr.id, status: 'approved' }).update({ status: 'purchased', review_required: false, updated_at: db.fn.now() }).returning('*');
      if (!row) return res.status(409).json({ success: false, message: 'This requirement changed meanwhile — refresh and try again.' });
      return res.json({ success: true, data: { requirement: row } });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
  },

  // Cancel an open (pending or approved) requirement — the material is no
  // longer needed, e.g. one flagged for review after its order shrank. The
  // reason is required (schemas.cancelPurchaseRequirement). Finance is told
  // when an approved one, which it may be about to buy, is cancelled.
  async cancelRequirement(req, res) {
    try {
      const reason = String(req.body.reason || '').trim();
      const row = await db.transaction(async (trx) => {
        const pr = await trx('purchase_requirements').where('id', req.params.id).forUpdate().first();
        if (!pr) { const e = new Error('Purchase requirement not found.'); e.statusCode = 404; throw e; }
        if (!prService.OPEN_STATUSES.includes(pr.status)) {
          const e = new Error(`Cannot cancel a ${pr.status} requirement.`); e.statusCode = 409; throw e;
        }
        const [updated] = await trx('purchase_requirements').where('id', pr.id).update({
          status: 'cancelled', cancelled_at: trx.fn.now(), cancelled_by: req.user?.id || null, review_required: false,
          notes: pr.notes ? `${pr.notes}\nCancelled: ${reason}` : `Cancelled: ${reason}`,
          updated_at: trx.fn.now(),
        }).returning('*');
        if (pr.status === 'approved') {
          await notificationService.notifyFinance(trx, {
            title: 'Purchase request cancelled',
            message: `${pr.pr_no}: ${pr.item_name} — cancelled, do not purchase.`,
            linkedRef: pr.pr_no,
          });
        }
        return updated;
      });
      return res.json({ success: true, data: { requirement: row } });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};
