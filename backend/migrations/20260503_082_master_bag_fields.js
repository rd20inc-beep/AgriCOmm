/**
 * Master-bag packing for retail-sized export orders.
 *
 * Business rule: when the bag size is 500g, 1kg, 2kg, 5kg or 10kg
 * (retail consumer sizes), the order requires an outer "master bag"
 * — typically 20kg or 40kg — which holds multiple retail bags for
 * shipping/handling. Larger sizes (25kg+) ship as-is.
 *
 * Adds two columns each on export_orders and export_order_items:
 *   - master_bag_size_kg  numeric(8,2) NULL
 *   - master_bag_type     varchar(100) NULL  (descriptor, e.g. "Carton")
 *
 * No CHECK constraint on the size — UI restricts to {20, 40} but
 * leaving the column open avoids re-migrating if the buyer asks for
 * a 25kg outer.
 *
 * Idempotent.
 */

const TARGETS = [
  ['export_orders'],
  ['export_order_items'],
];

exports.up = async function (knex) {
  for (const [table] of TARGETS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, 'master_bag_size_kg'))) {
      await knex.schema.alterTable(table, (t) => {
        t.decimal('master_bag_size_kg', 8, 2).nullable();
      });
    }
    if (!(await knex.schema.hasColumn(table, 'master_bag_type'))) {
      await knex.schema.alterTable(table, (t) => {
        t.string('master_bag_type', 100).nullable();
      });
    }
  }
};

exports.down = async function (knex) {
  for (const [table] of TARGETS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await knex.schema.hasColumn(table, 'master_bag_type')) {
      await knex.schema.alterTable(table, (t) => t.dropColumn('master_bag_type'));
    }
    if (await knex.schema.hasColumn(table, 'master_bag_size_kg')) {
      await knex.schema.alterTable(table, (t) => t.dropColumn('master_bag_size_kg'));
    }
  }
};
