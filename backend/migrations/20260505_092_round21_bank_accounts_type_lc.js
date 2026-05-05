/**
 * Round-21: bank_accounts.type CHECK should allow 'lc'.
 *
 * The original CHECK constraint allowed { bank, cash, mobile_money }.
 * The Admin → Bank Accounts UI exposes an 'lc' option (Letter of
 * Credit account — common for export businesses). Picking it would
 * silently 23514 the create with a CHECK violation.
 *
 * Replaces the constraint with one that allows the full set actually
 * used by the application: bank, cash, lc, mobile_money.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('bank_accounts'))) return;
  await knex.raw(`ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_type_check`);
  await knex.raw(`
    ALTER TABLE bank_accounts
      ADD CONSTRAINT bank_accounts_type_check
      CHECK (type IN ('bank', 'cash', 'lc', 'mobile_money'))
  `);
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('bank_accounts'))) return;
  await knex.raw(`ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS bank_accounts_type_check`);
  // Restore the original 3-value set.
  await knex.raw(`
    ALTER TABLE bank_accounts
      ADD CONSTRAINT bank_accounts_type_check
      CHECK (type IN ('bank', 'cash', 'mobile_money'))
  `);
};
