/**
 * Quotation → export order conversion.
 *
 * convert() built the order body without bank_account_id, and the export-order
 * create handler refuses an order without one — so every conversion answered
 * 400. It also read the quotation, created the order and only then stamped
 * converted_order_id, so a double-click made two orders.
 *
 * These run the real convert() against an in-memory database whose
 * transactions honour SELECT ... FOR UPDATE (a second locker waits until the
 * first commits), with the export-order create handler stubbed.
 */

const mockState = { tables: {} };

jest.mock('../config/database', () => {
  const locks = new Map(); // `${table}:${id}` -> { trxId, release, wait }
  let trxSeq = 0;

  const matches = (row, conds) => Object.entries(conds).every(([k, v]) => row[k] === v);

  function builder(table, trxCtx) {
    const q = { conds: {}, lock: false };
    const rows = () => (mockState.tables[table] || []).filter((r) => matches(r, q.conds));
    const acquire = async () => {
      if (!q.lock || !trxCtx) return;
      for (const r of rows()) {
        const key = `${table}:${r.id}`;
        // eslint-disable-next-line no-await-in-loop
        while (locks.has(key) && locks.get(key).trxId !== trxCtx.id) await locks.get(key).wait;
        if (!locks.has(key)) {
          let release;
          const wait = new Promise((ok) => { release = ok; });
          locks.set(key, { trxId: trxCtx.id, release, wait });
          trxCtx.held.push(key);
        }
      }
    };
    const b = {
      where(c) { Object.assign(q.conds, c); return b; },
      whereIn() { return b; },
      orderBy() { return b; },
      forUpdate() { q.lock = true; return b; },
      async first() {
        await acquire();
        const r = rows()[0];
        return r ? { ...r } : undefined;
      },
      async update(patch) {
        const hit = rows();
        hit.forEach((r) => Object.assign(r, patch));
        return hit.length;
      },
      then(ok, ko) { return acquire().then(() => rows().map((r) => ({ ...r }))).then(ok, ko); },
    };
    return b;
  }

  const db = (table) => builder(table, null);
  db.fn = { now: () => 'now()' };
  db.transaction = async (fn) => {
    const ctx = { id: ++trxSeq, held: [] };
    const trx = (table) => builder(table, ctx);
    trx.fn = db.fn;
    try {
      return await fn(trx);
    } finally {
      for (const key of ctx.held) {
        const l = locks.get(key);
        locks.delete(key);
        l.release();
      }
    }
  };
  return db;
});

jest.mock('../modules/exportOrders/exportOrders.controller', () => ({ create: jest.fn() }));

const exportOrderController = require('../modules/exportOrders/exportOrders.controller');
const quotations = require('../modules/quotations/quotations.controller');

const resStub = () => {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

function seed({ exportDefaultBank = true } = {}) {
  mockState.tables = {
    export_quotations: [{
      id: 5, quotation_no: 'QT-005', status: 'Accepted', converted_order_id: null,
      customer_id: 3, currency: 'USD', incoterm: 'FOB', advance_pct: 20,
      packing_cost: 0, freight_cost: 0, other_charges: 0, total_amount: 12000,
    }],
    export_quotation_items: [{ quotation_id: 5, line_no: 1, product_id: 9, product_name: 'Super Basmati', qty_mt: 24, price_per_mt: 500 }],
    bank_accounts: [
      { id: 1, account_name: 'Local PKR', is_export_default: false },
      ...(exportDefaultBank ? [{ id: 4, account_name: 'Export USD', is_export_default: true }] : []),
    ],
  };
}

let nextOrderId = 100;
beforeEach(() => {
  exportOrderController.create.mockReset();
  // A create that takes a moment, like the real one (FX lock + its own transaction).
  exportOrderController.create.mockImplementation(async (req, res) => {
    await new Promise((ok) => setTimeout(ok, 20));
    if (!req.body.bank_account_id) {
      return res.status(400).json({ success: false, message: 'A bank account is required to create an export order.' });
    }
    const id = nextOrderId++;
    return res.status(201).json({ success: true, data: { order: { id, order_no: `EX-${id}` } } });
  });
});

describe('quotation convert', () => {
  let errorSpy;
  beforeAll(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterAll(() => errorSpy.mockRestore());

  it('passes the export-default bank account to the order create', async () => {
    seed();
    const res = resStub();
    await quotations.convert({ params: { id: '5' }, user: { id: 1 } }, res);
    expect(res.code).toBe(201);
    expect(exportOrderController.create).toHaveBeenCalledTimes(1);
    expect(exportOrderController.create.mock.calls[0][0].body.bank_account_id).toBe(4);
    expect(mockState.tables.export_quotations[0].converted_order_id).toBe(res.body.data.order.id);
  });

  it('with no export-default bank it refuses clearly and creates nothing', async () => {
    seed({ exportDefaultBank: false });
    const res = resStub();
    await quotations.convert({ params: { id: '5' }, user: { id: 1 } }, res);
    expect(res.code).toBe(400);
    expect(res.body.message).toMatch(/export-default bank/i);
    expect(exportOrderController.create).not.toHaveBeenCalled();
    expect(mockState.tables.export_quotations[0].converted_order_id).toBeNull();
  });

  it('two concurrent converts make one order; the second is refused', async () => {
    seed();
    const a = resStub(); const b = resStub();
    await Promise.all([
      quotations.convert({ params: { id: '5' }, user: { id: 1 } }, a),
      quotations.convert({ params: { id: '5' }, user: { id: 1 } }, b),
    ]);
    expect([a.code, b.code].sort()).toEqual([201, 409]);
    expect(exportOrderController.create).toHaveBeenCalledTimes(1);
    const refused = a.code === 409 ? a : b;
    expect(refused.body.message).toMatch(/already converted/i);
  });

  it('a failed create leaves the quotation unconverted and convertible', async () => {
    seed();
    exportOrderController.create.mockImplementationOnce(async (req, res) => res.status(400).json({ success: false, message: 'nope' }));
    const first = resStub();
    await quotations.convert({ params: { id: '5' }, user: { id: 1 } }, first);
    expect(first.code).toBe(400);
    expect(mockState.tables.export_quotations[0].converted_order_id).toBeNull();
    const second = resStub();
    await quotations.convert({ params: { id: '5' }, user: { id: 1 } }, second);
    expect(second.code).toBe(201);
  });

  it("carries each line's own bag and master bag onto the order; the header borrows none", async () => {
    seed();
    mockState.tables.export_quotation_items = [
      { quotation_id: 5, line_no: 1, product_id: 9, product_name: 'Super Basmati', qty_mt: 10, price_per_mt: 600,
        bag_size_kg: '2.00', bag_type: 'BOPP', master_bag_size_kg: '10.00', master_bag_type: 'PP Master' },
      { quotation_id: 5, line_no: 2, product_id: 9, product_name: 'Super Basmati', qty_mt: 10, price_per_mt: 600,
        bag_size_kg: '5.00', bag_type: 'PP', master_bag_size_kg: '20.00', master_bag_type: 'Carton' },
    ];
    const res = resStub();
    await quotations.convert({ params: { id: '5' }, user: { id: 1 } }, res);
    expect(res.code).toBe(201);
    const { body } = exportOrderController.create.mock.calls[0][0];
    expect(body.items.map((it) => [it.bag_size_kg, it.bag_type, it.master_bag_size_kg, it.master_bag_type])).toEqual([
      ['2.00', 'BOPP', '10.00', 'PP Master'],
      ['5.00', 'PP', '20.00', 'Carton'],
    ]);
    // Several lines: line 1's bag is NOT lent to the order header.
    expect(body.bag_size_kg).toBeUndefined();
    expect(body.bag_type).toBeUndefined();
    expect(body.master_bag_size_kg).toBeUndefined();
    expect(body.master_bag_type).toBeUndefined();
  });

  it("a one-line quotation's order header mirrors its line's bag", async () => {
    seed();
    Object.assign(mockState.tables.export_quotation_items[0], {
      bag_size_kg: '5.00', bag_type: 'PP', master_bag_size_kg: '20.00', master_bag_type: 'Carton',
    });
    const res = resStub();
    await quotations.convert({ params: { id: '5' }, user: { id: 1 } }, res);
    const { body } = exportOrderController.create.mock.calls[0][0];
    expect(body.items[0]).toMatchObject({ bag_size_kg: '5.00', master_bag_size_kg: '20.00', master_bag_type: 'Carton' });
    expect(body).toMatchObject({ bag_size_kg: '5.00', bag_type: 'PP', master_bag_size_kg: '20.00', master_bag_type: 'Carton' });
  });
});

describe('quotation normalizeItems', () => {
  it("keeps each line's master bag size and type", () => {
    const rows = quotations.normalizeItems([
      { product_id: '9', qty_mt: '10', price_per_mt: '600', bag_size_kg: '2', master_bag_size_kg: '10', master_bag_type: 'PP Master' },
      { product_id: '9', qty_mt: '10', price_per_mt: '600', bag_size_kg: '5', master_bag_size_kg: 20, master_bag_type: 'Carton' },
      { product_id: '9', qty_mt: '5', price_per_mt: '600', bag_size_kg: '50', master_bag_size_kg: '' },
    ]);
    expect(rows.map((r) => [r.bag_size_kg, r.master_bag_size_kg, r.master_bag_type])).toEqual([
      [2, 10, 'PP Master'],
      [5, 20, 'Carton'],
      [50, null, null],
    ]);
  });
});
