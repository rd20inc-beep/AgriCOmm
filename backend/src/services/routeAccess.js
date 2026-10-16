/**
 * Which in-app pages a user may open — the ProtectedRoute requirements of the
 * frontend routes (src/App.jsx, Standard shell) that notifications and the
 * approvals inbox link to. A link is only handed to a user who can open it, so
 * nobody is sent to a page that bounces them to the dashboard.
 *
 * Keep in step with App.jsx: approvalsInboxLinks.test.js checks every path
 * here still exists as a route there.
 */
const { can } = require('./accessContext');

const LOCAL_SALE_VIEW = [['inventory', 'view'], ['finance', 'view']];

// path: the App.jsx route; allOf / anyOf: the permissions its ProtectedRoute
// (and any parent route) asks for.
const ROUTES = [
  { path: '/export/:id', allOf: [['export_orders', 'view']] },
  // Static /milling/* pages first — /milling/:id would otherwise match them.
  { path: '/milling/finance', allOf: [['milling', 'view']], anyOf: [['reports', 'view_cost'], ['finance', 'view']] },
  { path: '/milling/:id', allOf: [['milling', 'view']] },
  { path: '/lot-inventory/:id', allOf: [['inventory', 'view']] },
  { path: '/local-sales/:id', anyOf: LOCAL_SALE_VIEW },
  { path: '/purchase-requirements', anyOf: [['milling', 'view'], ['inventory', 'view'], ['finance', 'view']] },
  { path: '/stock-adjustments', allOf: [['inventory', 'view']] },
  { path: '/stock-count', allOf: [['inventory', 'view']] },
  { path: '/mill-store/adjustments', allOf: [['mill_store', 'view']] },
  { path: '/documents', allOf: [['documents', 'view']] },
  { path: '/admin', allOf: [['admin', 'view']] },
  { path: '/exceptions', allOf: [['admin', 'view']] },
  { path: '/approvals', allOf: [] },
  // /finance/* is wrapped in ProtectedRoute finance.view; payroll adds payroll.view.
  { path: '/finance', allOf: [['finance', 'view']] },
  { path: '/finance/money-in/to-confirm', allOf: [['finance', 'view']] },
  { path: '/finance/payroll', allOf: [['finance', 'view'], ['payroll', 'view']] },
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toRegex = (path) => new RegExp(`^${path.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : escape(seg))).join('/')}$`);
const COMPILED = ROUTES.map((r) => ({ ...r, re: toRegex(r.path) }));

function routeFor(link) {
  if (!link || typeof link !== 'string') return null;
  const path = link.split(/[?#]/)[0];
  return COMPILED.find((r) => r.re.test(path)) || null;
}

/** True when `access` may open `link`. Unknown paths are refused. */
function canOpen(access, link) {
  const r = routeFor(link);
  if (!r || !access) return false;
  if (r.allOf && !r.allOf.every(([m, a]) => can(access, m, a))) return false;
  if (r.anyOf && !r.anyOf.some(([m, a]) => can(access, m, a))) return false;
  return true;
}

/** The link if `access` may open it, else null. */
const safeLink = (access, link) => (canOpen(access, link) ? link : null);

module.exports = { ROUTES, routeFor, canOpen, safeLink };
