/**
 * P4-04 — the pure half of finance/receivablesAsAt.js:
 *
 *   - days past due and the aging bucket at an as-at date ('current' = not
 *     yet due, including due today: overdue means PAST the due date, D-15);
 *   - the per-currency fold: buckets add up to the outstanding, overdue is
 *     only past-due rows, USD and PKR are never added, and the ≈ PKR line is
 *     each row's booked share (a row with no booked rate is counted, not
 *     guessed).
 */
const { bucketOf, daysPastDue, summarizeReceivables, BUCKETS } = require('../modules/finance/receivablesAsAt');

describe('days past due → bucket', () => {
  test.each([
    [null, 'current'], [-5, 'current'], [0, 'current'], [1, '1-30'], [30, '1-30'],
    [31, '31-60'], [60, '31-60'], [61, '61-90'], [90, '61-90'], [91, '90+'],
  ])('%s days → %s', (days, bucket) => expect(bucketOf(days)).toBe(bucket));

  test('counts whole days from the due date to the as-at date', () => {
    expect(daysPastDue('2026-08-31', '2026-09-30')).toBe(30);
    expect(daysPastDue('2026-09-30', '2026-09-30')).toBe(0);
    expect(daysPastDue('2026-10-15', '2026-09-30')).toBe(-15);
    expect(daysPastDue(null, '2026-09-30')).toBeNull();
  });
});

describe('summarizeReceivables', () => {
  const rows = [
    { currency: 'USD', outstanding: 600, outstandingPkr: 168000, bucket: '1-30', overdue: true },
    { currency: 'USD', outstanding: 400, outstandingPkr: null, bucket: 'current', overdue: false },
    { currency: 'PKR', outstanding: 50000, outstandingPkr: 50000, bucket: '90+', overdue: true },
  ];

  test('per currency, buckets add up to the outstanding, never a cross-currency total', () => {
    const s = summarizeReceivables(rows, { asOf: '2026-09-30' });
    expect(s.buckets).toEqual(BUCKETS);
    expect(s.byCurrency.USD).toEqual({
      count: 2, outstanding: 1000, overdueCount: 1, overdueAmount: 600,
      buckets: { current: 400, '1-30': 600, '31-60': 0, '61-90': 0, '90+': 0 },
    });
    expect(s.byCurrency.PKR.outstanding).toBe(50000);
    for (const c of Object.values(s.byCurrency)) {
      expect(Object.values(c.buckets).reduce((a, b) => a + b, 0)).toBeCloseTo(c.outstanding, 2);
    }
    expect(s).not.toHaveProperty('total');
    expect(s.openCount).toBe(3);
  });

  test('≈ PKR is each row at its booked share; a row with no rate is left out and counted', () => {
    const s = summarizeReceivables(rows, { asOf: '2026-09-30' });
    expect(s.pkrEquiv.outstanding).toMatchObject({ pkr: 218000, basis: 'booked', missingCount: 1, foreign: true });
    expect(s.pkrEquiv.overdue).toMatchObject({ pkr: 218000, missingCount: 0 });
  });
});
