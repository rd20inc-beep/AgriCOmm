/**
 * Round-29 schema refinement.
 *
 * Audit found three classes of loose constraints:
 *
 *   1. Money columns (paid_amount, outstanding, received_amount,
 *      base_amount_pkr, totals) on payables/receivables/payments/
 *      local_sales/journal_entries had no CHECK against negatives.
 *      A buggy partial payment could push outstanding < 0 silently.
 *
 *   2. Currency columns on the multi-currency tables
 *      (receivables, payables, payments, export_orders,
 *      journal_entries, journal_lines) had no whitelist — a typo
 *      could let 'pkr' or 'EUR ' coexist with 'PKR'.
 *
 *   3. inventory_movements.movement_type had no whitelist; the code
 *      uses a fixed enum but the DB would accept any string.
 *
 * Conservative — only constrain columns that are clearly in scope.
 * bank_accounts.current_balance left alone (overdrafts are real).
 *
 * Idempotent — every CHECK floors the offending data first, then
 * verifies zero offenders before adding the constraint.
 */

const NONNEG_TARGETS = [
  // Receivables
  ['receivables', 'received_amount'],
  ['receivables', 'outstanding'],
  ['receivables', 'base_amount_pkr'],
  // Payables
  ['payables', 'paid_amount'],
  ['payables', 'outstanding'],
  // Payments
  ['payments', 'base_amount_pkr'],
  // Local sales
  ['local_sales', 'total_amount'],
  ['local_sales', 'paid_amount'],
  ['local_sales', 'due_amount'],
  ['local_sales', 'cogs_total_pkr'],
  ['local_sales', 'landed_cost_total'],
  // Journal totals
  ['journal_entries', 'total_credit'],
  ['journal_entries', 'total_debit'],
  // Export orders
  ['export_orders', 'balance_expected'],
  ['export_orders', 'balance_received'],
  ['export_orders', 'inventory_cogs_total_pkr'],
  ['export_orders', 'total_loose_weight_kg'],
  // Milling batches
  ['milling_batches', 'raw_cost_total'],
  ['milling_batches', 'total_cost_per_kg_finished'],
];

const CURRENCY_WHITELIST = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'CNY'];
const CURRENCY_TABLES = [
  'receivables', 'payables', 'payments',
  'export_orders', 'journal_entries', 'journal_lines',
];

const MOVEMENT_TYPE_WHITELIST = [
  'purchase_receipt', 'production_issue', 'production_yield',
  'transfer_in', 'transfer_out', 'internal_receipt', 'internal_issue',
  'adjustment_plus', 'adjustment_minus',
  'reservation_create', 'reservation_release',
  'sale_dispatch', 'return_in',
];

async function constraintExists(knex, name) {
  const r = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return r.rowCount > 0;
}

async function addNonneg(knex, table, column) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) return;
  const conname = `chk_${table}_${column}_nonneg`;
  if (await constraintExists(knex, conname)) return;
  // Floor any offenders to zero. In a healthy DB there are none.
  const offenders = await knex(table).where(column, '<', 0).count('* as n').first();
  if (parseInt(offenders.n, 10) > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[round29] ${table}.${column} has ${offenders.n} negative rows; flooring.`);
    await knex(table).where(column, '<', 0).update({ [column]: 0 });
  }
  await knex.raw(`ALTER TABLE "${table}" ADD CONSTRAINT "${conname}" CHECK ("${column}" >= 0)`);
}

async function addCurrencyWhitelist(knex, table) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, 'currency'))) return;
  const conname = `chk_${table}_currency_valid`;
  if (await constraintExists(knex, conname)) return;
  // Normalize: trim + uppercase any existing values so they match the whitelist
  await knex.raw(`UPDATE "${table}" SET currency = UPPER(TRIM(currency)) WHERE currency IS NOT NULL`);
  // Are there any offenders left?
  const offenders = await knex(table).whereNotNull('currency').whereNotIn('currency', CURRENCY_WHITELIST).count('* as n').first();
  if (parseInt(offenders.n, 10) > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[round29] ${table}.currency has ${offenders.n} unknown values; skipping whitelist CHECK.`);
    return;
  }
  const list = CURRENCY_WHITELIST.map(c => `'${c}'`).join(',');
  await knex.raw(`ALTER TABLE "${table}" ADD CONSTRAINT "${conname}" CHECK (currency IS NULL OR currency IN (${list}))`);
}

exports.up = async function (knex) {
  for (const [t, c] of NONNEG_TARGETS) {
    await addNonneg(knex, t, c);
  }
  for (const t of CURRENCY_TABLES) {
    await addCurrencyWhitelist(knex, t);
  }

  // inventory_movements.movement_type whitelist
  if (await knex.schema.hasTable('inventory_movements')
    && await knex.schema.hasColumn('inventory_movements', 'movement_type')) {
    if (!(await constraintExists(knex, 'chk_inventory_movements_type_valid'))) {
      const offenders = await knex('inventory_movements')
        .whereNotIn('movement_type', MOVEMENT_TYPE_WHITELIST).count('* as n').first();
      if (parseInt(offenders.n, 10) === 0) {
        const list = MOVEMENT_TYPE_WHITELIST.map(c => `'${c}'`).join(',');
        await knex.raw(
          `ALTER TABLE inventory_movements ADD CONSTRAINT chk_inventory_movements_type_valid
           CHECK (movement_type IN (${list}))`
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[round29] inventory_movements.movement_type has ${offenders.n} unknown values; skipping CHECK.`);
      }
    }
  }
};

exports.down = async function (knex) {
  for (const [t, c] of NONNEG_TARGETS) {
    await knex.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS chk_${t}_${c}_nonneg`);
  }
  for (const t of CURRENCY_TABLES) {
    await knex.raw(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS chk_${t}_currency_valid`);
  }
  await knex.raw(`ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS chk_inventory_movements_type_valid`);
};
