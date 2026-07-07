// Enforce the Finance Manager "payments only" permission ALLOWLIST.
//
// mig 249 removed 4 known-bad grants, but a prod-only audit revealed the role had
// been MANUALLY over-provisioned beyond the seed (milling.view, milling.manage_costs,
// inventory.view/create/adjust, mill_store.create_purchase/manage_items/
// record_consumption/request_adjustment) — still exposing mill & inventory detail.
// A fixed removal list can't catch arbitrary manual drift, so this migration
// enforces the allowlist directly: delete every Finance Manager role_permission
// whose module is not finance/reports/payroll and which is not one of the two
// export payment-confirm perms.
//
// ALLOW: finance.* , reports.* , payroll.* , export_orders.{confirm_advance,confirm_balance}
// Data-only (role_permissions) — no schema/baseline impact.

const ALLOW_MODULES = ['finance', 'reports', 'payroll'];
const ALLOW_EXPORT_ACTIONS = ['confirm_advance', 'confirm_balance'];

exports.up = async (knex) => {
  const roleIds = (await knex('roles').where('name', 'Finance Manager').select('id')).map((r) => r.id);
  if (!roleIds.length) return;

  const keep = await knex('permissions')
    .where(function () {
      this.whereIn('module', ALLOW_MODULES).orWhere(function () {
        this.where('module', 'export_orders').whereIn('action', ALLOW_EXPORT_ACTIONS);
      });
    })
    .select('id');
  const keepIds = keep.map((p) => p.id);

  await knex('role_permissions')
    .whereIn('role_id', roleIds)
    .modify((qb) => { if (keepIds.length) qb.whereNotIn('permission_id', keepIds); })
    .del();
};

// Not reversible — the prior set included undocumented manual grants that can't be
// reconstructed. No-op down (the allowlist is the intended steady state).
exports.down = async () => {};
