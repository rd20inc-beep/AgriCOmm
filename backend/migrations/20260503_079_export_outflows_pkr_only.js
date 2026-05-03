/**
 * Business rule: outflow payments on an export order are always in PKR.
 *
 * Inflows from the customer (advance + balance) stay in the order's foreign
 * currency (USD/EUR/GBP). But everything we pay out — rice procurement,
 * milling fee, bags, transport, fumigation, inspection, loading, customs,
 * commission, freight, etc. — is paid to local Pakistani vendors in PKR.
 *
 * Today the export_order_costs table defaulted to USD and held mixed
 * currencies, which forced finance.service.js to do an awkward sanity-check
 * CASE expression to convert each row.
 *
 * This migration:
 *   1. Converts every existing USD cost row into PKR by multiplying by
 *      the order's booked_fx_rate (or the legacy 280 default if null).
 *   2. Changes the column default from 'USD' to 'PKR' so the
 *      cost-skeleton inserts on new orders, and the addCost handler that
 *      doesn't pass currency, both produce PKR rows.
 *
 * Idempotent: the conversion only runs on rows where currency != 'PKR',
 * so re-running has no effect.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('export_order_costs'))) return;
  if (!(await knex.schema.hasColumn('export_order_costs', 'currency'))) return;

  // 1. Convert non-PKR rows in place: amount becomes amount × fx_rate.
  //    Done in a single SQL UPDATE for atomicity.
  const before = await knex('export_order_costs')
    .whereNot('currency', 'PKR')
    .count('* as n')
    .sum('amount as t');
  const beforeCount = parseInt(before[0].n, 10);
  if (beforeCount > 0) {
    await knex.raw(`
      UPDATE export_order_costs eoc
         SET amount   = ROUND((eoc.amount * COALESCE(eo.booked_fx_rate, 280))::numeric, 2),
             currency = 'PKR',
             updated_at = NOW()
        FROM export_orders eo
       WHERE eoc.order_id = eo.id
         AND eoc.currency <> 'PKR'
    `);
    console.log(`[079] Converted ${beforeCount} export_order_costs rows from non-PKR to PKR (was sum=${before[0].t})`);
  }

  // 2. Change the column default. Drop existing default, set to PKR.
  //    NOT NULL stays — column was already NOT NULL.
  await knex.raw(`ALTER TABLE export_order_costs ALTER COLUMN currency SET DEFAULT 'PKR'`);
};

exports.down = async function (knex) {
  // Don't auto-revert the conversion (would lose data fidelity if FX has
  // moved). Just restore the old default for new inserts.
  await knex.raw(`ALTER TABLE export_order_costs ALTER COLUMN currency SET DEFAULT 'USD'`);
};
