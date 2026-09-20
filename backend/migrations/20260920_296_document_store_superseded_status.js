/**
 * `Superseded` is missing from the document_store status CHECK.
 *
 * The check allows Draft / Pending Review / Approved / Final / Rejected, but
 * the service writes 'Superseded' when a newer version replaces an older one
 * (documents.service uploadNewVersion). Postgres rejected it with
 * chk_document_store_status_valid, so the request 500'd — uploading a new
 * version of a stored document has never worked.
 *
 * This is the table's OWN lifecycle status, alongside the is_latest and
 * previous_version_id columns that exist for exactly this. It is NOT the
 * generated-document workflow leaking in here — those stay in
 * generated_documents, which has its own statuses.
 *
 * Idempotent.
 */

const ALLOWED = ['Draft', 'Pending Review', 'Approved', 'Final', 'Rejected', 'Superseded'];
const PREVIOUS = ['Draft', 'Pending Review', 'Approved', 'Final', 'Rejected'];
const CONSTRAINT = 'chk_document_store_status_valid';

function checkSql(values) {
  const list = values.map((v) => `'${v}'`).join(', ');
  return `CHECK (status IS NULL OR status::text = ANY (ARRAY[${list}]::text[]))`;
}

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('document_store'))) return;
  await knex.raw(`ALTER TABLE document_store DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  await knex.raw(`ALTER TABLE document_store ADD CONSTRAINT ${CONSTRAINT} ${checkSql(ALLOWED)}`);
};

exports.down = async (knex) => {
  if (!(await knex.schema.hasTable('document_store'))) return;
  // Anything already marked Superseded would violate the narrower check.
  await knex('document_store').where({ status: 'Superseded' }).update({ status: 'Draft' });
  await knex.raw(`ALTER TABLE document_store DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  await knex.raw(`ALTER TABLE document_store ADD CONSTRAINT ${CONSTRAINT} ${checkSql(PREVIOUS)}`);
};
