/**
 * Small retail bags (≤15 kg) are collected into an outer "master" bag and lined
 * with a polythene sheet. Record the optional master-bag + polythene packaging
 * consumed alongside a packing run so their cost rolls into the finished cost.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('mill_packing_logs', (t) => {
    t.integer('master_bag_item_id').nullable();
    t.decimal('master_bags_count', 14, 2).nullable();
    t.decimal('master_cost', 14, 2).nullable();
    t.integer('poly_item_id').nullable();
    t.decimal('poly_count', 14, 2).nullable();
    t.decimal('poly_cost', 14, 2).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('mill_packing_logs', (t) => {
    t.dropColumn('master_bag_item_id');
    t.dropColumn('master_bags_count');
    t.dropColumn('master_cost');
    t.dropColumn('poly_item_id');
    t.dropColumn('poly_count');
    t.dropColumn('poly_cost');
  });
};
