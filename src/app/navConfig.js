// The one sidebar (P5-04 / D-21). Seven primary destinations, the approvals
// inbox pinned beside them (never hidden under Show More), the infrequent
// modules in an expandable "Show More" group, and a compact quick-action menu.
//
// Visibility is derived from the route table: an entry shows only when the
// user can open its route (routeGates.canOpen) — there is no second, drifting
// copy of the permission rules here. `requires` adds an extra condition for
// an entry whose route is open to more people than the entry is useful to.
import {
  LayoutDashboard, Truck, Factory, Boxes, Ship, DollarSign, BarChart3,
  ShieldCheck, FlaskConical, Package, FileText, ShoppingCart, ClipboardEdit,
  ClipboardCheck, AlertTriangle, ArrowRightLeft, Sparkles, Brain, Beaker, Zap,
  Shield, Settings, Plus, ArrowDownLeft, ArrowUpRight, Printer, Users,
} from 'lucide-react';
import { canOpen, passesGate, APPROVER_PERMS } from './routeGates';

const p = (module, action) => ({ module, action });

// ── Primary (≤ 7) ────────────────────────────────────────────────────────
export const PRIMARY_NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/' },
  {
    key: 'purchases', label: 'Purchases & Lots', icon: Truck,
    children: [
      { label: 'Rice Purchases', to: '/milling/rice-purchases', icon: Truck },
      { label: 'Lot Inventory', to: '/lot-inventory', icon: Package },
      { label: 'Purchase Requirements', to: '/purchase-requirements', icon: ShoppingCart, badgeKey: 'purchaseReqs' },
      { label: 'Suppliers', to: '/milling/suppliers', icon: Users },
    ],
  },
  {
    key: 'milling', label: 'Milling', icon: Factory,
    children: [
      { label: 'Operations', to: '/milling', icon: Factory },
      { label: 'Mill Finance', to: '/milling/finance', icon: DollarSign },
      { label: 'Local Sales', to: '/local-sales', icon: ShoppingCart },
      { label: 'Mill Customers', to: '/milling/customers', icon: Users },
    ],
  },
  { key: 'inventory', label: 'Inventory', icon: Boxes, to: '/stock-summary' },
  {
    key: 'export', label: 'Export Orders', icon: Ship,
    children: [
      { label: 'All Orders', to: '/export', icon: Ship },
      { label: 'Buyers', to: '/buyers', icon: Users },
    ],
  },
  { key: 'finance', label: 'Finance', icon: DollarSign, to: '/finance' },
  {
    key: 'reports', label: 'Reports', icon: BarChart3,
    children: [
      { label: 'Reports', to: '/reports', icon: BarChart3 },
      { label: 'Print Reports', to: '/reports/print', icon: Printer },
    ],
  },
];

// Pinned under the primary list — urgent, so never inside Show More. Every
// signed-in user gets it (the inbox lists only what they may act on).
export const PINNED_NAV = [
  { key: 'approvals', label: 'Approvals', icon: ShieldCheck, to: '/approvals', badgeKey: 'approvals' },
];

// ── Show More (infrequent modules) ───────────────────────────────────────
export const MORE_NAV = [
  { label: 'Quality Comparison', to: '/quality', icon: FlaskConical },
  { label: 'Sample Analysis', to: '/sample-analysis', icon: FlaskConical },
  { label: 'Service Milling', to: '/milling/service', icon: Package },
  { label: 'Service Invoices', to: '/service-milling/invoices', icon: FileText },
  { label: 'Mill Store', to: '/mill-store', icon: ShoppingCart },
  { label: 'Store Adjustments', to: '/mill-store/adjustments', icon: ClipboardEdit },
  { label: 'Stock Take', to: '/stock-count', icon: ClipboardCheck },
  { label: 'Stock Adjustments', to: '/stock-adjustments', icon: AlertTriangle },
  { label: 'Stock transfers', to: '/transfer', icon: ArrowRightLeft },
  { label: 'Documents', to: '/documents', icon: FileText },
  { label: 'AI Assistant', to: '/ai', icon: Sparkles },
  { label: 'Analytics', to: '/intelligence', icon: Brain },
  { label: 'Simulator', to: '/simulator', icon: Beaker },
  { label: 'Exceptions', to: '/exceptions', icon: Zap },
  { label: 'Audit Trail', to: '/audit', icon: Shield },
  { label: 'Admin', to: '/admin', icon: Settings },
];

// ── Quick actions ────────────────────────────────────────────────────────
// Each opens the existing form (deep link or Finance drawer) — nothing is
// posted from here; the form keeps its own review/confirmation. `requires` is
// the create permission the backend checks on submit; the target route's own
// gate applies as well.
const PAYS = [p('finance', 'confirm_payment'), p('milling', 'edit')];
export const QUICK_ACTIONS = [
  { key: 'purchase', label: 'Create Purchase', icon: Truck, to: '/lot-inventory?action=new', requires: p('inventory', 'create') },
  { key: 'batch', label: 'New Batch', icon: Factory, to: '/milling?new=1', requires: p('milling', 'create') },
  { key: 'export', label: 'Create Export Order', icon: Plus, to: '/export/create', requires: p('export_orders', 'create') },
  // Receive / Pay open the Finance payment picker in place (reads
  // /api/finance receivables/payables → finance.view).
  { key: 'receive', label: 'Receive', icon: ArrowDownLeft, drawer: 'receive', to: '/finance/money-in', requires: { anyOf: PAYS } },
  { key: 'pay', label: 'Pay', icon: ArrowUpRight, drawer: 'pay', to: '/finance/money-out', requires: { anyOf: PAYS } },
];

function itemVisible(item, hasPermission) {
  if (!item.to) return false;
  if (item.requires && !passesGate(item.requires, hasPermission)) return false;
  return canOpen(item.to, hasPermission);
}

function pruneItem(item, hasPermission) {
  if (!item.children) return itemVisible(item, hasPermission) ? { ...item } : null;
  const children = item.children.filter((c) => itemVisible(c, hasPermission));
  if (children.length === 0) return null;
  return { ...item, children };
}

/**
 * The sidebar a user sees.
 *   workspace — from resolveWorkspace(); the Dashboard entry is dropped for
 *               the finance workspace (its home IS Finance).
 */
export function buildNav(hasPermission, { workspace = 'standard' } = {}) {
  const primary = PRIMARY_NAV
    .filter((item) => !(item.key === 'dashboard' && workspace === 'finance'))
    .map((item) => pruneItem(item, hasPermission))
    .filter(Boolean);
  const pinned = PINNED_NAV.filter((item) => itemVisible(item, hasPermission));
  const more = MORE_NAV.filter((item) => itemVisible(item, hasPermission));
  return { primary, pinned, more };
}

export function visibleQuickActions(hasPermission) {
  return QUICK_ACTIONS.filter((a) => itemVisible(a, hasPermission));
}

export function isApprover(hasPermission) {
  return APPROVER_PERMS.some((g) => hasPermission(g.module, g.action));
}

/** Every leaf route the sidebar can link to (tests: each resolves to a real route). */
export function allNavTargets() {
  const leaves = [];
  for (const item of [...PRIMARY_NAV, ...PINNED_NAV, ...MORE_NAV]) {
    if (item.children) leaves.push(...item.children.map((c) => [c.to, c.label]));
    else leaves.push([item.to, item.label]);
  }
  return leaves;
}
