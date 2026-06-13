/**
 * Lot costing — weighted-average blend when an additional purchase is added
 * to an existing lot (addPurchaseToLot).
 */
const { blendPurchaseIntoLot } = require('../modules/inventory/lotCosting');

describe('blendPurchaseIntoLot', () => {
  test('weighted-averages landed cost by weight', () => {
    // Lot: 5000 kg @ 100/kg landed (total 500,000)
    const lot = {
      net_weight_kg: 5000,
      total_bags: 100,
      landed_cost_total: 500000,
      purchase_amount: 500000,
      paid_amount: 0,
    };
    // Add: 2500 kg @ 120/kg landed (total 300,000)
    const out = blendPurchaseIntoLot(lot, {
      netKg: 2500, bags: 50, landedTotal: 300000, purchaseAmount: 300000, paid: 0,
    });

    expect(out.newNetKg).toBe(7500);
    expect(out.newBags).toBe(150);
    expect(out.newLandedTotal).toBe(800000);
    // (500000 + 300000) / 7500 = 106.6667
    expect(out.newLandedPerKg).toBeCloseTo(106.6667, 4);
    expect(out.newRatePerKg).toBeCloseTo(106.6667, 4);
    expect(out.newDue).toBe(800000);
    expect(out.newPaymentStatus).toBe('Pending');
  });

  test('blended cost stays between the two purchase prices', () => {
    const lot = { net_weight_kg: 1000, total_bags: 20, landed_cost_total: 90000, purchase_amount: 90000, paid_amount: 0 };
    const out = blendPurchaseIntoLot(lot, { netKg: 9000, bags: 180, landedTotal: 990000, purchaseAmount: 990000, paid: 0 });
    // 90/kg and 110/kg blended 1000:9000 -> heavily weighted to 110
    expect(out.newLandedPerKg).toBeGreaterThan(90);
    expect(out.newLandedPerKg).toBeLessThan(110);
    expect(out.newLandedPerKg).toBeCloseTo(108, 4); // (90000+990000)/10000
  });

  test('accumulates payments and resolves payment status', () => {
    const lot = { net_weight_kg: 5000, total_bags: 100, landed_cost_total: 500000, purchase_amount: 500000, paid_amount: 500000 };
    // add fully paid
    const out = blendPurchaseIntoLot(lot, { netKg: 2500, bags: 50, landedTotal: 300000, purchaseAmount: 300000, paid: 300000 });
    expect(out.newPaid).toBe(800000);
    expect(out.newDue).toBe(0);
    expect(out.newPaymentStatus).toBe('Paid');
  });

  test('partial payment yields Partial status', () => {
    const lot = { net_weight_kg: 5000, total_bags: 100, landed_cost_total: 500000, purchase_amount: 500000, paid_amount: 0 };
    const out = blendPurchaseIntoLot(lot, { netKg: 2500, bags: 50, landedTotal: 300000, purchaseAmount: 300000, paid: 100000 });
    expect(out.newPaid).toBe(100000);
    expect(out.newDue).toBe(700000);
    expect(out.newPaymentStatus).toBe('Partial');
  });

  test('falls back to qty (MT) when net_weight_kg is absent', () => {
    const lot = { qty: 5, total_bags: 100, landed_cost_total: 500000, purchase_amount: 500000, paid_amount: 0 };
    const out = blendPurchaseIntoLot(lot, { netKg: 2500, bags: 50, landedTotal: 300000, purchaseAmount: 300000, paid: 0 });
    expect(out.newNetKg).toBe(7500); // 5 MT -> 5000 kg + 2500
  });
});
