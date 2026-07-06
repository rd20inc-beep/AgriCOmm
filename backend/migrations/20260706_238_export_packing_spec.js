// Batch 7 · items 1+2 — structured export packing spec: bag material + packing
// type (retail bag / jumbo FIBC / container bulk) + a palletized flag. Pallet
// cost is NOT a column — it is recorded as an `export_order_costs` category row
// ('pallet'), so it flows into the cost breakdown + payables like every other cost.
exports.up = async (knex) => {
  await knex.schema.alterTable('export_orders', (t) => {
    t.string('bag_material', 50).nullable();               // Polythene | Woven | Non-Woven | Cotton
    t.string('packing_type', 20).notNullable().defaultTo('retail'); // retail | jumbo | container
    t.boolean('palletized').notNullable().defaultTo(false);
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('export_orders', (t) => {
    t.dropColumn('bag_material');
    t.dropColumn('packing_type');
    t.dropColumn('palletized');
  });
};
