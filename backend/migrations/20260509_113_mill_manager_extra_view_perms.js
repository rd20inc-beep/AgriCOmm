/**
 * Grant Mill Manager the cross-module view permissions the FE needs.
 *
 * Symptom: when recording yield (or any other primary mill workflow),
 * the FE pre-loads customers / warehouses / bag types / bank accounts
 * / commodity rates / export orders to populate dropdowns + context
 * panels. With only milling.* + inventory.* + reports.view,
 * Mill Manager hits 403 on:
 *   GET /api/customers              (export_orders.view)
 *   GET /api/admin/warehouses       (admin.view)
 *   GET /api/admin/bag-types        (admin.view)
 *   GET /api/admin/settings         (admin.view)
 *   GET /api/finance/bank-accounts  (finance.view)
 *   GET /api/finance/commodity-rates(finance.view)
 *   GET /api/export-orders          (export_orders.view)
 *
 * These are all read-only; Mill Manager already has full milling
 * authority + lot create/edit, so giving them visibility into the
 * adjacent reference data has no security cost and unblocks the UI.
 *
 * Grants:
 *   - export_orders.view  → see linked orders + buyer info
 *   - admin.view          → read-only admin (warehouses / bag types
 *                           / settings / mills / document templates)
 *   - finance.view        → bank accounts + commodity rates dropdowns
 *
 * Idempotent (ON CONFLICT DO NOTHING).
 */

const TARGETS = [
  ['export_orders', 'view'],
  ['admin', 'view'],
  ['finance', 'view'],
];

exports.up = async function (knex) {
  const role = await knex('roles').where({ name: 'Mill Manager' }).first('id');
  if (!role) {
    // eslint-disable-next-line no-console
    console.warn('[round33+] Mill Manager role not found; skipping.');
    return;
  }
  for (const [mod, action] of TARGETS) {
    const p = await knex('permissions').where({ module: mod, action }).first('id');
    if (!p) continue;
    await knex.raw(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES (?, ?) ON CONFLICT DO NOTHING`,
      [role.id, p.id]
    );
  }
};

exports.down = async function (knex) {
  const role = await knex('roles').where({ name: 'Mill Manager' }).first('id');
  if (!role) return;
  for (const [mod, action] of TARGETS) {
    const p = await knex('permissions').where({ module: mod, action }).first('id');
    if (!p) continue;
    await knex('role_permissions').where({ role_id: role.id, permission_id: p.id }).del();
  }
};
