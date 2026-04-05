/**
 * Migration 045: Complete FX and rate architecture for multi-currency finance.
 *
 * 1. export_orders: add contract_value_pkr_locked, fx_gain_loss_pkr, current_fx_rate
 * 2. commodity_rate_master: new table for product/by-product/milling rates
 * 3. fx_rates: add current April 2026 rate, add is_active/source_type columns
 * 4. Backfill export_orders PKR locked revenue from contract_value * booked_fx_rate
 */

exports.up = async function (knex) {
  // ── 1. export_orders: PKR revenue + FX gain/loss columns ──
  const hasLockedPkr = await knex.schema.hasColumn('export_orders', 'contract_value_pkr_locked');
  if (!hasLockedPkr) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.decimal('contract_value_pkr_locked', 18, 2).nullable();
      t.decimal('current_fx_rate_to_pkr', 10, 4).nullable();
      t.decimal('current_fx_value_pkr', 18, 2).nullable();
      t.decimal('fx_gain_loss_pkr', 18, 2).defaultTo(0);
    });
    // Backfill: PKR locked = contract_value * booked_fx_rate
    await knex.raw(`
      UPDATE export_orders
      SET contract_value_pkr_locked = contract_value * COALESCE(booked_fx_rate, 280)
      WHERE contract_value IS NOT NULL
    `);
    console.log('  Added PKR locked revenue columns, backfilled');
  }

  // ── 2. commodity_rate_master ──
  const hasCRM = await knex.schema.hasTable('commodity_rate_master');
  if (!hasCRM) {
    await knex.schema.createTable('commodity_rate_master', (t) => {
      t.increments('id').primary();
      t.string('rate_type', 50).notNullable(); // paddy_purchase, finished_rice, broken_rice, bran, husk, milling_cost, packaging_rate, freight_rate, etc.
      t.integer('product_id').nullable().references('id').inTable('products');
      t.string('product_type', 50).nullable(); // 'IRRI-6', '1121 Sella', etc.
      t.string('unit', 20).defaultTo('per_mt'); // per_mt, per_kg, per_bag
      t.string('rate_currency', 10).defaultTo('PKR');
      t.decimal('rate_value', 15, 2).notNullable();
      t.date('effective_date').notNullable();
      t.boolean('is_locked').defaultTo(false);
      t.string('source_reference', 100).nullable(); // batch_no, invoice, market source
      t.text('notes').nullable();
      t.integer('created_by').nullable();
      t.timestamps(true, true);
    });
    console.log('  Created commodity_rate_master table');

    // Seed with common rate types from actual milling data
    const now = new Date().toISOString().split('T')[0];
    await knex('commodity_rate_master').insert([
      { rate_type: 'paddy_purchase', product_type: 'IRRI-6', unit: 'per_mt', rate_currency: 'PKR', rate_value: 56000, effective_date: now, notes: 'Average paddy purchase rate' },
      { rate_type: 'finished_rice', product_type: 'IRRI-6 White', unit: 'per_mt', rate_currency: 'PKR', rate_value: 95000, effective_date: now, notes: 'Finished white rice market rate' },
      { rate_type: 'broken_rice', product_type: 'Broken', unit: 'per_mt', rate_currency: 'PKR', rate_value: 42000, effective_date: now, notes: 'Broken rice market rate' },
      { rate_type: 'bran', product_type: 'Bran', unit: 'per_mt', rate_currency: 'PKR', rate_value: 22400, effective_date: now, notes: 'Rice bran market rate' },
      { rate_type: 'husk', product_type: 'Husk', unit: 'per_mt', rate_currency: 'PKR', rate_value: 8400, effective_date: now, notes: 'Rice husk market rate' },
      { rate_type: 'milling_cost', product_type: null, unit: 'per_mt', rate_currency: 'PKR', rate_value: 3500, effective_date: now, notes: 'Average milling processing cost' },
      { rate_type: 'packaging_rate', product_type: null, unit: 'per_bag', rate_currency: 'PKR', rate_value: 120, effective_date: now, notes: 'Standard 50kg bag cost' },
    ]);
    console.log('  Seeded 7 commodity rates');
  }

  // ── 3. fx_rates: ensure current rate exists + add columns ──
  // Add missing columns to fx_rates (check each individually)
  for (const [col, def] of [['is_active', (t) => t.boolean('is_active').defaultTo(true)], ['source_type', (t) => t.string('source_type', 30).defaultTo('manual')], ['notes', (t) => t.text('notes').nullable()]]) {
    const has = await knex.schema.hasColumn('fx_rates', col);
    if (!has) await knex.schema.alterTable('fx_rates', def);
  }
  // Backfill existing rows
  await knex('fx_rates').whereNull('is_active').update({ is_active: true });
  await knex('fx_rates').whereNull('source_type').update({ source_type: 'manual' });

  // Add April 2026 rate if missing
  const aprRate = await knex('fx_rates')
    .where('from_currency', 'USD')
    .where('effective_date', '>=', '2026-03-01')
    .first();
  if (!aprRate) {
    await knex('fx_rates').insert({
      from_currency: 'USD', to_currency: 'PKR', rate: 280,
      effective_date: '2026-04-01', source: 'system',
      is_active: true, source_type: 'system_default',
    });
    console.log('  Added USD/PKR rate for April 2026');
  }

  // ── 4. fx_gain_loss_ledger (audit table) ──
  const hasFxLedger = await knex.schema.hasTable('fx_gain_loss_ledger');
  if (!hasFxLedger) {
    await knex.schema.createTable('fx_gain_loss_ledger', (t) => {
      t.increments('id').primary();
      t.integer('export_order_id').references('id').inTable('export_orders');
      t.string('currency_code', 10).notNullable();
      t.decimal('foreign_amount', 18, 4).notNullable();
      t.decimal('locked_rate', 10, 4).notNullable();
      t.decimal('current_rate', 10, 4).notNullable();
      t.decimal('gain_loss_pkr', 18, 2).notNullable();
      t.timestamp('calculated_at').defaultTo(knex.fn.now());
      t.string('calculation_basis', 30); // 'settlement', 'reporting', 'month_end'
    });
    console.log('  Created fx_gain_loss_ledger table');
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('fx_gain_loss_ledger');
  await knex.schema.dropTableIfExists('commodity_rate_master');

  const cols = ['contract_value_pkr_locked', 'current_fx_rate_to_pkr', 'current_fx_value_pkr', 'fx_gain_loss_pkr'];
  for (const col of cols) {
    const has = await knex.schema.hasColumn('export_orders', col);
    if (has) await knex.schema.alterTable('export_orders', t => t.dropColumn(col));
  }

  for (const col of ['is_active', 'source_type', 'notes', 'created_by']) {
    const has = await knex.schema.hasColumn('fx_rates', col);
    if (has) await knex.schema.alterTable('fx_rates', t => t.dropColumn(col));
  }
};
