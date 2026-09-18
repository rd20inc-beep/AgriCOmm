/**
 * Master-bag tare weight on export orders.
 *
 * Gross weight on the export documents has to be the weight the shipping line
 * and customs actually see: the rice, PLUS the retail bags it is packed in,
 * PLUS the master bags those are packed into. `bag_weight_gm` already held the
 * retail bag tare; there was nowhere to record the master bag's, so a retail
 * shipment (4,800 x 5 KG bags inside 1,200 x 20 KG masters) printed a gross
 * that silently ignored 1,200 outer bags.
 *
 * Sits next to bag_weight_gm / master_bag_size_kg on the order, per-order and
 * editable, rather than on bag_types — orders store bag_type as free text, not
 * an FK, so there is nothing to inherit a master-data tare through.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('export_orders'))) return;
  if (!(await knex.schema.hasColumn('export_orders', 'master_bag_weight_gm'))) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.decimal('master_bag_weight_gm', 10, 2).nullable();
    });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('export_orders'))) return;
  if (await knex.schema.hasColumn('export_orders', 'master_bag_weight_gm')) {
    await knex.schema.alterTable('export_orders', (t) => { t.dropColumn('master_bag_weight_gm'); });
  }
};
