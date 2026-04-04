/**
 * Mill cost decomposition: track milling fee, raw cost component,
 * and milling cost component separately on batches and finished lots.
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable('milling_batches', (table) => {
      table.decimal('milling_fee_per_kg', 10, 2).nullable().defaultTo(5);
      table.decimal('raw_cost_total', 15, 2).nullable();
      table.decimal('raw_cost_per_kg_finished', 15, 4).nullable();
      table.decimal('milling_cost_per_kg_finished', 15, 4).nullable();
      table.decimal('total_cost_per_kg_finished', 15, 4).nullable();
    })
    .alterTable('inventory_lots', (table) => {
      table.decimal('raw_cost_component', 15, 4).nullable();
      table.decimal('milling_cost_component', 15, 4).nullable();
      table.string('milling_status', 30).nullable(); // 'In Milling', 'Consumed', null
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('milling_batches', (table) => {
      ['milling_fee_per_kg', 'raw_cost_total', 'raw_cost_per_kg_finished',
       'milling_cost_per_kg_finished', 'total_cost_per_kg_finished'].forEach(c => table.dropColumn(c));
    })
    .alterTable('inventory_lots', (table) => {
      ['raw_cost_component', 'milling_cost_component', 'milling_status'].forEach(c => table.dropColumn(c));
    });
};
