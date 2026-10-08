/**
 * Mill vs local segmentation (owner decision G-3), DB-less: every local sale
 * lands in exactly one segment, a sale drawn from a lot with no COGS is left
 * out of profit (and counted) instead of reading as 100% margin, and a
 * transfer to export earns the mill its transfer price − the lot's cost.
 * The SQL side is profitDefinitions.integration.test.js.
 */
const { foldMillAndLocal, isMillOutputLot, toDay } = require('../modules/finance/profitDefinitions');

const sale = (o) => ({ ownership: 'company', lot_entity: 'mill', ...o });

describe('foldMillAndLocal', () => {
  const sales = [
    sale({ id: 1, sale_no: 'LS-1', lot_id: 10, lot_type: 'finished', quantity_kg: 1000, total_amount: 200000, cogs_total_pkr: 150000 }),
    sale({ id: 2, sale_no: 'LS-2', lot_id: 11, lot_type: 'byproduct', quantity_kg: 3500, total_amount: 402500, cogs_total_pkr: 415905 }),
    sale({ id: 3, sale_no: 'LS-3', lot_id: 12, lot_type: 'byproduct', quantity_kg: 200, total_amount: 8000, cogs_total_pkr: null }),
    sale({ id: 4, sale_no: 'LS-4', lot_id: 13, lot_type: 'raw', quantity_kg: 1000, total_amount: 100000, cogs_total_pkr: 90000 }),
    sale({ id: 5, sale_no: 'LS-5', lot_id: null, lot_type: null, item_type: 'labour', quantity_kg: 1, total_amount: 1540, cogs_total_pkr: null }),
    sale({ id: 6, sale_no: 'LS-6', lot_id: 14, lot_type: 'finished', ownership: 'client', quantity_kg: 10, total_amount: 500, cogs_total_pkr: 400 }),
  ];
  const transfers = [
    { transfer_id: 7, quantity_kg: 2000, transfer_price_pkr: 180000, cost_pkr: 300000 },
    { transfer_id: 8, quantity_kg: 100, transfer_price_pkr: 180000, cost_pkr: null },
  ];

  const { mill, local, saleSegments } = foldMillAndLocal(sales, transfers);

  test('mill = sales of mill output (local + transfers) − their COGS', () => {
    // (200,000 − 150,000) + (402,500 − 415,905) + (360,000 − 300,000)
    expect(mill.revenuePkr).toBe(200000 + 402500 + 360000);
    expect(mill.cogsPkr).toBe(150000 + 415905 + 300000);
    expect(mill.profitPkr).toBe(50000 - 13405 + 60000);
    expect(mill.transferCount).toBe(1);
  });

  test('uncosted sales / transfers are excluded and counted, never 100% margin', () => {
    expect(mill.uncostedCount).toBe(2);
    expect(mill.uncostedRevenuePkr).toBe(8000 + 18000);
  });

  test('local = everything else (raw lots, service lines, client-owned lots)', () => {
    expect(local.saleCount).toBe(3);
    expect(local.profitPkr).toBe(10000 + 1540 + 100);
  });

  test('each sale lands in exactly one segment', () => {
    expect(saleSegments.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(saleSegments.filter((s) => s.segment === 'mill').map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

test('isMillOutputLot: company mill finished/byproduct only', () => {
  expect(isMillOutputLot(sale({ lot_id: 1, lot_type: 'finished' }))).toBe(true);
  expect(isMillOutputLot(sale({ lot_id: 1, lot_type: 'byproduct' }))).toBe(true);
  expect(isMillOutputLot(sale({ lot_id: 1, lot_type: 'raw' }))).toBe(false);
  expect(isMillOutputLot(sale({ lot_id: 1, lot_type: 'finished', lot_entity: 'export' }))).toBe(false);
  expect(isMillOutputLot(sale({ lot_id: null, lot_type: null }))).toBe(false);
});

test('toDay normalises the period bounds', () => {
  expect(toDay('2026-10-31 23:59:59.999')).toBe('2026-10-31');
  expect(toDay('')).toBeNull();
  expect(toDay(new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02');
});
