/**
 * Favorite flag for bank accounts.
 *
 * Same idea as the suppliers/customers favorites (mig 131): a house runs
 * every payment through the same two or three accounts while the catalog
 * carries a dozen (per-entity cash, LC, old accounts). Starring them in
 * Admin ▸ Bank Accounts floats them to the top of the admin list AND of
 * every payment dropdown, which all read the one /api/finance/bank-accounts
 * list.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('bank_accounts'))) return;
  if (!(await knex.schema.hasColumn('bank_accounts', 'is_favorite'))) {
    await knex.schema.alterTable('bank_accounts', (t) => {
      t.boolean('is_favorite').notNullable().defaultTo(false);
    });
  }
  // Partial index, mirroring mig 131 — "favorites first" sorts skip the
  // bulk of the table when only a handful are starred.
  const idxName = 'idx_bank_accounts_is_favorite_true';
  const has = await knex.raw(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?`,
    [idxName]
  );
  if (!has.rows.length) {
    await knex.raw(`CREATE INDEX ${idxName} ON bank_accounts (id) WHERE is_favorite = true`);
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('bank_accounts'))) return;
  await knex.raw('DROP INDEX IF EXISTS idx_bank_accounts_is_favorite_true');
  if (await knex.schema.hasColumn('bank_accounts', 'is_favorite')) {
    await knex.schema.alterTable('bank_accounts', (t) => { t.dropColumn('is_favorite'); });
  }
};
