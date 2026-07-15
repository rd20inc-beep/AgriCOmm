// Registry of destinations that can appear on the phone bottom-nav bar. A role's
// config (roles.mobile_nav → user.mobileNav) is an ordered list of these keys; the
// bar renders those the user is permitted to see, plus a fixed "Menu" button. The
// DB only stores keys — routes/icons/labels/permissions live here.
import {
  LayoutDashboard, Package, Factory, ShoppingCart, Boxes, Store, Ship,
  DollarSign, BarChart3, FlaskConical, ArrowRightLeft, ShieldCheck, ClipboardCheck,
} from 'lucide-react';

// key → { path, icon, label, perm: [module, action] | null (null = always allowed) }
export const MOBILE_NAV_ITEMS = [
  { key: 'home', path: '/', icon: LayoutDashboard, label: 'Home', end: true, perm: null },
  { key: 'inventory', path: '/lot-inventory', icon: Package, label: 'Stock', perm: ['inventory', 'view'] },
  { key: 'milling', path: '/milling', icon: Factory, label: 'Mill', perm: ['milling', 'view'] },
  { key: 'sales', path: '/local-sales', icon: ShoppingCart, label: 'Sales', perm: ['inventory', 'view'] },
  { key: 'stock-summary', path: '/stock-summary', icon: Boxes, label: 'Summary', perm: ['inventory', 'view'] },
  { key: 'mill-store', path: '/mill-store', icon: Store, label: 'Store', perm: ['mill_store', 'view'] },
  { key: 'stock-take', path: '/stock-count', icon: ClipboardCheck, label: 'Count', perm: ['inventory', 'view'] },
  { key: 'transfers', path: '/transfer', icon: ArrowRightLeft, label: 'Transfers', perm: ['inventory', 'view'] },
  { key: 'quality', path: '/quality', icon: FlaskConical, label: 'Quality', perm: ['milling', 'view'] },
  { key: 'export', path: '/export', icon: Ship, label: 'Export', perm: ['export_orders', 'view'] },
  { key: 'finance', path: '/finance', icon: DollarSign, label: 'Finance', perm: ['finance', 'view'] },
  { key: 'reports', path: '/reports', icon: BarChart3, label: 'Reports', perm: ['reports', 'view'] },
  { key: 'approvals', path: '/admin', icon: ShieldCheck, label: 'Approvals', perm: ['admin', 'view'] },
];

export const MOBILE_NAV_BY_KEY = Object.fromEntries(MOBILE_NAV_ITEMS.map((i) => [i.key, i]));

// Fallback when a role has no configured set.
export const DEFAULT_MOBILE_NAV = ['home', 'inventory', 'milling', 'sales'];

// Resolve the keys a role should show into concrete items the user may access.
// Falls back to the default set, filters by permission, and caps at 4 (the bar
// always adds a "Menu" button as the 5th slot).
export function resolveMobileNav(configKeys, hasPermission) {
  const keys = Array.isArray(configKeys) && configKeys.length ? configKeys : DEFAULT_MOBILE_NAV;
  const items = keys
    .map((k) => MOBILE_NAV_BY_KEY[k])
    .filter(Boolean)
    .filter((it) => !it.perm || hasPermission(it.perm[0], it.perm[1]));
  return items.slice(0, 4);
}
