// Which home dashboard a user lands on (D-21). Chosen from the permission set,
// never from the literal role name, so a renamed or custom role still gets the
// right home:
//   mill     — runs the mill (milling.edit) but cannot create export orders
//              → Mill home (Mill Manager, Mill Operator)
//   export   — creates export orders but does not run the mill
//              → Export home (Export Manager)
//   finance  — money only: finance.view and none of the operational views the
//              company Dashboard is built from → the Finance home (/finance)
//   standard — everyone else (Owner, Super Admin, auditors, QC, inventory)
//              → the company Dashboard
// Owner and Super Admin pass every check (AuthContext), so they are standard.

const DASHBOARD_VIEWS = [
  ['export_orders', 'view'],
  ['milling', 'view'],
  ['inventory', 'view'],
  ['admin', 'view'],
];

export function resolveWorkspace(hasPermission) {
  if (typeof hasPermission !== 'function') return 'standard';
  const runsMill = hasPermission('milling', 'edit');
  const createsExports = hasPermission('export_orders', 'create');
  if (runsMill && !createsExports) return 'mill';
  if (createsExports && !runsMill) return 'export';
  const seesDashboard = DASHBOARD_VIEWS.some(([m, a]) => hasPermission(m, a));
  if (!seesDashboard && hasPermission('finance', 'view')) return 'finance';
  return 'standard';
}

export const WORKSPACE_LABELS = {
  mill: { title: 'MILL OPERATIONS', subtitle: 'Agri Commodities' },
  export: { title: 'EXPORT DESK', subtitle: 'Agri Commodities' },
  finance: { title: 'AGRI COMMODITIES', subtitle: 'Serving Natural Nutrition' },
  standard: { title: 'AGRI COMMODITIES', subtitle: 'Serving Natural Nutrition' },
};
