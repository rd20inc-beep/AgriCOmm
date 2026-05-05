/**
 * Add posting rules so expenses and mill-store purchases auto-post
 * journal entries (currently only advance/balance receipts and milling
 * completion do).
 *
 * - expense_recorded : DR Operating Expenses (6000) | CR Supplier Payable (2010)
 * - store_purchase   : DR Bags & Packaging (1250)   | CR Supplier Payable (2010)
 *
 * Both already have CR Accounts Payable so the soon-to-arrive
 * expense_paid / supplier_payment events naturally clear the AP side.
 *
 * Idempotent — looks up rules by trigger_event before inserting.
 */

exports.up = async function (knex) {
  const acc = async (code) => {
    const row = await knex('chart_of_accounts').where({ code }).first();
    return row ? row.id : null;
  };

  const opsExpense = await acc('6000');     // Operating Expenses (parent)
  const supplierAp = await acc('2010');     // Supplier Payable
  const bagsStock  = await acc('1250');     // Bags & Packaging

  const upsertRule = async (rule) => {
    const existing = await knex('posting_rules').where({ trigger_event: rule.trigger_event }).first();
    if (existing) return;
    await knex('posting_rules').insert(rule);
  };

  if (opsExpense && supplierAp) {
    await upsertRule({
      rule_name: 'expense_recorded',
      trigger_event: 'expense_recorded',
      debit_account_id: opsExpense,
      credit_account_id: supplierAp,
      description: 'Business expense recorded (DR Operating Expenses, CR Supplier Payable)',
      is_active: true,
    });
  }

  if (bagsStock && supplierAp) {
    await upsertRule({
      rule_name: 'store_purchase',
      trigger_event: 'store_purchase',
      debit_account_id: bagsStock,
      credit_account_id: supplierAp,
      description: 'Mill store purchase (DR Bags & Packaging Stock, CR Supplier Payable)',
      is_active: true,
    });
  }
};

exports.down = async function (knex) {
  await knex('posting_rules').whereIn('trigger_event', ['expense_recorded', 'store_purchase']).del();
};
