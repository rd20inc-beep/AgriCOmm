/**
 * Extended quality fields on inventory_lots.
 *
 * inventory_lots already has moisture_pct, broken_pct, sortex_status,
 * whiteness, and quality_notes columns. The Purchase Lot drawer +
 * Add Vehicle modal now collect the full Pakistani-rice grade panel
 * (B1, B2, B3, CSR, Short Grain, Cobba, N.B, O.V) plus chalky, foreign
 * matter, purity, etc. — too many to keep adding as columns.
 *
 * Store them in jsonb the same way we did for milling_vehicle_arrivals
 * in migration 124.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (await knex.schema.hasColumn('inventory_lots', 'quality_json')) return;
  await knex.schema.alterTable('inventory_lots', (t) => {
    t.jsonb('quality_json').nullable();
  });
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (!(await knex.schema.hasColumn('inventory_lots', 'quality_json'))) return;
  await knex.schema.alterTable('inventory_lots', (t) => {
    t.dropColumn('quality_json');
  });
};
