/**
 * Container ↔ lot linkage (P4c).
 *
 * shipment_containers.lot_number was a free-text field, so "which lots are in
 * this container" was unreliable and unsearchable. Add a real join table so a
 * container can hold one or more inventory lots with a qty/bags split, by FK.
 * lot_number is kept for back-compat (and auto-synced from the selected lots).
 * CASCADE on container delete — updateShipment delete+reinserts containers, so
 * their lot links clean up with them. unique(container_id, lot_id) prevents a
 * lot being listed twice in one container.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('container_lots')) return;
  await knex.schema.createTable('container_lots', (t) => {
    t.increments('id').primary();
    t.integer('container_id').unsigned().notNullable()
      .references('id').inTable('shipment_containers').onDelete('CASCADE');
    t.integer('lot_id').unsigned().notNullable()
      .references('id').inTable('inventory_lots');
    t.decimal('qty_kg', 15, 2).nullable();
    t.integer('bags').nullable();
    t.integer('created_by').nullable();
    t.timestamps(true, true);
    t.unique(['container_id', 'lot_id'], 'uq_container_lots');
    t.index(['lot_id'], 'idx_container_lots_lot');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('container_lots');
};
