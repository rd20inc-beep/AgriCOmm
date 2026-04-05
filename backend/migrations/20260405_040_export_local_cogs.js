/**
 * Phase 5: Add COGS columns to export_orders and local_sales
 * for exact lot-based cost tracking.
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable('export_orders', (table) => {
      table.decimal('inventory_cogs_total_pkr', 15, 2).nullable();
      table.decimal('inventory_cogs_per_mt_pkr', 15, 2).nullable();
      table.decimal('gross_profit_pkr', 15, 2).nullable();
      table.decimal('gross_profit_usd', 15, 2).nullable();
      table.boolean('cost_locked_at_dispatch').defaultTo(false);
    })
    .alterTable('local_sales', (table) => {
      table.decimal('cogs_total_pkr', 15, 2).nullable();
      table.decimal('cogs_per_kg', 15, 4).nullable();
      table.decimal('gross_profit_pkr', 15, 2).nullable();
      table.boolean('cost_locked_at_dispatch').defaultTo(false);
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('export_orders', (table) => {
      ['inventory_cogs_total_pkr', 'inventory_cogs_per_mt_pkr', 'gross_profit_pkr', 'gross_profit_usd', 'cost_locked_at_dispatch'].forEach(c => table.dropColumn(c));
    })
    .alterTable('local_sales', (table) => {
      ['cogs_total_pkr', 'cogs_per_kg', 'gross_profit_pkr', 'cost_locked_at_dispatch'].forEach(c => table.dropColumn(c));
    });
};
