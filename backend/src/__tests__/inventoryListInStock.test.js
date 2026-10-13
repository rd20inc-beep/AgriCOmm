/**
 * GET /inventory?in_stock=1 — the New Batch lot picker asks only for lots with
 * free qty, so older mill stock (opening lots) is not pushed off the list by
 * the newest-500 page limit of every lot ever created.
 */
jest.mock('../config/database', () => require('./helpers/recordingKnex')());
jest.mock('../utils/warehouseScope', () => ({
  resolveWarehouseScope: async () => null,
  applyWarehouseScope: (q) => q,
}));

const db = require('../config/database');
const controller = require('../modules/inventory/inventory.controller');

const run = async (query) => {
  db.__set({ inventory_lots: (q) => (q.terminal === 'first' ? { total: '0' } : []) });
  const res = { json: jest.fn(), status: jest.fn(() => res) };
  await controller.listLots({ query, user: { id: 1 } }, res);
  return db.__calls.find((c) => c.table === 'inventory_lots').wheres;
};

describe('inventory list in_stock filter', () => {
  test('in_stock=1 keeps only lots with free qty', async () => {
    const wheres = await run({ entity: 'mill', in_stock: '1', limit: '5000' });
    expect(wheres).toContainEqual(['il.available_qty', '>', 0]);
    expect(wheres).toContainEqual(['il.entity', 'mill']);
  });

  test('without it, empty lots are still listed', async () => {
    const wheres = await run({ entity: 'mill' });
    expect(wheres).not.toContainEqual(['il.available_qty', '>', 0]);
  });
});
