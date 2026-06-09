/**
 * Schema refinement round 40 — constrain chart_of_accounts.type to the six
 * account classes the system actually uses.
 *
 * The GL account type drives every statement (trial balance, P&L, balance
 * sheet) and the posting engine, but it was an unconstrained string. Code only
 * ever writes Asset / Liability / Equity / Revenue / Expense / COGS
 * (grep-verified across the accounting module + creating migration), and prod
 * holds exactly those six with 0 violations — so the whitelist can't break
 * anything while stopping a typo'd account class from corrupting the reports.
 *
 * NULL stays allowed; idempotent (guarded by a pg_constraint check).
 */

const CHECK = 'chart_of_accounts_type_check';
const TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense', 'COGS'];

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('chart_of_accounts', 'type'))) return;
  const exists = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [CHECK]);
  if (exists.rows.length) return;
  const list = TYPES.map((t) => `'${t}'`).join(', ');
  await knex.raw(
    `ALTER TABLE chart_of_accounts ADD CONSTRAINT ${CHECK}
     CHECK (type IS NULL OR type IN (${list}))`
  );
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE chart_of_accounts DROP CONSTRAINT IF EXISTS ${CHECK}`);
};
