// Finance information architecture — the single source of truth for the six
// workspaces, their views, which views honour the period selector, and where
// every pre-redesign /finance/* URL now lives.
//
// URL scheme: a workspace is /finance/<workspace>, its default view is the
// workspace path itself, every other view is /finance/<workspace>/<view>.
// The period travels as ?range= on every link (see withRange).
//
// period: 'range'  — the page filters by the selected period
//         'asOf'   — the page shows balances as at the end of the period
//         false    — the page is not filtered by period (selector hidden)
import {
  LayoutDashboard, ArrowDownLeft, ArrowUpRight, Landmark, BookOpen, Users,
} from 'lucide-react';

// The period choices (?range=). '' = all time.
export const PERIOD_PRESETS = [
  { value: '', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
];
export function rangeLabel(rangeKey) {
  return (PERIOD_PRESETS.find((p) => p.value === (rangeKey || '')) || PERIOD_PRESETS[0]).label;
}

const PAYS = [{ module: 'finance', action: 'confirm_payment' }, { module: 'milling', action: 'edit' }];

export const WORKSPACES = [
  {
    key: 'home', label: 'Home', path: '/finance', icon: LayoutDashboard,
    views: [{ key: 'home', label: 'Home', path: '/finance', period: 'range' }],
  },
  {
    key: 'money-in', label: 'Money In', path: '/finance/money-in', icon: ArrowDownLeft, badge: 'pendingReceipts',
    views: [
      { key: 'receivables', label: 'Receivables', path: '/finance/money-in', period: 'range' },
      { key: 'to-confirm', label: 'To confirm', path: '/finance/money-in/to-confirm', period: false, badge: 'pendingReceipts' },
      { key: 'local-sales', label: 'Local sales', path: '/finance/money-in/local-sales', period: 'range' },
      // Leaves the Finance workspace (the service-milling module owns it).
      { key: 'service-invoices', label: 'Service invoices', path: '/service-milling/invoices', external: true,
        permission: { module: 'service_milling', action: 'view_invoice' } },
    ],
  },
  {
    key: 'money-out', label: 'Money Out', path: '/finance/money-out', icon: ArrowUpRight,
    views: [
      { key: 'payables', label: 'Payables', path: '/finance/money-out', period: 'range' },
      { key: 'purchases', label: 'Purchases', path: '/finance/money-out/purchases', period: 'range' },
      { key: 'expenses', label: 'Expenses', path: '/finance/money-out/expenses', period: 'range' },
    ],
  },
  {
    key: 'accounts', label: 'Accounts', path: '/finance/accounts', icon: Landmark,
    views: [
      { key: 'cash', label: 'Cash & bank', path: '/finance/accounts', period: 'range' },
      { key: 'cheques', label: 'Cheques', path: '/finance/accounts/cheques', period: false },
      { key: 'suspense', label: 'Suspense', path: '/finance/accounts/suspense', period: false },
    ],
  },
  {
    key: 'accounting', label: 'Accounting', path: '/finance/accounting', icon: BookOpen,
    views: [
      { key: 'journal', label: 'Journal', path: '/finance/accounting', period: 'range' },
      // The three GL statements are read-only screens over
      // GET /api/accounting/statements/* — all behind finance.view.
      { key: 'trial-balance', label: 'Trial balance', path: '/finance/accounting/trial-balance', period: 'asOf',
        permission: { module: 'finance', action: 'view' } },
      { key: 'pnl', label: 'P&L', path: '/finance/accounting/pnl', period: 'range',
        permission: { module: 'finance', action: 'view' } },
      { key: 'balance-sheet', label: 'Balance sheet', path: '/finance/accounting/balance-sheet', period: 'asOf',
        permission: { module: 'finance', action: 'view' } },
      { key: 'profit', label: 'Profit', path: '/finance/accounting/profit', period: false },
      { key: 'statements', label: 'Statements', path: '/finance/accounting/statements', period: 'range' },
      { key: 'rates', label: 'Rates', path: '/finance/accounting/rates', period: false },
      // Mill → Export STOCK moves (internal_transfers), not money: bank-to-bank
      // moves are Accounts → Transfer. Same finance.view gate as the API
      // (GET /api/finance/internal-transfers) and the old /finance/transfers.
      { key: 'stock-transfers', label: 'Stock transfers', path: '/finance/accounting/stock-transfers', period: false,
        permission: { module: 'finance', action: 'view' } },
    ],
  },
  {
    key: 'payroll', label: 'Payroll', path: '/finance/payroll', icon: Users,
    permission: { module: 'payroll', action: 'view' },
    views: [{ key: 'payroll', label: 'Payroll', path: '/finance/payroll', period: false }],
  },
];

// Pages that keep a route but sit in no workspace. Alerts is reached from
// Home's alerts panel; the two orphans stay URL-only (nothing links to them).
// The old stock-transfer orphan (/finance/transfers) is now Accounting's
// "Stock transfers" view; its URL redirects there.
const UNLISTED = [
  { path: '/finance/alerts', workspace: 'home', period: false },
  { path: '/finance/costs', workspace: 'home', period: false },
  { path: '/finance/reconciliation', workspace: 'home', period: false },
];

// Every pre-redesign /finance/<segment> → its new home. The query string is
// carried over untouched (?type=&id= on statements, ?action=new on expenses,
// ?range= everywhere).
export const LEGACY_FINANCE_REDIRECTS = {
  'purchases': '/finance/money-out/purchases',
  'expenses': '/finance/money-out/expenses',
  'local-sales': '/finance/money-in/local-sales',
  'confirmations': '/finance/money-in/to-confirm',
  'receivables': '/finance/money-in',
  'payables': '/finance/money-out',
  'cash': '/finance/accounts',
  'due-dates': '/finance/accounts/cheques',
  'suspense': '/finance/accounts/suspense',
  'rates': '/finance/accounting/rates',
  'profit': '/finance/accounting/profit',
  'profitability': '/finance/accounting/profit',
  'statements': '/finance/accounting/statements',
  'ledger': '/finance/accounting',
  'transfers': '/finance/accounting/stock-transfers',
};

const has = (hasPermission, p) => !p || hasPermission(p.module, p.action);
const hasAny = (hasPermission, list) => list.some((p) => hasPermission(p.module, p.action));

// The workspaces (and their views) this user may see.
export function visibleWorkspaces(hasPermission) {
  return WORKSPACES
    .filter((w) => has(hasPermission, w.permission))
    .map((w) => ({ ...w, views: w.views.filter((v) => has(hasPermission, v.permission)) }));
}

// '/finance/x/' → '/finance/x'
function trimPath(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  return p || '/';
}

// Which workspace + view a pathname belongs to. Unknown finance paths fall
// back to Home (the catch-all route redirects them there anyway).
export function matchFinanceLocation(pathname) {
  const path = trimPath(pathname);
  for (const w of WORKSPACES) {
    const view = w.views.find((v) => !v.external && v.path === path);
    if (view) return { workspace: w, view };
  }
  const unlisted = UNLISTED.find((u) => u.path === path);
  if (unlisted) {
    const workspace = WORKSPACES.find((w) => w.key === unlisted.workspace);
    return { workspace, view: { key: path, path, period: unlisted.period, unlisted: true } };
  }
  return { workspace: WORKSPACES[0], view: WORKSPACES[0].views[0] };
}

// A finance link that carries the current period. Only ?range= travels —
// view-specific params (party, filters) stay with their view.
export function withRange(path, rangeKey) {
  if (!rangeKey) return path;
  const [base, query = ''] = String(path).split('?');
  const params = new URLSearchParams(query);
  if (!params.has('range')) params.set('range', rangeKey);
  return `${base}?${params.toString()}`;
}

// Where a pre-redesign finance URL lives now, with its query string kept.
// Returns null when the path is not a legacy one.
export function legacyFinanceTarget(pathname, search = '') {
  const path = trimPath(pathname);
  const m = path.match(/^\/finance\/([^/]+)$/);
  if (!m) return null;
  const target = LEGACY_FINANCE_REDIRECTS[m[1]];
  if (!target) return null;
  const qs = String(search || '').replace(/^\?/, '');
  return qs ? `${target}?${qs}` : target;
}

// Rewrites any internal link (e.g. an alert's server-built `link`) that still
// points at an old finance path to its new home; other links pass through.
export function resolveFinanceLink(link) {
  if (!link || typeof link !== 'string') return link;
  const [path, query = ''] = link.split('?');
  return legacyFinanceTarget(path, query) || link;
}

// A server-built link (alert, notification) made current: old finance paths
// resolved, and the period carried when it stays inside Finance.
export function financeHref(link, rangeKey) {
  const resolved = resolveFinanceLink(link);
  if (typeof resolved !== 'string' || !resolved.startsWith('/finance')) return resolved;
  return withRange(resolved, rangeKey);
}

// The four header actions. Each one lands on the page that owns the form and
// opens it where an entry point exists. Gated by what the server needs:
// recording a receipt / payment / contra is finance.confirm_payment or (for
// the mill's own money) milling.edit; creating an expense is
// finance.allocate_cost.
export const HEADER_ACTIONS = [
  { key: 'receive', label: 'Receive', path: '/finance/money-in', anyOf: PAYS },
  { key: 'pay', label: 'Pay', path: '/finance/money-out', anyOf: PAYS },
  { key: 'transfer', label: 'Transfer', path: '/finance/accounts?action=transfer', anyOf: PAYS },
  { key: 'expense', label: 'Expense', path: '/finance/money-out/expenses?action=new',
    anyOf: [{ module: 'finance', action: 'allocate_cost' }] },
];

export function visibleHeaderActions(hasPermission) {
  return HEADER_ACTIONS.filter((a) => hasAny(hasPermission, a.anyOf));
}

// The one header action shown filled (primary) in a workspace: the action
// that belongs to it — Receive in Money In, Pay in Money Out (Expense on its
// Expenses view), Transfer in Accounts — else Receive, else the first one.
// Presentation only: every visible action stays available.
export function primaryHeaderAction(actions, workspaceKey, viewKey) {
  const keys = actions.map((a) => a.key);
  const want = viewKey === 'expenses' ? 'expense'
    : { 'money-in': 'receive', 'money-out': 'pay', accounts: 'transfer' }[workspaceKey] || 'receive';
  if (keys.includes(want)) return want;
  return keys.includes('receive') ? 'receive' : (keys[0] || null);
}
