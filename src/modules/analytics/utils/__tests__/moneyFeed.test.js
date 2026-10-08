import { describe, it, expect } from 'vitest';
import { moneyTile, netTile, formatCurrencyLines, currencyLines, cappedHint } from '../moneyFeed';

// Reports hub Money In / Money Out: the tiles summed a 500-row page into one
// PKR figure (USD converted and added, reversed payments and uncleared cheques
// included). They now read the server's per-currency totals.
const receipts = {
  totals: { USD: { amount: 100, count: 1 }, PKR: { amount: 3000, count: 2 } },
  pendingCheques: { PKR: { amount: 300, count: 1 } },
  totalCount: 5,
};
const payments = { totals: { PKR: { amount: 700, count: 1 } }, pendingCheques: {} };

describe('Money In / Out tiles', () => {
  it('lead with rupees, show dollars beside them, never a sum', () => {
    const t = moneyTile(receipts, 'receipts');
    expect(t.primary).toBe('Rs 3,000.00');
    expect(t.secondary).toBe('+ $100.00 · 3 receipts · Rs 300.00 in uncleared cheques');
    expect(`${t.primary} ${t.secondary}`).not.toMatch(/31,|28,/);
  });

  it('no money yet reads Rs 0.00 · 0 payments', () => {
    expect(moneyTile({}, 'payments')).toEqual({ primary: 'Rs 0.00', secondary: '0 payments' });
  });

  it('net cashflow is in − out inside each currency', () => {
    const n = netTile(receipts.totals, payments.totals);
    expect(n.primary).toBe('Rs 2,300.00');
    expect(n.secondary).toBe('$100.00');
    expect(n.negative).toBe(false);
    expect(netTile(payments.totals, receipts.totals).negative).toBe(true);
  });

  it('orders PKR, USD, then others and formats each in its own currency', () => {
    expect(currencyLines({ EUR: { amount: 1 }, USD: { amount: 2 }, PKR: { amount: 3 } }).map((l) => l.currency)).toEqual(['PKR', 'USD', 'EUR']);
    expect(formatCurrencyLines(receipts.totals)).toBe('Rs 3,000.00 · $100.00');
  });
});

describe('capped list hint', () => {
  it('only speaks up when rows were left out', () => {
    expect(cappedHint(500, 1234)).toBe('Showing 500 of 1,234');
    expect(cappedHint(12, 12)).toBeNull();
    expect(cappedHint(12, undefined)).toBeNull();
  });
});
