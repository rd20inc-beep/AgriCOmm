/**
 * P2-17 — a bank row and a fund transfer always name the account that moved.
 *
 * 1. bank_transactions.bank_account_id and fund_transfers.from_account_id /
 *    to_account_id must be set on every NEW or UPDATED row. Added as CHECK
 *    constraints NOT VALID: existing rows are not scanned, so a database that
 *    already holds a NULL (an orphan legacy row) still migrates — the
 *    detection script (scripts/detectBankTieOut.js) counts them and the
 *    runbook (docs/runbooks/bank-tie-out.md) says how to clear them and then
 *    `ALTER TABLE … VALIDATE CONSTRAINT`. The same schema results on every
 *    database, whatever its data.
 * 2. Deleting a bank account that a fund transfer names is refused (RESTRICT)
 *    instead of silently nulling the transfer's account (it was SET NULL), so
 *    a transfer can never lose the account its money moved through. The
 *    bank_transactions / payments FKs are already NO ACTION.
 *
 * down() restores SET NULL and drops the checks.
 */
const CHECKS = [
  ['bank_transactions', 'chk_bank_transactions_account_required', 'bank_account_id IS NOT NULL'],
  ['fund_transfers', 'chk_fund_transfers_from_account_required', 'from_account_id IS NOT NULL'],
  ['fund_transfers', 'chk_fund_transfers_to_account_required', 'to_account_id IS NOT NULL'],
];
const FKS = [
  ['fund_transfers', 'from_account_id', 'fund_transfers_from_account_id_foreign'],
  ['fund_transfers', 'to_account_id', 'fund_transfers_to_account_id_foreign'],
];

async function hasConstraint(knex, name) {
  const r = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [name]);
  return r.rows.length > 0;
}

async function setFk(knex, table, col, name, onDelete) {
  if (await hasConstraint(knex, name)) await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
  await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${col}) REFERENCES bank_accounts(id) ON DELETE ${onDelete}`);
}

exports.up = async function up(knex) {
  for (const [table, name, expr] of CHECKS) {
    if (!(await hasConstraint(knex, name))) {
      await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr}) NOT VALID`);
    }
  }
  for (const [table, col, name] of FKS) await setFk(knex, table, col, name, 'RESTRICT');
};

exports.down = async function down(knex) {
  for (const [table, col, name] of FKS) await setFk(knex, table, col, name, 'SET NULL');
  for (const [table, name] of CHECKS) {
    if (await hasConstraint(knex, name)) await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
  }
};
