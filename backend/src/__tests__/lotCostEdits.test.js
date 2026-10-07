/**
 * Purchase-lot cost edits must keep freight + commission in landed cost and
 * must not re-bill the extras onto the rice payable.
 *
 * Before: createPurchaseLot computed landed = rice + extras + bags + freight
 * (company-paid) + commission, but setLotPurchaseRate / setLotReceivedQty /
 * updateLotCosts recomputed it WITHOUT freight + commission, then a price edit
 * (a) posted a GL delta of new − old landed (so the freight + commission were
 * taken back out of 1210/2010) and (b) overwrote the rice payable with the whole
 * landed total while the extras' own payables still stood — the supplier was
 * owed the extras twice. updateLotCosts booked freight changes to Opex although
 * create capitalised it to 1210, and ignored who pays the freight.
 *
 * These tests run the real controller against an in-memory knex stand-in.
 */

// ── in-memory knex stand-in ────────────────────────────────────────────────
const mockTables = {};
const mockIds = {};

function mockMatches(row, conds) {
  return conds.every(([k, v]) => {
    const col = k.includes('.') ? k.split('.').pop() : k;
    if (v === null) return row[col] == null;
    return String(row[col]) === String(v);
  });
}

function mockBuilder(name) {
  const conds = [];
  const ins = [];
  const b = {
    where(a, v) {
      if (typeof a === 'function') return b; // grouped OR filters — not needed here
      if (typeof a === 'string') { conds.push([a, v]); return b; }
      for (const [k, val] of Object.entries(a)) conds.push([k, val]);
      return b;
    },
    whereIn(col, vals) { conds.push({ in: [col, vals.map(String)] }); return b; },
    whereNull(col) { conds.push([col, null]); return b; },
    whereRaw() { return b; },
    whereNot() { return b; },
    orWhereNull() { return b; },
    orderBy() { return b; },
    orderByRaw() { return b; },
    select() { return b; },
    join() { return b; },
    rows() {
      return (mockTables[name] || []).filter((r) => conds.every((c) => (c.in
        ? c.in[1].includes(String(r[c.in[0]]))
        : mockMatches(r, [c]))));
    },
    async first() { return b.rows()[0]; },
    async update(patch) {
      const hit = b.rows();
      for (const r of hit) {
        for (const [k, v] of Object.entries(patch)) {
          if (v && typeof v === 'object' && v.__raw) continue; // trx.fn.now() / raw
          r[k] = v;
        }
      }
      return hit.length;
    },
    async del() {
      const hit = new Set(b.rows());
      mockTables[name] = (mockTables[name] || []).filter((r) => !hit.has(r));
      return hit.size;
    },
    insert(row) {
      const list = Array.isArray(row) ? row : [row];
      for (const r of list) {
        // Mirror the real unique index on inventory_lots.lot_no.
        if (name === 'inventory_lots' && (mockTables[name] || []).some((x) => x.lot_no === r.lot_no)) {
          const e = new Error('duplicate key value violates unique constraint "inventory_lots_lot_no_unique"');
          e.code = '23505'; e.constraint = 'inventory_lots_lot_no_unique';
          throw e;
        }
        mockIds[name] = (mockIds[name] || 0) + 1;
        const rec = { id: mockIds[name], ...r };
        (mockTables[name] = mockTables[name] || []).push(rec);
        ins.push(rec);
      }
      const p = Promise.resolve(ins);
      p.returning = async () => ins;
      return p;
    },
    then(res, rej) { return Promise.resolve(b.rows()).then(res, rej); },
  };
  return b;
}

jest.mock('../config/database', () => {
  const fn = (name) => mockBuilder(name);
  fn.transaction = async (cb) => cb(fn);
  fn.fn = { now: () => ({ __raw: 'now()' }) };
  fn.raw = (sql) => ({ __raw: sql });
  return fn;
});

const mockJournals = [];
jest.mock('../services/accountingService', () => ({
  autoPost: jest.fn(async (trx, opts) => { mockJournals.push({ kind: 'autoPost', ...opts }); }),
  createJournal: jest.fn(async (trx, opts) => { mockJournals.push({ kind: 'journal', ...opts }); return { id: mockJournals.length }; }),
  postJournal: jest.fn(async () => {}),
}));
jest.mock('../modules/inventory/inventory.service', () => ({
  generateRiceLotNo: jest.fn(async () => 'SUP-RICE-261005-01'),
  generateLotNo: jest.fn(async () => 'LOT-1'),
  propagateLotCostToBatches: jest.fn(async () => ({ affectedBatches: 0 })),
}));
let mockDocSeq = 0;
jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async () => `TXN-${++mockDocSeq}`) }));

const controller = require('../modules/inventory/lotInventory.controller');
const schemas = require('../middleware/schemas');

// ── helpers ───────────────────────────────────────────────────────────────
function seed() {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  for (const k of Object.keys(mockIds)) delete mockIds[k];
  mockJournals.length = 0;
  mockTables.warehouses = [{ id: 1, entity: 'mill', type: 'raw', is_active: true, name: 'Mill Raw' }];
  mockTables.chart_of_accounts = [
    { id: 11, code: '1210', name: 'Raw Rice Stock' },
    { id: 22, code: '2010', name: 'Accounts Payable' },
    { id: 33, code: '1450', name: 'Freight Recoverable' },
    { id: 44, code: '3000', name: "Owner's Equity" },
  ];
  mockTables.posting_rules = [
    { id: 5, trigger_event: 'purchase_invoice', is_active: true, entity: 'mill', debit_account_id: 11, credit_account_id: 22 },
  ];
  mockIds.warehouses = 1;
}

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

const SUPPLIER = 7;
const BROKER = 8;
const HAULER = 9;

// 10,000 kg @ Rs 100/kg = 1,000,000 rice
// + labor 5,000 + unloading 3,000 (supplier-direct) + bags 200 × 10 = 2,000
// + freight 40,000 (company → hauler) + commission 200 × 25 = 5,000 (broker)
const BASE = {
  item_name: 'Super Basmati', type: 'raw', entity: 'mill', product_id: 3,
  supplier_id: SUPPLIER, broker_id: BROKER, hauler_id: HAULER,
  quantity_input: 10000, quantity_unit: 'kg', bag_weight_kg: 50, total_bags: 200,
  rate_input: 100, rate_unit: 'kg',
  labor_cost: 5000, unloading_cost: 3000, bag_cost_per_bag: 10, bag_cost_included: false,
  transport_cost: 40000, transport_paid_by: 'company', commission_per_bag: 25,
  purchase_date: '2026-10-01',
};

// rbac.userHasPermission reads a pre-loaded permission set, so these users need
// no users/role_permissions rows. COST_USER holds reports.view_cost (sees and
// enters prices); BLIND_USER is a cost-blind role such as the Inventory Officer.
const COST_USER = () => ({ id: 1, role_id: 50, _permissionsLoaded: true, permissions: new Set(['inventory.create', 'reports.view_cost']) });
const BLIND_USER = () => ({ id: 2, role_id: 51, _permissionsLoaded: true, permissions: new Set(['inventory.create']) });

async function createLot(body = BASE, user = COST_USER()) {
  const res = mockRes();
  await controller.createPurchaseLot({ body, user }, res);
  return res;
}
const lotRow = () => mockTables.inventory_lots[0];
const payable = (category) => (mockTables.payables || []).find((p) => p.category === category);
const sumLines = (j, accountId, side) => j.lines.filter((l) => l.account_id === accountId).reduce((s, l) => s + l[side], 0);

beforeEach(seed);

// ── tests ─────────────────────────────────────────────────────────────────
describe('createPurchaseLot', () => {
  test('landed = rice + extras + bags + company freight + commission; every payable starts Pending', async () => {
    const res = await createLot({ ...BASE, payment_status: 'Paid', paid_amount: 999999 });
    expect(res.statusCode).toBe(201);
    const lot = lotRow();
    expect(lot.purchase_amount).toBe(1000000);
    expect(lot.landed_cost_total).toBe(1000000 + 5000 + 3000 + 2000 + 40000 + 5000);
    expect(lot.landed_cost_per_kg).toBe(105.5);
    // P5: a body-supplied "Paid" never stamps a payable paid.
    expect(lot.paid_amount).toBe(0);
    for (const p of mockTables.payables) {
      expect(p.paid_amount).toBe(0);
      expect(p.status).toBe('Pending');
    }
    expect(payable('Raw Material').original_amount).toBe(1000000);
    expect(payable('Transport')).toMatchObject({ hauler_id: HAULER, original_amount: 40000 });
    expect(payable('Commission')).toMatchObject({ supplier_id: BROKER, original_amount: 5000 });
  });

  test('P2: company freight with no hauler is rejected', async () => {
    const res = await createLot({ ...BASE, hauler_id: null });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/hauler/i);
    expect(mockTables.inventory_lots).toBeUndefined();
  });

  test('P2: commission with no broker is rejected', async () => {
    const res = await createLot({ ...BASE, broker_id: null });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/broker/i);
  });

  test('supplier-paid freight with no hauler is fine and stays out of landed cost', async () => {
    const res = await createLot({ ...BASE, hauler_id: null, transport_paid_by: 'supplier' });
    expect(res.statusCode).toBe(201);
    expect(lotRow().landed_cost_total).toBe(1000000 + 5000 + 3000 + 2000 + 5000);
    expect(payable('Transport')).toBeUndefined();
  });
});

describe('setLotPurchaseRate after create', () => {
  test('keeps freight + commission, bills the rice payable the new purchase only, GL moves by the purchase change', async () => {
    await createLot();
    const lot = lotRow();
    const extrasBefore = mockTables.payables.filter((p) => p.category !== 'Raw Material').map((p) => ({ ...p }));
    mockJournals.length = 0;

    const res = mockRes();
    await controller.setLotPurchaseRate({ params: { id: lot.id }, body: { rate_per_kg: 110 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);

    const after = lotRow();
    // 10,000 kg × 110 = 1,100,000 (+100,000)
    expect(after.purchase_amount).toBe(1100000);
    expect(after.landed_cost_total).toBe(1155000); // 1,055,000 + 100,000 — freight + commission kept
    expect(after.landed_cost_per_kg).toBe(115.5);

    // Rice payable = new purchase amount, NOT the landed total.
    expect(payable('Raw Material').original_amount).toBe(1100000);
    expect(payable('Raw Material').outstanding).toBe(1100000);
    // Extras' payables untouched.
    expect(mockTables.payables.filter((p) => p.category !== 'Raw Material')).toEqual(extrasBefore);

    // Exactly one journal: Dr 1210 / Cr 2010 for the 100,000 purchase change.
    expect(mockJournals).toHaveLength(1);
    const j = mockJournals[0];
    expect(j).toMatchObject({ refType: 'Purchase Lot', partyType: 'supplier', partyId: SUPPLIER });
    expect(sumLines(j, 11, 'debit')).toBe(100000);
    expect(sumLines(j, 22, 'credit')).toBe(100000);
  });

  test('a price cut posts the reverse delta only', async () => {
    await createLot();
    mockJournals.length = 0;
    const res = mockRes();
    await controller.setLotPurchaseRate({ params: { id: lotRow().id }, body: { rate_per_kg: 95 }, user: { id: 1 } }, res);
    expect(lotRow().landed_cost_total).toBe(1005000); // 1,055,000 − 50,000
    expect(payable('Raw Material').original_amount).toBe(950000);
    const j = mockJournals[0];
    expect(sumLines(j, 22, 'debit')).toBe(50000);
    expect(sumLines(j, 11, 'credit')).toBe(50000);
  });
});

describe('setLotReceivedQty after create', () => {
  test('short receipt re-bills the rice only', async () => {
    await createLot();
    mockJournals.length = 0;
    const res = mockRes();
    await controller.setLotReceivedQty({ params: { id: lotRow().id }, body: { received_net_weight_kg: 9000 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);
    const after = lotRow();
    expect(after.purchase_amount).toBe(900000);
    expect(after.landed_cost_total).toBe(955000); // 1,055,000 − 100,000
    expect(after.net_weight_kg).toBe(9000);
    expect(payable('Raw Material').original_amount).toBe(900000);
    expect(payable('Transport').original_amount).toBe(40000);
    expect(sumLines(mockJournals[0], 22, 'debit')).toBe(100000);
  });
});

describe('opening stock price/qty edits post against 3000 equity', () => {
  // Shaped like the go-live loader left it: direct insert, fully "paid", no
  // supplier payable, and one ledger row TXN-OPEN-<id> typed opening_balance.
  function seedOpeningLot(extra = {}) {
    mockTables.inventory_lots = [{
      id: 70, lot_no: 'LOT-OPEN-70', type: 'raw', entity: 'mill', supplier_id: null,
      qty: 10000, net_weight_kg: 10000, received_net_weight_kg: 10000, available_qty: 10000,
      reserved_qty: 0, milling_reserved_qty: 0,
      rate_per_kg: 100, purchase_amount: 1000000, landed_cost_total: 1000000, landed_cost_per_kg: 100,
      cost_per_unit: 100, total_value: 1000000, payment_status: 'Paid', paid_amount: 1000000, due_amount: 0,
      ...extra,
    }];
    mockTables.lot_transactions = [{
      id: 1, lot_id: 70, transaction_no: 'TXN-OPEN-00070',
      transaction_type: 'opening_balance', reference_module: 'opening_balance', quantity_kg: 10000,
    }];
  }
  const edit = async (fn, body) => {
    const res = mockRes();
    await controller[fn]({ params: { id: 70 }, body, user: { id: 1 } }, res);
    return res;
  };

  test('price up → one Posted Dr 1210 / Cr 3000 for the purchase change; no payable touched', async () => {
    seedOpeningLot();
    const accounting = require('../services/accountingService');
    accounting.postJournal.mockClear();
    const res = await edit('setLotPurchaseRate', { rate_per_kg: 110 });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.openingStockRestated).toBe(true);
    expect(res.body.data.payableUpdated).toBe(false);

    const lot = lotRow();
    expect(lot.purchase_amount).toBe(1100000);
    expect(lot.landed_cost_total).toBe(1100000);
    expect(lot.cost_per_unit).toBe(110);
    expect(lot).toMatchObject({ paid_amount: 1100000, due_amount: 0, payment_status: 'Paid' });
    expect(mockTables.payables).toBeUndefined();

    expect(mockJournals).toHaveLength(1);
    const j = mockJournals[0];
    expect(j).toMatchObject({ entity: 'mill', refType: 'Opening Stock Revaluation', refNo: 'LOT-OPEN-70' });
    expect(j.partyType).toBeUndefined();
    expect(j.description).toMatch(/^Opening stock revaluation LOT-OPEN-70/);
    expect(j.lines).toHaveLength(2);
    expect(sumLines(j, 11, 'debit')).toBe(100000);
    expect(sumLines(j, 44, 'credit')).toBe(100000);
    expect(sumLines(j, 22, 'credit') + sumLines(j, 22, 'debit')).toBe(0); // no AP
    expect(accounting.postJournal).toHaveBeenCalledTimes(1);
  });

  test('price down → reversed signs: Dr 3000 / Cr 1210', async () => {
    seedOpeningLot();
    const res = await edit('setLotPurchaseRate', { rate_per_kg: 95 });
    expect(res.statusCode).toBe(200);
    expect(lotRow().landed_cost_total).toBe(950000);
    const j = mockJournals[0];
    expect(sumLines(j, 44, 'debit')).toBe(50000);
    expect(sumLines(j, 11, 'credit')).toBe(50000);
  });

  test('received qty down → stock and value fall, Dr 3000 / Cr 1210 for the change', async () => {
    seedOpeningLot();
    const res = await edit('setLotReceivedQty', { received_net_weight_kg: 9000 });
    expect(res.statusCode).toBe(200);
    expect(lotRow()).toMatchObject({ net_weight_kg: 9000, purchase_amount: 900000, landed_cost_total: 900000 });
    const j = mockJournals[0];
    expect(j.refType).toBe('Opening Stock Revaluation');
    expect(sumLines(j, 44, 'debit')).toBe(100000);
    expect(sumLines(j, 11, 'credit')).toBe(100000);
  });

  test('the inventory side follows the lot type (by-product → 1240)', async () => {
    const { inventoryAccountForLot } = require('../modules/localSales/inventoryAccount');
    expect(inventoryAccountForLot({ type: 'raw' })).toBe('1210');
    expect(inventoryAccountForLot({ type: 'finished', entity: 'mill' })).toBe('1220');
    expect(inventoryAccountForLot({ type: 'byproduct' })).toBe('1240');
  });

  test('a raw lot with no payable that is NOT opening stock → 409, nothing written', async () => {
    seedOpeningLot();
    mockTables.lot_transactions = [{ id: 1, lot_id: 70, transaction_type: 'warehouse_transfer_in', reference_module: 'transfer' }];
    const res = await edit('setLotPurchaseRate', { rate_per_kg: 110 });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/no supplier bill and is not opening stock/);
    expect(lotRow().purchase_amount).toBe(1000000);
    expect(lotRow().cost_per_unit).toBe(100);
    expect(mockJournals).toHaveLength(0);

    const res2 = await edit('setLotReceivedQty', { received_net_weight_kg: 9000 });
    expect(res2.statusCode).toBe(409);
    expect(lotRow().net_weight_kg).toBe(10000);
  });

  test('the 2026-04 ledger backfill row (opening_balance / purchase) is not opening stock', async () => {
    seedOpeningLot();
    mockTables.lot_transactions = [{ id: 1, lot_id: 70, transaction_type: 'opening_balance', reference_module: 'purchase' }];
    const res = await edit('setLotPurchaseRate', { rate_per_kg: 110 });
    expect(res.statusCode).toBe(409);
  });

  test('a lot with a rice payable keeps the AP behaviour even if it carries an opening row', async () => {
    await createLot();
    const lot = lotRow();
    mockTables.lot_transactions = [{ id: 99, lot_id: lot.id, transaction_type: 'opening_balance', reference_module: 'opening_balance' }];
    mockJournals.length = 0;
    const res = mockRes();
    await controller.setLotPurchaseRate({ params: { id: lot.id }, body: { rate_per_kg: 110 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.openingStockRestated).toBe(false);
    expect(mockJournals).toHaveLength(1);
    expect(mockJournals[0].refType).toBe('Purchase Lot');
    expect(sumLines(mockJournals[0], 22, 'credit')).toBe(100000);
    expect(sumLines(mockJournals[0], 44, 'credit')).toBe(0);
    expect(payable('Raw Material').original_amount).toBe(1100000);
  });
});

describe('updateLotCosts freight', () => {
  test('company-paid freight correction is capitalised (Dr 1210 / Cr 2010 hauler), not Opex', async () => {
    await createLot();
    mockJournals.length = 0;
    const res = mockRes();
    await controller.updateLotCosts({ params: { id: lotRow().id }, body: { transport_cost: 50000 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);

    const after = lotRow();
    expect(after.landed_cost_total).toBe(1065000); // freight 40k → 50k, commission kept
    expect(payable('Transport').original_amount).toBe(50000);
    expect(mockTables.transport_costs[0]).toMatchObject({ amount: 50000, paid_by: 'company' });

    const freight = mockJournals.filter((j) => j.refType === 'Lot Transport');
    expect(freight).toHaveLength(1);
    expect(freight[0]).toMatchObject({ partyType: 'hauler', partyId: HAULER, postingRuleId: 5 });
    expect(sumLines(freight[0], 11, 'debit')).toBe(10000);
    expect(sumLines(freight[0], 22, 'credit')).toBe(10000);
    // Supplier side unchanged → no supplier journal.
    expect(mockJournals.filter((j) => j.refType === 'Purchase Lot')).toHaveLength(0);
    // Rice payable still the purchase amount.
    expect(payable('Raw Material').original_amount).toBe(1000000);
  });

  test('freight link survives a rename (keyed on the lot, not lot_no)', async () => {
    await createLot();
    const lot = lotRow();
    // renameLot moves payables.linked_ref; journals keep the old ref_no.
    lot.lot_no = 'RENAMED-1';
    for (const p of mockTables.payables) p.linked_ref = 'RENAMED-1';
    mockJournals.length = 0;
    const res = mockRes();
    await controller.updateLotCosts({ params: { id: lot.id }, body: { transport_cost: 40000 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);
    // Unchanged freight → no re-billing at all (the old lot_no lookup saw 0 and re-billed 40k).
    expect(mockJournals).toHaveLength(0);
    expect(mockTables.payables.filter((p) => p.category === 'Transport')).toHaveLength(1);
  });

  test('supplier-paid freight: no company payable, no journal, not in landed', async () => {
    await createLot({ ...BASE, transport_paid_by: 'supplier' });
    mockJournals.length = 0;
    const res = mockRes();
    await controller.updateLotCosts({ params: { id: lotRow().id }, body: { transport_cost: 45000 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(200);
    expect(lotRow().landed_cost_total).toBe(1015000);
    expect(payable('Transport')).toBeUndefined();
    expect(mockJournals).toHaveLength(0);
    expect(mockTables.transport_costs[0]).toMatchObject({ amount: 45000, paid_by: 'supplier' });
  });

  test('freight cannot drop below what was already paid to the hauler', async () => {
    await createLot();
    const tp = payable('Transport');
    tp.paid_amount = 30000; tp.outstanding = 10000; tp.status = 'Partial';
    const res = mockRes();
    await controller.updateLotCosts({ params: { id: lotRow().id }, body: { transport_cost: 20000 }, user: { id: 1 } }, res);
    expect(res.statusCode).toBe(409);
  });
});

describe('Joi schemas (P5)', () => {
  const run = (schema, body) => schema.validate(body, { abortEarly: false, stripUnknown: true });
  test('createPurchaseLot and addPurchaseToLot drop payment_status / paid_amount', () => {
    const { value: a } = run(schemas.createPurchaseLot, { item_name: 'x', quantity_input: 1, rate_input: 1, payment_status: 'Paid', paid_amount: 5 });
    expect(a.payment_status).toBeUndefined();
    expect(a.paid_amount).toBeUndefined();
    const { value: b } = run(schemas.addPurchaseToLot, { quantity_input: 1, rate_input: 1, payment_status: 'Paid', paid_amount: 5 });
    expect(b.payment_status).toBeUndefined();
    expect(b.paid_amount).toBeUndefined();
  });
});

describe('lot number generated server-side (PRC-P7)', () => {
  const inventoryService = require('../modules/inventory/inventory.service');

  test('lot_no: null → the server generates it inside the transaction', async () => {
    inventoryService.generateRiceLotNo.mockClear();
    const res = await createLot({ ...BASE, lot_no: null });
    expect(res.statusCode).toBe(201);
    expect(inventoryService.generateRiceLotNo).toHaveBeenCalledTimes(1);
    expect(inventoryService.generateRiceLotNo.mock.calls[0][1]).toEqual({ supplierId: SUPPLIER, productId: 3, date: '2026-10-01' });
    expect(lotRow().lot_no).toBe('SUP-RICE-261005-01');
  });

  test('an auto number that collides (concurrent save) is retried with the next number', async () => {
    mockTables.inventory_lots = [{ id: 99, lot_no: 'SUP-RICE-261005-01' }];
    inventoryService.generateRiceLotNo.mockClear();
    inventoryService.generateRiceLotNo
      .mockImplementationOnce(async () => 'SUP-RICE-261005-01') // stale MAX — the other save won
      .mockImplementationOnce(async () => 'SUP-RICE-261005-02');
    const res = await createLot({ ...BASE, lot_no: null });
    expect(res.statusCode).toBe(201);
    expect(inventoryService.generateRiceLotNo).toHaveBeenCalledTimes(2);
    expect(res.body.data.lot.lot_no).toBe('SUP-RICE-261005-02');
  });

  test('a typed lot number that is taken is a 409 naming it (no silent renumber)', async () => {
    mockTables.inventory_lots = [{ id: 99, lot_no: 'MY-LOT' }];
    inventoryService.generateRiceLotNo.mockClear();
    const res = await createLot({ ...BASE, lot_no: 'MY-LOT' });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/MY-LOT/);
    expect(inventoryService.generateRiceLotNo).not.toHaveBeenCalled();
  });
});

describe('renameLot honours the Mill Operator scope (PRC-P6)', () => {
  beforeEach(() => {
    mockTables.roles = [{ id: 5, name: 'Mill Operator' }, { id: 2, name: 'Mill Manager' }];
    mockTables.inventory_lots = [{ id: 50, lot_no: 'OLD-1', created_by: 1 }];
  });
  const rename = async (user, lotNo = 'NEW-1') => {
    const res = mockRes();
    await controller.renameLot({ params: { id: '50' }, body: { lot_no: lotNo }, user }, res);
    return res;
  };

  test("a Mill Operator cannot rename someone else's lot", async () => {
    const res = await rename({ id: 2, role_id: 5 });
    expect(res.statusCode).toBe(403);
    expect(mockTables.inventory_lots[0].lot_no).toBe('OLD-1');
  });

  test('a Mill Operator cannot rename a lot already in milling', async () => {
    mockTables.batch_source_lots = [{ lot_id: 50, batch_id: 1 }];
    const res = await rename({ id: 1, role_id: 5 });
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/milling/i);
  });

  test('the creator renames their own unmilled lot; other roles are unaffected', async () => {
    expect((await rename({ id: 1, role_id: 5 })).statusCode).toBe(200);
    expect(mockTables.inventory_lots[0].lot_no).toBe('NEW-1');
    expect((await rename({ id: 9, role_id: 2 }, 'NEW-2')).statusCode).toBe(200);
    expect(mockTables.inventory_lots[0].lot_no).toBe('NEW-2');
  });
});

// Cost visibility (owner decision 2026-10-05): the QC Analyst, Inventory
// Officer and Documentation Officer never see or set a purchase price. They can
// still record the rice — unpriced — and someone who sees cost prices it later.
describe('purchase by a cost-blind user', () => {
  test('price and every cost they send are ignored: an unpriced lot, no payable, no GL', async () => {
    const res = await createLot({
      ...BASE,
      quality_json: { moisture: 12, price_per_kg: 100, price_per_mt: 100000 },
      vehicles: [{ vehicle_no: 'TRK-1', weight_kg: 10000, quality_json: { moisture: 11, price_per_mt: 120000 } }],
    }, BLIND_USER());
    expect(res.statusCode).toBe(201);
    const lot = lotRow();
    expect(lot.rate_per_kg).toBe(0);
    expect(lot.purchase_amount).toBe(0);
    expect(lot.landed_cost_total).toBe(0);
    expect(lot.landed_cost_per_kg).toBe(0);
    expect(lot.quality_json).toEqual({ moisture: 12 });
    expect(mockTables.milling_vehicle_arrivals[0].quality_json).toEqual({ moisture: 11 });
    expect(mockTables.payables || []).toHaveLength(0);
    expect(mockJournals).toHaveLength(0);
  });

  test('a user who can see cost still has to give a price', async () => {
    const res = await createLot({ ...BASE, rate_input: null });
    expect(res.statusCode).toBe(400);
    expect(res.body.missing).toContain('price');
  });

  test('a moisture or broken reading of 0 is kept, not saved as blank', async () => {
    await createLot({ ...BASE, moisture_pct: 0, broken_pct: 0 });
    expect(lotRow().moisture_pct).toBe(0);
    expect(lotRow().broken_pct).toBe(0);
  });

  test('Edit Price on the unpriced lot raises the rice payable and posts the GL delta', async () => {
    await createLot({ ...BASE, transport_cost: 0, commission_per_bag: 0, labor_cost: 0, unloading_cost: 0, bag_cost_per_bag: 0 }, BLIND_USER());
    expect(mockTables.payables || []).toHaveLength(0);
    const res = mockRes();
    await controller.setLotPurchaseRate({ params: { id: lotRow().id }, body: { rate_per_kg: 100 }, user: COST_USER() }, res);
    expect(res.statusCode).toBe(200);
    expect(lotRow().purchase_amount).toBe(1000000);
    expect(lotRow().landed_cost_per_kg).toBe(100);
    expect(payable('Raw Material')).toMatchObject({ supplier_id: SUPPLIER, original_amount: 1000000, outstanding: 1000000, status: 'Pending' });
    expect(mockJournals).toHaveLength(1);
    expect(sumLines(mockJournals[0], 11, 'debit')).toBe(1000000);
    expect(sumLines(mockJournals[0], 22, 'credit')).toBe(1000000);
  });
});

describe('Edit Price / Edit Costs request validation', () => {
  test('setLotPurchaseRate keeps rate_per_kg and rejects a missing or zero rate', () => {
    expect(schemas.setLotPurchaseRate.validate({ rate_per_kg: 110 }, { stripUnknown: true }).value).toEqual({ rate_per_kg: 110 });
    expect(schemas.setLotPurchaseRate.validate({}).error).toBeTruthy();
    expect(schemas.setLotPurchaseRate.validate({ rate_per_kg: 0 }).error).toBeTruthy();
  });

  test('createPurchaseLot accepts a purchase without a rate (cost-blind user)', () => {
    const { error } = schemas.createPurchaseLot.validate({ ...BASE, rate_input: null });
    expect(error).toBeUndefined();
  });
});
