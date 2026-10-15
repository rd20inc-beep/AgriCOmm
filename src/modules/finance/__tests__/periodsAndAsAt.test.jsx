import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PERIOD_PRESETS, rangeLabel, customRangeKey, withRange, CUSTOM_RANGE } from '../financeNav';
import { resolveRange, fiscalYearStart } from '../hooks/useFinanceDateRange';
import { moneyInTilesFromSummary, AS_AT_BUCKETS } from '../utils/moneyTiles';
import { groupByFiscalYear, fyLabel } from '../utils/periods';
import { PeriodStatusBadge } from '../components/GlStatementParts';
import { toLocalISODate } from '../../../shared/utils/format';

/**
 * P4-13 (D-1) and P4-04 on the screen:
 *   - the period selector has Last Month, Last Quarter, This / Last Fiscal Year
 *     (1 July – 30 June) and a custom range that travels in ?range=;
 *   - Accounting › Periods groups months by fiscal year; close / reopen show
 *     only to finance.post_journal; the GL statements say final vs provisional;
 *   - Money In tiles are the server's as-at summary, per currency.
 */

const iso = (d) => toLocalISODate(d);
const span = (key, now) => {
  const r = resolveRange(key, now);
  return r && [iso(r.from), iso(r.to)];
};

describe('period presets (D-1)', () => {
  const now = new Date(2026, 9, 16); // 16 Oct 2026

  it('offers previous periods, the fiscal year and a custom range', () => {
    const keys = PERIOD_PRESETS.map((p) => p.value);
    expect(keys).toEqual(expect.arrayContaining(['last_month', 'last_quarter', 'fy', 'last_fy', 'year']));
    expect(rangeLabel('fy')).toBe('This Fiscal Year');
  });

  it.each([
    ['month', '2026-10-01', '2026-10-31'],
    ['last_month', '2026-09-01', '2026-09-30'],
    ['quarter', '2026-10-01', '2026-12-31'],
    ['last_quarter', '2026-07-01', '2026-09-30'],
    ['fy', '2026-07-01', '2027-06-30'],
    ['last_fy', '2025-07-01', '2026-06-30'],
    ['year', '2026-01-01', '2026-12-31'],
  ])('%s → %s … %s', (key, from, to) => expect(span(key, now)).toEqual([from, to]));

  it('January: last month is December, last quarter is Q4, the fiscal year began last July', () => {
    const jan = new Date(2027, 0, 10);
    expect(span('last_month', jan)).toEqual(['2026-12-01', '2026-12-31']);
    expect(span('last_quarter', jan)).toEqual(['2026-10-01', '2026-12-31']);
    expect(span('fy', jan)).toEqual(['2026-07-01', '2027-06-30']);
    expect(iso(fiscalYearStart(new Date(2026, 5, 30)))).toBe('2025-07-01');
  });

  it('a custom range travels as one ?range= value, ordered, and labels itself', () => {
    expect(customRangeKey('2026-09-30', '2026-09-01')).toBe('2026-09-01..2026-09-30');
    expect(customRangeKey('2026-09-01', '')).toBe('');
    const key = customRangeKey('2026-07-01', '2026-09-30');
    expect(key).toMatch(CUSTOM_RANGE);
    expect(span(key, now)).toEqual(['2026-07-01', '2026-09-30']);
    expect(withRange('/finance/accounting/trial-balance', key)).toBe('/finance/accounting/trial-balance?range=2026-07-01..2026-09-30');
    expect(rangeLabel(key)).toMatch(/1 Jul 2026 – 30 Sept? 2026/);
    expect(resolveRange('2026-13-45..x', now)).toBeNull();
  });
});

describe('Accounting › Periods', () => {
  it('groups months by fiscal year, oldest first', () => {
    const g = groupByFiscalYear([
      { id: 2, name: 'Aug 2026', periodStart: '2026-08-01', fyLabel: '2026-27' },
      { id: 1, name: 'Jul 2026', periodStart: '2026-07-01', fyLabel: '2026-27' },
      { id: 3, name: 'Jun 2026', periodStart: '2026-06-01', fyLabel: '2025-26' },
    ]);
    expect(Object.keys(g).sort()).toEqual(['2025-26', '2026-27']);
    expect(g['2026-27'].map((p) => p.id)).toEqual([1, 2]);
    expect(fyLabel(2026)).toBe('2026-27');
  });

  const PERIODS = {
    currentFiscalYear: { startYear: 2026, label: 'FY 2026-27' },
    periods: [
      { id: 1, name: 'Jul 2026', periodStart: '2026-07-01', periodEnd: '2026-07-31', status: 'Closed', fyLabel: '2026-27', closedAt: '2026-08-05T10:00:00Z', closedByName: 'FM' },
      { id: 2, name: 'Aug 2026', periodStart: '2026-08-01', periodEnd: '2026-08-31', status: 'Open', fyLabel: '2026-27' },
    ],
  };
  const renderPeriods = async (perms) => {
    vi.resetModules();
    vi.doMock('../../../api/queries', () => ({ useAccountingPeriods: () => ({ data: PERIODS, isLoading: false }) }));
    vi.doMock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: (m, a) => perms.includes(`${m}.${a}`) }) }));
    vi.doMock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: vi.fn() }) }));
    vi.doMock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
    const { default: Periods } = await import('../pages/Periods');
    return renderToStaticMarkup(<MemoryRouter><Periods /></MemoryRouter>);
  };

  it('the Finance Manager can close an open month, reopen a closed one and create next year', async () => {
    const html = await renderPeriods(['finance.view', 'finance.post_journal']);
    expect(html).toContain('FY 2026-27 (current)');
    expect(html).toMatch(/Close<\/button>/);
    expect(html).toMatch(/Reopen…<\/button>/);
    expect(html).toContain('data-testid="create-fy"');
    expect(html).toContain('Create FY 2027-28');
    // Each month links to its month-end trial balance.
    expect(html).toContain('/finance/accounting/trial-balance?range=2026-07-01..2026-07-31');
  });

  it('a read-only role sees the calendar but no actions', async () => {
    const html = await renderPeriods(['finance.view']);
    expect(html).toContain('Jul 2026');
    expect(html).not.toMatch(/Close<\/button>/);
    expect(html).not.toMatch(/Reopen/);
    expect(html).not.toContain('data-testid="create-fy"');
  });
});

describe('GL statements say whether the as-at month is closed', () => {
  it('final when closed, provisional when open', () => {
    const closed = renderToStaticMarkup(<PeriodStatusBadge status={{ period: { name: 'Sep 2026' }, status: 'Closed', final: true, fiscalYear: 'FY 2026-27' }} />);
    expect(closed).toContain('data-final="true"');
    expect(closed).toContain('final');
    const open = renderToStaticMarkup(<PeriodStatusBadge status={{ period: { name: 'Oct 2026' }, status: 'Open', final: false, fiscalYear: 'FY 2026-27' }} />);
    expect(open).toContain('provisional');
  });
});

describe('Money In tiles from the server (P4-04)', () => {
  it('reshapes the as-at summary per currency, never summing currencies', () => {
    const t = moneyInTilesFromSummary({
      asOf: '2026-09-30',
      buckets: AS_AT_BUCKETS,
      openCount: 3,
      byCurrency: {
        USD: { count: 2, outstanding: 1000, overdueCount: 1, overdueAmount: 600, buckets: { current: 400, '1-30': 600 } },
        PKR: { count: 1, outstanding: 50000, overdueCount: 0, overdueAmount: 0, buckets: { current: 50000 } },
      },
      collected: { USD: { amount: 400, count: 1 } },
    });
    expect(t.outstanding).toEqual({ USD: 1000, PKR: 50000 });
    expect(t.overdue).toEqual({ USD: 600 });
    expect(t.collected).toEqual({ USD: 400 });
    expect(t.overdueCount).toBe(1);
    expect(t.aging.USD['1-30']).toBe(600);
    expect(t.asOf).toBe('2026-09-30');
    expect(Object.keys(t.outstanding)).not.toContain('total');
  });
});
