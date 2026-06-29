/**
 * Dedicated "Salaries & Wages" GL account (Phase 9A).
 *
 * Payroll salary expenses were debiting the generic 6000 Operating Expenses, so
 * the P&L couldn't show a clean Salaries line. This seeds account 6135 (child of
 * 6000) and the expense service routes category='salaries' there. Idempotent;
 * does not touch existing journals (they reference account ids).
 */
exports.up = async function up(knex) {
  const exists = await knex('chart_of_accounts').where('code', '6135').first();
  if (exists) return;
  const parent = await knex('chart_of_accounts').where('code', '6000').first();
  await knex('chart_of_accounts').insert({
    code: '6135',
    name: 'Salaries & Wages',
    type: parent ? parent.type : 'Expense',
    sub_type: parent ? parent.sub_type : 'Operating Expense',
    normal_balance: parent ? parent.normal_balance : 'debit',
    currency: parent ? parent.currency : 'PKR',
    parent_id: parent ? parent.id : null,
    entity: 'mill',
    is_active: true,
    is_system: false,
    description: 'Mill staff salaries, wages, overtime and bonuses (payroll).',
  });
};

exports.down = async function down(knex) {
  await knex('chart_of_accounts').where('code', '6135').del();
};
