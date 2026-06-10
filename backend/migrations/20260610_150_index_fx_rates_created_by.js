/**
 * Index fx_rates.created_by — the one foreign-key column left without a
 * supporting index (it carries a created_by FK on prod that the FK-index round
 * 137 missed). Restores the "every FK is indexed" invariant. Idempotent.
 */

exports.up = async function (knex) {
  if (await knex.schema.hasColumn('fx_rates', 'created_by')) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_fx_rates_created_by ON fx_rates(created_by)`);
  }
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_fx_rates_created_by`);
};
