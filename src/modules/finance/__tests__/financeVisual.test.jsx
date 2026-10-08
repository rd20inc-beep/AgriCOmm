import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { HEADER_ACTIONS, primaryHeaderAction } from '../financeNav';
import { statusStyle } from '../../../shared/utils/statusStyle';

/**
 * Finance phase 4 (visual): the presentation rules the screens rely on —
 * one title and one filled action in the header, an overflow menu and
 * sideways-scrolling rows on phones, tables that become cards (every cell
 * carries its column label), figures right-aligned in tabular digits, a
 * failed load that says so with Try again, KPI tiles that are buttons when
 * clickable, a calm profit card after Needs Attention on Home, and optional
 * payment fields folded under "More details" unless they hold something.
 */

const allow = (...perms) => (m, a) => perms.includes(`${m}.${a}`);
let mockPerms = allow('finance.view', 'finance.confirm_payment', 'finance.allocate_cost', 'payroll.view');
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: (m, a) => mockPerms(m, a) }) }));
vi.mock('../../../api/queries', () => ({
  usePendingExportReceipts: () => ({ data: [] }),
  useFinanceOverviewSummary: () => ({ data: { consolidated: { profitPkr: -5000 }, export: {}, mill: {}, local: {}, warnings: [] }, isLoading: false, refetch: () => {} }),
  useReceivables: () => ({ data: [] }),
  usePayables: () => ({ data: [] }),
  useJournalEntries: () => ({ data: [] }),
  useUpcoming: () => ({ data: null }),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isError: false }) }));
vi.mock('../../analytics/api/services', () => ({ reportingApi: {} }));
vi.mock('../../../components/ErrorBoundary', () => ({ RouteErrorBoundary: ({ children }) => children }));
vi.mock('../../../shared/components/Skeleton', () => ({ SkeletonPage: () => null }));
vi.mock('../drawers/FinanceSearch', () => ({ default: () => <div data-testid="finance-search" /> }));
vi.mock('../../ai/components/AnomalyWatchCard', () => ({ default: () => <div data-testid="ai-anomaly" /> }));
vi.mock('../../purchaseRequirements/components/PurchaseRequirementsPanel', () => ({ default: () => <div data-testid="purchase-requests" /> }));
vi.mock('../components/NeedsAttention', () => ({ default: () => <div data-testid="needs-attention" /> }));
vi.mock('../components/RecentActivity', () => ({ default: () => <div data-testid="recent-activity" /> }));
vi.mock('../../../api/client', () => ({ default: { upload: vi.fn() } }));

const { default: FinanceLayout } = await import('../pages/FinanceLayout');
const { default: FinanceOverview } = await import('../pages/FinanceOverview');
const { default: FinanceTable } = await import('../../../components/finance/FinanceTable');
const { default: FinanceKPI } = await import('../../../components/finance/FinanceKPI');
const { default: PaymentFields } = await import('../../../components/payments/PaymentFields');
const { blankPaymentForm } = await import('../../../components/payments/paymentPayload');

const layoutAt = (url) => renderToStaticMarkup(
  <MemoryRouter initialEntries={[url]}><FinanceLayout><div>page</div></FinanceLayout></MemoryRouter>,
);
const tagWith = (html, attr) => (html.match(new RegExp(`<[a-z]+ [^>]*${attr}[^>]*>`, 'g')) || []);
const classOf = (tag) => (tag.match(/class="([^"]*)"/) || [])[1] || '';

describe('header: one title, one primary action, a phone overflow', () => {
  it('names the workspace as the only h1 ("Finance" on Home)', () => {
    expect(layoutAt('/finance').match(/<h1[ >]/g)).toHaveLength(1);
    expect(layoutAt('/finance')).toMatch(/<h1[^>]*>Finance<\/h1>/);
    expect(layoutAt('/finance/money-out/purchases')).toMatch(/<h1[^>]*>Money Out<\/h1>/);
  });

  it('primaryHeaderAction picks the workspace\'s own action', () => {
    expect(primaryHeaderAction(HEADER_ACTIONS, 'money-in', 'receivables')).toBe('receive');
    expect(primaryHeaderAction(HEADER_ACTIONS, 'money-out', 'payables')).toBe('pay');
    expect(primaryHeaderAction(HEADER_ACTIONS, 'money-out', 'expenses')).toBe('expense');
    expect(primaryHeaderAction(HEADER_ACTIONS, 'accounts', 'cash')).toBe('transfer');
    expect(primaryHeaderAction(HEADER_ACTIONS, 'home', 'home')).toBe('receive');
    // A role without Receive still gets a primary (the first it may use).
    expect(primaryHeaderAction(HEADER_ACTIONS.filter((a) => a.key === 'expense'), 'home', 'home')).toBe('expense');
    expect(primaryHeaderAction([], 'home', 'home')).toBe(null);
  });

  it('exactly one action is filled; the rest hide on phones and live in the overflow menu', () => {
    const html = layoutAt('/finance/money-out');
    const tags = tagWith(html, 'data-action=');
    expect(tags).toHaveLength(4);
    const primary = tags.filter((t) => t.includes('data-primary="true"'));
    expect(primary).toHaveLength(1);
    expect(primary[0]).toContain('data-action="pay"');
    expect(classOf(primary[0])).toContain('bg-blue-600');
    for (const t of tags.filter((x) => !x.includes('data-primary'))) {
      expect(classOf(t)).toMatch(/\bhidden\b.*\bsm:inline-flex\b/);
      expect(classOf(t)).not.toContain('bg-blue-600');
    }
    // Print is outlined and phone-hidden; the overflow toggle is phone-only and named.
    expect(classOf(tagWith(html, 'data-testid="finance-print"')[0])).toMatch(/\bhidden\b.*\bsm:inline-flex\b/);
    expect(html).toMatch(/data-testid="finance-overflow"[^>]*class="[^"]*sm:hidden|class="[^"]*sm:hidden[^"]*"[^>]*data-testid="finance-overflow"/);
    expect(html).toContain('aria-label="More actions"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('header controls are 40px tall on phones', () => {
    const html = layoutAt('/finance/money-in');
    for (const t of tagWith(html, 'data-action=')) expect(classOf(t)).toContain('min-h-10');
    for (const t of tagWith(html, 'data-workspace=')) expect(classOf(t)).toContain('min-h-11');
    for (const t of tagWith(html, 'data-view=')) expect(classOf(t)).toContain('min-h-10');
  });

  it('workspace and view rows scroll sideways with an edge fade on phones', () => {
    const html = layoutAt('/finance/accounting');
    const rows = html.match(/data-scroll-row="true"/g) || [];
    expect(rows).toHaveLength(2);
    expect(html).toContain('overflow-x-auto scrollbar-hide');
    expect(html).toMatch(/aria-hidden="true" class="pointer-events-none absolute[^"]*bg-gradient-to-l from-white[^"]*sm:hidden"/);
  });
});

describe('tables: cards on phones, figures aligned, failures said', () => {
  const columns = [
    { key: 'ref', label: 'Ref' },
    { key: 'party', label: 'Customer' },
    { key: 'amount', label: 'Amount', align: 'right' },
    { key: 'status', label: 'Status' },
  ];
  const data = [{ id: 1, ref: 'R-1', party: 'Acme', amount: 'Rs 10', status: 'Overdue' }];

  it('every cell carries its column label for the mobile-cards layout', () => {
    const html = renderToStaticMarkup(<FinanceTable columns={columns} data={data} actions={() => <button type="button">Pay</button>} />);
    expect(html).toMatch(/class="[^"]*\bmobile-cards\b/);
    const labels = [...html.matchAll(/<td [^>]*data-label="([^"]*)"/g)].map((m) => m[1]);
    expect(labels).toEqual(['Ref', 'Customer', 'Amount', 'Status', 'Actions']);
  });

  it('money columns are right-aligned tabular figures, and status is a StatusBadge with its word', () => {
    const html = renderToStaticMarkup(<FinanceTable columns={columns} data={data} />);
    expect(html).toMatch(/<td data-label="Amount" class="[^"]*text-right tabular-nums/);
    expect(html).toMatch(/ring-inset[^"]*bg-red-50[^"]*">Overdue</);
  });

  it('a long page keeps its header in view on desktop only', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ ...data[0], id: i + 1 }));
    const html = renderToStaticMarkup(<FinanceTable columns={columns} data={many} />);
    expect(html).toContain('md:max-h-[70vh] md:overflow-y-auto');
    expect(html).toMatch(/<th [^>]*class="[^"]*md:sticky md:top-0/);
    expect(renderToStaticMarkup(<FinanceTable columns={columns} data={data} />)).not.toContain('md:sticky');
  });

  it('a failed load shows the error with Try again, not "No records"', () => {
    const html = renderToStaticMarkup(<FinanceTable columns={columns} data={[]} error={new Error('timeout')} onRetry={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('This list could not be loaded — timeout');
    expect(html).toContain('Try again');
    expect(html).not.toContain('No records found');
  });

  it('empty is an icon, one line and the action when given', () => {
    const html = renderToStaticMarkup(<FinanceTable columns={columns} data={[]} emptyText="Nothing yet." emptyAction={<button type="button">New</button>} />);
    expect(html).toContain('data-testid="empty-state"');
    expect(html).toContain('Nothing yet.');
    expect(html).toContain('>New</button>');
  });
});

describe('KPI tiles', () => {
  it('a clickable tile is a real button; a plain one is not', () => {
    expect(renderToStaticMarkup(<FinanceKPI title="Overdue" value="Rs 1" onClick={() => {}} />)).toMatch(/^<button type="button"/);
    expect(renderToStaticMarkup(<FinanceKPI title="Overdue" value="Rs 1" />)).toMatch(/^<div /);
  });

  it('status tints only the icon chip — the tile border stays neutral', () => {
    const html = renderToStaticMarkup(<FinanceKPI title="Overdue" value="Rs 1" status="danger" icon={() => <svg />} />);
    expect(html).toMatch(/^<div [^>]*class="[^"]*border-gray-200/);
    expect(html).toContain('bg-red-50');
    expect(html).not.toContain('border-red-200');
  });
});

describe('Home: calm profit card after Needs Attention; low-value blocks folded', () => {
  const home = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/finance']}><FinanceOverview /></MemoryRouter>);

  it('the profit block is a white card, the figure coloured by sign and the loss said in words', () => {
    const html = home();
    expect(html).not.toContain('bg-gradient');
    const card = html.slice(html.indexOf('data-testid="profit-card"') - 200);
    expect(card).toMatch(/data-tone="negative"/);
    expect(card).toContain('text-red-700');
    expect(card).toContain('(loss)');
  });

  it('order: position strip → Needs Attention → profit card; AI / purchase requests in "More insights"', () => {
    const html = home();
    const at = (id) => html.indexOf(`data-testid="${id}"`);
    expect(at('position-strip')).toBeGreaterThan(-1);
    expect(at('position-strip')).toBeLessThan(at('needs-attention'));
    expect(at('needs-attention')).toBeLessThan(at('profit-card'));
    expect(at('profit-card')).toBeLessThan(at('more-insights'));
    expect(at('more-insights')).toBeLessThan(at('ai-anomaly'));
    expect(at('more-insights')).toBeLessThan(at('purchase-requests'));
    // Folded, not removed: a closed <details> keeps them rendered.
    expect(html).toMatch(/<details class="group[^"]*" data-testid="more-insights">/);
  });

  it('the position strip is two tiles per row on phones, four on wide screens', () => {
    expect(home()).toMatch(/class="grid grid-cols-2 xl:grid-cols-4 gap-3" data-testid="position-strip"/);
  });
});

describe('Payment form: optional fields under "More details"', () => {
  const fields = (form) => renderToStaticMarkup(<PaymentFields form={form} set={() => {}} accounts={[]} hideAccount />);

  it('folded when empty, still rendered (so values and uploads keep working)', () => {
    const html = fields(blankPaymentForm({ amount: '100' }));
    expect(html).toMatch(/<details class="[^"]*" data-testid="more-details">/);
    expect(html).toContain('Remarks');
    expect(html).toContain('WHT rate');
  });

  it('opens by itself when an optional field holds a value', () => {
    expect(fields({ ...blankPaymentForm({ amount: '100' }), notes: 'paid in two parts' })).toMatch(/<details open="" [^>]*data-testid="more-details">/);
    expect(fields({ ...blankPaymentForm({ amount: '100' }), whtAmount: '50' })).toMatch(/<details open="" [^>]*data-testid="more-details">/);
  });
});

describe('status words used by Finance have a colour', () => {
  it('Cleared, Uncleared and the profit accuracy words are not the unknown grey', () => {
    for (const s of ['Cleared', 'Uncleared', 'Exact', 'Estimated', 'Operational Only', 'Not Costed', 'Missing Prices']) {
      expect([s, statusStyle(s)]).not.toEqual([s, statusStyle('some unknown word')]);
    }
  });
});
