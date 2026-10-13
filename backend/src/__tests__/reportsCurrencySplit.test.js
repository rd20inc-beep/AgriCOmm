/**
 * Reports — PKR and USD are never summed (owner decision G-1, audit R12/C6).
 *
 * Pure folds behind Reports ▸ Executive and Reports ▸ Cash Forecast:
 *  - per-currency figures with ONE secondary ≈ PKR equivalent (booked rates,
 *    or today's rate where none is kept — labelled);
 *  - the cash forecast is one forecast per currency; uncleared cheques are
 *    pending, never cash.
 */
const {
  byCurrency, foldPkrEquiv, cashSummary, workingCapitalSummary, collectionRateFields,
  receivablePkrAtBooked, payablePkrToday, nativeMoneyText,
} = require('../modules/finance/currencyFigures');
const { foldCashForecast, addDays } = require('../modules/analytics/cashForecast');

describe('currencyFigures', () => {
  test('byCurrency keeps each currency on its own', () => {
    expect(byCurrency([
      { currency: 'usd', total: '121621.10' },
      { currency: 'PKR', total: '821395' },
      { currency: 'USD', total: '10' },
    ])).toEqual({ USD: 121631.1, PKR: 821395 });
    expect(byCurrency(undefined)).toEqual({});
  });

  test('foldPkrEquiv: booked rows, rows with no rate counted, today-rate rows labelled', () => {
    expect(foldPkrEquiv([
      { currency: 'USD', pkr: 28000, basis: 'booked' },
      { currency: 'PKR', pkr: 500, basis: 'booked' },
      { currency: 'USD', pkr: null, basis: 'booked' },
    ])).toEqual({ pkr: 28500, basis: 'booked', todayCount: 0, missingCount: 1, foreign: true, rateDate: null });

    const mixed = foldPkrEquiv([
      { currency: 'USD', pkr: 28000, basis: 'booked' },
      { currency: 'USD', pkr: 2800, basis: 'today', sign: -1 },
    ], { rateDate: '2026-10-12' });
    expect(mixed).toMatchObject({ pkr: 25200, basis: 'mixed', todayCount: 1, rateDate: '2026-10-12' });

    expect(foldPkrEquiv([{ currency: 'USD', pkr: 2800, basis: 'today' }]).basis).toBe('today');
    expect(foldPkrEquiv([{ currency: 'PKR', pkr: 10 }]).foreign).toBe(false);
  });

  test('cashSummary: balances per currency; the equivalent is at today\'s rate, dated', () => {
    const out = cashSummary([
      { currency: 'PKR', total: '1500000.50', count: '3' },
      { currency: 'USD', total: '2500', count: '1' },
      { currency: 'EUR', total: '100', count: '1' },
    ], { usdRate: 280, rateDate: '2026-10-12' });
    expect(out.byCurrency).toEqual({ PKR: 1500000.5, USD: 2500, EUR: 100 });
    expect(out.accountCount).toBe(5);
    expect(out.pkrEquiv).toEqual({ pkr: 1500000.5 + 2500 * 280, basis: 'today', rate: 280, rateDate: '2026-10-12', unconvertedCount: 1 });
    // The old single SUM(current_balance) — 1,502,600.50 "rupees" — is nowhere.
    expect(Object.values(out.byCurrency)).not.toContain(1502600.5);
  });

  test('workingCapitalSummary: receivables + stock − payables inside each currency', () => {
    const wc = workingCapitalSummary({
      receivables: [
        { currency: 'USD', outstanding: '121621.10', pkr_equiv: '34053908', pkr_missing: '1' },
        { currency: 'PKR', outstanding: '821395', pkr_equiv: '821395', pkr_missing: '0' },
      ],
      payables: [
        { currency: 'PKR', outstanding: '300000', count: '2' },
        { currency: 'USD', outstanding: '1000', count: '1' },
      ],
      inventoryPkr: 5000000,
      usdRate: 280,
      rateDate: '2026-10-12',
    });
    expect(wc.receivablesByCurrency).toEqual({ USD: 121621.1, PKR: 821395 });
    expect(wc.payablesByCurrency).toEqual({ PKR: 300000, USD: 1000 });
    expect(wc.netByCurrency).toEqual({ USD: 120621.1, PKR: 821395 + 5000000 - 300000 });
    // Receivables at their booked rate, the USD payable at today's rate.
    expect(wc.pkrEquiv.pkr).toBe(34053908 + 821395 + 5000000 - 300000 - 280000);
    expect(wc.pkrEquiv).toMatchObject({ basis: 'mixed', todayCount: 1, missingCount: 1, foreign: true });
  });

  test('collectionRateFields: one rate only when one currency is due', () => {
    expect(collectionRateFields({ byCurrency: { USD: { ratePct: 39.2 }, PKR: { ratePct: 17.9 } } }))
      .toEqual({ collectionRate: null, collectionRateByCurrency: { USD: 39.2, PKR: 17.9 } });
    expect(collectionRateFields({ byCurrency: { USD: { ratePct: 39.2 } } }).collectionRate).toBe(39.2);
    expect(collectionRateFields({ byCurrency: {} }).collectionRate).toBe(0);
  });

  test('single-row conversions', () => {
    expect(receivablePkrAtBooked({ currency: 'USD', outstanding: 50, base_amount_pkr: 28000, expected_amount: 100 })).toBe(14000);
    expect(receivablePkrAtBooked({ currency: 'USD', outstanding: 50, fx_rate: 281 })).toBe(14050);
    expect(receivablePkrAtBooked({ currency: 'USD', outstanding: 50 })).toBeNull();
    expect(receivablePkrAtBooked({ currency: 'PKR', outstanding: 50 })).toBe(50);
    expect(payablePkrToday('USD', 10, 280)).toBe(2800);
    expect(payablePkrToday('EUR', 10, 280)).toBeNull();
    expect(nativeMoneyText(121621.1, 'USD')).toBe('USD 121,621.10');
    expect(nativeMoneyText(5, 'PKR')).toBe('Rs 5.00');
  });
});

describe('cash forecast — one forecast per currency', () => {
  const input = {
    bank: [{ currency: 'PKR', total: '1000000', count: '2' }, { currency: 'USD', total: '5000', count: '1' }],
    // Prod 2026-10: USD 121,621 open was counted as Rs 121,621.
    receipts: [
      { currency: 'USD', due_day: '2026-10-15', amount: '121621', pkr_equiv: '34053880', pkr_missing: '0' },
      { currency: 'PKR', due_day: '2026-10-14', amount: '200000', pkr_equiv: '200000', pkr_missing: '0' },
    ],
    payments: [{ currency: 'PKR', due_day: '2026-10-15', amount: '300000', count: '1' }],
    cheques: [
      { type: 'receipt', currency: 'PKR', amount: '50000', count: '1' },
      { type: 'payment', currency: 'USD', amount: '700', count: '2' },
    ],
  };
  const out = foldCashForecast(input, { asOf: '2026-10-13', daysAhead: 3, usdRate: 280, rateDate: '2026-10-12' });

  test('each currency projects from its own cash, never the other\'s', () => {
    expect(out.currencies).toEqual(['PKR', 'USD']);
    expect(out.byCurrency.PKR).toMatchObject({
      currentCash: 1000000, expectedReceipts: 200000, expectedPayments: 300000, projectedBalance: 900000,
    });
    expect(out.byCurrency.USD).toMatchObject({
      currentCash: 5000, expectedReceipts: 121621, expectedPayments: 0, projectedBalance: 126621,
    });
    // Rs 1,000,000 + 121,621 "rupees" — the old mixed figure — is not here.
    expect(out.byCurrency.PKR.projectedBalance).not.toBe(1021621);
  });

  test('daily projection rows carry their currency', () => {
    const pkr = out.projection.filter((p) => p.currency === 'PKR');
    expect(pkr.map((p) => p.date)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    expect(pkr.map((p) => p.projectedBalance)).toEqual([1000000, 1200000, 900000, 900000]);
    const usd15 = out.projection.find((p) => p.currency === 'USD' && p.date === '2026-10-15');
    expect(usd15).toMatchObject({ expectedReceipts: 121621, netCashFlow: 121621, projectedBalance: 126621 });
  });

  test('uncleared cheques are pending, beside the forecast — not in it', () => {
    expect(out.byCurrency.PKR.pendingChequesIn).toEqual({ amount: 50000, count: 1 });
    expect(out.byCurrency.USD.pendingChequesOut).toEqual({ amount: 700, count: 2 });
    expect(out.byCurrency.PKR.currentCash).toBe(1000000);
  });

  test('≈ PKR equivalent: receivables at booked rates, balances / payables at today\'s rate', () => {
    expect(out.pkrEquiv.currentCash).toMatchObject({ pkr: 1000000 + 5000 * 280, basis: 'today', rateDate: '2026-10-12' });
    expect(out.pkrEquiv.expectedReceipts).toMatchObject({ pkr: 34053880 + 200000, basis: 'booked' });
    expect(out.pkrEquiv.projectedBalance.pkr).toBe(1000000 + 1400000 + 34253880 - 300000);
    expect(out.pkrEquiv.projectedBalance.basis).toBe('mixed');
  });

  test('addDays crosses months in UTC', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });
});
