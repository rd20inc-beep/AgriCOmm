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

  test('falls back to qty (KG since mig 228) when net_weight_kg is absent', () => {
    const lot = { qty: 5000, total_bags: 100, landed_cost_total: 500000, purchase_amount: 500000, paid_amount: 0 };
    const out = blendPurchaseIntoLot(lot, { netKg: 2500, bags: 50, landedTotal: 300000, purchaseAmount: 300000, paid: 0 });
    expect(out.newNetKg).toBe(7500); // 5000 kg + 2500 kg — qty is NOT re-multiplied by 1000
    expect(out.newLandedPerKg).toBeCloseTo(106.6667, 4);
  });
});

const { computeLotLanded, repriceLotPurchase, isTransportCapitalised } = require('../modules/inventory/lotCosting');

describe('computeLotLanded — one formula for create and every edit', () => {
  const base = {
    purchaseAmount: 1000000, labor: 5000, unloading: 3000, packing: 0, other: 0,
    bagCost: 2000, transportCost: 40000, commissionTotal: 5000, receivedKg: 10000,
  };

  test('company-paid freight is capitalised; commission always is', () => {
    const r = computeLotLanded({ ...base, transportPaidBy: 'company' });
    expect(r.transportCapitalised).toBe(true);
    expect(r.landedTotal).toBe(1055000);
    expect(r.perKg).toBe(105.5);
    expect(r.supplierGross).toBe(1010000); // rice + extras + bags — no freight, no commission
    expect(r.supplierRicePayable).toBe(1000000);
  });

  test('blank / unknown responsibility defaults to company (the create default)', () => {
    expect(computeLotLanded({ ...base }).landedTotal).toBe(1055000);
    expect(computeLotLanded({ ...base, transportPaidBy: '' }).landedTotal).toBe(1055000);
    expect(isTransportCapitalised(undefined)).toBe(true);
  });

  test.each(['supplier', 'included_in_supplier_rate', 'customer', 'service_client', 'other'])(
    '%s-paid freight stays out of landed cost', (paidBy) => {
      const r = computeLotLanded({ ...base, transportPaidBy: paidBy });
      expect(r.transportCapitalised).toBe(false);
      expect(r.landedTotal).toBe(1015000); // commission still in
      expect(r.supplierRicePayable).toBe(1000000);
    },
  );

  test('freight deducted from the supplier: not capitalised, nets off the rice payable', () => {
    const r = computeLotLanded({ ...base, transportPaidBy: 'deduct_from_supplier' });
    expect(r.landedTotal).toBe(1015000);
    expect(r.supplierGross).toBe(1010000);
    expect(r.supplierRicePayable).toBe(960000);
  });

  test('no commission, no freight → rice + extras + bags', () => {
    const r = computeLotLanded({ ...base, transportCost: 0, commissionTotal: 0 });
    expect(r.landedTotal).toBe(1010000);
  });
});

describe('repriceLotPurchase — a price/qty edit moves the rice only', () => {
  // A lot exactly as createPurchaseLot leaves it.
  const created = computeLotLanded({
    purchaseAmount: 1000000, labor: 5000, unloading: 3000, bagCost: 2000,
    transportCost: 40000, transportPaidBy: 'company', commissionTotal: 5000, receivedKg: 10000,
  });
  const lot = { purchase_amount: 1000000, landed_cost_total: created.landedTotal };
  const ricePayable = { original_amount: created.supplierRicePayable, paid_amount: 0 };

  test('landed keeps freight + commission and equals the full formula at the new price', () => {
    const r = repriceLotPurchase(lot, 1100000, 10000, ricePayable);
    const fresh = computeLotLanded({
      purchaseAmount: 1100000, labor: 5000, unloading: 3000, bagCost: 2000,
      transportCost: 40000, transportPaidBy: 'company', commissionTotal: 5000, receivedKg: 10000,
    });
    expect(r.landedTotal).toBe(fresh.landedTotal);
    expect(r.landedTotal).toBe(1155000);
    expect(r.perKg).toBe(115.5);
  });

  test('rice payable = the new purchase amount; GL delta = the purchase change only', () => {
    const r = repriceLotPurchase(lot, 1100000, 10000, ricePayable);
    expect(r.payable).toEqual({ original_amount: 1100000, outstanding: 1100000, status: 'Pending' });
    expect(r.glDelta).toBe(100000);
  });

  test('a partly paid rice payable keeps its payment', () => {
    const r = repriceLotPurchase(lot, 900000, 9000, { original_amount: 1000000, paid_amount: 400000 });
    expect(r.payable).toEqual({ original_amount: 900000, outstanding: 500000, status: 'Partial' });
    expect(r.glDelta).toBe(-100000);
  });

  test('freight deducted from the supplier stays deducted after a re-price', () => {
    const r = repriceLotPurchase({ purchase_amount: 1000000, landed_cost_total: 1015000 }, 1100000, 10000,
      { original_amount: 960000, paid_amount: 0 });
    expect(r.payable.original_amount).toBe(1060000);
    expect(r.landedTotal).toBe(1115000);
  });

  test('no rice payable → no AP movement and, unless opening stock, no equity movement', () => {
    const r = repriceLotPurchase(lot, 1100000, 10000, null);
    expect(r.glDelta).toBe(0);
    expect(r.equityDelta).toBe(0);
  });

  test('opening stock (no payable) → the purchase change goes to equity, signed', () => {
    const up = repriceLotPurchase(lot, 1100000, 10000, null, { isOpeningStock: true });
    expect(up).toMatchObject({ glDelta: 0, equityDelta: 100000, payable: null, landedTotal: 1155000 });
    expect(repriceLotPurchase(lot, 950000, 10000, null, { isOpeningStock: true }).equityDelta).toBe(-50000);
  });

  test('a rice payable wins over the opening flag — never both', () => {
    const r = repriceLotPurchase(lot, 1100000, 10000, ricePayable, { isOpeningStock: true });
    expect(r.glDelta).toBe(100000);
    expect(r.equityDelta).toBe(0);
  });
});
