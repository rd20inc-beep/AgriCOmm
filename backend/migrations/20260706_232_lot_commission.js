/**
 * Commission on purchase lots (enhancement Batch 2, item 13).
 *
 * A purchase can carry a broker commission (per bag/katta) that raises the lot's
 * landed cost per KG and is owed to a broker (a supplier record via
 * inventory_lots.broker_id). Persist the per-bag rate and the computed total so
 * the cost sheet + broker payable reconcile. (transport_cost / transport_vendor_id
 * columns already exist.) Idempotent.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (!(await knex.schema.hasColumn('inventory_lots', 'commission_per_bag'))) {
    await knex.schema.alterTable('inventory_lots', (t) => t.decimal('commission_per_bag', 14, 4).nullable().defaultTo(0));
  }
  if (!(await knex.schema.hasColumn('inventory_lots', 'commission_total'))) {
    await knex.schema.alterTable('inventory_lots', (t) => t.decimal('commission_total', 14, 2).nullable().defaultTo(0));
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  for (const col of ['commission_total', 'commission_per_bag']) {
    if (await knex.schema.hasColumn('inventory_lots', col)) {
      await knex.schema.alterTable('inventory_lots', (t) => t.dropColumn(col));
    }
  }
};
