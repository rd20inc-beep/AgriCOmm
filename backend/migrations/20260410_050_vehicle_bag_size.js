/**
 * Migration 050 — Add bag_size_kg and total_bags to vehicle arrivals
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('milling_vehicle_arrivals', (t) => {
    t.decimal('bag_size_kg', 8, 2).nullable().after('weight_mt');
    t.integer('total_bags').nullable().after('bag_size_kg');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('milling_vehicle_arrivals', (t) => {
    t.dropColumn('bag_size_kg');
    t.dropColumn('total_bags');
  });
};
