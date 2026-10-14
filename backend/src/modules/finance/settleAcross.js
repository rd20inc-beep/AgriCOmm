/**
 * Settle one party's money across several invoices in ONE transaction (P2-31).
 *
 * The statement Pay drawer used to call POST /payments once per invoice: a
 * failure on the third left the first two posted (a partly settled
 * statement) and it could not carry WHT or a discount. Now the drawer sends
 * the whole allocation here and every part goes through the one payment
 * engine (recordMoneyMovement) — or, for a local-sale group, the local-sale
 * group receipt (receiveOnSaleGroup) — inside a single transaction: all of it
 * is recorded, or none of it.
 *
 * body: {
 *   type: 'payment' | 'receipt', currency,
 *   payment_method, bank_account_id, payment_date, due_date, bank_reference, notes,
 *   allocations: [{ payable_id | receivable_id | sale_group_no, amount,
 *                   wht_amount?, wht_rate?, discount_amount? }]   (WHT / discount: payments only)
 * }
 *
 * Refused (400) before anything is written: a mix of payables and receivables,
 * the same document twice, documents of different parties or currencies, an
 * export-order receivable (those go through the order's maker-checker
 * confirmation), an amount above a document's outstanding (the engine's own
 * check, net of uncleared cheques).
 *
 * Returns { payments: [...], total, overdraft } — overdraft: the warning when
 * the account ended below zero (owner decision B2: allowed, with a warning).
 */
const { recordMoneyMovement } = require('./paymentEngine');
const { overdraftWarning } = require('../../shared/bankBalance');
const { round2 } = require('./paymentSettlement');

const httpError = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };
const num = (v) => parseFloat(v) || 0;
const partyOf = (row) => (row.supplier_id ? `s${row.supplier_id}` : row.hauler_id ? `h${row.hauler_id}` : row.customer_id ? `c${row.customer_id}` : null);

async function settleAcross(trx, body, { userId = null, millOnly = false } = {}) {
  const { type, allocations } = body || {};
  if (type !== 'payment' && type !== 'receipt') throw httpError('type must be payment or receipt.');
  const isReceipt = type === 'receipt';
  if (!Array.isArray(allocations) || !allocations.length) throw httpError('Choose at least one invoice to settle.');

  const docKey = isReceipt ? 'receivable_id' : 'payable_id';
  const seen = new Set();
  for (const a of allocations) {
    const key = a.sale_group_no ? `g:${a.sale_group_no}` : a[docKey] ? `d:${a[docKey]}` : null;
    if (!key) throw httpError(`Each allocation needs a ${isReceipt ? 'receivable_id or sale_group_no' : 'payable_id'}.`);
    if (!isReceipt && a.sale_group_no) throw httpError('A local sale is settled with a receipt, not a payment.');
    if (seen.has(key)) throw httpError('The same invoice appears twice in the allocation.');
    seen.add(key);
    if (!(num(a.amount) > 0)) throw httpError('Every allocation needs an amount greater than zero.');
    if (isReceipt && (num(a.wht_amount) > 0 || num(a.discount_amount) > 0)) throw httpError('WHT and discount apply to payments only.');
  }

  // Lock every stored document in id order (two settlements touching the same
  // invoices must not deadlock) and check they belong together.
  const table = isReceipt ? 'receivables' : 'payables';
  const ids = allocations.filter((a) => a[docKey]).map((a) => Number(a[docKey])).sort((x, y) => x - y);
  const rows = ids.length ? await trx(table).whereIn('id', ids).orderBy('id', 'asc').forUpdate() : [];
  const byId = new Map((rows || []).map((r) => [Number(r.id), r]));
  for (const id of ids) if (!byId.has(id)) throw httpError(`${isReceipt ? 'Receivable' : 'Payable'} #${id} not found.`, 404);

  const cur = String(body.currency || (rows[0] && rows[0].currency) || 'PKR').toUpperCase();
  const parties = new Set();
  for (const r of rows) {
    if (String(r.currency || 'PKR').toUpperCase() !== cur) {
      throw httpError(`All invoices settled together must be in ${cur} — ${r.recv_no || r.pay_no || `#${r.id}`} is in ${String(r.currency || 'PKR').toUpperCase()}.`);
    }
    if (isReceipt && r.order_id) {
      throw httpError(`${r.recv_no || `#${r.id}`} is an export order's ${String(r.type || 'receivable').toLowerCase()} — record it from Money In so Finance confirms it on the order.`);
    }
    parties.add(partyOf(r));
  }
  if (parties.size > 1) throw httpError('All invoices settled together must belong to the same party.');
  if (allocations.some((a) => a.sale_group_no) && cur !== 'PKR') throw httpError('Local sales are in PKR.');

  const common = {
    type, currency: cur,
    method: body.payment_method || null,
    bankAccountId: body.bank_account_id || null,
    paymentDate: body.payment_date || null,
    dueDate: body.due_date || null,
    bankReference: body.bank_reference || null,
    userId, millOnly,
  };

  // Lazy: localSales requires the finance engine, not the other way round.
  const { receiveOnSaleGroup, readReceiptInput } = require('../localSales/localSales.controller');
  const payments = [];
  let last = null;
  for (const a of allocations) {
    if (a.sale_group_no) {
      // The same input the local-sale group Pay endpoint reads.
      const input = readReceiptInput({
        amount: round2(num(a.amount)), payment_method: body.payment_method || 'cash', payment_date: body.payment_date,
        reference: body.bank_reference, notes: body.notes, bank_account_id: body.bank_account_id,
        due_date: body.due_date, collection_location: body.collection_location,
      });
      if (input.error) throw httpError(input.error);
      const out = await receiveOnSaleGroup(trx, String(a.sale_group_no), input, { millOnly, userId });
      for (const p of out.applied) payments.push({ id: p.payment_id, payment_no: p.payment_no, amount: p.amount, sale_group_no: out.group_no });
      continue;
    }
    const doc = byId.get(Number(a[docKey]));
    const res = await recordMoneyMovement(trx, {
      ...common,
      payable: isReceipt ? null : doc,
      receivable: isReceipt ? doc : null,
      amount: round2(num(a.amount)),
      wht: a.wht_amount, whtRate: a.wht_rate, discount: a.discount_amount,
      notes: body.notes || null,
      bt: { notes: `${isReceipt ? 'Receipt' : 'Payment'} for ${doc.recv_no || doc.pay_no || `#${doc.id}`}` },
    });
    payments.push({ id: res.payment.id, payment_no: res.payment.payment_no, amount: num(res.payment.amount), [docKey]: doc.id });
    if (res.accountId) last = res.accountId;
  }

  // The account's balance once everything has moved.
  let overdraft = null;
  if (last && !isReceipt) {
    const acct = await trx('bank_accounts').where({ id: last }).first();
    overdraft = acct ? overdraftWarning(acct, acct.current_balance) : null;
  }
  return { payments, total: round2(payments.reduce((s, p) => s + num(p.amount), 0)), currency: cur, overdraft };
}

module.exports = { settleAcross };
