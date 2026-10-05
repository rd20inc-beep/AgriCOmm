/**
 * Milling source-lot reservations and batch teardown.
 *
 *  - Start Milling on a lot (startMillingForLot) flagged the lot 'In Milling'
 *    but never reserved the qty, so the rice could still be sold; yield then
 *    consumed what was left and recorded the full output → phantom stock.
 *  - consumeForMilling silently consumed min(want, available).
 *  - Deleting a truck after yield was not guarded (add/edit were).
 *  - Deleting a batch left its transporter payable (paid or not) behind.
 *
 * These run the real code against a small in-memory stand-in for knex.
 */

const state = { tables: {}, updates: [], nextId: 1000 };

function builder(conn, table) {
  const filters = [];
  let op = null;
  let payload = null;
  let terminal = 'rows';
  let sumCol = null;
  const matches = (row) => filters.every((f) => f(row));
  const qb = {
    where(a, b, c) {
      if (typeof a === 'function') { return qb; }
      if (typeof a === 'object') filters.push((r) => Object.entries(a).every(([k, v]) => r[k] === v));
      else if (c !== undefined) filters.push(() => true); // operator form — not needed here
      else filters.push((r) => r[a] === b);
      return qb;
    },
    whereIn(col, vals) { filters.push((r) => vals.includes(r[col])); return qb; },
    whereNull(col) { filters.push((r) => r[col] == null); return qb; },
    forUpdate() { conn.locks.push(table); return qb; },
    select() { return qb; },
    join() { return qb; },
    orderBy() { return qb; },
    insert(row) { op = 'insert'; payload = row; return qb; },
    onConflict() { return qb; },
    merge() { return qb; },
    count() { terminal = 'count'; return qb; },
    sum(expr) { terminal = 'sum'; sumCol = String(expr).split(' as ')[0]; return qb; },
    first() { if (terminal === 'rows') terminal = 'first'; return qb; },
    update(u) { op = 'update'; payload = u; return qb; },
    returning() { return qb; },
    del() { op = 'del'; return qb; },
    then(res, rej) {
      try {
        const rows = (state.tables[table] = state.tables[table] || []);
        if (op === 'update') {
          const hit = rows.filter(matches);
          for (const r of hit) {
            state.updates.push({ table, id: r.id, set: { ...payload } });
            Object.assign(r, payload);
          }
          return Promise.resolve(hit).then(res, rej);
        }
        if (op === 'insert') {
          const list = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: state.nextId++, ...p }));
          rows.push(...list);
          return Promise.resolve(list).then(res, rej);
        }
        if (op === 'del') {
          state.tables[table] = rows.filter((r) => !matches(r));
          return Promise.resolve(rows.length - state.tables[table].length).then(res, rej);
        }
        const hit = rows.filter(matches);
        if (terminal === 'count') return Promise.resolve({ c: hit.length, n: hit.length }).then(res, rej);
        if (terminal === 'sum') {
          const total = hit.reduce((s, r) => s + (parseFloat(r[sumCol]) || 0), 0);
          return Promise.resolve({ total }).then(res, rej);
        }
        if (terminal === 'first') return Promise.resolve(hit[0]).then(res, rej);
        return Promise.resolve(hit).then(res, rej);
      } catch (e) { return Promise.reject(e).then(res, rej); }
    },
  };
  return qb;
}

function makeConn() {
  const conn = (table) => builder(conn, table.split(' as ')[0]);
  conn.locks = [];
  conn.fn = { now: () => 'now()' };
  conn.raw = () => ({ __raw: true });
  conn.transaction = async (cb) => cb(conn);
  conn.schema = { hasTable: async () => false };
  return conn;
}

const mockDb = makeConn();
jest.mock('../config/database', () => mockDb);
jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async () => 'M-101') }));
jest.mock('../services/inventoryService', () => ({
  consumeForMilling: jest.fn(async () => []),
  resyncBatchOutputsFromBatch: jest.fn(),
  receiveRice: jest.fn(),
  postMovement: jest.fn(),
  recomputeRawRiceCostFromVehicles: jest.fn(),
  MOVEMENT_TYPES: { ADJUSTMENT_MINUS: 'adjustment_minus' },
}));
jest.mock('../services/accountingService', () => ({
  autoPost: jest.fn(), createJournal: jest.fn(), postJournal: jest.fn(),
}));
jest.mock('../services/automationService', () => ({ onBatchCompleted: jest.fn() }));
jest.mock('../services/exportOrderWorkflowService', () => ({}));
jest.mock('../services/notificationService', () => ({}));
jest.mock('../services/exportOrderEventBus', () => ({ publishExportOrderUpdate: jest.fn() }));

const lifecycle = require('../modules/milling/batchLifecycle');
const millingController = require('../modules/milling/milling.controller');
const lotController = require('../modules/inventory/lotInventory.controller');
const realInventory = require('../modules/inventory/inventory.service');
const accountingService = require('../services/accountingService');

function resMock() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function seed(tables) {
  state.tables = JSON.parse(JSON.stringify(tables));
  state.updates = [];
  mockDb.locks = [];
  jest.clearAllMocks();
}

const lot = (id) => state.tables.inventory_lots.find((l) => l.id === id);

describe('startMillingForLot reserves the committed qty', () => {
  test('reserves exactly the qty milled, like the New Batch drawer', async () => {
    seed({
      inventory_lots: [{ id: 5, lot_no: 'LOT-5', type: 'raw', entity: 'mill', qty: '10000', reserved_qty: '0', milling_reserved_qty: '0', available_qty: '10000' }],
      mills: [{ id: 1, status: 'Active' }],
    });
    const res = resMock();
    await lotController.startMillingForLot({ params: { id: '5' }, body: { raw_qty_kg: 4000 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(201);
    expect(lot(5)).toMatchObject({ milling_status: 'In Milling', milling_reserved_qty: 4000, available_qty: 6000 });
    const [src] = state.tables.batch_source_lots;
    expect(src).toMatchObject({ lot_id: 5, qty_kg: 4000, lot_type: 'raw' });
    expect(lifecycle.isReservedSource(src)).toBe(true);
    expect(mockDb.locks).toContain('inventory_lots');
  });

  test('a second batch on the same lot can only take what is left', async () => {
    seed({
      inventory_lots: [{ id: 5, lot_no: 'LOT-5', type: 'raw', qty: '10000', reserved_qty: '1000', milling_reserved_qty: '4000', available_qty: '5000' }],
      mills: [{ id: 1, status: 'Active' }],
    });
    const res = resMock();
    await lotController.startMillingForLot({ params: { id: '5' }, body: { raw_qty_kg: 6000 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(400);
    expect(lot(5).milling_reserved_qty).toBe('4000');
  });

  test('releaseBatchSources gives back what that batch reserved, not another batch’s hold', async () => {
    seed({
      batch_source_lots: [
        { id: 1, batch_id: 3, lot_id: 30, qty_kg: '400', lot_type: 'raw' },
        // Legacy lot-first row: reserved nothing.
        { id: 2, batch_id: 4, lot_id: 30, qty_kg: '300' },
      ],
      inventory_lots: [{ id: 30, qty: '1000', reserved_qty: '0', milling_reserved_qty: '400', available_qty: '600', milling_status: 'In Milling' }],
    });
    await lifecycle.releaseBatchSources(mockDb, 4);
    expect(lot(30)).toMatchObject({ milling_reserved_qty: 400, available_qty: 600, milling_status: 'In Milling' });
    await lifecycle.releaseBatchSources(mockDb, 3);
    expect(lot(30)).toMatchObject({ milling_reserved_qty: 0, available_qty: 1000, milling_status: null });
  });
});

describe('consumeForMilling', () => {
  afterEach(() => jest.restoreAllMocks());

  test('consumes exactly the reserved qty', async () => {
    seed({
      batch_source_lots: [{ id: 1, batch_id: 7, lot_id: 70, qty_kg: '400', lot_type: 'raw' }],
      inventory_lots: [{ id: 70, lot_no: 'LOT-70', qty: '1000', reserved_qty: '0', milling_reserved_qty: '400', available_qty: '600', milling_status: 'In Milling' }],
    });
    jest.spyOn(realInventory, 'postMovement').mockResolvedValue({ id: 1 });
    await realInventory.consumeForMilling(mockDb, { batchId: 7, userId: 1 });
    expect(realInventory.postMovement).toHaveBeenCalledWith(mockDb, expect.objectContaining({ lotId: 70, qty: 400 }));
    expect(lot(70).milling_reserved_qty).toBe(0);
  });

  test('throws 400 with the lot and shortfall when the lot no longer holds the qty', async () => {
    seed({
      batch_source_lots: [{ id: 1, batch_id: 7, lot_id: 70, qty_kg: '4000', lot_type: 'raw' }],
      // Only 2,500 kg physically left (the rest was sold).
      inventory_lots: [{ id: 70, lot_no: 'LOT-70', qty: '2500', reserved_qty: '0', milling_reserved_qty: '4000', available_qty: '0', milling_status: 'In Milling' }],
    });
    jest.spyOn(realInventory, 'postMovement').mockResolvedValue({ id: 1 });
    await expect(realInventory.consumeForMilling(mockDb, { batchId: 7, userId: 1 }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/LOT-70 is short by 1,500 kg/) });
    expect(realInventory.postMovement).not.toHaveBeenCalled();
  });

  test('tolerates under 1 kg of scale rounding', async () => {
    seed({
      batch_source_lots: [{ id: 1, batch_id: 7, lot_id: 70, qty_kg: '1000.5', lot_type: 'raw' }],
      inventory_lots: [{ id: 70, lot_no: 'LOT-70', qty: '1000', reserved_qty: '0', milling_reserved_qty: '1000.5', available_qty: '0', milling_status: 'In Milling' }],
    });
    jest.spyOn(realInventory, 'postMovement').mockResolvedValue({ id: 1 });
    await realInventory.consumeForMilling(mockDb, { batchId: 7, userId: 1 });
    expect(realInventory.postMovement).toHaveBeenCalledWith(mockDb, expect.objectContaining({ qty: 1000 }));
  });

  test('a legacy unreserved row does not take another batch’s hold', async () => {
    seed({
      batch_source_lots: [{ id: 1, batch_id: 8, lot_id: 70, qty_kg: '700' }],
      // 1000 kg, 400 held by another batch → only 600 is this batch's to take.
      inventory_lots: [{ id: 70, lot_no: 'LOT-70', qty: '1000', reserved_qty: '0', milling_reserved_qty: '400', available_qty: '600', milling_status: 'In Milling' }],
    });
    jest.spyOn(realInventory, 'postMovement').mockResolvedValue({ id: 1 });
    await expect(realInventory.consumeForMilling(mockDb, { batchId: 8, userId: 1 }))
      .rejects.toMatchObject({ status: 400 });
    expect(lot(70).milling_reserved_qty).toBe('400');
  });

  test('the single raw-lot path refuses a shortfall too', async () => {
    seed({
      batch_source_lots: [],
      inventory_lots: [{ id: 71, lot_no: 'M-009-RAW', batch_ref: 'batch-9', type: 'raw', entity: 'mill', qty: '500', available_qty: '500' }],
    });
    jest.spyOn(realInventory, 'postMovement').mockResolvedValue({ id: 1 });
    await expect(realInventory.consumeForMilling(mockDb, { batchId: 9, qtyKg: 2000, userId: 1 }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/short by 1,500 kg/) });
  });
});

describe('deleteVehicle after yield', () => {
  test('is refused with 409 once output lots exist', async () => {
    seed({
      milling_batches: [{ id: 12, batch_no: 'M-012', status: 'Queued' }],
      milling_vehicle_arrivals: [{ id: 120, batch_id: 12, vehicle_no: 'LES-1', weight_kg: '5000' }],
      inventory_lots: [{ id: 121, batch_ref: 'batch-12', type: 'finished' }],
    });
    const res = resMock();
    await millingController.deleteVehicle({ params: { id: '12', vehicleId: '120' }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
    expect(state.tables.milling_vehicle_arrivals).toHaveLength(1);
    expect(state.updates).toEqual([]);
  });

  test('is refused with 409 on a Completed batch', async () => {
    seed({
      milling_batches: [{ id: 12, batch_no: 'M-012', status: 'Completed' }],
      milling_vehicle_arrivals: [{ id: 120, batch_id: 12, vehicle_no: 'LES-1', weight_kg: '5000' }],
    });
    const res = resMock();
    await millingController.deleteVehicle({ params: { id: '12', vehicleId: '120' }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
  });
});

describe('deleteBatch', () => {
  test('refuses (409) while the transport payable has payments', async () => {
    seed({
      milling_batches: [{ id: 14, batch_no: 'M-014', status: 'Queued' }],
      payables: [{ id: 50, pay_no: 'PAY-0050', source_table: 'batch_transport', source_id: 14, paid_amount: '20000', original_amount: '30000', outstanding: '10000', status: 'Partial' }],
      batch_source_lots: [{ id: 1, batch_id: 14, lot_id: 140, qty_kg: '400', lot_type: 'raw' }],
      inventory_lots: [{ id: 140, qty: '1000', reserved_qty: '0', milling_reserved_qty: '400', available_qty: '600', milling_status: 'In Milling' }],
    });
    const res = resMock();
    await millingController.deleteBatch({ params: { id: '14' }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/reverse the transporter payment first/);
    expect(state.tables.milling_batches).toHaveLength(1);
    expect(state.updates).toEqual([]);
    expect(accountingService.createJournal).not.toHaveBeenCalled();
  });

  test('voids an unpaid transport payable, reverses its accrual and releases the lots', async () => {
    seed({
      milling_batches: [{ id: 17, batch_no: 'M-017', status: 'Queued' }],
      payables: [{ id: 51, pay_no: 'PAY-0051', source_table: 'batch_transport', source_id: 17, hauler_id: 3, paid_amount: '0', original_amount: '30000', outstanding: '30000', status: 'Pending' }],
      transport_costs: [{ id: 9, batch_id: 17, payable_id: 51, status: 'unpaid' }],
      chart_of_accounts: [{ id: 11, code: '1210', name: 'Raw Rice Stock' }, { id: 12, code: '2010', name: 'Payables' }],
      // The posted accrual's net on 1210 (what the join + SUM returns).
      journal_lines: [{ 'je.ref_type': 'Batch Transport', 'je.ref_no': 'M-017', 'je.status': 'Posted', 'jl.account_id': 11, net: '30000' }],
      batch_source_lots: [{ id: 1, batch_id: 17, lot_id: 170, qty_kg: '400', lot_type: 'raw' }],
      inventory_lots: [{ id: 170, qty: '1000', reserved_qty: '0', milling_reserved_qty: '400', available_qty: '600', milling_status: 'In Milling' }],
    });
    accountingService.createJournal.mockResolvedValue({ id: 900 });
    const res = resMock();
    await millingController.deleteBatch({ params: { id: '17' }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);
    expect(state.tables.payables[0]).toMatchObject({ status: 'Written Off', outstanding: 0 });
    expect(state.tables.transport_costs[0].status).toBe('cancelled');
    const je = accountingService.createJournal.mock.calls[0][1];
    expect(je).toMatchObject({ refType: 'Batch Transport', refNo: 'M-017', partyType: 'hauler', partyId: 3 });
    // Signed delta: Dr 2010 / Cr 1210 for the accrued 30,000.
    expect(je.lines).toEqual([
      expect.objectContaining({ account_id: 12, debit: 30000, credit: 0 }),
      expect.objectContaining({ account_id: 11, debit: 0, credit: 30000 }),
    ]);
    expect(accountingService.postJournal).toHaveBeenCalledWith(mockDb, 900);
    expect(lot(170)).toMatchObject({ milling_reserved_qty: 0, available_qty: 1000, milling_status: null });
    expect(state.tables.milling_batches).toHaveLength(0);
  });

  test('refuses (409) a service batch that has invoices', async () => {
    seed({
      milling_batches: [{ id: 15, batch_no: 'M-015', status: 'Queued', is_service_milling: true }],
      service_milling_invoices: [{ id: 1, service_batch_id: 15 }],
      service_milling_dispatches: [],
    });
    const res = resMock();
    await millingController.deleteBatch({ params: { id: '15' }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/1 service invoice/);
    expect(state.tables.milling_batches).toHaveLength(1);
  });

  test('refuses (409) a batch that already has output lots', async () => {
    seed({
      milling_batches: [{ id: 16, batch_no: 'M-016', status: 'Queued' }],
      inventory_lots: [{ id: 160, batch_ref: 'batch-16', type: 'byproduct' }],
    });
    const res = resMock();
    await millingController.deleteBatch({ params: { id: '16' }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
  });
});

describe('dead route', () => {
  test('POST /batches/:id/source-lots is gone (GET stays)', () => {
    const router = require('../modules/milling/milling.routes');
    const layers = router.stack.filter((l) => l.route && l.route.path === '/batches/:id/source-lots');
    expect(layers.some((l) => l.route.methods.get)).toBe(true);
    expect(layers.some((l) => l.route.methods.post)).toBe(false);
  });
});
