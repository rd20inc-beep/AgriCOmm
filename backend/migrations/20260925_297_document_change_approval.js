/**
 * Document changes take effect only once an Owner/Super Admin approves them.
 *
 * Two parts.
 *
 * 1. WHO APPROVES. `documents.approve` was granted to the Export Manager and the
 *    Documentation Officer, so the people making a change could approve it
 *    themselves — the gate existed but decided nothing. It now sits with Super
 *    Admin and Owner only, matching how salary advances, fund transfers and
 *    export cancellations are already owner-gated. Every other documents
 *    permission (view / upload / create / edit / download / reject) is left
 *    alone: the Export Manager must keep working without interruption, and
 *    only the moment a change becomes live is gated.
 *
 * 2. A PENDING DELETION NEEDS SOMEWHERE TO LIVE. A replacement is already
 *    representable — a new row awaiting approval, with the approved one still
 *    current — but a deletion had nowhere to be recorded, and there was no
 *    delete endpoint at all. `pending_action` marks a row as requested for
 *    deletion without removing anything; approving it performs the delete,
 *    rejecting it clears the flag and the file stays.
 *
 * Idempotent.
 */

const APPROVE_KEEPS = ['Super Admin', 'Owner'];

exports.up = async (knex) => {
  // ── 1. approval right ──
  const perm = await knex('permissions').where({ module: 'documents', action: 'approve' }).first('id');
  if (perm) {
    const keepIds = (await knex('roles').whereIn('name', APPROVE_KEEPS).select('id')).map((r) => r.id);
    await knex('role_permissions')
      .where('permission_id', perm.id)
      .whereNotIn('role_id', keepIds.length ? keepIds : [-1])
      .del();
  }

  // ── 2. pending deletion ──
  if (!(await knex.schema.hasTable('document_store'))) return;
  if (!(await knex.schema.hasColumn('document_store', 'pending_action'))) {
    await knex.schema.alterTable('document_store', (t) => {
      t.string('pending_action', 20).nullable();
      t.integer('pending_by').nullable();
      t.timestamp('pending_at', { useTz: true }).nullable();
    });
  }
  await knex.raw(`ALTER TABLE document_store DROP CONSTRAINT IF EXISTS chk_document_store_pending_action_valid`);
  await knex.raw(
    `ALTER TABLE document_store ADD CONSTRAINT chk_document_store_pending_action_valid
     CHECK (pending_action IS NULL OR pending_action = 'delete')`
  );
};

exports.down = async (knex) => {
  if (await knex.schema.hasTable('document_store')) {
    await knex.raw(`ALTER TABLE document_store DROP CONSTRAINT IF EXISTS chk_document_store_pending_action_valid`);
    if (await knex.schema.hasColumn('document_store', 'pending_action')) {
      await knex.schema.alterTable('document_store', (t) => {
        t.dropColumn('pending_action');
        t.dropColumn('pending_by');
        t.dropColumn('pending_at');
      });
    }
  }
  // Restore approve to the roles that hold documents.upload (the pre-migration set).
  const perm = await knex('permissions').where({ module: 'documents', action: 'approve' }).first('id');
  const uploadPerm = await knex('permissions').where({ module: 'documents', action: 'upload' }).first('id');
  if (!perm || !uploadPerm) return;
  const roleIds = (await knex('role_permissions').where('permission_id', uploadPerm.id).select('role_id')).map((r) => r.role_id);
  for (const roleId of roleIds) {
    const exists = await knex('role_permissions').where({ role_id: roleId, permission_id: perm.id }).first();
    if (!exists) await knex('role_permissions').insert({ role_id: roleId, permission_id: perm.id });
  }
};
