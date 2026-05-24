/**
 * Favorite flag for suppliers + customers.
 *
 * Operators work with the same 5-10 entries day-in day-out across a
 * catalog that's potentially hundreds of rows long. A star toggle in
 * the admin tabs lets them pin the frequently-used ones; the entries
 * sort to the top of admin lists AND of the searchable dropdowns in
 * the Purchase Lot drawer.
 *
 * Idempotent.
 */

const TABLES = ['suppliers', 'customers'];

exports.up = async function (knex) {
  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await knex.schema.hasColumn(table, 'is_favorite')) continue;
    await knex.schema.alterTable(table, (t) => {
      t.boolean('is_favorite').notNullable().defaultTo(false);
    });
    // Partial index so "favorites first" sorts can skip the bulk of the
    // table when only a handful are starred.
    const idxName = `idx_${table}_is_favorite_true`;
    const has = await knex.raw(
      `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?`,
      [idxName]
    );
    if (!has.rows.length) {
      await knex.raw(`CREATE INDEX ${idxName} ON ${table} (id) WHERE is_favorite = true`);
    }
  }
};

exports.down = async function (knex) {
  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(`DROP INDEX IF EXISTS idx_${table}_is_favorite_true`);
    if (await knex.schema.hasColumn(table, 'is_favorite')) {
      await knex.schema.alterTable(table, (t) => { t.dropColumn('is_favorite'); });
    }
  }
};
