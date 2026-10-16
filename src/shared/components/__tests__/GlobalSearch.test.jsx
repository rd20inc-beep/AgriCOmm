import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  RESULT_ROUTES, isKnownTarget, flattenResults, displayGroups, isSearchShortcut, moveActive, enterTarget, formatMoney,
} from '../globalSearchLogic';
import { parseOpenParam } from '../../../modules/finance/drawers/openFromUrl';

/**
 * P5-03 header global search: keyboard shortcuts and arrow-key movement,
 * Enter's target, every link target being a real route in App.jsx, the
 * grouped listbox markup, and the Finance ?open= deep link the money results
 * use.
 */

vi.mock('../../../api/queries', () => ({
  useGlobalSearch: () => ({ data: null, isFetching: false, isError: false }),
  globalSearchQuery: () => ({}),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ fetchQuery: vi.fn() }) }));
const { default: GlobalSearch, SearchResults } = await import('../GlobalSearch');

// One href per kind the server emits (backend globalSearch.js).
const SERVER_HREFS = {
  orders: '/export/12', containers: '/export/12', batches: '/milling/7', serviceBatch: '/service-milling/8',
  lots: '/lot-inventory/3', sales: '/local-sales/4',
  customers: '/finance/accounting/statements?type=customer&id=5',
  localCustomer: '/finance/accounting/statements?type=customer&id=6&scope=local',
  suppliers: '/finance/accounting/statements?type=supplier&id=9', supplierLedger: '/reports/supplier-ledger/9',
  transporters: '/admin?tab=haulers&hauler=2',
  receivables: '/finance/money-in?open=receivable:1', payables: '/finance/money-out?open=payable:1',
  receipt: '/finance/money-in?open=payment:1', payment: '/finance/money-out?open=payment:1',
  bank: '/finance/accounts?open=bank:1', expenses: '/finance/money-out/expenses?open=expense:1',
  documents: '/documents',
};

const GROUPS = [
  { key: 'orders', label: 'Export orders', items: [
    { id: 1, title: 'EX-001', subtitle: 'Basmati', href: '/export/1', rank: 0 },
    { id: 2, title: 'EX-0010', href: '/export/2', rank: 1 },
  ] },
  { key: 'customers', label: 'Customers', items: [
    { id: 5, title: 'Al Noor', subtitle: 'Customer statement', href: '/finance/accounting/statements?type=customer&id=5', party: 'customer' },
  ] },
  { key: 'payables', label: 'Payables', items: [
    { id: 9, title: 'PAY-9', href: '/finance/money-out?open=payable:9', outstanding: 1200, currency: 'PKR' },
    { id: 10, title: 'Bogus', href: 'https://evil.example/x' },
  ] },
];

describe('keyboard shortcuts', () => {
  const ev = (over) => ({ key: '', ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'BODY' }, ...over });
  it('"/" focuses the search from the page, not while typing in a field', () => {
    expect(isSearchShortcut(ev({ key: '/' }))).toBe(true);
    expect(isSearchShortcut(ev({ key: '/', target: { tagName: 'INPUT' } }))).toBe(false);
    expect(isSearchShortcut(ev({ key: '/', target: { tagName: 'TEXTAREA' } }))).toBe(false);
    expect(isSearchShortcut(ev({ key: '/', target: { tagName: 'DIV', isContentEditable: true } }))).toBe(false);
  });
  it('Ctrl+K and Cmd+K focus it from anywhere, even inside a field', () => {
    expect(isSearchShortcut(ev({ key: 'k', ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(ev({ key: 'K', metaKey: true, target: { tagName: 'INPUT' } }))).toBe(true);
    expect(isSearchShortcut(ev({ key: 'k' }))).toBe(false);
    expect(isSearchShortcut(ev({ key: 'k', ctrlKey: true, altKey: true }))).toBe(false);
  });
});

describe('arrow keys and Enter', () => {
  it('ArrowDown / ArrowUp move and wrap; Home / End jump', () => {
    expect(moveActive(-1, 'ArrowDown', 3)).toBe(0);
    expect(moveActive(0, 'ArrowDown', 3)).toBe(1);
    expect(moveActive(2, 'ArrowDown', 3)).toBe(0);
    expect(moveActive(-1, 'ArrowUp', 3)).toBe(2);
    expect(moveActive(0, 'ArrowUp', 3)).toBe(2);
    expect(moveActive(2, 'ArrowUp', 3)).toBe(1);
    expect(moveActive(1, 'Home', 3)).toBe(0);
    expect(moveActive(0, 'End', 3)).toBe(2);
    expect(moveActive(1, 'Tab', 3)).toBe(1);
    expect(moveActive(0, 'ArrowDown', 0)).toBe(-1);
  });
  it('Enter opens the highlighted result, else the best (first) one', () => {
    const flat = flattenResults(GROUPS);
    expect(enterTarget(flat, -1).href).toBe('/export/1'); // exact number match ranked first by the server
    expect(enterTarget(flat, 2).href).toBe('/finance/accounting/statements?type=customer&id=5');
    expect(enterTarget([], -1)).toBeNull();
  });
  it('arrow movement crosses groups in display order', () => {
    const flat = flattenResults(GROUPS);
    let a = -1;
    const seen = [];
    for (let i = 0; i < flat.length; i += 1) { a = moveActive(a, 'ArrowDown', flat.length); seen.push(flat[a].title); }
    expect(seen).toEqual(['EX-001', 'EX-0010', 'Al Noor', 'PAY-9']);
  });
});

describe('navigation targets', () => {
  it('a result whose link is not a known route is dropped', () => {
    const flat = flattenResults(GROUPS);
    expect(flat.map((i) => i.title)).not.toContain('Bogus');
    expect(flat.map((i) => i.index)).toEqual([0, 1, 2, 3]);
    expect(displayGroups(flat).map((g) => [g.key, g.items.length])).toEqual([['orders', 2], ['customers', 1], ['payables', 1]]);
  });

  it('every kind of server link is accepted', () => {
    for (const [kind, href] of Object.entries(SERVER_HREFS)) expect([kind, isKnownTarget(href)]).toEqual([kind, true]);
    expect(isKnownTarget('/export/abc')).toBe(false);
    expect(isKnownTarget('//evil.example')).toBe(false);
    expect(isKnownTarget(undefined)).toBe(false);
  });

  it('every link target is a route in the route table', () => {
    // The one route table (P5-05): app/routeGates.js lists every path; the
    // /finance/* children are declared in app/routeTable.jsx.
    const app = readFileSync(fileURLToPath(new URL('../../../app/routeTable.jsx', import.meta.url)), 'utf8');
    const gates = readFileSync(fileURLToPath(new URL('../../../app/routeGates.js', import.meta.url)), 'utf8');
    const top = new Set([...gates.matchAll(/path: '(\/[^']*)'/g)].map((m) => m[1]));
    // FinanceRoutes nests relative paths under /finance/*.
    const finance = new Set([...app.matchAll(/path="([a-z][^"]*)"/g)].map((m) => `/finance/${m[1]}`));
    expect(top.has('/finance/*')).toBe(true);
    const routeOf = (href) => href.split('?')[0].replace(/\/\d+$/, '/:id');
    for (const href of Object.values(SERVER_HREFS)) {
      const path = routeOf(href);
      expect([href, top.has(path) || finance.has(path)]).toEqual([href, true]);
    }
    expect(RESULT_ROUTES.length).toBeGreaterThanOrEqual(13);
  });

  it('a party result opens its statement directly (W11 / W12)', () => {
    expect(isKnownTarget('/finance/accounting/statements?type=customer&id=5')).toBe(true);
    expect(isKnownTarget('/finance/accounting/statements?type=supplier&id=9')).toBe(true);
  });
});

describe('Finance ?open= deep link', () => {
  it('parses transactions and documents, rejects anything else', () => {
    expect(parseOpenParam('payment:42')).toEqual({ kind: 'transaction', txKind: 'payment', id: 42 });
    expect(parseOpenParam('bank:7')).toEqual({ kind: 'transaction', txKind: 'bank', id: 7 });
    expect(parseOpenParam('receivable:3')).toEqual({ kind: 'document', doc: { docKind: 'receivable', id: 3 } });
    expect(parseOpenParam('payable:3')).toEqual({ kind: 'document', doc: { docKind: 'payable', id: 3 } });
    expect(parseOpenParam('expense:3')).toEqual({ kind: 'document', doc: { docKind: 'expense', id: 3 } });
    expect(parseOpenParam('journal:3')).toBeNull();
    expect(parseOpenParam('payment:0')).toBeNull();
    expect(parseOpenParam('payment:1;drop')).toBeNull();
    expect(parseOpenParam(null)).toBeNull();
  });
  it('every finance result link carries a parseable ?open=', () => {
    for (const href of Object.values(SERVER_HREFS).filter((h) => h.includes('?open='))) {
      expect(parseOpenParam(new URLSearchParams(href.split('?')[1]).get('open'))).not.toBeNull();
    }
  });
});

describe('rendering', () => {
  const render = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>).replace(/&amp;/g, '&');

  it('grouped listbox: real links, option roles, the highlighted one aria-selected, money in its own currency', () => {
    const flat = flattenResults(GROUPS);
    const html = render(<SearchResults listId="gs" groups={displayGroups(flat)} active={2} query="x" />);
    expect(html).toContain('role="listbox"');
    expect([...html.matchAll(/role="option"/g)]).toHaveLength(4);
    expect(html).toContain('href="/export/1"');
    expect(html).toContain('href="/finance/accounting/statements?type=customer&id=5"');
    expect(html).not.toContain('evil.example');
    expect(html).toMatch(/id="gs-opt-2"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="gs-opt-0"[^>]*aria-selected="false"/);
    expect(html).toContain('PKR 1,200');
    expect(html).toContain('Export orders');
  });

  it('empty, loading and error states', () => {
    expect(render(<SearchResults listId="gs" groups={[]} query="zz" />)).toContain('No match for “zz”');
    expect(render(<SearchResults listId="gs" groups={[]} loading query="zz" />)).toContain('Searching');
    expect(render(<SearchResults listId="gs" groups={[]} error query="zz" />)).toContain('Search failed');
  });

  it('the box is a labelled combobox with a mobile search button', () => {
    const html = render(<GlobalSearch />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Search"'); // mobile icon button
    expect(html).toContain('Ctrl K');
  });

  it('formatMoney never mixes currencies and tolerates nulls', () => {
    expect(formatMoney(1200.5, 'USD')).toBe('USD 1,200.5');
    expect(formatMoney(null, 'PKR')).toBeNull();
  });
});
