/**
 * P4-01 / P4-02 — the KPI contract modules, pure parts
 * (docs/AGRIRICE_KPI_CONTRACTS.md). The DB-backed golden numbers are in
 * kpiGolden.integration.test.js.
 */
const { fiscalYearOf, resolvePeriod } = require('../shared/fiscalYear');
const { effectiveDue, isOverdue, isPayableOverdue, effectiveDueSql, overdueSql } = require('../modules/kpi/overdue');
const { isActiveOrder, INACTIVE_ORDER_STATUSES, activeOrderSql } = require('../modules/kpi/orderStatus');
const { exportRevenueDate } = require('../modules/kpi/exportRevenueDate');
const { foldMillCash } = require('../modules/kpi/millCashFlow');
const { foldProduction } = require('../modules/kpi/millFinance');
const { KPI_CONTRACTS } = require('../modules/kpi/contracts');
const { feePerKg } = require('../modules/milling/millingFee');

describe('fiscal year (D-1: July–June)', () => {
  test('the year containing a day', () => {
    expect(fiscalYearOf('2026-10-16')).toEqual({ startYear: 2026, label: 'FY 2026-27', start: '2026-07-01', end: '2027-06-30' });
    expect(fiscalYearOf('2027-06-30').label).toBe('FY 2026-27');
    expect(fiscalYearOf('2026-06-30').label).toBe('FY 2025-26');
    expect(fiscalYearOf('2099-07-01').start).toBe('2099-07-01');
  });
  test('period keys resolve to inclusive day bounds', () => {
    const today = '2026-10-16';
    expect(resolvePeriod({ period: 'month', today })).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolvePeriod({ period: 'quarter', today })).toMatchObject({ from: '2026-10-01', to: '2026-12-31', label: 'Q2 FY 2026-27' });
    expect(resolvePeriod({ period: 'quarter', today: '2027-02-10' })).toMatchObject({ from: '2027-01-01', to: '2027-03-31', label: 'Q3 FY 2026-27' });
    expect(resolvePeriod({ period: 'fytd', today })).toMatchObject({ from: '2026-07-01', to: '2026-10-16' });
    expect(resolvePeriod({ period: 'fy', today: '2027-03-01' })).toMatchObject({ from: '2026-07-01', to: '2027-06-30' });
    expect(resolvePeriod({ period: 'all', today })).toMatchObject({ from: null, to: null });
    expect(resolvePeriod({ period: 'custom', from: '2026-01-05', to: '2026-02-01', today })).toMatchObject({ from: '2026-01-05', to: '2026-02-01' });
    expect(resolvePeriod({ period: 'month', today: '2028-02-15' }).to).toBe('2028-02-29');
  });
  test('an unknown key or bad range is refused, never read as all time', () => {
    expect(() => resolvePeriod({ period: 'ytd' })).toThrow(/Unknown period/);
    expect(() => resolvePeriod({ period: 'custom', from: 'soon' })).toThrow(/dates/);
    expect(() => resolvePeriod({ period: 'custom', from: '2026-02-01', to: '2026-01-01' })).toThrow(/after/);
  });
});

describe('overdue (D-15)', () => {
  const asOf = '2026-10-16';
  test('an export balance falls due sailing + term, not on its placeholder', () => {
    const bal = { type: 'Balance', order_id: 1, due_date: '2026-01-01', outstanding: 100, status: 'Pending' };
    // Not sailed: no due date, never overdue — whatever the placeholder says.
    expect(effectiveDue(bal, { bl_date: null, atd: null })).toBeNull();
    expect(isOverdue(bal, { status: 'In Milling' }, { asOf })).toBe(false);
    // BL 2026-09-01 + the order's 30 days = 2026-10-01 → overdue on 10-16.
    expect(effectiveDue(bal, { bl_date: '2026-09-01', balance_term_days: 30 })).toBe('2026-10-01');
    expect(isOverdue(bal, { bl_date: '2026-09-01', balance_term_days: 30, status: 'Shipped' }, { asOf })).toBe(true);
    // atd when no BL; the system term when the order has none.
    expect(effectiveDue(bal, { atd: '2026-10-01' }, 45)).toBe('2026-11-15');
    expect(isOverdue(bal, { atd: '2026-10-01', status: 'Shipped' }, { asOf, termDays: 45 })).toBe(false);
  });
  test('nothing outstanding, written off, or a Draft / Cancelled order is never overdue', () => {
    const adv = { type: 'Advance', order_id: 1, due_date: '2026-01-01', outstanding: 0, status: 'Partial' };
    expect(isOverdue(adv, { status: 'Shipped' }, { asOf })).toBe(false);
    expect(isOverdue({ ...adv, outstanding: 5 }, { status: 'Shipped' }, { asOf })).toBe(true);
    expect(isOverdue({ ...adv, outstanding: 5, status: 'Written Off' }, null, { asOf })).toBe(false);
    expect(isOverdue({ ...adv, outstanding: 5 }, { status: 'Cancelled' }, { asOf })).toBe(false);
    expect(isOverdue({ type: 'Other', due_date: '2026-10-16', outstanding: 5 }, null, { asOf })).toBe(false); // due today
  });
  test('payables: past due with something outstanding, not Paid / Reversed', () => {
    expect(isPayableOverdue({ due_date: '2026-10-01', outstanding: 10, status: 'Pending' }, { asOf })).toBe(true);
    expect(isPayableOverdue({ due_date: '2026-10-01', outstanding: 0, status: 'Pending' }, { asOf })).toBe(false);
    expect(isPayableOverdue({ due_date: '2026-10-01', outstanding: 10, status: 'Reversed' }, { asOf })).toBe(false);
    expect(isPayableOverdue({ due_date: null, outstanding: 10, status: 'Pending' }, { asOf })).toBe(false);
  });
  test('SQL inlines only a validated integer term', () => {
    expect(effectiveDueSql({ termDays: '30; DROP TABLE x' })).toContain(', 30)::int');
    expect(effectiveDueSql({ termDays: 'abc' })).toContain(', 30)::int');
    expect(overdueSql({ r: 'r', o: 'o', termDays: 10 })).toContain("NOT IN ('Draft', 'Cancelled')");
  });
});

describe('active order (D-15)', () => {
  test('not Draft / Cancelled / Closed', () => {
    expect(INACTIVE_ORDER_STATUSES).toEqual(['Draft', 'Cancelled', 'Closed']);
    for (const s of ['Awaiting Advance', 'Advance Received', 'In Milling', 'Shipped', 'Arrived']) expect(isActiveOrder(s)).toBe(true);
    for (const s of ['Draft', 'Cancelled', 'Closed', null, '']) expect(isActiveOrder(s)).toBe(false);
    expect(activeOrderSql('eo.status')).toBe("(eo.status NOT IN ('Draft', 'Cancelled', 'Closed'))");
  });
});

describe('export revenue date (D-16)', () => {
  test('BL date, else the Shipped transition date, else none', () => {
    expect(exportRevenueDate({ bl_date: '2026-09-03' }, '2026-09-01T10:00:00Z')).toBe('2026-09-03');
    expect(exportRevenueDate({ bl_date: null }, '2026-09-01T10:00:00Z')).toBe('2026-09-01');
    expect(exportRevenueDate({}, null)).toBeNull();
  });
});

describe('mill cash flow (mill_cash_flow.v1)', () => {
  test('only settled money counts; reversed / bounced / uncleared are listed, not counted', () => {
    const { ledger, summary } = foldMillCash([
      { id: 1, direction: 'out', amount_pkr: 1000, status: 'Confirmed', cleared: true },
      { id: 2, direction: 'out', amount_pkr: 500, status: 'Reversed', cleared: true },
      { id: 3, direction: 'out', amount_pkr: 300, status: 'Confirmed', cleared: false },
      { id: 4, direction: 'in', amount_pkr: 2000, status: 'Confirmed', cleared: null },
      { id: 5, direction: 'in', amount_pkr: 700, status: 'Bounced', cleared: false },
      { id: 'ft-1', direction: 'in', amount_pkr: 50, isTransfer: true },
    ]);
    expect(summary).toMatchObject({
      cashIn: 2050, cashOut: 1000, net: 1050, count: 3,
      pendingChequesOut: 300, pendingChequesIn: 0, pendingChequeCount: 1, notMoneyCount: 2, basis: 'settled_only',
    });
    expect(ledger.map((r) => r.counted)).toEqual([true, false, false, true, false, true]);
  });
});

describe('production (production_value.v1) — no fee, blends counted once', () => {
  const batches = [
    // Own batch: 10,000 raw → 7,000 finished, 1,000 kg of it re-milled into the blend.
    { id: 1, status: 'Completed', raw_qty_kg: 10000, actual_finished_kg: 7000, wastage_kg: 200, finished_price_per_kg: 200,
      broken_kg: 500, broken_price_per_kg: 50, milling_fee_per_kg: 5 },
    // Blend: re-mills 1,000 kg → 950 finished; its raw_rice cost is internal.
    { id: 2, status: 'Completed', processing_type: 'blended', raw_qty_kg: 1000, actual_finished_kg: 950, wastage_kg: 0,
      finished_price_per_kg: 220, milling_fee_per_kg: 0 },
    // No finished selling price: its finished kg is left out, counted.
    { id: 3, status: 'Completed', raw_qty_kg: 2000, actual_finished_kg: 1200, wastage_kg: 50, finished_price_per_kg: null },
  ];
  const costs = [
    { batch_id: 1, category: 'raw_rice', amount: 1000000 },
    { batch_id: 1, category: 'packaging', amount: 20000 },
    { batch_id: 1, category: 'labour', amount: 30000 },
    { batch_id: 2, category: 'rawRice', amount: 200000 }, // blend: internal value — not raw again
    { batch_id: 2, category: 'processing', amount: 5000 },
    { batch_id: 3, category: 'raw_rice', amount: 150000 },
  ];
  const consumed = new Map([[1, 1000]]);
  const stored = new Map([[3, { byproductValue: 4000, finishedValue: 0, source: 'yield_lots' }]]);

  test('golden numbers', () => {
    const p = foldProduction(batches, costs, consumed, stored);
    expect(p).toMatchObject({
      batchCount: 3, blendCount: 1,
      rawKg: 13000, finishedKg: 9150, sellableFinishedKg: 8150, wastageKg: 250,
      rawCostPkr: 1150000, packagingCostPkr: 20000, otherCostPkr: 35000, batchCostPkr: 1205000,
      // 6,000 × 200 + 950 × 220
      finishedValuePkr: 1409000,
      // batch 1 at its own price (500 × 50), batch 3 at what its yield booked
      byproductValuePkr: 29000,
      valueAtSellingPricePkr: 1438000,
      unpricedFinishedBatches: 1, unpricedFinishedKg: 1200,
      contract: KPI_CONTRACTS.productionValue,
    });
    expect(p.batchCostPerKgPkr).toBeCloseTo(1205000 / 8150, 2);
    expect(p.yieldPct).toBe(70.38); // 9,150 / 13,000
  });

  test('regression MIL-02: the stored fee never changes a figure', () => {
    const withFee = foldProduction(batches.map((b) => ({ ...b, milling_fee_per_kg: 5 })), costs, consumed, stored);
    const noFee = foldProduction(batches.map((b) => ({ ...b, milling_fee_per_kg: 0 })), costs, consumed, stored);
    expect(withFee).toEqual(noFee);
  });
});

describe('milling fee (MIL-02)', () => {
  test('0 is a real fee; missing / invalid is 0, never a Rs 5 default', () => {
    expect(feePerKg(0)).toBe(0);
    expect(feePerKg('0')).toBe(0);
    expect(feePerKg(undefined)).toBe(0);
    expect(feePerKg(null)).toBe(0);
    expect(feePerKg('')).toBe(0);
    expect(feePerKg(-1)).toBe(0);
    expect(feePerKg('2.5')).toBe(2.5);
  });
});
