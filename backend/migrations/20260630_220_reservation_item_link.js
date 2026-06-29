/**
 * Per-line export reservation linkage (P4b).
 *
 * Reservations have only linked an order (inventory_reservations.order_id), so
 * for a multi-product proforma there was no way to say "this lot serves line 2".
 * Add a nullable item_id → export_order_items so an allocation can be tied to a
 * specific order line. Nullable + SET NULL on delete: existing/legacy
 * reservations and order-wide allocations stay valid (null = order-wide), and
 * deleting an order line just unlinks the reservation rather than cascading.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('inventory_reservations', 'item_id')) return;
  await knex.schema.alterTable('inventory_reservations', (t) => {
    t.integer('item_id').unsigned().nullable()
      .references('id').inTable('export_order_items').onDelete('SET NULL');
    t.index(['item_id'], 'idx_inv_resv_item');
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('inventory_reservations', 'item_id'))) return;
  await knex.schema.alterTable('inventory_reservations', (t) => {
    t.dropColumn('item_id');
  });
};
