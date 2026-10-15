/**
 * Final settlements are kept when reversed, and a worker can hold only one
 * active settlement (P2-11 / D-23).
 *
 *   mill_final_settlements.status  'active' | 'reversed' (reversing used to
 *       DELETE the row, losing the record of a payout that happened)
 *   reversed_at / reversed_by / reversal_reason
 *   uq_mill_final_settlements_active_worker — UNIQUE (worker_id) WHERE active,
 *       so two racing settlements cannot both pay a leaver.
 *
 * A worker who already holds more than one settlement blocks the index: the
 * migration stops and names the count. Run
 * backend/scripts/detectPayrollDuplicates.js, resolve the duplicates by
 * reversal (docs/runbooks/payroll-duplicate-guards.md), then migrate again.
 */

const COLS = [
  ['status', (t) => t.string('status', 20).notNullable().defaultTo('active')],
  ['reversed_at', (t) => t.timestamp('reversed_at', { useTz: true }).nullable()],
  ['reversed_by', (t) => t.integer('reversed_by').nullable().references('id').inTable('users').onDelete('SET NULL')],
  ['reversal_reason', (t) => t.text('reversal_reason').nullable()],
];

exports.up = async (knex) => {
  for (const [name, add] of COLS) {
    if (!(await knex.schema.hasColumn('mill_final_settlements', name))) {
      await knex.schema.alterTable('mill_final_settlements', add);
    }
  }
  await knex.raw('ALTER TABLE mill_final_settlements DROP CONSTRAINT IF EXISTS chk_mill_final_settlements_status_valid');
  await knex.raw("ALTER TABLE mill_final_settlements ADD CONSTRAINT chk_mill_final_settlements_status_valid CHECK (status IN ('active', 'reversed'))");

  const dup = await knex.raw(`
    SELECT COUNT(*)::int AS n FROM (
      SELECT worker_id FROM mill_final_settlements WHERE status = 'active'
      GROUP BY worker_id HAVING COUNT(*) > 1
    ) d`);
  const n = dup.rows[0].n;
  if (n > 0) {
    throw new Error(`${n} worker(s) hold more than one active final settlement. Run scripts/detectPayrollDuplicates.js and resolve them (docs/runbooks/payroll-duplicate-guards.md) before migrating.`);
  }
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mill_final_settlements_active_worker
    ON mill_final_settlements (worker_id) WHERE status = 'active'`);
};

exports.down = async (knex) => {
  const rev = await knex('mill_final_settlements').where('status', 'reversed').count('* as n').first();
  if (Number(rev && rev.n) > 0) throw new Error(`Cannot roll back: ${rev.n} settlement(s) are kept as reversed.`);
  await knex.raw('DROP INDEX IF EXISTS uq_mill_final_settlements_active_worker');
  await knex.raw('ALTER TABLE mill_final_settlements DROP CONSTRAINT IF EXISTS chk_mill_final_settlements_status_valid');
  for (const [name] of [...COLS].reverse()) {
    if (await knex.schema.hasColumn('mill_final_settlements', name)) {
      await knex.schema.alterTable('mill_final_settlements', (t) => t.dropColumn(name));
    }
  }
};
