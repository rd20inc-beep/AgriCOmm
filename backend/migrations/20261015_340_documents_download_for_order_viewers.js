/**
 * Keep server PDF download for everyone who can open an export order (P1-08
 * follow-up).
 *
 * P1-08 put `GET /export-orders/:id/documents/.../pdf` and the bundle behind
 * `documents.download` as well as `export_orders.view`. Roles that view orders but
 * never held `documents.download` (on a fresh database: Finance Manager and the
 * Read-Only Auditor) would silently lose the PDF button. Behaviour-preserving:
 * grant `documents.download` to every role holding `export_orders.view` when this
 * runs; the owner can revoke it per role in Admin › Permissions.
 *
 * The role ids this migration added are kept in system_settings so down() removes
 * only those grants. Roles are resolved from the grants themselves, never by id.
 * Data-only: no schema/baseline impact. Idempotent.
 */

const MARKER = 'migration_340_documents_download_added_roles';

async function permId(knex, module, action) {
  const row = await knex('permissions').where({ module, action }).first('id');
  return row ? row.id : null;
}

exports.up = async function up(knex) {
  const download = await permId(knex, 'documents', 'download');
  const view = await permId(knex, 'export_orders', 'view');
  if (!download || !view) return;
  const viewers = (await knex('role_permissions').where('permission_id', view).select('role_id')).map((r) => r.role_id);
  const added = [];
  for (const roleId of viewers) {
    const has = await knex('role_permissions').where({ role_id: roleId, permission_id: download }).first();
    if (!has) {
      await knex('role_permissions').insert({ role_id: roleId, permission_id: download });
      added.push(roleId);
    }
  }
  if (added.length) {
    const prev = await knex('system_settings').where('key', MARKER).first();
    const all = [...new Set([...(prev ? JSON.parse(prev.value || '[]') : []), ...added])];
    if (prev) await knex('system_settings').where('key', MARKER).update({ value: JSON.stringify(all) });
    else await knex('system_settings').insert({ key: MARKER, value: JSON.stringify(all), category: 'system' });
  }
};

exports.down = async function down(knex) {
  const download = await permId(knex, 'documents', 'download');
  const row = await knex('system_settings').where('key', MARKER).first();
  if (download && row) {
    const roles = JSON.parse(row.value || '[]');
    if (roles.length) await knex('role_permissions').where('permission_id', download).whereIn('role_id', roles).del();
  }
  await knex('system_settings').where('key', MARKER).del();
};
