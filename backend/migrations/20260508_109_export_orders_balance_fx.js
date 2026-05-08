/**
 * Symmetric balance-leg FX columns on export_orders.
 *
 * Round 094 added advance_fx_rate + advance_received_pkr so the
 * advance leg of a foreign-currency order is locked to PKR at
 * receipt time. The balance leg was still using
 * order.advance_fx_rate || order.booked_fx_rate as a fallback.
 *
 * The user wants to be prompted for the FX rate at every confirm
 * (advance and balance), so we need first-class storage:
 *
 *   - balance_fx_rate       NUMERIC(10,4) — rate the bank applied
 *                                            on the balance credit
 *   - balance_received_pkr  NUMERIC(15,2) — confirmedAmount × rate
 *
 * Both nullable on existing rows (the historical balance receipts
 * happened before this knob existed). New confirmations write both.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('export_orders'))) return;
  if (!(await knex.schema.hasColumn('export_orders', 'balance_fx_rate'))) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.decimal('balance_fx_rate', 10, 4).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('export_orders', 'balance_received_pkr'))) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.decimal('balance_received_pkr', 15, 2).nullable();
    });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('export_orders'))) return;
  if (await knex.schema.hasColumn('export_orders', 'balance_received_pkr')) {
    await knex.schema.alterTable('export_orders', (t) => { t.dropColumn('balance_received_pkr'); });
  }
  if (await knex.schema.hasColumn('export_orders', 'balance_fx_rate')) {
    await knex.schema.alterTable('export_orders', (t) => { t.dropColumn('balance_fx_rate'); });
  }
};
