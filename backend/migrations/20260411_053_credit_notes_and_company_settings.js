/**
 * Migration: Credit Notes table + Company Settings seeds
 *
 * credit_notes tracks price adjustments between shipments for final invoices.
 * Company settings seeds add rex_number, kcci_membership, port_of_loading
 * used by document generation.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('credit_notes', (t) => {
    t.increments('id').primary();
    t.string('credit_note_no', 50).unique().notNullable();
    t.integer('order_id').unsigned().notNullable()
      .references('id').inTable('export_orders').onDelete('CASCADE');
    t.integer('customer_id').unsigned()
      .references('id').inTable('customers');
    t.date('issue_date').notNullable();
    t.string('reason', 255);
    t.decimal('original_price_per_mt', 14, 4);
    t.decimal('adjusted_price_per_mt', 14, 4);
    t.decimal('qty_mt', 12, 2);
    t.decimal('adjustment_amount', 15, 2).notNullable();
    t.string('currency', 10).defaultTo('USD');
    t.string('status', 30).defaultTo('Draft')
      .checkIn(['Draft', 'Issued', 'Applied', 'Cancelled']);
    t.string('reference_invoice', 100);
    t.text('notes');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // Add indexes
  await knex.schema.alterTable('credit_notes', (t) => {
    t.index('order_id');
    t.index('customer_id');
    t.index('status');
  });

  // Seed company-level settings used by document generation
  const existing = await knex('system_settings')
    .whereIn('key', ['rex_number', 'kcci_membership', 'port_of_loading'])
    .select('key');
  const existingKeys = existing.map(r => r.key);

  const toInsert = [
    { key: 'rex_number', value: 'PKREXPK12517208', category: 'company' },
    { key: 'kcci_membership', value: '29463', category: 'company' },
    { key: 'port_of_loading', value: 'Karachi, Pakistan', category: 'company' },
  ].filter(r => !existingKeys.includes(r.key));

  if (toInsert.length > 0) {
    await knex('system_settings').insert(toInsert);
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('credit_notes');
  await knex('system_settings')
    .whereIn('key', ['rex_number', 'kcci_membership', 'port_of_loading'])
    .del();
};
