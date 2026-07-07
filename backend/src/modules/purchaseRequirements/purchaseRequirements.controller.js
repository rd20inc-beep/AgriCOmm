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
      const [row] = await db('purchase_requirements').where('id', pr.id).update({
        status: 'approved', approved_by: req.user?.id || null, approved_at: db.fn.now(), updated_at: db.fn.now(),
      }).returning('*');
      // Masked message — item, qty, est amount, PR no only. No customer/order/rice.
      const amt = row.est_amount != null ? ` (est ${row.currency} ${Math.round(row.est_amount).toLocaleString()})` : '';
      await notificationService.createForRole(null, {
        roleName: 'Finance Manager',
        title: 'Purchase request approved',
        message: `${row.pr_no}: ${Math.round(row.shortage_qty)} ${row.unit} ${row.item_name}${amt} — pending purchase/payment.`,
        type: 'payment', linkedRef: row.pr_no,
      });
      return res.json({ success: true, data: { requirement: row } });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
  },

  async reject(req, res) {
    try {
      const pr = await db('purchase_requirements').where('id', req.params.id).first();
      if (!pr) return res.status(404).json({ success: false, message: 'Purchase requirement not found.' });
      if (pr.status !== 'pending') return res.status(409).json({ success: false, message: `Already ${pr.status}.` });
      const [row] = await db('purchase_requirements').where('id', pr.id).update({
        status: 'rejected', notes: req.body.reason || pr.notes, approved_by: req.user?.id || null, approved_at: db.fn.now(), updated_at: db.fn.now(),
      }).returning('*');
      return res.json({ success: true, data: { requirement: row } });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
  },

  // Finance/store marks an approved PR as purchased (material bought).
  async markPurchased(req, res) {
    try {
      const pr = await db('purchase_requirements').where('id', req.params.id).first();
      if (!pr) return res.status(404).json({ success: false, message: 'Purchase requirement not found.' });
      if (!['approved', 'pending'].includes(pr.status)) return res.status(409).json({ success: false, message: `Cannot mark ${pr.status} as purchased.` });
      const [row] = await db('purchase_requirements').where('id', pr.id).update({ status: 'purchased', updated_at: db.fn.now() }).returning('*');
      return res.json({ success: true, data: { requirement: row } });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
  },
};
