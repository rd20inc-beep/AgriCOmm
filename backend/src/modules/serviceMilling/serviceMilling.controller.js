// Service Milling billing (Phase A2). Invoices a third-party client for
// milling/rental/labour SERVICE fees on a toll batch — separate from local/export
// SALES. Revenue posts to 4050 Service Milling Revenue (never rice-sale revenue),
// AR to 1120; payments settle the receivable. No inventory/COGS GL (client-owned).
const db = require('../../config/database');
const accountingService = require('../accounting/accounting.service');
const { resolveCashAccountId } = require('../../shared/cashAccounts');
const { nextDocNo } = require('../../utils/docNumber');

const num = (v) => parseFloat(v) || 0;
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

function deriveStatus(total, received) {
  if (received <= 0) return 'Unpaid';
  if (received + 0.009 < total) return 'Partial';
  return 'Paid';
}

// Move a receiving account's balance + drop a linked Cash & Bank sub-ledger row
// (mirrors the local-sale receipt helper so a delete can reverse it).
async function postReceiptToAccount(trx, { accountId, amount, paymentId, reference, notes, date, userId }) {
  if (!accountId || !(amount > 0)) return;
  await trx('bank_accounts').where({ id: accountId }).increment('current_balance', amount);
  const btNo = await nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-', pad: 4 });
  await trx('bank_transactions').insert({
    transaction_no: btNo, bank_account_id: accountId,
    type: 'credit', amount, currency: 'PKR', status: 'posted',
    transaction_date: date || new Date(), reference: reference || null,
    notes: notes || null, source: 'service_milling', linked_payment_id: paymentId, created_by: userId || null,
  });
}

async function resolveReceiptAccountId(trx, { paymentMode, bankAccountId, collectionLocation }) {
  if (paymentMode === 'bank_transfer') return bankAccountId || null;
  if (paymentMode === 'cash') return resolveCashAccountId(trx, { entity: 'mill', collectionLocation: collectionLocation || null });
  return null;
}

module.exports = {
  // ── Service-milling clients ──
  // The client is the third party whose rice we mill. It must NOT be an export
  // customer (those are foreign sales buyers). We show non-export parties
  // (service-milling clients + local customers/untyped) and let the mill add a
  // new one inline. Gated by the mill-side perm, not export_orders.view.
  async listClients(req, res) {
    try {
      const { search } = req.query;
      let q = db('customers')
        .where(function () { this.whereNot('customer_type', 'export').orWhereNull('customer_type'); })
        .select('id', 'name', 'contact_person', 'phone', 'customer_type', 'approval_status')
        .orderBy('name', 'asc');
      if (search) q = q.where('name', 'ilike', `%${search}%`);
      const rows = await q.limit(200);
      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error('Service client list error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Quick-add a Service Milling Client (its own party type; pending approval).
  async createClient(req, res) {
    try {
      const name = (req.body?.name || '').trim();
      if (!name) return res.status(400).json({ success: false, message: 'Client name is required.' });
      const [customer] = await db('customers').insert({
        name,
        contact_person: req.body.contact_person || null,
        phone: req.body.phone || null,
        customer_type: 'service_milling',
        is_active: true,
        approval_status: 'pending',
      }).returning('*');
      return res.status(201).json({ success: true, data: { customer } });
    } catch (err) {
      console.error('Service client create error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ── List invoices (Finance billing view + Mill) ──
  async listInvoices(req, res) {
    try {
      const rows = await db('service_milling_invoices as i')
        .leftJoin('customers as c', 'i.client_customer_id', 'c.id')
        .leftJoin('milling_batches as mb', 'i.service_batch_id', 'mb.id')
        .select('i.*', 'c.name as client_name', 'mb.batch_no as batch_no')
        .orderBy('i.created_at', 'desc');
      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error('Service invoice list error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getInvoice(req, res) {
    try {
      const inv = await db('service_milling_invoices as i')
        .leftJoin('customers as c', 'i.client_customer_id', 'c.id')
        .leftJoin('milling_batches as mb', 'i.service_batch_id', 'mb.id')
        .where('i.id', req.params.id)
        .select('i.*', 'c.name as client_name', 'c.contact_person as client_contact', 'c.phone as client_phone', 'mb.batch_no as batch_no')
        .first();
      if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found.' });
      const payments = await db('payments').where({ service_invoice_id: inv.id }).orderBy('created_at', 'asc');
      return res.json({ success: true, data: { ...inv, payments } });
    } catch (err) {
      console.error('Service invoice get error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ── Create an invoice for a completed service batch ──
  async createInvoice(req, res) {
    const b = req.body || {};
    try {
      const result = await db.transaction(async (trx) => {
        const batch = await trx('milling_batches').where({ id: b.service_batch_id }).first();
        if (!batch) throw new Error('Service batch not found');
        if (!batch.is_service_milling) throw new Error('Batch is not a service-milling batch');
        const existing = await trx('service_milling_invoices').where({ service_batch_id: batch.id }).first();
        if (existing) throw new Error(`Batch ${batch.batch_no} already has invoice ${existing.invoice_no}`);

        // Defaults pulled from the batch; all overridable in the request.
        const millingQtyKg = round2(b.milling_qty_kg != null ? b.milling_qty_kg : (num(batch.actual_finished_kg) || num(batch.expected_output_kg)));
        const millingRate = num(b.milling_rate_per_kg != null ? b.milling_rate_per_kg : batch.service_milling_rate_per_kg);
        const rentalKattas = parseInt(b.rental_kattas != null ? b.rental_kattas : (batch.katta_count || batch.bag_count || 0), 10) || 0;
        const rentalRate = num(b.rental_rate_per_katta != null ? b.rental_rate_per_katta : batch.service_rental_rate_per_katta);
        const labourKattas = parseInt(b.labour_kattas != null ? b.labour_kattas : (batch.katta_count || batch.bag_count || 0), 10) || 0;
        const labourRate = num(b.labour_rate_per_katta != null ? b.labour_rate_per_katta : batch.service_labour_rate_per_katta);
        const extra = round2(b.extra_charges);
        const discount = round2(b.discount);
        const taxPct = num(b.tax_pct);

        const millingAmount = round2(millingQtyKg * millingRate);
        const rentalAmount = round2(rentalKattas * rentalRate);
        const labourAmount = round2(labourKattas * labourRate);
        const subtotal = round2(millingAmount + rentalAmount + labourAmount + extra - discount);
        const taxAmount = round2(subtotal * (taxPct / 100));
        const total = round2(subtotal + taxAmount);
        if (total <= 0) throw new Error('Invoice total must be greater than zero — enter at least one service rate');

        const invoiceNo = await nextDocNo(trx, { table: 'service_milling_invoices', column: 'invoice_no', prefix: 'SMI-', pad: 0 });
        const [inv] = await trx('service_milling_invoices').insert({
          invoice_no: invoiceNo,
          service_batch_id: batch.id,
          client_customer_id: batch.client_customer_id,
          invoice_date: b.invoice_date || trx.fn.now(),
          milling_qty_kg: millingQtyKg, milling_rate_per_kg: millingRate, milling_amount: millingAmount,
          rental_kattas: rentalKattas, rental_rate_per_katta: rentalRate, rental_amount: rentalAmount,
          labour_kattas: labourKattas, labour_rate_per_katta: labourRate, labour_amount: labourAmount,
          extra_charges: extra, discount, tax_pct: taxPct, tax_amount: taxAmount,
          subtotal, total_amount: total,
          received_amount: 0, balance_amount: total, payment_status: 'Unpaid',
          notes: b.notes || null, created_by: req.user?.id || null,
        }).returning('*');

        // Receivable against the client.
        await trx('receivables').insert({
          recv_no: await nextDocNo(trx, { table: 'receivables', column: 'recv_no', prefix: 'RCV-SMI-', pad: 0 }),
          entity: 'mill', customer_id: batch.client_customer_id, service_invoice_id: inv.id, type: 'Service Milling',
          expected_amount: total, received_amount: 0, outstanding: total,
          due_date: b.due_date || new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0],
          status: 'Pending', currency: 'PKR', aging: 0,
          notes: `Service milling invoice ${invoiceNo} — batch ${batch.batch_no}`,
        });

        // Revenue journal — DR 1120 Local AR / CR 4050 Service Milling Revenue.
        // Posted ONCE (signed-delta convention); the invoice is immutable after this.
        await accountingService.autoPost(trx, {
          triggerEvent: 'service_milling_invoice_recorded', entity: 'mill', amount: total, currency: 'PKR',
          refType: 'Service Milling Invoice', refNo: invoiceNo,
          description: `Service milling invoice ${invoiceNo} — batch ${batch.batch_no}`.slice(0, 240),
          partyType: 'customer', partyId: batch.client_customer_id, userId: req.user?.id,
        });

        return inv;
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      console.error('Service invoice create error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Failed to create invoice.' });
    }
  },

  // ── Record a payment against an invoice ──
  async recordPayment(req, res) {
    const b = req.body || {};
    try {
      const result = await db.transaction(async (trx) => {
        const inv = await trx('service_milling_invoices').where({ id: req.params.id }).first();
        if (!inv) throw new Error('Invoice not found');
        const amount = round2(b.amount);
        if (amount <= 0) throw new Error('Payment amount must be greater than zero');
        const newReceived = round2(num(inv.received_amount) + amount);
        if (newReceived - num(inv.total_amount) > 0.009) {
          throw new Error(`Payment exceeds balance — outstanding is PKR ${round2(num(inv.total_amount) - num(inv.received_amount))}`);
        }
        const method = b.payment_method || 'cash';
        const receiptAccountId = await resolveReceiptAccountId(trx, {
          paymentMode: method, bankAccountId: b.bank_account_id, collectionLocation: b.collection_location,
        });
        const [pay] = await trx('payments').insert({
          payment_no: await nextDocNo(trx, { table: 'payments', column: 'payment_no', prefix: 'PS-', pad: 0 }),
          type: 'receipt', amount, currency: 'PKR', fx_rate: 1, base_amount_pkr: amount,
          payment_method: method === 'bank' ? 'bank_transfer' : method,
          bank_reference: b.reference || null, bank_account_id: receiptAccountId || b.bank_account_id || null,
          payment_date: b.payment_date || trx.fn.now(),
          notes: `Service milling invoice ${inv.invoice_no} receipt`,
          service_invoice_id: inv.id, created_by: req.user?.id || null,
        }).returning('*');

        await postReceiptToAccount(trx, {
          accountId: receiptAccountId, amount, paymentId: pay.id,
          reference: b.reference || inv.invoice_no, notes: `Service milling ${inv.invoice_no} receipt`,
          date: b.payment_date, userId: req.user?.id,
        });

        const status = deriveStatus(num(inv.total_amount), newReceived);
        const balance = round2(num(inv.total_amount) - newReceived);
        await trx('service_milling_invoices').where({ id: inv.id }).update({
          received_amount: newReceived, balance_amount: balance, payment_status: status, updated_at: trx.fn.now(),
        });
        await trx('receivables').where({ service_invoice_id: inv.id }).update({
          received_amount: newReceived, outstanding: balance,
          status: status === 'Paid' ? 'Paid' : 'Partial', updated_at: trx.fn.now(),
        });
        return { payment: pay, invoice: { ...inv, received_amount: newReceived, balance_amount: balance, payment_status: status } };
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      console.error('Service payment error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Failed to record payment.' });
    }
  },
};
