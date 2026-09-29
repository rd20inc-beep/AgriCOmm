/**
 * Freight in AR.
 *
 * Freight charged BESIDE an FOB price is money the buyer owes. Before this, AR
 * carried only the contract value, so the wire came in bigger than the
 * receivable and read as an overpayment.
 *
 * The trap this file exists to hold shut: a CFR/CIF order priced 'in_price'
 * already has its freight inside price_per_mt, and therefore inside
 * contract_value, AR, the revenue journal and the statement. Adding it again
 * would bill the buyer twice for the same freight.
 */
const fs = require('fs');
const path = require('path');
const { billableFreight, balanceExpectedFor, freightChanges } = require('../modules/exportOrders/billableFreight');

const CFR = { freight_per_mt: 58, insurance_per_mt: 4.5, qty_mt: 24 };

describe('only a separately charged freight is receivable', () => {
  it('in_price adds nothing — it is already inside the contract value', () => {
    expect(billableFreight({ ...CFR, freight_display: 'in_price' })).toBe(0);
  });

  it('a missing display defaults to in_price, so an old order adds nothing', () => {
    expect(billableFreight({ ...CFR })).toBe(0);
    expect(billableFreight({ ...CFR, freight_display: null })).toBe(0);
  });

  it('separate charges freight plus insurance across the quantity', () => {
    // (58.00 + 4.50) x 24 MT
    expect(billableFreight({ ...CFR, freight_display: 'separate' })).toBe(1500);
  });

  it('an order with no freight figure is untouched', () => {
    expect(billableFreight({ freight_display: 'separate', qty_mt: 24 })).toBe(0);
    expect(billableFreight({ freight_display: 'separate', freight_per_mt: 0, qty_mt: 24 })).toBe(0);
    expect(billableFreight(null)).toBe(0);
  });

  it('is rounded to the paisa, never left as dust in AR', () => {
    // 58.33 x 24.375 = 1,421.79375 — a figure that would otherwise sit in the
    // receivable forever as an unclearable fraction.
    const v = billableFreight({ freight_display: 'separate', freight_per_mt: 58.33, qty_mt: 24.375 });
    expect(v).toBe(1421.79);
    expect(Number.isInteger(v * 100)).toBe(true);
  });

  it('never goes negative', () => {
    expect(billableFreight({ freight_display: 'separate', freight_per_mt: -100, qty_mt: 24 })).toBe(0);
  });
});

describe('the balance carries it, the advance does not', () => {
  const contractValue = 18240;      // 760.00 x 24 FOB
  const advanceExpected = 3648;     // 20%

  it('separate: the buyer owes the balance plus the freight', () => {
    const bal = balanceExpectedFor({ contractValue, advanceExpected, order: { ...CFR, freight_display: 'separate' } });
    expect(bal).toBe(18240 - 3648 + 1500);
    // The whole point: contract + freight is what arrives in the bank.
    expect(advanceExpected + bal).toBe(contractValue + 1500);
  });

  it('in_price: unchanged, because the contract value already includes it', () => {
    const bal = balanceExpectedFor({ contractValue: 19740, advanceExpected: 3948, order: { ...CFR, freight_display: 'in_price' } });
    expect(bal).toBe(19740 - 3948);
    expect(3948 + bal).toBe(19740);
  });

  it('both presentations leave the customer owing the same money', () => {
    const sep = 3648 + balanceExpectedFor({ contractValue: 18240, advanceExpected: 3648, order: { ...CFR, freight_display: 'separate' } });
    const inc = 3948 + balanceExpectedFor({ contractValue: 19740, advanceExpected: 3948, order: { ...CFR, freight_display: 'in_price' } });
    expect(sep).toBe(19740);
    expect(inc).toBe(19740);
  });

  it('an order with no freight is byte-for-byte what it always was', () => {
    expect(balanceExpectedFor({ contractValue, advanceExpected, order: {} })).toBe(contractValue - advanceExpected);
  });
});

describe('changing the freight is a change to what the buyer owes', () => {
  const existing = { freight_display: 'separate', freight_per_mt: 58, insurance_per_mt: 4.5 };

  it.each([
    ['the rate', { freight_per_mt: 70 }],
    ['the insurance', { insurance_per_mt: 6 }],
    ['the presentation', { freight_display: 'in_price' }],
  ])('%s counts as a contract change', (_label, upd) => {
    expect(freightChanges(upd, existing)).toBe(true);
  });

  it('re-sending the same values does not', () => {
    expect(freightChanges({ freight_per_mt: 58, insurance_per_mt: 4.5 }, existing)).toBe(false);
    expect(freightChanges({}, existing)).toBe(false);
  });

  it('an unrelated edit does not lock the order', () => {
    expect(freightChanges({ notes: 'call the buyer' }, existing)).toBe(false);
  });
});

// The wiring itself: grep-level, so a refactor that drops one of these sites is
// caught. The arithmetic above is the part that has to be right.
describe('every place that sets the balance goes through the one rule', () => {
  const ctrl = fs.readFileSync(path.join(__dirname, '../modules/exportOrders/exportOrders.controller.js'), 'utf8');
  const wf = fs.readFileSync(path.join(__dirname, '../modules/exportOrders/exportOrders.workflow.js'), 'utf8');

  it('nothing computes the balance by hand any more', () => {
    expect(ctrl).not.toMatch(/balance_expected\s*=\s*contractValue\s*-/);
    expect(ctrl).not.toMatch(/balanceExpected\s*=\s*contractValue\s*-\s*advanceExpected/);
  });

  it('create, update and the packing re-price all call it', () => {
    const calls = ctrl.match(/balanceExpectedFor\(/g) || [];
    expect(calls.length).toBe(3);
  });

  it('a freight edit is guarded like a price edit', () => {
    expect(ctrl).toContain('freightChanges(safeUpdates, existing)');
  });

  it('shipment credits 4070, never 4010', () => {
    expect(wf).toContain("code: '4070'");
    const block = wf.slice(wf.indexOf('const freightForeign'), wf.indexOf('const cogsPkr'));
    expect(block).toContain("code: '1110'");
    expect(block).not.toContain("'4010'");
  });

  it('it posts inside the revenue_posted guard, so it cannot post twice', () => {
    const guard = wf.indexOf('if (!order.revenue_posted)');
    const posted = wf.indexOf("update({ revenue_posted: true })");
    const freight = wf.indexOf('const freightForeign');
    expect(freight).toBeGreaterThan(guard);
    expect(freight).toBeLessThan(posted);
  });
});
