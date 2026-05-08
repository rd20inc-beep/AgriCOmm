/**
 * Round-30 schema refinement.
 *
 * Audit found:
 *
 *   1. 15 additional money/qty columns on procurement, expenses,
 *      mill purchases, FX rates etc. lacking a nonneg CHECK. Round
 *      29 covered the financial ledger; this round covers the
 *      operational tables.
 *
 *   2. local_sales.status and local_sales.payment_status had no
 *      whitelist despite being part of an active state machine.
 *
 *   3. customers.email and suppliers.email contain duplicate values
 *      in seed data (2+2 pairs). Skipping the unique constraint
 *      until those are deduped manually.
 *
 * Idempotent — every CHECK floors offenders before adding.
 */

const NONNEG_TARGETS = [
  // Procurement / GRN
  ['purchase_orders', 'qty_mt'],
  ['purchase_orders', 'price_per_mt'],
  ['purchase_orders', 'total_amount'],
  ['goods_receipt_notes', 'accepted_qty_mt'],
  ['goods_receipt_notes', 'rejected_qty_mt'],
  ['goods_receipt_notes', 'price_per_mt'],
  ['goods_receipt_notes', 'total_value'],
  // Mill purchases
  ['mill_purchases', 'total_amount'],
  ['mill_purchase_items', 'cost_per_unit'],
  // Costs
  ['business_expenses', 'amount'],
  ['export_order_costs', 'amount'],
  // Quality / pricing
  ['milling_quality_samples', 'price_per_mt'],
  // FX & advances
  ['fx_rates', 'rate'],
  ['advance_payments', 'amount'],
  ['advance_payments', 'allocated_amount'],
];

const LOCAL_SALES_STATUS = ['Draft', 'Pending', 'Completed', 'Cancelled', 'Voided', 'Returned'];
const LOCAL_SALES_PAYMENT_STATUS = ['Unpaid', 'Partial', 'Paid', 'Credit', 'Refunded'];

async function constraintExists(knex, name) {
  const r = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return r.rowCount > 0;
}

async function addNonneg(knex, table, column) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) return;
  const conname = `chk_${table}_${column}_nonneg`;
  if (await constraintExists(knex, conname)) return;
  const offenders = await knex(table).where(column, '<', 0).count('* as n').first();
  if (parseInt(offenders.n, 10) > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[round30] ${table}.${column} has ${offenders.n} negative rows; flooring.`);
    await knex(table).where(column, '<', 0).update({ [column]: 0 });
  }
  // fx_rates.rate must be > 0, not just >= 0; same for purchase price/qty when set
  const op = (table === 'fx_rates' && column === 'rate') ? '>' : '>=';
  await knex.raw(`ALTER TABLE "${table}" ADD CONSTRAINT "${conname}" CHECK ("${column}" IS NULL OR "${column}" ${op} 0)`);
}

async function addStatusWhitelist(knex, table, column, allowed, conname) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) return;
  if (await constraintExists(knex, conname)) return;
  // Are any rows out of the allowed set?
  const offenders = await knex(table).whereNotNull(column).whereNotIn(column, allowed).count('* as n').first();
  if (parseInt(offenders.n, 10) > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[round30] ${table}.${column} has ${offenders.n} unknown values; skipping whitelist CHECK.`);
    return;
  }
  const list = allowed.map(v => `'${v}'`).join(',');
  await knex.raw(
    `ALTER TABLE "${table}" ADD CONSTRAINT "${conname}"
     CHECK ("${column}" IS NULL OR "${column}" IN (${list}))`
  );
}

exports.up = async function (knex) {
  for (const [t, c] of NONNEG_TARGETS) {
    await addNonneg(knex, t, c);
  }
  await addStatusWhitelist(knex, 'local_sales', 'status', LOCAL_SALES_STATUS, 'chk_local_sales_status_valid');
  await addStatusWhitelist(knex, 'local_sales', 'payment_status', LOCAL_SALES_PAYMENT_STATUS, 'chk_local_sales_payment_status_valid');
};

exports.down = async function (knex) {
  for (const [t, c] of NONNEG_TARGETS) {
    await knex.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS chk_${t}_${c}_nonneg`);
  }
  await knex.raw(`ALTER TABLE local_sales DROP CONSTRAINT IF EXISTS chk_local_sales_status_valid`);
  await knex.raw(`ALTER TABLE local_sales DROP CONSTRAINT IF EXISTS chk_local_sales_payment_status_valid`);
};
