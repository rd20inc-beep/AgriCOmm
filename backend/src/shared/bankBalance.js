/**
 * The one writer of bank_accounts.current_balance (P2-17).
 *
 * An account's balance is a running figure: the go-live / account-creation
 * opening balance plus every POSTED bank_transactions row (credit +, debit −).
 * It used to be moved by ~20 code sites, each doing its own increment and —
 * usually, not always — its own bank_transactions insert, so a path that moved
 * the balance without a row (or a row without the move) drifted the Cash tab,
 * the bank screens and the GL apart with nothing to detect it.
 *
 * Every money path now calls one of these, inside the caller's transaction:
 *
 *   postBankTransaction(trx, {...})  insert a POSTED row AND move the balance
 *                                    by its signed amount, together;
 *   deleteBankTransaction(trx, row)  hard-delete a row AND back its signed
 *                                    amount out (only the void / Danger Zone
 *                                    paths that remove history use this).
 *
 * So current_balance − Σ posted rows stays equal to the opening balance an
 * account was created with, and the tie-out report (bankTieOut.js) can prove it.
 * A grep test (bankBalanceSingleWriter.test.js) fails the build when any other
 * file writes current_balance.
 */
const { nextDocNo } = require('../utils/docNumber');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => parseFloat(v) || 0;
const httpError = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };

/** +amount for a credit (money in), −amount for a debit. Pure. */
function signedAmount(row) {
  return (row && row.type === 'credit' ? 1 : -1) * num(row && row.amount);
}

function nextBtNo(trx) {
  return nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-', pad: 4 });
}

/**
 * When money out leaves an account below zero, the warning every payment
 * drawer shows (P2-31): { account_id, account_name, currency, balance_after,
 * overdrawn_by, message }. null when the account stays at or above zero. Pure.
 * A payment is NOT refused for overdrawing — the bank may honour it (an
 * overdraft facility) — but the user is told, and the response carries it.
 */
function overdraftWarning(account, balanceAfter) {
  const after = round2(num(balanceAfter));
  if (!account || after > -0.005) return null;
  const cur = String(account.currency || 'PKR').toUpperCase();
  const by = round2(-after);
  return {
    account_id: account.id,
    account_name: account.name || null,
    currency: cur,
    balance_after: after,
    overdrawn_by: by,
    message: `This overdraws ${account.name || 'the account'} by ${cur} ${by.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
  };
}

/**
 * Insert one POSTED bank_transactions row and move the account's balance by
 * its signed amount. `type` 'credit' (in) | 'debit' (out); `amount` ≥ 0 in the
 * ACCOUNT's currency. Any other bank_transactions column may be passed through
 * `fields` (reference, counterparty, category, notes, source, linked_payment_id,
 * fund_transfer_id, transaction_date, created_by …).
 *
 * Returns the inserted row plus (not columns) `overdraft` — the warning when a
 * debit left the account below zero, else null.
 */
async function postBankTransaction(trx, {
  accountId, type, amount, currency = null, transactionNo = null, ...fields
}) {
  if (!accountId) throw httpError('A bank or cash account is required to move money.');
  if (type !== 'credit' && type !== 'debit') throw httpError('A bank transaction is a credit or a debit.');
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt < 0) throw httpError('A bank transaction amount cannot be negative.');
  if (fields.status && fields.status !== 'posted') throw httpError('postBankTransaction writes posted rows only.');
  delete fields.status;

  if (amt !== 0) await trx('bank_accounts').where({ id: accountId })[type === 'credit' ? 'increment' : 'decrement']('current_balance', amt);
  const acct = await trx('bank_accounts').where({ id: accountId }).first();
  if (!acct) throw httpError('Bank account not found.');

  const [row] = await trx('bank_transactions').insert({
    transaction_no: transactionNo || await nextBtNo(trx),
    bank_account_id: accountId,
    type,
    amount: amt,
    currency: currency || acct.currency || 'PKR',
    status: 'posted',
    transaction_date: fields.transaction_date || new Date(),
    running_balance: acct.current_balance != null ? num(acct.current_balance) : null,
    ...fields,
  }).returning('*');
  const out = row && typeof row === 'object' ? row : { id: row };
  out.overdraft = type === 'debit' ? overdraftWarning(acct, acct.current_balance) : null;
  return out;
}

/**
 * Hard-delete a bank_transactions row and back out what it moved (a posted
 * row's signed amount; a pending / reversed row never moved the balance).
 * Only for the paths that remove history by design: voiding a service-milling
 * invoice and the Super-Admin Danger Zone.
 */
async function deleteBankTransaction(trx, row) {
  if (!row || !row.id) return;
  if (row.bank_account_id && (row.status == null || row.status === 'posted')) {
    const amt = round2(num(row.amount));
    // A credit put money in, so it comes back out — and a debit goes back in.
    if (amt !== 0) await trx('bank_accounts').where({ id: row.bank_account_id })[row.type === 'credit' ? 'decrement' : 'increment']('current_balance', amt);
  }
  await trx('bank_transactions').where({ id: row.id }).del();
}

module.exports = { postBankTransaction, deleteBankTransaction, overdraftWarning, signedAmount, nextBtNo };
