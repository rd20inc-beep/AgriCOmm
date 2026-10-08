import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { glParams } from '../utils/glStatements';

/**
 * Accounting › Trial balance / P&L / Balance sheet: read-only screens over
 * GET /api/accounting/statements/{trial-balance,profit-loss,balance-sheet}
 * (PKR, Posted journals). Data below is shaped like the API after
 * transformKeys. "Books balanced" comes from the API's is_balanced.
 */

vi.mock('../../../api/queries', () => ({
  useTrialBalance: vi.fn(), useProfitLoss: vi.fn(), useBalanceSheet: vi.fn(),
}));
const queries = await import('../../../api/queries');
const { default: TrialBalance, TrialBalanceView } = await import('../pages/TrialBalance');
const { default: GlProfitLoss, ProfitLossView } = await import('../pages/GlProfitLoss');
const { default: BalanceSheet, BalanceSheetView } = await import('../pages/BalanceSheet');

const wrap = (el, url = '/finance/accounting/trial-balance') =>
  renderToStaticMarkup(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const TB_OK = {
  accounts: [
    { accountId: 1, code: '1000', name: 'Cash', type: 'Asset', debitTotal: 1500, creditTotal: 500, balance: 1000 },
    { accountId: 2, code: '4000', name: 'Sales', type: 'Revenue', debitTotal: 0, creditTotal: 1000, balance: -1000 },
  ],
  grandDebit: 1500, grandCredit: 1500, isBalanced: true,
};
const TB_BAD = { ...TB_OK, grandCredit: 1400, isBalanced: false };

describe('Trial balance', () => {
  it('renders accounts, Dr/Cr balances, totals and "Books balanced"', () => {
    const html = wrap(<TrialBalanceView data={TB_OK} entity="all" onEntity={() => {}} asOf="2026-10-31" />);
    const t = text(html);
    expect(t).toContain('Trial balance');
    expect(t).toContain('As at 31 Oct 2026');
    expect(t).toContain('PKR');
    expect(t).toContain('1000 Cash');
    expect(t).toMatch(/Rs 1,000\.00 Dr/);
    expect(t).toMatch(/Rs 1,000\.00 Cr/);
    expect(html).toContain('data-testid="balanced"');
    expect(html).not.toContain('data-testid="imbalanced"');
  });

  it('an imbalanced ledger says so, with the difference', () => {
    const html = wrap(<TrialBalanceView data={TB_BAD} entity="all" onEntity={() => {}} />);
    expect(html).toContain('data-testid="imbalanced"');
    expect(text(html)).toContain('Out of balance by Rs 100.00');
    expect(text(html)).toContain('As at today');
  });

  it('empty / loading / error states', () => {
    expect(text(wrap(<TrialBalanceView data={{ accounts: [] }} entity="all" onEntity={() => {}} />))).toContain('No posted journals');
    expect(text(wrap(<TrialBalanceView isLoading entity="all" onEntity={() => {}} />))).toContain('Loading');
    expect(text(wrap(<TrialBalanceView error={new Error('boom')} entity="all" onEntity={() => {}} />))).toContain('Could not load this statement: boom');
  });

  it('the page asks for the trial balance as at the end of the period, for the chosen entity', () => {
    queries.useTrialBalance.mockReturnValue({ data: TB_OK, isLoading: false });
    wrap(<TrialBalance />, '/finance/accounting/trial-balance?range=year&entity=mill');
    const y = new Date().getFullYear();
    expect(queries.useTrialBalance).toHaveBeenLastCalledWith({ as_of_date: `${y}-12-31`, entity: 'mill' });
    wrap(<TrialBalance />, '/finance/accounting/trial-balance');
    expect(queries.useTrialBalance).toHaveBeenLastCalledWith({});
  });
});

const PNL = {
  revenue: { accounts: [{ accountId: 9, code: '4000', name: 'Export sales', amount: 900000 }], total: 900000 },
  cogs: { accounts: [{ accountId: 10, code: '5000', name: 'COGS', amount: 600000 }], total: 600000 },
  grossProfit: 300000,
  expenses: { accounts: [{ accountId: 11, code: '6000', name: 'Freight', amount: 350000 }], total: 350000 },
  netProfit: -50000,
};

describe('P&L (GL)', () => {
  it('renders revenue, COGS, gross profit, expenses and a net loss', () => {
    const t = text(wrap(<ProfitLossView data={PNL} entity="export" onEntity={() => {}} from="2026-10-01" to="2026-10-31" />));
    expect(t).toContain('01 Oct 2026 – 31 Oct 2026');
    expect(t).toContain('Export sales');
    expect(t).toContain('Gross profit Rs 300,000.00');
    expect(t).toContain('Net loss -Rs 50,000.00');
    expect(t).toContain('Includes journals with no entity tag');
  });

  it('the page passes period_start / period_end and the entity', () => {
    queries.useProfitLoss.mockReturnValue({ data: PNL, isLoading: false });
    wrap(<GlProfitLoss />, '/finance/accounting/pnl?range=year&entity=general');
    const y = new Date().getFullYear();
    expect(queries.useProfitLoss).toHaveBeenLastCalledWith({ period_start: `${y}-01-01`, period_end: `${y}-12-31`, entity: 'general' });
    wrap(<GlProfitLoss />, '/finance/accounting/pnl?entity=bogus');
    expect(queries.useProfitLoss).toHaveBeenLastCalledWith({});
  });
});

const BS_OK = {
  assets: { accounts: [{ accountId: 1, code: '1000', name: 'Cash', balance: 1000 }], total: 1000 },
  liabilities: { accounts: [{ accountId: 2, code: '2010', name: 'Payables', balance: 400 }], total: 400 },
  equity: { accounts: [{ accountId: 3, code: '3000', name: 'Capital', balance: 500 }], total: 500 },
  netIncome: 100, totalLiabilitiesAndEquity: 1000, isBalanced: true,
};

describe('Balance sheet', () => {
  it('renders the three sections, current earnings and the balanced check', () => {
    const html = wrap(<BalanceSheetView data={BS_OK} entity="all" onEntity={() => {}} asOf="2026-10-31" />);
    const t = text(html);
    expect(t).toContain('Assets');
    expect(t).toContain('Liabilities');
    expect(t).toContain('Capital');
    expect(t).toContain('Current earnings (not yet closed to equity) Rs 100.00');
    expect(t).toContain('Total liabilities + equity Rs 1,000.00');
    expect(html).toContain('data-testid="balanced"');
  });

  it('flags a balance sheet that does not balance', () => {
    const html = wrap(<BalanceSheetView data={{ ...BS_OK, totalLiabilitiesAndEquity: 900, isBalanced: false }} entity="all" onEntity={() => {}} />);
    expect(html).toContain('data-testid="imbalanced"');
    expect(text(html)).toContain('Out of balance by Rs 100.00');
  });

  it('the page asks for the balance sheet as at the end of the period', () => {
    queries.useBalanceSheet.mockReturnValue({ data: BS_OK, isLoading: false });
    wrap(<BalanceSheet />, '/finance/accounting/balance-sheet?range=year');
    expect(queries.useBalanceSheet).toHaveBeenLastCalledWith({ as_of_date: `${new Date().getFullYear()}-12-31` });
  });
});

describe('glParams', () => {
  it('maps the finance range to each endpoint\'s own params', () => {
    const r = { from_date: '2026-10-01', to_date: '2026-10-31' };
    expect(glParams('asOf', r)).toEqual({ as_of_date: '2026-10-31' });
    expect(glParams('period', r, 'mill')).toEqual({ period_start: '2026-10-01', period_end: '2026-10-31', entity: 'mill' });
    expect(glParams('asOf', {})).toEqual({});
  });
});
