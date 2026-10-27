/**
 * Give three screens their own permission, so Admin › Permissions can hide them
 * per role (owner request 2026-10-27):
 *
 *   local_sales.view / local_sales.create
 *     Local Sales borrowed inventory.view OR finance.view (read) and
 *     inventory.create (write). The Export Manager needs inventory.view to
 *     reserve stock for shipments, so Local Sales could not be hidden from them.
 *
 *   mill_customers.view
 *     Mill Customers borrowed export_orders.view, so every export user saw the
 *     mill's local customers.
 *
 *   finance.view_dashboard
 *     Opens the Finance module (sidebar entry, Finance dashboard and its pages).
 *     The Mill Manager holds finance.view for Mill Finance (payables, bank
 *     balances, supplier statements); since the one sidebar (P5-04) that also
 *     showed them the company Finance dashboard. Party statements and every
 *     /api/finance read stay on finance.view.
 *
 *   reports.view_finance
 *     The company-finance reports: Money In / Out, cash forecast, executive
 *     summary, export / customer / country profitability, AR / AP, FX, P&L,
 *     cashflow, invoice + sales ledgers, scheduled report emails. Replaces the
 *     role-name block denyRoles('Mill Operator') on those routes, so it can be
 *     set per role.
 *
 *   mill_finance.view
 *     The money sections of Mill Finance (overview, transactions, parties,
 *     performance). Its payroll workspace stays on payroll.view.
 *
 * Grants preserve today's access EXCEPT what the owner asked to hide: Local
 * Sales and Mill Customers from the Export Manager; every finance screen (the
 * Finance module, the finance reports, Mill Finance) from the Mill Manager. The
 * Mill Manager also gets mill_customers.view (the mill's own customers).
 *
 * Roles are resolved by NAME (ids differ between prod and local). Idempotent.
 * Data-only (permissions + role_permissions rows): no schema/baseline impact.
 */

const NEW_PERMISSIONS = [
  { module: 'local_sales', action: 'view', description: 'View local sales, invoices and gate passes' },
  { module: 'local_sales', action: 'create', description: 'Record, edit and email local sales; quick-add local customers' },
  { module: 'mill_customers', action: 'view', description: 'View the Mill Customers page (local customers)' },
  { module: 'finance', action: 'view_dashboard', description: 'Open the Finance module and its dashboard (party statements need only finance.view)' },
  { module: 'reports', action: 'view_finance', description: 'Company finance reports: money in/out, cash forecast, profitability, AR/AP, P&L, cashflow, sales ledgers' },
  { module: 'mill_finance', action: 'view', description: 'Mill Finance money sections (payables, cash & bank, mill P&L); its payroll workspace needs payroll.view' },
];

async function permId(knex, module, action) {
  const row = await knex('permissions').where({ module, action }).first('id');
  return row ? row.id : null;
}

async function holders(knex, module, action) {
  const id = await permId(knex, module, action);
  if (!id) return [];
  return (await knex('role_permissions').where('permission_id', id).select('role_id')).map((r) => r.role_id);
}

async function roleIdsByName(knex, names) {
  return (await knex('roles').whereIn('name', names).select('id')).map((r) => r.id);
}

async function grant(knex, permissionId, roleIds) {
  for (const roleId of new Set(roleIds)) {
    const has = await knex('role_permissions').where({ role_id: roleId, permission_id: permissionId }).first();
    if (!has) await knex('role_permissions').insert({ role_id: roleId, permission_id: permissionId });
  }
}

async function ensurePermission(knex, perm) {
  let id = await permId(knex, perm.module, perm.action);
  if (!id) {
    const [inserted] = await knex('permissions').insert(perm).returning('id');
    id = typeof inserted === 'object' ? inserted.id : inserted;
  }
  return id;
}

const without = (ids, excluded) => ids.filter((id) => !excluded.includes(id));

exports.up = async function up(knex) {
  const ids = {};
  for (const perm of NEW_PERMISSIONS) ids[`${perm.module}.${perm.action}`] = await ensurePermission(knex, perm);

  const bypass = await roleIdsByName(knex, ['Owner', 'Super Admin']);
  const exportManager = await roleIdsByName(knex, ['Export Manager']);
  const millManager = await roleIdsByName(knex, ['Mill Manager']);
  const millOperator = await roleIdsByName(knex, ['Mill Operator']);

  // Local Sales — whoever passes the routes today, minus the Export Manager.
  const salesReaders = [...await holders(knex, 'inventory', 'view'), ...await holders(knex, 'finance', 'view')];
  await grant(knex, ids['local_sales.view'], without([...salesReaders, ...bypass], exportManager));
  await grant(knex, ids['local_sales.create'], without([...await holders(knex, 'inventory', 'create'), ...bypass], exportManager));

  // Mill Customers — today's export_orders.view holders minus the Export
  // Manager, plus the Mill Manager.
  await grant(knex, ids['mill_customers.view'],
    without([...await holders(knex, 'export_orders', 'view'), ...millManager, ...bypass], exportManager));

  // Finance module — every finance.view holder except the Mill Manager.
  await grant(knex, ids['finance.view_dashboard'],
    without([...await holders(knex, 'finance', 'view'), ...bypass], millManager));

  // Finance reports — reports.view holders minus the role-name block they
  // replace (Mill Operator) and minus the Mill Manager.
  await grant(knex, ids['reports.view_finance'],
    without([...await holders(knex, 'reports', 'view'), ...bypass], [...millOperator, ...millManager]));

  // Mill Finance — whoever opens it today (milling.view + reports.view_cost or
  // finance.view), minus the Mill Manager.
  const millViewers = await holders(knex, 'milling', 'view');
  const costViewers = [...await holders(knex, 'reports', 'view_cost'), ...await holders(knex, 'finance', 'view')];
  await grant(knex, ids['mill_finance.view'],
    without([...millViewers.filter((id) => costViewers.includes(id)), ...bypass], millManager));
};

exports.down = async function down(knex) {
  for (const perm of NEW_PERMISSIONS) {
    const id = await permId(knex, perm.module, perm.action);
    if (!id) continue;
    await knex('role_permissions').where('permission_id', id).del();
    await knex('permissions').where('id', id).del();
  }
};
