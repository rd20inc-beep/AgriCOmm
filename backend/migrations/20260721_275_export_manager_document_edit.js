/**
 * Export Manager: edit export documents.
 *
 * Saving edits/overrides on a generated export document (Commercial Invoice,
 * Packing List, etc.) goes through PUT /documents/:genId/overrides, gated by
 * `export_orders.edit`. Grant that permission to the Export Manager role so it
 * can edit the documents. Data-only (a role_permissions row); no schema change,
 * so schema.baseline.txt is unaffected. Idempotent + resolves role + permission
 * by name (ids differ prod/local) — no-op if the grant already exists.
 */
exports.up = async function up(knex) {
  const role = await knex('roles').where('name', 'Export Manager').first();
  const perm = await knex('permissions').where({ module: 'export_orders', action: 'edit' }).first();
  if (!role || !perm) return;
  const has = await knex('role_permissions').where({ role_id: role.id, permission_id: perm.id }).first();
  if (!has) await knex('role_permissions').insert({ role_id: role.id, permission_id: perm.id });
};

exports.down = async function down(knex) {
  const role = await knex('roles').where('name', 'Export Manager').first();
  const perm = await knex('permissions').where({ module: 'export_orders', action: 'edit' }).first();
  if (role && perm) await knex('role_permissions').where({ role_id: role.id, permission_id: perm.id }).del();
};
