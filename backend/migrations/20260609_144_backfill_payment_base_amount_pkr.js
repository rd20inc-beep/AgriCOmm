/**
 * Backfill payments.base_amount_pkr where it was left 0/NULL.
 *
 * Local-sale receipts (PL-*) were inserted without base_amount_pkr, so the
 * locked PKR value was 0. Anything reading base_amount_pkr directly (rather
 * than re-normalizing) under-counted those receipts. The write path now stamps
 * it; this fixes the rows already in the table.
 *
 * PKR payments → base = amount. Foreign payments → base = amount × fx_rate
 * (fallback to amount when no rate). Idempotent: only touches rows still 0/NULL.
 */

exports.up = async function (knex) {
  await knex.raw(`
    UPDATE payments
    SET base_amount_pkr = CASE
      WHEN COALESCE(currency, 'PKR') = 'PKR' THEN amount
      ELSE amount * COALESCE(NULLIF(fx_rate, 0), 1)
    END
    WHERE base_amount_pkr IS NULL OR base_amount_pkr = 0
  `);
};

exports.down = async function () {
  // No-op: backfilled values are indistinguishable from originally-stamped ones
  // and are correct, so there's nothing safe (or useful) to revert.
};
