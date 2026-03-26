/**
 * Migration: Inventory
 */

exports.up = async function (knex) {
  await knex.schema.createTable('inventory_lots', (t) => {
    t.increments('id').primary();
    t.string('lot_no', 50).unique();
    t.string('item_name', 255).notNullable();
    t.string('type', 20);
    t.string('entity', 10);
    t.integer('warehouse_id').unsigned().references('id').inTable('warehouses');
    t.decimal('qty', 15, 2).defaultTo(0);
    t.string('unit', 20).defaultTo('MT');
    t.string('reserved_against', 50);
    t.string('status', 20).defaultTo('Available');
    t.timestamps(true, true);

    t.check("?? IN ('raw','finished','byproduct','packaging')", ['type']);
    t.check("?? IN ('mill','export')", ['entity']);
  });

  await knex.schema.createTable('inventory_movements', (t) => {
    t.increments('id').primary();
    t.integer('lot_id').unsigned().references('id').inTable('inventory_lots');
    t.string('movement_type', 30).notNullable();
    t.decimal('qty', 15, 2).notNullable();
    t.integer('from_warehouse_id').unsigned().references('id').inTable('warehouses');
    t.integer('to_warehouse_id').unsigned().references('id').inTable('warehouses');
    t.string('source_entity', 10);
    t.string('dest_entity', 10);
    t.string('linked_ref', 50);
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('inventory_movements');
  await knex.schema.dropTableIfExists('inventory_lots');
};
