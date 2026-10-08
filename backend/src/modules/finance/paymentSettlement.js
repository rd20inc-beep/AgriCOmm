/**
 * What a payment does to the rows it settles, in one place.
 *
 * Record, clear-cheque and reverse each used to carry their own copy of "add
 * the amount to the payable, then mirror it onto the source row". The copies
 * drifted: recording mirrored onto expenses and mill purchases only, clearing a
 * cheque reached lots and export costs but not printed bags, and reversing
 * undid fewer tables than recording had touched. A Money-Out payment against a
 * printed-bag or export-cost payable left the source row saying "unpaid", so
 * the Purchases tab offered to pay it again. Every path now goes through the
 * same helpers, which add a signed delta to the row they read under a lock.
 */
const { nextDocNo } = require('../../utils/docNumber');
const accountingService = require('../accounting/accounting.service');
const { ledgerFailure, missingAccounts } = require('../../shared/ledgerFailure');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => parseFloat(v) || 0;

// Source rows that carry their own paid_amount / payment_status, how to read
// their total (PKR), and the word each CHECK constraint uses for "nothing paid".
const SOURCES = {
  business_expenses: { total: (r) => num(r.amount_pkr), unpaid: 'Pending', paidDate: 'paid_date' },
  mill_purchases: { total: (r) => num(r.total_amount), unpaid: 'Pending', paidDate: 'paid_date' },
  export_order_costs: {
    total: (r) => num(r.base_amount_pkr) || num(r.amount) * (num(r.fx_rate) || 1),
    unpaid: 'Pending', paidDate: 'paid_at',
  },
  printed_bag_orders: { total: (r) => num(r.total_amount), unpaid: 'Unpaid' },
  inventory_lots: { total: (r) => num(r.landed_cost_total), unpaid: 'Pending', due: 'due_amount' },
};
// Legacy payables carry no source_table, only the source row's natural key.
const NATURAL_KEYS = [['inventory_lots', 'lot_no'], ['mill_purchases', 'purchase_no'], ['business_expenses', 'expense_no']];
// The itemised supplier lines of a purchase lot (labour, bags, …) are part of
// the same purchase as its 'Raw Material' line: each carries source_id = the
// lot, so a payment on any of them is a payment on that lot. Lines owed to
// another party (lot_transport → hauler, lot_commission → broker) are not.
const LOT_SUPPLIER_LINES = ['lot_labor', 'lot_unloading', 'lot_packing', 'lot_other', 'lot_bag'];

/**
 * The source row a payment settles: the payment's own source ref (payPurchase
 * cheques carry one), else the payable's, else — for a legacy payable with no
 * source_table at all — its linked_ref matched against each natural key.
 * A payable that names a source_table outside SOURCES (lot_transport,
 * lot_commission, …) is that party's own bill and has no source row to mirror.
 */
async function resolveSource(trx, { payment, payable }) {
  if (payment && SOURCES[payment.source_table] && payment.source_id) {
    return { table: payment.source_table, id: payment.source_id };
  }
  if (payable && SOURCES[payable.source_table] && payable.source_id) {
    return { table: payable.source_table, id: payable.source_id };
  }
  if (payable && LOT_SUPPLIER_LINES.includes(payable.source_table) && payable.source_id) {
    return { table: 'inventory_lots', id: payable.source_id };
  }
  if (payable && !payable.source_table && payable.category === 'Raw Material' && payable.source_id) {
    // The lot's rice line (createPurchaseLot keys it by source_id = lot id).
    return { table: 'inventory_lots', id: payable.source_id };
  }
  if (payable && !payable.source_table && payable.linked_ref) {
    for (const [table, col] of NATURAL_KEYS) {
      const r = await trx(table).where(col, payable.linked_ref).first('id');
      if (r) return { table, id: r.id };
    }
  }
  return null;
}

/**
 * Add a signed PKR delta to a source row's paid_amount and restate its status.
 * `paidOn` dates a row this payment completes (default: today, or the date it
 * already carries).
 */
async function mirrorSourcePaid(trx, source, deltaPkr, extra = {}, paidOn = null) {
  if (!source || !SOURCES[source.table]) return null;
  const spec = SOURCES[source.table];
  const row = await trx(source.table).where({ id: source.id }).forUpdate().first();
  if (!row) return null;
  const total = spec.total(row);
  const paid = Math.max(0, round2(num(row.paid_amount) + deltaPkr));
  const status = paid <= 0.01 ? spec.unpaid : (total - paid <= 0.01 ? 'Paid' : 'Partial');
  const upd = { paid_amount: paid, payment_status: status, updated_at: trx.fn.now(), ...extra };
  if (spec.paidDate) upd[spec.paidDate] = status === 'Paid' ? (paidOn || row[spec.paidDate] || new Date()) : null;
  if (spec.due) upd[spec.due] = Math.max(0, round2(total - paid));
  await trx(source.table).where({ id: source.id }).update(upd);
  return { table: source.table, paid, status };
}

/**
 * Add a signed delta to a payable (already read under lock) and mirror the new
 * state onto its transport_costs record (#14: the transporter ledger reads it).
 */
async function applyPayableDelta(trx, payable, delta) {
  const orig = num(payable.original_amount);
  const paid = Math.max(0, round2(num(payable.paid_amount) + delta));
  const status = paid <= 0.01 ? 'Pending' : (paid >= orig - 0.01 ? 'Paid' : 'Partial');
  await trx('payables').where({ id: payable.id }).update({
    paid_amount: paid,
    outstanding: Math.max(0, round2(orig - paid)),
    status,
    updated_at: trx.fn.now(),
  });
  if (payable.hauler_id || payable.source_table === 'lot_transport') {
    const tc = status === 'Paid' ? 'paid' : status === 'Partial' ? 'partially_paid' : 'unpaid';
    await trx('transport_costs').where({ payable_id: payable.id }).update({ status: tc, updated_at: trx.fn.now() });
  }
  return { paid, status, fullyPaid: status === 'Paid' };
}

/** Add a signed delta to a local sale's paid / due (read here under lock). */
async function mirrorLocalSale(trx, saleId, delta) {
  const sale = await trx('local_sales').where({ id: saleId }).forUpdate().first();
  if (!sale) return null;
  const paid = Math.max(0, round2(num(sale.paid_amount) + delta));
  const due = Math.max(0, round2(num(sale.total_amount) - paid));
  const status = due <= 0.01 ? 'Paid' : paid > 0.01 ? 'Partial' : (sale.payment_mode === 'credit' ? 'Credit' : 'Pending');
  await trx('local_sales').where({ id: sale.id }).update({
    paid_amount: paid, due_amount: due, payment_status: status, updated_at: trx.fn.now(),
  });
  return { paid, due, status };
}

/** Add a signed delta to a service-milling invoice's received / balance. */
async function mirrorServiceInvoice(trx, invoiceId, delta) {
  const inv = await trx('service_milling_invoices').where({ id: invoiceId }).forUpdate().first();
  if (!inv) return null;
  const total = num(inv.total_amount);
  const received = Math.max(0, round2(num(inv.received_amount) + delta));
  const balance = Math.max(0, round2(total - received));
  const status = received <= 0 ? 'Unpaid' : (received + 0.009 < total ? 'Partial' : 'Paid');
  await trx('service_milling_invoices').where({ id: inv.id }).update({
    received_amount: received, balance_amount: balance, payment_status: status, updated_at: trx.fn.now(),
  });
  return { received, balance, status };
}

/**
 * Settle (delta > 0) or un-settle (delta < 0) every document one payment row
 * touches, by the same signed delta:
 *  - a receipt: its receivable, the local sale and the service-milling invoice
 *    behind it;
 *  - a payment: its payable (+ transport_costs) and the source row the payable
 *    — or the payment itself — names (expense, mill purchase, export cost,
 *    printed-bag order, lot).
 * Recording, clearing a cheque and reversing all go through here, so a
 * document can never hear about a payment on one path and not on another.
 * `payable` / `receivable` are rows already read under lock.
 */
async function settleDocuments(trx, { payment, payable = null, receivable = null, delta, deltaPkr, stamp = {}, paidOn = null }) {
  const out = {};
  if (payment.type === 'receipt') {
    if (receivable) out.receivable = await applyReceivableDelta(trx, receivable, delta);
    const saleId = payment.local_sale_id || receivable?.local_sale_id;
    if (saleId) out.localSale = await mirrorLocalSale(trx, saleId, delta);
    const invoiceId = payment.service_invoice_id || receivable?.service_invoice_id;
    if (invoiceId) out.serviceInvoice = await mirrorServiceInvoice(trx, invoiceId, delta);
  } else {
    if (payable) out.payable = await applyPayableDelta(trx, payable, delta);
    const source = await resolveSource(trx, { payment, payable });
    // Rows that record how they were paid hear which account it was.
    const how = delta > 0 && source && ['business_expenses', 'export_order_costs', 'mill_purchases'].includes(source.table) ? stamp : {};
    out.source = await mirrorSourcePaid(trx, source, deltaPkr, how, paidOn);
  }
  return out;
}

/** Add a signed delta to a receivable (already read under lock). */
async function applyReceivableDelta(trx, rec, delta) {
  const expected = num(rec.expected_amount);
  const received = Math.max(0, round2(num(rec.received_amount) + delta));
  const outstanding = Math.max(0, round2(expected - received));
  const status = received <= 0.01 ? 'Pending' : (outstanding <= 0.01 ? 'Paid' : 'Partial');
  await trx('receivables').where({ id: rec.id }).update({
    received_amount: received, outstanding, status, updated_at: trx.fn.now(),
  });
  return { received, outstanding, status };
}

/**
 * Cheques written against a payable / receivable that have not cleared yet.
 * They have not touched paid_amount, so an outstanding read off the row alone
 * lets a second payment be booked on top of a cheque already in the post.
 */
async function pendingChequeTotal(trx, { payableId, receivableId, sourceTable, sourceId, excludeId }) {
  const where = payableId ? { linked_payable_id: payableId }
    : receivableId ? { linked_receivable_id: receivableId }
      : { source_table: sourceTable, source_id: sourceId };
  const rows = await trx('payments').where({ ...where, cleared: false }).select('id', 'amount', 'status');
  return round2((Array.isArray(rows) ? rows : [])
    .filter((p) => p.status !== 'Reversed' && p.status !== 'Rejected' && String(p.id) !== String(excludeId))
    .reduce((s, p) => s + num(p.amount), 0));
}

/** Collision-safe BT- number, same BT-NNNN shape as before. */
function nextBtNo(trx) {
  return nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-', pad: 4 });
}

/**
 * Post the signed-delta of every Posted journal with this ref: each line comes
 * back with its debit and credit swapped, as one fresh Posted journal per
 * original. Nothing is edited or marked — the trial balance counts Posted
 * journals only, so the original plus its delta nets to zero (never
 * reverse-and-repost, which double-counts). Returns how many were mirrored.
 */
async function postDeltaOf(trx, { refNo, refTypes, refType, description, userId, date }) {
  let q = trx('journal_entries').where({ ref_no: refNo, status: 'Posted' });
  if (refTypes && refTypes.length) q = q.whereIn('ref_type', refTypes);
  const originals = await q.select('*');
  let n = 0;
  for (const j of Array.isArray(originals) ? originals : []) {
    const lines = await trx('journal_lines').where({ journal_id: j.id }).select('*');
    if (!Array.isArray(lines) || !lines.length) continue;
    const delta = await accountingService.createJournal(trx, {
      date: date || new Date().toISOString().slice(0, 10),
      entity: j.entity || 'mill',
      refType,
      refNo,
      description: description || `Reversal of ${j.journal_no || refNo}`,
      currency: 'PKR',
      fxRate: 1,
      isAuto: true,
      userId: userId || null,
      partyType: j.party_type || null,
      partyId: j.party_id || null,
      lines: lines.map((l) => ({
        account_id: l.account_id,
        account: l.account,
        debit: num(l.credit),
        credit: num(l.debit),
        narration: `Reversal — ${l.narration || refNo}`.slice(0, 240),
      })),
    });
    if (delta?.id) await accountingService.postJournal(trx, delta.id);
    n += 1;
  }
  return n;
}

/**
 * A cheque is never money in the bank until it clears (owner decision,
 * 2026-10-07 — same-day cheques included). Recording one settles nothing,
 * moves no account and posts no journal; Clear Cheque does all three.
 */
const isCheque = (method) => String(method || '').toLowerCase() === 'cheque';

/** True when a journal already carries this payment's number (idempotent clear). */
async function hasPaymentJournal(trx, paymentNo) {
  if (!paymentNo) return false;
  const j = await trx('journal_entries').where({ ref_no: paymentNo }).first('id');
  return !!j;
}

const expenseEntity = (t) => (t === 'mill' ? 'mill' : t === 'export' ? 'export' : 'general');

/**
 * The settlement journal for one payment row, posted under its payment_no:
 *  - a receipt: Dr 1000 / Cr 1120 (local sale), 1310 (advance), 1110 (export
 *    balance) or 1100, stamped to the receivable's customer;
 *  - a payment: Dr the payable (2010; 2040 for a salaries expense) for the
 *    gross / Cr 1000 for the net cash, Cr 2060 for WHT, Cr 4060 for the
 *    discount, stamped to the supplier.
 * This is what recordPayment posts for a settled payment, and what Clear Cheque
 * posts for a cheque recorded on any screen (Money In/Out, Purchases,
 * Expenses). Throws through ledgerFailure so the caller's transaction rolls back.
 */
async function postPaymentJournal(trx, { payment, userId, date, description, overrides = {} }) {
  try {
    const isReceivable = payment.type === 'receipt';
    const paymentNo = payment.payment_no;
    const amtNum = num(payment.amount);
    const cur = String(payment.currency || 'PKR').toUpperCase();
    const fx = num(payment.fx_rate) || 1;
    const amtPkr = round2(num(payment.base_amount_pkr) || (cur === 'PKR' ? amtNum : amtNum * fx));
    if (!(amtPkr > 0)) return null;
    const wht = isReceivable ? 0 : num(payment.wht_amount);
    const disc = isReceivable ? 0 : num(payment.discount_amount);

    let counterCode = isReceivable ? '1100' : '2010';
    let entity = isReceivable ? 'export' : 'mill';
    let partyType = null; let partyId = null;
    let what = isReceivable ? `receivable #${payment.linked_receivable_id || ''}` : `payable #${payment.linked_payable_id || ''}`;
    if (isReceivable && (payment.linked_receivable_id || payment.service_invoice_id)) {
      const r = payment.linked_receivable_id ? await trx('receivables').where({ id: payment.linked_receivable_id }).first() : null;
      const invoiceId = payment.service_invoice_id || r?.service_invoice_id;
      // Credit the receivable account the document was booked to:
      //  - a local sale, a service-milling invoice (Dr 1120 / Cr 4050) and any
      //    other mill receivable (opening balances were booked to 1120) → 1120;
      //  - an export order's advance → 1310, its balance → 1110.
      if (r?.local_sale_id || invoiceId) { counterCode = '1120'; entity = 'mill'; }
      else if (r && (r.order_id || String(r.entity || '').toLowerCase() === 'export')) {
        counterCode = String(r.type || '').toLowerCase() === 'advance' ? '1310' : '1110';
        entity = 'export';
      } else if (r) { counterCode = '1120'; entity = r.entity === 'general' ? 'general' : 'mill'; }
      if (r?.recv_no) what = r.recv_no;
      if (r?.customer_id) { partyType = 'customer'; partyId = r.customer_id; }
      if (invoiceId) {
        const inv = await trx('service_milling_invoices').where({ id: invoiceId }).first();
        if (!partyId && inv?.client_customer_id) { partyType = 'customer'; partyId = inv.client_customer_id; }
        if (inv?.invoice_no) what = inv.invoice_no;
      }
    } else if (!isReceivable) {
      const pa = payment.linked_payable_id ? await trx('payables').where({ id: payment.linked_payable_id }).first() : null;
      // The payable's own side of the business, unless its source says otherwise below.
      if (pa?.entity) entity = ['mill', 'export', 'general'].includes(pa.entity) ? pa.entity : 'mill';
      if (pa?.pay_no) what = pa.pay_no;
      if (pa?.supplier_id) { partyType = 'supplier'; partyId = pa.supplier_id; }
      else if (pa?.hauler_id) { partyType = 'hauler'; partyId = pa.hauler_id; }
      // A payment recorded against a source document (Purchases tab, Expenses)
      // carries it on the payment row.
      const src = SOURCES[payment.source_table] && payment.source_id
        ? await trx(payment.source_table).where({ id: payment.source_id }).first()
        : null;
      if (src) {
        what = src.expense_no || src.lot_no || src.purchase_no || src.pbo_no || `${payment.source_table} #${payment.source_id}`;
        if (payment.source_table === 'business_expenses') {
          // The account the accrual credited (expenses.service create):
          // salaries → 2040 Salaries Payable, everything else → 2010.
          if (src.category === 'salaries') counterCode = '2040';
          entity = expenseEntity(src.expense_type);
        } else if (['export_order_costs', 'printed_bag_orders'].includes(payment.source_table)) {
          entity = 'export';
        } else if (payment.source_table === 'inventory_lots' && src.entity) {
          entity = src.entity === 'export' ? 'export' : 'mill';
        }
        const sid = src.supplier_id || pa?.supplier_id || null;
        if (sid) { partyType = 'supplier'; partyId = sid; }
      }
    }

    // A caller that owns the document's posting (an export order's receipt)
    // names the counter account, entity, party and the reference it journals under.
    if (overrides.counterCode) counterCode = overrides.counterCode;
    if (overrides.entity) entity = overrides.entity;
    if (overrides.partyType !== undefined) { partyType = overrides.partyType; partyId = overrides.partyId || null; }

    const cash = await trx('chart_of_accounts').where({ code: '1000' }).first();
    let counter = await trx('chart_of_accounts').where({ code: counterCode }).first();
    // Salaries Payable missing on an older DB → Supplier Payable, as expenses do.
    if (!counter && counterCode === '2040') { counterCode = '2010'; counter = await trx('chart_of_accounts').where({ code: '2010' }).first(); }
    if (!cash || !counter) throw missingAccounts(['1000', counterCode]);

    let lines;
    if (!isReceivable && (wht > 0 || disc > 0)) {
      // #14 1e — the payable clears for the gross; only the net leaves the bank.
      const netCash = round2(amtPkr - wht - disc);
      lines = [
        { account_id: counter.id, account: counter.name, debit: amtPkr, credit: 0, narration: `DR ${counter.code} ${counter.name} — ${paymentNo}` },
        { account_id: cash.id, account: cash.name, debit: 0, credit: netCash, narration: `CR ${cash.code} ${cash.name} — net cash ${paymentNo}` },
      ];
      if (wht > 0) {
        const whtAcc = await trx('chart_of_accounts').where({ code: '2060' }).first();
        if (whtAcc) lines.push({ account_id: whtAcc.id, account: whtAcc.name, debit: 0, credit: round2(wht), narration: `CR ${whtAcc.code} ${whtAcc.name} — WHT ${paymentNo}` });
      }
      if (disc > 0) {
        const discAcc = await trx('chart_of_accounts').where({ code: '4060' }).first();
        if (discAcc) lines.push({ account_id: discAcc.id, account: discAcc.name, debit: 0, credit: round2(disc), narration: `CR ${discAcc.code} ${discAcc.name} — discount ${paymentNo}` });
      }
    } else {
      const dr = isReceivable ? cash : counter;
      const cr = isReceivable ? counter : cash;
      lines = [
        { account_id: dr.id, account: dr.name, debit: amtPkr, credit: 0, narration: `DR ${dr.code} ${dr.name} — ${paymentNo}` },
        { account_id: cr.id, account: cr.name, debit: 0, credit: amtPkr, narration: `CR ${cr.code} ${cr.name} — ${paymentNo}` },
      ];
    }
    const noteOriginal = cur !== 'PKR' ? ` (orig ${cur} ${amtNum.toLocaleString()} @ ${fx})` : '';
    const d = date ? new Date(date) : new Date();
    const journal = await accountingService.createJournal(trx, {
      date: (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10),
      entity,
      refType: overrides.refType || 'Payment',
      refNo: overrides.refNo || paymentNo,
      description: description || overrides.description || `${isReceivable ? 'Receipt' : 'Payment'} ${paymentNo} for ${what}${noteOriginal}`,
      currency: 'PKR',
      fxRate: 1,
      isAuto: true,
      userId: userId || null,
      partyType,
      partyId,
      // The original foreign amount's currency + rate, so the ledger can show
      // the exact USD figure (the PKR lines keep the GL in one currency).
      origCurrency: overrides.origCurrency || (cur !== 'PKR' ? cur : null),
      origFxRate: overrides.origFxRate || (cur !== 'PKR' ? fx : null),
      lines,
    });
    if (journal?.id) await accountingService.postJournal(trx, journal.id);
    return journal;
  } catch (e) {
    throw ledgerFailure(e);
  }
}

module.exports = {
  isCheque, hasPaymentJournal, postPaymentJournal,
  SOURCES, LOT_SUPPLIER_LINES, round2, resolveSource, mirrorSourcePaid, applyPayableDelta, applyReceivableDelta,
  mirrorLocalSale, mirrorServiceInvoice, settleDocuments,
  pendingChequeTotal, nextBtNo, postDeltaOf,
};
