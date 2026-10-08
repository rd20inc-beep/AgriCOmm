/**
 * Package C (owner decisions C2–C4, C6, 2026-10-09), DB-less: the pure parts.
 * The SQL side is profitReportingRules.integration.test.js.
 */
const { rateMasterPerKg, exportTotals, foldMillAndLocal } = require('../modules/finance/profitDefinitions');
const { foldCollection } = require('../modules/finance/collectionRate');
const { balanceDueDate } = require('../modules/exportOrders/balanceDueDate');

describe('C2 rateMasterPerKg', () => {
  test('per MT ÷ 1000, per KG as is, blank unit reads as per MT', () => {
    expect(rateMasterPerKg({ rate_value: 120000, unit: 'per_mt', rate_currency: 'PKR' })).toBe(120);
    expect(rateMasterPerKg({ rate_value: 150, unit: 'per_kg', rate_currency: 'PKR' })).toBe(150);
    expect(rateMasterPerKg({ rate_value: 95000, unit: null, rate_currency: 'PKR' })).toBe(95);
  });
  test('a rate in the order currency converts at the BOOKED rate; anything else is unusable', () => {
    expect(rateMasterPerKg({ rate_value: 500, unit: 'per_mt', rate_currency: 'USD' }, { currency: 'USD', bookedRate: 280 })).toBe(140);
    expect(rateMasterPerKg({ rate_value: 500, unit: 'per_mt', rate_currency: 'USD' }, { currency: 'PKR', bookedRate: 1 })).toBeNull();
    expect(rateMasterPerKg({ rate_value: 500, unit: 'per_mt', rate_currency: 'USD' }, { currency: 'USD', bookedRate: 0 })).toBeNull();
    expect(rateMasterPerKg({ rate_value: 120, unit: 'per_bag', rate_currency: 'PKR' })).toBeNull();
    expect(rateMasterPerKg({ rate_value: 0, unit: 'per_kg', rate_currency: 'PKR' })).toBeNull();
    expect(rateMasterPerKg(null)).toBeNull();
  });
});

describe('C4 exportTotals', () => {
  const row = (o) => ({ priced: true, estimated: false, inBookedPeriod: true, inRealisedPeriod: false, realised: false, ...o });
  const rows = [
    // Booked this period, not shipped → pipeline.
    row({ id: 1, revenuePkr: 1000, bookedProfitPkr: 300 }),
    // Booked this period AND shipped this period.
    row({ id: 2, revenuePkr: 1000, bookedProfitPkr: 200, realised: true, realisedProfitPkr: 200, inRealisedPeriod: true }),
    // Booked earlier, shipped this period → realised only.
    row({ id: 3, revenuePkr: 1000, bookedProfitPkr: 500, realised: true, realisedProfitPkr: 500, inBookedPeriod: false, inRealisedPeriod: true }),
    // Booked this period, shipped in a later period → booked, not pipeline.
    row({ id: 4, revenuePkr: 1000, bookedProfitPkr: 100, realised: true, realisedProfitPkr: 100 }),
    // Booked this period, unpriced.
    row({ id: 5, priced: false, revenuePkr: 700, bookedProfitPkr: null, riceCostBasis: 'unpriced' }),
    row({ id: 6, revenuePkr: 400, bookedProfitPkr: 40, estimated: true, riceCostBasis: 'rate_master', riceCostPkr: 360 }),
  ];
  const t = exportTotals(rows);
  test('Booked by order date, Realised by shipment date', () => {
    expect(t.bookedPkr).toBe(300 + 200 + 100 + 40);
    expect(t.realisedPkr).toBe(200 + 500);
    expect(t.realisedCount).toBe(2);
    expect(t.orderCount).toBe(5);
  });
  test('Pipeline = booked orders not yet realised, not Booked − Realised', () => {
    expect(t.pipelinePkr).toBe(300 + 40);
    expect(t.pipelineCount).toBe(2);
    expect(t.pipelinePkr).not.toBe(t.bookedPkr - t.realisedPkr);
  });
  test('unpriced excluded and counted; rate-master orders counted', () => {
    expect(t).toMatchObject({ unpricedCount: 1, unpricedRevenuePkr: 700, rateMasterCount: 1, estimatedCount: 1 });
  });
});

describe('C3 mill overheads', () => {
  const sales = [{ id: 1, sale_no: 'LS-1', lot_id: 1, lot_type: 'finished', lot_entity: 'mill', ownership: 'company', quantity_kg: 1000, total_amount: 200000, cogs_total_pkr: 150000 }];
  test('net = sales − COGS − overheads; gross kept beside it', () => {
    const { mill } = foldMillAndLocal(sales, [], { pkr: 30000, count: 3, batchLinkedPkr: 7000 });
    expect(mill).toMatchObject({ grossProfitPkr: 50000, overheadsPkr: 30000, profitPkr: 20000, netProfitPkr: 20000, overheadCount: 3, overheadsDeducted: true });
    expect(mill.marginPct).toBe(10);
    expect(mill.grossMarginPct).toBe(25);
  });
  test('no overheads → net equals gross', () => {
    const { mill } = foldMillAndLocal(sales, []);
    expect(mill.profitPkr).toBe(mill.grossProfitPkr);
  });
});

describe('C6 collection rate', () => {
  const asOf = '2026-10-09';
  const rows = [
    { currency: 'USD', expected: 1000, received: 400, outstanding: 600, effective_due: '2026-09-01' },
    { currency: 'USD', expected: 1000, received: 1000, outstanding: 0, effective_due: '2026-08-01' },
    // Not due yet / not sailed → left out of both sides.
    { currency: 'USD', expected: 5000, received: 2000, outstanding: 3000, effective_due: '2026-12-01' },
    { currency: 'USD', expected: 9000, received: 0, outstanding: 9000, effective_due: null },
    // Due today is not past due.
    { currency: 'USD', expected: 50, received: 0, outstanding: 50, effective_due: '2026-10-09' },
    { currency: 'PKR', expected: 100000, received: 100000, outstanding: 0, effective_due: '2026-01-01' },
  ];
  const c = foldCollection(rows, { asOf, targets: { default: 95 } });
  test('received ÷ due, per currency, never summed', () => {
    expect(c.byCurrency.USD).toMatchObject({ dueAmount: 2000, receivedAmount: 1400, ratePct: 70, overdueAmount: 600, overdueCount: 1, onTarget: false, targetPct: 95 });
    expect(c.byCurrency.PKR).toMatchObject({ ratePct: 100, onTarget: true });
    expect(c.notYetDue.USD).toBe(3000 + 9000 + 50);
  });
  test('a per-currency target overrides the default', () => {
    const t = foldCollection(rows, { asOf, targets: { default: 95, USD: 70 } });
    expect(t.byCurrency.USD).toMatchObject({ targetPct: 70, onTarget: true });
    expect(t.targetPct).toBe(95);
  });
});

describe('C6 balance due date', () => {
  test('BL date + term; atd when no BL; null before sailing', () => {
    expect(balanceDueDate({ bl_date: '2026-10-01', balance_term_days: 30 })).toBe('2026-10-31');
    expect(balanceDueDate({ bl_date: null, atd: '2026-10-05', balance_term_days: 0 })).toBe('2026-10-05');
    expect(balanceDueDate({ bl_date: '2026-10-01', atd: '2026-09-20', balance_term_days: 10 })).toBe('2026-10-11');
    expect(balanceDueDate({ bl_date: null, atd: null, balance_term_days: 30 })).toBeNull();
  });
  test('a missing term falls back to the setting', () => {
    expect(balanceDueDate({ bl_date: '2026-12-15' }, 30)).toBe('2027-01-14');
    expect(balanceDueDate({ bl_date: '2026-12-15', balance_term_days: null }, 45)).toBe('2027-01-29');
  });
});
