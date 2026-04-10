/**
 * Migration 049 — Add broken grade fields to quality analysis
 *
 * Adds B1, B2, B3, CSR, Short Grain percentage fields to milling_quality_samples
 * so sample and arrival analysis can track detailed broken rice grading.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('milling_quality_samples', (t) => {
    t.decimal('b1_pct', 8, 2).nullable().after('broken');
    t.decimal('b2_pct', 8, 2).nullable().after('b1_pct');
    t.decimal('b3_pct', 8, 2).nullable().after('b2_pct');
    t.decimal('csr_pct', 8, 2).nullable().after('b3_pct');
    t.decimal('short_grain_pct', 8, 2).nullable().after('csr_pct');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('milling_quality_samples', (t) => {
    t.dropColumn('b1_pct');
    t.dropColumn('b2_pct');
    t.dropColumn('b3_pct');
    t.dropColumn('csr_pct');
    t.dropColumn('short_grain_pct');
  });
};
