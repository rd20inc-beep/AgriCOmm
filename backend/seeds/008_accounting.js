/**
 * Seed: Accounting Engine — Phase 6
 * Chart of accounts, posting rules, accounting periods, FX rates, sample journals
 */

exports.seed = async function (knex) {
  // ══════════════════════════════════════════════════════════════════
  // Clean up in dependency order
  // ══════════════════════════════════════════════════════════════════
  await knex('bank_reconciliation_items').del();
  await knex('bank_reconciliation').del();
  await knex('fx_rates').del();

  // Clear journal_lines account_id references before clearing chart
  await knex('journal_lines').update({ account_id: null });

  // Clear journal_entries foreign keys
  await knex('journal_entries').update({
    period_id: null,
    reversal_of: null,
    posting_rule_id: null,
  });

  await knex('posting_rules').del();
  await knex('accounting_periods').del();
  await knex('chart_of_accounts').del();

  // ══════════════════════════════════════════════════════════════════
  // Chart of Accounts (~40 accounts)
  // ══════════════════════════════════════════════════════════════════
  const parentAccounts = [
    { code: '1000', name: 'Cash & Bank', type: 'Asset', sub_type: 'Current Asset', entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1100', name: 'Accounts Receivable', type: 'Asset', sub_type: 'Current Asset', entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1200', name: 'Inventory', type: 'Asset', sub_type: 'Current Asset', entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1300', name: 'Advances', type: 'Asset', sub_type: 'Current Asset', entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '2000', name: 'Accounts Payable', type: 'Liability', sub_type: 'Current Liability', entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    { code: '2100', name: 'Accruals', type: 'Liability', sub_type: 'Current Liability', entity: null, currency: 'PKR', is_system: false, normal_balance: 'credit' },
    { code: '3000', name: "Owner's Equity", type: 'Equity', sub_type: 'Equity', entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    { code: '4000', name: 'Sales Revenue', type: 'Revenue', sub_type: 'Revenue', entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    { code: '5000', name: 'Cost of Goods Sold', type: 'COGS', sub_type: 'COGS', entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '6000', name: 'Operating Expenses', type: 'Expense', sub_type: 'Operating Expense', entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
  ];

  for (const acc of parentAccounts) {
    await knex('chart_of_accounts').insert(acc);
  }

  // Helper to get parent id by code
  const getParentId = async (code) => {
    const row = await knex('chart_of_accounts').where({ code }).first();
    return row ? row.id : null;
  };

  const childAccounts = [
    // Cash & Bank children
    { code: '1010', name: 'Petty Cash', type: 'Asset', sub_type: 'Current Asset', parent_code: '1000', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '1020', name: 'Bank Al Habib (PKR)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1000', entity: null, currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1030', name: 'Meezan Bank (PKR)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1000', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '1040', name: 'MCB Dollar Account (USD)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1000', entity: null, currency: 'USD', is_system: false, normal_balance: 'debit' },
    { code: '1050', name: 'HBL Account (PKR)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1000', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },
    // AR children
    { code: '1110', name: 'Export AR (USD)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1100', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'debit' },
    { code: '1120', name: 'Local AR (PKR)', type: 'Asset', sub_type: 'Current Asset', parent_code: '1100', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '1130', name: 'Inter-Company Receivable — Mill', type: 'Asset', sub_type: 'Current Asset', parent_code: '1100', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'debit' },
    // Inventory children
    { code: '1210', name: 'Raw Paddy Stock', type: 'Asset', sub_type: 'Current Asset', parent_code: '1200', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1220', name: 'Finished Rice — Mill', type: 'Asset', sub_type: 'Current Asset', parent_code: '1200', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '1230', name: 'Finished Rice — Export', type: 'Asset', sub_type: 'Current Asset', parent_code: '1200', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'debit' },
    { code: '1240', name: 'By-Products', type: 'Asset', sub_type: 'Current Asset', parent_code: '1200', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'debit' },
    { code: '1250', name: 'Bags & Packaging', type: 'Asset', sub_type: 'Current Asset', parent_code: '1200', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },
    // Advances children
    { code: '1310', name: 'Customer Advances Received', type: 'Asset', sub_type: 'Current Asset', parent_code: '1300', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'debit' },
    { code: '1320', name: 'Supplier Advances Paid', type: 'Asset', sub_type: 'Current Asset', parent_code: '1300', entity: null, currency: 'PKR', is_system: false, normal_balance: 'debit' },
    // AP children
    { code: '2010', name: 'Supplier Payable', type: 'Liability', sub_type: 'Current Liability', parent_code: '2000', entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    { code: '2020', name: 'Freight Payable', type: 'Liability', sub_type: 'Current Liability', parent_code: '2000', entity: 'export', currency: 'USD', is_system: false, normal_balance: 'credit' },
    { code: '2030', name: 'Inter-Company Payable — Export', type: 'Liability', sub_type: 'Current Liability', parent_code: '2000', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'credit' },
    // Accruals children
    { code: '2110', name: 'Accrued Expenses', type: 'Liability', sub_type: 'Current Liability', parent_code: '2100', entity: null, currency: 'PKR', is_system: false, normal_balance: 'credit' },
    // Equity children
    { code: '3010', name: 'Capital Account', type: 'Equity', sub_type: 'Equity', parent_code: '3000', entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    { code: '3020', name: 'Retained Earnings', type: 'Equity', sub_type: 'Equity', parent_code: '3000', entity: null, currency: 'PKR', is_system: true, normal_balance: 'credit' },
    // Revenue children
    { code: '4010', name: 'Export Sales', type: 'Revenue', sub_type: 'Revenue', parent_code: '4000', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'credit' },
    { code: '4020', name: 'Local Rice Sales', type: 'Revenue', sub_type: 'Revenue', parent_code: '4000', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'credit' },
    { code: '4030', name: 'By-Product Sales', type: 'Revenue', sub_type: 'Revenue', parent_code: '4000', entity: 'mill', currency: 'PKR', is_system: false, normal_balance: 'credit' },
    { code: '4040', name: 'Internal Transfer Revenue', type: 'Revenue', sub_type: 'Revenue', parent_code: '4000', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'credit' },
    // COGS children
    { code: '5010', name: 'Rice Purchase Cost', type: 'COGS', sub_type: 'COGS', parent_code: '5000', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'debit' },
    { code: '5020', name: 'Rice Cost — Export', type: 'COGS', sub_type: 'COGS', parent_code: '5000', entity: 'export', currency: 'USD', is_system: true, normal_balance: 'debit' },
    { code: '5030', name: 'Bags & Packaging Cost', type: 'COGS', sub_type: 'COGS', parent_code: '5000', entity: 'export', currency: 'USD', is_system: false, normal_balance: 'debit' },
    { code: '5040', name: 'Milling Cost', type: 'COGS', sub_type: 'COGS', parent_code: '5000', entity: 'mill', currency: 'PKR', is_system: true, normal_balance: 'debit' },
    // Expense children
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

  for (const acc of childAccounts) {
    const parentId = await getParentId(acc.parent_code);
    delete acc.parent_code;
    await knex('chart_of_accounts').insert({ ...acc, parent_id: parentId });
  }

  // Helper to get account id by code
  const getAccId = async (code) => {
    const row = await knex('chart_of_accounts').where({ code }).first();
    return row ? row.id : null;
  };

  // ══════════════════════════════════════════════════════════════════
  // Posting Rules (10)
  // ══════════════════════════════════════════════════════════════════
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

  // ══════════════════════════════════════════════════════════════════
  // Accounting Periods (Jan–Dec 2026)
  // ══════════════════════════════════════════════════════════════════
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  const periodIds = {};
  for (let m = 0; m < 12; m++) {
    const start = new Date(2026, m, 1);
    const end = new Date(2026, m + 1, 0);
    const [period] = await knex('accounting_periods')
      .insert({
        name: `${months[m]} 2026`,
        period_start: start.toISOString().slice(0, 10),
        period_end: end.toISOString().slice(0, 10),
        fiscal_year: 2026,
        status: 'Open',
      })
      .returning('*');
    periodIds[m + 1] = period.id;
  }

  // ══════════════════════════════════════════════════════════════════
  // FX Rates (PKR/USD)
  // ══════════════════════════════════════════════════════════════════
  await knex('fx_rates').insert([
    { from_currency: 'USD', to_currency: 'PKR', rate: 278.000000, effective_date: '2026-01-01', source: 'manual' },
    { from_currency: 'USD', to_currency: 'PKR', rate: 280.000000, effective_date: '2026-02-01', source: 'manual' },
    { from_currency: 'USD', to_currency: 'PKR', rate: 282.000000, effective_date: '2026-03-01', source: 'manual' },
  ]);

  // ══════════════════════════════════════════════════════════════════
  // Sample Journal Entries (5)
  // ══════════════════════════════════════════════════════════════════

  // Helper to create a sample journal
  async function createSampleJournal({ journalNo, date, entity, refType, refNo, description, lines, currency, periodMonth, isAuto, postingRuleName }) {
    let postingRuleId = null;
    if (postingRuleName) {
      const rule = await knex('posting_rules').where({ rule_name: postingRuleName }).first();
      if (rule) postingRuleId = rule.id;
    }

    const [journal] = await knex('journal_entries')
      .insert({
        journal_no: journalNo,
        date,
        entity,
        ref_type: refType,
        ref_no: refNo,
        description,
        status: 'Posted',
        currency: currency || 'PKR',
        is_auto: isAuto || false,
        posting_rule_id: postingRuleId,
        period_id: periodIds[periodMonth] || null,
        total_debit: lines.reduce((sum, l) => sum + (l.debit || 0), 0),
        total_credit: lines.reduce((sum, l) => sum + (l.credit || 0), 0),
      })
      .returning('*');

    for (const line of lines) {
      const accId = await getAccId(line.code);
      await knex('journal_lines').insert({
        journal_id: journal.id,
        account_id: accId,
        account: line.account,
        debit: line.debit || 0,
        credit: line.credit || 0,
        narration: line.narration || null,
      });
    }

    return journal;
  }

  // 1. Advance Receipt — $15,000 received from export customer
  await createSampleJournal({
    journalNo: 'JE-202601-0001',
    date: '2026-01-15',
    entity: 'export',
    refType: 'Export Order',
    refNo: 'EX-001',
    description: 'Advance receipt for export order EX-001',
    currency: 'USD',
    periodMonth: 1,
    isAuto: true,
    postingRuleName: 'advance_receipt',
    lines: [
      { code: '1020', account: 'Bank Al Habib (PKR)', debit: 15000, credit: 0, narration: 'DR Bank — advance for EX-001' },
      { code: '1310', account: 'Customer Advances Received', debit: 0, credit: 15000, narration: 'CR Customer Advances — EX-001' },
    ],
  });

  // 2. Purchase Invoice — PKR 5,000,000 raw paddy
  await createSampleJournal({
    journalNo: 'JE-202601-0002',
    date: '2026-01-20',
    entity: 'mill',
    refType: 'Supplier Invoice',
    refNo: 'INV-001',
    description: 'Raw paddy purchase from supplier',
    currency: 'PKR',
    periodMonth: 1,
    isAuto: true,
    postingRuleName: 'purchase_invoice',
    lines: [
      { code: '1210', account: 'Raw Paddy Stock', debit: 5000000, credit: 0, narration: 'DR Raw Paddy — purchase INV-001' },
      { code: '2010', account: 'Supplier Payable', debit: 0, credit: 5000000, narration: 'CR Supplier Payable — INV-001' },
    ],
  });

  // 3. Internal Transfer — PKR 3,500,000 mill to export
  await createSampleJournal({
    journalNo: 'JE-202602-0001',
    date: '2026-02-05',
    entity: 'mill',
    refType: 'Internal Transfer',
    refNo: 'IT-001',
    description: 'Internal transfer — mill side',
    currency: 'PKR',
    periodMonth: 2,
    isAuto: true,
    postingRuleName: 'internal_transfer_mill',
    lines: [
      { code: '1130', account: 'Inter-Company Receivable — Mill', debit: 3500000, credit: 0, narration: 'DR Inter-Co Receivable — IT-001' },
      { code: '4040', account: 'Internal Transfer Revenue', debit: 0, credit: 3500000, narration: 'CR Transfer Revenue — IT-001' },
    ],
  });

  // 4. Freight Expense — $2,500
  await createSampleJournal({
    journalNo: 'JE-202602-0002',
    date: '2026-02-15',
    entity: 'export',
    refType: 'Expense',
    refNo: 'EXP-001',
    description: 'Freight charges for container shipment',
    currency: 'USD',
    periodMonth: 2,
    isAuto: true,
    postingRuleName: 'expense_freight',
    lines: [
      { code: '6010', account: 'Freight & Shipping', debit: 2500, credit: 0, narration: 'DR Freight — EXP-001' },
      { code: '2020', account: 'Freight Payable', debit: 0, credit: 2500, narration: 'CR Freight Payable — EXP-001' },
    ],
  });

  // 5. Manual Adjustment — PKR 50,000 electricity expense
  await createSampleJournal({
    journalNo: 'JE-202603-0001',
    date: '2026-03-01',
    entity: 'mill',
    refType: 'Manual Adjustment',
    refNo: 'ADJ-001',
    description: 'Monthly electricity bill — mill',
    currency: 'PKR',
    periodMonth: 3,
    isAuto: false,
    lines: [
      { code: '6110', account: 'Electricity — Mill', debit: 50000, credit: 0, narration: 'DR Electricity — March 2026' },
      { code: '2110', account: 'Accrued Expenses', debit: 0, credit: 50000, narration: 'CR Accrued Expenses — electricity' },
    ],
  });
};
