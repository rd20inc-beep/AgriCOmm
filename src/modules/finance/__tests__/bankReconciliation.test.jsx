import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { reconFigures, ticksChanged, parseStatementCsv } from '../utils/bankRecon';

/**
 * B5 — Accounts › Reconcile: the running figures while ticking, the CSV
 * statement import, and the screen — every action under PermissionGate
 * finance.post_journal (a finance.view role reads it, changes nothing).
 */
describe('reconFigures', () => {
  const txns = [
    { id: 1, signed_amount: 20000 }, { id: 2, signed_amount: 5000 }, { id: 3, signed_amount: -3000 },
  ];
  it('cleared = opening + ticked (in − out); difference = statement − cleared', () => {
    expect(reconFigures({ opening: 0, transactions: txns, ticked: new Set([1, 2]), statementBalance: 22000 }))
      .toEqual({ tickedIn: 25000, tickedOut: 0, count: 2, cleared: 25000, difference: -3000, balanced: false });
    expect(reconFigures({ opening: 0, transactions: txns, ticked: new Set([1, 2, 3]), statementBalance: 22000 }))
      .toMatchObject({ tickedOut: 3000, cleared: 22000, difference: 0, balanced: true });
    expect(reconFigures({ opening: 22000, transactions: [{ id: 4, signed_amount: 700 }], ticked: new Set([4]), statementBalance: 22700 }).balanced).toBe(true);
  });
  it('ticksChanged compares the saved set with the screen', () => {
    expect(ticksChanged(new Set([1, 2]), new Set([2, 1]))).toBe(false);
    expect(ticksChanged(new Set([1, 2]), new Set([1]))).toBe(true);
    expect(ticksChanged(new Set([1]), new Set([2]))).toBe(true);
  });
});

describe('parseStatementCsv', () => {
  it('reads date, description and a signed amount; day-first dates; quoted fields', () => {
    const { lines, errors } = parseStatementCsv('Date,Description,Amount\n16/09/2026,"CHQ 55, Rice Co",-3000\n2026-09-10,Deposit,"5,000.00"\n');
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      { date: '2026-09-16', reference: 'CHQ 55, Rice Co', amount: -3000 },
      { date: '2026-09-10', reference: 'Deposit', amount: 5000 },
    ]);
  });
  it('reads debit / credit columns instead of one amount', () => {
    const { lines } = parseStatementCsv('Txn Date,Narration,Debit,Credit\n01-10-2026,Charges,250,\n02-10-2026,Receipt,,1200');
    expect(lines).toEqual([
      { date: '2026-10-01', reference: 'Charges', amount: -250 },
      { date: '2026-10-02', reference: 'Receipt', amount: 1200 },
    ]);
  });
  it('reports what it cannot read', () => {
    expect(parseStatementCsv('').errors[0]).toMatch(/empty/);
    expect(parseStatementCsv('Foo,Bar\n1,2').errors[0]).toMatch(/date column/);
    const r = parseStatementCsv('Date,Amount\nyesterday,10\n2026-10-01,abc\n2026-10-02,5');
    expect(r.lines).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
  });
});

// ── the screen ─────────────────────────────────────────────────────────
const allow = (...p) => (m, a) => p.includes(`${m}.${a}`);
const FM = allow('finance.view', 'finance.confirm_payment', 'finance.post_journal');
const AUDITOR = allow('finance.view');
let mockPerms = FM;
let mockHistory = [];
const WS = {
  reconciliation: { id: 9, bank_account_id: 3, statement_date: '2026-09-30', statement_balance: 22000, status: 'In Progress' },
  account: { id: 3, name: 'Meezan', currency: 'PKR' },
  opening_balance: 0, unexplained_balance: 0, cleared_balance: 25000, difference: -3000, ticked_count: 2,
  transactions: [
    { id: 1, transaction_no: 'BT-1', signed_amount: 20000, transaction_date: '2026-09-01', ticked: true, notes: 'Opening' },
    { id: 2, transaction_no: 'BT-2', signed_amount: 5000, transaction_date: '2026-09-10', ticked: true, counterparty: 'Shop' },
    { id: 3, transaction_no: 'BT-3', signed_amount: -3000, transaction_date: '2026-09-15', ticked: false, counterparty: 'Rice Co' },
  ],
  statement_lines: [{ id: 50, date: '2026-09-16', reference: 'CHQ 55', amount: -3000 }],
  suggestions: [{ statement_item_id: 50, bank_transaction_id: 3 }],
};

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: (m, a) => mockPerms(m, a) }) }));
vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: vi.fn() }) }));
vi.mock('../../../api/queries', () => ({
  useBankAccounts: () => ({ data: [{ id: 3, name: 'Meezan', currency: 'PKR', currentBalance: 22000, isActive: true }], isLoading: false }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }) => ({ data: queryKey[0] === 'reconciliations' ? mockHistory : WS, isLoading: false, refetch: vi.fn() }),
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
}));
vi.mock('../../accounting/api/services', () => ({ accountingApi: {} }));

const { default: BankReconciliation } = await import('../pages/BankReconciliation');
const render = (url = '/finance/accounts/reconcile?account=3') => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><BankReconciliation /></MemoryRouter>);
const actions = (html) => [...new Set([...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]))].sort();

beforeEach(() => { mockPerms = FM; mockHistory = [{ id: 9, statement_date: '2026-09-30', statement_balance: 22000, status: 'In Progress' }]; });

describe('<BankReconciliation />', () => {
  it('asks for the account first', () => {
    expect(render('/finance/accounts/reconcile')).toContain('Choose the account to reconcile.');
  });

  it('an account with nothing open: Finance can start one; a read-only role cannot', () => {
    mockHistory = [];
    expect(actions(render())).toEqual(['start-reconciliation']);
    mockPerms = AUDITOR;
    const html = render();
    expect(actions(html)).toEqual([]);
    expect(html).toContain('No reconciliation in progress for Meezan.');
  });

  it('the open one: ticked rows, cleared vs statement, the difference, and the actions', () => {
    const html = render();
    expect(html).toMatch(/data-testid="recon-cleared"[\s\S]*?Rs 25,000\.00/);
    expect(html).toMatch(/data-testid="recon-difference"[^]{0,200}text-red-700[^]{0,80}3,000\.00/);
    expect((html.match(/data-ticked="true"/g) || []).length).toBe(2);
    expect(html).toContain('suggested');
    expect(actions(html)).toEqual(['complete-reconciliation', 'import-statement', 'save-reconciliation', 'tick-suggested']);
    // Complete stays disabled while the difference is not 0.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-action="complete-reconciliation"/);
  });

  it('a read-only role sees the reconciliation but cannot tick or act', () => {
    mockPerms = AUDITOR;
    const html = render();
    expect(actions(html)).toEqual([]);
    expect(html).toContain('data-testid="recon-workspace"');
    expect(html).not.toMatch(/<input type="checkbox"(?![^>]*disabled)[^>]*aria-label="On the statement/);
  });

  it('once completed, nothing is open: the next statement can be started; the completed one stays in History', () => {
    mockHistory = [{ id: 9, statement_date: '2026-09-30', statement_balance: 22000, status: 'Completed' }];
    WS.reconciliation.status = 'Completed';
    try {
      const html = render('/finance/accounts/reconcile?account=3');
      // Nothing open → the start form plus the history; open the completed one from History.
      expect(actions(html)).toEqual(['start-reconciliation']);
      expect(html).toContain('History');
    } finally { WS.reconciliation.status = 'In Progress'; }
  });
});
