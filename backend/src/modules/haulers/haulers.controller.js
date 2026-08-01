const db = require('../../config/database');

// Transport / Hauler master (item #5). A dedicated registry of transport
// contractors, distinct from suppliers. CRUD + basic history (lots carried,
// weight, freight charges) — the per-hauler payment/outstanding engine is
// intentionally deferred; freight payables ride the existing payables rail with
// hauler_id attribution.
const haulersController = {
  // List — used by the HaulerPicker and the Admin › Haulers tab. Active only by
  // default; pass ?include_inactive=1 for the admin management view. Optional
  // ?search= filters by name/contact/phone.
  async list(req, res) {
    try {
      const { include_inactive, search } = req.query;
      let q = db('haulers')
        .select('id', 'name', 'contact_person', 'phone', 'email', 'address', 'ntn', 'vehicle_types', 'notes', 'opening_balance', 'is_active', 'created_at', 'updated_at')
        .orderBy('name', 'asc');
      if (include_inactive !== '1' && include_inactive !== 'true') {
        q = q.where('is_active', true);
      }
      if (search) {
        const s = `%${String(search).trim().toLowerCase()}%`;
        q = q.where(function () {
          this.whereRaw('LOWER(name) LIKE ?', [s])
            .orWhereRaw('LOWER(COALESCE(contact_person, \'\')) LIKE ?', [s])
            .orWhereRaw('LOWER(COALESCE(phone, \'\')) LIKE ?', [s]);
        });
      }
      const haulers = await q;
      return res.json({ success: true, data: { haulers } });
    } catch (err) {
      console.error('haulers list error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // One hauler + basic history: lots it carried (with received weight + freight)
  // and totals. Freight is read from the payables it is attributed to.
  async getOne(req, res) {
    try {
      const { id } = req.params;
      const hauler = await db('haulers').where({ id }).first();
      if (!hauler) return res.status(404).json({ success: false, message: 'Hauler not found.' });

      // Lots this hauler carried (lot-level hauler_id).
      const lots = await db('inventory_lots as l')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .where('l.hauler_id', id)
        .select(
          'l.id', 'l.lot_no', 'l.item_name', 'l.purchase_date',
          'l.received_net_weight_kg', 'l.net_weight_kg', 'l.transport_cost',
          db.raw('s.name as supplier_name')
        )
        .orderBy('l.purchase_date', 'desc')
        .limit(500);

      // Freight payables attributed to this hauler (basic history — NOT a
      // payment/outstanding ledger, which is deferred).
      const freight = await db('payables')
        .where({ hauler_id: id })
        .select('id', 'pay_no', 'linked_ref', 'category', 'original_amount', 'outstanding', 'status', 'due_date', 'created_at')
        .orderBy('created_at', 'desc')
        .limit(500);

      const totals = {
        lots: lots.length,
        weight_kg: lots.reduce((a, l) => a + (parseFloat(l.received_net_weight_kg) || parseFloat(l.net_weight_kg) || 0), 0),
        freight_total: freight.reduce((a, f) => a + (parseFloat(f.original_amount) || 0), 0),
        freight_outstanding: freight.reduce((a, f) => a + (parseFloat(f.outstanding) || 0), 0),
      };

      return res.json({ success: true, data: { hauler, lots, freight, totals } });
    } catch (err) {
      console.error('hauler getOne error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // #14 Phase 1c — transporter ledger: a chronological, running-balance view of
  // everything owed to and paid to one transporter. CHARGES (company-paid
  // transport costs) increase the balance owed; PAYMENTS reduce it. Non-company
  // charges are listed for operational visibility but carry no financial impact.
  // Each entry carries refs (lot / batch / vehicle / payment) for drill-down.
  async getLedger(req, res) {
    try {
      const { id } = req.params;
      const hauler = await db('haulers').where({ id }).first();
      if (!hauler) return res.status(404).json({ success: false, message: 'Hauler not found.' });

      const opening = parseFloat(hauler.opening_balance) || 0;

      // Charges from the transport_costs backbone.
      const charges = await db('transport_costs as tc')
        .leftJoin('inventory_lots as l', 'tc.lot_id', 'l.id')
        .leftJoin('milling_batches as b', 'tc.batch_id', 'b.id')
        .where('tc.hauler_id', id)
        .select('tc.id', 'tc.amount', 'tc.paid_by', 'tc.status', 'tc.expense_date',
          'tc.vehicle_no', 'tc.doc_no', 'tc.lot_id', 'tc.batch_id', 'tc.payable_id',
          db.raw('l.lot_no as lot_no'), db.raw('b.batch_no as batch_no'));

      // Payments made to this transporter (against any of its payables).
      const payments = await db('payments as p')
        .join('payables as pa', 'p.linked_payable_id', 'pa.id')
        .leftJoin('bank_accounts as ba', 'p.bank_account_id', 'ba.id')
        .where('pa.hauler_id', id)
        .andWhere('p.type', 'payment')
        .select('p.id', 'p.payment_no', 'p.amount', 'p.payment_date', 'p.payment_method',
          'p.bank_reference', 'p.notes', 'p.linked_payable_id', 'p.cleared',
          db.raw('ba.name as bank_account_name'));

      // Build one entry stream: charge (debit) / payment (credit).
      const entries = [];
      for (const c of charges) {
        const companyPayable = c.paid_by === 'company';
        entries.push({
          kind: 'charge',
          date: c.expense_date,
          description: `Transport charge${c.lot_no ? ` — Lot ${c.lot_no}` : c.batch_no ? ` — Batch ${c.batch_no}` : ''}${c.vehicle_no ? ` (${c.vehicle_no})` : ''}`,
          ref: c.doc_no || null,
          lotId: c.lot_id, lotNo: c.lot_no, batchId: c.batch_id, batchNo: c.batch_no,
          paidBy: c.paid_by, status: c.status, payableId: c.payable_id,
          charge: companyPayable ? (parseFloat(c.amount) || 0) : 0,
          payment: 0,
          informationalAmount: companyPayable ? 0 : (parseFloat(c.amount) || 0),
        });
      }
      for (const p of payments) {
        entries.push({
          kind: 'payment',
          date: p.payment_date,
          description: `Payment ${p.payment_no}${p.bank_account_name ? ` — ${p.bank_account_name}` : ''}${p.cleared === false ? ' (uncleared)' : ''}`,
          ref: p.bank_reference || p.payment_no,
          paymentId: p.id, paymentNo: p.payment_no, method: p.payment_method,
          charge: 0,
          payment: p.cleared === false ? 0 : (parseFloat(p.amount) || 0),
        });
      }
      // Chronological, then stamp a running balance (opening + charges − payments).
      entries.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      let running = opening;
      for (const e of entries) { running += (e.charge || 0) - (e.payment || 0); e.balance = Math.round(running * 100) / 100; }

      const totalCharges = entries.reduce((s, e) => s + (e.charge || 0), 0);
      const totalPayments = entries.reduce((s, e) => s + (e.payment || 0), 0);
      const closing = Math.round((opening + totalCharges - totalPayments) * 100) / 100;

      return res.json({
        success: true,
        data: {
          hauler,
          opening_balance: opening,
          entries,
          totals: { charges: totalCharges, payments: totalPayments, outstanding: closing },
          closing_balance: closing,
        },
      });
    } catch (err) {
      console.error('hauler getLedger error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async create(req, res) {
    try {
      const { name, contact_person, phone, email, address, ntn, vehicle_types, notes, opening_balance } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Hauler name is required.' });
      }
      const [row] = await db('haulers')
        .insert({
          name: String(name).trim(),
          contact_person: contact_person ? String(contact_person).trim() : null,
          phone: phone ? String(phone).trim() : null,
          email: email ? String(email).trim() : null,
          address: address ? String(address).trim() : null,
          ntn: ntn ? String(ntn).trim() : null,
          vehicle_types: vehicle_types ? String(vehicle_types).trim() : null,
          notes: notes ? String(notes).trim() : null,
          opening_balance: parseFloat(opening_balance) || 0,
          is_active: true,
          created_by: req.user?.id || null,
        })
        .returning('*');
      return res.json({ success: true, data: { hauler: row } });
    } catch (err) {
      console.error('hauler create error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, contact_person, phone, email, address, ntn, vehicle_types, notes, is_active } = req.body;
      const patch = {};
      if (name !== undefined) patch.name = String(name).trim();
      if (contact_person !== undefined) patch.contact_person = contact_person ? String(contact_person).trim() : null;
      if (phone !== undefined) patch.phone = phone ? String(phone).trim() : null;
      if (email !== undefined) patch.email = email ? String(email).trim() : null;
      if (address !== undefined) patch.address = address ? String(address).trim() : null;
      if (ntn !== undefined) patch.ntn = ntn ? String(ntn).trim() : null;
      if (vehicle_types !== undefined) patch.vehicle_types = vehicle_types ? String(vehicle_types).trim() : null;
      if (notes !== undefined) patch.notes = notes ? String(notes).trim() : null;
      if (req.body.opening_balance !== undefined) patch.opening_balance = parseFloat(req.body.opening_balance) || 0;
      if (is_active !== undefined) patch.is_active = !!is_active;
      patch.updated_at = db.fn.now();
      const [row] = await db('haulers').where({ id }).update(patch).returning('*');
      if (!row) return res.status(404).json({ success: false, message: 'Hauler not found.' });
      return res.json({ success: true, data: { hauler: row } });
    } catch (err) {
      console.error('hauler update error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Soft-delete when the hauler is referenced anywhere (keeps history intact);
  // hard-delete only a brand-new, unused entry.
  async remove(req, res) {
    try {
      const { id } = req.params;
      const usedByLot = await db('inventory_lots').where({ hauler_id: id }).first();
      const usedByVeh = await db('milling_vehicle_arrivals').where({ hauler_id: id }).first();
      const usedByPay = await db('payables').where({ hauler_id: id }).first();
      if (usedByLot || usedByVeh || usedByPay) {
        const [row] = await db('haulers').where({ id }).update({ is_active: false, updated_at: db.fn.now() }).returning('*');
        if (!row) return res.status(404).json({ success: false, message: 'Hauler not found.' });
        return res.json({ success: true, data: { hauler: row, softDeleted: true } });
      }
      const n = await db('haulers').where({ id }).del();
      if (!n) return res.status(404).json({ success: false, message: 'Hauler not found.' });
      return res.json({ success: true });
    } catch (err) {
      console.error('hauler delete error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};

module.exports = haulersController;
