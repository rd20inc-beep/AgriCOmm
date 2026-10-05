/**
 * Procurement workflow guards (PRC-P8 / P10 / P12 / P13). Each test EXECUTES the
 * real service/controller against the in-memory fakeKnex.
 *
 *  - sample → lot convert claims the sample under a row lock, so two concurrent
 *    converts make ONE lot (before: status checked outside any transaction, both
 *    passed, two lots + two payables);
 *  - a purchase requirement can only be marked purchased once it is approved;
 *  - a store purchase writes Bag Kg / Tare Kg to the item master only where the
 *    master has none, inside the purchase transaction (before: a separate PUT
 *    /mill-store/items/:id that needed manage_items and ran before the purchase);
 *  - a store purchase closes the approved requirements it fulfils.
 */

jest.mock('../config/database', () => {
  const { fakeKnex } = require('./helpers/fakeKnex');
  return fakeKnex({});
});
jest.mock('../modules/inventory/inventory.service', () => ({}));
jest.mock('../services/notificationService', () => ({ notifyFinance: jest.fn(async () => {}) }));
jest.mock('../modules/inventory/lotInventory.controller', () => ({ createPurchaseLot: jest.fn() }));
jest.mock('../modules/millStore/millStore.repository', () => {
  const mockDbRef = require('../config/database');
  return {
    getItemById: jest.fn(async (id) => mockDbRef.tables.mill_items.find((i) => String(i.id) === String(id))),
    generatePurchaseNo: jest.fn(async () => 'MP-0001'),
    createPurchase: jest.fn(async (trx, header, lines) => {
      // The real repo inserts each line object verbatim into mill_purchase_items.
      for (const l of lines) await trx('mill_purchase_items').insert({ ...l, purchase_id: 1 });
      return { id: 1, ...header };
    }),
  };
});

const db = require('../config/database');
const lotController = require('../modules/inventory/lotInventory.controller');
const repo = require('../modules/millStore/millStore.repository');
const sampleService = require('../modules/sampleAnalysis/sampleAnalysis.service');
const prController = require('../modules/purchaseRequirements/purchaseRequirements.controller');
const millStoreService = require('../modules/millStore/millStore.service');

function reset(seed) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  for (const [k, rows] of Object.entries(seed)) db.tables[k] = rows.map((r) => ({ ...r }));
}

function mockRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

// Row-lock semantics for rice_samples: a transaction that reads the sample
// FOR NO KEY UPDATE holds it until the transaction ends; another transaction
// asking for the same lock waits — as Postgres does.
const baseTransaction = db.transaction;
function withRowLocks() {
  let tail = Promise.resolve();
  db.transaction = async (cb) => {
    let release = () => {};
    let acquired = false;
    const trx = (table) => {
      const b = db(table);
      if (table === 'rice_samples') {
        const first = b.first;
        b.forNoKeyUpdate = () => { b.lockRequested = true; return b; };
        b.first = async (...a) => {
          if (b.lockRequested && !acquired) {
            const prev = tail;
            tail = new Promise((r) => { release = r; });
            acquired = true;
            await prev;
          }
          return first(...a);
        };
      }
      return b;
    };
    Object.assign(trx, { fn: db.fn, raw: db.raw, tables: db.tables });
    try { return await cb(trx); } finally { release(); }
  };
}
afterEach(() => { db.transaction = baseTransaction; });

describe('sample → purchase lot convert (PRC-P10)', () => {
  const SAMPLE = {
    id: 1, sample_no: 'SMP-1', status: 'Approved for Purchase', supplier_id: 7, product_id: 3,
    offered_qty_kg: 10000, offered_rate_per_kg: 100, converted_lot_id: null,
  };
  let nextLot;
  beforeEach(() => {
    reset({ rice_samples: [SAMPLE], products: [{ id: 3, name: 'Super Basmati' }] });
    withRowLocks();
    nextLot = 77;
    lotController.createPurchaseLot.mockReset();
    lotController.createPurchaseLot.mockImplementation(async (req, res) => {
      await new Promise((r) => setTimeout(r, 15)); // the lot takes a moment to create
      res.status(201).json({ data: { lot: { id: nextLot++, lot_no: 'L-1' } } });
    });
  });

  test('two concurrent converts of one sample create ONE lot', async () => {
    const results = await Promise.allSettled([
      sampleService.convertToLot(1, {}, 1),
      sampleService.convertToLot(1, {}, 2),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/already converted/i);
    expect(lotController.createPurchaseLot).toHaveBeenCalledTimes(1);
    expect(db.tables.rice_samples[0]).toMatchObject({ status: 'Converted', converted_lot_id: 77 });
  });

  test('a failed lot create releases the claim untouched, so a retry can convert', async () => {
    lotController.createPurchaseLot.mockImplementationOnce(async (req, res) => {
      res.status(400).json({ message: 'Pick a transporter' });
    });
    await expect(sampleService.convertToLot(1, {}, 1)).rejects.toThrow(/transporter/);
    expect(db.tables.rice_samples[0]).toMatchObject({ status: 'Approved for Purchase', converted_lot_id: null });
    const out = await sampleService.convertToLot(1, {}, 1);
    expect(out.lot.id).toBe(77);
    expect(db.tables.rice_samples[0].status).toBe('Converted');
  });
});

describe('purchase requirement mark-purchased (PRC-P12)', () => {
  beforeEach(() => reset({
    purchase_requirements: [
      { id: 1, pr_no: 'PR-1', status: 'pending' },
      { id: 2, pr_no: 'PR-2', status: 'approved' },
      { id: 3, pr_no: 'PR-3', status: 'rejected' },
    ],
  }));
  const mark = async (id) => {
    const res = mockRes();
    await prController.markPurchased({ params: { id }, user: { id: 1 } }, res);
    return res;
  };

  test('pending → purchased is refused (409); it has to be approved first', async () => {
    const res = await mark(1);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/approved first/);
    expect(db.tables.purchase_requirements[0].status).toBe('pending');
  });

  test('approved → purchased', async () => {
    const res = await mark(2);
    expect(res.statusCode).toBe(200);
    expect(db.tables.purchase_requirements[1].status).toBe('purchased');
  });

  test('rejected → purchased is refused', async () => {
    expect((await mark(3)).statusCode).toBe(409);
  });
});

describe('store purchase bag kg + requirements (PRC-P8 / P13)', () => {
  beforeEach(() => {
    reset({
      mill_items: [
        { id: 10, name: 'PP Bag 25kg', category: 'packaging', capacity_kg: null, tare_weight_kg: null },
        { id: 11, name: 'PP Bag 50kg', category: 'packaging', capacity_kg: 50, tare_weight_kg: 0.12 },
        { id: 12, name: 'Diesel', category: 'fuel', capacity_kg: null, tare_weight_kg: null },
        { id: 13, name: 'Master Bag', category: 'packaging', capacity_kg: 0, tare_weight_kg: 0.3 },
      ],
      purchase_requirements: [
        { id: 1, pr_no: 'PR-1', status: 'approved', item_id: 10, notes: null },
        { id: 2, pr_no: 'PR-2', status: 'pending', item_id: 10, notes: null },
      ],
    });
    repo.createPurchase.mockClear();
  });
  const buy = (lines, extra = {}) => millStoreService.createPurchase({
    supplier_id: 7, purchase_date: '2026-10-05', lines, ...extra,
  }, 1);

  test('Bag Kg / Tare Kg fill only blank (or zero) masters; existing figures are never overwritten', async () => {
    await buy([
      { item_id: 10, quantity: 100, cost_per_unit: 20, bag_kg: 25, tare_kg: 0.1 },
      { item_id: 11, quantity: 100, cost_per_unit: 30, bag_kg: 45, tare_kg: 0.2 },
      { item_id: 12, quantity: 10, cost_per_unit: 300, bag_kg: 99 },
      { item_id: 13, quantity: 5, cost_per_unit: 80, bag_kg: 40, tare_kg: 0.5 },
    ]);
    const item = (id) => db.tables.mill_items.find((i) => i.id === id);
    expect(item(10)).toMatchObject({ capacity_kg: 25, tare_weight_kg: 0.1 });     // blank → filled
    expect(item(11)).toMatchObject({ capacity_kg: 50, tare_weight_kg: 0.12 });    // set → untouched
    expect(item(12)).toMatchObject({ capacity_kg: null });                        // not packaging
    expect(item(13)).toMatchObject({ capacity_kg: 40, tare_weight_kg: 0.3 });     // 0 is blank; tare set
    // Bag specs never reach the purchase-line rows (not columns there).
    for (const l of db.tables.mill_purchase_items) {
      expect(l).not.toHaveProperty('bag_kg');
      expect(l).not.toHaveProperty('tare_kg');
    }
  });

  test('closes the approved requirements it fulfils, noting the purchase', async () => {
    await buy([{ item_id: 10, quantity: 100, cost_per_unit: 20, bag_kg: 25 }], { close_requirement_ids: [1] });
    expect(db.tables.purchase_requirements[0]).toMatchObject({ status: 'purchased', notes: 'Purchased on MP-0001' });
    expect(db.tables.purchase_requirements[1].status).toBe('pending');
  });

  test('refuses to close a requirement that is not approved', async () => {
    await expect(buy([{ item_id: 10, quantity: 1, cost_per_unit: 20, bag_kg: 25 }], { close_requirement_ids: [2] }))
      .rejects.toThrow(/approved/);
    expect(db.tables.purchase_requirements[1].status).toBe('pending');
  });
});
