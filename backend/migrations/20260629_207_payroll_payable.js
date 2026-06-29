/**
 * Payroll payable — accrue-now / pay-later (Phase 10).
 *
 * Two additive pieces:
 *  1. A dedicated liability account 2040 "Salaries Payable" (child of 2000
 *     Accounts Payable, mirroring 2010 Supplier Payable) so accrued-but-unpaid
 *     salaries show as their own balance-sheet line instead of being lumped into
 *     Supplier Payable. Salary expenses (category='salaries') now credit this
 *     account; the settlement debits it back when cash actually goes out.
 *  2. accrued_by / accrued_at on mill_payroll_runs — the workflow stamp for a
 *     run that has been ACCRUED (liability booked) but not yet paid, paralleling
 *     approved_by/at and paid_by/at.
 *
 * The account seed is idempotent (data); the columns are guarded with hasColumn.
 */
exports.up = async function up(knex) {
  // 1) Salaries Payable account (mirror 2010 Supplier Payable's classification).
  const exists = await knex('chart_of_accounts').where('code', '2040').first();
  if (!exists) {
    const parent = await knex('chart_of_accounts').where('code', '2000').first();
    const supplierPayable = await knex('chart_of_accounts').where('code', '2010').first();
    await knex('chart_of_accounts').insert({
      code: '2040',
      name: 'Salaries Payable',
      type: supplierPayable ? supplierPayable.type : 'Liability',
      sub_type: supplierPayable ? supplierPayable.sub_type : 'Current Liability',
      normal_balance: supplierPayable ? supplierPayable.normal_balance : 'credit',
      currency: supplierPayable ? supplierPayable.currency : 'PKR',
      parent_id: parent ? parent.id : null,
      entity: 'mill',
      is_active: true,
      is_system: false,
      description: 'Accrued payroll owed to mill staff, awaiting payment.',
    });
  }

  // 2) Accrual workflow stamps on payroll runs.
  const hasAccruedBy = await knex.schema.hasColumn('mill_payroll_runs', 'accrued_by');
  if (!hasAccruedBy) {
    await knex.schema.alterTable('mill_payroll_runs', (t) => {
      t.integer('accrued_by').nullable();
      t.timestamp('accrued_at').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasAccruedBy = await knex.schema.hasColumn('mill_payroll_runs', 'accrued_by');
  if (hasAccruedBy) {
    await knex.schema.alterTable('mill_payroll_runs', (t) => {
      t.dropColumn('accrued_by');
      t.dropColumn('accrued_at');
    });
  }
  await knex('chart_of_accounts').where('code', '2040').del();
};
