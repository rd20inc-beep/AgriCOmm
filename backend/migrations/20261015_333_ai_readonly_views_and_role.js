/**
 * P1-05 / D-28 — the AI NL→SQL assistant runs on a least-privilege read-only
 * Postgres role that can see ONLY curated views.
 *
 * 1. Schema `ai_ro` with one view per business table the assistant may query.
 *    Each view lists its columns explicitly, so sensitive columns never reach
 *    the role: no bank account numbers / IBAN / SWIFT, no party contact or
 *    bank details, no driver phones, no sync bookkeeping. Salary rows are
 *    filtered out of expenses / payables / payments / bank lines. There is no
 *    view at all over payroll, mill_workers (portal PIN hash), audit_logs,
 *    system_settings, users, chat_*, email_logs, idempotency_keys or the
 *    approval tables.
 *    The views run with their owner's rights (the app role), so the AI role
 *    needs SELECT on the views only — never on a base table.
 *
 * 2. Roles (cluster-wide, created only if the migrating user may CREATEROLE):
 *      agri_ai_readonly  NOLOGIN group: USAGE on ai_ro + SELECT on its views
 *      agri_ai_query     member of the group; LOGIN with password
 *                        AI_DB_PASSWORD when that env var is set, otherwise
 *                        created NOLOGIN (the AI query feature then answers
 *                        "AI querying is not configured" — it never falls back
 *                        to the app role).
 *    The login role also defaults to read-only transactions, an 8 s statement
 *    timeout and search_path=ai_ro. If the DB user lacks CREATEROLE the
 *    migration LOGS how to finish and does not fail the deploy; run
 *    `node scripts/configureAiDbRole.js` later as a privileged user.
 *
 * NOTE for later migrations: a column used by one of these views cannot be
 * dropped or retyped until the view is dropped/recreated (Postgres dependency
 * rule) — recreate the view in that migration.
 *
 * Schema-drift guard: the fingerprint covers schema `public` only, so ai_ro
 * views and roles do not change schema.baseline.txt.
 */

const SCHEMA = 'ai_ro';
const GROUP_ROLE = 'agri_ai_readonly';
const ROLE_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;
// Kept to characters that need no quoting in a SQL literal (and no knex '?').
const PASSWORD_RE = /^[A-Za-z0-9_\-.~+=:@#%^*!]{12,128}$/;

const SALARY_EXPENSE_IDS = "SELECT id FROM public.business_expenses WHERE category = 'salaries' OR employee_id IS NOT NULL";

// view name → SELECT body. Column lists are explicit on purpose.
const VIEWS = {
  inventory_lots: `SELECT id, lot_no, item_name, type, entity, warehouse_id, product_id, supplier_id, variety, grade, crop_year,
      status, qty, unit, available_qty, reserved_qty, net_weight_kg, gross_weight_kg, total_bags, bag_size_kg,
      rate_per_kg, landed_cost_per_kg, landed_cost_total, purchase_amount, cost_per_unit, total_value,
      sold_weight_kg, damaged_weight_kg, purchase_date, moisture_pct, broken_pct, batch_ref, processing_type,
      ownership, created_at
    FROM public.inventory_lots`,
  lot_transactions: `SELECT id, transaction_no, transaction_date, lot_id, transaction_type, reference_module, reference_id,
      reference_no, warehouse_from_id, warehouse_to_id, quantity_kg, quantity_bags, rate_per_kg, unit_cost, total_cost,
      cost_impact, currency, balance_kg, entity_from, entity_to, remarks, created_at
    FROM public.lot_transactions`,
  inventory_reservations: `SELECT id, lot_id, order_id, item_id, reserved_qty, status, created_at
    FROM public.inventory_reservations`,
  batch_source_lots: `SELECT id, batch_id, lot_id, qty_kg, lot_type, variety, unit_cost_pkr, cost_total_pkr, ratio_pct
    FROM public.batch_source_lots`,
  milling_batches: `SELECT id, batch_no, batch_name, linked_export_order_id, supplier_id, supplier_name, product_id, status,
      processing_type, is_service_milling, client_customer_id, raw_qty_kg, planned_finished_kg, actual_finished_kg,
      milled_qty_kg, broken_kg, bran_kg, husk_kg, wastage_kg, b1_kg, b2_kg, b3_kg, csr_kg, short_grain_kg, choba_kg,
      powder_kg, sweeping_kg, sortex_rejects_kg, yield_pct, raw_cost_total, raw_cost_per_kg_finished,
      milling_cost_per_kg_finished, total_cost_per_kg_finished, purchase_price_per_kg, finished_price_per_kg,
      broken_price_per_kg, bran_price_per_kg, husk_price_per_kg, date_received, completed_at, created_at
    FROM public.milling_batches`,
  milling_output_market_prices: `SELECT id, batch_id, finished_price_per_kg, broken_price_per_kg, bran_price_per_kg,
      husk_price_per_kg, other_output_price_per_kg, confirmed_at
    FROM public.milling_output_market_prices`,
  milling_costs: `SELECT id, batch_id, category, amount, currency, created_at FROM public.milling_costs`,
  milling_quality_samples: `SELECT id, batch_id, analysis_type, moisture, broken, chalky, foreign_matter, discoloration,
      purity, grain_size, price_per_kg, price_per_mt, created_at
    FROM public.milling_quality_samples`,
  milling_vehicle_arrivals: `SELECT id, batch_id, lot_id, vehicle_no, weight_kg, accepted_kg, total_bags, bag_size_kg, arrival_date
    FROM public.milling_vehicle_arrivals`,
  local_sales: `SELECT id, sale_no, sale_date, entity, customer_id, buyer_name, lot_id, lot_no, item_name, item_type,
      quantity_kg, quantity_bags, rate_per_kg, total_amount, currency, payment_mode, payment_status, paid_amount,
      due_amount, due_date, status, dispatched, dispatch_date, cost_per_kg, cogs_total_pkr, gross_profit,
      gross_profit_pkr, margin_pct, sale_group_no, created_at
    FROM public.local_sales`,
  export_orders: `SELECT id, order_no, customer_id, country, product_id, product_name, qty_mt, price_per_mt, currency,
      contract_value, incoterm, advance_pct, advance_expected, advance_received, balance_expected, balance_received,
      status, financial_status, destination_port, port_of_loading, etd, eta, shipment_eta, contract_value_pkr_locked,
      inventory_cogs_total_pkr, gross_profit_pkr, gross_profit_usd, booked_fx_rate, created_at
    FROM public.export_orders`,
  export_order_items: `SELECT id, order_id, line_no, product_id, product_name, qty_mt, price_per_mt, line_total,
      bag_size_kg, bag_count, packing
    FROM public.export_order_items`,
  export_order_costs: `SELECT id, order_id, category, amount, currency, fx_rate, base_amount_pkr, payment_status, paid_amount, created_at
    FROM public.export_order_costs`,
  suppliers: `SELECT id, name, supplier_code, type, country, is_active FROM public.suppliers`,
  customers: `SELECT id, name, customer_type, country, port, currency, payment_terms, credit_limit, is_active
    FROM public.customers`,
  products: `SELECT id, name, code, grade, category, is_byproduct, is_active, reorder_level, hs_code FROM public.products`,
  warehouses: `SELECT id, name, entity, type, is_active FROM public.warehouses`,
  stock_summary: `SELECT entity, type, variety, warehouse_id, COUNT(*) AS lot_count,
      SUM(available_qty) AS available_kg, SUM(reserved_qty) AS reserved_kg
    FROM public.inventory_lots WHERE COALESCE(available_qty, 0) > 0
    GROUP BY entity, type, variety, warehouse_id`,
  receivables: `SELECT id, recv_no, entity, order_id, local_sale_id, customer_id, type, expected_amount, received_amount,
      outstanding, currency, fx_rate, base_amount_pkr, due_date, status, created_at
    FROM public.receivables`,
  payables: `SELECT id, pay_no, entity, category, payable_type, supplier_id, hauler_id, linked_ref, original_amount,
      paid_amount, outstanding, currency, due_date, status, source_table, source_id, created_at
    FROM public.payables
    WHERE category IS DISTINCT FROM 'salaries'
      AND NOT (source_table = 'business_expenses' AND source_id IN (${SALARY_EXPENSE_IDS}))`,
  payments: `SELECT id, payment_no, type, linked_receivable_id, linked_payable_id, local_sale_id, amount, currency,
      payment_method, bank_account_id, payment_date, due_date, status, fx_rate, base_amount_pkr, source_table,
      source_id, cleared, wht_amount, discount_amount, created_at
    FROM public.payments
    WHERE NOT (source_table = 'business_expenses' AND source_id IN (${SALARY_EXPENSE_IDS}))`,
  bank_accounts: `SELECT id, name, type, bank_name, currency, current_balance, entity, is_active FROM public.bank_accounts`,
  bank_transactions: `SELECT id, transaction_no, bank_account_id, type, amount, currency, transaction_date, category,
      status, source, created_at
    FROM public.bank_transactions WHERE category IS DISTINCT FROM 'salaries'`,
  journal_entries: `SELECT id, journal_no, date, entity, ref_type, ref_no, description, status, total_debit, total_credit,
      currency, party_type, party_id, created_at
    FROM public.journal_entries`,
  journal_lines: `SELECT id, journal_id, account_id, account, debit, credit, narration FROM public.journal_lines`,
  chart_of_accounts: `SELECT id, code, name, type, sub_type, parent_id, entity, normal_balance, is_active
    FROM public.chart_of_accounts`,
  business_expenses: `SELECT id, expense_no, expense_type, category, subcategory, amount, currency, amount_pkr,
      supplier_id, vendor_name, expense_date, due_date, description, payment_status, paid_amount, batch_id,
      order_id, created_at
    FROM public.business_expenses WHERE category IS DISTINCT FROM 'salaries' AND employee_id IS NULL`,
  fund_transfers: `SELECT id, transfer_no, direction, from_entity, to_entity, from_account_id, to_account_id, amount,
      currency, amount_pkr, transfer_date, method, status
    FROM public.fund_transfers`,
  purchase_orders: `SELECT id, po_no, supplier_id, entity, product_id, product_name, qty_mt, price_per_mt, currency,
      total_amount, delivery_date, status, created_at
    FROM public.purchase_orders`,
  goods_receipt_notes: `SELECT id, grn_no, po_id, supplier_id, batch_id, warehouse_id, receipt_date, net_weight_mt,
      accepted_qty_mt, rejected_qty_mt, price_per_mt, total_value, currency, status, quality_status
    FROM public.goods_receipt_notes`,
};

const loginRoleName = () => process.env.AI_DB_USER || 'agri_ai_query';

async function roleExists(knex, name) {
  const r = await knex.raw('SELECT 1 FROM pg_roles WHERE rolname = ?', [name]);
  return r.rows.length > 0;
}

async function mayCreateRoles(knex) {
  const r = await knex.raw('SELECT rolsuper OR rolcreaterole AS ok FROM pg_roles WHERE rolname = current_user');
  return !!(r.rows[0] && r.rows[0].ok);
}

/**
 * Idempotently create/refresh the roles and grants. Safe to re-run (used by
 * scripts/configureAiDbRole.js once AI_DB_PASSWORD is set). Never throws for
 * a missing privilege — it logs what a DBA must do and returns a status.
 */
async function ensureAiRoles(knex, { log = console } = {}) {
  const loginRole = loginRoleName();
  if (!ROLE_NAME_RE.test(loginRole)) {
    log.warn(`[ai_ro] AI_DB_USER "${loginRole}" is not a plain role name — AI DB role not configured.`);
    return { configured: false, reason: 'bad_role_name' };
  }
  const password = process.env.AI_DB_PASSWORD || '';
  const canCreate = await mayCreateRoles(knex);

  for (const [name, attrs] of [[GROUP_ROLE, 'NOLOGIN'], [loginRole, 'NOLOGIN']]) {
    if (await roleExists(knex, name)) continue;
    if (!canCreate) {
      log.warn(`[ai_ro] Role ${name} does not exist and the migrating DB user lacks CREATEROLE. `
        + 'AI querying stays disabled. As a superuser run: node scripts/configureAiDbRole.js');
      return { configured: false, reason: 'no_createrole' };
    }
    await knex.raw(`CREATE ROLE ${name} ${attrs} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  }

  // Grants on our own schema/views need no special privilege.
  await knex.raw(`REVOKE ALL ON SCHEMA ${SCHEMA} FROM PUBLIC`);
  await knex.raw(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${GROUP_ROLE}`);
  await knex.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${GROUP_ROLE}`);

  if (!canCreate) {
    log.warn('[ai_ro] Grants refreshed; role attributes/password unchanged (migrating user lacks CREATEROLE).');
    return { configured: false, reason: 'no_createrole' };
  }
  await knex.raw(`GRANT ${GROUP_ROLE} TO ${loginRole}`);
  await knex.raw(`ALTER ROLE ${loginRole} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 5`);
  await knex.raw(`ALTER ROLE ${loginRole} SET default_transaction_read_only = on`);
  await knex.raw(`ALTER ROLE ${loginRole} SET statement_timeout = '8s'`);
  await knex.raw(`ALTER ROLE ${loginRole} SET search_path = ${SCHEMA}`);

  if (!password) {
    log.warn(`[ai_ro] AI_DB_PASSWORD is not set — ${loginRole} left without login; AI querying is not configured.`);
    return { configured: false, reason: 'no_password' };
  }
  if (!PASSWORD_RE.test(password)) {
    log.warn('[ai_ro] AI_DB_PASSWORD must be 12-128 chars of A-Z a-z 0-9 _-.~+=:@#%^*! — login not enabled.');
    return { configured: false, reason: 'bad_password' };
  }
  await knex.raw(`ALTER ROLE ${loginRole} LOGIN PASSWORD '${password}'`);
  return { configured: true };
}

exports.up = async function up(knex) {
  await knex.raw(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  for (const [name, body] of Object.entries(VIEWS)) {
    await knex.raw(`CREATE OR REPLACE VIEW ${SCHEMA}.${name} AS ${body}`);
  }
  await ensureAiRoles(knex);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  // Roles are cluster-wide and may hold grants in another database; dropping
  // is best-effort.
  for (const name of [loginRoleName(), GROUP_ROLE]) {
    if (!ROLE_NAME_RE.test(name)) continue;
    try {
      if (await roleExists(knex, name)) await knex.raw(`DROP ROLE ${name}`);
    } catch (e) {
      console.warn(`[ai_ro] Could not drop role ${name}: ${e.message}`);
    }
  }
};

exports.VIEWS = VIEWS;
exports.SCHEMA = SCHEMA;
exports.GROUP_ROLE = GROUP_ROLE;
exports.ensureAiRoles = ensureAiRoles;
