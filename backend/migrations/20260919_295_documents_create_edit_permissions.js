/**
 * The documents module gated four routes on permissions that do not exist.
 *
 * `authorize('documents', 'create')` guards upload, document create, PDF
 * generate and checklist create; `authorize('documents', 'edit')` guards
 * document update and new-version. Neither `documents.create` nor
 * `documents.edit` is in the permissions catalogue — it only ever held
 * view / upload / download / approve / reject — so `userHasPermission` could
 * never return true and every one of those routes was Super Admin only (Super
 * Admin bypasses the check entirely). That is why document_store is empty: an
 * Export Manager holding `documents.upload` was refused on upload, because
 * nothing checks `upload` and the route wanted a permission nobody can hold.
 *
 * Adds the two missing permissions and grants them to the roles already trusted
 * with documents — the ones holding `documents.upload` today (Super Admin,
 * Export Manager, Documentation Officer, Owner). Read-Only Auditor keeps view
 * only, deliberately.
 *
 * Data-only (permissions + role_permissions rows) — no schema/baseline impact.
 * Idempotent.
 */

const NEW_PERMISSIONS = [
  { module: 'documents', action: 'create', description: 'Upload documents, generate PDFs and create checklists' },
  { module: 'documents', action: 'edit', description: 'Update a stored document and add new versions' },
];

// Grant to whoever can already upload — that is the existing definition of
// "trusted with documents" in this system, rather than a fresh list of names.
async function trustedRoleIds(knex) {
  const uploadPerm = await knex('permissions').where({ module: 'documents', action: 'upload' }).first('id');
  if (!uploadPerm) return [];
  const rows = await knex('role_permissions').where('permission_id', uploadPerm.id).select('role_id');
  return rows.map((r) => r.role_id);
}

exports.up = async (knex) => {
  const roleIds = await trustedRoleIds(knex);

  for (const perm of NEW_PERMISSIONS) {
    let row = await knex('permissions').where({ module: perm.module, action: perm.action }).first('id');
    if (!row) {
      const [inserted] = await knex('permissions').insert(perm).returning('id');
      row = typeof inserted === 'object' ? inserted : { id: inserted };
    }
    for (const roleId of roleIds) {
      const exists = await knex('role_permissions').where({ role_id: roleId, permission_id: row.id }).first();
      if (!exists) await knex('role_permissions').insert({ role_id: roleId, permission_id: row.id });
    }
  }
};

exports.down = async (knex) => {
  for (const perm of NEW_PERMISSIONS) {
    const row = await knex('permissions').where({ module: perm.module, action: perm.action }).first('id');
    if (!row) continue;
    await knex('role_permissions').where('permission_id', row.id).del();
    await knex('permissions').where('id', row.id).del();
  }
};
