/**
 * Additive "Mill Operator" role — a finance-free production operator.
 *
 * Phase 4 of the reporting improvement plan. Purely ADDITIVE: it creates a new
 * role and grants it a production-only permission set. It does NOT touch any
 * existing role, permission, or user. No existing user is assigned to it, so
 * nothing changes until an admin assigns someone.
 *
 * Permission set = production work + reports view, with NO finance, export,
 * admin, master-data, document, or reports.export permissions — so the Mill
 * Operator can run the mill and see production/processing reports, but never
 * profit, margin, receivables, payables, cashflow or net profit.
 */

const ROLE_NAME = 'Mill Operator';
const GRANTS = {
  reports: ['view'],
  milling: ['view', 'create', 'edit', 'add_vehicle', 'record_yield', 'approve_quality'],
  inventory: ['view'],
  mill_store: ['view', 'record_consumption', 'create_purchase', 'request_adjustment'],
};

exports.up = async function (knex) {
  // ─── Role (idempotent) ───
  let role = await knex('roles').where('name', ROLE_NAME).first();
  if (!role) {
    const [inserted] = await knex('roles')
      .insert({ name: ROLE_NAME, description: 'Runs the mill — production & processing only, no finance visibility.' })
      .returning(['id']);
    role = typeof inserted === 'object' ? inserted : { id: inserted };
  }
  const roleId = role.id;

  // ─── Resolve permission ids for the grants ───
  const wantPairs = [];
  for (const [module, actions] of Object.entries(GRANTS)) {
    for (const action of actions) wantPairs.push({ module, action });
  }
  const perms = await knex('permissions')
    .whereIn('module', Object.keys(GRANTS))
    .select('id', 'module', 'action');
  const permId = Object.fromEntries(perms.map((p) => [`${p.module}.${p.action}`, p.id]));

  const rows = wantPairs
    .map((w) => permId[`${w.module}.${w.action}`])
    .filter(Boolean)
    .map((permission_id) => ({ role_id: roleId, permission_id }));

  // ─── Insert role_permissions, skipping any that already exist ───
  if (rows.length) {
    const existing = await knex('role_permissions')
      .where('role_id', roleId)
      .whereIn('permission_id', rows.map((r) => r.permission_id))
      .select('permission_id');
    const have = new Set(existing.map((e) => e.permission_id));
    const fresh = rows.filter((r) => !have.has(r.permission_id));
    if (fresh.length) await knex('role_permissions').insert(fresh);
  }
};

exports.down = async function (knex) {
  const role = await knex('roles').where('name', ROLE_NAME).first();
  if (!role) return;
  // Only remove the role if no user is assigned to it (safety).
  const inUse = await knex('users').where('role_id', role.id).first();
  if (inUse) return;
  await knex('role_permissions').where('role_id', role.id).del();
  await knex('roles').where('id', role.id).del();
};
