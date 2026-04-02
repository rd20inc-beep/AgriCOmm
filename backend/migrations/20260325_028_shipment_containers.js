/**
 * Migration: Shipment Containers
 * Normalizes export shipment containers into a child table.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('shipment_containers', (t) => {
    t.increments('id').primary();
    t.integer('order_id').unsigned().notNullable().references('id').inTable('export_orders').onDelete('CASCADE');
    t.integer('sequence_no').notNullable().defaultTo(1);
    t.string('container_no', 50).notNullable();
    t.string('seal_no', 50);
    t.string('lot_number', 100);
    t.integer('bags_count');
    t.decimal('gross_weight_kg', 15, 2).defaultTo(0);
    t.decimal('net_weight_kg', 15, 2).defaultTo(0);
    t.decimal('tare_weight_kg', 10, 2);
    t.string('container_type', 20).defaultTo('20ft');
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);

    t.unique(['order_id', 'sequence_no']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('shipment_containers');
};
