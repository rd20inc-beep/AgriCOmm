/**
 * Hard-reserve source lots at batch start (P6a).
 *
 * Until now starting a milling batch only set milling_status='In Milling' on the
 * source lots — it did NOT lower available_qty, so the same un-yielded quantity
 * could still be sold or allocated to export before yield. Add a milling
 * reservation bucket so availability = qty − reserved_qty − milling_reserved_qty.
 * Set at batch start, released at yield (as the qty is consumed) and at batch
 * delete/cancel. Default 0 — existing lots are unaffected.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('inventory_lots', 'milling_reserved_qty')) return;
  await knex.schema.alterTable('inventory_lots', (t) => {
    t.decimal('milling_reserved_qty', 15, 2).notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('inventory_lots', 'milling_reserved_qty'))) return;
  await knex.schema.alterTable('inventory_lots', (t) => {
    t.dropColumn('milling_reserved_qty');
  });
};
