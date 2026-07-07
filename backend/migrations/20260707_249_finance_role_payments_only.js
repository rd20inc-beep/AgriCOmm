// Tighten the Finance Manager role to "payments only", per the domain-separation
// principle (Finance handles PAYMENT only — never customer/order/rice detail,
// mill internal stock, or admin). The role had accumulated broad VIEW grants from
// early seeds/migrations that predate the masking work:
//   - export_orders.view          → the Export Orders nav + full order detail pages
//   - mill_store.view             → Mill → Stock Overview
//   - mill_store.approve_adjustment
//   - admin.view                  → Approvals / Audit / Admin nav
// Finance KEEPS finance.*, reports.*, payroll (view/approve/pay/export) and the
// export payment confirm perms (export_orders.confirm_advance/confirm_balance) —
// the pending-receipt inbox + confirm run on finance.view / finance.confirm_payment,
// so payment confirmation is unaffected.
//
// Data-only change (role_permissions rows) — no schema/baseline impact.

const REMOVE = [
  ['export_orders', 'view'],
  ['mill_store', 'view'],
  ['mill_store', 'approve_adjustment'],
  ['admin', 'view'],
];

async function financeRoleIds(knex) {
  const roles = await knex('roles').where('name', 'Finance Manager').select('id');
  return roles.map((r) => r.id);
}

exports.up = async (knex) => {
  const roleIds = await financeRoleIds(knex);
  if (!roleIds.length) return;
  for (const [module, action] of REMOVE) {
    const perm = await knex('permissions').where({ module, action }).first('id');
    if (!perm) continue;
    await knex('role_permissions').whereIn('role_id', roleIds).where('permission_id', perm.id).del();
  }
};

exports.down = async (knex) => {
  const roleIds = await financeRoleIds(knex);
  if (!roleIds.length) return;
  for (const [module, action] of REMOVE) {
    const perm = await knex('permissions').where({ module, action }).first('id');
    if (!perm) continue;
    for (const roleId of roleIds) {
      const exists = await knex('role_permissions').where({ role_id: roleId, permission_id: perm.id }).first();
      if (!exists) await knex('role_permissions').insert({ role_id: roleId, permission_id: perm.id });
    }
  }
};
