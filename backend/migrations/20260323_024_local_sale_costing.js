/**
 * Migration: Add costing fields to local_sales table
 * Bridges sale revenue with lot purchase cost for profit calculation.
 */

exports.up = function (knex) {
  return knex.schema.alterTable('local_sales', (table) => {
    table.decimal('cost_per_kg', 15, 4).nullable();
    table.decimal('landed_cost_total', 15, 2).nullable();
    table.decimal('gross_profit', 15, 2).nullable();
    table.decimal('profit_per_kg', 15, 4).nullable();
    table.decimal('margin_pct', 5, 2).nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('local_sales', (table) => {
    table.dropColumn('cost_per_kg');
    table.dropColumn('landed_cost_total');
    table.dropColumn('gross_profit');
    table.dropColumn('profit_per_kg');
    table.dropColumn('margin_pct');
  });
};
