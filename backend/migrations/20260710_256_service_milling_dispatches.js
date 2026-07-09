// Service Milling — Phase 2: dispatch client-owned finished/by-product stock
// back to the client (physical handover).
//
// This is NOT a sale — the client already owns the rice; we only charge a
// separate service fee (billed via service_milling_invoices). A dispatch simply
// draws down the client-owned lot (postMovement 'service_dispatch', no GL / no
// COGS / no revenue) and records the handover here. The batch's
// service_lot_status advances to Partially / Fully Dispatched from remaining
// available_qty.

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('service_milling_dispatches'))) {
    await knex.schema.createTable('service_milling_dispatches', (t) => {
      t.increments('id').primary();
      t.string('dispatch_no', 40).notNullable().unique();
      t.integer('service_batch_id').notNullable().references('id').inTable('milling_batches');
      t.integer('client_customer_id').references('id').inTable('customers');
      t.integer('lot_id').notNullable().references('id').inTable('inventory_lots');
      t.decimal('qty_kg', 14, 3).notNullable().defaultTo(0);
      t.integer('bag_count');
      t.string('vehicle_no', 60);
      t.string('driver_name', 120);
      t.date('dispatch_date').notNullable().defaultTo(knex.fn.now());
      t.text('notes');
      t.integer('created_by');
      t.timestamps(true, true);
      t.index('service_batch_id');
      t.index('lot_id');
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('service_milling_dispatches');
};
