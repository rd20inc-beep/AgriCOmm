import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchRoutes } from 'react-router-dom';

const src = (p) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8');

// The route table of one shell, in declaration order, read from App.jsx.
const shellPaths = (name) => {
  const app = src('App.jsx');
  const start = app.indexOf(`function ${name}()`);
  expect(start).toBeGreaterThan(-1);
  const end = app.indexOf('\nfunction ', start + 1);
  const body = app.slice(start, end === -1 ? undefined : end);
  return [...body.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
};

const matchedPath = (paths, url) => {
  const hit = matchRoutes(paths.map((path) => ({ path })), url);
  return hit ? hit[hit.length - 1].route.path : null;
};

// Every sidebar entry of a layout as [route, label].
const navEntries = (file) =>
  [...src(file).matchAll(/label:\s*'([^']+)'[^}\n]*?\bto:\s*'([^']+)'/g)].map((m) => [m[2], m[1]]);

describe('Standard shell routes', () => {
  const paths = shellPaths('StandardRoutes');

  it.each([
    '/milling/customers',
    '/milling/suppliers',
    '/milling/statements',
    '/purchase-requirements',
  ])('%s resolves to its own page, not the batch-detail or catch-all route', (url) => {
    expect(matchedPath(paths, url)).toBe(url);
  });

  it('declares the static /milling pages before /milling/:id', () => {
    const detail = paths.indexOf('/milling/:id');
    expect(detail).toBeGreaterThan(-1);
    for (const p of ['/milling/customers', '/milling/suppliers', '/milling/statements']) {
      expect(paths.indexOf(p)).toBeGreaterThan(-1);
      expect(paths.indexOf(p)).toBeLessThan(detail);
    }
  });

  it('still sends a batch id to the batch detail page', () => {
    expect(matchedPath(paths, '/milling/42')).toBe('/milling/:id');
  });
});

describe('legacy finance aliases', () => {
  // The aliases are generated from financeNav's LEGACY_FINANCE_REDIRECTS (the
  // table itself is tested in modules/finance/__tests__/financeNav.test.jsx).
  const app = src('App.jsx');
  it('FinanceRoutes mounts a redirect route for every legacy segment, and a catch-all', () => {
    expect(app).toMatch(/Object\.keys\(LEGACY_FINANCE_REDIRECTS\)\.map\(\(seg\) => \(\s*<Route key=\{seg\} path=\{seg\} element=\{<LegacyFinanceRedirect \/>\} \/>/);
    expect(app).toMatch(/<Route path="\*" element=\{<FinanceCatchAll \/>\} \/>/);
  });

  it('Stock transfers lives under Accounting (finance.view) and /finance/transfers is only a redirect now', () => {
    const paths = shellPaths('FinanceRoutes');
    expect(paths).toContain('accounting/stock-transfers');
    expect(paths).not.toContain('transfers');
    expect(app).toMatch(/<Route path="accounting\/stock-transfers" element=\{<ProtectedRoute module="finance" action="view"><FinanceTransfers \/><\/ProtectedRoute>\} \/>/);
  });
});

describe('sidebar labels', () => {
  const layouts = ['components/Layout.jsx', 'components/MillLayout.jsx', 'components/ExportLayout.jsx'];
  const all = layouts.flatMap(navEntries);

  it('gives each route one label across all three layouts', () => {
    const byRoute = new Map();
    for (const [to, label] of all) {
      if (!byRoute.has(to)) byRoute.set(to, new Set());
      byRoute.get(to).add(label);
    }
    const conflicts = [...byRoute].filter(([, labels]) => labels.size > 1)
      .map(([to, labels]) => `${to}: ${[...labels].join(' / ')}`);
    expect(conflicts).toEqual([]);
  });

  it('names the shared pages after their headings', () => {
    const label = new Map(all);
    expect(label.get('/mill-store')).toBe('Mill Store');
    expect(label.get('/reports')).toBe('Reports');
    expect(label.get('/lot-inventory')).toBe('Lot Inventory');
  });

  it('lists the pages that were reachable only by URL', () => {
    const std = new Map(navEntries('components/Layout.jsx'));
    for (const p of ['/buyers', '/sample-analysis', '/milling/rice-purchases']) expect(std.has(p)).toBe(true);
    const mill = new Map(navEntries('components/MillLayout.jsx'));
    for (const p of ['/stock-summary', '/stock-count', '/purchase-requirements']) expect(mill.has(p)).toBe(true);
  });

  it('only links standard-sidebar entries to routes the standard shell declares', () => {
    const paths = shellPaths('StandardRoutes');
    const missing = navEntries('components/Layout.jsx')
      .map(([to]) => to)
      .filter((to) => !to.startsWith('/finance') && matchedPath(paths, to) !== to);
    expect(missing).toEqual([]);
  });
});

// Owner decisions G-9 / G-10: Mill and Export Managers get the Finance screens
// in their own shells — the same /finance/* tree and finance.view gate as the
// standard shell, so a finance link (and the detail pages it points at) never
// bounces them back to their dashboard. Backend permissions are unchanged.
describe('Mill and Export shells carry the Finance screens', () => {
  const app = src('App.jsx');
  const financeRoute = '<Route path="/finance/*" element={<ProtectedRoute module="finance" action="view"><FinanceRoutes /></ProtectedRoute>} />';

  it.each(['MillRoutes', 'ExportRoutes', 'StandardRoutes'])('%s mounts /finance/* behind finance.view', (shell) => {
    const start = app.indexOf(`function ${shell}()`);
    const body = app.slice(start, app.indexOf('\nfunction ', start + 1));
    expect(body).toContain(financeRoute);
  });

  it.each([
    ['MillRoutes', ['/finance', '/finance/accounting/profit', '/finance/money-in/local-sales', '/export', '/export/7', '/milling/3', '/local-sales/5', '/lot-inventory/9']],
    ['ExportRoutes', ['/finance', '/finance/money-out', '/finance/accounting/statements', '/export/7', '/milling/3', '/local-sales/5', '/lot-inventory/9']],
  ])('%s resolves every finance link without the catch-all', (shell, urls) => {
    const paths = shellPaths(shell);
    for (const url of urls) expect([url, matchedPath(paths, url)]).not.toEqual([url, '*']);
  });

  it.each(['components/MillLayout.jsx', 'components/ExportLayout.jsx'])('%s lists Finance Dashboard behind finance.view', (file) => {
    const text = src(file);
    expect(text).toMatch(/label: 'Finance Dashboard', icon: DollarSign, to: '\/finance', permission: \{ module: 'finance', action: 'view' \}/);
    expect(text).toMatch(/\.filter\(\(item\) => !item\.permission \|\| hasPermission\(item\.permission\.module, item\.permission\.action\)\)/);
  });
});
