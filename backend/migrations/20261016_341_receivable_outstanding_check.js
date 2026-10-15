/**
 * A receivable's outstanding is what was expected less what was received
 * (P2-01 / EXP-01, invariant I-5).
 *
 *   chk_receivables_outstanding_equation
 *     status = 'Written Off'
 *     OR abs(outstanding − (expected_amount − received_amount)) <= 0.01
 *
 * A written-off receivable is exempt: it is closed with outstanding 0 whatever
 * was received (cancelling an order writes its receivables off that way).
 *
 * The contract-summary save used to rebuild a PAID receivable to fully owing
 * (outstanding = expected). Production may still hold such rows, and a CHECK
 * added over them would fail the deploy. So the constraint is added NOT VALID —
 * every new insert / update is checked from now on — and validated here only
 * when no existing row breaks it (a fresh or clean database). Elsewhere
 * scripts/detectReceivableOutstandingDrift.js finds the rows,
 * scripts/correctReceivableOutstandingDrift.js corrects them (dry-run by
 * default), and the runbook docs/runbooks/receivable-outstanding-correction.md
 * ends with the VALIDATE CONSTRAINT.
 *
 * No data is changed. down() drops the constraint.
 */

const NAME = 'chk_receivables_outstanding_equation';
const PREDICATE = "status = 'Written Off' OR abs(outstanding - (expected_amount - received_amount)) <= 0.01";

exports.up = async function up(knex) {
  const exists = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [NAME]);
  if (!exists.rows.length) {
    await knex.raw(`ALTER TABLE receivables ADD CONSTRAINT ${NAME} CHECK (${PREDICATE}) NOT VALID`);
  }
  const bad = await knex.raw(`SELECT count(*)::int AS n FROM receivables WHERE NOT (${PREDICATE})`);
  if (bad.rows[0].n === 0) {
    await knex.raw(`ALTER TABLE receivables VALIDATE CONSTRAINT ${NAME}`);
  }
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE receivables DROP CONSTRAINT IF EXISTS ${NAME}`);
};
