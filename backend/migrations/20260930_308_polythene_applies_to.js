/**
 * Where the polythene goes.
 *
 * A packing run could record polythene but not what it was for. The quantity was
 * always assumed to be one sheet per retail bag, which is only one of the three
 * real cases: a sheet can line the individual bag, line the master, or both. A
 * run of 400 retail bags in 80 masters needs 400 sheets, 80, or 480, and the
 * difference is real money at Rs 12 a sheet.
 *
 * 'bag' is the default because that is what the code assumed before this existed,
 * so every run already recorded keeps the quantity it was entered with.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('mill_packing_logs', (t) => {
    t.string('poly_applies_to', 10).nullable();
  });
  await knex.raw(`
    ALTER TABLE mill_packing_logs
      ADD CONSTRAINT chk_packing_poly_applies_to_valid
      CHECK (poly_applies_to IS NULL OR poly_applies_to IN ('bag', 'master', 'both'))
  `);
  // Only runs that actually used polythene get a value — a run with none is not
  // "applied to bags", it simply has no polythene.
  await knex('mill_packing_logs').where('poly_count', '>', 0).update({ poly_applies_to: 'bag' });
};

exports.down = async (knex) => {
  await knex.raw('ALTER TABLE mill_packing_logs DROP CONSTRAINT IF EXISTS chk_packing_poly_applies_to_valid');
  await knex.schema.alterTable('mill_packing_logs', (t) => {
    t.dropColumn('poly_applies_to');
  });
};
