/**
 * Dedicated payroll permission module (Phase 5).
 *
 * Replaces the old mix of `milling.*` + hardcoded authorizeRole/denyRoles gates
 * on the payroll routes with a clean `payroll.*` module. ADDITIVE + idempotent:
 * it seeds the permissions and grants them to the appropriate roles. The route
 * gates switch to these permissions in the same release.
 *
 * Access matrix (Super Admin bypasses everything; Owner granted full so the FE,
 * which only auto-bypasses Super Admin, also shows payroll for Owner):
 *   Owner            → view create edit approve pay export delete (full)
 *   Finance Manager  → view approve pay export        (owns payment/approval)
 *   Mill Manager     → view create edit export         (prepares; no approve/pay)
 *   Read-Only Auditor→ view export                     (reports only)
 * Mill Operator / QC Analyst / Export Manager → none (no payroll access).
 */
const ACTIONS = [
  ['view', 'View payroll, employees, attendance, advances and reports'],
  ['create', 'Create employees/attendance/advances and prepare payroll runs'],
  ['edit', 'Edit employee records'],
  ['approve', 'Approve prepared payroll runs, void runs, manage the schedule'],
  ['pay', 'Pay approved payroll runs (posts salary expense + recovers advances)'],
  ['export', 'Export/print payroll reports and payslips'],
  ['delete', 'Delete employees/advances and reverse paid payroll runs'],
];
const GRANTS = {
  'Owner': ['view', 'create', 'edit', 'approve', 'pay', 'export', 'delete'],
  'Finance Manager': ['view', 'approve', 'pay', 'export'],
  'Mill Manager': ['view', 'create', 'edit', 'export'],
  'Read-Only Auditor': ['view', 'export'],
};

exports.up = async function up(knex) {
  // 1) Seed the payroll permissions (skip any that already exist).
  const existingPerms = await knex('permissions').where('module', 'payroll').select('action');
  const have = new Set(existingPerms.map((p) => p.action));
  const fresh = ACTIONS.filter(([a]) => !have.has(a)).map(([action, description]) => ({ module: 'payroll', action, description }));
  if (fresh.length) await knex('permissions').insert(fresh);

  // 2) Resolve permission ids.
  const perms = await knex('permissions').where('module', 'payroll').select('id', 'action');
  const permId = Object.fromEntries(perms.map((p) => [p.action, p.id]));

  // 3) Grant per role (by name → all matching role rows, entity-agnostic). Skip existing.
  for (const [roleName, actions] of Object.entries(GRANTS)) {
    const roles = await knex('roles').where('name', roleName).select('id');
    for (const role of roles) {
      const wantIds = actions.map((a) => permId[a]).filter(Boolean);
      const existing = await knex('role_permissions').where('role_id', role.id).whereIn('permission_id', wantIds).select('permission_id');
      const haveIds = new Set(existing.map((e) => e.permission_id));
      const rows = wantIds.filter((id) => !haveIds.has(id)).map((permission_id) => ({ role_id: role.id, permission_id }));
      if (rows.length) await knex('role_permissions').insert(rows);
    }
  }
};

exports.down = async function down(knex) {
  const perms = await knex('permissions').where('module', 'payroll').select('id');
  const ids = perms.map((p) => p.id);
  if (ids.length) await knex('role_permissions').whereIn('permission_id', ids).del();
  await knex('permissions').where('module', 'payroll').del();
};
