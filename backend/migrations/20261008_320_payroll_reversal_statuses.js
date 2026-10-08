/**
 * Payroll reversals keep their records (audit-safe undo).
 *
 * Undoing a paid / accrued payroll run, deleting a salary advance or reversing
 * a final settlement used to HARD-DELETE the salaries expense, its payable,
 * payment, bank_transactions row and journals. They now stay, with signed-delta
 * journals and reversing bank rows netting them out, so each needs a status
 * that says so:
 *
 *   mill_payroll_runs.status        + 'reversed'  (run kept; reversed_at/_by/
 *                                                  reversal_reason recorded)
 *   business_expenses.payment_status + 'Reversed'
 *   payables.status                  + 'Reversed'
 *
 * (payments.status already allows 'Reversed' — migration 289.)
 * Idempotent; down() refuses while any row still uses a new value.
 */

const RUN_STATUSES = ['prepared', 'approved', 'accrued', 'paid', 'partially_paid', 'voided', 'posted'];
const EXPENSE_STATUSES = ['Pending', 'Partial', 'Paid'];
const PAYABLE_STATUSES = ['Pending', 'Partial', 'Paid', 'Overdue', 'Written Off'];

const list = (vals) => vals.map((v) => `'${v}'`).join(', ');

async function setChecks(knex, { run, expense, payable }) {
  await knex.raw('ALTER TABLE mill_payroll_runs DROP CONSTRAINT IF EXISTS chk_mill_payroll_runs_status_valid');
  await knex.raw(`ALTER TABLE mill_payroll_runs ADD CONSTRAINT chk_mill_payroll_runs_status_valid CHECK ((status IS NULL) OR (status IN (${list(run)})))`);
  await knex.raw('ALTER TABLE business_expenses DROP CONSTRAINT IF EXISTS business_expenses_payment_chk');
  await knex.raw(`ALTER TABLE business_expenses ADD CONSTRAINT business_expenses_payment_chk CHECK (payment_status IN (${list(expense)}))`);
  await knex.raw('ALTER TABLE payables DROP CONSTRAINT IF EXISTS chk_payables_status_valid');
  await knex.raw(`ALTER TABLE payables ADD CONSTRAINT chk_payables_status_valid CHECK (status IN (${list(payable)}))`);
}

exports.up = async (knex) => {
  await setChecks(knex, {
    run: [...RUN_STATUSES, 'reversed'],
    expense: [...EXPENSE_STATUSES, 'Reversed'],
    payable: [...PAYABLE_STATUSES, 'Reversed'],
  });
  const cols = [
    ['reversed_at', (t) => t.timestamp('reversed_at', { useTz: true }).nullable()],
    ['reversed_by', (t) => t.integer('reversed_by').nullable().references('id').inTable('users').onDelete('SET NULL')],
    ['reversal_reason', (t) => t.text('reversal_reason').nullable()],
  ];
  for (const [name, add] of cols) {
    if (!(await knex.schema.hasColumn('mill_payroll_runs', name))) {
      await knex.schema.alterTable('mill_payroll_runs', add);
    }
  }
};

exports.down = async (knex) => {
  const inUse = [
    ['mill_payroll_runs', 'status', 'reversed'],
    ['business_expenses', 'payment_status', 'Reversed'],
    ['payables', 'status', 'Reversed'],
  ];
  for (const [t, c, v] of inUse) {
    const n = await knex(t).where(c, v).count('* as n').first();
    if (Number(n && n.n) > 0) throw new Error(`Cannot roll back: ${n.n} ${t} row(s) are '${v}'.`);
  }
  await setChecks(knex, { run: RUN_STATUSES, expense: EXPENSE_STATUSES, payable: PAYABLE_STATUSES });
  for (const name of ['reversed_by', 'reversed_at', 'reversal_reason']) {
    if (await knex.schema.hasColumn('mill_payroll_runs', name)) {
      await knex.schema.alterTable('mill_payroll_runs', (t) => t.dropColumn(name));
    }
  }
};
