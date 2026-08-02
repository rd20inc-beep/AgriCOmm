// Payment WHT + early-payment discount + attachment (spec item #14, Phase 1e).
// Lets the Pay form withhold tax (remitted to FBR), record a supplier/transporter
// early-payment discount, and attach a supporting document — all posted to the GL:
//   Dr 2010 Payable (gross settled)
//     Cr 1000 Cash/Bank  (net cash actually paid)
//     Cr 2060 Withholding Tax Payable (tax withheld — a liability owed to FBR)
//     Cr 4060 Discount Received       (early-payment discount — other income)
// The payable is still settled by the FULL applied amount; only the cash out and
// the extra credit lines change, so the books stay balanced.

exports.up = async (knex) => {
  // Payment columns.
  const cols = [
    ['wht_amount', (t) => t.decimal('wht_amount', 14, 2).notNullable().defaultTo(0)],
    ['discount_amount', (t) => t.decimal('discount_amount', 14, 2).notNullable().defaultTo(0)],
    ['wht_rate', (t) => t.decimal('wht_rate', 6, 3)], // % used to derive the amount (nullable)
    ['attachment_url', (t) => t.text('attachment_url')],
    ['attachment_name', (t) => t.text('attachment_name')],
  ];
  for (const [name, add] of cols) {
    if (!(await knex.schema.hasColumn('payments', name))) {
      await knex.schema.alterTable('payments', (t) => add(t));
    }
  }

  // GL accounts (idempotent) — shared across entities, like 2010 Supplier Payable.
  const ensureAccount = async (row) => {
    const exists = await knex('chart_of_accounts').where({ code: row.code }).first();
    if (!exists) await knex('chart_of_accounts').insert(row);
  };
  await ensureAccount({
    code: '2060', name: 'Withholding Tax Payable', type: 'Liability',
    sub_type: 'Current Liability', entity: null, currency: 'PKR',
    normal_balance: 'credit', is_system: false, is_active: true,
    description: 'Tax withheld from supplier/transporter payments, owed to FBR.',
  });
  await ensureAccount({
    code: '4060', name: 'Discount Received', type: 'Revenue',
    sub_type: 'Revenue', entity: null, currency: 'PKR',
    normal_balance: 'credit', is_system: false, is_active: true,
    description: 'Early-payment / settlement discounts received from vendors.',
  });
};

exports.down = async (knex) => {
  await knex('chart_of_accounts').whereIn('code', ['2060', '4060']).del();
  for (const name of ['wht_amount', 'discount_amount', 'wht_rate', 'attachment_url', 'attachment_name']) {
    if (await knex.schema.hasColumn('payments', name)) {
      await knex.schema.alterTable('payments', (t) => t.dropColumn(name));
    }
  }
};
