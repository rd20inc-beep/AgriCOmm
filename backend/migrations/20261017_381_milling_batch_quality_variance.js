/**
 * P3-16 / MIL-05: the quality-variance columns the QC screens have always
 * written and read, but that never existed. Hold / Approve / Reject /
 * Renegotiate sent variance_status → Postgres error → 500, and variance_pct
 * was always null so the batch variance panel and the "Variance alerts" KPI
 * never rendered.
 *
 *   variance_status  the QC decision on the sample-vs-arrival difference
 *                    (NULL = no decision yet)
 *   variance_pct     the largest absolute difference, in percentage points,
 *                    between the batch's sample and arrival analysis over the
 *                    compared parameters — maintained by saveQuality
 *                    (modules/milling/qualityVariance.js)
 *
 * Additive. variance_pct is back-filled for batches that already have both
 * analyses, with the same rule (a derived figure, not a correction).
 */
const STATUSES = ['Pending', 'Approved', 'On Hold', 'Renegotiation', 'Rejected'];
// Same list as qualityVariance.VARIANCE_PARAMS.
const PARAMS = ['moisture', 'broken', 'chalky', 'foreign_matter', 'discoloration', 'purity', 'grain_size'];

exports.up = async (knex) => {
  await knex.schema.alterTable('milling_batches', (t) => {
    t.string('variance_status', 20).nullable();
    t.decimal('variance_pct', 8, 2).nullable();
  });
  await knex.raw(`ALTER TABLE milling_batches ADD CONSTRAINT chk_milling_batches_variance_status
    CHECK (variance_status IS NULL OR variance_status IN (${STATUSES.map((s) => `'${s}'`).join(', ')}))`);

  const diffs = PARAMS.map((p) => `ABS(a.${p} - s.${p})`).join(', ');
  await knex.raw(`
    WITH s AS (SELECT DISTINCT ON (batch_id) * FROM milling_quality_samples
                WHERE analysis_type = 'sample' ORDER BY batch_id, created_at DESC),
         a AS (SELECT DISTINCT ON (batch_id) * FROM milling_quality_samples
                WHERE analysis_type = 'arrival' ORDER BY batch_id, created_at DESC)
    UPDATE milling_batches mb
       SET variance_pct = ROUND(COALESCE(GREATEST(${diffs}), 0)::numeric, 2)
      FROM s JOIN a ON a.batch_id = s.batch_id
     WHERE mb.id = s.batch_id`);
};

exports.down = async (knex) => {
  await knex.raw('ALTER TABLE milling_batches DROP CONSTRAINT IF EXISTS chk_milling_batches_variance_status');
  await knex.schema.alterTable('milling_batches', (t) => {
    t.dropColumn('variance_status');
    t.dropColumn('variance_pct');
  });
};
