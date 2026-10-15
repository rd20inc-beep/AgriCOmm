/**
 * P4-02 / MIL-02 — milling_batches.milling_fee_per_kg defaults to 0, not 5.
 *
 * The column was created with DEFAULT 5 (migration 032), and the create paths
 * read 0 as "missing" and stored 5 too. The batch form has not asked for a fee
 * for a long time (milling cost lives on the cost sheet, milling_costs), so
 * every batch carried Rs 5/kg it never had, and Mill Finance subtracted
 * fee × raw kg from its profit. No KPI uses the fee now; the default stops a
 * new row from getting one it was never given.
 *
 * Existing rows are NOT changed here — which stored 5s were defaulted and
 * which (if any) were typed is a reviewed decision: see
 * scripts/detectMillingFeeDefault.js / fixMillingFeeDefault.js and
 * docs/runbooks/milling-fee-default.md. No GL impact either way.
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE milling_batches ALTER COLUMN milling_fee_per_kg SET DEFAULT 0');
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE milling_batches ALTER COLUMN milling_fee_per_kg SET DEFAULT 5');
};
