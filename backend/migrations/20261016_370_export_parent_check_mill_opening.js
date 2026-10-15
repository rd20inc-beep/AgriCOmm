/**
 * chk_receivables_export_parent (migration 342) applies to export receivables
 * only. Go-live opening balances for mill customers (RCV-OPEN-…, entity 'mill',
 * type 'Balance') are real debts with no export order; Money In already settles
 * them against 1120. They kept the CHECK NOT VALID on production.
 *
 * Re-added NOT VALID with mill receivables exempt, then validated when no row
 * breaks it (same pattern as 342).
 */
const NAME = 'chk_receivables_export_parent';
const OLD = "type IS NULL OR type NOT IN ('Advance', 'Balance') OR order_id IS NOT NULL";
const NEW = `entity = 'mill' OR ${OLD}`;

async function replace(knex, predicate) {
  await knex.raw(`ALTER TABLE receivables DROP CONSTRAINT IF EXISTS ${NAME}`);
  await knex.raw(`ALTER TABLE receivables ADD CONSTRAINT ${NAME} CHECK (${predicate}) NOT VALID`);
  const bad = await knex.raw(`SELECT count(*)::int AS n FROM receivables WHERE NOT (${predicate})`);
  if (bad.rows[0].n === 0) await knex.raw(`ALTER TABLE receivables VALIDATE CONSTRAINT ${NAME}`);
}

exports.up = (knex) => replace(knex, NEW);
exports.down = (knex) => replace(knex, OLD);
