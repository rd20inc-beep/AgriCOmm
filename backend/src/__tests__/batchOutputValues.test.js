/**
 * Mill reports read a batch's by-product value from the output lots its yield
 * BOOKED (batchOutputValues), not from kg × the batch's *_price_per_kg columns,
 * so a price edited on the batch after yield can't move the report off the books.
 *
 *   value per lot = qty the batch yielded into it (lot_transactions receipt)
 *                 × the lot's carried landed_cost_per_kg
 *
 * Fixtures are prod M-001 / M-003 as booked at yield (B2, CSR, powder, sweeping).
 */
const {
  batchOutputValues, aggregateOutputRows, byproductLabel,
} = require('../modules/milling/batchOutputValues');

// Rows shaped as the batchOutputValues query returns them (one per lot).
const M001_ROWS = [
  { id: 174, batch_ref: 'batch-1', type: 'finished', grade: null, item_name: 'Blend M-001 — Finished Rice', landed_cost_per_kg: '266.3612', cost_per_unit: '266.3612', yield_kg: '2500.000' },
  { id: 175, batch_ref: 'batch-1', type: 'byproduct', grade: 'B2', item_name: 'D98 — B2', landed_cost_per_kg: '100.0000', cost_per_unit: '100.0000', yield_kg: '550.000' },
  { id: 176, batch_ref: 'batch-1', type: 'byproduct', grade: 'CSR', item_name: 'D98 — CSR', landed_cost_per_kg: '100.0000', cost_per_unit: '100.0000', yield_kg: '200.000' },
  { id: 177, batch_ref: 'batch-1', type: 'byproduct', grade: null, item_name: 'D98 — Powder', landed_cost_per_kg: '50.0000', cost_per_unit: '50.0000', yield_kg: '60.000' },
  { id: 178, batch_ref: 'batch-1', type: 'byproduct', grade: null, item_name: 'D98 — Sweeping', landed_cost_per_kg: '202.0000', cost_per_unit: '202.0000', yield_kg: '500.000' },
];
const M003_ROWS = [
  { id: 180, batch_ref: 'batch-3', type: 'finished', grade: null, item_name: 'Blend M-003 — Finished Rice', landed_cost_per_kg: '319.7636', cost_per_unit: '319.7636', yield_kg: '47700.000' },
  { id: 181, batch_ref: 'batch-3', type: 'byproduct', grade: 'B2', item_name: '1121 STEAM — B2', landed_cost_per_kg: '135.0000', cost_per_unit: '135.0000', yield_kg: '1250.000' },
  { id: 182, batch_ref: 'batch-3', type: 'byproduct', grade: 'CSR', item_name: '1121 STEAM — CSR', landed_cost_per_kg: '150.0000', cost_per_unit: '150.0000', yield_kg: '300.000' },
  { id: 183, batch_ref: 'batch-3', type: 'byproduct', grade: null, item_name: '1121 STEAM — Powder', landed_cost_per_kg: '50.0000', cost_per_unit: '50.0000', yield_kg: '300.000' },
  { id: 184, batch_ref: 'batch-3', type: 'byproduct', grade: null, item_name: '1121 STEAM — Sweeping', landed_cost_per_kg: '300.0000', cost_per_unit: '300.0000', yield_kg: '550.000' },
];

describe('aggregateOutputRows', () => {
  test('M-001 and M-003 by-products equal what the yield booked (179,000 / 393,750)', () => {
    const m = aggregateOutputRows([...M001_ROWS, ...M003_ROWS]);
    expect(m.get(1)).toEqual({
      byproductValue: 179000,
      finishedValue: 665903,
      byproductByGrade: { B2: 55000, CSR: 20000, Powder: 3000, Sweeping: 101000 },
      source: 'yield_lots',
    });
    expect(m.get(3).byproductValue).toBe(393750);
    expect(m.get(3).byproductByGrade).toEqual({ B2: 168750, CSR: 45000, Powder: 15000, Sweeping: 165000 });
  });

  test('values the qty YIELDED into the lot, at the lot\'s carried per-kg', () => {
    // Half the B2 has since been sold (lot.qty is not even read), and the lot
    // was re-costed to 110/kg by a later reallocation.
    const m = aggregateOutputRows([
      { batch_ref: 'batch-9', type: 'byproduct', grade: 'B2', item_name: 'B2', landed_cost_per_kg: '110', cost_per_unit: '110', yield_kg: '550', qty: '275' },
    ]);
    expect(m.get(9).byproductValue).toBe(60500);
  });

  test('a batch with only a finished lot has stored by-products of 0, not a fallback', () => {
    const m = aggregateOutputRows([
      { batch_ref: 'batch-2', type: 'finished', landed_cost_per_kg: '110.7418', yield_kg: '24000' },
    ]);
    expect(m.get(2)).toMatchObject({ byproductValue: 0, source: 'yield_lots' });
  });

  test('falls back to cost_per_unit when landed_cost_per_kg is 0; skips zero-qty rows', () => {
    const m = aggregateOutputRows([
      { batch_ref: 'batch-4', type: 'byproduct', item_name: 'Rice Bran', landed_cost_per_kg: '0', cost_per_unit: '28', yield_kg: '100' },
      { batch_ref: 'batch-5', type: 'byproduct', item_name: 'Rice Husk', landed_cost_per_kg: '8.4', yield_kg: '0' },
    ]);
    expect(m.get(4).byproductValue).toBe(2800);
    expect(m.has(5)).toBe(false);
  });

  test('labels: grade first, else the by-product name after a blend prefix', () => {
    expect(byproductLabel({ grade: 'CSR', item_name: 'Blend M-001 — CSR' })).toBe('CSR');
    expect(byproductLabel({ grade: null, item_name: 'Blend M-004 — Sweeping' })).toBe('Sweeping');
    expect(byproductLabel({ grade: null, item_name: 'Rice Bran' })).toBe('Rice Bran');
  });
});

describe('batchOutputValues', () => {
  // A chainable stand-in that records the query and resolves to `rows`.
  function recordingConn(rows) {
    const calls = { tables: [], whereIn: [], queries: 0 };
    const conn = (table) => {
      calls.queries += 1;
      calls.tables.push(table);
      const q = {
        join(t, fn) { fn.call({ on() { return this; }, andOn() { return this; } }); return q; },
        whereIn(col, vals) { calls.whereIn.push([col, vals]); return q; },
        whereNot() { return q; },
        whereRaw() { return q; },
        groupBy() { return q; },
        select() { return q; },
        then(res, rej) { return Promise.resolve(rows).then(res, rej); },
      };
      return q;
    };
    conn.raw = (sql) => sql;
    return { conn, calls };
  }

  test('one query for many batches, keyed by batch id', async () => {
    const { conn, calls } = recordingConn([...M001_ROWS, ...M003_ROWS]);
    const m = await batchOutputValues(conn, [1, 3, 7, 1]);
    expect(calls.queries).toBe(1);
    expect(calls.tables).toEqual(['inventory_lots as l']);
    expect(calls.whereIn).toContainEqual(['l.batch_ref', ['batch-1', 'batch-3', 'batch-7']]);
    expect(calls.whereIn).toContainEqual(['t.transaction_type', ['milling_receipt', 'byproduct_receipt']]);
    expect(m.get(1).byproductValue).toBe(179000);
    expect(m.get(3).byproductValue).toBe(393750);
    expect(m.has(7)).toBe(false); // no stored output → caller falls back
  });

  test('no ids → no query', async () => {
    const { conn, calls } = recordingConn([]);
    const m = await batchOutputValues(conn, []);
    expect(m.size).toBe(0);
    expect(calls.queries).toBe(0);
  });
});
