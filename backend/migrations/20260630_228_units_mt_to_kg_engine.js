/**
 * Phase 5c — atomic MT→KG storage conversion for the stock + milling-costing
 * ENGINE. Quantities become KG, prices become per-KG. This is a pure
 * re-expression of units: every physical KG and every PKR value is preserved
 * (the reconciliation harness, scripts/unitReconciliation.js, gates it).
 *
 * Three kinds of column:
 *   - value-only (×1000, KEEP name): the unit-agnostic quantity columns whose
 *     name doesn't say MT (inventory_lots.qty/available_qty/reserved_qty/
 *     milling_reserved_qty, inventory_movements.qty, inventory_reservations.reserved_qty).
 *   - rename qty *_mt → *_kg (×1000): batch_source_lots.qty_mt, internal_transfers.qty_mt,
 *     milling_vehicle_arrivals.weight_mt, all milling_batches.*_mt yield columns.
 *   - rename price *_price_per_mt → *_price_per_kg (÷1000): milling_batches +
 *     milling_output_market_prices price columns.
 *
 * Out of scope (stay MT — contract/document/analytical): export orders,
 * procurement docs, and all peripheral analytical tables; a ×1000 conversion
 * happens at the document↔engine boundary in code. milling_quality_samples
 * already has price_per_kg, so its price_per_mt is left as-is.
 *
 * CHECK-constraint names keep their _mt suffix (PG auto-repoints the column);
 * the schema baseline tracks names, so only COL lines move. knex runs this once
 * (no in-run idempotency needed); hasColumn guards are defensive.
 */

const VALUE_ONLY = [
  ['inventory_lots', 'qty'],
  ['inventory_lots', 'available_qty'],
  ['inventory_lots', 'reserved_qty'],
  ['inventory_lots', 'milling_reserved_qty'],
  ['inventory_movements', 'qty'],
  ['inventory_reservations', 'reserved_qty'],
];

// [table, fromCol, toCol] — qty renames (×1000)
const QTY_RENAMES = [
  ['batch_source_lots', 'qty_mt', 'qty_kg'],
  ['internal_transfers', 'qty_mt', 'qty_kg'],
  ['milling_vehicle_arrivals', 'weight_mt', 'weight_kg'],
  ...['raw_qty', 'planned_finished', 'actual_finished', 'broken', 'bran', 'husk',
    'wastage', 'b1', 'b2', 'b3', 'csr', 'short_grain', 'sortex_rejects', 'powder',
    'sweeping', 'choba', 'ov', 'stone'].map((b) => ['milling_batches', `${b}_mt`, `${b}_kg`]),
];

// price renames (÷1000)
const PRICE_RENAMES = [
  ...['finished', 'broken', 'bran', 'husk', 'sortex_rejects', 'b1', 'b2', 'b3',
    'csr', 'short_grain', 'powder', 'sweeping', 'choba'].map((b) => ['milling_batches', `${b}_price_per_mt`, `${b}_price_per_kg`]),
  ...['finished', 'broken', 'bran', 'husk', 'other_output'].map((b) => ['milling_output_market_prices', `${b}_price_per_mt`, `${b}_price_per_kg`]),
];

exports.up = async function up(knex) {
  // 1. value-only ×1000 (existing MT rows → KG; column keeps its name)
  for (const [table, col] of VALUE_ONLY) {
    if (await knex.schema.hasColumn(table, col)) {
      await knex(table).update({ [col]: knex.raw(`COALESCE(??, 0) * 1000`, [col]) });
    }
  }
  // 2. qty renames + ×1000
  for (const [table, from, to] of QTY_RENAMES) {
    if (await knex.schema.hasColumn(table, from) && !(await knex.schema.hasColumn(table, to))) {
      await knex.schema.alterTable(table, (t) => t.renameColumn(from, to));
      await knex(table).update({ [to]: knex.raw(`COALESCE(??, 0) * 1000`, [to]) });
    }
  }
  // 3. price renames + ÷1000
  for (const [table, from, to] of PRICE_RENAMES) {
    if (await knex.schema.hasColumn(table, from) && !(await knex.schema.hasColumn(table, to))) {
      await knex.schema.alterTable(table, (t) => t.renameColumn(from, to));
      await knex(table).update({ [to]: knex.raw(`?? / 1000`, [to]) }); // NULL stays NULL
    }
  }
};

exports.down = async function down(knex) {
  for (const [table, from, to] of PRICE_RENAMES) {
    if (await knex.schema.hasColumn(table, to) && !(await knex.schema.hasColumn(table, from))) {
      await knex(table).update({ [to]: knex.raw(`?? * 1000`, [to]) });
      await knex.schema.alterTable(table, (t) => t.renameColumn(to, from));
    }
  }
  for (const [table, from, to] of QTY_RENAMES) {
    if (await knex.schema.hasColumn(table, to) && !(await knex.schema.hasColumn(table, from))) {
      await knex(table).update({ [to]: knex.raw(`COALESCE(??, 0) / 1000`, [to]) });
      await knex.schema.alterTable(table, (t) => t.renameColumn(to, from));
    }
  }
  for (const [table, col] of VALUE_ONLY) {
    if (await knex.schema.hasColumn(table, col)) {
      await knex(table).update({ [col]: knex.raw(`COALESCE(??, 0) / 1000`, [col]) });
    }
  }
};
