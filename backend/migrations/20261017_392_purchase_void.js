/**
 * P3-11 / INV-09 — void a purchase lot or a mill-store purchase (D-23).
 *
 * A wrong purchase could only be removed by the Super-Admin Danger Zone hard
 * delete. A void keeps the row and records who voided it, when and why; the
 * stock, the payables and the GL come back out by signed deltas (see
 * modules/inventory/purchaseVoid.js and modules/millStore/storePurchaseVoid.js).
 * A voided lot keeps status 'Closed' (already allowed) with qty 0, so no status
 * CHECK changes; voided_at is the marker.
 */
const TABLES = ['inventory_lots', 'mill_purchases'];

exports.up = async function up(knex) {
  for (const table of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.timestamp('voided_at', { useTz: true }).nullable();
      t.integer('voided_by').nullable().references('id').inTable('users').onDelete('RESTRICT');
      t.string('void_reason', 500).nullable();
      t.integer('void_authorized_by').nullable().references('id').inTable('users').onDelete('RESTRICT');
    });
  }
};

exports.down = async function down(knex) {
  for (const table of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('void_authorized_by');
      t.dropColumn('void_reason');
      t.dropColumn('voided_by');
      t.dropColumn('voided_at');
    });
  }
};
