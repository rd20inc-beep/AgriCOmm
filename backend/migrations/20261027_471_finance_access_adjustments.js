/**
 * Finance access adjustments after mig 470 (owner requests 2026-10-27):
 *
 *   Export Manager — no company finance reports: revoke reports.view_finance,
 *     which mig 470 granted to every reports.view holder. Export profitability
 *     stays open to them through export_orders.view (reporting.routes.js
 *     exportReports).
 *   Mill Manager — keeps Mill Finance: grant mill_finance.view, which mig 470
 *     withheld. The Finance module and the company finance reports stay closed.
 *
 * Roles resolved by NAME. Idempotent. Data-only. down() reverses both.
 */

async function ids(knex, module, action, roleName) {
  const perm = await knex('permissions').where({ module, action }).first('id');
  const role = await knex('roles').where({ name: roleName }).first('id');
  return { perm: perm && perm.id, role: role && role.id };
}

async function grant(knex, module, action, roleName) {
  const { perm, role } = await ids(knex, module, action, roleName);
  if (!perm || !role) return;
  const has = await knex('role_permissions').where({ role_id: role, permission_id: perm }).first();
  if (!has) await knex('role_permissions').insert({ role_id: role, permission_id: perm });
}

async function revoke(knex, module, action, roleName) {
  const { perm, role } = await ids(knex, module, action, roleName);
  if (!perm || !role) return;
  await knex('role_permissions').where({ role_id: role, permission_id: perm }).del();
}

exports.up = async function up(knex) {
  await revoke(knex, 'reports', 'view_finance', 'Export Manager');
  await grant(knex, 'mill_finance', 'view', 'Mill Manager');
};

exports.down = async function down(knex) {
  await grant(knex, 'reports', 'view_finance', 'Export Manager');
  await revoke(knex, 'mill_finance', 'view', 'Mill Manager');
};
