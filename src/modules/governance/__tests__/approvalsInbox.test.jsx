/* global __dirname */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, matchPath } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { filterInboxItems } from '../inboxFilter';

/**
 * P5-02: one approvals inbox. The badge and the list come from ONE query key,
 * so the badge always equals the number of rows the user sees; every "Open"
 * link goes to a route that exists. Server-rendered with a seeded query cache
 * (no DOM library is installed).
 */
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, role: 'Owner' }, hasPermission: () => true }),
}));
vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: vi.fn() }) }));

const { default: ApprovalsInbox, InboxList } = await import('../ApprovalsInbox');
const { useApprovalsInboxCount, useApprovalsInboxTypeCount, APPROVALS_INBOX_KEY } = await import('../useApprovalsInbox');

// One item per type, with the links the server builds (approvalsInbox.service).
const ITEMS = [
  { type: 'master_data', id: 'supplier:4', link: '/admin' },
  { type: 'document', id: 11, link: '/export/12', action: { kind: 'document', documentId: 11, isDelete: false } },
  { type: 'document', id: 13, link: '/documents', action: { kind: 'document', documentId: 13, isDelete: true } },
  { type: 'generated_document', id: 5, link: '/export/12' },
  { type: 'stock_adjustment', id: 6, link: '/stock-adjustments' },
  { type: 'store_adjustment', id: 7, link: '/mill-store/adjustments' },
  { type: 'stock_count', id: 8, link: '/stock-count' },
  { type: 'milling_batch', id: 9, link: '/milling/9' },
  { type: 'export_receipt', id: 10, link: '/finance/money-in/to-confirm', amount: 2500, currency: 'USD' },
  { type: 'fund_transfer', id: 14, link: '/finance', amount: 50000, currency: 'PKR', action: { kind: 'accept_transfer', transferId: 14 } },
  { type: 'fund_transfer', id: 15, link: '/milling/finance', amount: 7000, currency: 'PKR', action: { kind: 'accept_transfer', transferId: 15 } },
  { type: 'payroll_run', id: 16, link: '/finance/payroll', amount: 90000, currency: 'PKR' },
  { type: 'salary_advance', id: 17, link: '/finance/payroll' },
  { type: 'leave_request', id: 18, link: '/finance/payroll' },
  { type: 'worker_request', id: 19, link: '/finance/payroll' },
  { type: 'purchase_requirement', id: 20, link: '/purchase-requirements' },
  { type: 'packing_variance', id: 21, link: '/export/12' },
  { type: 'local_sale', id: 22, link: '/local-sales/22' },
  { type: 'approval_queue', id: 23, link: null, action: { kind: 'approval_queue', approvalId: 23 } },
  { type: 'payroll_run', id: 24, link: null }, // user lacks the page: no dead link
].map((i) => ({ ...i, key: `${i.type}:${i.id}`, typeLabel: i.type, title: `T ${i.type} ${i.id}`, summary: null, requestedAt: '2026-10-16T08:00:00Z' }));

const TYPES = [...new Set(ITEMS.map((i) => i.type))].map((t) => ({ type: t, label: t, count: ITEMS.filter((i) => i.type === t).length }));

function withInbox(ui, data = { items: ITEMS, types: TYPES }, url = '/approvals') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(APPROVALS_INBOX_KEY, data);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></QueryClientProvider>,
  );
}

function Badge() {
  return <span data-badge={useApprovalsInboxCount()} data-md={useApprovalsInboxTypeCount('master_data')} />;
}

const rows = (html) => (html.match(/<li data-key="/g) || []).length;
const badgeOf = (html) => Number(/data-badge="(\d+)"/.exec(html)[1]);

describe('badge == list length (one query key)', () => {
  it('the badge equals the rows on the inbox page', () => {
    const html = withInbox(<><Badge /><ApprovalsInbox /></>);
    expect(badgeOf(html)).toBe(ITEMS.length);
    expect(rows(html)).toBe(ITEMS.length);
  });

  it('a per-type badge (Admin ▸ Approvals tab) counts that type from the same list', () => {
    const html = withInbox(<Badge />);
    expect(Number(/data-md="(\d+)"/.exec(html)[1])).toBe(1);
  });

  it('an empty inbox shows 0 and the empty state', () => {
    const html = withInbox(<><Badge /><ApprovalsInbox /></>, { items: [], types: [] });
    expect(badgeOf(html)).toBe(0);
    expect(rows(html)).toBe(0);
    expect(html).toContain('Nothing waiting for you');
  });

  it('?type= filters the rows, the chips keep the full counts', () => {
    const html = withInbox(<ApprovalsInbox />, undefined, '/approvals?type=payroll_run');
    expect(rows(html)).toBe(2);
    expect(html).toMatch(/aria-pressed="true"[^>]*>payroll_run/);
  });

  it('an unknown ?type= falls back to All', () => {
    expect(rows(withInbox(<ApprovalsInbox />, undefined, '/approvals?type=bogus'))).toBe(ITEMS.length);
  });
});

describe('filterInboxItems', () => {
  it('filters by type and search term', () => {
    expect(filterInboxItems(ITEMS, { type: 'fund_transfer' })).toHaveLength(2);
    expect(filterInboxItems(ITEMS, { q: 'T store_adjustment' })).toHaveLength(1);
    expect(filterInboxItems(ITEMS, {})).toHaveLength(ITEMS.length);
  });
});

describe('every approval link resolves to a real route', () => {
  // The one route table (P5-05): paths + gates in app/routeGates.js, the
  // /finance/* children in app/routeTable.jsx's FinanceRoutes.
  const app = fs.readFileSync(path.resolve(__dirname, '../../../app/routeTable.jsx'), 'utf8');
  const gates = fs.readFileSync(path.resolve(__dirname, '../../../app/routeGates.js'), 'utf8');
  // Top-level routes plus the /finance/* children (declared relative to it).
  const fn = /function FinanceRoutes\(\)[\s\S]*?\n}\n/.exec(app)[0];
  const financeChildren = [...fn.matchAll(/path="([^"]+)"/g)].map((m) => `/finance/${m[1]}`);
  const top = [...gates.matchAll(/path: '(\/[^']*)'/g)].map((m) => m[1]).filter((p) => p !== '/*' && p !== '*');
  const patterns = [...new Set([...top, ...financeChildren, '/finance'])].filter((p) => !p.endsWith('/*'));
  const resolves = (href) => {
    const pathname = href.split(/[?#]/)[0];
    return patterns.some((p) => matchPath({ path: p, end: true }, pathname));
  };

  const html = renderToStaticMarkup(<MemoryRouter><InboxList items={ITEMS} /></MemoryRouter>);
  const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*data-open="1"|<a [^>]*data-open="1"[^>]*href="([^"]+)"/g)].map((m) => m[1] || m[2]);

  it('renders an Open link for every item that has one', () => {
    expect(hrefs).toHaveLength(ITEMS.filter((i) => i.link).length);
  });

  it.each(ITEMS.filter((i) => i.link).map((i) => [i.type, i.link]))('%s → %s', (_t, link) => {
    expect(resolves(link)).toBe(true);
  });

  it('the old dead /export-orders/:id link does not resolve (so it must not be used)', () => {
    expect(resolves('/export-orders/12')).toBe(false);
    const pda = fs.readFileSync(path.resolve(__dirname, '../../documents/components/PendingDocumentApprovals.jsx'), 'utf8');
    expect(pda).not.toContain('/export-orders/');
  });

  it('chat links to the inbox filtered by type (/approvals?type=…)', () => {
    expect(resolves('/approvals?type=store_adjustment')).toBe(true);
  });

  it('an item without a page shows no link, and inline-only items show their actions', () => {
    const one = (it) => renderToStaticMarkup(<MemoryRouter><InboxList items={[it]} /></MemoryRouter>);
    expect(one(ITEMS.find((i) => i.key === 'payroll_run:24'))).toContain('No page access');
    const q = one(ITEMS.find((i) => i.type === 'approval_queue'));
    expect(q).toContain('Approve');
    expect(q).not.toContain('No page access');
    expect(one(ITEMS.find((i) => i.id === 14))).toContain('Accept funds');
    expect(one(ITEMS.find((i) => i.id === 13))).toContain('Approve deletion');
  });
});
