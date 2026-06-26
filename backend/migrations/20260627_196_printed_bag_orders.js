/**
 * Printed Bags procurement for export orders.
 *
 * When an export order needs printed / branded bags, the team orders them from a
 * bag vendor (a supplier). Each order is a full procurement record: bag type,
 * vendor, quantity, unit cost, printing design, and an Ordered -> Received status.
 * The money side is booked exactly like an export-order cost — a 1:1 row in
 * `payables` (source_table='printed_bag_orders') plus a GL bill (Dr Operating
 * Expenses / Cr Supplier Payable, entity 'export') — so it settles through the
 * normal Pay flow and shows on the vendor's statement.
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('printed_bag_orders');
  if (exists) return;
  await knex.schema.createTable('printed_bag_orders', (t) => {
    t.increments('id').primary();
    t.string('pbo_no').notNullable().unique();          // PBO-0001
    t.integer('order_id').notNullable()
      .references('id').inTable('export_orders').onDelete('CASCADE');
    t.integer('bag_type_id').nullable()
      .references('id').inTable('bag_types').onDelete('SET NULL');
    t.string('bag_type_name').nullable();               // snapshot of the bag type
    t.decimal('bag_size_kg', 10, 2).nullable();
    t.string('printing').nullable();                    // Plain / Buyer Logo / ...
    t.string('brand_marking').nullable();
    t.integer('vendor_id').nullable()
      .references('id').inTable('suppliers').onDelete('SET NULL');
    t.integer('quantity').notNullable().defaultTo(0);   // number of bags ordered
    t.decimal('unit_cost', 14, 4).notNullable().defaultTo(0); // PKR per bag
    t.decimal('total_amount', 16, 2).notNullable().defaultTo(0); // PKR
    t.string('currency', 8).notNullable().defaultTo('PKR');
    t.string('status', 24).notNullable().defaultTo('Ordered'); // Ordered | Received | Cancelled
    t.integer('received_qty').nullable();
    t.date('ordered_date').nullable();
    t.date('received_date').nullable();
    // Payment mirror — kept in lock-step with the linked payable so payPurchase
    // (source='printed_bag') can settle it like any other purchase source.
    t.decimal('paid_amount', 16, 2).notNullable().defaultTo(0);
    t.string('payment_status', 16).notNullable().defaultTo('Unpaid'); // Unpaid | Partial | Paid
    t.text('notes').nullable();
    t.integer('created_by').nullable();
    t.timestamps(true, true);
    t.index(['order_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('printed_bag_orders');
};
