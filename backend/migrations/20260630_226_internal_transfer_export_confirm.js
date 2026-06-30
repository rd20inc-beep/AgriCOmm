/**
 * Internal transfer — export confirmation (#3).
 *
 * The Mill→Export internal transfer already deducts mill stock, creates the
 * export lot, auto-reserves it against the order and posts both-entity journals
 * AT CREATION (see finance.controller.createInternalTransfer / transferToExport).
 * This adds a lightweight lifecycle CONFIRM step: an in-transit transfer can be
 * marked Exported once the goods are confirmed dispatched on the export side.
 * Confirmation is a STATUS transition only — it does NOT move stock or post
 * journals again (that would double-count). These columns record who/when for
 * the transfer-detail timeline.
 *
 * Schema-altering → schema.baseline.txt regen. Idempotent.
 */
exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS confirmed_at timestamptz`);
  await knex.raw(`ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS confirmed_by integer REFERENCES users(id)`);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE internal_transfers DROP COLUMN IF EXISTS confirmed_by`);
  await knex.raw(`ALTER TABLE internal_transfers DROP COLUMN IF EXISTS confirmed_at`);
};
