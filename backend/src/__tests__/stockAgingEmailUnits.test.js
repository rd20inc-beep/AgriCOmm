/**
 * P4-10 / RPT-33 — the scheduled Stock Aging email labels lot quantities as KG.
 * Lot qty is KG (Phase 5c); older lots still carry unit = 'MT', which the
 * email used to print verbatim ("12500 MT").
 */
jest.mock('../config/database', () => ({}));
const service = require('../modules/analytics/reporting.service');

describe('scheduled Stock Aging email — units', () => {
  it('prints KG whatever the stale lot.unit column says', async () => {
    const spy = jest.spyOn(service, 'getStockAgingReport').mockResolvedValue({
      data: [{ lotNo: 'L-1', itemName: 'Super', type: 'raw', qty: 12500, unit: 'MT', totalValue: 100, daysInStock: 4 }],
    });
    const r = await service.buildScheduledReport('stock_aging');
    expect(r.columns).toContain('Qty (kg)');
    expect(r.rows[0][3]).toBe('12,500 kg');
    expect(JSON.stringify(r.rows)).not.toMatch(/MT/);
    spy.mockRestore();
  });
});
