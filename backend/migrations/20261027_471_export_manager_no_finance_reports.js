/**
 * The Export Manager does not see the company finance reports (owner request
 * 2026-10-27): revoke reports.view_finance, which mig 470 granted to every
 * reports.view holder. Export profitability stays open to them through
 * export_orders.view (reporting.routes.js exportReports).
 *
 * Role resolved by NAME. Idempotent. Data-only. down() restores the grant.
 */

async function ids(knex) {
  const perm = await knex('permissions').where({ module: 'reports', action: 'view_finance' }).first('id');
  const role = await knex('roles').where({ name: 'Export Manager' }).first('id');
  return { perm: perm && perm.id, role: role && role.id };
}

exports.up = async function up(knex) {
  const { perm, role } = await ids(knex);
  if (!perm || !role) return;
  await knex('role_permissions').where({ role_id: role, permission_id: perm }).del();
};

exports.down = async function down(knex) {
  const { perm, role } = await ids(knex);
  if (!perm || !role) return;
  const has = await knex('role_permissions').where({ role_id: role, permission_id: perm }).first();
  if (!has) await knex('role_permissions').insert({ role_id: role, permission_id: perm });
};
