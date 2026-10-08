/**
 * Read-only views behind the Finance drawers.
 *
 *   GET /api/finance/transactions/:kind/:id   kind = payment | bank
 *     One money movement with both of its sides: the payment row, the
 *     bank_transactions rows it wrote (linked_payment_id), and the journals it
 *     posted — found by the links the writers already stamp: ref_no =
 *     payment_no (recordMoneyMovement, reversals, local-sale receipts), or a
 *     journal line narrated "… <payment_no>" (an export receipt journals under
 *     the order number but narrates every line with the payment number).
 *     A bank row written by a payment returns that payment's detail; a bank row
 *     written by a contra / fund transfer returns the transfer id so the client
 *     opens the transfer drawer instead.
 *
 *   GET /api/finance/search?q=
 *     Parties, documents and transactions whose name / number matches — for the
 *     Finance header search. A restricted role (party names masked everywhere
 *     else in Finance) gets no party-name matches here either.
 *
 * Nothing here writes. Both routes sit behind finance.view.
 */
const db = require('../../config/database');
const { isPartyMasked } = require('../../shared/partyMask');
const { SOURCES } = require('./paymentSettlement');

// The source documents a payment may name (never an arbitrary table).
const SOURCE_TABLES = Object.keys(SOURCES);

const num = (v) => parseFloat(v) || 0;
const NOT_MONEY = ['Pending Finance Confirmation', 'Rejected'];

// Whether POST /payments/:id/reverse will take this payment, and if not, why —
// the same conditions reversePayment checks, read without a lock. The handler
// stays the authority; this only decides whether the button is worth showing.
// hasAnyJournal: a journal with ref_no = payment_no (hasPaymentJournal);
// hasOwnPaymentJournal: a Posted 'Payment' one (the export-receivable check).
async function reversalFor(p, { receivable, hasAnyJournal, hasOwnPaymentJournal }) {
  if (p.status === 'Reversed') return { allowed: false, reason: 'Already reversed.' };
  if (NOT_MONEY.includes(p.status)) return { allowed: false, reason: 'Only a confirmed payment can be reversed — this one never moved any money.' };
  const isPayment = p.type === 'payment' && (p.linked_payable_id || (p.source_table && p.source_id));
  const isReceipt = p.type === 'receipt' && (p.linked_receivable_id || p.local_sale_id || p.service_invoice_id);
  const fromOrder = 'This receipt was confirmed on its export order — reverse it from the export order.';
  if (p.type === 'receipt' && p.source_table === 'export_orders') return { allowed: false, reason: fromOrder };
  if (!isPayment && !isReceipt) return { allowed: false, reason: 'Only a payment against a payable, or a receipt against a receivable or local sale, can be reversed here.' };
  if (isReceipt && p.service_invoice_id && !hasAnyJournal) return { allowed: false, reason: 'This service-milling receipt is undone by voiding its invoice.' };
  if (isReceipt && receivable?.order_id && !hasOwnPaymentJournal) return { allowed: false, reason: fromOrder };
  return { allowed: true, reason: null };
}

async function userNames(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = await db('users').whereIn('id', list).select('id', 'full_name');
  return Object.fromEntries(rows.map((u) => [u.id, u.full_name]));
}

async function journalsFor({ refNos = [], narrationSuffix = null }) {
  const refs = refNos.filter(Boolean);
  if (!refs.length && !narrationSuffix) return [];
  const heads = await db('journal_entries as je')
    .where(function () {
      if (refs.length) this.whereIn('je.ref_no', refs);
      if (narrationSuffix) {
        this.orWhereIn('je.id', db('journal_lines').where('narration', 'like', `% ${narrationSuffix}`).select('journal_id'));
      }
    })
    .orderBy('je.id')
    .select('je.id', 'je.journal_no', 'je.date', 'je.ref_type', 'je.ref_no', 'je.status', 'je.description',
      'je.entity', 'je.total_debit', 'je.total_credit', 'je.created_by');
  if (!heads.length) return [];
  const lines = await db('journal_lines as jl')
    .leftJoin('chart_of_accounts as coa', 'coa.id', 'jl.account_id')
    .whereIn('jl.journal_id', heads.map((h) => h.id))
    .orderBy(['jl.journal_id', 'jl.id'])
    .select('jl.journal_id', 'jl.id', 'coa.code as account_code', db.raw('COALESCE(coa.name, jl.account) as account_name'),
      'jl.debit', 'jl.credit', 'jl.narration');
  return heads.map((h) => ({
    ...h,
    lines: lines.filter((l) => l.journal_id === h.id).map((l) => ({ ...l, debit: num(l.debit), credit: num(l.credit) })),
  }));
}

// The document a payment settles, and the party behind it.
async function documentAndParty(p) {
  let document = null; let party = null; let receivable = null;
  if (p.linked_receivable_id) {
    receivable = await db('receivables').where({ id: p.linked_receivable_id }).first();
  } else if (p.local_sale_id) {
    receivable = await db('receivables').where({ local_sale_id: p.local_sale_id }).first();
  }
  if (p.local_sale_id) {
    const s = await db('local_sales').where({ id: p.local_sale_id }).first();
    if (s) {
      document = { kind: 'local_sale', id: s.id, ref: s.sale_group_no || s.sale_no, href: '/local-sales' };
      party = { type: 'customer', id: s.customer_id || null, name: s.buyer_name || null };
    }
  } else if (p.service_invoice_id || receivable?.service_invoice_id) {
    const inv = await db('service_milling_invoices').where({ id: p.service_invoice_id || receivable.service_invoice_id }).first();
    if (inv) {
      document = { kind: 'service_invoice', id: inv.id, ref: inv.invoice_no, receivable_id: receivable?.id || null, href: '/service-milling/invoices' };
      party = { type: 'customer', id: inv.client_customer_id || receivable?.customer_id || null, name: null };
    }
  } else if (receivable) {
    const order = receivable.order_id ? await db('export_orders').where({ id: receivable.order_id }).first('id', 'order_no') : null;
    document = {
      kind: 'receivable', id: receivable.id, ref: receivable.recv_no,
      order_id: order?.id || null, order_no: order?.order_no || null,
      href: order ? `/export/${order.id}` : null,
    };
    party = { type: 'customer', id: receivable.customer_id || null, name: null };
  } else if (p.source_table === 'export_orders' && p.source_id) {
    const order = await db('export_orders').where({ id: p.source_id }).first('id', 'order_no', 'customer_id');
    if (order) {
      document = { kind: 'export_order', id: order.id, ref: order.order_no, href: `/export/${order.id}` };
      party = { type: 'customer', id: order.customer_id || null, name: null };
    }
  }

  if (!document && p.linked_payable_id) {
    const pa = await db('payables').where({ id: p.linked_payable_id }).first();
    if (pa) {
      document = { kind: 'payable', id: pa.id, ref: pa.pay_no, linked_ref: pa.linked_ref || null, href: null };
      if (pa.supplier_id) party = { type: 'supplier', id: pa.supplier_id, name: null };
      else if (pa.hauler_id) party = { type: 'hauler', id: pa.hauler_id, name: null };
    }
  }
  if (!document && SOURCE_TABLES.includes(p.source_table) && p.source_id) {
    const src = await db(p.source_table).where({ id: p.source_id }).first();
    if (src) {
      document = {
        kind: p.source_table === 'business_expenses' ? 'expense' : 'source',
        table: p.source_table, id: src.id,
        ref: src.expense_no || src.lot_no || src.purchase_no || src.pbo_no || `${p.source_table} #${src.id}`,
        href: p.source_table === 'inventory_lots' && src.lot_no ? `/lot-inventory/${src.lot_no}` : null,
      };
      if (src.supplier_id) party = { type: 'supplier', id: src.supplier_id, name: null };
    }
  }

  // Names last, in one place.
  if (party?.id) {
    const table = { customer: 'customers', supplier: 'suppliers', hauler: 'haulers' }[party.type];
    const row = table ? await db(table).where({ id: party.id }).first('name') : null;
    party.name = row?.name || party.name || null;
  }
  return { document, party, receivable };
}

async function paymentDetail(id, req) {
  const p = await db('payments as p')
    .leftJoin('bank_accounts as ba', 'ba.id', 'p.bank_account_id')
    .where('p.id', id)
    .first('p.*', 'ba.name as account_name', 'ba.bank_name as account_bank_name',
      'ba.currency as account_currency', 'ba.type as account_type');
  if (!p) return null;

  const { document, party, receivable } = await documentAndParty(p);
  const bankRows = await db('bank_transactions as bt')
    .leftJoin('bank_accounts as ba', 'ba.id', 'bt.bank_account_id')
    .where('bt.linked_payment_id', p.id)
    .orderBy('bt.id')
    .select('bt.id', 'bt.transaction_no', 'bt.type', 'bt.amount', 'bt.currency', 'bt.status', 'bt.transaction_date',
      'bt.reference', 'bt.notes', 'bt.source', 'bt.bank_account_id', 'ba.name as account_name');
  const journals = await journalsFor({ refNos: [p.payment_no], narrationSuffix: p.payment_no });
  const hasAnyJournal = journals.some((j) => j.ref_no === p.payment_no);
  const hasOwnPaymentJournal = journals.some((j) => j.ref_no === p.payment_no && j.ref_type === 'Payment' && j.status === 'Posted');
  const names = await userNames([p.created_by, p.confirmed_by, p.reversed_by]);

  let maskedParty = party;
  if (party && await isPartyMasked(req)) {
    maskedParty = { type: party.type, id: null, name: party.type === 'customer' ? 'Customer' : (party.type === 'hauler' ? 'Transporter' : 'Supplier') };
  }

  const isCheque = p.payment_method === 'cheque';
  return {
    kind: 'payment',
    payment: {
      id: p.id, payment_no: p.payment_no, type: p.type, status: p.status,
      amount: num(p.amount), currency: p.currency, fx_rate: num(p.fx_rate), base_amount_pkr: num(p.base_amount_pkr),
      payment_method: p.payment_method, payment_date: p.payment_date, due_date: p.due_date, cleared: p.cleared,
      bank_reference: p.bank_reference, notes: p.notes,
      wht_amount: num(p.wht_amount), wht_rate: p.wht_rate == null ? null : num(p.wht_rate), discount_amount: num(p.discount_amount),
      attachment_url: p.attachment_url || null, attachment_name: p.attachment_name || null,
      created_at: p.created_at, created_by_name: names[p.created_by] || null,
      confirmed_at: p.confirmed_at || null, confirmed_by_name: names[p.confirmed_by] || null,
      reversed_at: p.reversed_at || null, reversed_by_name: names[p.reversed_by] || null,
      reversal_reason: p.reversal_reason || null, reject_reason: p.reject_reason || null,
      bank_account_id: p.bank_account_id || null,
      account: p.bank_account_id ? {
        id: p.bank_account_id, name: p.account_name, bank_name: p.account_bank_name,
        currency: p.account_currency, type: p.account_type,
      } : null,
    },
    document: maskedParty === party ? document : (document ? { ...document, order_id: null, href: null } : null),
    party: maskedParty,
    bank_transactions: bankRows.map((b) => ({ ...b, amount: num(b.amount) })),
    journals,
    reversal: await reversalFor(p, { receivable, hasAnyJournal, hasOwnPaymentJournal }),
    clearable: isCheque && p.cleared === false && !['Reversed', 'Rejected'].includes(p.status),
  };
}

async function bankDetail(id, req) {
  const bt = await db('bank_transactions as bt')
    .leftJoin('bank_accounts as ba', 'ba.id', 'bt.bank_account_id')
    .where('bt.id', id)
    .first('bt.*', 'ba.name as account_name', 'ba.currency as account_currency');
  if (!bt) return null;
  if (bt.linked_payment_id) {
    const detail = await paymentDetail(bt.linked_payment_id, req);
    if (detail) return { ...detail, focus_bank_transaction_id: bt.id };
  }
  if (bt.fund_transfer_id) {
    return { kind: 'fund_transfer', fund_transfer_id: bt.fund_transfer_id, bank_transaction: { id: bt.id, transaction_no: bt.transaction_no } };
  }
  const journals = await journalsFor({ refNos: [bt.transaction_no, bt.reference] });
  const names = await userNames([bt.created_by]);
  return {
    kind: 'bank',
    bank_transaction: {
      id: bt.id, transaction_no: bt.transaction_no, type: bt.type, status: bt.status,
      amount: num(bt.amount), currency: bt.currency, transaction_date: bt.transaction_date,
      reference: bt.reference, counterparty: bt.counterparty, category: bt.category, notes: bt.notes, source: bt.source,
      bank_account_id: bt.bank_account_id, account_name: bt.account_name,
      created_at: bt.created_at, created_by_name: names[bt.created_by] || null,
    },
    journals,
  };
}

async function getTransactionDetail(req, res) {
  try {
    const { kind } = req.params;
    if (!['payment', 'bank'].includes(kind)) return res.status(400).json({ success: false, message: 'kind must be payment or bank.' });
    // A payment may also be named by its number (a statement line carries the
    // payment number, not the id).
    let id = /^\d+$/.test(String(req.params.id)) ? parseInt(req.params.id, 10) : null;
    if (!id && kind === 'payment' && req.params.id) {
      const byNo = await db('payments').where({ payment_no: String(req.params.id) }).first('id');
      id = byNo ? byNo.id : null;
      if (!id) return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id.' });
    const data = kind === 'payment' ? await paymentDetail(id, req) : await bankDetail(id, req);
    if (!data) return res.status(404).json({ success: false, message: 'Transaction not found.' });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('getTransactionDetail error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

const LIMIT = 8;
async function search(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, data: { parties: [], documents: [], transactions: [] } });
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const masked = await isPartyMasked(req);

    const parties = masked ? [] : [
      ...(await db('customers').where('name', 'ilike', like).orderBy('name').limit(LIMIT).select('id', 'name'))
        .map((r) => ({ type: 'customer', id: r.id, name: r.name })),
      ...(await db('suppliers').where('name', 'ilike', like).orderBy('name').limit(LIMIT).select('id', 'name'))
        .map((r) => ({ type: 'supplier', id: r.id, name: r.name })),
    ];

    const recv = await db('receivables as r')
      .leftJoin('export_orders as o', 'o.id', 'r.order_id')
      .whereNull('r.local_sale_id')
      .where((w) => w.where('r.recv_no', 'ilike', like).orWhere('o.order_no', 'ilike', like))
      .orderBy('r.id', 'desc').limit(LIMIT)
      .select('r.id', 'r.recv_no', 'r.type', 'r.currency', 'r.outstanding', 'r.status', 'o.order_no');
    const pay = await db('payables')
      .whereNot('status', 'Reversed')
      .where((w) => w.where('pay_no', 'ilike', like).orWhere('linked_ref', 'ilike', like))
      .orderBy('id', 'desc').limit(LIMIT)
      .select('id', 'pay_no', 'linked_ref', 'currency', 'outstanding', 'status');
    const sales = await db('local_sales')
      .where('status', 'Completed')
      .where((w) => w.where('sale_no', 'ilike', like).orWhere('sale_group_no', 'ilike', like))
      .groupByRaw('COALESCE(sale_group_no, sale_no)')
      .limit(LIMIT)
      .select(db.raw('MIN(id) as id'), db.raw('COALESCE(sale_group_no, sale_no) as ref'), db.raw('SUM(due_amount) as outstanding'));
    const expenses = await db('business_expenses')
      .where('expense_no', 'ilike', like)
      .orderBy('id', 'desc').limit(LIMIT)
      .select('id', 'expense_no', 'currency', 'amount_pkr', 'paid_amount', 'payment_status');

    const documents = [
      ...recv.map((r) => ({ kind: 'receivable', id: r.id, ref: r.recv_no, sub: r.order_no || r.type, currency: r.currency || 'USD', outstanding: num(r.outstanding), status: r.status })),
      ...sales.map((s) => ({ kind: 'local_sale', id: Number(s.id), ref: s.ref, sub: 'Local sale', currency: 'PKR', outstanding: num(s.outstanding), status: num(s.outstanding) > 0 ? 'Open' : 'Paid' })),
      ...pay.map((p) => ({ kind: 'payable', id: p.id, ref: p.pay_no, sub: p.linked_ref, currency: p.currency || 'PKR', outstanding: num(p.outstanding), status: p.status })),
      ...expenses.map((e) => ({ kind: 'expense', id: e.id, ref: e.expense_no, sub: 'Expense', currency: 'PKR', outstanding: Math.max(0, num(e.amount_pkr) - num(e.paid_amount)), status: e.payment_status })),
    ];

    const pays = await db('payments')
      .whereNotIn('status', NOT_MONEY)
      .where((w) => w.where('payment_no', 'ilike', like).orWhere('bank_reference', 'ilike', like))
      .orderBy('id', 'desc').limit(LIMIT)
      .select('id', 'payment_no', 'type', 'amount', 'currency', 'payment_date', 'status');
    const bts = await db('bank_transactions')
      .where('transaction_no', 'ilike', like)
      .orderBy('id', 'desc').limit(LIMIT)
      .select('id', 'transaction_no', 'type', 'amount', 'currency', 'transaction_date');
    const transactions = [
      ...pays.map((p) => ({ kind: 'payment', id: p.id, ref: p.payment_no, direction: p.type === 'receipt' ? 'in' : 'out', amount: num(p.amount), currency: p.currency, date: p.payment_date, status: p.status })),
      ...bts.map((b) => ({ kind: 'bank', id: b.id, ref: b.transaction_no, direction: b.type === 'credit' ? 'in' : 'out', amount: num(b.amount), currency: b.currency, date: b.transaction_date })),
    ];

    return res.json({ success: true, data: { parties, documents, transactions } });
  } catch (err) {
    console.error('finance search error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

module.exports = { getTransactionDetail, search, reversalFor };
