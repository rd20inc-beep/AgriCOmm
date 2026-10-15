/**
 * Cash tie-out (P2-17) — read-only. For every cash / bank account, three
 * figures that must agree:
 *
 *   balance     bank_accounts.current_balance (what the Cash tab shows)
 *   sub-ledger  Σ POSTED bank_transactions (credit +, debit −), native currency
 *   GL          Σ (debit − credit) of Posted journal lines on the account's own
 *               GL account (bank_accounts.gl_account_id, G-8), in PKR
 *
 *   ledger_drift = balance − sub-ledger. 0 when every move went through the
 *                  single balance writer (shared/bankBalance.js); anything else
 *                  is money the balance holds that no bank row explains.
 *   gl_drift     = balance − GL, for PKR accounts only. A foreign-currency
 *                  account's GL is its PKR value at booked rates, so it is
 *                  shown but not compared (comparable: false).
 *
 * Lines posted straight on the 1000 Cash & Bank control account (before
 * per-account GL, or an account with no GL link) belong to no single account;
 * they are reported once as control.unassigned_gl_pkr.
 *
 * Nothing is corrected here. A drift is fixed by a documented adjustment —
 * a bank row and a journal — never by overwriting a balance
 * (docs/runbooks/bank-tie-out.md).
 */
const db = require('../../config/database');
const { CASH_CONTROL_CODE } = require('../../shared/accountGl');

const TOLERANCE = 0.01;
const num = (v) => parseFloat(v) || 0;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Pure: one account's tie-out row from its three figures. Exported for tests.
 */
function tieOutRow(account, { postedSum = 0, glBalance = null } = {}) {
  const currency = String(account.currency || 'PKR').toUpperCase();
  const balance = round2(num(account.current_balance));
  const subLedger = round2(num(postedSum));
  const ledgerDrift = round2(balance - subLedger);
  const comparable = currency === 'PKR' && glBalance != null;
  const gl = glBalance == null ? null : round2(num(glBalance));
  const glDrift = comparable ? round2(balance - gl) : null;
  const ok = Math.abs(ledgerDrift) <= TOLERANCE && (!comparable || Math.abs(glDrift) <= TOLERANCE);
  return {
    account_id: account.id,
    account_name: account.name,
    currency,
    entity: account.entity || null,
    type: account.type || null,
    is_active: account.is_active !== false,
    gl_account_id: account.gl_account_id || null,
    balance,
    sub_ledger: subLedger,
    ledger_drift: ledgerDrift,
    gl_balance_pkr: gl,
    gl_drift: glDrift,
    comparable,
    ok,
  };
}

/** The full tie-out: { generated_at, ok, drift_count, accounts[], control }. */
async function bankTieOut(knex = db) {
  const accounts = await knex('bank_accounts')
    .select('id', 'name', 'currency', 'entity', 'type', 'is_active', 'gl_account_id', 'current_balance')
    .orderBy('id');

  const posted = await knex('bank_transactions')
    .where({ status: 'posted' })
    .whereNotNull('bank_account_id')
    .groupBy('bank_account_id')
    .select('bank_account_id', knex.raw("SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END) AS s"));
  const postedBy = new Map(posted.map((r) => [String(r.bank_account_id), num(r.s)]));

  const glRows = await knex('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .where('je.status', 'Posted')
    .groupBy('jl.account_id')
    .select('jl.account_id', knex.raw('SUM(jl.debit - jl.credit) AS s'));
  const glBy = new Map(glRows.map((r) => [String(r.account_id), num(r.s)]));

  // Two accounts on one GL account cannot be compared to it one by one.
  const sharedGl = new Set();
  const seen = new Set();
  for (const a of accounts) {
    if (!a.gl_account_id) continue;
    if (seen.has(String(a.gl_account_id))) sharedGl.add(String(a.gl_account_id));
    seen.add(String(a.gl_account_id));
  }

  const rows = accounts.map((a) => tieOutRow(a, {
    postedSum: postedBy.get(String(a.id)) || 0,
    glBalance: a.gl_account_id && !sharedGl.has(String(a.gl_account_id)) ? (glBy.get(String(a.gl_account_id)) || 0) : null,
  }));

  // Bank rows whose account is gone or missing (bank_account_id NULL).
  const orphan = await knex('bank_transactions').whereNull('bank_account_id').count('id as n').first();
  const control = await knex('chart_of_accounts').where({ code: CASH_CONTROL_CODE }).first('id');

  const driftCount = rows.filter((r) => !r.ok).length;
  return {
    generated_at: new Date().toISOString(),
    tolerance: TOLERANCE,
    ok: driftCount === 0,
    drift_count: driftCount,
    accounts: rows,
    control: {
      unassigned_gl_pkr: control ? round2(glBy.get(String(control.id)) || 0) : null,
      accounts_without_gl: accounts.filter((a) => !a.gl_account_id).map((a) => a.id),
      accounts_sharing_gl: accounts.filter((a) => a.gl_account_id && sharedGl.has(String(a.gl_account_id))).map((a) => a.id),
      bank_rows_without_account: parseInt(orphan && orphan.n, 10) || 0,
    },
  };
}

module.exports = { bankTieOut, tieOutRow, TOLERANCE };
