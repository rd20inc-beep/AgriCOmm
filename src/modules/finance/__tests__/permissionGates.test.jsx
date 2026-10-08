import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

/**
 * PermissionGate coverage: on every Finance page a read-only role
 * (finance.view only — the Auditor) sees no write button, and a Finance
 * Manager sees the ones its route guards admit. Each page renders from the
 * same fixtures; write buttons carry data-action.
 */
const allow = (...p) => (m, a) => p.includes(`${m}.${a}`);
const FM = allow('finance.view', 'finance.confirm_payment', 'finance.allocate_cost', 'finance.post_journal', 'export_orders.view', 'export_orders.approve');
const AUDITOR = allow('finance.view');
let mockPerms = FM;

const FIX = {
  receivables: [{ id: 1, recvNo: 'RCV-1', type: 'Balance', currency: 'PKR', expectedAmount: 100, receivedAmount: 0, outstanding: 100, status: 'Pending', customerId: 3, customerName: 'B' }],
  payables: [{ id: 2, payNo: 'PAY-2', category: 'Other', entity: 'mill', currency: 'PKR', originalAmount: 100, paidAmount: 0, outstanding: 100, status: 'Pending', supplierId: 4, supplierName: 'S' }],
  purchases: { purchases: [{ source: 'mill_store', refId: 5, ref: 'MS-5', amountPkr: 100, paidAmount: 0, paymentStatus: 'pending', date: '2026-10-01' }], totals: { totalPkr: 100, count: 1, bySource: {}, byStatus: {} } },
  upcoming: { receiving: [{ kind: 'cheque', paymentId: 9, amount: 10, currency: 'PKR', dueDate: '2026-10-01', party: 'B', partyType: 'customer' }], giving: [] },
  accounts: [{ id: 3, name: 'Cash', currency: 'PKR', currentBalance: 10, type: 'cash', entity: 'general', isActive: true }],
  fundTransfers: [{ id: 6, transferNo: 'FT-6', status: 'pending', toEntity: 'general', direction: 'mill_to_ho', amount: 10, currency: 'PKR' }],
  pendingReceipts: [{ id: 7, orderNo: 'EX-1', receiptType: 'advance', amount: 10, currency: 'USD' }],
  localSales: [{ id: 8, saleNo: 'LS-8', status: 'Completed', totalAmount: 100, paidAmount: 0, dueAmount: 100, paymentStatus: 'Credit' }],
  expenses: [{ id: 9, expense_no: 'EXP-9', expense_type: 'general', amount: 100, amount_pkr: 100, payment_status: 'Unpaid', category: 'utility_bill' }],
  suspense: [{ id: 10, entry_no: 'SUS-1', status: 'Open', direction: 'receipt', amount: 10, resolved_amount: 0, currency: 'PKR' }],
  exportOrders: [{ id: 'EX-1', dbId: 1, status: 'Awaiting Advance', advanceExpected: 100, advanceReceived: 0, balanceExpected: 0, balanceReceived: 0, createdAt: '2026-10-01', currency: 'USD', customerId: 3, customerName: 'B' }],
  statement: { transactions: [], closing_balance: 0 },
};

const listHook = (data) => () => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
const mut = () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false });
vi.mock('../../../api/queries', () => ({
  useReceivables: listHook(FIX.receivables),
  usePayables: listHook(FIX.payables),
  usePurchases: listHook(FIX.purchases),
  useUpcoming: listHook(FIX.upcoming),
  useBankAccounts: listHook(FIX.accounts),
  useBankTransactions: listHook([]),
  useFundTransfers: listHook(FIX.fundTransfers),
  usePendingExportReceipts: listHook(FIX.pendingReceipts),
  useLocalSales: listHook(FIX.localSales),
  useLocalSalesSummary: listHook({}),
  useReceivableReceipts: listHook({ payments: [] }),
  useFxRates: listHook({ rates: [], latest: { rate: 280, effectiveDate: '2026-10-01' } }),
  useCommodityRates: listHook([]),
  useProducts: listHook([]),
  useCustomers: listHook([{ id: 3, name: 'B' }]),
  useSuppliers: listHook([]),
  useExpenseVendors: listHook({}),
  useClearCheque: mut, useReverseFundTransfer: mut, useAcceptFundTransfer: mut, useConfirmExportReceipt: mut,
  useRejectExportReceipt: mut, useUpdateOrderStatus: mut,
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }) => ({
    data: queryKey[0] === 'expenses' ? (queryKey[1] === 'list' ? FIX.expenses : {}) : queryKey[0] === 'suspense' ? (queryKey[1] === 'list' ? FIX.suspense : {}) : queryKey[0] === 'party-statement' ? FIX.statement : undefined,
    isLoading: false,
  }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: (m, a) => mockPerms(m, a), user: { role: 'Finance Manager' } }) }));
vi.mock('../../../context/AppContext', () => ({
  useApp: () => ({ addToast: vi.fn(), exportOrders: FIX.exportOrders, settings: { paymentReminderDays: 7 }, customersList: [], bankAccountsList: FIX.accounts, suppliersList: [] }),
}));
vi.mock('../drawers/drawersContext', () => ({ useFinanceDrawers: () => ({ openPayment: vi.fn(), openDocument: vi.fn(), openTransaction: vi.fn(), openAccount: vi.fn(), openParty: null }) }));
vi.mock('../../../hooks/useConfirm', () => ({ default: () => [vi.fn(), null] }));
vi.mock('../hooks/useFinanceDateRange', () => ({ useFinanceDateRange: () => ({ queryParams: {}, rangeKey: '' }) }));
vi.mock('../components/ContraTransferDrawer', () => ({ default: () => null }));
vi.mock('../components/FundTransferDetailDrawer', () => ({ default: () => null }));
vi.mock('../components/StatementPayDrawer', () => ({ default: () => null }));
vi.mock('../components/ExpenseCreateDrawer', () => ({ default: () => null }));
vi.mock('../../ai/components/DraftEmailDrawer', () => ({ default: () => null }));
vi.mock('../../milling/components/LedgerTypeCounts', () => ({ default: () => null }));
vi.mock('../../milling/components/PartyAllocationLedger', () => ({ default: () => null }));
vi.mock('../../milling/components/OpenItemsPanel', () => ({ default: () => null }));
vi.mock('../../../components/NewPurchaseDrawer', () => ({ default: () => null }));
vi.mock('../../../components/EmailComposer', () => ({ default: () => null }));
vi.mock('../../../components/finance', () => ({
  FinanceKPI: () => null, FinanceChart: () => null, FinanceFilterBar: () => null,
  // The table renders each row's action cell so the buttons are visible.
  FinanceTable: ({ data = [], actions }) => <div>{actions && data.map((r, i) => <span key={i}>{actions(r)}</span>)}</div>,
}));

const pages = {
  MoneyIn: (await import('../pages/MoneyIn')).default,
  MoneyOut: (await import('../pages/MoneyOut')).default,
  Purchases: (await import('../pages/Purchases')).default,
  Expenses: (await import('../pages/Expenses')).default,
  Cash: (await import('../pages/Cash')).default,
  DueDates: (await import('../pages/DueDates')).default,
  Suspense: (await import('../pages/Suspense')).default,
  RatesCenter: (await import('../pages/RatesCenter')).default,
  Confirmations: (await import('../pages/Confirmations')).default,
  LocalSalesFinance: (await import('../pages/LocalSalesFinance')).default,
  PartyLedger: (await import('../pages/PartyLedger')).default,
};
const render = (Page, url = '/finance') => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><Page /></MemoryRouter>);
const actions = (html) => [...new Set([...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]))].sort();

// What a Finance Manager sees on each page (its route guards admit all of these).
const FM_EXPECTS = {
  MoneyIn: ['receive'],
  MoneyOut: ['pay'],
  Purchases: ['pay'],
  Expenses: ['new-expense', 'pay'],
  DueDates: [],
  Suspense: ['record-suspense', 'resolve', 'reverse'],
  RatesCenter: ['add-fx-rate', 'refresh-fx'],
  Confirmations: ['confirm-receipt', 'hold', 'receive'],
  LocalSalesFinance: [],
  PartyLedger: ['receive'],
  Cash: [],
};
const URL = { PartyLedger: '/finance/accounting/statements?type=customer&id=3' };

beforeEach(() => { mockPerms = FM; });

describe('a read-only role sees no write buttons on any Finance page', () => {
  it.each(Object.keys(pages))('%s', (name) => {
    mockPerms = AUDITOR;
    const html = render(pages[name], URL[name]);
    expect([name, actions(html)]).toEqual([name, []]);
    // No accept / contra / clear buttons either (those carry no data-action).
    expect(html).not.toMatch(/>\s*(Accept|Mark cleared|\+ Contra transfer|Record Receipt|New Expense)\s*</);
  });
});

describe('a Finance Manager sees the actions its guards admit', () => {
  it.each(Object.keys(pages))('%s', (name) => {
    const html = render(pages[name], URL[name]);
    expect(actions(html)).toEqual(expect.arrayContaining(FM_EXPECTS[name]));
  });

  it('Cash: Accept (to Head Office) and + Contra transfer; Mark cleared on Cheques', () => {
    expect(render(pages.Cash)).toMatch(/Accept/);
    expect(render(pages.Cash)).toContain('+ Contra transfer');
    expect(render(pages.DueDates)).toContain('Mark cleared');
  });
});
