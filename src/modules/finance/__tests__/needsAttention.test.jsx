import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { buildNeedsAttention, countByCurrency } from '../utils/needsAttention';

/**
 * Home ▸ Needs Attention: items built from the existing endpoints, each with
 * its own action, hidden (and counted) for roles the action's route refuses,
 * and every amount in its own currency — never converted, never summed.
 */
const allow = (...p) => (m, a) => p.includes(`${m}.${a}`);
const FM = allow('finance.view', 'finance.confirm_payment', 'finance.post_journal', 'payroll.approve', 'payroll.pay');
const AUDITOR = allow('finance.view');
const TODAY = new Date('2026-10-09T09:00:00');

const SOURCES = {
  pendingReceipts: [{ id: 1, orderNo: 'EX-101', receiptType: 'advance', amount: 2000, currency: 'USD', recordedByName: 'Export One', bookedFxRate: 280 }],
  receivables: [
    { id: 10, recvNo: 'RCV-BAL-1', type: 'Balance', currency: 'USD', outstanding: 3000, status: 'Overdue', dueDate: '2026-10-01', customerName: 'Buyer' },
    { id: 11, kind: 'local_sale', saleGroupNo: 'LS-9', recvNo: 'LS-9', type: 'Local Sale', outstanding: 45000, status: 'Partial', dueDate: '2026-10-30', customerName: 'Shop' },
    { id: 12, recvNo: 'RCV-ADV-2', type: 'Advance', currency: 'USD', outstanding: 500, status: 'Pending', dueDate: '2026-10-12', orderId: 77 },
    { id: 13, recvNo: 'RCV-FUTURE', type: 'Balance', currency: 'USD', outstanding: 500, status: 'Pending', dueDate: '2026-12-01' },
    { id: 14, recvNo: 'RCV-PAID', type: 'Balance', currency: 'USD', outstanding: 0, status: 'Paid', dueDate: '2026-09-01' },
  ],
  upcoming: {
    receiving: [{ kind: 'cheque', paymentId: 50, paymentNo: 'PAY-050', amount: 12000, currency: 'PKR', dueDate: '2026-10-08', party: 'Shop', partyType: 'customer' }],
    giving: [{ kind: 'cheque', paymentId: 51, amount: 9, currency: 'PKR', dueDate: '2026-11-30' }, { kind: 'credit', amount: 1, dueDate: '2026-10-01' }],
  },
  fundTransfers: [
    { id: 60, transferNo: 'FT-1', status: 'pending', toEntity: 'general', amount: 100000, currency: 'PKR' },
    { id: 61, transferNo: 'FT-2', status: 'pending', toEntity: 'mill', amount: 5000, currency: 'PKR' },
    { id: 62, transferNo: 'FT-3', status: 'completed', toEntity: 'general', amount: 1, currency: 'PKR' },
  ],
  payroll: { runs: [{ id: 70, period: '2026-09', status: 'prepared', net: 800000, employeeCount: 40 }, { id: 71, period: '2026-08', status: 'approved', net: 790000, employeeCount: 40 }] },
  purchaseRequests: [{ id: 80, pr_no: 'PR-1', status: 'approved', est_amount: 15000, currency: 'PKR', item_name: 'Bags' }],
  suspense: [
    { id: 90, entry_no: 'SUS-1', status: 'Open', direction: 'receipt', amount: 7000, resolved_amount: 0, currency: 'PKR' },
    { id: 91, entry_no: 'SUS-2', status: 'Resolved', amount: 1, resolved_amount: 1, currency: 'PKR' },
  ],
  accounts: [{ id: 3, name: 'Petty Cash', type: 'cash', currency: 'PKR', currentBalance: -2500 }, { id: 4, name: 'USD', currency: 'USD', currentBalance: 10 }],
  fx: { latest: { rate: 281, effectiveDate: '2026-08-01', source: 'fx_rates' } },
  summary: { export: { cogsStatus: { shippedMissingCogs: 2 } }, warnings: ['Something to check'] },
};

describe('buildNeedsAttention', () => {
  it('builds one item per thing to do, each with its action', () => {
    const { items, hiddenCount } = buildNeedsAttention(SOURCES, FM, TODAY);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey['receipt-1']).toMatchObject({ amount: 2000, currency: 'USD', action: { type: 'confirmReceipt', needsRate: true } });
    expect(byKey['recv-receivable-10']).toMatchObject({ severity: 'danger', currency: 'USD', amount: 3000, action: { type: 'receive' } });
    expect(byKey['recv-local_sale-11']).toMatchObject({ currency: 'PKR', amount: 45000, action: { type: 'receive' } });
    expect(byKey['recv-receivable-12']).toMatchObject({ title: expect.stringMatching(/^Advance due/), currency: 'USD' });
    expect(byKey['recv-receivable-13']).toBeUndefined(); // due in December — not yet
    expect(byKey['recv-receivable-14']).toBeUndefined(); // paid
    expect(byKey['cheque-50']).toMatchObject({ severity: 'danger', action: { type: 'clearCheque' } });
    expect(byKey['cheque-51']).toBeUndefined(); // clears in November
    expect(byKey['transfer-60']).toMatchObject({ action: { type: 'acceptTransfer' } });
    expect(byKey['payroll-70'].action.type).toBe('approvePayroll');
    expect(byKey['payroll-71'].action.type).toBe('payPayroll');
    expect(byKey['pr-80'].action.type).toBe('markPurchased');
    expect(byKey['suspense-90']).toMatchObject({ amount: 7000, action: { type: 'resolveSuspense' } });
    expect(byKey['suspense-91']).toBeUndefined();
    expect(byKey['overdrawn-3']).toMatchObject({ amount: -2500, currency: 'PKR', action: { type: 'openAccount' } });
    expect(byKey['fx-stale']).toMatchObject({ action: { type: 'addRate' } });
    expect(byKey['warn-cogs'].action).toBeNull();
    expect(byKey['warn-0'].title).toBe('Something to check');
    // FT-2 lands at the Mill: milling.edit accepts it, not Finance.
    expect(byKey['transfer-61']).toBeUndefined();
    expect(hiddenCount).toBe(1);
  });

  it('never converts or sums: each item keeps its own currency', () => {
    const { items } = buildNeedsAttention(SOURCES, FM, TODAY);
    for (const i of items) if (i.amount != null) expect(['PKR', 'USD']).toContain(i.currency);
    expect(items.find((i) => i.key === 'recv-receivable-10').amount).toBe(3000); // not 3000 × rate
    expect(countByCurrency(items)).toMatchObject({ USD: expect.any(Number), PKR: expect.any(Number) });
  });

  it('a read-only role sees only the warnings and the overdrawn account; the rest are counted', () => {
    const { items, hiddenCount } = buildNeedsAttention(SOURCES, AUDITOR, TODAY);
    expect(items.map((i) => i.kind).sort()).toEqual(['overdrawn', 'warning', 'warning']);
    expect(hiddenCount).toBeGreaterThan(8);
  });

  it('each action asks for its own permission', () => {
    const only = (perms) => buildNeedsAttention(SOURCES, allow('finance.view', ...perms), TODAY).items.map((i) => i.action?.type).filter(Boolean);
    expect(only(['payroll.approve'])).toContain('approvePayroll');
    expect(only(['payroll.approve'])).not.toContain('payPayroll');
    expect(only(['payroll.pay'])).toContain('payPayroll');
    expect(only(['finance.post_journal'])).toContain('resolveSuspense');
    expect(only(['finance.post_journal'])).not.toContain('confirmReceipt');
    expect(only(['milling.edit'])).toEqual(expect.arrayContaining(['acceptTransfer', 'markPurchased']));
    expect(only(['inventory.create'])).toEqual(expect.arrayContaining(['receive'])); // a local sale's receipt route
  });

  it('a fresh rate raises nothing; a missing one (system default) does', () => {
    const fresh = buildNeedsAttention({ fx: { latest: { effectiveDate: '2026-10-05', source: 'fx_rates' } } }, FM, TODAY).items;
    expect(fresh.find((i) => i.kind === 'staleFx')).toBeUndefined();
    const none = buildNeedsAttention({ fx: { latest: { rate: 280, source: 'system_settings_fallback', effectiveDate: null } } }, FM, TODAY).items;
    expect(none.find((i) => i.kind === 'staleFx').title).toMatch(/No USD rate/);
  });

  it('dangers first', () => {
    const { items } = buildNeedsAttention(SOURCES, FM, TODAY);
    const sev = items.map((i) => i.severity);
    expect(sev.indexOf('danger')).toBe(0);
    expect(sev.lastIndexOf('danger')).toBeLessThan(sev.indexOf('warning'));
  });
});

// ── the component, from mocked endpoints ──────────────────────────────
let mockPerms = FM;
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: (m, a) => mockPerms(m, a) }) }));
vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: vi.fn() }) }));
vi.mock('../../../hooks/useConfirm', () => ({ default: () => [vi.fn(), null] }));
vi.mock('../drawers/drawersContext', () => ({ useFinanceDrawers: () => ({ openPayment: vi.fn(), openAccount: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }) => ({ data: queryKey[0] === 'payroll-pending' ? SOURCES.payroll : queryKey[0] === 'suspense' ? SOURCES.suspense : SOURCES.purchaseRequests }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
const mut = () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false });
vi.mock('../../../api/queries', () => ({
  usePendingExportReceipts: () => ({ data: SOURCES.pendingReceipts }),
  useConfirmExportReceipt: mut, useRejectExportReceipt: mut, useAcceptFundTransfer: mut, useClearCheque: mut,
  useApprovePayrollRun: mut, usePayPayrollRun: mut,
  useReceivables: () => ({ data: SOURCES.receivables }),
  useUpcoming: () => ({ data: SOURCES.upcoming }),
  useFundTransfers: () => ({ data: SOURCES.fundTransfers }),
  useBankAccounts: () => ({ data: SOURCES.accounts }),
  useFxRates: () => ({ data: SOURCES.fx }),
}));
vi.mock('../../analytics/api/services', () => ({ reportingApi: {} }));
vi.mock('../../purchaseRequirements/api/services', () => ({ purchaseRequirementsApi: {} }));
vi.mock('../api/services', () => ({ financeApi: {} }));
vi.mock('../pages/DueDates', () => ({ ClearChequeDialog: () => null }));
vi.mock('../pages/Suspense', () => ({ ResolveDrawer: () => null }));

const { default: NeedsAttention } = await import('../components/NeedsAttention');
const render = () => renderToStaticMarkup(<MemoryRouter><NeedsAttention summary={SOURCES.summary} /></MemoryRouter>);
const actions = (html) => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => { mockPerms = FM; });

describe('<NeedsAttention />', () => {
  it('Finance gets the actions (Confirm with the rate inline, Reject, Receive, Clear, Accept, Approve, Pay, Resolve…)', () => {
    const html = render();
    expect(actions(html)).toEqual(expect.arrayContaining([
      'confirmReceipt', 'rejectReceipt', 'receive', 'clearCheque', 'acceptTransfer', 'approvePayroll', 'payPayroll', 'markPurchased', 'resolveSuspense', 'openAccount', 'addRate',
    ]));
    expect(html).toContain('aria-label="FX rate the bank applied"');
    expect(html).toMatch(/data-currency="USD"[^>]*>\$2,000\.00/);
    expect(html).toContain('href="/finance/alerts"');
  });

  it('a read-only role sees no write action and a count of what others will handle', () => {
    mockPerms = AUDITOR;
    const html = render();
    expect(actions(html)).toEqual(['openAccount']);
    expect(html).toContain('data-testid="na-hidden"');
  });
});
