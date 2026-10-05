/**
 * Milling batch status guards.
 *
 *  - PUT /batches/:id (milling.edit, held by Mill Operator) accepted `status`,
 *    so anyone could complete a batch without yield or reopen one.
 *  - recordYield had no status guard and chose re-yield by status==='Completed':
 *    a second save on an On Hold / Cancelled batch took the first-yield path
 *    again and re-posted production output + the milling_completion journal.
 *  - Cancelling a batch left its source lots hard-reserved forever.
 *
 * These run the real code against a small in-memory stand-in for knex.
 */

// ── A tiny knex stand-in: tables are arrays of rows; where/whereIn filter,
// update/insert mutate, count/first/sum terminate. Every update is logged.
const state = { tables: {}, updates: [] };

function builder(conn, table) {
  const filters = [];
  let op = null;
  let payload = null;
  let terminal = 'rows';
  const matches = (row) => filters.every((f) => f(row));
  const resolveRaw = (v, row, key) => (v && v.__raw ? v.__raw(row, key) : v);
  const qb = {
    where(a, b) {
      if (typeof a === 'object') filters.push((r) => Object.entries(a).every(([k, v]) => r[k] === v));
      else filters.push((r) => r[a] === b);
      return qb;
    },
    whereIn(col, vals) { filters.push((r) => vals.includes(r[col])); return qb; },
    forUpdate() { conn.locks.push(table); return qb; },
    select() { return qb; },
    join() { return qb; },
    insert(row) { op = 'insert'; payload = row; return qb; },
    orderBy() { return qb; },
    count() { terminal = 'count'; return qb; },
    first() { terminal = terminal === 'count' ? 'count' : 'first'; return qb; },
    update(u) { op = 'update'; payload = u; return qb; },
    returning() { return qb; },
    del() { op = 'del'; return qb; },
    then(res, rej) {
      try {
        const rows = (state.tables[table] = state.tables[table] || []);
        if (op === 'update') {
          const hit = rows.filter(matches);
          for (const r of hit) {
            const resolved = {};
            for (const [k, v] of Object.entries(payload)) resolved[k] = resolveRaw(v, r, k);
            state.updates.push({ table, id: r.id, set: resolved });
            Object.assign(r, resolved);
          }
          return Promise.resolve(hit).then(res, rej);
        }
        if (op === 'insert') {
          rows.push(payload);
          return Promise.resolve([payload]).then(res, rej);
        }
        if (op === 'del') {
          state.tables[table] = rows.filter((r) => !matches(r));
          return Promise.resolve(rows.length - state.tables[table].length).then(res, rej);
        }
        const hit = rows.filter(matches);
        if (terminal === 'count') return Promise.resolve({ c: hit.length }).then(res, rej);
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
  conn.raw = () => ({ __raw: () => null });
  conn.transaction = async (cb) => cb(conn);
  return conn;
}

const mockDb = makeConn();
jest.mock('../config/database', () => mockDb);
jest.mock('../services/inventoryService', () => ({
  consumeForMilling: jest.fn(async () => []),
  resyncBatchOutputsFromBatch: jest.fn(async () => ({ resynced: true })),
  receiveRice: jest.fn(),
}));
jest.mock('../services/accountingService', () => ({ autoPost: jest.fn() }));
jest.mock('../services/automationService', () => ({ onBatchCompleted: jest.fn() }));
jest.mock('../services/exportOrderWorkflowService', () => ({}));
jest.mock('../services/notificationService', () => ({}));
jest.mock('../services/exportOrderEventBus', () => ({ publishExportOrderUpdate: jest.fn() }));

const lifecycle = require('../modules/milling/batchLifecycle');
const controller = require('../modules/milling/milling.controller');
const inventoryService = require('../services/inventoryService');
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

describe('yieldMode', () => {
  test.each(['On Hold', 'Cancelled', 'Rejected'])('refuses %s', (status) => {
    expect(lifecycle.yieldMode({ status, hasOutputs: false })).toBe('refuse');
    expect(lifecycle.yieldMode({ status, hasOutputs: true })).toBe('refuse');
  });

  test.each(['Queued', 'In Progress', 'Pending Approval', 'Completed'])('accepts %s', (status) => {
    expect(lifecycle.yieldMode({ status, hasOutputs: false })).toBe('first');
  });

  test('re-yield is decided by outputs existing, not by status', () => {
    expect(lifecycle.yieldMode({ status: 'Queued', hasOutputs: true })).toBe('reyield');
    expect(lifecycle.yieldMode({ status: 'Completed', hasOutputs: true })).toBe('reyield');
    expect(lifecycle.yieldMode({ status: 'Completed', hasOutputs: false })).toBe('first');
  });
});

describe('the generic batch edit ignores status', () => {
  test('pickBatchEdits drops status and unknown keys', () => {
    const out = lifecycle.pickBatchEdits({ status: 'Completed', notes: 'n', batch_name: 'B', id: 9, completed_at: 'x' });
    expect(out).toEqual({ notes: 'n', batch_name: 'B' });
    expect(lifecycle.EDITABLE_BATCH_FIELDS).not.toContain('status');
  });

  test('PUT /batches/:id writes no status to the row', async () => {
    seed({ milling_batches: [{ id: 5, batch_no: 'M-005', status: 'Queued' }] });
    const router = require('../modules/milling/milling.routes');
    const layer = router.stack.find((l) => l.route && l.route.path === '/batches/:id' && l.route.methods.put);
    const handlers = layer.route.stack.map((s) => s.handle);
    // Only one PUT /batches/:id remains (the unreachable raw-body one is gone).
    expect(router.stack.filter((l) => l.route && l.route.path === '/batches/:id' && l.route.methods.put)).toHaveLength(1);
    const res = resMock();
    await handlers[handlers.length - 1]({ params: { id: '5' }, body: { status: 'Completed', notes: 'hello' } }, res);
    expect(res.statusCode).toBe(200);
    expect(state.tables.milling_batches[0].status).toBe('Queued');
    expect(state.tables.milling_batches[0].notes).toBe('hello');
  });

  test('hold / resume / cancel routes exist', () => {
    const router = require('../modules/milling/milling.routes');
    for (const p of ['/batches/:id/hold', '/batches/:id/resume', '/batches/:id/cancel']) {
      expect(router.stack.some((l) => l.route && l.route.path === p && l.route.methods.post)).toBe(true);
    }
  });
});

describe('recordYield', () => {
  const yieldBody = { actual_finished_kg: 600, bran_kg: 100, husk_kg: 200, wastage_kg: 100 };

  test.each(['On Hold', 'Cancelled', 'Rejected'])('is refused (409) on a %s batch — nothing posted', async (status) => {
    seed({
      milling_batches: [{ id: 7, batch_no: 'M-007', status, raw_qty_kg: 1000 }],
      inventory_lots: [{ id: 70, batch_ref: 'batch-7', type: 'finished' }],
    });
    const res = resMock();
    await controller.recordYield({ params: { id: '7' }, body: yieldBody, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
    expect(inventoryService.consumeForMilling).not.toHaveBeenCalled();
    expect(inventoryService.resyncBatchOutputsFromBatch).not.toHaveBeenCalled();
    expect(accountingService.autoPost).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
  });

  test('a batch with outputs re-yields (resync) even when it is not Completed', async () => {
    seed({
      milling_batches: [{ id: 8, batch_no: 'M-008', status: 'Queued', raw_qty_kg: 1000 }],
      inventory_lots: [
        { id: 80, batch_ref: 'batch-8', type: 'finished' },
        { id: 81, batch_ref: 'batch-8', type: 'raw' },
      ],
    });
    const res = resMock();
    await controller.recordYield({ params: { id: '8' }, body: yieldBody, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);
    expect(inventoryService.resyncBatchOutputsFromBatch).toHaveBeenCalledWith(expect.anything(), 8, expect.anything());
    expect(inventoryService.consumeForMilling).not.toHaveBeenCalled();
    expect(accountingService.autoPost).not.toHaveBeenCalled();
    // The batch row was locked inside the transaction.
    expect(mockDb.locks).toContain('milling_batches');
  });

  test('the raw lot alone does not count as an output', async () => {
    expect(await lifecycle.batchHasOutputLots(mockDb, 99)).toBe(false);
    seed({ inventory_lots: [{ id: 1, batch_ref: 'batch-99', type: 'raw' }] });
    expect(await lifecycle.batchHasOutputLots(mockDb, 99)).toBe(false);
    seed({ inventory_lots: [{ id: 1, batch_ref: 'batch-99', type: 'byproduct' }] });
    expect(await lifecycle.batchHasOutputLots(mockDb, 99)).toBe(true);
  });
});

describe('status transitions', () => {
  test('hold from Queued, resume only from On Hold', () => {
    expect(lifecycle.checkTransition('hold', { status: 'Queued' })).toBeNull();
    expect(lifecycle.checkTransition('hold', { status: 'Completed' }).status).toBe(409);
    expect(lifecycle.checkTransition('resume', { status: 'On Hold' })).toBeNull();
    expect(lifecycle.checkTransition('resume', { status: 'Queued' }).status).toBe(409);
  });

  test('cancel is refused once yield exists', () => {
    expect(lifecycle.checkTransition('cancel', { status: 'Queued', batch_no: 'M-1' }, { hasYield: true }).status).toBe(409);
    expect(lifecycle.checkTransition('cancel', { status: 'Completed', batch_no: 'M-1' }).status).toBe(409);
    expect(lifecycle.checkTransition('cancel', { status: 'On Hold' })).toBeNull();
  });
});

describe('cancel releases the source-lot reservations', () => {
  test('releaseBatchSources returns the held qty to available', async () => {
    seed({
      batch_source_lots: [
        { id: 1, batch_id: 3, lot_id: 30, qty_kg: '400', lot_type: 'raw' },
        { id: 2, batch_id: 3, lot_id: 31, qty_kg: '100', lot_type: 'raw' },
        { id: 3, batch_id: 4, lot_id: 32, qty_kg: '50', lot_type: 'raw' },
      ],
      inventory_lots: [
        // Held only by batch 3 → fully released.
        { id: 30, qty: '1000', reserved_qty: '0', milling_reserved_qty: '400', available_qty: '600', milling_status: 'In Milling' },
        // Also held 200 by another batch → stays 'In Milling' with 200 held.
        { id: 31, qty: '500', reserved_qty: '50', milling_reserved_qty: '300', available_qty: '150', milling_status: 'In Milling' },
        { id: 32, qty: '50', reserved_qty: '0', milling_reserved_qty: '50', available_qty: '0', milling_status: 'In Milling' },
      ],
    });
    const released = await lifecycle.releaseBatchSources(mockDb, 3);
    expect(released).toEqual([30, 31]);
    const lot = (id) => state.tables.inventory_lots.find((l) => l.id === id);
    expect(lot(30)).toMatchObject({ milling_reserved_qty: 0, available_qty: 1000, milling_status: null, status: 'Available' });
    expect(lot(31)).toMatchObject({ milling_reserved_qty: 200, available_qty: 250, milling_status: 'In Milling' });
    // Another batch's lot is untouched.
    expect(lot(32)).toMatchObject({ milling_reserved_qty: '50', milling_status: 'In Milling' });
  });

  test('POST /cancel moves the batch to Cancelled and releases its lots', async () => {
    seed({
      milling_batches: [{ id: 3, batch_no: 'M-003', status: 'On Hold', actual_finished_kg: null }],
      batch_source_lots: [{ id: 1, batch_id: 3, lot_id: 30, qty_kg: '400', lot_type: 'raw' }],
      inventory_lots: [{ id: 30, qty: '1000', reserved_qty: '0', milling_reserved_qty: '400', available_qty: '600', milling_status: 'In Milling' }],
    });
    const res = resMock();
    await controller.cancelBatch({ params: { id: '3' }, body: { variance_status: 'Rejected' }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.releasedLotIds).toEqual([30]);
    expect(state.tables.milling_batches[0]).toMatchObject({ status: 'Cancelled', variance_status: 'Rejected' });
    expect(state.tables.inventory_lots[0]).toMatchObject({ milling_reserved_qty: 0, available_qty: 1000 });
  });

  test('POST /cancel on a batch with outputs is refused and releases nothing', async () => {
    seed({
      milling_batches: [{ id: 3, batch_no: 'M-003', status: 'Queued' }],
      batch_source_lots: [{ id: 1, batch_id: 3, lot_id: 30, qty_kg: '400', lot_type: 'raw' }],
      inventory_lots: [
        { id: 30, qty: '1000', reserved_qty: '0', milling_reserved_qty: '400', available_qty: '600', milling_status: 'In Milling' },
        { id: 33, batch_ref: 'batch-3', type: 'finished' },
      ],
    });
    const res = resMock();
    await controller.cancelBatch({ params: { id: '3' }, body: {}, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
    expect(state.updates).toEqual([]);
  });

  test('POST /hold keeps the reservations', async () => {
    seed({
      milling_batches: [{ id: 3, batch_no: 'M-003', status: 'Queued' }],
      batch_source_lots: [{ id: 1, batch_id: 3, lot_id: 30, qty_kg: '400', lot_type: 'raw' }],
      inventory_lots: [{ id: 30, qty: '1000', milling_reserved_qty: '400', milling_status: 'In Milling' }],
    });
    const res = resMock();
    await controller.holdBatch({ params: { id: '3' }, body: { variance_status: 'On Hold' }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);
    expect(state.tables.milling_batches[0].status).toBe('On Hold');
    expect(state.updates.filter((u) => u.table === 'inventory_lots')).toEqual([]);
  });
});

describe('onBatchCompleted', () => {
  test('notifies by role name and states the finished kg', async () => {
    const automation = jest.requireActual('../modules/admin/automation.service');
    // Rows carry the joined columns the role-name lookup filters on.
    seed({
      milling_batches: [{ id: 2, batch_no: 'M-002', linked_export_order_id: 11, actual_finished_kg: '12500.5' }],
      export_orders: [{ id: 11, order_no: 'EX-011' }],
      users: [
        { id: 4, 'r.name': 'Export Manager', 'u.is_active': true },
        { id: 6, 'r.name': 'Inventory Officer', 'u.is_active': true },
        { id: 2, 'r.name': 'Finance Manager', 'u.is_active': true },
      ],
    });
    await automation.onBatchCompleted(mockDb, { batchId: 2, userId: 1 });
    const notes = state.tables.notifications;
    expect(notes).toHaveLength(1);
    expect(notes[0].user_id).toBe(4);
    expect(notes[0].message).toContain('12,500.5 kg finished rice');
    expect(notes[0].message).not.toContain('undefined');
    expect(state.tables.tasks_assignments[0].assigned_to).toBe(6);
  });
});
