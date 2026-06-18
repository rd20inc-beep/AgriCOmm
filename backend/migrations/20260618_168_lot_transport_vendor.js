/**
 * Track a lot's transport (freight) cost as a payable owed to a separate hauler
 * rather than folding it into the rice supplier's cost.
 *
 * Adds inventory_lots.transport_vendor_id (the hauler — a supplier). When set with
 * a transport_cost, updateLotCosts upserts a stored 'Transport' payable to that
 * hauler (source_table='lot_transport') and EXCLUDES transport from the lot's
 * landed cost / batch raw cost (transport is no longer part of finished COGS).
 *
 * Idempotent.
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (!(await knex.schema.hasColumn('inventory_lots', 'transport_vendor_id'))) {
    await knex.schema.alterTable('inventory_lots', (t) => {
      t.integer('transport_vendor_id').nullable();
    });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (await knex.schema.hasColumn('inventory_lots', 'transport_vendor_id')) {
    await knex.schema.alterTable('inventory_lots', (t) => t.dropColumn('transport_vendor_id'));
  }
};
