// A document is never removed from disk or from document_store any more (owner
// decision 2026-10-07: "nothing is deleted without Owner/Super Admin approval").
// An approved deletion — or an Owner/Super Admin deleting directly — now marks
// the row 'Deleted' (is_latest = false) and keeps the file, so it stays in the
// version history with who deleted it (document_approvals, action 'delete') and
// an audit_logs row. The status CHECK from migration 296 has to admit 'Deleted'.
//
// No new columns: who/when is the document_approvals row. The constraint keeps
// its name (chk_document_store_status_valid), so the schema fingerprint (names
// only) is unchanged — backend/schema.baseline.txt needs no regeneration.
//
// down() restores the 296 whitelist and refuses while any row is 'Deleted':
// those are real history, and rewriting their status silently would hide that
// they were deleted.

const TABLE = 'document_store';
const NAME = 'chk_document_store_status_valid';
const OLD_VALUES = ['Draft', 'Pending Review', 'Approved', 'Final', 'Rejected', 'Superseded'];
const NEW_VALUES = [...OLD_VALUES, 'Deleted'];

function checkSql(values) {
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
  return `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAME}" CHECK (status IS NULL OR status::text = ANY (ARRAY[${list}]::text[]))`;
}

exports.OLD_VALUES = OLD_VALUES;
exports.NEW_VALUES = NEW_VALUES;
exports.checkSql = checkSql;

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable(TABLE))) return;
  await knex.raw(`ALTER TABLE "${TABLE}" DROP CONSTRAINT IF EXISTS "${NAME}"`);
  await knex.raw(checkSql(NEW_VALUES));
};

exports.down = async (knex) => {
  if (!(await knex.schema.hasTable(TABLE))) return;
  const row = await knex(TABLE).where({ status: 'Deleted' }).count('* as n').first();
  const n = Number(row && row.n) || 0;
  if (n > 0) {
    throw new Error(
      `Cannot roll back migration 316: ${n} document(s) are 'Deleted'. ` +
      'They are kept on purpose as history; resolve them before narrowing the CHECK.'
    );
  }
  await knex.raw(`ALTER TABLE "${TABLE}" DROP CONSTRAINT IF EXISTS "${NAME}"`);
  await knex.raw(checkSql(OLD_VALUES));
};
