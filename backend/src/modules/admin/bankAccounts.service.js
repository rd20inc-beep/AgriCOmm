/**
 * Bank / cash account master — create and edit.
 *
 * A bank account's `current_balance` is a running figure that payments,
 * receipts, fund/contra transfers and the Super-Admin Danger Zone adjust move,
 * each with a bank_transactions row (and, where it is real money, a journal).
 * The admin edit form used to send the whole row back, balance included, so any
 * edit (an IBAN typo fix) rewrote the balance with no sub-ledger row and no GL
 * entry — and if a payment landed while the form was open, wrote the stale
 * figure back over it. Editing is now limited to descriptive fields; the balance
 * is never written here.
 *
 * Creating an account with an opening balance books it the way the go-live
 * opening balances were booked (2026-09-24): one bank_transactions row
 * (source 'opening_balance', category 'Opening Balance') plus a Posted journal
 * Dr 1000 Cash & Bank / Cr 3000 Owner's Equity, all in the same transaction.
 */
const accounting = require('../accounting/accounting.service');
const fxRates = require('../finance/fxRate.service');
const { nextDocNo } = require('../../utils/docNumber');

// Descriptive columns an edit may change (schema.baseline.txt bank_accounts).
// Never: id, uid, created_at, updated_at, current_balance.
const EDITABLE = [
  'name', 'bank_name', 'account_number', 'branch', 'type',
  'account_title', 'iban', 'swift_bic', 'bank_address',
  'correspondent_bank_name', 'correspondent_swift', 'correspondent_account',
  'is_active', 'is_export_default', 'approved_for_customer', 'is_favorite',
];
// Columns that change what the money IS — only while the account has no money history.
const LOCKED_ONCE_USED = ['currency', 'entity'];

const BALANCE_MSG = 'Balances change only through payments, transfers or a Danger Zone adjustment.';

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const httpError = (status, message) => Object.assign(new Error(message), { status });

async function hasMoneyHistory(trx, acct) {
  if (Math.abs(Number(acct.current_balance) || 0) >= 0.005) return true;
  const count = async (table, col) => {
    const row = await trx(table).where(col, acct.id).count('id as n').first();
    return Number(row?.n || 0);
  };
  if (await count('bank_transactions', 'bank_account_id')) return true;
  if (await count('payments', 'bank_account_id')) return true;
  if (await count('fund_transfers', 'from_account_id')) return true;
  if (await count('fund_transfers', 'to_account_id')) return true;
  return false;
}

/**
 * Edit an account's descriptive fields. Throws {status} errors:
 *   404 not found · 400 a different balance was sent · 409 currency/entity change on a used account.
 */
async function updateBankAccount(trx, id, body = {}) {
  const acct = await trx('bank_accounts').where({ id }).forUpdate().first();
  if (!acct) throw httpError(404, 'bank account not found.');

  // A client that still sends the balance back is fine as long as it is the
  // stored figure; a different one is an attempt to move money from the master form.
  const sent = body.current_balance;
  if (sent !== undefined && sent !== null && sent !== '') {
    if (!Number.isFinite(Number(sent)) || Math.abs(Number(sent) - Number(acct.current_balance)) >= 0.005) {
      throw httpError(400, BALANCE_MSG);
    }
  }

  const updates = {};
  for (const k of EDITABLE) if (body[k] !== undefined) updates[k] = body[k];

  const changingLocked = LOCKED_ONCE_USED.filter(
    (k) => body[k] !== undefined && body[k] !== null && String(body[k]) !== String(acct[k] ?? ''),
  );
  if (changingLocked.length) {
    if (await hasMoneyHistory(trx, acct)) {
      throw httpError(409, `This account already has transactions or a balance — its ${changingLocked.join(' and ')} cannot be changed. Open a new account instead.`);
    }
    for (const k of changingLocked) updates[k] = body[k];
  }

  updates.updated_at = trx.fn.now();
  if (updates.is_export_default) {
    await trx('bank_accounts').update({ is_export_default: false })
      .where('is_export_default', true).whereNot('id', id);
  }
  const [row] = await trx('bank_accounts').where({ id }).update(updates).returning('*');
  return row;
}

/**
 * Create an account. `opening_balance` (or the legacy `current_balance` the old
 * form sent) is booked as an opening balance: BT row + Posted Dr 1000 / Cr 3000.
 * Non-PKR openings post the PKR equivalent at `opening_fx_rate` (or the rate on file).
 */
async function createBankAccount(trx, body = {}, userId = null) {
  const opening = r2(Number(body.opening_balance ?? body.current_balance ?? 0) || 0);

  const row = {};
  for (const k of [...EDITABLE, ...LOCKED_ONCE_USED]) if (body[k] !== undefined) row[k] = body[k];
  row.current_balance = opening;

  if (row.is_export_default) {
    await trx('bank_accounts').update({ is_export_default: false }).where('is_export_default', true);
  }
  const [acct] = await trx('bank_accounts').insert(row).returning('*');
  if (Math.abs(opening) < 0.005) return { bank_account: acct, journal: null };

  const today = new Date().toISOString().slice(0, 10);
  const cur = acct.currency || 'PKR';
  let fxRate = 1;
  if (cur !== 'PKR') {
    if (body.opening_fx_rate !== undefined && body.opening_fx_rate !== null && body.opening_fx_rate !== '') {
      fxRate = Number(body.opening_fx_rate);
      if (!(fxRate > 0)) throw httpError(400, 'opening_fx_rate must be a positive number.');
    } else {
      fxRate = (await fxRates.getRateForDate(cur, today)).rate;
    }
  }
  const pkr = r2(opening * fxRate);

  const [cashCoa, equityCoa] = await Promise.all([
    trx('chart_of_accounts').where({ code: '1000' }).first(),
    trx('chart_of_accounts').where({ code: '3000' }).first(),
  ]);
  if (!cashCoa || !equityCoa) throw httpError(500, "COA 1000 Cash & Bank / 3000 Owner's Equity missing — cannot book the opening balance.");

  const btNo = await nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-', pad: 4 });
  await trx('bank_transactions').insert({
    transaction_no: btNo,
    bank_account_id: acct.id,
    type: opening >= 0 ? 'credit' : 'debit',
    amount: Math.abs(opening),
    currency: cur,
    transaction_date: today,
    reference: 'OB-BANK',
    category: 'Opening Balance',
    counterparty: "Owner's Equity",
    running_balance: opening,
    status: 'posted',
    source: 'opening_balance',
    notes: `Opening balance of ${acct.name}`,
    created_by: userId,
  });

  const fxNote = cur !== 'PKR' ? ` (${cur} ${opening} @ ${fxRate})` : '';
  const journal = await accounting.createJournal(trx, {
    date: today,
    entity: acct.entity || 'general',
    refType: 'opening_balance',
    refNo: `OPEN-BANK-${acct.id}`,
    description: `Opening balance — ${acct.name}${fxNote}`,
    currency: 'PKR',
    fxRate: 1,
    origCurrency: cur !== 'PKR' ? cur : null,
    origFxRate: cur !== 'PKR' ? fxRate : null,
    isAuto: false,
    userId,
    lines: [
      {
        account_id: cashCoa.id, account: cashCoa.name,
        debit: pkr > 0 ? pkr : 0, credit: pkr < 0 ? -pkr : 0,
        narration: `1000 ${cashCoa.name} — opening balance ${acct.name}${fxNote}`,
      },
      {
        account_id: equityCoa.id, account: equityCoa.name,
        debit: pkr < 0 ? -pkr : 0, credit: pkr > 0 ? pkr : 0,
        narration: `3000 ${equityCoa.name} — opening balance ${acct.name}`,
      },
    ],
  });
  await accounting.postJournal(trx, journal.id);
  return { bank_account: acct, journal };
}

module.exports = { updateBankAccount, createBankAccount, EDITABLE, LOCKED_ONCE_USED, BALANCE_MSG };
