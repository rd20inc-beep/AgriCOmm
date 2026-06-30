/**
 * Stock-take discrepancy approval — per-line review (#2).
 *
 * Today a stock count is approved as a whole and every counted line's variance
 * is written into inventory in one shot. This adds a per-line REVIEW step so a
 * discrepancy (counted ≠ system) can be individually APPROVED (its adjustment
 * will be applied) or REJECTED (the system stands — no adjustment, the
 * discrepancy is logged). Matched lines (zero variance) need no review.
 *
 * Schema:
 *   stock_count_items.status            + 'Rejected' (was Pending/Counted/Approved/Adjusted)
 *   stock_count_items.reviewed_by       who approved/rejected the line (FK users)
 *   stock_count_items.reviewed_at       when
 *   stock_count_items.review_notes      reason (required on reject)
 *
 * The completion step (approveStockCount) now refuses to finish while any
 * discrepancy line is still un-reviewed, applies only APPROVED variances, and
 * leaves REJECTED lines untouched. Schema-altering → schema.baseline.txt regen.
 * Idempotent.
 */

exports.up = async function up(knex) {
  // ── widen the status CHECK to allow 'Rejected' ──
  await knex.raw(`ALTER TABLE stock_count_items DROP CONSTRAINT IF EXISTS stock_count_items_status_check`);
  await knex.raw(`
    ALTER TABLE stock_count_items ADD CONSTRAINT stock_count_items_status_check
    CHECK (status IS NULL OR status IN ('Pending','Counted','Approved','Adjusted','Rejected'))
  `);

  // ── per-line review trail ──
  await knex.raw(`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS reviewed_by integer REFERENCES users(id)`);
  await knex.raw(`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS reviewed_at timestamptz`);
  await knex.raw(`ALTER TABLE stock_count_items ADD COLUMN IF NOT EXISTS review_notes text`);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE stock_count_items DROP COLUMN IF EXISTS review_notes`);
  await knex.raw(`ALTER TABLE stock_count_items DROP COLUMN IF EXISTS reviewed_at`);
  await knex.raw(`ALTER TABLE stock_count_items DROP COLUMN IF EXISTS reviewed_by`);
  // Restore the original status CHECK (any 'Rejected' rows would block this;
  // acceptable for a down-migration on a dev DB).
  await knex.raw(`ALTER TABLE stock_count_items DROP CONSTRAINT IF EXISTS stock_count_items_status_check`);
  await knex.raw(`
    ALTER TABLE stock_count_items ADD CONSTRAINT stock_count_items_status_check
    CHECK (status IS NULL OR status IN ('Pending','Counted','Approved','Adjusted'))
  `);
};
