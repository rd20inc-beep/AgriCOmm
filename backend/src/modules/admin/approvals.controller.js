/**
 * Master-data approval workflow.
 *
 * Quick-add: lets non-admin operators register a new supplier / product
 * on the fly from the Purchase Lot drawer. The record is created
 * immediately so the lot can save, but flagged 'pending' until an
 * admin reviews it.
 *
 * Approve / reject: admins with `master_data.approve` (Super Admin and
 * Owner by default, see migration 127) act on pending submissions.
 */

const db = require('../../config/database');

const ALLOWED_TABLES = {
  products: { table: 'products', label: 'product' },
  suppliers: { table: 'suppliers', label: 'supplier' },
  customers: { table: 'customers', label: 'customer' },
};

// Does the caller's role have permission to bypass approval?
async function callerCanAutoApprove(req) {
  if (!req.user) return false;
  // Super Admin / Owner bypass everything (same convention as rbac.js)
  const role = await db('roles').where({ id: req.user.role_id }).first('name');
  if (role && (role.name === 'Super Admin' || role.name === 'Owner')) return true;
  // Otherwise check the explicit permission
  const has = await db('role_permissions as rp')
    .join('permissions as p', 'rp.permission_id', 'p.id')
    .where('rp.role_id', req.user.role_id)
    .andWhere({ 'p.module': 'master_data', 'p.action': 'approve' })
    .first();
  return !!has;
}

const approvalsController = {
  // ─────────────── Quick-add: supplier ───────────────
  async quickAddSupplier(req, res) {
    try {
      const { name, contact_person, phone, email, address, country, type } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Supplier name is required.' });
      }
      // Dedupe — case-insensitive name match returns the existing row
      // instead of creating a duplicate.
      const existing = await db('suppliers')
        .whereRaw('LOWER(name) = LOWER(?)', [String(name).trim()])
        .first();
      if (existing) {
        return res.status(200).json({
          success: true,
          data: { supplier: existing, deduped: true },
        });
      }
      const autoApprove = await callerCanAutoApprove(req);
      const now = db.fn.now();
      const payload = {
        name: String(name).trim(),
        contact_person: contact_person || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        country: country || null,
        type: type || 'Rice Supplier',
        is_active: true,
        approval_status: autoApprove ? 'approved' : 'pending',
        submitted_by: req.user?.id || null,
        submitted_at: now,
        reviewed_by: autoApprove ? (req.user?.id || null) : null,
        reviewed_at: autoApprove ? now : null,
      };
      const [supplier] = await db('suppliers').insert(payload).returning('*');
      return res.status(201).json({ success: true, data: { supplier } });
    } catch (err) {
      console.error('quickAddSupplier error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────── Quick-add: customer ───────────────
  async quickAddCustomer(req, res) {
    try {
      const { name, contact_person, phone, email, address, country, port } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Customer name is required.' });
      }
      // Dedupe by case-insensitive name so repeat walk-ins don't pile up.
      const existing = await db('customers')
        .whereRaw('LOWER(name) = LOWER(?)', [String(name).trim()])
        .first();
      if (existing) {
        return res.status(200).json({ success: true, data: { customer: existing, deduped: true } });
      }
      const autoApprove = await callerCanAutoApprove(req);
      const now = db.fn.now();
      const [customer] = await db('customers').insert({
        name: String(name).trim(),
        contact_person: contact_person || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        country: country || null,
        port: port || null,
        customer_type: 'local', // quick-add is the local-sales registration path
        payment_terms: 'Cash',
        currency: 'PKR',
        is_active: true,
        approval_status: autoApprove ? 'approved' : 'pending',
        submitted_by: req.user?.id || null,
        submitted_at: now,
        reviewed_by: autoApprove ? (req.user?.id || null) : null,
        reviewed_at: autoApprove ? now : null,
      }).returning('*');
      return res.status(201).json({ success: true, data: { customer } });
    } catch (err) {
      console.error('quickAddCustomer error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────── Edit an existing customer (apply + flag for review) ───────────────
  // An order-taker can edit a customer inline; the change applies immediately
  // but the customer is flagged 'pending' so an admin reviews it (auto-approved
  // when the caller already has approval rights).
  async submitCustomerEdit(req, res) {
    try {
      const { id } = req.params;
      const cust = await db('customers').where({ id }).first();
      if (!cust) return res.status(404).json({ success: false, message: 'Customer not found.' });
      const { name, contact_person, phone, email, address, country, port } = req.body || {};
      if (name != null && !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Customer name cannot be empty.' });
      }
      const autoApprove = await callerCanAutoApprove(req);
      const now = db.fn.now();
      const [customer] = await db('customers').where({ id }).update({
        name: name != null ? String(name).trim() : cust.name,
        contact_person: contact_person !== undefined ? (contact_person || null) : cust.contact_person,
        phone: phone !== undefined ? (phone || null) : cust.phone,
        email: email !== undefined ? (email || null) : cust.email,
        address: address !== undefined ? (address || null) : cust.address,
        country: country !== undefined ? (country || null) : cust.country,
        port: port !== undefined ? (port || null) : cust.port,
        approval_status: autoApprove ? 'approved' : 'pending',
        submitted_by: req.user?.id || null,
        submitted_at: now,
        reviewed_by: autoApprove ? (req.user?.id || null) : null,
        reviewed_at: autoApprove ? now : null,
        updated_at: now,
      }).returning('*');
      return res.json({ success: true, data: { customer, pending: !autoApprove } });
    } catch (err) {
      console.error('submitCustomerEdit error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────── Quick-add: product (rice type) ───────────────
  async quickAddProduct(req, res) {
    try {
      const { name, code, grade, category, description } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Product name is required.' });
      }
      const existing = await db('products')
        .whereRaw('LOWER(name) = LOWER(?)', [String(name).trim()])
        .orWhere(function () {
          if (code) this.whereRaw('LOWER(code) = LOWER(?)', [String(code).trim()]);
        })
        .first();
      if (existing) {
        return res.status(200).json({
          success: true,
          data: { product: existing, deduped: true },
        });
      }
      const autoApprove = await callerCanAutoApprove(req);
      const now = db.fn.now();
      const payload = {
        name: String(name).trim(),
        code: code ? String(code).trim() : null,
        grade: grade || null,
        category: category || 'Rice',
        description: description || null,
        is_byproduct: false,
        is_active: true,
        approval_status: autoApprove ? 'approved' : 'pending',
        submitted_by: req.user?.id || null,
        submitted_at: now,
        reviewed_by: autoApprove ? (req.user?.id || null) : null,
        reviewed_at: autoApprove ? now : null,
      };
      const [product] = await db('products').insert(payload).returning('*');
      return res.status(201).json({ success: true, data: { product } });
    } catch (err) {
      console.error('quickAddProduct error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────── Approvals: list ───────────────
  async listApprovals(req, res) {
    try {
      const { status = 'pending' } = req.query;
      const validStatuses = ['pending', 'approved', 'rejected', 'all'];
      const where = validStatuses.includes(status) && status !== 'all'
        ? { approval_status: status }
        : null;

      const buildQuery = (tableName) => {
        let q = db(tableName)
          .leftJoin('users as sub', `${tableName}.submitted_by`, 'sub.id')
          .leftJoin('users as rev', `${tableName}.reviewed_by`, 'rev.id')
          .select(
            `${tableName}.*`,
            'sub.full_name as submitted_by_name',
            'rev.full_name as reviewed_by_name'
          )
          .orderBy(`${tableName}.submitted_at`, 'desc');
        if (where) q = q.where(where);
        return q.limit(500);
      };

      const [products, suppliers, customers] = await Promise.all([
        buildQuery('products'),
        buildQuery('suppliers'),
        buildQuery('customers'),
      ]);

      return res.json({
        success: true,
        data: {
          products,
          suppliers,
          customers,
          summary: {
            products: products.length,
            suppliers: suppliers.length,
            customers: customers.length,
            total: products.length + suppliers.length + customers.length,
          },
        },
      });
    } catch (err) {
      console.error('listApprovals error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────── Approvals: count (for top-bar badge) ───────────────
  async approvalsCount(req, res) {
    try {
      const [p, s, c] = await Promise.all([
        db('products').where({ approval_status: 'pending' }).count('id as c').first(),
        db('suppliers').where({ approval_status: 'pending' }).count('id as c').first(),
        db('customers').where({ approval_status: 'pending' }).count('id as c').first(),
      ]);
      const products = parseInt(p?.c) || 0;
      const suppliers = parseInt(s?.c) || 0;
      const customers = parseInt(c?.c) || 0;
      return res.json({
        success: true,
        data: { products, suppliers, customers, total: products + suppliers + customers },
      });
    } catch (err) {
      console.error('approvalsCount error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────── Approve / Reject ───────────────
  async approve(req, res) { return decide(req, res, 'approved'); },
  async reject(req, res)  { return decide(req, res, 'rejected'); },
};

async function decide(req, res, status) {
  try {
    const { type, id } = req.params;
    const t = ALLOWED_TABLES[type];
    if (!t) {
      return res.status(400).json({ success: false, message: `Unknown approval type "${type}".` });
    }
    const row = await db(t.table).where({ id }).first();
    if (!row) {
      return res.status(404).json({ success: false, message: `${t.label} not found.` });
    }
    if (row.approval_status === status) {
      return res.status(200).json({ success: true, data: { [t.label]: row }, message: `Already ${status}.` });
    }
    const updates = {
      approval_status: status,
      reviewed_by: req.user?.id || null,
      reviewed_at: db.fn.now(),
      review_notes: req.body?.notes ? String(req.body.notes).slice(0, 2000) : row.review_notes,
      updated_at: db.fn.now(),
    };
    // Rejected master-data should not be picked up by dropdowns.
    if (status === 'rejected') updates.is_active = false;
    const [updated] = await db(t.table).where({ id }).update(updates).returning('*');
    return res.json({ success: true, data: { [t.label]: updated } });
  } catch (err) {
    console.error('approval decide error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = approvalsController;
