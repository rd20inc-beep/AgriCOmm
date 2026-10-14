/**
 * READ-ONLY cash tie-out check (P2-17). Writes nothing.
 *
 *   node scripts/detectBankTieOut.js
 *
 * For every cash / bank account: balance vs Σ posted bank_transactions vs the
 * account's own GL (src/modules/finance/bankTieOut.js — the same code the
 * /api/finance/bank-tie-out report and the health check run). Also counts the
 * rows migration 363's NOT VALID checks would reject (bank rows / fund
 * transfers with no account) — those must be zero before VALIDATE CONSTRAINT.
 *
 * Output is COUNTS and account IDS only — no names, no amounts.
 * Runbook: docs/runbooks/bank-tie-out.md
 */
const db = require('../src/config/database');
const { bankTieOut } = require('../src/modules/finance/bankTieOut');

async function main() {
  const t = await bankTieOut(db);
  const ledger = t.accounts.filter((a) => Math.abs(a.ledger_drift) > t.tolerance).map((a) => a.account_id);
  const gl = t.accounts.filter((a) => a.comparable && Math.abs(a.gl_drift) > t.tolerance).map((a) => a.account_id);
  const nullFrom = await db('fund_transfers').whereNull('from_account_id').count('id as n').first();
  const nullTo = await db('fund_transfers').whereNull('to_account_id').count('id as n').first();

  console.log(`accounts checked:                         ${t.accounts.length}`);
  console.log(`balance ≠ Σ posted bank rows (ids):       ${ledger.length} ${JSON.stringify(ledger)}`);
  console.log(`PKR balance ≠ own GL account (ids):       ${gl.length} ${JSON.stringify(gl)}`);
  console.log(`non-PKR accounts (GL not comparable):     ${t.accounts.filter((a) => !a.comparable).length}`);
  console.log(`accounts with no GL account (ids):        ${JSON.stringify(t.control.accounts_without_gl)}`);
  console.log(`accounts sharing one GL account (ids):    ${JSON.stringify(t.control.accounts_sharing_gl)}`);
  console.log(`bank rows with no account:                ${t.control.bank_rows_without_account}`);
  console.log(`fund transfers with no from / to account: ${parseInt(nullFrom.n, 10) || 0} / ${parseInt(nullTo.n, 10) || 0}`);
  console.log(`lines posted on the 1000 control itself:  ${t.control.unassigned_gl_pkr == null ? 'n/a' : (Math.abs(t.control.unassigned_gl_pkr) > t.tolerance ? 'yes' : 'none')}`);
  console.log(t.ok ? 'RESULT: ties out' : `RESULT: ${t.drift_count} account(s) drifting`);
}

main()
  .then(() => db.destroy())
  .catch((e) => { console.error('tie-out check failed:', e.message); return db.destroy().then(() => process.exit(1)); });
