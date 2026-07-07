// P6c-B: drop the retired inventory_movements table.
//
// It was a redundant KG mirror of the canonical lot_transactions ledger — every
// row twinned (verified on prod: 77 == 77 rows, and each legacy production_issue
// row has a matching milling_issue lot_transactions twin with quantity_kg =
// -qty). In the same PR every writer, reader, deleter and hard-delete stock
// reversal was repointed onto lot_transactions (signed quantity_kg), the
// stock-count variance writer was routed through postMovement (closing a gap
// where it wrote no canonical ledger row), and the danger-zone batch-consume
// reversal's ×1000 net_weight_kg bug was fixed. No data is lost — it lives in
// lot_transactions (a JSON snapshot of the table was also captured pre-drop).
//
// down() recreates the (empty) structure for migration symmetry only; the code no
// longer writes this table, so a rollback leaves it inert.

exports.up = async (knex) => {
  await knex.schema.dropTableIfExists('inventory_movements');
};

exports.down = async (knex) => {
  if (await knex.schema.hasTable('inventory_movements')) return;
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
    t.decimal('cost_per_unit', 15, 4);
    t.decimal('total_cost', 18, 2);
    t.string('currency', 8).defaultTo('PKR');
    t.integer('batch_id').unsigned();
    t.integer('order_id').unsigned();
    t.integer('transfer_id').unsigned();
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};
