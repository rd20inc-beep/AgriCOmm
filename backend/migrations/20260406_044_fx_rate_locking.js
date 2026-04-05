/**
 * Migration 044: Add FX rate locking to export orders and currency tracking.
 *
 * Changes:
 * 1. export_orders: add booked_fx_rate, fx_rate_source, fx_rate_locked_at
 *    — locks the USD/PKR rate at order creation so later rate changes
 *      don't alter historical profitability
 *
 * 2. export_order_costs: add currency, fx_rate
 *    — makes the currency of each cost line explicit
 *
 * 3. payments: add fx_rate, base_amount_pkr
 *    — tracks conversion rate at payment time
 *
 * 4. Backfill existing data with rate=280 (the rate used when data was created)
 */

exports.up = async function (knex) {
  // 1. export_orders — FX locking
  const hasBookedRate = await knex.schema.hasColumn('export_orders', 'booked_fx_rate');
  if (!hasBookedRate) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.decimal('booked_fx_rate', 10, 4).nullable();
      t.string('fx_rate_source', 20).nullable(); // 'system' | 'manual' | 'market'
      t.timestamp('fx_rate_locked_at').nullable();
    });
    // Backfill existing orders with the rate that was active when they were created
    await knex('export_orders').update({
      booked_fx_rate: 280,
      fx_rate_source: 'system',
      fx_rate_locked_at: knex.fn.now(),
    });
    console.log('  Added booked_fx_rate to export_orders, backfilled with 280');
  }

  // 2. export_order_costs — explicit currency
  const hasCostCurrency = await knex.schema.hasColumn('export_order_costs', 'currency');
  if (!hasCostCurrency) {
    await knex.schema.alterTable('export_order_costs', (t) => {
      t.string('currency', 10).defaultTo('USD');
      t.decimal('fx_rate', 10, 4).nullable();
      t.decimal('base_amount_pkr', 15, 2).nullable();
    });
    // Backfill: all existing export_order_costs are USD (pre-converted at 280)
    await knex('export_order_costs').update({
      currency: 'USD',
      fx_rate: 280,
    });
    // Set base_amount_pkr = amount * 280 for existing rows
    await knex.raw(`
      UPDATE export_order_costs
      SET base_amount_pkr = amount * 280
      WHERE amount > 0
    `);
    console.log('  Added currency/fx_rate/base_amount_pkr to export_order_costs, backfilled');
  }

  // 3. payments — FX tracking
  const hasPayFx = await knex.schema.hasColumn('payments', 'fx_rate');
  if (!hasPayFx) {
    await knex.schema.alterTable('payments', (t) => {
      t.decimal('fx_rate', 10, 4).nullable();
      t.decimal('base_amount_pkr', 15, 2).nullable();
    });
    console.log('  Added fx_rate/base_amount_pkr to payments');
  }

  // 4. receivables — FX tracking
  const hasRecvFx = await knex.schema.hasColumn('receivables', 'fx_rate');
  if (!hasRecvFx) {
    await knex.schema.alterTable('receivables', (t) => {
      t.decimal('fx_rate', 10, 4).nullable();
      t.decimal('base_amount_pkr', 15, 2).nullable();
    });
    // Backfill from order's booked rate
    await knex.raw(`
      UPDATE receivables r
      SET fx_rate = eo.booked_fx_rate,
          base_amount_pkr = r.expected_amount * eo.booked_fx_rate
      FROM export_orders eo
      WHERE r.order_id = eo.id
        AND eo.booked_fx_rate IS NOT NULL
    `);
    console.log('  Added fx_rate/base_amount_pkr to receivables, backfilled from orders');
  }
};

exports.down = async function (knex) {
  const drops = [
    ['export_orders', ['booked_fx_rate', 'fx_rate_source', 'fx_rate_locked_at']],
    ['export_order_costs', ['currency', 'fx_rate', 'base_amount_pkr']],
    ['payments', ['fx_rate', 'base_amount_pkr']],
    ['receivables', ['fx_rate', 'base_amount_pkr']],
  ];
  for (const [table, cols] of drops) {
    for (const col of cols) {
      const has = await knex.schema.hasColumn(table, col);
      if (has) await knex.schema.alterTable(table, t => t.dropColumn(col));
    }
  }
};
