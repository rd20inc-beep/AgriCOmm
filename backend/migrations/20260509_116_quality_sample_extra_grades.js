/**
 * Add Pakistani-rice grading fields to milling_quality_samples.
 *
 * The Quality tab on a milling batch needs to capture six per-grade
 * percentages: B-1, B-2, Cobba, C.S, N.B, O.V. Three of those columns
 * already exist (b1_pct, b2_pct, csr_pct from earlier rounds); the
 * remaining three (cobba_pct, nb_pct, ov_pct) are added here.
 *
 * All NUMERIC(5,2) — same shape as the other percentage columns —
 * and nullable so old rows aren't backfilled.
 *
 * Idempotent.
 */

const COLS = [
  ['cobba_pct', 'Cobba %'],
  ['nb_pct', 'N.B %'],
  ['ov_pct', 'O.V %'],
];

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('milling_quality_samples'))) return;
  for (const [col] of COLS) {
    if (!(await knex.schema.hasColumn('milling_quality_samples', col))) {
      await knex.schema.alterTable('milling_quality_samples', (t) => {
        t.decimal(col, 5, 2).nullable();
      });
    }
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('milling_quality_samples'))) return;
  for (const [col] of COLS) {
    if (await knex.schema.hasColumn('milling_quality_samples', col)) {
      await knex.schema.alterTable('milling_quality_samples', (t) => { t.dropColumn(col); });
    }
  }
};
