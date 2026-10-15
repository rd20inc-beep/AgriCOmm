/**
 * Master-data approval workflow.
 *
 * Quick-add: lets operators register a new supplier / product / customer
 * on the fly from the Purchase Lot drawer. The record is created live
 * ('approved') at once — see liveOnCreate. The review queue below still
 * serves older pending rows and customer edits (submitCustomerEdit).
 *
 * Approve / reject: admins with `master_data.approve` (Super Admin and
 * Owner by default, see migration 127) act on pending submissions.
 */

const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');

// The customer fields an edit may change (submitCustomerEdit) — and so the
// only keys a stored proposal may apply.
const CUSTOMER_EDIT_FIELDS = ['name', 'contact_person', 'phone', 'email', 'address', 'country', 'port'];

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

// Quick-adds go LIVE immediately (owner decision 2026-10-06: fewer approvals).
// A new supplier / customer / product is 'approved' the moment it is created —
// it no longer waits in Admin → Approvals. Who created it stays on the row
// (submitted_by / submitted_at) and in the audit log (auditAction 'quick_add'
// on the route). reviewed_by stays NULL: nobody reviewed it, and the record
// says so rather than pretending the creator approved their own entry.
// Rows already sitting 'pending' from before this change are left alone; an
// Owner can still approve or reject them in the queue.
function liveOnCreate(req, now) {
  return {
    approval_status: 'approved',
    submitted_by: req.user?.id || null,
    submitted_at: now,
    reviewed_by: null,
    reviewed_at: null,
  };
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
        // A rejected supplier is not handed back for use (P2-32 / INV-18) —
        // re-adding the same name must not quietly revive it.
        if (existing.approval_status === 'rejected') {
          return res.status(409).json({
            success: false,
            code: 'SUPPLIER_REJECTED',
            message: `Supplier "${existing.name}" was rejected in master-data review. Ask an approver to review it again.`,
          });
        }
        return res.status(200).json({
          success: true,
          data: { supplier: existing, deduped: true },
        });
      }
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
        ...liveOnCreate(req, now),
      };
      const [supplier] = await db.transaction(async (trx) => {
        // Stable privacy code (SUP-001…) shown on export orders instead of the name.
        payload.supplier_code = await nextDocNo(trx, { table: 'suppliers', column: 'supplier_code', prefix: 'SUP-', pad: 3 });
        return trx('suppliers').insert(payload).returning('*');
      });
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
        ...liveOnCreate(req, now),
      }).returning('*');
      return res.status(201).json({ success: true, data: { customer } });
    } catch (err) {
      console.error('quickAddCustomer error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────── Edit an existing customer ───────────────
  // A caller with approval rights edits live. Anyone else PROPOSES the change
  // (P2-32 / ADM-14): it is held in customers.pending_edit and the live record
  // is untouched until an approver applies it — Reject discards it and the
  // customer stays as it was. A customer that is itself still awaiting review
  // (a pending quick-add) is edited live: the whole record is under review.
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
      const next = {
        name: name != null ? String(name).trim() : cust.name,
        contact_person: contact_person !== undefined ? (contact_person || null) : cust.contact_person,
        phone: phone !== undefined ? (phone || null) : cust.phone,
        email: email !== undefined ? (email || null) : cust.email,
        address: address !== undefined ? (address || null) : cust.address,
        country: country !== undefined ? (country || null) : cust.country,
        port: port !== undefined ? (port || null) : cust.port,
      };
      if (!autoApprove && cust.approval_status !== 'pending') {
        const proposal = {};
        for (const f of CUSTOMER_EDIT_FIELDS) if ((next[f] ?? null) !== (cust[f] ?? null)) proposal[f] = next[f];
        if (!Object.keys(proposal).length) {
          return res.json({ success: true, data: { customer: cust, pending: false, unchanged: true } });
        }
        const [customer] = await db('customers').where({ id }).update({
          pending_edit: JSON.stringify(proposal),
          pending_edit_by: req.user?.id || null,
          pending_edit_at: now,
        }).returning('*');
        return res.json({ success: true, data: { customer, pending: true } });
      }
      const [customer] = await db('customers').where({ id }).update({
        ...next,
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
      const now = db.fn.now();
      const payload = {
        name: String(name).trim(),
        code: code ? String(code).trim() : null,
        grade: grade || null,
        category: category || 'Rice',
        description: description || null,
        is_byproduct: false,
        is_active: true,
        ...liveOnCreate(req, now),
      };
      const [product] = await db('products').insert(payload).returning('*');
      return res.status(201).json({ success: true, data: { product } });
    } catch (err) {
      console.error('quickAddProduct error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────── Quick-add: bag type ───────────────
  // Bag types are low-risk packaging masters with no approval workflow, so this
  // creates them directly (deduped by name) — letting an export user add a bag
  // type on the fly while building an order.
  async quickAddBagType(req, res) {
    try {
      const { name, category, size_kg, material, description, reorder_level } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Bag type name is required.' });
      }
      const existing = await db('bag_types')
        .whereRaw('LOWER(name) = LOWER(?)', [String(name).trim()])
        .first();
      if (existing) {
        return res.status(200).json({ success: true, data: { bag_type: existing, deduped: true } });
      }
      const [bag_type] = await db('bag_types').insert({
        name: String(name).trim(),
        category: category || 'branded',
        size_kg: size_kg != null && size_kg !== '' ? parseFloat(size_kg) : null,
        material: material || null,
        description: description || null,
        reorder_level: reorder_level != null && reorder_level !== '' ? parseInt(reorder_level, 10) : 0,
        is_active: true,
      }).returning('*');
      return res.status(201).json({ success: true, data: { bag_type } });
    } catch (err) {
      console.error('quickAddBagType error:', err);
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
        // A proposed customer edit waits in the pending queue too.
        if (where && tableName === 'customers' && status === 'pending') {
          q = q.where((w) => w.where(`${tableName}.approval_status`, 'pending').orWhereNotNull(`${tableName}.pending_edit`));
        } else if (where) q = q.where(where);
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
        db('customers').where((w) => w.where({ approval_status: 'pending' }).orWhereNotNull('pending_edit')).count('id as c').first(),
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
    // A proposed customer edit: Approve applies it, Reject discards it. The
    // customer's own approval status and active flag are not touched.
    if (row.pending_edit) {
      let proposal = row.pending_edit;
      if (typeof proposal === 'string') { try { proposal = JSON.parse(proposal); } catch { proposal = {}; } }
      const apply = {};
      if (status === 'approved') {
        for (const f of CUSTOMER_EDIT_FIELDS) if (proposal && Object.prototype.hasOwnProperty.call(proposal, f)) apply[f] = proposal[f];
      }
      const [updated] = await db(t.table).where({ id }).update({
        ...apply,
        pending_edit: null, pending_edit_by: null, pending_edit_at: null,
        reviewed_by: req.user?.id || null,
        reviewed_at: db.fn.now(),
        review_notes: req.body?.notes ? String(req.body.notes).slice(0, 2000) : row.review_notes,
        updated_at: db.fn.now(),
      }).returning('*');
      return res.json({ success: true, data: { [t.label]: updated, edit: status === 'approved' ? 'applied' : 'discarded' } });
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
