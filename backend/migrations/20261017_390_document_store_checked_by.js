/**
 * Maker/checker stamp on stored documents (P3-17, owner decision D-17 (a)).
 *
 *   document_store.checked_by  integer NULL → users.id
 *   document_store.checked_at  timestamptz NULL
 *
 * Who approved the stored file and when. A required export document passes
 * the pre-shipment gate only when its live file carries this stamp; uploads
 * are live at once (owner decision 2026-10-06) but unchecked until a second
 * person approves them (documents.service.approveDocument refuses the
 * uploader unless they are the Owner, as generated documents already do).
 *
 * Backfill: a file already approved through document_approvals keeps that
 * approval as its check — the latest 'approve' row, when it was made by
 * someone other than the uploader or by an Owner. Files made live by the
 * upload itself have no approval row and stay unchecked: they need a second
 * person before they count (scripts/detect-export-gate-failures.js lists the
 * open orders affected).
 *
 * down() drops both columns.
 */

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('document_store', 'checked_by'))) {
    await knex.schema.alterTable('document_store', (t) => {
      t.integer('checked_by').nullable().references('id').inTable('users');
      t.timestamp('checked_at', { useTz: true }).nullable();
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_document_store_checked_by ON document_store (checked_by)');
  }

  await knex.raw(`
    UPDATE document_store ds
       SET checked_by = a.approver_id, checked_at = a.created_at
      FROM (SELECT DISTINCT ON (da.document_id) da.document_id, da.approver_id, da.created_at
              FROM document_approvals da
             WHERE da.action = 'approve' AND da.approver_id IS NOT NULL
             ORDER BY da.document_id, da.created_at DESC, da.id DESC) a
      LEFT JOIN users u ON u.id = a.approver_id
      LEFT JOIN roles r ON r.id = u.role_id
     WHERE a.document_id = ds.id
       AND ds.checked_by IS NULL
       AND ds.status IN ('Approved', 'Final')
       AND (ds.uploaded_by IS NULL OR ds.uploaded_by <> a.approver_id OR r.name = 'Owner')`);
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('document_store', 'checked_by')) {
    await knex.raw('DROP INDEX IF EXISTS idx_document_store_checked_by');
    await knex.schema.alterTable('document_store', (t) => {
      t.dropColumn('checked_by');
      t.dropColumn('checked_at');
    });
  }
};
