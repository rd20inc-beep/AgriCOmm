import { describe, it, expect } from 'vitest';
import { forecastCurrencies, forecastCards, forecastRows, forecastEquivText } from '../cashForecastView';

// Reports ▸ Cash Forecast added every bank balance and every open receivable /
// payable into one rupee figure — USD 121,621 open was shown as Rs 121,621.
// It now renders one forecast per currency, side by side.
const data = {
  asOf: '2026-10-13',
  daysAhead: 1,
  currencies: ['PKR', 'USD', 'EUR'],
  byCurrency: {
    PKR: { currentCash: 1000000, expectedReceipts: 200000, expectedPayments: 300000, projectedBalance: 900000,
      pendingChequesIn: { amount: 50000, count: 1 }, pendingChequesOut: { amount: 0, count: 0 } },
    USD: { currentCash: 5000, expectedReceipts: 121621, expectedPayments: 0, projectedBalance: 126621,
      pendingChequesIn: { amount: 0, count: 0 }, pendingChequesOut: { amount: 700, count: 2 } },
    EUR: { currentCash: 0, expectedReceipts: 0, expectedPayments: 0, projectedBalance: 0,
      pendingChequesIn: { amount: 0, count: 0 }, pendingChequesOut: { amount: 0, count: 0 } },
  },
  projection: [
    { currency: 'USD', date: '2026-10-13', expectedReceipts: 0, expectedPayments: 0, projectedBalance: 5000 },
    { currency: 'PKR', date: '2026-10-13', expectedReceipts: 0, expectedPayments: 0, projectedBalance: 1000000 },
    { currency: 'PKR', date: '2026-10-14', expectedReceipts: 200000, expectedPayments: 300000, projectedBalance: 900000 },
    { currency: 'USD', date: '2026-10-14', expectedReceipts: 121621, expectedPayments: 0, projectedBalance: 126621 },
    { currency: 'EUR', date: '2026-10-14', expectedReceipts: 0, expectedPayments: 0, projectedBalance: 0 },
  ],
  pkrEquiv: {
    projectedBalance: { pkr: 36354000, basis: 'mixed', todayCount: 1, missingCount: 0, rateDate: '2026-10-12' },
  },
};

describe('Cash Forecast view', () => {
  it('PKR always, other currencies only when they hold or owe something', () => {
    expect(forecastCurrencies(data)).toEqual(['PKR', 'USD']);
    expect(forecastCurrencies({})).toEqual([]);
  });

  it('one card per currency, in its own money — never a sum', () => {
    const [pkr, usd] = forecastCards(data);
    expect(pkr).toMatchObject({ currency: 'PKR', currentCash: 1000000, projectedBalance: 900000 });
    expect(usd).toMatchObject({ currency: 'USD', expectedReceipts: 121621, projectedBalance: 126621 });
    expect(pkr.pendingText).toBe('Uncleared cheques (not in the forecast): Rs 50,000.00 in (1)');
    expect(usd.pendingText).toBe('Uncleared cheques (not in the forecast): $700.00 out (2)');
  });

  it('table rows put each currency in its own columns, per day', () => {
    const rows = forecastRows(data);
    expect(rows.map((r) => r.date)).toEqual(['2026-10-13', '2026-10-14']);
    expect(rows[1].cells.PKR.projectedBalance).toBe(900000);
    expect(rows[1].cells.USD.projectedBalance).toBe(126621);
    expect(rows[1].cells.EUR).toBeUndefined();
  });

  it('a ≈ PKR equivalent line, labelled with its rates — only when a foreign currency is in play', () => {
    expect(forecastEquivText(data)).toBe('Projected balance ≈ PKR equiv. Rs 36,354,000 (booked rates; 1 at today\'s rate 2026-10-12)');
    const pkrOnly = { ...data, currencies: ['PKR'], byCurrency: { PKR: data.byCurrency.PKR } };
    expect(forecastEquivText(pkrOnly)).toBeNull();
  });
});
