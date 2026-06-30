/**
 * AI-assisted features (opt-in via OPENAI_API_KEY). Three endpoints:
 *   POST /api/ai/query     — natural-language report query (NL → read-only SQL → rows)
 *   POST /api/ai/draft     — draft a customer/supplier email from their ledger
 *   GET  /api/ai/anomalies — flag payroll/GL/stock/cash anomalies
 *   GET  /api/ai/status    — whether AI is configured
 *
 * Every action endpoint no-ops gracefully (aiEnabled:false) when no key is set,
 * so the UI shows a "configure AI" state instead of erroring.
 */
const express = require('express');

const router = express.Router();
const db = require('../../config/database');
const config = require('../../config');
const ai = require('./ai.service');
const accountingService = require('../accounting/accounting.service');
const { denyRoles } = require('../../middleware/rbac');

// The free-form NL→SQL query (and the ledger/anomaly endpoints) can surface
// finance data, so the finance-free Mill Operator is blocked. Additive — only
// this role is affected; /status stays open so the UI can show its state.
const noFinanceForOperator = denyRoles('Mill Operator');

const OFF = { success: true, data: { aiEnabled: false, message: 'AI is off. Set OPENAI_API_KEY in the server environment to enable AI features.' } };

router.get('/status', (req, res) => {
  res.json({ success: true, data: { enabled: ai.enabled(), model: ai.enabled() ? config.ai.model : null } });
});

// ── Curated, annotated schema for text-to-SQL ──────────────────────────────
// Only these core business tables are exposed to the model. Columns are read live
// from information_schema (so they never drift), but the table set is an allowlist:
// dead/analytical/system/auth tables are deliberately omitted — both to focus the
// model on the right tables and to keep sensitive data out of its reach. Each entry
// is a one-line purpose hint that materially improves the SQL the model writes.
const CURATED = {
  // Inventory & lots
  inventory_lots: 'Current stock lots. qty/available_qty/reserved_qty in KG; rate_per_kg & landed_cost_per_kg in PKR/kg; type=raw|finished|byproduct; entity=mill|export; variety=rice type; supplier_id→suppliers.',
  lot_transactions: 'Per-lot stock ledger (purchases, milling issues/receipts, sales). quantity_kg, rate_per_kg, total_cost (PKR); transaction_type.',
  inventory_movements: 'Stock movement log; qty in KG.',
  inventory_reservations: 'Soft reservations against lots; reserved_qty in KG.',
  batch_source_lots: 'Raw lots consumed by a milling batch; qty_kg.',
  // Milling
  milling_batches: 'Milling runs. raw_qty_kg, actual_finished_kg, broken_kg & per-grade *_kg; yield_pct; *_price_per_kg (PKR/kg); raw_cost_per_kg_finished/total_cost_per_kg_finished; supplier_id/supplier_name; status (Completed/In Progress/…).',
  milling_output_market_prices: 'Recorded selling prices per batch (finished/broken/… _price_per_kg in PKR/kg).',
  milling_costs: 'Milling cost lines per batch (category, amount in PKR).',
  milling_quality_samples: 'Quality grade samples per batch.',
  milling_vehicle_arrivals: 'Trucks delivering raw rice to a batch; weight_kg.',
  // Sales & export
  local_sales: 'Domestic sales (a row IS the invoice). quantity_kg, rate_per_kg, total (PKR); customer_id; payment_method; sale_group_no groups multi-item sales.',
  export_orders: 'Export contracts. qty_mt in METRIC TONNES (×1000=kg); contract_value & price_per_mt usually USD; customer_id; country; status.',
  export_order_items: 'Line items on an export order.',
  export_order_costs: 'Cost lines on an export order (amount in PKR).',
  // Parties & products
  suppliers: 'Suppliers (name, type, country).',
  customers: 'Customers (name, customer_type=local|export, country).',
  products: 'Products / rice varieties (name, category).',
  // Finance / GL
  journal_entries: "GL journal headers. status — use 'Posted'; journal_no; entry_date; entity.",
  journal_lines: 'GL lines. journal_id→journal_entries.id; account_id→chart_of_accounts.id; debit & credit are separate columns (PKR).',
  chart_of_accounts: 'GL accounts (code, name, type).',
  payables: 'Amounts owed to suppliers/vendors. outstanding & amount (PKR); due_date; source_table/source_id (no name column — join via source).',
  payments: 'Recorded payments (made/received).',
  bank_accounts: 'Cash & bank accounts; current_balance (PKR); type (incl. cash).',
  bank_transactions: "Bank/cash ledger; type=credit|debit; status='posted'.",
  business_expenses: 'Operating expenses; amount_pkr; category; expense_date; vendor_name.',
  fund_transfers: 'Head-Office ⇄ Mill money transfers.',
  // Payroll
  mill_workers: 'Mill employees (name, type daily|salaried, wage/salary).',
  mill_payroll_runs: 'Monthly payroll runs (period, pay_date, net_total, employee_count).',
  mill_payroll_lines: 'Per-employee payroll line within a run.',
  mill_attendance: 'Daily attendance register.',
  mill_worker_advances: 'Salary advances to workers.',
  // Procurement
  purchase_orders: 'Purchase orders (price_per_mt — doc, per MT).',
  goods_receipt_notes: 'Goods receipts against POs (accepted_qty_mt/rejected_qty_mt — MT).',
};

const CONVENTIONS = [
  'CONVENTIONS (read carefully):',
  '- Quantities are in KILOGRAMS: every column ending _kg, plus inventory_lots.qty/available_qty/reserved_qty and inventory_movements.qty. EXCEPTION: export_orders/purchase_orders/goods_receipt_notes use *_mt in metric TONNES (×1000 for kg).',
  '- Money is PKR unless a currency column says otherwise; export_orders.contract_value/price_per_mt are usually USD.',
  '- Per-kg prices are columns ending _price_per_kg or rate_per_kg.',
  "- Financials/trial balance: join journal_lines.journal_id = journal_entries.id and filter journal_entries.status = 'Posted'; net = SUM(debit) - SUM(credit).",
  '- Domestic sales = local_sales; export sales = export_orders. There is no generic "sales" or "invoices" table (a sale row IS the invoice).',
  '- Current stock on hand = inventory_lots (SUM(available_qty)); full history = lot_transactions.',
  '- Transaction tables store supplier_id/customer_id, NOT names — join suppliers/customers by id.',
  "- Text/status values are Capitalized (e.g. 'Completed', 'Posted', 'Available'); match names with ILIKE '%term%'.",
].join('\n');

let _schema = null;
async function schemaContext() {
  if (_schema) return _schema;
  const names = Object.keys(CURATED);
  const rows = await db.raw(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY(?)
     ORDER BY table_name, ordinal_position`, [names]);
  const byTable = {};
  for (const r of rows.rows) (byTable[r.table_name] = byTable[r.table_name] || []).push(r.column_name);
  const lines = names.filter((t) => byTable[t]).map((t) => `${t}(${byTable[t].join(', ')})  -- ${CURATED[t]}`);
  _schema = `${CONVENTIONS}\n\nTABLES (table(columns) -- purpose):\n${lines.join('\n')}`;
  return _schema;
}

const WRITE_RE = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|merge|call|do)\b/i;
// Dangerous functions / system catalogs / file & network access — blocked even though
// the query runs read-only, to prevent metadata recon and server-side file/network reads.
const DANGER_RE = /\b(pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|lo_get|dblink|set_config|current_setting|pg_catalog|pg_authid|pg_shadow|pg_user|pg_roles|information_schema)\b/i;
// Auth / PII / access-control tables — never queryable via NL→SQL (a read-only SELECT
// could still leak password hashes / role grants without this).
const SENSITIVE_TABLES = ['users', 'password_reset_tokens', 'user_preferences', 'roles', 'role_permissions', 'permissions', 'sessions', 'user_sessions', 'api_integrations', 'api_sync_log', 'approval_authorizations'];
const SENSITIVE_RE = new RegExp(`\\b(${SENSITIVE_TABLES.join('|')})\\b`, 'i');

// ── 1) Natural-language report query ──
router.post('/query', noFinanceForOperator, async (req, res) => {
  try {
    if (!ai.enabled()) return res.json(OFF);
    const question = String(req.body.question || '').trim();
    if (!question) return res.status(400).json({ success: false, message: 'A question is required.' });

    const schema = await schemaContext();
    const out = await ai.complete({
      system: 'You write PostgreSQL for a rice-mill ERP. Use ONLY the tables and columns given, and follow the stated CONVENTIONS exactly (units, PKR vs USD, the Posted-journal rule). Output JSON only — no prose, no markdown.',
      prompt: `${schema}\n\nUser question: "${question}"\n\n`
        + 'Write ONE read-only PostgreSQL query that answers it.\nRules:\n'
        + '- SELECT or WITH only. Never write data or DDL. Single statement, no semicolons.\n'
        + '- Use only the tables/columns listed above; honour the CONVENTIONS (KG quantities, PKR money, Posted journals).\n'
        + "- Use ILIKE '%term%' for name matching; join suppliers/customers/products by id to show names.\n"
        + '- Add LIMIT 200 unless the result is a single aggregate row.\n'
        + '- Select human-readable columns (names, dates, amounts) rather than raw ids where possible.\n'
        + 'Return JSON: {"sql":"<query>","explanation":"<one sentence>"}.',
      json: true, maxTokens: 700,
    });

    let sql = String(out.sql || '').trim().replace(/;+\s*$/, '');
    if (!/^(select|with)\b/i.test(sql)) return res.status(400).json({ success: false, message: 'Could not turn that into a read query — try rephrasing.', data: { sql } });
    if (sql.includes(';')) return res.status(400).json({ success: false, message: 'Only a single read-only statement is allowed.', data: { sql } });
    if (WRITE_RE.test(sql) || DANGER_RE.test(sql)) return res.status(400).json({ success: false, message: 'Only plain read-only queries are allowed (no writes, system functions, or catalog access).', data: { sql } });
    if (SENSITIVE_RE.test(sql)) return res.status(400).json({ success: false, message: 'That query touches restricted data (users, roles, or credentials) and was blocked.', data: { sql } });
    // Enforce a sane row cap: add LIMIT when missing, clamp an over-large one.
    const limitMatch = sql.match(/\blimit\s+(\d+)/i);
    if (!limitMatch) sql += ' LIMIT 200';
    else if (parseInt(limitMatch[1], 10) > 1000) sql = sql.replace(/\blimit\s+\d+/i, 'LIMIT 1000');

    let rows;
    try {
      rows = await db.transaction(async (trx) => {
        await trx.raw('SET TRANSACTION READ ONLY');
        await trx.raw('SET LOCAL statement_timeout = 8000');
        const r = await trx.raw(sql);
        return r.rows || [];
      });
    } catch (e) {
      return res.status(400).json({ success: false, message: `Query failed: ${e.message}`, data: { sql, explanation: out.explanation || '' } });
    }
    return res.json({
      success: true,
      data: { aiEnabled: true, question, sql, explanation: out.explanation || '', columns: rows.length ? Object.keys(rows[0]) : [], rows: rows.slice(0, 200), rowCount: rows.length },
    });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── 2) Draft a customer / supplier email from their ledger ──
router.post('/draft', noFinanceForOperator, async (req, res) => {
  try {
    if (!ai.enabled()) return res.json(OFF);
    const { party_type, party_id, kind = 'statement', instructions } = req.body;
    if (!['customer', 'supplier'].includes(party_type) || !party_id) return res.status(400).json({ success: false, message: 'party_type (customer|supplier) and party_id are required.' });

    const party = await db(party_type === 'supplier' ? 'suppliers' : 'customers').where('id', party_id).first('name', 'email');
    if (!party) return res.status(404).json({ success: false, message: 'Party not found.' });
    const stmt = party_type === 'supplier'
      ? await accountingService.getSupplierStatement(party_id, {})
      : await accountingService.getCustomerStatement(party_id, {});
    const summary = {
      party: party.name, party_type, currency: stmt.currency || 'PKR',
      closing_balance: stmt.closing_balance,
      open_items: (stmt.open_items || []).slice(0, 10),
      recent: (stmt.transactions || []).slice(-12).map((t) => ({ date: t.date, ref: t.ref_no, desc: t.description, debit: t.debit, credit: t.credit })),
    };

    const out = await ai.complete({
      system: 'You draft concise, professional business emails for AGRI COMMODITIES, a rice trading company in Pakistan. Output JSON only.',
      prompt: `Recipient (${party_type}): ${party.name}.\n`
        + `Email purpose: "${kind}" — statement = share a balance summary; reminder = politely request settlement of the outstanding amount; thankyou = thank them for business.\n`
        + (instructions ? `Extra instructions: ${instructions}\n` : '')
        + `Ledger (PKR). open_items are unsettled bills/invoices; closing_balance is the net balance.\n${JSON.stringify(summary)}\n\n`
        + 'Write a short, courteous, professional email. Reference the exact outstanding figure(s) from open_items where relevant. Do NOT invent numbers. '
        + 'Return JSON: {"subject":"...","body":"..."}. Body is plain text with line breaks, signed off as "AGRI COMMODITIES".',
      json: true, maxTokens: 700,
    });
    return res.json({ success: true, data: { aiEnabled: true, party: party.name, to: party.email || null, subject: out.subject || '', body: out.body || '', closingBalance: stmt.closing_balance } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── 3) Anomaly detection — gather signals, let AI flag genuine issues ──
async function gatherSignals() {
  const safe = async (fn, dflt) => { try { return await fn(); } catch { return dflt; } };
  const todayIso = new Date().toISOString().slice(0, 10);

  const tb = await safe(async () => {
    const r = await db('journal_lines as l').join('journal_entries as j', 'l.journal_id', 'j.id')
      .where('j.status', 'Posted').sum('l.debit as dr').sum('l.credit as cr').first();
    const dr = parseFloat(r.dr) || 0, cr = parseFloat(r.cr) || 0;
    return { total_debit: dr, total_credit: cr, difference: Math.round((dr - cr) * 100) / 100 };
  }, null);

  const unbalancedJournals = await safe(async () => {
    const rows = await db('journal_lines as l').join('journal_entries as j', 'l.journal_id', 'j.id')
      .where('j.status', 'Posted').groupBy('j.journal_no')
      .havingRaw('ROUND(SUM(l.debit) - SUM(l.credit), 2) <> 0').select('j.journal_no');
    return rows.map((r) => r.journal_no);
  }, []);

  const negativeStock = await safe(() => db('inventory_lots')
    .where((q) => q.where('qty', '<', 0).orWhere('net_weight_kg', '<', 0))
    .select('lot_no', 'qty', 'net_weight_kg').limit(15), []);

  const negativeBanks = await safe(() => db('bank_accounts').where('current_balance', '<', 0).select('name', 'current_balance'), []);

  const recentPayrollRuns = await safe(() => db('mill_payroll_runs').orderBy('pay_date', 'desc').limit(6)
    .select('period', 'pay_date', 'net_total', 'employee_count'), []);

  const topRecentExpenses = await safe(() => db('business_expenses')
    .where('expense_date', '>=', db.raw("CURRENT_DATE - INTERVAL '30 days'"))
    .orderBy('amount_pkr', 'desc').limit(10)
    .select('expense_no', 'category', 'amount_pkr', 'expense_date', 'description', 'vendor_name'), []);

  const overduePayables = await safe(async () => {
    const r = await db('payables').whereNotNull('due_date').where('due_date', '<', todayIso)
      .where('outstanding', '>', 0).count('id as n').sum('outstanding as total').first();
    return { count: parseInt(r.n) || 0, total: parseFloat(r.total) || 0 };
  }, null);

  return { as_of: todayIso, trial_balance: tb, unbalanced_journals: unbalancedJournals, negative_stock: negativeStock, negative_bank_balances: negativeBanks, recent_payroll_runs: recentPayrollRuns, top_recent_expenses: topRecentExpenses, overdue_payables: overduePayables };
}

router.get('/anomalies', noFinanceForOperator, async (req, res) => {
  try {
    if (!ai.enabled()) return res.json(OFF);
    const signals = await gatherSignals();
    const out = await ai.complete({
      system: 'You are a financial controller auditing a rice-mill ERP. Be precise and avoid false alarms. Output JSON only.',
      prompt: 'Review these signals and list only GENUINE anomalies that warrant a manager\'s attention '
        + '(e.g. an out-of-balance trial balance, negative stock or bank balances, an unusually large or duplicated expense, a payroll run far from the recent norm, large overdue amounts). '
        + `Signals:\n${JSON.stringify(signals)}\n\n`
        + 'Return JSON: {"anomalies":[{"severity":"high|medium|low","area":"payroll|gl|stock|cash|sales|purchases","title":"short title","detail":"what and why it stands out","recommendation":"suggested action"}]}. '
        + 'If nothing is notably wrong, return an empty array.',
      json: true, maxTokens: 1200,
    });
    return res.json({ success: true, data: { aiEnabled: true, generatedAt: new Date().toISOString(), anomalies: Array.isArray(out.anomalies) ? out.anomalies : [], signals } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── 4) Auto-categorise an expense from its free-text description ──
const EXPENSE_CATS = ['salaries', 'utilities', 'rent', 'maintenance', 'insurance', 'transport', 'fuel', 'packaging', 'inspection', 'freight', 'commission', 'miscellaneous'];
router.post('/categorize-expense', noFinanceForOperator, async (req, res) => {
  try {
    if (!ai.enabled()) return res.json(OFF);
    const description = String(req.body.description || '').trim();
    const vendor = String(req.body.vendor_name || '').trim();
    if (!description && !vendor) return res.status(400).json({ success: false, message: 'A description (or vendor) is required.' });

    const out = await ai.complete({
      system: 'You categorise expenses for a rice-mill ERP. Output JSON only — no prose, no markdown.',
      prompt: `Allowed categories (choose EXACTLY one): ${EXPENSE_CATS.join(', ')}.\n`
        + `Expense description: "${description}"${vendor ? `\nVendor/payee: "${vendor}"` : ''}\n\n`
        + 'Pick the single best category. Also suggest a short subcategory/detail (1-3 words, e.g. "Electricity", "Generator diesel", "Boiler repair") or "" if none is obvious. '
        + 'Rate your confidence 0-1.\nReturn JSON: {"category":"<one allowed value>","subcategory":"<short or empty>","confidence":<0-1>}.',
      json: true, maxTokens: 120,
    });
    let category = String(out.category || '').toLowerCase().trim();
    if (!EXPENSE_CATS.includes(category)) category = 'miscellaneous';
    const confidence = Math.max(0, Math.min(1, parseFloat(out.confidence) || 0));
    return res.json({ success: true, data: { aiEnabled: true, category, subcategory: String(out.subcategory || '').trim(), confidence } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// ── 5) Plain-English narrative summary of a computed report ──
const SUMMARY_KINDS = { pnl: 'cash-basis Profit & Loss', pnl_accrual: 'accrual-basis Profit & Loss', cashflow: 'Cash Flow' };
router.post('/summarize-report', noFinanceForOperator, async (req, res) => {
  try {
    if (!ai.enabled()) return res.json(OFF);
    const kind = String(req.body.kind || '').trim();
    const figures = req.body.figures;
    if (!SUMMARY_KINDS[kind]) return res.status(400).json({ success: false, message: 'kind must be one of: ' + Object.keys(SUMMARY_KINDS).join(', ') });
    if (!figures || typeof figures !== 'object') return res.status(400).json({ success: false, message: 'figures object is required.' });

    const out = await ai.complete({
      system: 'You are a financial controller summarising reports for AGRI COMMODITIES, a rice trading company in Pakistan. Output JSON only.',
      prompt: `Report: ${SUMMARY_KINDS[kind]}${figures.range ? ` for ${figures.range}` : ''}. All amounts are PKR.\n`
        + `Figures (already computed — use ONLY these, never invent numbers):\n${JSON.stringify(figures)}\n\n`
        + 'Write a concise 2-4 sentence plain-English summary a manager can read at a glance: the headline result, the biggest driver(s), and one thing to watch. '
        + 'Refer to the exact figures. Be direct; no markdown, no bullet lists.\nReturn JSON: {"summary":"<text>"}.',
      json: true, maxTokens: 400,
    });
    return res.json({ success: true, data: { aiEnabled: true, kind, summary: String(out.summary || '').trim() } });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
