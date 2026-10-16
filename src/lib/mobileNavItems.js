// Registry of destinations that can appear on the phone bottom-nav bar. A role's
// config (roles.mobile_nav → user.mobileNav) is an ordered list of these keys; the
// bar renders those the user is permitted to see, plus a fixed "Menu" button. The
// DB only stores keys — routes/icons/labels live here. Whether an item shows
// is decided by the route table's gate for its path (app/routeGates.canOpen),
// the same rule the sidebar and <ProtectedRoute> use, so a tab is never a
// page that would answer Access Denied.
import {
  LayoutDashboard, Package, Factory, ShoppingCart, Boxes, Store, Ship,
  DollarSign, BarChart3, FlaskConical, ArrowRightLeft, ShieldCheck, ClipboardCheck,
} from 'lucide-react';
import { canOpen } from '../app/routeGates';

// key → { path, icon, label }
export const MOBILE_NAV_ITEMS = [
  { key: 'home', path: '/', icon: LayoutDashboard, label: 'Home', end: true },
  { key: 'inventory', path: '/lot-inventory', icon: Package, label: 'Stock' },
  { key: 'milling', path: '/milling', icon: Factory, label: 'Mill' },
  { key: 'sales', path: '/local-sales', icon: ShoppingCart, label: 'Sales' },
  { key: 'stock-summary', path: '/stock-summary', icon: Boxes, label: 'Summary' },
  { key: 'mill-store', path: '/mill-store', icon: Store, label: 'Store' },
  { key: 'stock-take', path: '/stock-count', icon: ClipboardCheck, label: 'Count' },
  { key: 'transfers', path: '/transfer', icon: ArrowRightLeft, label: 'Transfers' },
  { key: 'quality', path: '/quality', icon: FlaskConical, label: 'Quality' },
  { key: 'export', path: '/export', icon: Ship, label: 'Export' },
  { key: 'finance', path: '/finance', icon: DollarSign, label: 'Finance' },
  { key: 'reports', path: '/reports', icon: BarChart3, label: 'Reports' },
  { key: 'approvals', path: '/approvals', icon: ShieldCheck, label: 'Approvals' },
];

export const MOBILE_NAV_BY_KEY = Object.fromEntries(MOBILE_NAV_ITEMS.map((i) => [i.key, i]));

// Fallback when a role has no configured set.
export const DEFAULT_MOBILE_NAV = ['home', 'inventory', 'milling', 'sales'];

// Fallback per workspace (app/workspace.resolveWorkspace) — an Export or
// Finance user without a configured set gets their own destinations rather
// than the mill's.
export const DEFAULT_MOBILE_NAV_BY_WORKSPACE = {
  mill: DEFAULT_MOBILE_NAV,
  standard: DEFAULT_MOBILE_NAV,
  export: ['home', 'export', 'finance', 'reports'],
  finance: ['finance', 'reports', 'approvals'],
};

// Resolve the keys a role should show into concrete items the user may open.
// Falls back to the workspace's default set, keeps only items whose route the
// user can open, and caps at 4 (the bar always adds a "Menu" button as the
// 5th slot).
export function resolveMobileNav(configKeys, hasPermission, workspace = 'standard') {
  const fallback = DEFAULT_MOBILE_NAV_BY_WORKSPACE[workspace] || DEFAULT_MOBILE_NAV;
  const keys = Array.isArray(configKeys) && configKeys.length ? configKeys : fallback;
  const items = keys
    .map((k) => MOBILE_NAV_BY_KEY[k])
    .filter(Boolean)
    .filter((it) => canOpen(it.path, hasPermission));
  return items.slice(0, 4);
}
