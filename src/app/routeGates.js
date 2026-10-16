// The ONE route table's permission gates (P5-05). Every in-shell route is
// listed here with the gate the backend applies to the data that page loads;
// routeTable.jsx pairs each path with its page component, the sidebar
// (navConfig.js) and the phone bottom bar (lib/mobileNavItems.js) show a
// destination only when canOpen(path) is true — so a link the user can see is
// a page the user can open, in every workspace.
//
// Gate shape = <ProtectedRoute> props: { module, action, anyOf }.
//   module+action  → required
//   anyOf          → at least one of these is also required
//   null           → any signed-in user
import { matchRoutes } from 'react-router-dom';

const p = (module, action) => ({ module, action });

// Who may open the money pages (purchase rates, stock value, mill finance) —
// the same rule as useCanSeeCost / backend utils/costVisibility.
export const COST_VIEWERS = [p('reports', 'view_cost'), p('finance', 'view')];

const INV_OR_FIN = { anyOf: [p('inventory', 'view'), p('finance', 'view')] };
const REPORTS = p('reports', 'view');
const ADMIN = p('admin', 'view');
const PAYROLL = p('payroll', 'view');

// Approval permissions (D-20). The inbox page is open to every signed-in user
// and filters each item type by its own permission; the old admin approvals
// page (/approvals/legacy) keeps its admin.view gate.
export const APPROVER_PERMS = [
  p('admin', 'view'),
  p('master_data', 'approve'),
  p('documents', 'approve'),
  p('mill_store', 'approve_adjustment'),
  p('inventory', 'approve_write_off'),
  p('payroll', 'approve'),
  p('export_orders', 'approve'),
];

// Order matters only for readability — matchRoutes ranks static segments over
// dynamic ones, so /export/create can never fall into /export/:id.
export const ROUTE_GATES = [
  { path: '/', gate: null },
  { path: '/profile', gate: null },
  { path: '/change-password', gate: null },
  { path: '/approvals', gate: null },
  { path: '/approvals/legacy', gate: ADMIN },

  // Export
  { path: '/export', gate: p('export_orders', 'view') },
  { path: '/export/create', gate: p('export_orders', 'create') },
  { path: '/export/:id', gate: p('export_orders', 'view') },
  { path: '/buyers', gate: p('export_orders', 'view') },
  { path: '/documents', gate: p('documents', 'view') },

  // Finance (its own nested table — see FinanceRoutes)
  { path: '/finance/*', gate: p('finance', 'view') },

  // Milling
  { path: '/milling', gate: p('milling', 'view') },
  { path: '/milling/service', gate: p('service_milling', 'view') },
  { path: '/service-milling/invoices', gate: p('service_milling', 'view_invoice') },
  { path: '/service-milling/:id', gate: p('service_milling', 'view') },
  // Mill money pages: the page's first load (/api/milling/finance-kpis,
  // /rice-purchases) is milling.view + requireCostVisibility.
  { path: '/milling/finance', gate: { ...p('milling', 'view'), anyOf: COST_VIEWERS } },
  { path: '/milling/rice-purchases', gate: { ...p('milling', 'view'), anyOf: COST_VIEWERS } },
  { path: '/milling/customers', gate: p('export_orders', 'view') },
  { path: '/milling/suppliers', gate: p('milling', 'view') },
  // Statements read /api/accounting/statements/* (finance.view).
  { path: '/milling/statements', gate: p('finance', 'view') },
  { path: '/milling/:id', gate: p('milling', 'view') },
  { path: '/quality', gate: p('milling', 'view') },
  { path: '/sample-analysis', gate: { anyOf: [p('inventory', 'view'), p('milling', 'view')] } },
  { path: '/purchase-requirements', gate: { anyOf: [p('milling', 'view'), p('inventory', 'view'), p('finance', 'view')] } },

  // Inventory
  { path: '/inventory', gate: p('inventory', 'view') },
  { path: '/lot-inventory', gate: p('inventory', 'view') },
  { path: '/lot-inventory/:id', gate: p('inventory', 'view') },
  { path: '/lot-inventory/:id/purchase-invoice', gate: { ...p('inventory', 'view'), anyOf: COST_VIEWERS } },
  { path: '/stock-summary', gate: p('inventory', 'view') },
  { path: '/stock-count', gate: p('inventory', 'view') },
  { path: '/stock-adjustments', gate: p('inventory', 'view') },
  // Stock transfers (Mill ⇄ Export) — one page; was also /finance/accounting/stock-transfers.
  { path: '/transfer', gate: INV_OR_FIN },
  { path: '/local-sales', gate: INV_OR_FIN },
  { path: '/local-sales/:id', gate: INV_OR_FIN },
  { path: '/local-sales/:id/invoice', gate: INV_OR_FIN },
  { path: '/local-sales/:id/print', gate: INV_OR_FIN },

  // Mill Store
  { path: '/mill-store', gate: p('mill_store', 'view') },
  { path: '/mill-store/purchases/new', gate: p('mill_store', 'view') },
  { path: '/mill-store/alerts', gate: p('mill_store', 'view') },
  { path: '/mill-store/adjustments', gate: p('mill_store', 'view') },
  { path: '/mill-store/ratios', gate: p('mill_store', 'view') },

  // Reports — salaries are payroll.view only (P1-06 / D-24).
  { path: '/reports', gate: REPORTS },
  { path: '/reports/print', gate: REPORTS },
  { path: '/reports/lots', gate: REPORTS },
  { path: '/reports/invoices', gate: REPORTS },
  { path: '/reports/payroll', gate: PAYROLL },
  { path: '/reports/payroll-analytics', gate: PAYROLL },
  { path: '/reports/lot-ledger/:id', gate: REPORTS },
  { path: '/reports/batch-ledger/:id', gate: REPORTS },
  { path: '/reports/supplier-ledger', gate: REPORTS },
  { path: '/reports/supplier-ledger/:id', gate: REPORTS },
  { path: '/reports/rice-type-ledger', gate: REPORTS },
  { path: '/reports/rice-type-ledger/:id', gate: REPORTS },
  { path: '/reports/warehouse-ledger', gate: REPORTS },
  { path: '/reports/warehouse-ledger/:id', gate: REPORTS },
  { path: '/reports/processing-loss-ledger', gate: REPORTS },
  { path: '/reports/finished-goods-ledger', gate: REPORTS },
  { path: '/reports/service-milling-stock', gate: REPORTS },
  { path: '/reports/service-milling-ageing', gate: REPORTS },
  { path: '/reports/service-milling-pending-dispatch', gate: REPORTS },
  { path: '/reports/service-milling-reconciliation', gate: REPORTS },
  { path: '/reports/inventory-movement-ledger', gate: REPORTS },
  { path: '/reports/stock-ledger', gate: REPORTS },

  // Insights & administration
  { path: '/ai', gate: { anyOf: COST_VIEWERS } },
  { path: '/exceptions', gate: ADMIN },
  { path: '/intelligence', gate: ADMIN },
  { path: '/simulator', gate: ADMIN },
  { path: '/audit', gate: ADMIN },
  { path: '/admin', gate: ADMIN },
];

/** True when hasPermission satisfies a gate (same rule as <ProtectedRoute>). */
export function passesGate(gate, hasPermission) {
  if (!gate) return true;
  if (gate.module && gate.action && !hasPermission(gate.module, gate.action)) return false;
  if (Array.isArray(gate.anyOf) && gate.anyOf.length > 0) {
    return gate.anyOf.some((g) => hasPermission(g.module, g.action));
  }
  return true;
}

const MATCH_TABLE = ROUTE_GATES.map((r) => ({ path: r.path }));
const GATE_BY_PATH = new Map(ROUTE_GATES.map((r) => [r.path, r.gate]));

/** The route-table path a URL resolves to (null = no route: the "not available" page). */
export function matchRoutePath(url) {
  const pathname = String(url || '/').split(/[?#]/)[0] || '/';
  const hit = matchRoutes(MATCH_TABLE, pathname);
  return hit ? hit[hit.length - 1].route.path : null;
}

/** Can this user open this URL? Unknown URLs are never openable. */
export function canOpen(url, hasPermission) {
  const path = matchRoutePath(url);
  if (!path) return false;
  return passesGate(GATE_BY_PATH.get(path), hasPermission);
}

export function gateFor(path) {
  return GATE_BY_PATH.get(path) ?? null;
}
