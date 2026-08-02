const db = require('../../config/database');
const accountingService = require('../../services/accountingService');

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

  // #14 Phase 3 — list transport charges that predate the transporter-payable
  // wiring: lot.transport_cost and batch milling_costs 'transport' rows that have
  // NO transport_costs record yet. Finance/Admin reconcile each below.
  async listUnreconciled(req, res) {
    try {
      const lots = await db('inventory_lots as l')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .leftJoin('haulers as h', 'l.hauler_id', 'h.id')
        .where('l.transport_cost', '>', 0)
        .whereNotExists(function () { this.select(db.raw('1')).from('transport_costs as tc').whereRaw('tc.lot_id = l.id'); })
        .select('l.id', 'l.lot_no', 'l.transport_cost as amount', 'l.purchase_date as date',
          'l.hauler_id', db.raw('h.name as hauler_name'), db.raw('s.name as supplier_name'))
        .orderBy('l.purchase_date', 'desc').limit(500);

      const batches = await db('milling_costs as mc')
        .join('milling_batches as mb', 'mc.batch_id', 'mb.id')
        .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
        .where('mc.category', 'transport').where('mc.amount', '>', 0)
        .whereNotExists(function () { this.select(db.raw('1')).from('transport_costs as tc').whereRaw('tc.batch_id = mc.batch_id').whereNull('tc.lot_id'); })
        .select('mc.batch_id', 'mb.batch_no', 'mc.amount', 'mc.created_at as date',
          db.raw('s.name as supplier_name'))
        .orderBy('mc.created_at', 'desc').limit(500);

      return res.json({ success: true, data: { lots, batches, total: lots.length + batches.length } });
    } catch (err) {
      console.error('transportCosts listUnreconciled error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Reconcile one unlinked transport charge: create its transport_costs record
  // (and, for company-paid, a real transporter payable + balanced accrual), or
  // 'exclude' it (record it cancelled so it stops surfacing). The cost is already
  // capitalised in inventory, so the accrual only recognises the liability
  // (Dr 1210 Raw / Cr 2010 Transporter Payable) — no re-capitalisation.
  async reconcile(req, res) {
    try {
      const { source, source_id, hauler_id, paid_by, action, vehicle_no, doc_no } = req.body || {};
      const srcId = parseInt(source_id, 10);
      if (!['lot', 'batch'].includes(source) || !srcId) {
        return res.status(400).json({ success: false, message: 'source (lot|batch) and source_id are required.' });
      }
      const paidBy = ['company', 'supplier', 'customer', 'service_client', 'included_in_supplier_rate', 'deduct_from_supplier', 'other'].includes(paid_by) ? paid_by : 'company';
      const haulerIdNum = (hauler_id != null && hauler_id !== '') ? parseInt(hauler_id, 10) : null;
      const excludeOnly = action === 'exclude';
      if (!excludeOnly && paidBy === 'company' && !haulerIdNum) {
        return res.status(400).json({ success: false, message: 'Select a transporter for a company-paid charge (or choose Exclude).' });
      }

      const out = await db.transaction(async (trx) => {
        let amount = 0, ref = null, batchId = null, lotId = null, refNo = null;
        if (source === 'lot') {
          const lot = await trx('inventory_lots').where({ id: srcId }).first();
          if (!lot) { const e = new Error('Lot not found.'); e.statusCode = 404; throw e; }
          amount = parseFloat(lot.transport_cost) || 0; lotId = srcId; refNo = lot.lot_no;
        } else {
          const mc = await trx('milling_costs').where({ batch_id: srcId, category: 'transport' }).first();
          const mb = await trx('milling_batches').where({ id: srcId }).first();
          if (!mc || !mb) { const e = new Error('Batch transport cost not found.'); e.statusCode = 404; throw e; }
          amount = parseFloat(mc.amount) || 0; batchId = srcId; refNo = mb.batch_no;
        }
        if (!(amount > 0)) { const e = new Error('This charge has no amount to reconcile.'); e.statusCode = 400; throw e; }

        // Duplicate guard.
        const dup = await trx('transport_costs')
          .modify((q) => { if (lotId) q.where({ lot_id: lotId }); else q.where({ batch_id: batchId }).whereNull('lot_id'); })
          .first();
        if (dup) { const e = new Error('This charge is already reconciled.'); e.statusCode = 409; throw e; }

        let payableId = null;
        if (!excludeOnly && paidBy === 'company' && haulerIdNum) {
          const payNo = await require('../../utils/docNumber').nextDocNo(trx, { table: 'payables', column: 'pay_no', prefix: 'PAY-', pad: 4 });
          const [np] = await trx('payables').insert({
            pay_no: payNo, entity: 'mill', payable_type: 'vendor', category: 'Transport',
            hauler_id: haulerIdNum, supplier_id: null, linked_ref: refNo,
            source_table: lotId ? 'lot_transport' : 'batch_transport', source_id: srcId,
            original_amount: amount, paid_amount: 0, outstanding: amount, status: 'Pending',
            currency: 'PKR', notes: `Transport (hauler) — reconciled for ${refNo}`,
          }).returning('*');
          payableId = np.id;
          // Recognise the liability only (cost already capitalised).
          const raw = await trx('chart_of_accounts').where({ code: '1210' }).first();
          const ap = await trx('chart_of_accounts').where({ code: '2010' }).first();
          if (raw && ap) {
            const j = await accountingService.createJournal(trx, {
              date: new Date().toISOString().slice(0, 10), entity: 'mill',
              refType: lotId ? 'Lot Transport' : 'Batch Transport', refNo,
              description: `Transport payable reconciled for ${refNo}`,
              currency: 'PKR', fxRate: 1, isAuto: true, userId: req.user?.id || null,
              partyType: 'hauler', partyId: haulerIdNum,
              lines: [
                { account_id: raw.id, account: raw.name, debit: amount, credit: 0, narration: `DR ${raw.code} ${raw.name} — transport ${refNo}` },
                { account_id: ap.id, account: ap.name, debit: 0, credit: amount, narration: `CR ${ap.code} ${ap.name} — transport ${refNo}` },
              ],
            });
            if (j?.id) await accountingService.postJournal(trx, j.id);
          }
        }

        const [tc] = await trx('transport_costs').insert({
          lot_id: lotId, batch_id: batchId, hauler_id: excludeOnly ? haulerIdNum : haulerIdNum,
          amount, paid_by: paidBy, status: excludeOnly ? 'cancelled' : (payableId ? 'unpaid' : 'approved'),
          transport_type: lotId ? 'inbound' : 'milling', vehicle_no: vehicle_no || null, doc_no: doc_no || null,
          expense_date: new Date().toISOString().slice(0, 10), entity: 'mill', payable_id: payableId,
          notes: excludeOnly ? 'Excluded during reconciliation' : 'Reconciled', created_by: req.user?.id || null,
        }).returning('*');
        return tc;
      });

      return res.json({ success: true, data: { transportCost: out } });
    } catch (err) {
      const code = err.statusCode || 500;
      if (code === 500) console.error('transportCosts reconcile error:', err);
      return res.status(code).json({ success: false, message: code === 500 ? 'Internal server error.' : err.message });
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
