import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROUTE_GATES, matchRoutePath, canOpen, gateFor } from '../../app/routeGates';
import { PRIMARY_NAV, MORE_NAV, PINNED_NAV, allNavTargets } from '../../app/navConfig';
import { PAGES } from '../../app/routeTable';
import { permsFor } from '../../test/fixtures/rolePermissions';

// P5-05: ONE route table for every role (app/routeGates + app/routeTable).
// These replace the old per-shell (Standard / Mill / Export) App.jsx checks.

const src = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

describe('the one route table', () => {
  it('every gated path has a page and every page has a gate entry', () => {
    const gated = ROUTE_GATES.map((r) => r.path).sort();
    expect(Object.keys(PAGES).sort()).toEqual(gated);
    expect(new Set(gated).size).toBe(gated.length);
  });

  it.each([
    '/milling/customers',
    '/milling/suppliers',
    '/milling/statements',
    '/milling/finance',
    '/milling/rice-purchases',
    '/milling/service',
    '/purchase-requirements',
  ])('%s resolves to its own page, not the batch-detail or catch-all route', (url) => {
    expect(matchRoutePath(url)).toBe(url);
  });

  it('still sends a batch id to the batch detail page', () => {
    expect(matchRoutePath('/milling/42')).toBe('/milling/:id');
  });

  it('/export/create is the create page, never /export/:id with id="create"', () => {
    expect(matchRoutePath('/export/create')).toBe('/export/create');
    expect(matchRoutePath('/export/EX-001')).toBe('/export/:id');
    // and it needs create, not just view
    expect(gateFor('/export/create')).toEqual({ module: 'export_orders', action: 'create' });
  });

  it('unknown URLs resolve to nothing (the "not available" page), not home', () => {
    expect(matchRoutePath('/no-such-page')).toBeNull();
    expect(canOpen('/no-such-page', () => true)).toBe(false);
    const table = src('app/routeTable.jsx');
    expect(table).toMatch(/<Route path="\*" element=\{<NotAvailable \/>\} \/>/);
    expect(table).not.toMatch(/<Navigate to="\/" replace \/>/);
  });

  it('every /finance/* link resolves under the finance tree', () => {
    for (const url of ['/finance', '/finance/money-in', '/finance/accounting/statements']) {
      expect(matchRoutePath(url)).toBe('/finance/*');
    }
  });

  it('old URLs from every former shell still resolve (deep links kept)', () => {
    const old = [
      '/', '/buyers', '/export', '/export/create', '/export/7', '/documents', '/finance',
      '/milling', '/milling/service', '/service-milling/invoices', '/service-milling/3',
      '/milling/finance', '/milling/rice-purchases', '/milling/customers', '/milling/suppliers',
      '/milling/statements', '/milling/3', '/quality', '/mill-store', '/mill-store/purchases/new',
      '/mill-store/alerts', '/mill-store/adjustments', '/mill-store/ratios', '/stock-adjustments',
      '/transfer', '/inventory', '/lot-inventory', '/lot-inventory/9', '/lot-inventory/9/purchase-invoice',
      '/stock-summary', '/purchase-requirements', '/sample-analysis', '/stock-count', '/local-sales',
      '/local-sales/5', '/local-sales/5/invoice', '/local-sales/5/print', '/reports', '/reports/print',
      '/reports/lots', '/reports/payroll', '/reports/stock-ledger', '/exceptions', '/ai', '/intelligence',
      '/simulator', '/approvals', '/approvals/legacy', '/finance/accounting/stock-transfers', '/audit', '/admin', '/profile', '/change-password',
    ];
    for (const url of old) expect([url, matchRoutePath(url)]).not.toEqual([url, null]);
  });

  it('legacy finance aliases are generated from LEGACY_FINANCE_REDIRECTS, with a catch-all', () => {
    const table = src('app/routeTable.jsx');
    expect(table).toMatch(/Object\.keys\(LEGACY_FINANCE_REDIRECTS\)\.map\(\(seg\) => \(\s*<Route key=\{seg\} path=\{seg\} element=\{<LegacyFinanceRedirect \/>\} \/>/);
    expect(table).toMatch(/<Route path="\*" element=\{<FinanceCatchAll \/>\} \/>/);
    // Stock transfers live on one page (/transfer); the old Finance URL redirects.
    expect(table).toMatch(/<Route path="accounting\/stock-transfers" element=\{<Navigate to="\/transfer" replace \/>\} \/>/);
  });

  it('App.jsx has one shell — no role-name switch, no Mill/Export layouts', () => {
    const app = src('App.jsx');
    expect(app).not.toMatch(/MillLayout|ExportLayout|MillRoutes|ExportRoutes|StandardRoutes/);
    expect(app).not.toMatch(/user\?\.role === '(Mill|Export) Manager'/);
    expect(app).toMatch(/<Layout>\s*<AppRoutes \/>\s*<\/Layout>/);
  });
});

describe('sidebar entries', () => {
  it('every entry links to a route the table declares, with one label per route', () => {
    const byRoute = new Map();
    for (const [to, label] of allNavTargets()) {
      expect([to, matchRoutePath(to)]).not.toEqual([to, null]);
      if (!byRoute.has(to)) byRoute.set(to, new Set());
      byRoute.get(to).add(label);
    }
    const conflicts = [...byRoute].filter(([, l]) => l.size > 1);
    expect(conflicts).toEqual([]);
  });

  it('at most 7 primary destinations; approvals pinned outside Show More', () => {
    expect(PRIMARY_NAV.length).toBeLessThanOrEqual(7);
    expect(PRIMARY_NAV.map((i) => i.label)).toEqual(
      ['Dashboard', 'Purchases & Lots', 'Milling', 'Inventory', 'Export Orders', 'Finance', 'Reports'],
    );
    expect(PINNED_NAV.map((i) => i.to)).toContain('/approvals');
    expect(MORE_NAV.map((i) => i.to)).not.toContain('/approvals');
  });

  it('names the shared pages after their headings', () => {
    const label = new Map(allNavTargets());
    expect(label.get('/mill-store')).toBe('Mill Store');
    expect(label.get('/reports')).toBe('Reports');
    expect(label.get('/lot-inventory')).toBe('Lot Inventory');
  });

  it('lists the pages that were reachable only by URL', () => {
    const label = new Map(allNavTargets());
    for (const p of ['/buyers', '/sample-analysis', '/milling/rice-purchases', '/stock-summary',
      '/stock-count', '/purchase-requirements', '/mill-store/adjustments']) expect(label.has(p)).toBe(true);
  });

  it('Mill and Export managers reach the Finance screens behind finance.view (G-9 / G-10)', () => {
    expect(gateFor('/finance/*')).toEqual({ module: 'finance', action: 'view' });
    for (const role of ['Mill Manager', 'Export Manager']) {
      const can = permsFor(role);
      for (const url of ['/finance', '/finance/accounting/profit', '/export/7', '/milling/3', '/local-sales/5', '/lot-inventory/9']) {
        expect([role, url, canOpen(url, can)]).toEqual([role, url, true]);
      }
    }
  });
});
