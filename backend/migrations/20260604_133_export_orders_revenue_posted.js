/**
 * revenue_posted flag on export_orders.
 *
 * Revenue recognition (DR Export AR / CR Sales) and its matching COGS
 * (DR COGS / CR Finished Rice) fire once, when an order ships. This flag
 * guards against double-posting if the Shipped transition is ever
 * re-driven. Going-forward only — historical shipped orders are left
 * unposted (a retroactive backfill touches prior-period P&L and is a
 * separate, signed-off operation).
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('export_orders'))) return;
  if (await knex.schema.hasColumn('export_orders', 'revenue_posted')) return;
  await knex.schema.alterTable('export_orders', (t) => {
    t.boolean('revenue_posted').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('export_orders'))) return;
  if (await knex.schema.hasColumn('export_orders', 'revenue_posted')) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.dropColumn('revenue_posted');
    });
  }
};
