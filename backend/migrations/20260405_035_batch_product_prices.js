/**
 * Store actual market prices per batch for finished rice and byproducts.
 * These are confirmed by the user when yield is recorded.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('milling_batches', (table) => {
    table.decimal('finished_price_per_mt', 15, 2).nullable();
    table.decimal('broken_price_per_mt', 15, 2).nullable();
    table.decimal('bran_price_per_mt', 15, 2).nullable();
    table.decimal('husk_price_per_mt', 15, 2).nullable();
    table.boolean('prices_confirmed').defaultTo(false);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('milling_batches', (table) => {
    ['finished_price_per_mt', 'broken_price_per_mt', 'bran_price_per_mt', 'husk_price_per_mt', 'prices_confirmed'].forEach(c => table.dropColumn(c));
  });
};
