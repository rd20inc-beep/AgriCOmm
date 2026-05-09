/**
 * Round-34 schema refinement.
 *
 *   1. milling_quality_samples — 8 percentage columns (b1_pct, b2_pct,
 *      b3_pct, csr_pct, short_grain_pct, cobba_pct, nb_pct, ov_pct)
 *      had no range CHECK. A typo entering 105% or -5% would survive.
 *      Lock them all to 0 ≤ x ≤ 100.
 *
 *   2. inventory_lots.payment_status had no whitelist despite being
 *      written in 3 places (createPurchaseLot + recordYield +
 *      adjustments). Code uses lowercase pending/partial/paid; lock
 *      that. (NB: payables.status is title-case — different table,
 *      different convention.)
 *
 *   3. mill_purchases.supplier_id lacks an index. Purchases tab joins
 *      mill_purchases → suppliers on every page load; a btree here
 *      keeps the merge fast as data grows.
 *
 * Idempotent — every CHECK skips with a warning if existing data
 * doesn't match.
 */

const PCT_COLS = ['b1_pct', 'b2_pct', 'b3_pct', 'csr_pct', 'short_grain_pct', 'cobba_pct', 'nb_pct', 'ov_pct'];

async function constraintExists(knex, name) {
  const r = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return r.rowCount > 0;
}

exports.up = async function (knex) {
  // ── Quality % range CHECKs ──────────────────────────────
  if (await knex.schema.hasTable('milling_quality_samples')) {
    for (const col of PCT_COLS) {
      if (!(await knex.schema.hasColumn('milling_quality_samples', col))) continue;
      const conname = `chk_quality_${col}_pct_range`;
      if (await constraintExists(knex, conname)) continue;
      const offenders = await knex('milling_quality_samples')
        .whereNotNull(col)
        .where(function () { this.where(col, '<', 0).orWhere(col, '>', 100); })
        .count('* as n').first();
      if (parseInt(offenders.n, 10) > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[round34] milling_quality_samples.${col}: ${offenders.n} out-of-range rows; skipping CHECK.`);
        continue;
      }
      await knex.raw(
        `ALTER TABLE milling_quality_samples ADD CONSTRAINT "${conname}"
         CHECK ("${col}" IS NULL OR ("${col}" >= 0 AND "${col}" <= 100))`
      );
    }
  }

  // ── inventory_lots.payment_status whitelist (lowercase) ──
  if (await knex.schema.hasTable('inventory_lots')
    && await knex.schema.hasColumn('inventory_lots', 'payment_status')
    && !(await constraintExists(knex, 'chk_inventory_lots_payment_status_valid'))) {
    const allowed = ['pending', 'partial', 'paid'];
    // Normalise to lowercase first so stored values match the CHECK
    await knex.raw(`UPDATE inventory_lots SET payment_status = LOWER(payment_status) WHERE payment_status IS NOT NULL AND payment_status <> LOWER(payment_status)`);
    const stillOff = await knex('inventory_lots')
      .whereNotNull('payment_status')
      .whereNotIn('payment_status', allowed)
      .count('* as n').first();
    if (parseInt(stillOff.n, 10) > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[round34] inventory_lots.payment_status: ${stillOff.n} unknown values; skipping CHECK.`);
      return;
    }
    const list = allowed.map(v => `'${v}'`).join(',');
    await knex.raw(
      `ALTER TABLE inventory_lots ADD CONSTRAINT chk_inventory_lots_payment_status_valid
       CHECK (payment_status IS NULL OR payment_status IN (${list}))`
    );
  }

  // ── Index for the Purchases tab join ────────────────────
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_mill_purchases_supplier_id ON mill_purchases (supplier_id)`);
};

exports.down = async function (knex) {
  for (const col of PCT_COLS) {
    await knex.raw(`ALTER TABLE milling_quality_samples DROP CONSTRAINT IF EXISTS chk_quality_${col}_pct_range`);
  }
  await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS chk_inventory_lots_payment_status_valid`);
  await knex.raw(`DROP INDEX IF EXISTS idx_mill_purchases_supplier_id`);
};
