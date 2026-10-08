import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { drawerStack } from '../drawers/drawerStack';
import {
  transactionActions, documentFigures, partyOpenItems, chequesForAccount, searchTarget, headerActionDrawer, totalsByCurrency,
} from '../drawers/drawerLogic';

/**
 * The Finance drawers render from data, show each action only to a role the
 * server lets do it, and never add money across currencies.
 */
const allow = (...p) => (m, a) => p.includes(`${m}.${a}`);
const FM = allow('finance.view', 'finance.confirm_payment', 'finance.allocate_cost', 'export_orders.view');
const AUDITOR = allow('finance.view');
let mockPerms = FM;

let mockTx = null;
let mockDocRow = null;
let mockReceivables = [];
let mockPayables = [];
let mockStatement = null;
let mockAccounts = [];
let mockBankTx = [];
let mockUpcoming = null;
let mockHistory = [];
const mockDrawers = {
  canView: true, open: vi.fn(), replace: vi.fn(), close: vi.fn(),
  openTransaction: vi.fn(), openDocument: vi.fn(), openParty: vi.fn(), openAccount: vi.fn(),
  openPayment: vi.fn(), openTransfer: vi.fn(), openStatementPay: vi.fn(), openFundTransfer: vi.fn(),
};

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: (m, a) => mockPerms(m, a) }) }));
vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: vi.fn(), suppliersList: [] }) }));
vi.mock('../../../hooks/useConfirm', () => ({ default: () => [vi.fn(), null] }));
vi.mock('../drawers/drawersContext', () => ({ useFinanceDrawers: () => mockDrawers }));
vi.mock('../drawers/drawerHooks', () => ({
  useTransactionDetail: () => ({ data: mockTx, isLoading: false, isError: false }),
  useDocumentRow: (doc) => doc?.row || mockDocRow,
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }) => ({ data: queryKey[0] === 'party-statement' ? mockStatement : undefined, isLoading: false }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../../api/queries', () => ({
  useBankAccounts: () => ({ data: mockAccounts }),
  useClearCheque: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReversePayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReceivables: () => ({ data: mockReceivables, isLoading: false }),
  usePayables: () => ({ data: mockPayables, isLoading: false }),
  useReceivableReceipts: () => ({ data: { payments: mockHistory }, isLoading: false }),
  usePayablePayments: () => ({ data: { payments: mockHistory }, isLoading: false }),
  usePurchasePaymentTrail: () => ({ data: { payments: mockHistory }, isLoading: false }),
  useBankTransactions: () => ({ data: mockBankTx, isLoading: false }),
  useUpcoming: () => ({ data: mockUpcoming }),
}));
vi.mock('../pages/DueDates', () => ({ ClearChequeDialog: () => null }));
vi.mock('../../../components/TransactionDocument', () => ({ default: () => null }));
vi.mock('../../../components/SupplierPicker', () => ({ default: () => <div data-testid="supplier-picker" /> }));
vi.mock('../../accounting/api/services', () => ({ accountingApi: {} }));

const { default: TransactionDrawer } = await import('../drawers/TransactionDrawer');
const { default: DocumentDrawer } = await import('../drawers/DocumentDrawer');
const { default: PartyDrawer } = await import('../drawers/PartyDrawer');
const { default: AccountDrawer } = await import('../drawers/AccountDrawer');

const render = (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const actions = (html) => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);

const PAYMENT_DETAIL = {
  kind: 'payment',
  payment: {
    id: 5, payment_no: 'PAY-005', type: 'payment', status: 'Completed', amount: 5000, currency: 'PKR', fx_rate: 1, base_amount_pkr: 5000,
    payment_method: 'bank_transfer', payment_date: '2026-10-08', cleared: true, bank_reference: 'TT-1', wht_amount: 0, discount_amount: 0,
    attachment_url: null, created_at: '2026-10-08T10:00:00Z', created_by_name: 'Finance One', bank_account_id: 3,
    account: { id: 3, name: 'Meezan', bank_name: 'Meezan Bank', currency: 'PKR', type: 'bank' },
  },
  document: { kind: 'payable', id: 40, ref: 'PAY-9' },
  party: { type: 'supplier', id: 2, name: 'Rice Co' },
  bank_transactions: [{ id: 11, transaction_no: 'BT-1', type: 'debit', amount: 5000, currency: 'PKR', account_name: 'Meezan', transaction_date: '2026-10-08' }],
  journals: [{ id: 21, journal_no: 'JE-1', ref_type: 'Payment', ref_no: 'PAY-005', status: 'Posted', lines: [
    { id: 1, account_code: '2010', account_name: 'Payables', debit: 5000, credit: 0 },
    { id: 2, account_code: '1000', account_name: 'Cash & Bank', debit: 0, credit: 5000 },
  ] }],
  reversal: { allowed: true, reason: null },
  clearable: false,
};

beforeEach(() => {
  mockPerms = FM; mockTx = PAYMENT_DETAIL; mockDocRow = null; mockReceivables = []; mockPayables = [];
  mockStatement = null; mockAccounts = []; mockBankTx = []; mockUpcoming = null; mockHistory = [];
  Object.values(mockDrawers).forEach((f) => typeof f === 'function' && f.mockClear?.());
});

describe('Transaction drawer', () => {
  it('shows both sides: payment, bank row, journal lines, who recorded it', () => {
    const t = text(render(<TransactionDrawer txKind="payment" id={5} onClose={() => {}} />));
    expect(t).toContain('PAY-005');
    expect(t).toMatch(/Rs 5,000\.00/);
    expect(t).toContain('BT-1');
    expect(t).toContain('2010 Payables');
    expect(t).toContain('1000 Cash & Bank');
    expect(t).toContain('Finance One');
    expect(t).toContain('Rice Co');
  });

  it('Finance sees Reverse and Attach; a read-only role sees neither', () => {
    expect(actions(render(<TransactionDrawer txKind="payment" id={5} onClose={() => {}} />))).toEqual(expect.arrayContaining(['reverse', 'attach']));
    mockPerms = AUDITOR;
    const html = render(<TransactionDrawer txKind="payment" id={5} onClose={() => {}} />);
    expect(actions(html)).toEqual([]);
  });

  it('an uncleared cheque offers Clear (never Bounce — pending decision)', () => {
    mockTx = { ...PAYMENT_DETAIL, payment: { ...PAYMENT_DETAIL.payment, payment_method: 'cheque', cleared: false }, clearable: true, bank_transactions: [], journals: [] };
    const html = render(<TransactionDrawer txKind="payment" id={5} onClose={() => {}} />);
    expect(actions(html)).toContain('clear-cheque');
    expect(text(html)).not.toMatch(/Bounce/);
    expect(text(html)).toContain('Nothing is posted until the cheque clears.');
  });

  it('a receipt the server will not reverse here says why, with no Reverse button', () => {
    mockTx = { ...PAYMENT_DETAIL, payment: { ...PAYMENT_DETAIL.payment, type: 'receipt' }, reversal: { allowed: false, reason: 'This receipt was confirmed on its export order — reverse it from the export order.' } };
    const html = render(<TransactionDrawer txKind="payment" id={5} onClose={() => {}} />);
    expect(actions(html)).not.toContain('reverse');
    expect(html).toContain('data-testid="reverse-blocked"');
  });

  it('transactionActions mirrors finance.confirm_payment', () => {
    expect(transactionActions(PAYMENT_DETAIL, FM)).toMatchObject({ reverse: true, clear: false, attach: true });
    expect(transactionActions(PAYMENT_DETAIL, AUDITOR)).toMatchObject({ reverse: false, clear: false, attach: false });
    expect(transactionActions({ ...PAYMENT_DETAIL, payment: { ...PAYMENT_DETAIL.payment, attachment_url: 'x.pdf' } }, FM).attach).toBe(false);
  });
});

describe('Document drawer', () => {
  const RECV = { id: 12, recvNo: 'RCV-ADV-1', type: 'Advance', orderId: 77, currency: 'USD', expectedAmount: 2000, receivedAmount: 500, outstanding: 1500, status: 'Partial', customerId: 3, customerName: 'Buyer' };

  it('shows outstanding in its own currency, payment history rows that open the Transaction drawer, and Receive', () => {
    mockDocRow = RECV;
    mockHistory = [{ id: 99, paymentNo: 'PAY-099', amount: 500, currency: 'USD', paymentDate: '2026-10-01' }];
    const html = render(<DocumentDrawer doc={{ docKind: 'receivable', row: RECV }} onClose={() => {}} />);
    expect(text(html)).toMatch(/Outstanding \$1,500\.00/);
    expect(html).toContain('data-testid="doc-history"');
    expect(text(html)).toContain('PAY-099');
    expect(actions(html)).toContain('receive');
  });

  it('a read-only role sees the document but no Receive', () => {
    mockPerms = AUDITOR;
    const html = render(<DocumentDrawer doc={{ docKind: 'receivable', row: RECV }} onClose={() => {}} />);
    expect(actions(html)).toEqual([]);
    expect(html).toContain('data-testid="settle-not-allowed"');
  });

  it('a cost-derived payable says where it is settled and offers no Pay', () => {
    const row = { id: 'MC-4', payNo: 'MC-4', category: 'Milling', originalAmount: 100, paidAmount: 0, outstanding: 100, status: 'Pending', currency: 'PKR' };
    const html = render(<DocumentDrawer doc={{ docKind: 'payable', row }} onClose={() => {}} />);
    expect(html).toContain('data-testid="derived-hint"');
    expect(actions(html)).not.toContain('pay');
  });

  it('an expense can be linked to a supplier only with finance.allocate_cost', () => {
    const row = { id: 8, expense_no: 'EXP-1', amount_pkr: 300, paid_amount: 0, payment_status: 'Unpaid', category: 'utility_bill' };
    expect(actions(render(<DocumentDrawer doc={{ docKind: 'expense', row }} onClose={() => {}} />))).toEqual(expect.arrayContaining(['pay', 'link-supplier']));
    mockPerms = allow('finance.view', 'finance.confirm_payment');
    const html = render(<DocumentDrawer doc={{ docKind: 'expense', row }} onClose={() => {}} />);
    expect(actions(html)).toEqual(['pay']);
  });

  it('documentFigures keeps the document\'s currency', () => {
    expect(documentFigures('receivable', RECV)).toMatchObject({ currency: 'USD', outstanding: 1500 });
    expect(documentFigures('local_sale', { kind: 'local_sale', expectedAmount: 10, receivedAmount: 0, outstanding: 10 })).toMatchObject({ currency: 'PKR' });
  });
});

describe('Party drawer', () => {
  const party = { type: 'customer', id: 3, name: 'Buyer' };
  it('balance per currency, never summed', () => {
    mockReceivables = [
      { id: 1, customerId: 3, recvNo: 'RCV-1', currency: 'USD', outstanding: 1000, status: 'Pending' },
      { id: 2, customerId: 3, recvNo: 'RCV-2', currency: 'USD', outstanding: 500, status: 'Partial' },
      { id: 3, customerId: 3, kind: 'local_sale', recvNo: 'LS-1', currency: 'PKR', outstanding: 20000, status: 'Credit' },
      { id: 4, customerId: 9, recvNo: 'OTHER', currency: 'USD', outstanding: 7, status: 'Pending' },
    ];
    const html = render(<PartyDrawer party={party} onClose={() => {}} />);
    expect(html).toMatch(/data-currency="USD"[^>]*>\$1,500\.00/);
    expect(html).toMatch(/data-currency="PKR"[^>]*>Rs 20,000\.00/);
    expect(text(html)).not.toContain('OTHER');
    expect(partyOpenItems('customer', mockReceivables.slice(0, 3)).totals).toEqual({ USD: 1500, PKR: 20000 });
  });

  it('Receive and per-item actions for Finance; only the statement link for a read-only role', () => {
    mockReceivables = [{ id: 1, customerId: 3, recvNo: 'RCV-1', currency: 'PKR', outstanding: 1000, status: 'Pending' }];
    expect(actions(render(<PartyDrawer party={party} onClose={() => {}} />))).toEqual(expect.arrayContaining(['statement', 'receive', 'item-settle']));
    mockPerms = AUDITOR;
    expect(actions(render(<PartyDrawer party={party} onClose={() => {}} />))).toEqual(['statement']);
  });

  it('the full statement link carries the party', () => {
    expect(render(<PartyDrawer party={party} onClose={() => {}} />)).toContain('href="/finance/accounting/statements?type=customer&amp;id=3"');
  });
});

describe('Account drawer', () => {
  const ACC = { id: 3, name: 'Meezan USD', bankName: 'Meezan', currency: 'USD', type: 'bank', entity: 'export', currentBalance: 1234.5, isActive: true };
  it('balance in its own currency, recent movements, cheques that clear through it', () => {
    mockAccounts = [ACC];
    mockBankTx = [{ id: 1, transactionDate: '2026-10-01', type: 'credit', amount: 100, currency: 'USD', counterparty: 'Buyer' }];
    mockUpcoming = { receiving: [{ kind: 'cheque', paymentId: 7, bankAccountId: 3, amount: 50, currency: 'USD', dueDate: '2026-10-10', party: 'Buyer', paymentNo: 'PAY-7' }], giving: [] };
    const html = render(<AccountDrawer account={{ id: 3 }} onClose={() => {}} />);
    expect(text(html)).toMatch(/Balance \(USD\) \$1,234\.50/);
    expect(html).toContain('data-testid="account-ledger"');
    expect(actions(html)).toEqual(expect.arrayContaining(['transfer', 'clear-cheque']));
  });

  it('a read-only role gets no Transfer and no Clear', () => {
    mockPerms = AUDITOR;
    mockAccounts = [ACC];
    mockUpcoming = { receiving: [{ kind: 'cheque', paymentId: 7, bankAccountId: 3, amount: 50, currency: 'USD', dueDate: '2026-10-10' }], giving: [] };
    expect(actions(render(<AccountDrawer account={{ id: 3 }} onClose={() => {}} />))).toEqual([]);
  });

  it('chequesForAccount picks only this account\'s cheques', () => {
    const up = { receiving: [{ kind: 'cheque', paymentId: 1, bankAccountId: 3 }, { kind: 'credit', bankAccountId: 3 }], giving: [{ kind: 'cheque', paymentId: 2, bankAccountId: 4 }] };
    expect(chequesForAccount(up, 3).map((c) => c.paymentId)).toEqual([1]);
  });
});

describe('drawer stack, header actions and search', () => {
  it('stacks, replaces and closes', () => {
    let s = drawerStack([], { type: 'open', drawer: { kind: 'document' } });
    s = drawerStack(s, { type: 'open', drawer: { kind: 'payment' } });
    expect(s.map((d) => d.kind)).toEqual(['document', 'payment']);
    s = drawerStack(s, { type: 'close' });
    expect(s.map((d) => d.kind)).toEqual(['document']);
    s = drawerStack(s, { type: 'replace', drawer: { kind: 'party' } });
    expect(s.map((d) => d.kind)).toEqual(['party']);
    expect(drawerStack(s, { type: 'reset' })).toEqual([]);
  });

  it('each header action opens its drawer in place', () => {
    expect(headerActionDrawer('receive')).toEqual({ kind: 'picker', mode: 'receive' });
    expect(headerActionDrawer('pay')).toEqual({ kind: 'picker', mode: 'pay' });
    expect(headerActionDrawer('transfer')).toEqual({ kind: 'transfer', fromAccountId: null });
    expect(headerActionDrawer('expense')).toEqual({ kind: 'expense' });
  });

  it('a search hit opens the matching drawer', () => {
    expect(searchTarget({ _type: 'party', type: 'supplier', id: 2, name: 'S' })).toEqual({ kind: 'party', party: { type: 'supplier', id: 2, name: 'S' } });
    expect(searchTarget({ _type: 'document', kind: 'payable', id: 40 })).toEqual({ kind: 'document', doc: { docKind: 'payable', id: 40 } });
    expect(searchTarget({ _type: 'transaction', kind: 'bank', id: 11 })).toEqual({ kind: 'transaction', txKind: 'bank', id: 11 });
  });

  it('totalsByCurrency never adds across currencies', () => {
    expect(totalsByCurrency([{ currency: 'USD', outstanding: 1 }, { currency: 'PKR', outstanding: 280 }, { currency: 'usd', outstanding: 2 }]))
      .toEqual({ USD: 3, PKR: 280 });
  });
});
