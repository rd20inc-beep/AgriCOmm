/**
 * Migration: Accounting Engine — Phase 6
 * Chart of accounts, posting rules, periods, bank reconciliation, FX rates
 */

exports.up = async function (knex) {
  // ── Chart of Accounts ──────────────────────────────────────────────
  await knex.schema.createTable('chart_of_accounts', (t) => {
    t.increments('id').primary();
    t.string('code', 20).unique().notNullable();
    t.string('name', 255).notNullable();
    t.string('type', 30).notNullable(); // Asset, Liability, Equity, Revenue, Expense, COGS
    t.string('sub_type', 50);           // Current Asset, Fixed Asset, Current Liability, etc.
    t.integer('parent_id').unsigned().references('id').inTable('chart_of_accounts').onDelete('SET NULL');
    t.string('entity', 10);             // null=shared, 'mill', 'export'
    t.string('currency', 10).defaultTo('PKR');
    t.boolean('is_active').defaultTo(true);
    t.boolean('is_system').defaultTo(false);
    t.string('normal_balance', 10).defaultTo('debit'); // debit or credit
    t.text('description');
    t.timestamps(true, true);
  });

  // ── Posting Rules ──────────────────────────────────────────────────
  await knex.schema.createTable('posting_rules', (t) => {
    t.increments('id').primary();
    t.string('rule_name', 100).unique().notNullable();
    t.string('trigger_event', 50).notNullable();
    t.string('entity', 10);
    t.integer('debit_account_id').unsigned().references('id').inTable('chart_of_accounts');
    t.integer('credit_account_id').unsigned().references('id').inTable('chart_of_accounts');
    t.text('description');
    t.boolean('is_active').defaultTo(true);
    t.timestamps(true, true);
  });

  // ── Accounting Periods ─────────────────────────────────────────────
  await knex.schema.createTable('accounting_periods', (t) => {
    t.increments('id').primary();
    t.string('name', 50).notNullable();
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.integer('fiscal_year').notNullable();
    t.string('status', 20).defaultTo('Open'); // Open, Closed, Locked
    t.integer('closed_by').unsigned().references('id').inTable('users');
    t.timestamp('closed_at');
    t.timestamps(true, true);
  });

  // ── Bank Reconciliation ────────────────────────────────────────────
  await knex.schema.createTable('bank_reconciliation', (t) => {
    t.increments('id').primary();
    t.integer('bank_account_id').unsigned().references('id').inTable('bank_accounts').notNullable();
    t.date('statement_date').notNullable();
    t.decimal('statement_balance', 15, 2).notNullable();
    t.decimal('book_balance', 15, 2);
    t.decimal('difference', 15, 2);
    t.string('status', 20).defaultTo('Draft'); // Draft, In Progress, Completed
    t.integer('reconciled_by').unsigned().references('id').inTable('users');
    t.timestamp('reconciled_at');
    t.text('notes');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('bank_reconciliation_items', (t) => {
    t.increments('id').primary();
    t.integer('reconciliation_id').unsigned().references('id').inTable('bank_reconciliation').onDelete('CASCADE');
    t.string('transaction_type', 20); // 'book' or 'bank'
    t.string('reference', 100);
    t.date('date');
    t.decimal('amount', 15, 2);
    t.boolean('matched').defaultTo(false);
    t.integer('matched_with_id'); // matched item id
    t.text('notes');
  });

  // ── FX Rates ───────────────────────────────────────────────────────
  await knex.schema.createTable('fx_rates', (t) => {
    t.increments('id').primary();
    t.string('from_currency', 10).notNullable();
    t.string('to_currency', 10).notNullable();
    t.decimal('rate', 15, 6).notNullable();
    t.date('effective_date').notNullable();
    t.string('source', 50); // 'manual', 'api'
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── Alter journal_entries ──────────────────────────────────────────
  await knex.schema.alterTable('journal_entries', (t) => {
    t.integer('period_id').unsigned().references('id').inTable('accounting_periods');
    t.decimal('total_debit', 15, 2).defaultTo(0);
    t.decimal('total_credit', 15, 2).defaultTo(0);
    t.string('currency', 10).defaultTo('PKR');
    t.decimal('fx_rate', 15, 6);
    t.boolean('is_auto').defaultTo(false);
    t.integer('reversal_of').unsigned().references('id').inTable('journal_entries');
    t.integer('posting_rule_id').unsigned().references('id').inTable('posting_rules');
  });

  // ── Add account_id foreign key to journal_lines ────────────────────
  await knex.schema.alterTable('journal_lines', (t) => {
    t.integer('account_id').unsigned().references('id').inTable('chart_of_accounts');
  });

  // ──────────────────────────────────────────────────────────────────
  // SEED: Chart of Accounts
  // ──────────────────────────────────────────────────────────────────
  const accounts = [
    // ── Assets ──
    { code: '1000', name: 'Cash & Bank', type: 'Asset', sub_type: 'Current Asset', parent_id: null, entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1010', name: 'Petty Cash', type: 'Asset', sub_type: 'Current Asset', parent_code: '1000', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '1020', name: 'Bank Al Habib (PKR)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1000', entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1030', name: 'Meezan Bank (PKR)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1000', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '1040', name: 'MCB Dollar Account (USD)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1000', entity: null, currency: 'USD', is_system: false, normal_balance: 'debit' },
    { code: '1050', name: 'HBL Account (PKR)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1000', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },

    { code: '1100', name: 'Accounts Receivable', type: 'Asset', sub_type: 'Current Asset', parent_id: null, entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1110', name: 'Export AR (USD)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1100', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'debit' },
    { code: '1120', name: 'Local AR (PKR)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1100', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '1130', name: 'Inter-Company Receivable — Mill', type: 'Asset', sub_type: 'Current Asset', parent_code: '1100', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'debit' },

    { code: '1200', name: 'Inventory', type: 'Asset', sub_type: 'Current Asset', parent_id: null, entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1210', name: 'Raw Paddy Stock', type: 'Asset', sub_type: 'Current Asset', parent_code: '1200', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1220', name: 'Finished Rice — Mill', type: 'Asset', sub_type: 'Current Asset', parent_code: '1200', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1230', name: 'Finished Rice — Export', type: 'Asset', sub_type: 'Current Asset', parent_code: '1200', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'debit' },
    { code: '1240', name: 'By-Products', type: 'Asset', sub_type: 'Current Asset', parent_code: '1200', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '1250', name: 'Bags & Packaging', type: 'Asset', sub_type: 'Current Asset', parent_code: '1200', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },

    { code: '1300', name: 'Advances', type: 'Asset', sub_type: 'Current Asset', parent_id: null, entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1310', name: 'Customer Advances Received', type: 'Asset', sub_type: 'Current Asset', parent_code: '1300', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'debit' },
    { code: '1320', name: 'Supplier Advances Paid', type: 'Asset', sub_type: 'Current Asset', parent_code: '1300', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },

    // ── Liabilities ──
    { code: '2000', name: 'Accounts Payable', type: 'Liability', sub_type: 'Current Liability', parent_id: null, entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    { code: '2010', name: 'Supplier Payable', type: 'Liability', sub_type: 'Current Liability', parent_code: '2000', entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    { code: '2020', name: 'Freight Payable', type: 'Liability', sub_type: 'Current Liability', parent_code: '2000', entity: 'export', currency: 'USD', is_system: false, normal_balance: 'credit' },
    { code: '2030', name: 'Inter-Company Payable — Export', type: 'Liability', sub_type: 'Current Liability', parent_code: '2000', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'credit' },

    { code: '2100', name: 'Accruals', type: 'Liability', sub_type: 'Current Liability', parent_id: null, entity: null, currency: 'PKR', is_system: false, normal_balance: 'credit' },
    { code: '2110', name: 'Accrued Expenses', type: 'Liability', sub_type: 'Current Liability', parent_code: '2100', entity: null, currency: 'PKR', is_system: false, normal_balance: 'credit' },

    // ── Equity ──
    { code: '3000', name: "Owner's Equity", type: 'Equity', sub_type: 'Equity', parent_id: null, entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    { code: '3010', name: 'Capital Account', type: 'Equity', sub_type: 'Equity', parent_code: '3000', entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    { code: '3020', name: 'Retained Earnings', type: 'Equity', sub_type: 'Equity', parent_code: '3000', entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },

    // ── Revenue ──
    { code: '4000', name: 'Sales Revenue', type: 'Revenue', sub_type: 'Revenue', parent_id: null, entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    { code: '4010', name: 'Export Sales', type: 'Revenue', sub_type: 'Revenue', parent_code: '4000', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'credit' },
    { code: '4020', name: 'Local Rice Sales', type: 'Revenue', sub_type: 'Revenue', parent_code: '4000', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'credit' },
    { code: '4030', name: 'By-Product Sales', type: 'Revenue', sub_type: 'Revenue', parent_code: '4000', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'credit' },
    { code: '4040', name: 'Internal Transfer Revenue', type: 'Revenue', sub_type: 'Revenue', parent_code: '4000', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'credit' },

    // ── COGS ──
    { code: '5000', name: 'Cost of Goods Sold', type: 'COGS', sub_type: 'COGS', parent_id: null, entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '5010', name: 'Rice Purchase Cost', type: 'COGS', sub_type: 'COGS', parent_code: '5000', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '5020', name: 'Rice Cost — Export', type: 'COGS', sub_type: 'COGS', parent_code: '5000', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'debit' },
    { code: '5030', name: 'Bags & Packaging Cost', type: 'COGS', sub_type: 'COGS', parent_code: '5000', entity: 'export', currency: 'USD', is_system: false, normal_balance: 'debit' },
    { code: '5040', name: 'Milling Cost', type: 'COGS', sub_type: 'COGS', parent_code: '5000', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'debit' },

    // ── Expenses ──
    { code: '6000', name: 'Operating Expenses', type: 'Expense', sub_type: 'Operating Expense', parent_id: null, entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '6010', name: 'Freight & Shipping', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'export', currency: 'USD', is_system: false, normal_balance: 'debit' },
    { code: '6020', name: 'Clearing & Forwarding', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'export', currency: 'USD', is_system: false, normal_balance: 'debit' },
    { code: '6030', name: 'Loading Charges', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'export', currency: 'USD', is_system: false, normal_balance: 'debit' },
    { code: '6040', name: 'Documentation', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'export', currency: 'USD', is_system: false, normal_balance: 'debit' },
    { code: '6050', name: 'Insurance', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'export', currency: 'USD', is_system: false, normal_balance: 'debit' },
    { code: '6060', name: 'Commission & Brokerage', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'export', currency: 'USD', is_system: false, normal_balance: 'debit' },
    { code: '6100', name: 'Transport — Mill', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '6110', name: 'Electricity — Mill', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '6120', name: 'Rent — Mill', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '6130', name: 'Labor — Mill', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '6140', name: 'Maintenance — Mill', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '6200', name: 'Bank Charges', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '6210', name: 'FX Gain/Loss', type: 'Expense', sub_type: 'Operating Expense', parent_code: '6000', entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
  ];

  // Insert parent accounts first (those without parent_code)
  const parentAccounts = accounts.filter((a) => a.parent_id === null && !a.parent_code);
  for (const acc of parentAccounts) {
    delete acc.parent_code;
    await knex('chart_of_accounts').insert(acc);
  }

  // Resolve parent IDs and insert children
  const childAccounts = accounts.filter((a) => a.parent_code);
  for (const acc of childAccounts) {
    const parent = await knex('chart_of_accounts').where({ code: acc.parent_code }).first();
    acc.parent_id = parent ? parent.id : null;
    delete acc.parent_code;
    await knex('chart_of_accounts').insert(acc);
  }

  // ──────────────────────────────────────────────────────────────────
  // SEED: Posting Rules
  // ──────────────────────────────────────────────────────────────────
  const getAccId = async (code) => {
    const row = await knex('chart_of_accounts').where({ code }).first();
    return row ? row.id : null;
  };

  const rules = [
    { rule_name: 'advance_receipt', trigger_event: 'advance_receipt', entity: 'export', debit_code: '1020', credit_code: '1310', description: 'Customer advance payment received into bank' },
    { rule_name: 'balance_receipt', trigger_event: 'balance_receipt', entity: 'export', debit_code: '1020', credit_code: '1110', description: 'Balance payment received against export AR' },
    { rule_name: 'purchase_invoice', trigger_event: 'purchase_invoice', entity: 'mill', debit_code: '1210', credit_code: '2010', description: 'Supplier invoice for raw paddy purchase' },
    { rule_name: 'supplier_payment', trigger_event: 'supplier_payment', entity: 'mill', debit_code: '2010', credit_code: '1020', description: 'Payment to supplier' },
    { rule_name: 'milling_completion', trigger_event: 'milling_completion', entity: 'mill', debit_code: '1220', credit_code: '1210', description: 'Milling completed — finished goods from raw paddy' },
    { rule_name: 'internal_transfer_mill', trigger_event: 'internal_transfer_mill', entity: 'mill', debit_code: '1130', credit_code: '4040', description: 'Mill side of inter-company transfer' },
    { rule_name: 'internal_transfer_export', trigger_event: 'internal_transfer_export', entity: 'export', debit_code: '1230', credit_code: '2030', description: 'Export side of inter-company transfer' },
    { rule_name: 'export_shipment', trigger_event: 'export_shipment', entity: 'export', debit_code: '5020', credit_code: '1230', description: 'Cost of shipped export rice' },
    { rule_name: 'export_revenue', trigger_event: 'export_revenue', entity: 'export', debit_code: '1110', credit_code: '4010', description: 'Revenue recognized on export shipment' },
    { rule_name: 'expense_freight', trigger_event: 'expense_freight', entity: 'export', debit_code: '6010', credit_code: '2020', description: 'Freight expense accrued' },
  ];

  for (const rule of rules) {
    await knex('posting_rules').insert({
      rule_name: rule.rule_name,
      trigger_event: rule.trigger_event,
      entity: rule.entity,
      debit_account_id: await getAccId(rule.debit_code),
      credit_account_id: await getAccId(rule.credit_code),
      description: rule.description,
      is_active: true,
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // SEED: Accounting Periods (Jan–Dec 2026)
  // ──────────────────────────────────────────────────────────────────
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  for (let m = 0; m < 12; m++) {
    const start = new Date(2026, m, 1);
    const end = new Date(2026, m + 1, 0); // last day of month
    await knex('accounting_periods').insert({
      name: `${months[m]} 2026`,
      period_start: start.toISOString().slice(0, 10),
      period_end: end.toISOString().slice(0, 10),
      fiscal_year: 2026,
      status: 'Open',
    });
  }
};

exports.down = async function (knex) {
  // Remove added columns from journal_lines
  await knex.schema.alterTable('journal_lines', (t) => {
    t.dropColumn('account_id');
  });

  // Remove added columns from journal_entries
  await knex.schema.alterTable('journal_entries', (t) => {
    t.dropColumn('period_id');
    t.dropColumn('total_debit');
    t.dropColumn('total_credit');
    t.dropColumn('currency');
    t.dropColumn('fx_rate');
    t.dropColumn('is_auto');
    t.dropColumn('reversal_of');
    t.dropColumn('posting_rule_id');
  });

  await knex.schema.dropTableIfExists('fx_rates');
  await knex.schema.dropTableIfExists('bank_reconciliation_items');
  await knex.schema.dropTableIfExists('bank_reconciliation');
  await knex.schema.dropTableIfExists('accounting_periods');
  await knex.schema.dropTableIfExists('posting_rules');
  await knex.schema.dropTableIfExists('chart_of_accounts');
};
