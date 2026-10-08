import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

/**
 * Finance › Home under package C (owner decisions C1, C3, C5, C6):
 *  - the headline is the GL P&L net profit ("Net profit (books)"); the
 *    operational Booked / Realised / mill / local figures sit underneath,
 *    labelled "Operational";
 *  - the mill figure is net of overheads;
 *  - figures that span currencies keep their native amounts, with ONE labelled
 *    "≈ PKR equiv." line apart from the figure (booked rates; cash at today's
 *    rate, dated);
 *  - the collection tile reads received ÷ due against the server target and
 *    names the overdue amounts.
 */
const summary = {
  books: { netProfitPkr: 1234567, revenuePkr: 5000000, cogsPkr: 3000000, expensesPkr: 765433 },
  consolidated: { profitPkr: 999000, bookedPkr: 999000, realisedPkr: 400000 },
  export: { bookedProfitPkr: 800000, realisedProfitPkr: 300000, pipelineProfitPkr: 500000 },
  mill: { grossProfit: 150000, overheads: 30000, netProfit: 120000 },
  local: { grossProfit: 79000 },
  receivables: {
    count: 3,
    byCurrency: { USD: { outstanding: 23850, overdueAmount: 0 }, PKR: { outstanding: 821395, overdueAmount: 821395 } },
    pkrEquiv: { pkr: 7547095, basis: 'booked', missingCount: 0 },
  },
  cashPosition: {
    bankBalancePkr: 18490000, bankBalanceUsd: 1000, byCurrency: { PKR: 18490000, USD: 1000 }, accountCount: 4,
    pkrEquiv: { pkr: 18772000, basis: 'today', rate: 282, rateDate: '2026-10-09', unconvertedCount: 0 },
  },
  payables: {},
  collection: {
    targetPct: 95,
    byCurrency: { PKR: { ratePct: 0, targetPct: 95, onTarget: false, overdueAmount: 821145, dueAmount: 821145, receivedAmount: 0 } },
  },
  currentFxRate: 282,
  warnings: [],
};

vi.mock('../../../api/queries', () => ({
  useFinanceOverviewSummary: () => ({ data: summary, isLoading: false, refetch: () => {} }),
  useReceivables: () => ({ data: [] }),
  usePayables: () => ({ data: [] }),
  useJournalEntries: () => ({ data: [] }),
  useUpcoming: () => ({ data: {
    receiving: [
      { kind: 'credit', amount: 23850, currency: 'USD', amountPkr: 6725700, pkrBasis: 'booked' },
      { kind: 'credit', amount: 1540, currency: 'PKR', amountPkr: 1540, pkrBasis: 'native' },
    ],
    giving: [],
  } }),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined, isError: false }) }));
vi.mock('../../analytics/api/services', () => ({ reportingApi: {} }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock('../../ai/components/AnomalyWatchCard', () => ({ default: () => null }));
vi.mock('../../purchaseRequirements/components/PurchaseRequirementsPanel', () => ({ default: () => null }));
vi.mock('../components/NeedsAttention', () => ({ default: () => <div data-testid="needs-attention" /> }));
vi.mock('../components/RecentActivity', () => ({ default: () => <div data-testid="recent-activity" /> }));

const { default: FinanceOverview } = await import('../pages/FinanceOverview');
const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/finance']}><FinanceOverview /></MemoryRouter>);
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const at = (id) => html.indexOf(`data-testid="${id}"`);
const between = (a, b) => html.slice(at(a), at(b) > at(a) ? at(b) : undefined);

describe('C1: the books lead, operational underneath', () => {
  it('headline = GL net profit, labelled as the books', () => {
    const t = text(html);
    expect(t).toContain('Net profit (books) · All time');
    expect(html).toMatch(/data-testid="books-net-profit">Rs 1,234,567</);
    expect(t).toContain('General ledger, Posted journals, all entities');
  });

  it('operational figures are labelled and kept below the headline', () => {
    expect(at('books-net-profit')).toBeLessThan(at('operational-profit'));
    const op = text(between('operational-profit', 'recent-activity'));
    expect(op).toContain('Operational (management view — not the books)');
    expect(op).toMatch(/Booked Rs 999,000/);
    expect(op).toMatch(/Realised Rs 400,000/);
    // C3: the mill is net of overheads.
    expect(op).toMatch(/Mill \(net\) Rs 120,000 gross Rs 150,000 − overheads Rs 30,000/);
  });
});

describe('C5: ≈ PKR equiv. is a labelled secondary line, never the figure', () => {
  const lines = [...html.matchAll(/data-testid="pkr-equiv"[^>]*>([^<]*)</g)].map((m) => m[1].replace(/&#x27;/g, "'"));

  it('Receivables: native figures, then the booked-rate equivalent', () => {
    expect(lines).toContain('≈ PKR equiv. Rs 7,547,095 (booked rates)');
    const strip = text(between('position-strip', 'needs-attention'));
    expect(strip).toContain('$23,850.00');
    expect(strip).toContain('+ Rs 821,395');
  });

  it("Cash: the equivalent is at today's rate, dated", () => {
    expect(lines).toContain("≈ PKR equiv. Rs 18,772,000 at today's rate (2026-10-09)");
  });

  it('Upcoming: native totals, then the equivalent', () => {
    expect(lines).toContain('≈ PKR equiv. Rs 6,727,240 (booked rates)');
  });

  it('no main figure carries an equivalent amount', () => {
    for (const amount of ['7,547,095', '18,772,000', '6,727,240']) {
      expect(html.split(amount).length - 1).toBe(1); // only its own pkr-equiv line
    }
  });
});

describe('C6: collection tile', () => {
  it('received ÷ due against the server target, overdue named', () => {
    const strip = text(between('position-strip', 'needs-attention'));
    expect(strip).toContain('Collection Rate · due to date');
    expect(strip).toContain('Received vs due (PKR)');
    expect(strip).toContain('Below 95% target · Rs 821,145 overdue');
    expect(strip).not.toContain('80%');
  });
});
