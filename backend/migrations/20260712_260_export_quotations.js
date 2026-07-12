/**
 * Export Quotations — a pre-order price quote sent to an export customer.
 *
 * A quotation mirrors the core commercial fields of an export order (customer,
 * multi-line items, incoterm, currency, ports, pricing, validity). It has its
 * own lifecycle (Draft → Sent → Accepted / Rejected / Expired) and, once
 * accepted, is converted one-click into a real export_orders row — the convert
 * reuses the export-order create flow, so receivables / FX / doc-checklists are
 * all created exactly as for a directly-created order. converted_order_id links
 * the quote back to the order it produced.
 */
exports.up = async function up(knex) {
  const hasQ = await knex.schema.hasTable('export_quotations');
  if (!hasQ) {
    await knex.schema.createTable('export_quotations', (t) => {
      t.increments('id').primary();
      t.string('quotation_no', 20).notNullable().unique();
      t.integer('customer_id').references('id').inTable('customers');
      t.string('country', 100);
      t.string('status', 20).notNullable().defaultTo('Draft'); // Draft|Sent|Accepted|Rejected|Expired
      t.date('quote_date');
      t.date('valid_until');
      t.string('currency', 10).notNullable().defaultTo('USD');
      t.string('incoterm', 10);
      t.string('destination_port', 255);
      t.string('port_of_loading', 255);
      t.text('payment_terms');
      t.decimal('advance_pct', 5, 2).notNullable().defaultTo(0);
      t.decimal('subtotal', 16, 2).notNullable().defaultTo(0);
      t.decimal('total_amount', 16, 2).notNullable().defaultTo(0);
      t.text('notes');
      // Set null (not cascade): deleting the produced order shouldn't delete the
      // quote's history — just unlink it.
      t.integer('converted_order_id').references('id').inTable('export_orders').onDelete('SET NULL');
      t.integer('created_by').references('id').inTable('users');
      t.timestamps(true, true);
      t.index(['status']);
      t.index(['customer_id']);
    });
  }

  const hasItems = await knex.schema.hasTable('export_quotation_items');
  if (!hasItems) {
    await knex.schema.createTable('export_quotation_items', (t) => {
      t.increments('id').primary();
      t.integer('quotation_id').notNullable().references('id').inTable('export_quotations').onDelete('CASCADE');
      t.integer('line_no').notNullable().defaultTo(1);
      t.integer('product_id').references('id').inTable('products');
      t.string('product_name', 255);
      t.decimal('qty_mt', 12, 3).notNullable().defaultTo(0);
      t.decimal('price_per_mt', 12, 2).notNullable().defaultTo(0);
      t.decimal('line_total', 15, 2).notNullable().defaultTo(0);
      t.string('hs_code', 20);
      t.string('packing', 100);
      t.decimal('bag_size_kg', 8, 3);
      t.integer('bag_count');
      t.string('bag_type', 100);
      t.text('quality_description');
      t.decimal('broken_pct_target', 5, 2);
      t.text('notes');
      t.timestamps(true, true);
      t.index(['quotation_id', 'line_no']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('export_quotation_items');
  await knex.schema.dropTableIfExists('export_quotations');
};
