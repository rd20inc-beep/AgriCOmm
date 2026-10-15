/**
 * P3-05 (INV-41 / MIL-22 / MIL-24): katta value moves with katta stock.
 *
 * mill_packing_logs.katta_cost_mode — when a run's KATTA was costed:
 *   'pack'  the run itself booked the katta (DR 6000 / CR 1250) for its full
 *           count, though the stock only moves at the yield reconcile. Every
 *           run recorded before this migration.
 *   'yield' the run books no katta; the yield reconcile books exactly what it
 *           draws, when it draws it. Every new run.
 *
 * mill_stock_movements.valuation — what a katta-reconcile movement did to the
 * store's VALUE (NULL on every other movement and on reconcile rows written
 * before this migration):
 *   'zero'     no value (freed sacks; by-weight packing) — the item's value is
 *              kept and its average re-spread over the new quantity
 *   'gl'       at average cost, booked to 1250 by this reconcile
 *   'prepaid'  at average cost, booked to 1250 earlier by a 'pack' run
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('mill_packing_logs', (t) => {
    t.string('katta_cost_mode', 10).nullable();
  });
  await knex('mill_packing_logs').update({ katta_cost_mode: 'pack' });
  await knex.raw("ALTER TABLE mill_packing_logs ALTER COLUMN katta_cost_mode SET DEFAULT 'yield'");
  await knex.raw('ALTER TABLE mill_packing_logs ALTER COLUMN katta_cost_mode SET NOT NULL');
  await knex.raw(`
    ALTER TABLE mill_packing_logs ADD CONSTRAINT chk_mill_packing_logs_katta_cost_mode_valid
    CHECK (katta_cost_mode IN ('pack', 'yield'))
  `);

  await knex.schema.alterTable('mill_stock_movements', (t) => {
    t.string('valuation', 10).nullable();
  });
  await knex.raw(`
    ALTER TABLE mill_stock_movements ADD CONSTRAINT chk_mill_stock_movements_valuation_valid
    CHECK (valuation IS NULL OR valuation IN ('zero', 'gl', 'prepaid'))
  `);
};

exports.down = async (knex) => {
  await knex.raw('ALTER TABLE mill_stock_movements DROP CONSTRAINT IF EXISTS chk_mill_stock_movements_valuation_valid');
  await knex.schema.alterTable('mill_stock_movements', (t) => { t.dropColumn('valuation'); });
  await knex.raw('ALTER TABLE mill_packing_logs DROP CONSTRAINT IF EXISTS chk_mill_packing_logs_katta_cost_mode_valid');
  await knex.schema.alterTable('mill_packing_logs', (t) => { t.dropColumn('katta_cost_mode'); });
};
