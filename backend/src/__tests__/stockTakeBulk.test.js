/**
 * INV-34 / P5-10: bulk stock-take entry. One Save records many lines through
 * the same recordCountItem as a single save, inside one transaction — a bad
 * line saves nothing and is named.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex());
jest.mock('../modules/admin/audit.service', () => ({ log: jest.fn(async () => {}) }));
jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async () => 'SC-001') }));
jest.mock('../utils/warehouseScope', () => ({}));

const db = require('../config/database');
const controlService = require('../modules/analytics/control.service');
const controller = require('../modules/analytics/control.controller');

// The fake connection has no rollback; give it one (snapshot + restore) so
// all-or-nothing is actually exercised.
db.transaction = async (cb) => {
  const snap = JSON.parse(JSON.stringify(db.tables));
  try {
    return await cb(db);
  } catch (err) {
    Object.keys(snap).forEach((k) => { db.tables[k] = snap[k]; });
    throw err;
  }
};

const lot = (id, qty) => ({ id, lot_no: `L-${id}`, item_name: `Rice ${id}`, qty, entity: 'mill', ownership: 'company', landed_cost_per_kg: 100 });

async function newCount(lots) {
  db.tables.inventory_lots = lots;
  db.tables.stock_counts = [];
  db.tables.stock_count_items = [];
  return controlService.createStockCount(db, { countType: 'full', userId: 5 });
}

function call(id, body) {
  const out = {};
  const res = {
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; out.status = out.status || 200; return res; },
  };
  return controller.recordCountItemsBulk({ params: { id: String(id) }, body, user: { id: 5 } }, res).then(() => out);
}

const itemId = (count, lotId) => count.items.find((i) => i.lot_id === lotId).id;
const row = (id) => db.tables.stock_count_items.find((i) => i.id === id);

describe('bulk stock-take save', () => {
  test('records every line in one request, with the same variance maths', async () => {
    const count = await newCount([lot(1, 1000), lot(2, 500), lot(3, 250)]);
    const out = await call(count.id, { lines: [
      { item_id: itemId(count, 1), counted_qty: 990 },
      { item_id: itemId(count, 2), counted_qty: 500 },
      { item_id: itemId(count, 3), counted_qty: 260 },
    ] });
    expect(out.status).toBe(200);
    expect(out.body.data).toHaveLength(3);
    expect(row(itemId(count, 1))).toMatchObject({ status: 'Counted', counted_qty: 990, variance_qty: -10 });
    expect(row(itemId(count, 2))).toMatchObject({ status: 'Counted', variance_qty: 0 });
    expect(row(itemId(count, 3))).toMatchObject({ status: 'Counted', variance_qty: 10 });
  });

  test('one invalid line (negative kg) saves nothing and names the line', async () => {
    const count = await newCount([lot(1, 1000), lot(2, 500)]);
    const bad = itemId(count, 2);
    const out = await call(count.id, { lines: [
      { item_id: itemId(count, 1), counted_qty: 990 },
      { item_id: bad, counted_qty: -5 },
    ] });
    expect(out.status).toBe(400);
    expect(out.body.message).toMatch(new RegExp(`line ${bad}`));
    expect(out.body.message).toMatch(/Nothing was saved/);
    expect(row(itemId(count, 1)).status).toBe('Pending');
  });

  test('an empty save and a repeated line are refused', async () => {
    const count = await newCount([lot(1, 1000)]);
    expect((await call(count.id, { lines: [] })).status).toBe(400);
    const id = itemId(count, 1);
    const dup = await call(count.id, { lines: [{ item_id: id, counted_qty: 1 }, { item_id: id, counted_qty: 2 }] });
    expect(dup.status).toBe(400);
    expect(dup.body.message).toMatch(/twice/);
  });

  test('a completed count refuses the bulk save like the single one', async () => {
    const count = await newCount([lot(1, 1000)]);
    db.tables.stock_counts[0].status = 'Completed';
    const out = await call(count.id, { lines: [{ item_id: itemId(count, 1), counted_qty: 1000 }] });
    expect(out.status).toBe(400);
    expect(out.body.message).toMatch(/already completed/);
  });
});
