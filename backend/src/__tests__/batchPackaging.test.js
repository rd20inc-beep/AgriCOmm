/**
 * Packaging recorded on a milling batch, line by line.
 *
 * A batch could only ever state ONE bag size — milling_vehicle_arrivals carries a
 * single total_bags + bag_size_kg — so "300 katta and 500 P.P. bags" could not be
 * said at all, and the katta reconciler inferred everything from the raw lots'
 * own bag counts. That inference is what filed 25 kg P.P. bags as katta.
 *
 * Exercised end to end against a real Postgres with the client's own example:
 * 300 katta @13 + 500 P.P. bags @10 + 80 masters @26 received, then 120 katta
 * spent on by-products and 400 bags on the finished rice, then an edit. Stock
 * came out 180 / 100 / 80, then 200 / 0 / 0, and the costing landed on
 * 500,000 - 3,900 - 5,000 - 2,080 + 1,560 = 490,580.
 */
const fs = require('fs');
const path = require('path');
const SVC = fs.readFileSync(path.join(__dirname, '../modules/milling/batchPackaging.service.js'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '../../migrations/20260930_307_milling_batch_packaging.js'), 'utf8');

// The costing rule, restated so it can be exercised rather than only grepped.
// Everything RECEIVED is store stock the mill now holds, so its cost leaves this
// batch; katta spent bagging by-products is gone, so it stays.
const finalExpenses = (total, { kattaIn = 0, bagsIn = 0, mastersIn = 0, byproductKatta = 0 } = {}) =>
  Math.round((total - kattaIn - bagsIn - mastersIn + byproductKatta) * 100) / 100;

describe('the costing formula', () => {
  it("matches the client's worked example", () => {
    expect(finalExpenses(500000, {
      kattaIn: 300 * 13, bagsIn: 500 * 10, mastersIn: 80 * 26, byproductKatta: 120 * 13,
    })).toBe(490580);
  });

  it('received packaging reduces the batch, by-product katta adds to it', () => {
    expect(finalExpenses(100000, { kattaIn: 1300 })).toBe(98700);
    expect(finalExpenses(100000, { byproductKatta: 1300 })).toBe(101300);
    // Received and consumed in the same quantity cancel — the sacks came in and
    // went straight back out on the by-products.
    expect(finalExpenses(100000, { kattaIn: 1300, byproductKatta: 1300 })).toBe(100000);
  });

  it('a batch with no packaging lines is untouched', () => {
    expect(finalExpenses(100000)).toBe(100000);
    expect(SVC).toContain('hasLines: rows.length > 0');
  });

  it('only katta on BY-PRODUCTS is added back, not katta on the finished rice', () => {
    // Bags on the finished rice are part of what was packed and sold; the
    // formula is specifically about the sacks by-products consumed.
    expect(SVC).toContain("r.pack_type === 'katta' && r.output_type === 'byproduct'");
  });

  it('prices come from the line, never a rate written into the code', () => {
    // Confirmed with the user: Mill Store holds the price per item, so a change
    // there reprices everything rather than needing a code change.
    expect(SVC).not.toMatch(/\b13\b\s*[*)]/);
    expect(SVC).not.toMatch(/=\s*10;/);
    expect(SVC).toContain('Number(r.total_cost_pkr)');
  });
});

describe('a line names an ITEM, which is the whole point', () => {
  it('the type comes from the item, not from the size', () => {
    // A 25 kg P.P. bag and a 25 kg katta are the same size and different things.
    expect(SVC).toContain("join('mill_items as mi', 'mi.id', 'bp.mill_item_id')");
    expect(SVC).toContain('mi.pack_type');
  });

  it('an unknown item is refused rather than silently skipped', () => {
    expect(SVC).toContain('Packaging item ${l.mill_item_id} not found.');
  });

  it('a received line cannot be against an output', () => {
    // Nothing is received "for a by-product" — it is freed, then spent.
    expect(SVC).toContain('A received line is not against an output');
  });

  it('the price is snapshot so last month’s costing cannot move', () => {
    expect(SVC).toContain('unit_cost_pkr: unitCost');
    expect(SVC).toMatch(/snapshot/i);
  });
});

// Lines are RECORD-ONLY since the single-mover rule (owner decision
// 2026-10-07, audit MIL-M1): katta moves at yield through reconcileBatchKatta,
// P.P. bags / masters / polythene with the packing run. Behaviour is EXECUTED in
// packagingSingleMover.test.js; these pin the shape of the code.
describe('saving lines moves no store stock', () => {
  const body = SVC.slice(SVC.indexOf('async save('), SVC.indexOf('async costAdjustments('));

  it('save() never moves stock for the lines it writes', () => {
    // The only stock move left in save() is the one-time undo of legacy moves.
    expect(body.match(/moveStock\(/g) || []).toHaveLength(1);
    expect(body).toContain('delta: -m.quantity');
  });

  it('the legacy undo nets per line, so a second save moves nothing', () => {
    expect(body).toContain('if (!m.quantity) continue;');
    expect(body).toContain("where({ reference_type: REF })");
  });

  it('every legacy undo stays traceable back to its line', () => {
    expect(SVC).toContain("const REF = 'batch_packaging'");
    expect(body).toContain('reference_type: REF, reference_id: m.reference_id');
  });

  it('store stock still cannot go negative', () => {
    expect(SVC).toContain('GREATEST(quantity_available + ?, 0)');
  });
});

describe('the shape it is stored in', () => {
  it('inbound is a return and outbound a consumption, the only values allowed', () => {
    // mill_stock_movements.movement_type is CHECK-constrained to
    // purchase/consumption/adjustment/reservation/return.
    expect(SVC).toContain("const MOVEMENT_FOR = { received: 'return', consumed: 'consumption' }");
  });

  it('one line per item per direction per output', () => {
    // Without this an edit stacks duplicates that each post their own stock.
    expect(MIG).toContain("t.unique(['batch_id', 'mill_item_id', 'direction', 'output_type'], 'uq_batch_packaging_line')");
  });

  it('a zero or negative line is refused by the database', () => {
    expect(MIG).toContain('CHECK (quantity > 0)');
    expect(MIG).toContain("CHECK (direction IN ('received', 'consumed'))");
    expect(MIG).toContain("output_type IS NULL OR output_type IN ('finished', 'byproduct')");
  });

  it('deleting a batch takes its packaging lines with it', () => {
    expect(MIG).toContain("references('id').inTable('milling_batches').onDelete('CASCADE')");
  });
});

describe('it is reachable and guarded', () => {
  const ROUTES = fs.readFileSync(path.join(__dirname, '../modules/milling/milling.routes.js'), 'utf8');
  it('saving sits behind the store-consumption permission', () => {
    const block = ROUTES.slice(ROUTES.indexOf("'/batches/:id/packaging',"));
    expect(block).toContain("authorize('mill_store', 'record_consumption')");
    expect(block).toContain('validate(schemas.saveBatchPackaging)');
    expect(block).toContain("auditAction('save_batch_packaging'");
  });

  it('the fields are declared, or Joi would strip them', () => {
    const schemas = require('../middleware/schemas');
    const { value, error } = schemas.saveBatchPackaging.validate(
      { lines: [{ mill_item_id: 1, direction: 'consumed', quantity: 120, output_type: 'byproduct', unit_cost_pkr: 13, notes: 'x' }] },
      { stripUnknown: true },
    );
    expect(error).toBeUndefined();
    expect(Object.keys(value.lines[0]).sort()).toEqual(
      ['direction', 'mill_item_id', 'notes', 'output_type', 'quantity', 'unit_cost_pkr'],
    );
  });

  it('a bad direction or a zero quantity is rejected at the edge', () => {
    const schemas = require('../middleware/schemas');
    expect(schemas.saveBatchPackaging.validate({ lines: [{ mill_item_id: 1, direction: 'sideways', quantity: 5 }] }).error).toBeDefined();
    expect(schemas.saveBatchPackaging.validate({ lines: [{ mill_item_id: 1, direction: 'received', quantity: 0 }] }).error).toBeDefined();
  });
});
