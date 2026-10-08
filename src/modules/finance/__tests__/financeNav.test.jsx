import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  WORKSPACES, LEGACY_FINANCE_REDIRECTS, visibleWorkspaces, matchFinanceLocation,
  withRange, legacyFinanceTarget, resolveFinanceLink, financeHref, visibleHeaderActions,
} from '../financeNav';

/**
 * Finance IA (phase 2): six workspaces with views, the period carried in every
 * link, every old /finance/* URL redirecting to its new view with the query
 * string kept, and the header actions shown only to those who may use them.
 */

// ── permission helpers ────────────────────────────────────────────────
const allow = (...perms) => (m, a) => perms.includes(`${m}.${a}`);
const FINANCE_MANAGER = allow('finance.view', 'finance.confirm_payment', 'finance.allocate_cost',
  'payroll.view', 'service_milling.view_invoice');

// ── layout render (mocks only what the shell touches) ─────────────────
let mockPerms = FINANCE_MANAGER;
let mockPending = [];
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: (m, a) => mockPerms(m, a) }) }));
vi.mock('../../../api/queries', () => ({ usePendingExportReceipts: () => ({ data: mockPending }) }));
vi.mock('../../../components/ErrorBoundary', () => ({ RouteErrorBoundary: ({ children }) => children }));
vi.mock('../../../shared/components/Skeleton', () => ({ SkeletonPage: () => null }));
// The header search reads /api/finance/search; the drawer host renders nothing until opened.
vi.mock('../drawers/FinanceSearch', () => ({ default: () => <div data-testid="finance-search" /> }));
const { default: FinanceLayout } = await import('../pages/FinanceLayout');

const renderAt = (url) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[url]}><FinanceLayout><div>page</div></FinanceLayout></MemoryRouter>,
);
const buttonsOf = (html, attr) => [...html.matchAll(new RegExp(`<button [^>]*?${attr}="([^"]+)"`, 'g'))].map((m) => m[1]);
const hrefsOf = (html, attr) =>
  [...html.matchAll(new RegExp(`<a [^>]*?href="([^"]*)"[^>]*?${attr}="([^"]+)"|<a [^>]*?${attr}="([^"]+)"[^>]*?href="([^"]*)"`, 'g'))]
    .map((m) => ({ key: m[2] || m[3], href: (m[1] ?? m[4]).replace(/&amp;/g, '&') }));

beforeEach(() => { mockPerms = FINANCE_MANAGER; mockPending = []; });

describe('six workspaces', () => {
  it('the map has exactly Home, Money In, Money Out, Accounts, Accounting, Payroll — no dropdown groups', () => {
    expect(WORKSPACES.map((w) => w.label)).toEqual(['Home', 'Money In', 'Money Out', 'Accounts', 'Accounting', 'Payroll']);
    for (const w of WORKSPACES) expect(w.children).toBeUndefined();
  });

  it('the layout renders the six workspaces as links', () => {
    const html = renderAt('/finance');
    expect(hrefsOf(html, 'data-workspace')).toEqual([
      { key: 'home', href: '/finance' },
      { key: 'money-in', href: '/finance/money-in' },
      { key: 'money-out', href: '/finance/money-out' },
      { key: 'accounts', href: '/finance/accounts' },
      { key: 'accounting', href: '/finance/accounting' },
      { key: 'payroll', href: '/finance/payroll' },
    ]);
  });

  it('Payroll is hidden without payroll.view', () => {
    mockPerms = allow('finance.view');
    expect(visibleWorkspaces(mockPerms).map((w) => w.key)).not.toContain('payroll');
    expect(renderAt('/finance')).not.toContain('data-workspace="payroll"');
  });

  it('Accounting hides the GL statement views when finance.view is missing, and keeps the rest', () => {
    const acc = (perms) => visibleWorkspaces(perms).find((w) => w.key === 'accounting').views.map((v) => v.key);
    expect(acc(allow('finance.view'))).toEqual(['journal', 'trial-balance', 'pnl', 'balance-sheet', 'profit', 'statements', 'rates']);
    expect(acc(allow())).toEqual(['journal', 'profit', 'statements', 'rates']);
  });

  it('Service invoices shows only with service_milling.view_invoice and is marked as leaving Finance', () => {
    const html = renderAt('/finance/money-in');
    expect(html).toContain('data-view="service-invoices"');
    expect(html).toContain('leaves Finance');
    mockPerms = allow('finance.view');
    expect(renderAt('/finance/money-in')).not.toContain('data-view="service-invoices"');
  });

  it('shows the views of the current workspace only', () => {
    const html = renderAt('/finance/money-out/purchases');
    expect(hrefsOf(html, 'data-view').map((v) => v.key)).toEqual(['payables', 'purchases', 'expenses']);
    expect(html).toMatch(/aria-selected="true"[^>]*data-view="purchases"|data-view="purchases"[^>]*aria-selected="true"/);
  });

  it('the pending-receipt count shows on Money In and on its To confirm view', () => {
    mockPending = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const html = renderAt('/finance/money-in/to-confirm');
    const badges = html.match(/bg-amber-500 rounded-full">3</g) || [];
    expect(badges.length).toBe(2);
  });

  it('matches every view path to its workspace and view', () => {
    for (const w of WORKSPACES) {
      for (const v of w.views.filter((x) => !x.external)) {
        const m = matchFinanceLocation(v.path);
        expect([m.workspace.key, m.view.key]).toEqual([w.key, v.key]);
      }
    }
    expect(matchFinanceLocation('/finance/alerts').workspace.key).toBe('home');
    expect(matchFinanceLocation('/finance/nope').view.key).toBe('home');
  });
});

describe('period travels with every link', () => {
  it('workspace and view links carry ?range=; header actions open drawers in place (no link to lose it)', () => {
    const html = renderAt('/finance/money-out/expenses?range=month');
    for (const { href } of hrefsOf(html, 'data-workspace')) expect(href).toContain('range=month');
    for (const { key, href } of hrefsOf(html, 'data-view')) expect([key, href.includes('range=month')]).toEqual([key, true]);
    expect(hrefsOf(html, 'data-action')).toEqual([]);
    expect(buttonsOf(html, 'data-action')).toEqual(['receive', 'pay', 'transfer', 'expense']);
  });

  it('no range → bare paths', () => {
    const html = renderAt('/finance/money-in');
    for (const { href } of hrefsOf(html, 'data-workspace')) expect(href).not.toContain('range=');
  });

  it('withRange keeps a path\'s own params and adds the period once', () => {
    expect(withRange('/finance/accounts?action=transfer', 'week')).toBe('/finance/accounts?action=transfer&range=week');
    expect(withRange('/finance/money-in', '')).toBe('/finance/money-in');
    expect(withRange('/finance?range=year', 'week')).toBe('/finance?range=year');
  });

  it('pages not filtered by period say so instead of showing a dead selector', () => {
    for (const url of ['/finance/accounts/cheques', '/finance/accounts/suspense', '/finance/accounting/profit',
      '/finance/accounting/rates', '/finance/money-in/to-confirm', '/finance/payroll', '/finance/alerts']) {
      const html = renderAt(url);
      expect([url, html.includes('Not filtered by period'), html.includes('aria-label="Period"')]).toEqual([url, true, false]);
    }
    for (const url of ['/finance', '/finance/money-in', '/finance/money-out/purchases', '/finance/accounts', '/finance/accounting/pnl']) {
      expect([url, renderAt(url).includes('aria-label="Period"')]).toEqual([url, true]);
    }
    expect(renderAt('/finance/accounting/trial-balance')).toContain('As at end of');
  });
});

describe('legacy /finance/* paths', () => {
  // [old URL, where it must land]
  const TABLE = [
    ['/finance/purchases', '/finance/money-out/purchases'],
    ['/finance/expenses', '/finance/money-out/expenses'],
    ['/finance/expenses?action=new', '/finance/money-out/expenses?action=new'],
    ['/finance/local-sales', '/finance/money-in/local-sales'],
    ['/finance/confirmations', '/finance/money-in/to-confirm'],
    ['/finance/cash', '/finance/accounts'],
    ['/finance/cash?range=week', '/finance/accounts?range=week'],
    ['/finance/due-dates', '/finance/accounts/cheques'],
    ['/finance/suspense', '/finance/accounts/suspense'],
    ['/finance/rates', '/finance/accounting/rates'],
    ['/finance/profit', '/finance/accounting/profit'],
    ['/finance/profitability?range=year', '/finance/accounting/profit?range=year'],
    ['/finance/statements', '/finance/accounting/statements'],
    ['/finance/statements?type=customer&id=5', '/finance/accounting/statements?type=customer&id=5'],
    ['/finance/statements?type=supplier&id=9&scope=local&range=month', '/finance/accounting/statements?type=supplier&id=9&scope=local&range=month'],
    ['/finance/receivables', '/finance/money-in'],
    ['/finance/payables', '/finance/money-out'],
    ['/finance/ledger', '/finance/accounting'],
  ];
  it.each(TABLE)('%s → %s', (from, to) => {
    const [path, query = ''] = from.split('?');
    expect(legacyFinanceTarget(path, query ? `?${query}` : '')).toBe(to);
  });

  it('covers every legacy segment in the redirect map', () => {
    const segs = new Set(TABLE.map(([from]) => from.split('?')[0].replace('/finance/', '')));
    expect([...segs].sort()).toEqual(Object.keys(LEGACY_FINANCE_REDIRECTS).sort());
  });

  it('new paths, alerts and the kept orphans are not redirected', () => {
    for (const p of ['/finance', '/finance/money-in', '/finance/alerts', '/finance/costs', '/finance/transfers', '/finance/reconciliation', '/finance/accounting/statements']) {
      expect(legacyFinanceTarget(p, '')).toBeNull();
    }
  });

  it('server-built alert links resolve to the new views', () => {
    expect(resolveFinanceLink('/finance/cash')).toBe('/finance/accounts');
    expect(resolveFinanceLink('/finance/due-dates')).toBe('/finance/accounts/cheques');
    expect(resolveFinanceLink('/finance/money-in')).toBe('/finance/money-in');
    expect(resolveFinanceLink('/export/12')).toBe('/export/12');
    expect(financeHref('/finance/due-dates', 'month')).toBe('/finance/accounts/cheques?range=month');
    expect(financeHref('/export/12', 'month')).toBe('/export/12');
  });

  it('nothing in the new nav links to the URL-only orphans', () => {
    const all = WORKSPACES.flatMap((w) => [w.path, ...w.views.map((v) => v.path)]);
    for (const orphan of ['/finance/costs', '/finance/transfers', '/finance/reconciliation']) expect(all).not.toContain(orphan);
  });
});

describe('header actions', () => {
  const keys = (perms) => visibleHeaderActions(perms).map((a) => a.key);

  it('Finance Manager sees all four, each landing on the right view', () => {
    expect(visibleHeaderActions(FINANCE_MANAGER).map((a) => [a.key, a.path])).toEqual([
      ['receive', '/finance/money-in'],
      ['pay', '/finance/money-out'],
      ['transfer', '/finance/accounts?action=transfer'],
      ['expense', '/finance/money-out/expenses?action=new'],
    ]);
  });

  it('a view-only user sees none, and the header renders no action group', () => {
    expect(keys(allow('finance.view'))).toEqual([]);
    mockPerms = allow('finance.view');
    expect(renderAt('/finance')).not.toContain('data-testid="finance-actions"');
  });

  it('receive / pay / transfer follow the payment guard (confirm_payment or milling.edit); expense needs allocate_cost', () => {
    expect(keys(allow('finance.view', 'milling.edit'))).toEqual(['receive', 'pay', 'transfer']);
    expect(keys(allow('finance.view', 'finance.allocate_cost'))).toEqual(['expense']);
  });

  it('renders the permitted actions in the header as drawer buttons, next to the search', () => {
    const html = renderAt('/finance');
    expect(buttonsOf(html, 'data-action')).toEqual(['receive', 'pay', 'transfer', 'expense']);
    expect(html).toContain('data-testid="finance-search"');
    mockPerms = allow('finance.view', 'milling.edit');
    expect(buttonsOf(renderAt('/finance'), 'data-action')).toEqual(['receive', 'pay', 'transfer']);
  });
});
