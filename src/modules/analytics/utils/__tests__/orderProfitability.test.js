import { describe, test, expect } from 'vitest';
import { orderProfitRows, customerProfit, countryRevenue, profitByCustomer } from '../orderProfitability';

// Booked rows from /finance/profitability-summary (PKR at the booked rate).
const exportRows = [
  { id: 1, orderNo: 'EX-001', priced: true, revenuePkr: 28000000, totalCostPkr: 25200000, bookedProfitPkr: 2800000, estimated: false },
  { id: 2, orderNo: 'EX-002', priced: true, revenuePkr: 14000000, totalCostPkr: 14700000, bookedProfitPkr: -700000, estimated: true },
  { id: 3, orderNo: 'EX-003', priced: false, revenuePkr: null, totalCostPkr: null, bookedProfitPkr: null },
];
const exportOrders = [
  { id: 1, customerName: 'Acme', country: 'UAE', contractValue: 100000, costs: { freight: 1000000 } },
  { id: 2, customerName: 'Acme', country: 'Oman', contractValue: 50000 },
  { id: 3, customerName: 'Beta', country: 'UAE', contractValue: 70000 },
];

describe('Intelligence profitability — one currency', () => {
  test('rows are the booked PKR figures; unpriced orders are left out', () => {
    const rows = orderProfitRows(exportRows, exportOrders);
    expect(rows.map((r) => r.orderNo)).toEqual(['EX-001', 'EX-002']);
    // Not 100,000 (USD) − 1,000,000 (PKR): the old browser maths.
    expect(rows[0]).toMatchObject({ customer: 'Acme', country: 'UAE', revenuePkr: 28000000, profitPkr: 2800000, marginPct: 10 });
    expect(rows[1].estimated).toBe(true);
  });

  test('customer and country totals add PKR only', () => {
    const rows = orderProfitRows(exportRows, exportOrders);
    expect(customerProfit(rows)).toEqual([{ name: 'Acme', orders: 2, revenue: 42000000, costs: 39900000, profit: 2100000 }]);
    expect(countryRevenue(rows).map((c) => [c.name, c.revenue])).toEqual([['UAE', 28000000], ['Oman', 14000000]]);
    expect(profitByCustomer(rows)).toEqual({ Acme: { revenuePkr: 42000000, profitPkr: 2100000 } });
  });

  test('empty input is safe', () => {
    expect(orderProfitRows(undefined, undefined)).toEqual([]);
    expect(customerProfit([])).toEqual([]);
  });
});
