import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { overviewSummaryParams } from '../hooks/useFinanceDateRange';
import { alertSeverity } from '../utils/alerts';

/**
 * Finance › Home: the summary endpoint gets the selected period (as
 * start_date / end_date — the names it reads), tiles that are not period-
 * filtered say so, alerts are coloured by `severity`, show `message` and link
 * to their page, journals show their number and reference, the warning about
 * a missing FX rate links to Accounting › Rates, and the old quick-action row
 * is gone (the header actions replace it).
 */

const summaryHook = vi.fn(() => ({
  data: {
    consolidated: { profitPkr: 1000 }, export: {}, mill: {}, local: {},
    warnings: ["FX rate from system default — no current rate in fx_rates table. Add today's rate in Finance → Rates."],
  },
  isLoading: false, refetch: () => {},
}));
let mockAlerts = [];
let mockJournals = [];
vi.mock('../../../api/queries', () => ({
  useFinanceOverviewSummary: (...a) => summaryHook(...a),
  useReceivables: () => ({ data: [] }),
  usePayables: () => ({ data: [] }),
  useFinanceAlerts: () => ({ data: mockAlerts }),
  useJournalEntries: () => ({ data: mockJournals }),
  useUpcoming: () => ({ data: null }),
  useApprovePayrollRun: () => ({ mutateAsync: vi.fn() }),
  usePayPayrollRun: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isError: false }) }));
vi.mock('../../analytics/api/services', () => ({ reportingApi: {} }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: vi.fn() }) }));
vi.mock('../../../hooks/useConfirm', () => ({ default: () => [vi.fn(), null] }));
vi.mock('../../ai/components/AnomalyWatchCard', () => ({ default: () => null }));
vi.mock('../../purchaseRequirements/components/PurchaseRequirementsPanel', () => ({ default: () => null }));
// Needs Attention and Recent activity have their own tests (needsAttention.test.jsx).
vi.mock('../components/NeedsAttention', () => ({ default: () => <div data-testid="needs-attention" /> }));
vi.mock('../components/RecentActivity', () => ({ default: () => <div data-testid="recent-activity" /> }));

const { default: FinanceOverview } = await import('../pages/FinanceOverview');
const renderAt = (url) => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><FinanceOverview /></MemoryRouter>);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

beforeEach(() => { summaryHook.mockClear(); mockAlerts = []; mockJournals = []; });

describe('Home honours the period', () => {
  it('passes start_date / end_date (end of the last day) to the summary hook', () => {
    renderAt('/finance?range=year');
    const y = new Date().getFullYear();
    expect(summaryHook).toHaveBeenCalledWith({ start_date: `${y}-01-01`, end_date: `${y}-12-31 23:59:59.999` });
  });

  it('all time → no date params', () => {
    renderAt('/finance');
    expect(summaryHook).toHaveBeenCalledWith({});
  });

  it('overviewSummaryParams maps the list-endpoint names to the summary endpoint names', () => {
    expect(overviewSummaryParams({ from_date: '2026-10-01', to_date: '2026-10-31' }))
      .toEqual({ start_date: '2026-10-01', end_date: '2026-10-31 23:59:59.999' });
    expect(overviewSummaryParams({})).toEqual({});
  });

  it('labels the hero with the period and the tiles that are not period-filtered', () => {
    const t = text(renderAt('/finance?range=month'));
    expect(t).toContain('Net profit (books) · This Month');
    expect(t).toContain('Receivables · all open');
    expect(t).toContain('Payables · all open');
    expect(t).toContain('Cash Position · now');
    expect(t).toContain('Collection Rate · due to date');
    expect(text(renderAt('/finance'))).toContain('Net profit (books) · All time');
  });
});

describe('Home defects', () => {
  it('the alerts panel is replaced by Needs Attention and Recent activity (the Alerts page stays)', () => {
    mockAlerts = [{ id: 'overdue_payables', type: 'payable', severity: 'danger', title: 'Overdue payables', message: '3 bill(s) past due', link: '/finance/money-out' }];
    const html = renderAt('/finance');
    expect(html).toContain('data-testid="needs-attention"');
    expect(html).toContain('data-testid="recent-activity"');
    expect(html).not.toContain('data-severity=');
    // Payroll approvals are Needs Attention items now, not a separate card.
    expect(text(html)).not.toContain('Payroll awaiting approval');
  });

  it('alertSeverity reads severity before type', () => {
    expect(alertSeverity({ type: 'payable', severity: 'danger' })).toBe('danger');
    expect(alertSeverity({ type: 'receivable', severity: 'info' })).toBe('info');
    expect(alertSeverity({ severity: 'critical' })).toBe('danger');
  });

  it('shows the journal number and reference', () => {
    mockJournals = [{ id: 1, journalNo: 'JE-202610-0001', refNo: 'EX-101', description: 'Shipment COGS', date: '2026-10-01' }];
    expect(text(renderAt('/finance'))).toContain('JE-202610-0001 · EX-101');
  });

  it('turns "Finance → Rates" into a link to Accounting › Rates (with the period)', () => {
    const html = renderAt('/finance?range=week');
    expect(html).toContain('href="/finance/accounting/rates?range=week"');
    expect(text(html)).toContain('Accounting › Rates');
  });

  it('the quick-action row (Internal Transfer / Reconcile pointed at the wrong pages) is gone', () => {
    const t = text(renderAt('/finance'));
    expect(t).not.toContain('Quick actions');
    expect(t).not.toContain('Internal Transfer');
    expect(t).not.toContain('Reconcile');
  });
});
