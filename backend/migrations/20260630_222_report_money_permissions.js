/**
 * Split report money visibility into two grantable permissions (P6b):
 *   reports.view_cost   — cost & stock-value figures
 *   reports.view_profit — profit, margin & revenue figures
 *
 * Until now any role with reports.view saw every cost/profit number. These let
 * an admin create a "sees stock but not the money" role by revoking one or both.
 *
 * Non-regressive: granted to EVERY role that currently has reports.view, EXCEPT
 * Mill Operator (the canonical production-only / money-blind role, already kept
 * off the finance ledgers via denyRoles). Granted by role NAME — role ids differ
 * between prod and local. Data-only (inserts rows); no schema change, so the
 * committed schema.baseline.txt is unaffected.
 */
const NEW_PERMS = [
  { module: 'reports', action: 'view_cost', description: 'View cost & stock-value figures in reports' },
  { module: 'reports', action: 'view_profit', description: 'View profit, margin & revenue figures in reports' },
];
const GRANT_ROLE_NAMES = ['Super Admin', 'Owner', 'Export Manager', 'Finance Manager', 'Mill Manager', 'Read-Only Auditor'];

exports.up = async function up(knex) {
  // 1. Ensure the permissions exist.
  for (const def of NEW_PERMS) {
    const existing = await knex('permissions').where({ module: def.module, action: def.action }).first();
    if (!existing) await knex('permissions').insert(def);
  }
  const permIds = (await knex('permissions').where('module', 'reports').whereIn('action', ['view_cost', 'view_profit']).select('id')).map((p) => p.id);

  // 2. Grant to the target roles (resolve by name; skip rows that already exist).
  const roles = await knex('roles').whereIn('name', GRANT_ROLE_NAMES).select('id');
  for (const r of roles) {
    for (const pid of permIds) {
      const has = await knex('role_permissions').where({ role_id: r.id, permission_id: pid }).first();
      if (!has) await knex('role_permissions').insert({ role_id: r.id, permission_id: pid });
    }
  }
};

exports.down = async function down(knex) {
  const permIds = (await knex('permissions').where('module', 'reports').whereIn('action', ['view_cost', 'view_profit']).select('id')).map((p) => p.id);
  if (permIds.length) {
    await knex('role_permissions').whereIn('permission_id', permIds).del();
    await knex('permissions').whereIn('id', permIds).del();
  }
};
