/**
 * Payroll line guards and policy fields (P2-11, P2-25, P2-26).
 *
 * mill_payroll_lines
 *   period    YYYY-MM, copied from the run (backfilled; a trigger fills it on
 *             insert when the writer does not) — so a line can carry
 *   active    false once its run is voided / reversed   } the unique index below
 *   uq_mill_payroll_lines_worker_period — UNIQUE (worker_id, period) WHERE
 *       active: one salary per employee per month, whichever path inserts it.
 *       (Prepare took only an advisory lock; nothing in the schema held it.)
 *   short_pay_amount     computed net − net actually paid, when a preparer pays
 *                        less with a reason (D-12: the shortfall is tracked)
 *   short_pay_carried_in earlier shortfall added back to this line's net
 *   daily_rate / daily_rate_rule  the day rate the line used, and the rule
 *                        ("monthly salary ÷ 30") printed on the payslip (D-12)
 *
 * mill_payroll_runs.self_approved — the approver also prepared the run; only
 *   an Owner may do that, and it is recorded (P2-25).
 *
 * Duplicate active (worker, period) lines block the index: the migration stops
 * and names the count — run backend/scripts/detectPayrollDuplicates.js and see
 * docs/runbooks/payroll-duplicate-guards.md.
 */

const LINE_COLS = [
  ['period', (t) => t.string('period', 7).nullable()],
  ['active', (t) => t.boolean('active').notNullable().defaultTo(true)],
  ['short_pay_amount', (t) => t.decimal('short_pay_amount', 14, 2).notNullable().defaultTo(0)],
  ['short_pay_carried_in', (t) => t.decimal('short_pay_carried_in', 14, 2).notNullable().defaultTo(0)],
  ['daily_rate', (t) => t.decimal('daily_rate', 14, 2).nullable()],
  ['daily_rate_rule', (t) => t.string('daily_rate_rule', 80).nullable()],
];

exports.up = async (knex) => {
  for (const [name, add] of LINE_COLS) {
    if (!(await knex.schema.hasColumn('mill_payroll_lines', name))) {
      await knex.schema.alterTable('mill_payroll_lines', add);
    }
  }
  await knex.raw(`UPDATE mill_payroll_lines l SET period = r.period
    FROM mill_payroll_runs r WHERE r.id = l.run_id AND l.period IS NULL`);
  await knex.raw(`UPDATE mill_payroll_lines l SET active = false
    FROM mill_payroll_runs r WHERE r.id = l.run_id AND r.status IN ('voided', 'reversed') AND l.active`);
  await knex.raw('ALTER TABLE mill_payroll_lines ALTER COLUMN period SET NOT NULL');
  // Any insert that does not name the period takes its run's, so the guard
  // below holds whichever code path writes a line.
  await knex.raw(`CREATE OR REPLACE FUNCTION mill_payroll_lines_fill_period() RETURNS trigger AS $$
    BEGIN
      IF NEW.period IS NULL THEN
        SELECT period INTO NEW.period FROM mill_payroll_runs WHERE id = NEW.run_id;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await knex.raw('DROP TRIGGER IF EXISTS trg_mill_payroll_lines_fill_period ON mill_payroll_lines');
  await knex.raw(`CREATE TRIGGER trg_mill_payroll_lines_fill_period BEFORE INSERT ON mill_payroll_lines
    FOR EACH ROW EXECUTE FUNCTION mill_payroll_lines_fill_period()`);

  const dup = await knex.raw(`
    SELECT COUNT(*)::int AS n FROM (
      SELECT worker_id, period FROM mill_payroll_lines
      WHERE active AND worker_id IS NOT NULL
      GROUP BY worker_id, period HAVING COUNT(*) > 1
    ) d`);
  const n = dup.rows[0].n;
  if (n > 0) {
    throw new Error(`${n} employee-month(s) appear on more than one live payroll line. Run scripts/detectPayrollDuplicates.js and resolve them (docs/runbooks/payroll-duplicate-guards.md) before migrating.`);
  }
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mill_payroll_lines_worker_period
    ON mill_payroll_lines (worker_id, period) WHERE active AND worker_id IS NOT NULL`);

  if (!(await knex.schema.hasColumn('mill_payroll_runs', 'self_approved'))) {
    await knex.schema.alterTable('mill_payroll_runs', (t) => t.boolean('self_approved').notNullable().defaultTo(false));
  }
};

exports.down = async (knex) => {
  await knex.raw('DROP TRIGGER IF EXISTS trg_mill_payroll_lines_fill_period ON mill_payroll_lines');
  await knex.raw('DROP FUNCTION IF EXISTS mill_payroll_lines_fill_period()');
  await knex.raw('DROP INDEX IF EXISTS uq_mill_payroll_lines_worker_period');
  if (await knex.schema.hasColumn('mill_payroll_runs', 'self_approved')) {
    await knex.schema.alterTable('mill_payroll_runs', (t) => t.dropColumn('self_approved'));
  }
  for (const [name] of [...LINE_COLS].reverse()) {
    if (await knex.schema.hasColumn('mill_payroll_lines', name)) {
      await knex.schema.alterTable('mill_payroll_lines', (t) => t.dropColumn(name));
    }
  }
};
