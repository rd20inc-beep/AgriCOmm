/**
 * Bank reconciliation, one bank / cash account at a time (owner decision B5),
 * on the existing bank_reconciliation (+ _items) tables.
 *
 * Flow: start a reconciliation for a statement date with the statement's
 * closing balance → tick the account's own bank_transactions rows (up to that
 * date, not already reconciled) that appear on the statement → the cleared
 * balance is compared with the statement balance → save progress any time →
 * complete only when the difference is 0.
 *
 *  - A ticked transaction is a 'book' item linked by bank_transaction_id
 *    (mig 326; unique per reconciliation), amount signed in the account's own
 *    currency (credit +, debit −). Once its reconciliation is Completed the
 *    transaction counts as reconciled and is not offered again.
 *  - Statement lines imported from a CSV are 'bank' items (date, reference,
 *    signed amount). They are only used to suggest ticks by amount + date.
 *  - Opening cleared balance = what the account's balance holds that no
 *    transaction explains (current_balance − Σ every posted transaction; 0
 *    when the bank rows foot to the balance) + Σ transactions reconciled by
 *    earlier Completed reconciliations. Cleared = opening + Σ ticked here.
 *
 * Nothing here posts to the GL: reconciling only confirms what is booked.
 */
const db = require('../../config/database');

const num = (v) => parseFloat(v) || 0;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const httpError = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };
const dayOf = (d) => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};
const signed = (t) => (t.type === 'credit' ? 1 : -1) * num(t.amount);
const SUGGEST_DAYS = 3;

/** Ids of this account's transactions already reconciled (Completed, other than `exceptId`). */
async function reconciledTxnIds(knex, accountId, exceptId = null) {
  let q = knex('bank_reconciliation_items as i')
    .join('bank_reconciliation as r', 'r.id', 'i.reconciliation_id')
    .where('r.bank_account_id', accountId).where('r.status', 'Completed')
    .whereNotNull('i.bank_transaction_id');
  if (exceptId) q = q.whereNot('r.id', exceptId);
  const rows = await q.select('i.bank_transaction_id');
  return new Set(rows.map((r) => Number(r.bank_transaction_id)));
}

/**
 * Suggested ticks: each statement line paired with one unreconciled
 * transaction of the same signed amount, dated within SUGGEST_DAYS, nearest
 * date first; each transaction used once. Pure; exported for tests.
 */
function suggestMatches(statementLines, transactions) {
  const used = new Set();
  const out = [];
  for (const line of statementLines) {
    const amt = round2(num(line.amount));
    const ld = line.date ? new Date(dayOf(line.date)).getTime() : null;
    let best = null;
    for (const t of transactions) {
      if (used.has(t.id) || Math.abs(round2(t.signed_amount) - amt) > 0.005) continue;
      const td = t.transaction_date ? new Date(dayOf(t.transaction_date)).getTime() : null;
      const gap = ld != null && td != null ? Math.abs(td - ld) / 86400000 : (ld == null ? 0 : Infinity);
      if (gap > SUGGEST_DAYS) continue;
      if (!best || gap < best.gap) best = { t, gap };
    }
    if (best) {
      used.add(best.t.id);
      out.push({ statement_item_id: line.id, bank_transaction_id: best.t.id });
    }
  }
  return out;
}

/** Everything the Reconcile screen shows for one reconciliation. */
async function getWorkspace(id, knex = db) {
  const recon = await knex('bank_reconciliation as br')
    .leftJoin('users as u', 'br.reconciled_by', 'u.id')
    .where('br.id', id).first('br.*', 'u.full_name as reconciled_by_name');
  if (!recon) throw httpError('Reconciliation not found.', 404);
  const account = await knex('bank_accounts').where({ id: recon.bank_account_id })
    .first('id', 'name', 'bank_name', 'account_number', 'currency', 'type', 'entity', 'current_balance');
  if (!account) throw httpError('Bank account not found.', 404);

  const statementDate = dayOf(recon.statement_date);
  const all = await knex('bank_transactions').where({ bank_account_id: account.id, status: 'posted' })
    .select('id', 'transaction_no', 'type', 'amount', 'currency', 'transaction_date', 'reference', 'counterparty', 'notes', 'source', 'category');
  const reconciled = await reconciledTxnIds(knex, account.id, recon.id);
  const items = await knex('bank_reconciliation_items').where({ reconciliation_id: recon.id }).orderBy('id');
  const ticked = new Set(items.filter((i) => i.bank_transaction_id).map((i) => Number(i.bank_transaction_id)));

  const sumAll = all.reduce((s, t) => s + signed(t), 0);
  const sumReconciled = all.filter((t) => reconciled.has(Number(t.id))).reduce((s, t) => s + signed(t), 0);
  const unexplained = round2(num(account.current_balance) - sumAll);
  const opening = round2(unexplained + sumReconciled);

  const transactions = all
    .filter((t) => !reconciled.has(Number(t.id)))
    .filter((t) => ticked.has(Number(t.id)) || !statementDate || !t.transaction_date || dayOf(t.transaction_date) <= statementDate)
    .map((t) => ({ ...t, amount: num(t.amount), signed_amount: round2(signed(t)), transaction_date: dayOf(t.transaction_date), ticked: ticked.has(Number(t.id)) }))
    .sort((a, b) => String(a.transaction_date || '').localeCompare(String(b.transaction_date || '')) || a.id - b.id);

  const clearedSum = transactions.filter((t) => t.ticked).reduce((s, t) => s + t.signed_amount, 0);
  const cleared = round2(opening + clearedSum);
  const statementBalance = round2(num(recon.statement_balance));
  const statementLines = items.filter((i) => i.transaction_type === 'bank' && !i.bank_transaction_id)
    .map((i) => ({ id: i.id, date: dayOf(i.date), reference: i.reference, amount: num(i.amount), notes: i.notes }));

  return {
    reconciliation: { ...recon, statement_date: statementDate, statement_balance: statementBalance },
    account: { ...account, current_balance: num(account.current_balance) },
    opening_balance: opening,
    unexplained_balance: unexplained,
    cleared_balance: cleared,
    difference: round2(statementBalance - cleared),
    ticked_count: transactions.filter((t) => t.ticked).length,
    transactions,
    statement_lines: statementLines,
    suggestions: suggestMatches(statementLines, transactions.filter((t) => !t.ticked)),
  };
}

/** Start one; refused while the account has another one open (409). */
async function create({ bankAccountId, statementDate, statementBalance, notes = null, userId = null }) {
  return db.transaction(async (trx) => {
    const acct = await trx('bank_accounts').where({ id: bankAccountId }).forUpdate().first();
    if (!acct) throw httpError('Bank account not found.', 404);
    const open = await trx('bank_reconciliation').where({ bank_account_id: acct.id }).whereNot('status', 'Completed').first('id', 'statement_date');
    if (open) {
      const e = httpError(`${acct.name} already has a reconciliation in progress (statement ${dayOf(open.statement_date)}) — finish it first.`, 409);
      e.existing = { id: open.id };
      throw e;
    }
    const last = await trx('bank_reconciliation').where({ bank_account_id: acct.id, status: 'Completed' })
      .orderBy('statement_date', 'desc').first('statement_date');
    const day = dayOf(statementDate);
    if (last && day < dayOf(last.statement_date)) {
      throw httpError(`${acct.name} is already reconciled to ${dayOf(last.statement_date)} — pick a later statement date.`);
    }
    const [row] = await trx('bank_reconciliation').insert({
      bank_account_id: acct.id, statement_date: day, statement_balance: round2(num(statementBalance)),
      status: 'Draft', notes: notes || null, reconciled_by: userId || null,
    }).returning('*');
    return row;
  });
}

async function lockOpen(trx, id) {
  const recon = await trx('bank_reconciliation').where({ id }).forUpdate().first();
  if (!recon) throw httpError('Reconciliation not found.', 404);
  if (recon.status === 'Completed') throw httpError('This reconciliation is completed — it can no longer change.', 409);
  return recon;
}

/** Replace the ticked set (save progress). Optionally restate the statement balance. */
async function saveTicks(id, { bankTransactionIds = [], statementBalance = null }) {
  return db.transaction(async (trx) => {
    const recon = await lockOpen(trx, id);
    const ids = [...new Set((bankTransactionIds || []).map(Number).filter((n) => n > 0))];
    const rows = ids.length
      ? await trx('bank_transactions').whereIn('id', ids).select('id', 'bank_account_id', 'type', 'amount', 'status', 'transaction_date', 'transaction_no', 'notes')
      : [];
    if (rows.length !== ids.length) throw httpError('A ticked transaction was not found.');
    const reconciled = await reconciledTxnIds(trx, recon.bank_account_id, recon.id);
    const statementDate = dayOf(recon.statement_date);
    for (const t of rows) {
      if (Number(t.bank_account_id) !== Number(recon.bank_account_id)) throw httpError(`${t.transaction_no} belongs to another account.`);
      if (t.status !== 'posted') throw httpError(`${t.transaction_no} is not posted.`);
      if (reconciled.has(Number(t.id))) throw httpError(`${t.transaction_no} is already reconciled.`);
      if (t.transaction_date && dayOf(t.transaction_date) > statementDate) throw httpError(`${t.transaction_no} is dated after the statement date.`);
    }
    await trx('bank_reconciliation_items').where({ reconciliation_id: recon.id }).whereNotNull('bank_transaction_id').del();
    if (rows.length) {
      await trx('bank_reconciliation_items').insert(rows.map((t) => ({
        reconciliation_id: recon.id, transaction_type: 'book', bank_transaction_id: t.id,
        reference: t.transaction_no, date: dayOf(t.transaction_date), amount: round2(signed(t)),
        matched: true, notes: t.notes ? String(t.notes).slice(0, 2000) : null,
      })));
    }
    const patch = { status: 'In Progress', updated_at: trx.fn.now() };
    if (statementBalance != null && statementBalance !== '') patch.statement_balance = round2(num(statementBalance));
    await trx('bank_reconciliation').where({ id: recon.id }).update(patch);
    const ws = await getWorkspace(recon.id, trx);
    await trx('bank_reconciliation').where({ id: recon.id }).update({ book_balance: ws.cleared_balance, difference: ws.difference });
    return getWorkspace(recon.id, trx);
  });
}

/** Statement lines (CSV import): 'bank' items, used to suggest ticks. */
async function addStatementLines(id, lines) {
  return db.transaction(async (trx) => {
    const recon = await lockOpen(trx, id);
    const rows = (lines || []).map((l) => ({
      reconciliation_id: recon.id, transaction_type: 'bank', reference: l.reference ? String(l.reference).slice(0, 255) : null,
      date: dayOf(l.date) || null, amount: round2(num(l.amount)), matched: false, notes: l.notes || null,
    }));
    if (rows.length) await trx('bank_reconciliation_items').insert(rows);
    await trx('bank_reconciliation').where({ id: recon.id }).update({ status: 'In Progress', updated_at: trx.fn.now() });
    return getWorkspace(recon.id, trx);
  });
}

/** Complete: only when the cleared balance equals the statement balance. */
async function complete(id, userId = null) {
  return db.transaction(async (trx) => {
    const recon = await lockOpen(trx, id);
    const ws = await getWorkspace(recon.id, trx);
    if (Math.abs(ws.difference) >= 0.005) {
      throw httpError(`The cleared balance (${ws.cleared_balance.toFixed(2)}) is ${Math.abs(ws.difference).toFixed(2)} ${ws.difference > 0 ? 'below' : 'above'} the statement balance (${ws.reconciliation.statement_balance.toFixed(2)}) — the difference must be 0 to complete.`, 409);
    }
    await trx('bank_reconciliation').where({ id: recon.id }).update({
      status: 'Completed', book_balance: ws.cleared_balance, difference: 0,
      reconciled_by: userId || null, reconciled_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    return getWorkspace(recon.id, trx);
  });
}

module.exports = { getWorkspace, create, saveTicks, addStatementLines, complete, suggestMatches, reconciledTxnIds };
