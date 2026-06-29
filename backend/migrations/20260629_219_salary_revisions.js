/**
 * Salary revision history (Phase 27).
 *
 * Every pay change is recorded (old→new, effective date, reason) instead of
 * silently overwriting mill_workers.monthly_salary/daily_wage — for an audit
 * trail + a printable increment letter. A dedicated "Revise salary" flow writes
 * a row with reason+effective date; an edit via the generic worker form that
 * happens to change pay is also auto-logged (so nothing slips through).
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('mill_salary_revisions')) return;
  await knex.schema.createTable('mill_salary_revisions', (t) => {
    t.increments('id').primary();
    t.integer('worker_id').notNullable().references('id').inTable('mill_workers').onDelete('CASCADE');
    t.date('effective_date').notNullable();
    t.text('reason').nullable();
    t.string('prev_pay_type', 20).nullable();
    t.string('new_pay_type', 20).nullable();
    t.decimal('prev_monthly_salary', 14, 2).nullable();
    t.decimal('new_monthly_salary', 14, 2).nullable();
    t.decimal('prev_daily_wage', 14, 2).nullable();
    t.decimal('new_daily_wage', 14, 2).nullable();
    t.decimal('prev_ot_rate', 9, 2).nullable();
    t.decimal('new_ot_rate', 9, 2).nullable();
    t.integer('created_by').nullable();
    t.timestamps(true, true);
    t.index(['worker_id'], 'idx_salary_rev_worker');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mill_salary_revisions');
};
