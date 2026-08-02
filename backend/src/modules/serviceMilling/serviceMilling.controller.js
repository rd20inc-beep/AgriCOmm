// Service Milling billing (Phase A2). Invoices a third-party client for
// milling/rental/labour SERVICE fees on a toll batch — separate from local/export
// SALES. Revenue posts to 4050 Service Milling Revenue (never rice-sale revenue),
// AR to 1120; payments settle the receivable. No inventory/COGS GL (client-owned).
const db = require('../../config/database');
const accountingService = require('../accounting/accounting.service');
const inventoryService = require('../../services/inventoryService');
const { resolveCashAccountId } = require('../../shared/cashAccounts');
const { nextDocNo } = require('../../utils/docNumber');

const num = (v) => parseFloat(v) || 0;
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

function deriveStatus(total, received) {
  if (received <= 0) return 'Unpaid';
  if (received + 0.009 < total) return 'Partial';
  return 'Paid';
}

// The dispatch routes take the URL param, which is the batch_no (e.g. "M-011")
// — NOT the numeric id. Querying `.where({ id: 'M-011' })` on an integer column
// throws in Postgres (invalid input syntax), so resolve by which form it is.
function resolveBatch(qb, idParam) {
  return /^\d+$/.test(String(idParam))
    ? qb('milling_batches').where({ id: idParam }).first()
    : qb('milling_batches').where({ batch_no: idParam }).first();
}

// Advance a service batch's lot status from how much client-owned stock is still
// on hand vs how much has been handed back. Driven by dispatch records + the
// lots' remaining available_qty, so it survives qty drawdown on each dispatch.
async function recomputeServiceLotStatus(trx, batchId) {
  const disp = await trx('service_milling_dispatches').where({ service_batch_id: batchId }).sum('qty_kg as t').first();
  const dispatchedKg = num(disp?.t);
  const rem = await trx('inventory_lots')
    .where({ service_batch_id: batchId, ownership: 'client' })
    .sum('available_qty as a').first();
  const remainingKg = num(rem?.a);
  let status;
  if (dispatchedKg <= 0) {
    // Nothing dispatched yet — reflect whether the lot has been milled.
    const batch = await trx('milling_batches').where({ id: batchId }).first();
    status = num(batch?.actual_finished_kg) > 0 ? 'Milled' : 'Received';
  } else if (remainingKg <= 0.001) {
    status = 'Fully Dispatched';
  } else {
    status = 'Partially Dispatched';
  }
  await trx('milling_batches').where({ id: batchId }).update({ service_lot_status: status, updated_at: trx.fn.now() });
  return status;
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

        // Each service bills on its OWN chargeable quantity (all overridable in
        // the request) — milling on kg actually milled, rental & labour on their
        // own katta/bag counts. Do NOT force all three onto the received qty.
        // Milling default = the operator-declared milled quantity if set, else the
        // raw actually processed (Σ yield outputs) — for a partial mill this is
        // less than the received quantity.
        const yieldOutputKg = num(batch.actual_finished_kg) + num(batch.broken_kg) + num(batch.sortex_rejects_kg)
          + num(batch.powder_kg) + num(batch.sweeping_kg) + num(batch.choba_kg) + num(batch.ov_kg)
          + num(batch.stone_kg) + num(batch.wastage_kg) + num(batch.bran_kg) + num(batch.husk_kg);
        const defaultMilled = batch.milled_qty_kg != null ? num(batch.milled_qty_kg) : (yieldOutputKg || num(batch.expected_output_kg));
        const millingQtyKg = round2(b.milling_qty_kg != null ? b.milling_qty_kg : defaultMilled);
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
        // #14 Phase 2b-ii — client-borne freight recovered on the bill. It adds to
        // the client's total (untaxed pass-through) but is NOT service revenue; we
        // front the hauler and the freight washes through 1450 Freight Recoverable.
        // A freight charge requires the hauler we're fronting.
        const freight = round2(b.freight_amount);
        const freightHaulerId = b.freight_hauler_id ? parseInt(b.freight_hauler_id, 10) : null;
        if (freight > 0 && !freightHaulerId) {
          throw new Error('Select the hauler for the client freight (we front the hauler and recover it on the bill).');
        }
        const serviceTotal = round2(subtotal + taxAmount); // taxed service portion (revenue)
        const total = round2(serviceTotal + freight);
        if (total <= 0) throw new Error('Invoice total must be greater than zero — enter at least one service rate');

        const invoiceNo = await nextDocNo(trx, { table: 'service_milling_invoices', column: 'invoice_no', prefix: 'SMI-', pad: 0 });
        const [inv] = await trx('service_milling_invoices').insert({
          invoice_no: invoiceNo,
          service_batch_id: batch.id,
          client_customer_id: batch.client_customer_id,
          invoice_date: b.invoice_date || trx.fn.now(),
          milling_qty_kg: millingQtyKg, milling_rate_per_kg: millingRate, milling_amount: millingAmount,
          rental_kattas: rentalKattas, rental_rate_per_katta: rentalRate, rental_amount: rentalAmount,
          rental_from: b.rental_from || null, rental_to: b.rental_to || null,
          labour_kattas: labourKattas, labour_rate_per_katta: labourRate, labour_amount: labourAmount,
          extra_charges: extra, discount, tax_pct: taxPct, tax_amount: taxAmount,
          freight_amount: freight, freight_hauler_id: freightHaulerId,
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

        // Revenue journal — DR 1120 Local AR / CR 4050 Service Milling Revenue,
        // for the SERVICE portion only (freight is a recovery, not revenue).
        // Posted ONCE (signed-delta convention); the invoice is immutable after this.
        await accountingService.autoPost(trx, {
          triggerEvent: 'service_milling_invoice_recorded', entity: 'mill', amount: serviceTotal, currency: 'PKR',
          refType: 'Service Milling Invoice', refNo: invoiceNo,
          description: `Service milling invoice ${invoiceNo} — batch ${batch.batch_no}`.slice(0, 240),
          partyType: 'customer', partyId: batch.client_customer_id, userId: req.user?.id,
        });

        // #14 2b-ii — client freight recovery. We front the hauler (a transporter
        // payable) and bill the client; the freight washes through 1450 Freight
        // Recoverable so it's neither revenue nor a company cost:
        //   Dr 1120 (client) / Cr 1450   — freight billed to the client
        //   Dr 1450 / Cr 2010 (hauler)   — freight payable to the hauler
        // Net: 1450 = 0, client AR +freight, hauler AP +freight.
        if (freight > 0 && freightHaulerId) {
          const last = await trx('payables').whereRaw("pay_no ~ '^PAY-[0-9]+$'")
            .orderByRaw('CAST(SUBSTRING(pay_no FROM 5) AS INTEGER) DESC').first('pay_no');
          const seq = last?.pay_no ? (parseInt(last.pay_no.replace('PAY-', ''), 10) || 0) + 1 : 1;
          const [haulPay] = await trx('payables').insert({
            pay_no: `PAY-${String(seq).padStart(3, '0')}`, entity: 'mill', payable_type: 'vendor',
            category: 'Transport', supplier_id: null, hauler_id: freightHaulerId,
            linked_ref: invoiceNo, source_table: 'service_transport', source_id: inv.id,
            original_amount: freight, paid_amount: 0, outstanding: freight, status: 'Pending',
            due_date: b.due_date || new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0],
            currency: 'PKR', notes: `Client freight (hauler) for service invoice ${invoiceNo} — recovered from client`,
          }).returning('*');
          // Link the transport_costs backbone for the transporter ledger/reports.
          await trx('transport_costs').insert({
            hauler_id: freightHaulerId, batch_id: batch.id, transport_type: 'service',
            amount: freight, paid_by: 'service_client', status: 'unpaid',
            expense_date: (b.invoice_date ? new Date(b.invoice_date) : new Date()).toISOString().slice(0, 10),
            entity: 'mill', payable_id: haulPay.id, created_by: req.user?.id || null,
            notes: `Client freight for service invoice ${invoiceNo}`,
          });
          const [ar, rec, ap] = await Promise.all([
            trx('chart_of_accounts').where({ code: '1120' }).first(),
            trx('chart_of_accounts').where({ code: '1450' }).first(),
            trx('chart_of_accounts').where({ code: '2010' }).first(),
          ]);
          if (ar && rec && ap) {
            const d0 = (b.invoice_date ? new Date(b.invoice_date) : new Date()).toISOString().slice(0, 10);
            const jc = await accountingService.createJournal(trx, {
              date: d0, entity: 'mill', refType: 'Service Milling Invoice', refNo: invoiceNo,
              description: `Client freight recovery — invoice ${invoiceNo}`,
              currency: 'PKR', fxRate: 1, isAuto: true, userId: req.user?.id, partyType: 'customer', partyId: batch.client_customer_id,
              lines: [
                { account_id: ar.id, account: ar.name, debit: freight, credit: 0, narration: `DR ${ar.code} ${ar.name} — client freight` },
                { account_id: rec.id, account: rec.name, debit: 0, credit: freight, narration: `CR ${rec.code} ${rec.name} — freight recovered` },
              ],
            });
            if (jc?.id) await accountingService.postJournal(trx, jc.id);
            const jh = await accountingService.createJournal(trx, {
              date: d0, entity: 'mill', refType: 'Service Milling Invoice', refNo: invoiceNo,
              description: `Freight payable to hauler — invoice ${invoiceNo}`,
              currency: 'PKR', fxRate: 1, isAuto: true, userId: req.user?.id, partyType: 'hauler', partyId: freightHaulerId,
              lines: [
                { account_id: rec.id, account: rec.name, debit: freight, credit: 0, narration: `DR ${rec.code} ${rec.name} — freight recoverable` },
                { account_id: ap.id, account: ap.name, debit: 0, credit: freight, narration: `CR ${ap.code} ${ap.name} — hauler freight payable` },
              ],
            });
            if (jh?.id) await accountingService.postJournal(trx, jh.id);
          }
        }

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

  // ── Void an invoice so the batch can be re-issued ──
  // Reverses any payment receipts (bank/cash), marks the revenue journal
  // Reversed (Posted-only convention — no reverse+repost), drops the receivable
  // and the invoice row. The batch then has no invoice, so a fresh one can be
  // created (e.g. after the katta count was corrected).
  async voidInvoice(req, res) {
    try {
      const result = await db.transaction(async (trx) => {
        const inv = await trx('service_milling_invoices').where({ id: req.params.id }).first();
        if (!inv) throw new Error('Invoice not found');

        // 1. Reverse payment receipts linked to this invoice (account balance +
        //    bank_transactions), then drop the payment rows.
        const payments = await trx('payments').where({ service_invoice_id: inv.id });
        for (const pay of payments) {
          const bts = await trx('bank_transactions').where({ linked_payment_id: pay.id });
          for (const bt of bts) {
            await trx('bank_accounts').where({ id: bt.bank_account_id }).decrement('current_balance', parseFloat(bt.amount) || 0);
            await trx('bank_transactions').where({ id: bt.id }).del();
          }
          await trx('payments').where({ id: pay.id }).del();
        }

        // 2. Reverse the revenue GL (DR 1120 / CR 4050) — mark Reversed only.
        const journals = await trx('journal_entries')
          .where({ ref_type: 'Service Milling Invoice', ref_no: inv.invoice_no, status: 'Posted' });
        for (const j of journals) {
          await accountingService.reverseJournal(trx, { journalId: j.id, reason: `Voided invoice ${inv.invoice_no}`, userId: req.user?.id });
        }

        // 3. Drop the receivable + the invoice row so the batch is re-invoiceable.
        await trx('receivables').where({ service_invoice_id: inv.id }).del();
        await trx('service_milling_invoices').where({ id: inv.id }).del();

        return { voided: inv.invoice_no, service_batch_id: inv.service_batch_id, reversed_journals: journals.length, reversed_payments: payments.length };
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Service invoice void error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Failed to void invoice.' });
    }
  },

  // ── Dispatch: the client-owned finished/by-product lots + handover history ──
  async getDispatchSummary(req, res) {
    try {
      const batch = await resolveBatch(db, req.params.id);
      if (!batch) return res.status(404).json({ success: false, message: 'Service batch not found.' });

      const lots = await db('inventory_lots')
        .where({ service_batch_id: batch.id, ownership: 'client' })
        .select('id', 'lot_no', 'item_name', 'type', 'grade', 'unit',
          'qty', 'available_qty', 'received_net_weight_kg', 'bag_weight_kg')
        .orderBy('type', 'asc').orderBy('id', 'asc');

      const dispatches = await db('service_milling_dispatches as d')
        .leftJoin('inventory_lots as l', 'd.lot_id', 'l.id')
        .where('d.service_batch_id', batch.id)
        .select('d.*', 'l.lot_no', 'l.item_name')
        .orderBy('d.created_at', 'desc');

      const producedKg = lots.reduce((s, l) => s + (num(l.received_net_weight_kg) || num(l.qty)), 0);
      const remainingKg = lots.reduce((s, l) => s + num(l.available_qty), 0);
      const dispatchedKg = dispatches.reduce((s, d) => s + num(d.qty_kg), 0);

      return res.json({
        success: true,
        data: { lot_status: batch.service_lot_status, lots, dispatches, summary: { producedKg, remainingKg, dispatchedKg } },
      });
    } catch (err) {
      console.error('Dispatch summary error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Record a handover of client-owned stock. NOT a sale — draws down the client
  // lot only (postMovement 'service_dispatch'); no revenue, COGS or GL.
  async createDispatch(req, res) {
    const b = req.body || {};
    try {
      const result = await db.transaction(async (trx) => {
        const batch = await resolveBatch(trx, req.params.id);
        if (!batch) throw new Error('Service batch not found');
        if (!batch.is_service_milling) throw new Error('Batch is not a service-milling batch');

        const lot = await trx('inventory_lots').where({ id: b.lot_id }).first();
        if (!lot) throw new Error('Lot not found');
        if (lot.service_batch_id !== batch.id || lot.ownership !== 'client') {
          throw new Error('Lot does not belong to this service batch');
        }
        const qtyKg = round2(b.qty_kg);
        if (qtyKg <= 0) throw new Error('Dispatch quantity must be greater than zero');
        if (qtyKg - num(lot.available_qty) > 0.001) {
          throw new Error(`Only ${num(lot.available_qty)} kg available in lot ${lot.lot_no}`);
        }

        const dispatchNo = await nextDocNo(trx, { table: 'service_milling_dispatches', column: 'dispatch_no', prefix: 'SMD-', pad: 0 });
        const [disp] = await trx('service_milling_dispatches').insert({
          dispatch_no: dispatchNo,
          service_batch_id: batch.id,
          client_customer_id: batch.client_customer_id,
          lot_id: lot.id,
          qty_kg: qtyKg,
          bag_count: b.bag_count != null ? parseInt(b.bag_count, 10) : null,
          vehicle_no: b.vehicle_no || null,
          driver_name: b.driver_name || null,
          dispatch_date: b.dispatch_date || trx.fn.now(),
          notes: b.notes || null,
          created_by: req.user?.id || null,
        }).returning('*');

        // Draw down the client-owned lot — no GL (client already owns the rice).
        await inventoryService.postMovement(trx, {
          movementType: 'service_dispatch',
          lotId: lot.id,
          qty: qtyKg,
          costPerUnit: 0,
          batchId: batch.id,
          linkedRef: dispatchNo,
          notes: `Service dispatch ${dispatchNo} to client`,
          userId: req.user?.id,
        });

        const lotStatus = await recomputeServiceLotStatus(trx, batch.id);
        return { ...disp, lot_status: lotStatus };
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      console.error('Service dispatch error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Failed to record dispatch.' });
    }
  },

  // Reverse a dispatch — add the client-owned stock back and drop the record.
  async deleteDispatch(req, res) {
    try {
      const result = await db.transaction(async (trx) => {
        const disp = await trx('service_milling_dispatches').where({ id: req.params.id }).first();
        if (!disp) throw new Error('Dispatch not found');

        await inventoryService.postMovement(trx, {
          movementType: 'service_dispatch_reverse',
          lotId: disp.lot_id,
          qty: num(disp.qty_kg),
          costPerUnit: 0,
          batchId: disp.service_batch_id,
          linkedRef: disp.dispatch_no,
          notes: `Reversal of service dispatch ${disp.dispatch_no}`,
          userId: req.user?.id,
        });
        await trx('service_milling_dispatches').where({ id: disp.id }).del();
        const lotStatus = await recomputeServiceLotStatus(trx, disp.service_batch_id);
        return { reversed: disp.dispatch_no, lot_status: lotStatus };
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Service dispatch delete error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Failed to reverse dispatch.' });
    }
  },
};
