/**
 * Per-grade broken price columns on milling_batches.
 *
 * The Yield modal now collects per-grade output (B1, B2, B3, CSR,
 * Short Grain) as first-class quantities — each becomes its own
 * inventory lot. Pricing was still a single broken_price_per_mt
 * applied to all grades, which collapses the operator's actual
 * pricing intent.
 *
 * Adding b1/b2/b3/csr/short_grain price_per_mt columns lets the
 * Confirm Product Prices dialog ask for each grade individually,
 * and recordMillingOutput uses the per-grade price for that grade's
 * lot when present (falls back to broken_price_per_mt for batches
 * confirmed before this change).
 *
 * Idempotent.
 */

const COLS = [
  'b1_price_per_mt',
  'b2_price_per_mt',
  'b3_price_per_mt',
  'csr_price_per_mt',
  'short_grain_price_per_mt',
];

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  for (const col of COLS) {
    if (!(await knex.schema.hasColumn('milling_batches', col))) {
      await knex.schema.alterTable('milling_batches', (t) => {
        t.decimal(col, 12, 2).nullable();
      });
      const chk = `chk_mb_${col}_nonneg`;
      const exists = await knex.raw(
        `SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = ?`, [chk]
      );
      if (!exists.rows.length) {
        await knex.raw(`ALTER TABLE milling_batches ADD CONSTRAINT ${chk} CHECK (${col} IS NULL OR ${col} >= 0)`);
      }
    }
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  for (const col of COLS) {
    const chk = `chk_mb_${col}_nonneg`;
    await knex.raw(`ALTER TABLE milling_batches DROP CONSTRAINT IF EXISTS ${chk}`);
    if (await knex.schema.hasColumn('milling_batches', col)) {
      await knex.schema.alterTable('milling_batches', (t) => { t.dropColumn(col); });
    }
  }
};
