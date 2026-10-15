/**
 * P3-08 / DAT-20 — one transporter, one hauler row (owner decision D-25b (a):
 * keep separate party tables; transporters live in `haulers` only).
 *
 * `haulers` had no unique name or phone, so the inline quick-add in every
 * picker could mint the same transporter twice and split its payables and
 * ledger across two rows. Two partial unique indexes over ACTIVE haulers:
 *
 *   uq_haulers_active_name    lower(btrim(name))
 *   uq_haulers_active_phone   the phone's digits (when it has any)
 *
 * Existing duplicates must not fail the deploy and must not be merged
 * automatically (merging parties needs a reviewed mapping). So this works like
 * a NOT VALID constraint: the later rows of each existing duplicate are left
 * out of the index by id (the earliest keeps the name / phone), with a count
 * logged; every NEW row and every edit is checked. The duplicates are listed
 * by scripts/detectTransportParty.js; once they are resolved (deactivated or
 * renamed), scripts/validateHaulerUnique.js rebuilds both indexes with no
 * exclusions. Runbook: docs/runbooks/transport-party-model.md. Indexes are
 * not in schema.baseline.txt.
 */
const INDEXES = [
  { name: 'uq_haulers_active_name', expr: 'lower(btrim(name))', where: 'is_active' },
  {
    name: 'uq_haulers_active_phone',
    expr: "regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')",
    where: "is_active AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') <> ''",
  },
];

async function duplicateIds(knex, { expr, where }) {
  const r = await knex.raw(`
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY ${expr} ORDER BY id) AS rn
      FROM haulers WHERE ${where}
    ) x WHERE rn > 1 ORDER BY id`);
  return r.rows.map((row) => parseInt(row.id, 10)).filter(Number.isInteger);
}

exports.INDEXES = INDEXES;
exports.duplicateIds = duplicateIds;

exports.up = async function up(knex) {
  for (const idx of INDEXES) {
    const ids = await duplicateIds(knex, idx);
    if (ids.length) {
      console.warn(`[393] ${ids.length} active hauler row(s) repeat an earlier ${idx.name.replace('uq_haulers_active_', '')} — left out of ${idx.name}; review with scripts/detectTransportParty.js.`);
    }
    const exclude = ids.length ? ` AND id NOT IN (${ids.join(', ')})` : '';
    await knex.raw(`DROP INDEX IF EXISTS ${idx.name}`);
    await knex.raw(`CREATE UNIQUE INDEX ${idx.name} ON haulers ((${idx.expr})) WHERE ${idx.where}${exclude}`);
  }
};

exports.down = async function down(knex) {
  for (const idx of INDEXES) await knex.raw(`DROP INDEX IF EXISTS ${idx.name}`);
};
