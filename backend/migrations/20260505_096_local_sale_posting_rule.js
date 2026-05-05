/**
 * Add posting rule so local sales auto-post journal entries.
 *
 *   local_sale_recorded
 *     DR Local AR (1120, id 69)
 *     CR Local Rice Sales (4020, id 85)
 *
 * For cash sales the customer immediately settles the AR, but
 * recognising AR + Sales first (then a separate cash-receipt
 * adjustment) is the standard double-entry pattern and matches
 * how the existing supplier/expense flows work.
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  const exists = await knex('posting_rules').where({ trigger_event: 'local_sale_recorded' }).first();
  if (exists) return;

  const acc = async (code) => {
    const row = await knex('chart_of_accounts').where({ code }).first();
    return row ? row.id : null;
  };

  const localAr     = await acc('1120');  // Local AR (PKR)
  const localSales  = await acc('4020');  // Local Rice Sales

  if (!localAr || !localSales) return; // skip silently if accounts missing

  await knex('posting_rules').insert({
    rule_name: 'local_sale_recorded',
    trigger_event: 'local_sale_recorded',
    debit_account_id: localAr,
    credit_account_id: localSales,
    description: 'Local sale recorded (DR Local AR, CR Local Rice Sales)',
    is_active: true,
  });
};

exports.down = async function (knex) {
  await knex('posting_rules').where({ trigger_event: 'local_sale_recorded' }).del();
};
