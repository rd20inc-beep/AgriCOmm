/**
 * Leave management (Phase 23).
 *
 * Leave types (paid/unpaid + annual quota) and balance-aware leave requests.
 * Approved leave feeds payroll: UNPAID leave docks a monthly salary (dailyRate ×
 * days); PAID leave pays a daily-wage worker for those days. Balances are DERIVED
 * (quota − approved days this year), so there's no accrual job to drift. No GL
 * change — it adjusts the existing net-pay computation. Seeds sensible PK
 * defaults (admin can edit). Distinct from the Phase-20 generic request inbox.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('mill_leave_types'))) {
    await knex.schema.createTable('mill_leave_types', (t) => {
      t.increments('id').primary();
      t.string('name', 80).notNullable();
      t.string('code', 30).notNullable();
      t.boolean('paid').notNullable().defaultTo(true);
      t.decimal('annual_quota', 6, 2).nullable(); // days/year; null = unlimited
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').defaultTo(0);
      t.timestamps(true, true);
    });
    await knex('mill_leave_types').insert([
      { name: 'Annual Leave', code: 'ANNUAL', paid: true, annual_quota: 14, sort_order: 1 },
      { name: 'Sick Leave', code: 'SICK', paid: true, annual_quota: 8, sort_order: 2 },
      { name: 'Casual Leave', code: 'CASUAL', paid: true, annual_quota: 10, sort_order: 3 },
      { name: 'Unpaid Leave', code: 'UNPAID', paid: false, annual_quota: null, sort_order: 4 },
    ]);
  }
  if (!(await knex.schema.hasTable('mill_leave_requests'))) {
    await knex.schema.createTable('mill_leave_requests', (t) => {
      t.increments('id').primary();
      t.integer('worker_id').notNullable().references('id').inTable('mill_workers').onDelete('CASCADE');
      t.integer('leave_type_id').nullable().references('id').inTable('mill_leave_types').onDelete('SET NULL');
      t.date('from_date').notNullable();
      t.date('to_date').notNullable();
      t.decimal('days', 6, 2).notNullable().defaultTo(0);
      t.boolean('paid').notNullable().defaultTo(true); // snapshot of the type at request time
      t.text('reason').nullable();
      t.string('status', 20).notNullable().defaultTo('pending'); // pending | approved | rejected | cancelled
      t.integer('approved_by').nullable();
      t.timestamp('approved_at').nullable();
      t.timestamps(true, true);
      t.index(['worker_id'], 'idx_leave_req_worker');
      t.index(['status'], 'idx_leave_req_status');
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mill_leave_requests');
  await knex.schema.dropTableIfExists('mill_leave_types');
};
