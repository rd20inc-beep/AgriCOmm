/**
 * P2-24 — one gate pass, one sale (LS-12), enforced by the database.
 *
 * The app refused a duplicate gate pass with a read before the save, outside
 * the transaction, so two saves racing could both pass it. A unique index
 * makes the second one fail (the controller answers 409).
 *
 * A multi-item sale writes the same gate pass on every line of its
 * sale_group_no, so the index covers only the group's HEAD line (the first
 * line, whose sale_no IS the group number; legacy rows with no group count as
 * their own head) and ignores rejected (Cancelled) sales — exactly the rows
 * findGatePassConflict compares.
 *
 * Existing duplicates must not fail the deploy: they are found first and the
 * later rows of each duplicated pass are left out of the index by id (the
 * earliest keeps the number), with a count logged. Those rows are listed for
 * review by scripts/detectLocalSaleMoney.js (runbook:
 * docs/runbooks/local-sale-money.md). On a clean database the index has no
 * exclusions. Indexes are not in schema.baseline.txt, so the baseline is the
 * same either way.
 */
const NAME = 'uq_local_sales_gate_pass_head';
const HEAD = "gate_pass_no IS NOT NULL AND (status IS NULL OR status <> 'Cancelled') AND (sale_group_no IS NULL OR sale_group_no = sale_no)";

exports.up = async function up(knex) {
  const dupes = await knex.raw(`
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY gate_pass_no ORDER BY id) AS rn
      FROM local_sales WHERE ${HEAD}
    ) x WHERE rn > 1 ORDER BY id`);
  const ids = dupes.rows.map((r) => parseInt(r.id, 10)).filter(Number.isInteger);
  if (ids.length) {
    console.warn(`[365] ${ids.length} local-sale row(s) repeat an earlier gate pass — left out of ${NAME}; review with scripts/detectLocalSaleMoney.js.`);
  }
  const exclude = ids.length ? ` AND id NOT IN (${ids.join(', ')})` : '';
  await knex.raw(`DROP INDEX IF EXISTS ${NAME}`);
  await knex.raw(`CREATE UNIQUE INDEX ${NAME} ON local_sales (gate_pass_no) WHERE ${HEAD}${exclude}`);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${NAME}`);
};
