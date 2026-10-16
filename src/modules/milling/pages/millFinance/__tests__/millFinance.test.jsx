import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// ── Mocks: every API hook is recorded, so a render can be checked for what it
// asked the server for. Hooks return { data } from FIXTURES (undefined if none).
const { calls, FIXTURES, MUTATION, HOOKS, hook, auth } = vi.hoisted(() => {
  const calls = [];
const FIXTURES = {};
const MUTATION = /^use(Create|Update|Delete|Approve|Reject|Pay|Void|Accrue|Settle|Record|Post|Materialize|RunDue|Run|Stop|Accept|Set|Save|Import|Bulk|Categorize|Finalize|Revise|Resolve)/;
const hook = (name) => (...args) => {
  calls.push({ name, args });
  return { data: FIXTURES[name], isLoading: false, isFetching: false, mutateAsync: vi.fn(), isPending: false, refetch: vi.fn() };
};
const HOOKS = `useAcceptFundTransfer useAcceptLocalSalePayment useAccruePayrollRun useAdvanceLedger useApproveAdvance
 useApproveLeaveRequest useApprovePayrollRun useAttendance useAttendanceHolidays useBankAccounts useBulkAttendance
 useCategorizeExpense useCreateContraTransfer useCreateLeaveType useCreateMillExpense useCreateMillExpenseHead
 useCreateMillWorker useCreateStatutoryDeduction useCreateStatutoryRemittance useCreateWorkerAdjustment
 useCreateWorkerAdvance useCustomers useDeleteLeaveType useDeleteMillWorker useDeletePayrollRun
 useDeleteStatutoryDeduction useDeleteStatutoryRemittance useDeleteWorkerAdjustment useDeleteWorkerAdvance
 useExpenseVendors useFinalizeSettlement useFinalSettlement useHeldStockProfit useImportAttendance useLeaveRequests
 useLeaveRequestsCount useLeaveTypes useLocalSales useMaterializeRecurring useMillCashFlow useMillExpenseHeads
 useMillExpenses useMillFinanceKpiDetail useMillFinanceKpis useMillLotCosts useMillPayables useMillReceivables
 useMillWorkers usePayablePayments usePayables usePayAdvance usePayPayrollRun usePayrollAudit usePayrollReport
 usePayrollRun usePayrollRuns usePayrollSchedule usePayrollSummary usePendingAdvances usePostPayrollRun useProfitLoss
 useReceivables useRecordAttendance useRecordPayment useRecurringExpenses useRejectAdvance useRejectLeaveRequest
 useResolveWorkerRequest useReviseSalary useRunDueRecurring useRunPayrollNow useSalaryRevisions useSavePayrollSchedule
 useSettlePayrollRun useSetWorkerPortalPin useStatutoryDeductions useStatutoryLiabilities useStatutoryRemittances
 useStopRecurring useSuppliers useTaxStatement useUpdateLeaveType useUpdateMillWorker useUpdateStatutoryDeduction
 useVoidPayrollRun useVoidWorkerAdvance useWorkerAdjustments useWorkerAdvances useWorkerLedger useWorkerRequests
 useWorkerRequestsCount`.split(/\s+/).filter(Boolean);
  const auth = { granted: new Set() };
  return { calls, FIXTURES, MUTATION, HOOKS, hook, auth };
});
vi.mock('../../../../../api/queries', () => Object.fromEntries(HOOKS.map((n) => [n, hook(n)])));

vi.mock('../../../../../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (m, a) => auth.granted.has(`${m}.${a}`), user: { id: 1 } }),
}));
vi.mock('../../../../../context/AppContext', () => ({
  useApp: () => ({ addToast: vi.fn(), millingBatches: [], companyProfileData: {}, bankAccountsList: [] }),
}));
vi.mock('../../../../../context/OwnerAuthContext', () => ({ useOwnerAuth: () => ({ requestOwnerApproval: vi.fn() }) }));
// The AI card is a stub that leaves a marker: if it renders, the LLM is called.
vi.mock('../../../../ai/components/AnomalyWatchCard', () => ({ default: () => 'ANOMALY-CARD-MOUNTED' }));

import MillFinanceDashboard from '../../MillFinanceDashboard';
import { resolveLocation, LEGACY_TABS, mfHref } from '../urlState';
import { historyRows, filterHistory } from '../transactions/history';
import { groupBalances } from '../balances';

const ALL_MONEY = ['finance.view', 'finance.confirm_payment', 'milling.view', 'milling.edit', 'milling.create',
  'mill_store.create_purchase', 'reports.view', 'payroll.view', 'payroll.create'];

function render(url) {
  calls.length = 0;
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}><MillFinanceDashboard /></MemoryRouter>,
  );
}
const queriesCalled = () => [...new Set(calls.map((c) => c.name).filter((n) => !MUTATION.test(n)))].sort();

beforeEach(() => {
  auth.granted = new Set(ALL_MONEY);
  for (const k of Object.keys(FIXTURES)) delete FIXTURES[k];
});

describe('Mill Finance URL state', () => {
  it('maps every one of the eleven old ?tab= links somewhere real', () => {
    expect(Object.keys(LEGACY_TABS).sort()).toEqual(
      ['addcosts', 'customers', 'efficiency', 'expenses', 'loss', 'moneyflow', 'overview', 'payroll', 'recurring', 'suppliers', 'utilities'],
    );
    const r = (qs) => resolveLocation(new URLSearchParams(qs));
    expect(r('tab=moneyflow')).toMatchObject({ section: 'transactions', view: 'history' });
    expect(r('tab=expenses')).toMatchObject({ section: 'transactions', view: 'expenses', cat: null });
    expect(r('tab=utilities')).toMatchObject({ section: 'transactions', view: 'expenses', cat: 'utilities' });
    expect(r('tab=recurring')).toMatchObject({ section: 'transactions', view: 'recurring' });
    expect(r('tab=addcosts')).toMatchObject({ section: 'transactions', view: 'lotcosts' });
    expect(r('tab=efficiency')).toMatchObject({ section: 'performance', focus: 'efficiency' });
    expect(r('tab=loss')).toMatchObject({ section: 'performance', focus: 'loss' });
    expect(r('tab=payroll')).toMatchObject({ workspace: 'payroll' });
    // Mill Customers / Suppliers pages link this way.
    expect(r('tab=customers&customer=7')).toMatchObject({ section: 'parties', party: 'customers', customer: '7' });
    expect(r('tab=suppliers&supplier=3')).toMatchObject({ section: 'parties', party: 'suppliers', supplier: '3' });
    expect(r('customer=7')).toMatchObject({ section: 'parties', party: 'customers' });
  });

  it('defaults to Overview, This month; keeps a remembered period; ignores junk', () => {
    expect(resolveLocation(new URLSearchParams(''))).toMatchObject({ section: 'overview', period: 'month', workspace: null });
    expect(resolveLocation(new URLSearchParams(''), { fallbackPeriod: 'fytd' }).period).toBe('fytd');
    expect(resolveLocation(new URLSearchParams('period=quarter'), { fallbackPeriod: 'fytd' }).period).toBe('quarter');
    expect(resolveLocation(new URLSearchParams('section=nope&period=decade&view=zzz'))).toMatchObject({ section: 'overview', period: 'month', view: 'history' });
  });

  it('builds hrefs that carry the period (but not into the payroll workspace)', () => {
    expect(mfHref({ section: 'parties', party: 'customers' }, 'quarter')).toBe('/milling/finance?section=parties&party=customers&period=quarter');
    expect(mfHref({ workspace: 'payroll' }, 'quarter')).toBe('/milling/finance?workspace=payroll');
  });
});

describe('unified history helpers', () => {
  const ledger = [
    { id: 1, direction: 'in', amount_pkr: 1000, counted: true, payment_date: '2026-10-01', counterparty: 'Ali Traders', ref: 'LS-1', currency: 'PKR', recorded_by: 'Asad' },
    { id: 2, direction: 'out', amount_pkr: 300, counted: false, status: 'Reversed', payment_date: '2026-10-02', counterparty: 'Fuel Co' },
    { id: 3, direction: 'out', amount_pkr: 200, counted: false, cleared: false, payment_date: '2026-10-03', counterparty: 'Bag Co' },
    { id: 'ft-9', direction: 'out', amount_pkr: 400, counted: true, isTransfer: true, status: 'pending', payment_date: '2026-10-04', counterparty: 'To Head Office', ref: 'FT-9', approved_by: null },
  ];
  const rows = historyRows(ledger);

  it('is newest first, and only counted rows move the running balance', () => {
    expect(rows.map((r) => r.id)).toEqual(['ft-9', 3, 2, 1]);
    expect(rows.find((r) => r.id === 1).balance).toBe(1000);
    expect(rows.find((r) => r.id === 3).balance).toBe(1000); // uncleared cheque: not money yet
    expect(rows.find((r) => r.id === 'ft-9').balance).toBe(600);
  });

  it('labels entity and status, never merging Head Office into the mill', () => {
    const ft = rows.find((r) => r.id === 'ft-9');
    expect(ft.entityLabel).toBe('Mill → Head Office');
    expect(ft.statusLabel).toBe('Awaiting acceptance');
    expect(rows.find((r) => r.id === 2).statusLabel).toBe('Reversed');
    expect(rows.find((r) => r.id === 3).statusLabel).toBe('Uncleared cheque');
    expect(rows.find((r) => r.id === 1)).toMatchObject({ entityLabel: 'Mill', currency: 'PKR', amountOriginal: 1000 });
  });

  it('filters by direction, transfers, status and text', () => {
    expect(filterHistory(rows, { dir: 'in' }).map((r) => r.id)).toEqual([1]);
    expect(filterHistory(rows, { dir: 'transfers' }).map((r) => r.id)).toEqual(['ft-9']);
    expect(filterHistory(rows, { status: 'not_counted' }).map((r) => r.id)).toEqual([3, 2]);
    expect(filterHistory(rows, { status: 'pending' }).map((r) => r.id)).toEqual(['ft-9', 3]);
    expect(filterHistory(rows, { q: 'asad' }).map((r) => r.id)).toEqual([1]);
  });
});

describe('cash & bank position', () => {
  it('keeps Mill and Head Office apart and never adds PKR to USD', () => {
    const g = groupBalances([
      { id: 1, entity: 'mill', currency: 'PKR', currentBalance: 500, type: 'cash' },
      { id: 2, entity: 'mill', currency: 'PKR', currentBalance: -100 },
      { id: 3, entity: 'general', currency: 'USD', currentBalance: 70 },
      { id: 4, entity: 'general', currency: 'PKR', currentBalance: 1000 },
      { id: 5, entity: 'general', currency: 'PKR', currentBalance: 9, isActive: false },
    ]);
    expect(g.mill).toEqual([expect.objectContaining({ currency: 'PKR', total: 400 })]);
    expect(g.general.map((x) => [x.currency, x.total])).toEqual([['PKR', 1000], ['USD', 70]]);
  });
});

describe('Mill Finance — Overview', () => {
  it('renders the overview, ONE period control and the four primary actions', () => {
    const html = render('/milling/finance');
    expect(html).toContain('data-testid="mf-overview"');
    expect(html).toContain('data-testid="mill-profit-headline"');
    expect((html.match(/aria-label="Period"/g) || []).length).toBe(1);
    for (const a of ['record-expense', 'pay-supplier', 'receive-money', 'transfer-funds']) expect(html).toContain(`data-testid="action-${a}"`);
    expect(html).toContain('data-testid="more-actions"');
  });

  it('asks the server for at most four things on first load, and never the AI', () => {
    const html = render('/milling/finance');
    const q = queriesCalled();
    expect(q).toEqual(['useBankAccounts', 'useMillCashFlow', 'useMillFinanceKpis', 'useRecurringExpenses']);
    expect(html).not.toContain('ANOMALY-CARD-MOUNTED');
    expect(calls.some((c) => /Categorize/.test(c.name))).toBe(false);
    for (const n of ['usePayrollSummary', 'useMillWorkers', 'usePayables', 'useLocalSales', 'useProfitLoss', 'useMillExpenses']) {
      expect(q).not.toContain(n);
    }
  });

  it('links every tile to the filtered list behind it', () => {
    FIXTURES.useMillCashFlow = {
      moneyOutStreams: [{ stream: 'Rice & lot costs', billed: 100, paid: 40, outstanding: 60 }],
      moneyInSummary: { billed: 50, collected: 20, outstanding: 30 },
      pendingTransfers: [{ id: 4, transferNo: 'FT-4', amount: 10 }], pendingTransfersTotal: 10,
      summary: { cashIn: 1, cashOut: 2 }, millCashBalance: 5,
    };
    const html = render('/milling/finance?period=quarter');
    const href = (testId) => {
      const tag = (html.match(new RegExp(`<a[^>]*data-testid="${testId}"[^>]*>`)) || [])[0] || '';
      const m = tag.match(/href="([^"]+)"/);
      return m && m[1].replace(/&amp;/g, '&');
    };
    expect(href('tile-payables')).toBe('/milling/finance?section=transactions&view=payables&period=quarter');
    expect(href('tile-expenses')).toBe('/milling/finance?section=transactions&view=expenses&period=quarter');
    expect(href('tile-batch-cost')).toBe('/milling/finance?section=performance&focus=efficiency&period=quarter');
    expect(href('tile-receivables')).toBe('/milling/finance?section=parties&party=customers&period=quarter');
    expect(href('tile-transfers')).toBe('/milling/finance?section=transactions&view=history&dir=transfers&period=quarter');
    expect(href('mill-profit-headline-tile')).toBe('/milling/finance?section=performance&period=quarter');
    expect(html).toContain('data-testid="mf-position-mill"');
    expect(html).toContain('data-testid="mf-position-ho"');
    expect(html).toContain('Accept funds');
  });

  it('hides Head Office balances and the accept button from roles without the permission', () => {
    auth.granted = new Set(['milling.view']);
    FIXTURES.useMillCashFlow = { pendingTransfers: [{ id: 4, transferNo: 'FT-4', amount: 10 }], pendingTransfersTotal: 10 };
    const html = render('/milling/finance');
    expect(html).toContain('visible to Finance only');
    expect(html).not.toContain('Accept funds');
    expect(calls.find((c) => c.name === 'useBankAccounts').args[0]).toEqual({ millOnly: true });
  });
});

describe('Mill Finance — primary actions are permission-gated', () => {
  const actions = (html) => ['record-expense', 'pay-supplier', 'receive-money', 'transfer-funds'].filter((a) => html.includes(`data-testid="action-${a}"`));

  it('a view-only role sees none of them', () => {
    auth.granted = new Set(['milling.view', 'reports.view_cost']);
    expect(actions(render('/milling/finance'))).toEqual([]);
  });
  it('milling.create alone → Record Expense only', () => {
    auth.granted = new Set(['milling.view', 'milling.create']);
    expect(actions(render('/milling/finance'))).toEqual(['record-expense']);
  });
  it('finance.confirm_payment → Pay / Receive / Transfer, not Record Expense', () => {
    auth.granted = new Set(['finance.view', 'finance.confirm_payment']);
    expect(actions(render('/milling/finance'))).toEqual(['pay-supplier', 'receive-money', 'transfer-funds']);
  });
  it("the mill operator (milling.edit) can pay and transfer the mill's own money", () => {
    auth.granted = new Set(['milling.view', 'milling.edit', 'milling.create']);
    expect(actions(render('/milling/finance'))).toEqual(['record-expense', 'pay-supplier', 'receive-money', 'transfer-funds']);
  });
  it('the payroll workspace link only for payroll holders', () => {
    auth.granted = new Set(['milling.view']);
    expect(render('/milling/finance')).not.toContain('data-testid="payroll-workspace-link"');
    auth.granted = new Set(['milling.view', 'payroll.view']);
    expect(render('/milling/finance')).toContain('data-testid="payroll-workspace-link"');
  });
});

describe('Mill Finance — sections render and load only their own data', () => {
  it('Transactions ▸ History', () => {
    FIXTURES.useMillCashFlow = { ledger: [{ id: 1, direction: 'in', amount_pkr: 1000, counted: true, payment_date: '2026-10-01', counterparty: 'Ali Traders', ref: 'LS-1', recorded_by: 'Asad', approved_by: 'Bilal', currency: 'PKR' }], summary: {} };
    const html = render('/milling/finance?section=transactions');
    expect(html).toContain('data-testid="mf-history"');
    expect(html).toContain('Ali Traders');
    expect(html).toContain('approved Bilal');
    expect(queriesCalled()).toEqual(['useMillCashFlow']);
  });
  it('Transactions ▸ Payables / Expenses / Recurring / Lot costs', () => {
    expect(render('/milling/finance?section=transactions&view=payables')).toContain('data-testid="mf-payables"');
    expect(render('/milling/finance?section=transactions&view=expenses')).toContain('data-testid="mf-expenses"');
    expect(queriesCalled()).toContain('useMillExpenses');
    expect(render('/milling/finance?tab=utilities')).toContain('Utilities &amp; running costs');
    expect(render('/milling/finance?section=transactions&view=recurring')).toContain('data-testid="mf-recurring"');
    expect(render('/milling/finance?section=transactions&view=lotcosts')).toContain('data-testid="mf-lotcosts"');
  });
  it('Parties ▸ Suppliers and Customers', () => {
    let html = render('/milling/finance?section=parties');
    expect(html).toContain('data-testid="mf-parties"');
    expect(html).toContain('Mill supplier directory');
    html = render('/milling/finance?tab=customers');
    expect(html).toContain('Local customer directory');
    expect(queriesCalled()).not.toContain('useMillFinanceKpis');
  });
  it('Performance — no AI until asked', () => {
    let html = render('/milling/finance?section=performance');
    expect(html).toContain('data-testid="mf-performance"');
    expect(html).toContain('data-testid="run-anomaly-analysis"');
    expect(html).not.toContain('ANOMALY-CARD-MOUNTED');
    expect(html).toContain('id="mf-perf-efficiency"');
    expect(html).toContain('id="mf-perf-loss"');
    // Reached from More actions ▸ Anomaly analysis — an explicit request.
    html = render('/milling/finance?section=performance&focus=anomalies');
    expect(html).toContain('ANOMALY-CARD-MOUNTED');
  });
  it('Payroll is its own workspace, reachable from the old tab link', () => {
    auth.granted = new Set(['milling.view', 'payroll.view']);
    let html = render('/milling/finance?tab=payroll');
    expect(html).toContain('data-testid="payroll-workspace"');
    expect(html).not.toContain('data-testid="mill-finance"');
    auth.granted = new Set(['milling.view']);
    html = render('/milling/finance?workspace=payroll');
    expect(html).toContain('data-testid="payroll-no-access"');
  });
  it('Head Office Finance ▸ Payroll still renders the same workspace', () => {
    auth.granted = new Set(['payroll.view']);
    calls.length = 0;
    const html = renderToStaticMarkup(<MemoryRouter><MillFinanceDashboard payrollOnly /></MemoryRouter>);
    expect(html).toContain('data-testid="payroll-intro"');
    expect(html).toContain('data-testid="payroll-workspace"');
    expect(calls.find((c) => c.name === 'useMillWorkers').args[0]).toEqual({ entity: 'general' });
  });
});

describe('payroll run actions follow the server gates', () => {
  it('Accrue (pay later) needs payroll.pay, as POST /payroll/runs/:id/accrue does — not approve', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../payroll/runs.jsx', import.meta.url), 'utf8');
    const accrue = src.split('\n').find((l) => l.includes('Accrue (pay later)'));
    expect(accrue).toMatch(/canPay && st === 'approved'/);
    expect(accrue).not.toMatch(/canApprove/);
  });
});
