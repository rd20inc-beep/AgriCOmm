/**
 * Add `notes` column to inventory_lots.
 *
 * Bug surfaced by an end-to-end probe: createPurchaseLot writes
 * `notes`, but the column never existed (only `quality_notes`).
 * Every Create Lot from the wizard 500s on insert. Add a free-form
 * notes column so the existing controller path works.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (await knex.schema.hasColumn('inventory_lots', 'notes')) return;
  await knex.schema.alterTable('inventory_lots', (t) => {
    t.text('notes').nullable();
  });
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('inventory_lots', 'notes')) {
    await knex.schema.alterTable('inventory_lots', (t) => { t.dropColumn('notes'); });
  }
};
