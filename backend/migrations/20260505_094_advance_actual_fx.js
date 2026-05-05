/**
 * Capture the FX rate actually used when an advance is received.
 *
 * The order already stores booked_fx_rate (set at create / FX-lock
 * time) and contract_value_pkr_locked. But the rate that actually
 * applied when the advance hit our bank is usually different — bank
 * spread, market move, or an outright agreed rate with the buyer.
 * Knowing the booked-vs-actual delta is the source of FX gain/loss.
 *
 * Per the new flow ("the only point where $→PKR is applied"), the
 * confirm-advance modal asks the user for the actual rate, and we
 * lock it on the order.
 *
 * - advance_fx_rate     : numeric(10,4)  rate USD→PKR at receipt
 * - advance_received_pkr: numeric(15,2)  PKR equivalent banked
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('export_orders'))) return;
  if (!(await knex.schema.hasColumn('export_orders', 'advance_fx_rate'))) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.decimal('advance_fx_rate', 10, 4).nullable();
    });
  }
  if (!(await knex.schema.hasColumn('export_orders', 'advance_received_pkr'))) {
    await knex.schema.alterTable('export_orders', (t) => {
      t.decimal('advance_received_pkr', 15, 2).nullable();
    });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('export_orders'))) return;
  if (await knex.schema.hasColumn('export_orders', 'advance_received_pkr')) {
    await knex.schema.alterTable('export_orders', (t) => t.dropColumn('advance_received_pkr'));
  }
  if (await knex.schema.hasColumn('export_orders', 'advance_fx_rate')) {
    await knex.schema.alterTable('export_orders', (t) => t.dropColumn('advance_fx_rate'));
  }
};
