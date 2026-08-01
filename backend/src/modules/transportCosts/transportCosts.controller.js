const db = require('../../config/database');

// Transport Costs (spec item #14). The canonical record of every transport
// charge — links a hauler to a lot/batch, records who bears it (paid_by), and
// for company-paid charges links to the payable that the transporter is paid
// through. Powers AP → Transporters, the transporter ledger, reports and
// reconciliation. Phase 1a exposes read + manual create/update; the payment
// workflow + ledger arrive in later phases.

const PAID_BY = ['company', 'supplier', 'customer', 'service_client', 'included_in_supplier_rate', 'deduct_from_supplier', 'other'];
const STATUSES = ['draft', 'pending_approval', 'approved', 'unpaid', 'partially_paid', 'paid', 'disputed', 'cancelled', 'reversed'];

const baseQuery = () => db('transport_costs as tc')
  .leftJoin('haulers as h', 'tc.hauler_id', 'h.id')
  .leftJoin('inventory_lots as l', 'tc.lot_id', 'l.id')
  .leftJoin('milling_batches as b', 'tc.batch_id', 'b.id')
  .leftJoin('warehouses as w', 'tc.warehouse_id', 'w.id')
  .leftJoin('suppliers as s', 'tc.supplier_id', 's.id')
  .leftJoin('customers as c', 'tc.customer_id', 'c.id')
  .leftJoin('payables as p', 'tc.payable_id', 'p.id')
  .select(
    'tc.*',
    db.raw('h.name as hauler_name'),
    db.raw('l.lot_no as lot_no'),
    db.raw('b.batch_no as batch_no'),
    db.raw('w.name as warehouse_name'),
    db.raw('s.name as supplier_name'),
    db.raw('c.name as customer_name'),
    db.raw('p.paid_amount as payable_paid'),
    db.raw('p.outstanding as payable_outstanding'),
    db.raw('p.status as payable_status'),
  );

const transportCostsController = {
  async list(req, res) {
    try {
      const { hauler_id, status, paid_by, lot_id, batch_id, search } = req.query;
      let q = baseQuery();
      if (hauler_id) q = q.where('tc.hauler_id', hauler_id);
      if (status) q = q.where('tc.status', status);
      if (paid_by) q = q.where('tc.paid_by', paid_by);
      if (lot_id) q = q.where('tc.lot_id', lot_id);
      if (batch_id) q = q.where('tc.batch_id', batch_id);
      if (search) {
        const s = `%${String(search).trim().toLowerCase()}%`;
        q = q.where(function () {
          this.whereRaw('LOWER(COALESCE(h.name,\'\')) LIKE ?', [s])
            .orWhereRaw('LOWER(COALESCE(tc.vehicle_no,\'\')) LIKE ?', [s])
            .orWhereRaw('LOWER(COALESCE(tc.doc_no,\'\')) LIKE ?', [s])
            .orWhereRaw('LOWER(COALESCE(l.lot_no,\'\')) LIKE ?', [s]);
        });
      }
      const rows = await q.orderBy('tc.expense_date', 'desc').orderBy('tc.id', 'desc').limit(1000);
      return res.json({ success: true, data: { transportCosts: rows } });
    } catch (err) {
      console.error('transportCosts list error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async getOne(req, res) {
    try {
      const row = await baseQuery().where('tc.id', req.params.id).first();
      if (!row) return res.status(404).json({ success: false, message: 'Transport cost not found.' });
      return res.json({ success: true, data: { transportCost: row } });
    } catch (err) {
      console.error('transportCosts getOne error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Manual transport-cost entry (e.g. Mill Finance additional cost). The
  // company-payable creation for manual entries is wired in a later phase; for
  // now this records the operational charge with its responsibility + status.
  async create(req, res) {
    try {
      const b = req.body || {};
      const amount = parseFloat(b.amount);
      if (!(amount > 0)) return res.status(400).json({ success: false, message: 'A positive amount is required.' });
      const paidBy = PAID_BY.includes(b.paid_by) ? b.paid_by : 'company';
      const status = STATUSES.includes(b.status) ? b.status : (paidBy === 'company' ? 'unpaid' : 'approved');
      const [row] = await db('transport_costs').insert({
        hauler_id: b.hauler_id || null,
        lot_id: b.lot_id || null,
        batch_id: b.batch_id || null,
        warehouse_id: b.warehouse_id || null,
        supplier_id: b.supplier_id || null,
        customer_id: b.customer_id || null,
        vehicle_no: b.vehicle_no ? String(b.vehicle_no).trim() : null,
        driver_name: b.driver_name || null,
        transport_type: b.transport_type || null,
        amount,
        paid_by: paidBy,
        status,
        expense_date: b.expense_date || new Date().toISOString().slice(0, 10),
        doc_no: b.doc_no || null,
        attachment_path: b.attachment_path || null,
        notes: b.notes || null,
        entity: b.entity || 'mill',
        created_by: req.user?.id || null,
      }).returning('*');
      return res.status(201).json({ success: true, data: { transportCost: row } });
    } catch (err) {
      console.error('transportCosts create error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async update(req, res) {
    try {
      const b = req.body || {};
      const patch = {};
      const fields = ['hauler_id', 'lot_id', 'batch_id', 'warehouse_id', 'supplier_id', 'customer_id',
        'vehicle_no', 'driver_name', 'transport_type', 'doc_no', 'attachment_path', 'notes', 'expense_date'];
      for (const f of fields) if (b[f] !== undefined) patch[f] = b[f] === '' ? null : b[f];
      if (b.amount !== undefined) patch.amount = parseFloat(b.amount) || 0;
      if (b.paid_by !== undefined && PAID_BY.includes(b.paid_by)) patch.paid_by = b.paid_by;
      if (b.status !== undefined && STATUSES.includes(b.status)) patch.status = b.status;
      patch.updated_at = db.fn.now();
      const [row] = await db('transport_costs').where({ id: req.params.id }).update(patch).returning('*');
      if (!row) return res.status(404).json({ success: false, message: 'Transport cost not found.' });
      return res.json({ success: true, data: { transportCost: row } });
    } catch (err) {
      console.error('transportCosts update error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = transportCostsController;
