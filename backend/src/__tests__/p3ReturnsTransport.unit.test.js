/**
 * Pure helpers behind P3-11 (returns, voids) and P3-08 (batch transport).
 */
const { proRata, splitReturnValue } = require('../modules/localSales/saleReturns');
const { unwindAverage } = require('../modules/millStore/storePurchaseVoid');
const { accrualDeltas, transportAdjustmentParts } = require('../modules/milling/batchTransport');

describe('local-sale return amounts', () => {
  test('pro rata by quantity; the last return takes whatever is left', () => {
    expect(proRata(150000, 0, 400, 1000, false)).toBe(60000);
    expect(proRata(100, 0, 1, 3, false)).toBe(33.33);
    expect(proRata(100, 66.66, 1, 3, true)).toBe(33.34);
  });
  test('the open receivable is settled first, the rest was paid', () => {
    expect(splitReturnValue(60000, 150000)).toEqual({ applied: 60000, excess: 0 });
    expect(splitReturnValue(60000, 20000)).toEqual({ applied: 20000, excess: 40000 });
    expect(splitReturnValue(60000, 0)).toEqual({ applied: 0, excess: 60000 });
  });
});

describe('store purchase void — average cost', () => {
  test('is the exact inverse of the purchase weighted average', () => {
    // 100 @ 20 then 100 @ 30 → 25; unwinding the second purchase → 20.
    expect(unwindAverage({ avgAfter: 25, qtyAfter: 200, qty: 100, cost: 30 })).toBe(20);
    expect(unwindAverage({ avgAfter: 30, qtyAfter: 100, qty: 100, cost: 30 })).toBeNull();
  });
});

describe('batch transport accrual', () => {
  test('per-hauler signed deltas between what is accrued and what is owed', () => {
    expect(accrualDeltas({}, { 7: 10000 })).toEqual([{ haulerId: '7', delta: 10000 }]);
    expect(accrualDeltas({ 7: 10000 }, { 7: 10000 })).toEqual([]);
    expect(accrualDeltas({ 7: 10000 }, { 8: 10000 })).toEqual([{ haulerId: '7', delta: -10000 }, { haulerId: '8', delta: 10000 }]);
    expect(accrualDeltas({ 7: 10000 }, {})).toEqual([{ haulerId: '7', delta: -10000 }]);
  });
  test('post-yield adjustment: 1220 takes the change, 1210 what the accrual moved, 2110 the rest — balanced', () => {
    const sum = (parts) => Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const sameHauler = transportAdjustmentParts(-4000, -4000);
    expect(sameHauler).toEqual([{ code: '1220', amount: -4000 }, { code: '1210', amount: 4000 }]);
    const payerSwitch = transportAdjustmentParts(0, -10000);
    expect(payerSwitch).toEqual([{ code: '1210', amount: 10000 }, { code: '2110', amount: -10000 }]);
    expect(sum(transportAdjustmentParts(2500, 1000))).toBe(0);
    expect(sum(payerSwitch)).toBe(0);
  });
});
