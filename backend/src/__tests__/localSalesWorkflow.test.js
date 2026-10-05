/**
 * Local-sales workflow (LS-07 … LS-12):
 *   - one payment for a multi-item sale splits oldest-line-first, all or nothing
 *   - a walk-in credit buyer only reuses a LOCAL customer with the same phone
 *   - Money In's local rows use COALESCE(due_date, sale_date) for due/aging/overdue
 *   - a typed sale date must be real and not in the future
 *   - a duplicate gate pass is refused before anything is saved
 */

// A transactional table-keyed fake. Writes inside db.transaction() go to a
// per-transaction log that is only committed when the callback resolves — a
// throw discards it, exactly like a ROLLBACK. Awaiting a builder resolves the
// table's row list; first() resolves the table's single row.
const mockState = { rows: {}, first: {}, committed: [], failPaymentInsertNo: 0, paymentInserts: 0 };
function mockBuilder(table, log) {
  const b = {};
  ['whereNot', 'whereIn', 'whereNull', 'whereRaw', 'orWhere', 'orderBy', 'select', 'forUpdate', 'leftJoin']
    .forEach((m) => { b[m] = () => b; });
  b.where = (...args) => { b._where = args; return b; };
  b.first = async () => mockState.first[table];
  b.then = (res, rej) => Promise.resolve(mockState.rows[table] || []).then(res, rej);
  b.update = async (patch) => { log.push({ op: 'update', table, patch, where: b._where }); return 1; };
  b.increment = async (col, amt) => { log.push({ op: 'increment', table, col, amt }); return 1; };
  b.insert = (row) => {
    if (table === 'payments') {
      mockState.paymentInserts += 1;
      if (mockState.paymentInserts === mockState.failPaymentInsertNo) throw new Error('simulated failure on line 2');
    }
    log.push({ op: 'insert', table, row });
    return { returning: async () => [{ id: 100 + log.length }] };
  };
  return b;
}
jest.mock('../config/database', () => {
  const db = (table) => mockBuilder(table, mockState.committed);
  db.transaction = async (cb) => {
    const log = [];
    const trx = (table) => mockBuilder(table, log);
    trx.fn = { now: () => 'now()' };
    trx.raw = (x) => x;
    const out = await cb(trx);
    mockState.committed.push(...log); // COMMIT
    return out;
  };
  db.fn = { now: () => 'now()' };
  db.raw = (x) => x;
  db.schema = { hasTable: async () => false };
  return db;
});
let mockDocNo = 0;
jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async (_t, { prefix }) => `${prefix}${++mockDocNo}`) }));
jest.mock('../shared/cashAccounts', () => ({ resolveCashAccountId: jest.fn(async () => 7) }));
jest.mock('../modules/localSales/receiptJournal', () => ({ postLocalReceiptJournal: jest.fn(async () => ({ id: 1 })) }));
jest.mock('../modules/accounting/accounting.service', () => ({
  createJournal: jest.fn(async () => ({ id: 1 })), postJournal: jest.fn(async () => ({})), autoPost: jest.fn(async () => ({})),
}));

const controller = require('../modules/localSales/localSales.controller');
const { postLocalReceiptJournal } = require('../modules/localSales/receiptJournal');
const { salePaymentStatus } = require('../modules/localSales/salePricing');

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const line = (id, due, extra = {}) => ({ id, sale_no: `LS-${id}`, sale_group_no: 'LS-1', status: 'Completed', total_amount: due, paid_amount: 0, due_amount: due, customer_id: 9, ...extra });
const committed = (op, table) => mockState.committed.filter((w) => w.op === op && w.table === table);

beforeEach(() => {
  mockState.rows = {}; mockState.first = {}; mockState.committed = [];
  mockState.failPaymentInsertNo = 0; mockState.paymentInserts = 0; mockDocNo = 0;
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('LS-08 one payment for a multi-item sale', () => {
  test('allocateOldestFirst settles each line in full before the next, lowest id first', () => {
    const out = controller.allocateOldestFirst(600, [line(3, 200), line(1, 300), line(2, 500)]);
    expect(out.map((a) => [a.sale.id, a.amount])).toEqual([[1, 300], [2, 300]]);
    expect(controller.allocateOldestFirst(1000, [line(1, 300), line(2, 0), line(3, 700)]).map((a) => [a.sale.id, a.amount]))
      .toEqual([[1, 300], [3, 700]]);
  });

  test('splits one receipt across the lines through the single-line receipt path', async () => {
    mockState.rows.local_sales = [line(1, 300), line(2, 500), line(3, 200)];
    const r = res();
    await controller.acceptGroupPayment({ params: { groupNo: 'LS-1' }, body: { amount: 600, payment_method: 'cash', collection_location: 'Head Office' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.data.applied.map((a) => [a.sale_id, a.amount])).toEqual([[1, 300], [2, 300]]);
    // One payments row per line, each tied to its line.
    expect(committed('insert', 'payments').map((w) => [w.row.local_sale_id, w.row.amount])).toEqual([[1, 300], [2, 300]]);
    // Line 1 closed, line 2 part-paid — in the one vocabulary.
    const saleUpdates = committed('update', 'local_sales').map((w) => w.patch);
    expect(saleUpdates[0]).toMatchObject({ paid_amount: 300, due_amount: 0, payment_status: 'Paid', collection_location: 'Head Office' });
    expect(saleUpdates[1]).toMatchObject({ paid_amount: 300, due_amount: 200, payment_status: 'Partial' });
    // Cash moved into the resolved cash account and journaled once per line.
    expect(committed('increment', 'bank_accounts').map((w) => w.amt)).toEqual([300, 300]);
    expect(postLocalReceiptJournal).toHaveBeenCalledTimes(2);
    expect(postLocalReceiptJournal.mock.calls.map((c) => c[1].amount)).toEqual([300, 300]);
  });

  test('refuses more than the sale\'s total due and writes nothing', async () => {
    mockState.rows.local_sales = [line(1, 300), line(2, 500)];
    const r = res();
    await controller.acceptGroupPayment({ params: { groupNo: 'LS-1' }, body: { amount: 900, payment_method: 'cash' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(mockState.committed).toHaveLength(0);
  });

  test('is all-or-nothing: a failure on the second line rolls the first back', async () => {
    mockState.rows.local_sales = [line(1, 300), line(2, 500)];
    mockState.failPaymentInsertNo = 2;
    const r = res();
    await controller.acceptGroupPayment({ params: { groupNo: 'LS-1' }, body: { amount: 800, payment_method: 'cash' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(500);
    expect(postLocalReceiptJournal).toHaveBeenCalledTimes(1); // line 1 got that far…
    expect(mockState.committed).toHaveLength(0);             // …and none of it stuck
  });

  test('a sale with no confirmed lines is refused with 409', async () => {
    mockState.rows.local_sales = [];
    const r = res();
    await controller.acceptGroupPayment({ params: { groupNo: 'LS-9' }, body: { amount: 10, payment_method: 'cash' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(409);
  });

  test('a bank transfer still needs its account', async () => {
    const r = res();
    await controller.acceptGroupPayment({ params: { groupNo: 'LS-1' }, body: { amount: 10, payment_method: 'bank_transfer' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
  });
});

describe('LS-07 one set of payment-status words', () => {
  test.each([
    [{ due: 0, paid: 100, paymentMode: 'cash' }, 'Paid'],
    [{ due: 50, paid: 50, paymentMode: 'cash' }, 'Partial'],
    [{ due: 100, paid: 0, paymentMode: 'credit' }, 'Credit'],
    [{ due: 100, paid: 0, paymentMode: 'cash' }, 'Credit'], // was 'Unpaid' — rejected by the CHECK constraint
  ])('%o → %s', (input, word) => {
    expect(salePaymentStatus(input)).toBe(word);
  });
});

describe('LS-11b walk-in credit buyer matching', () => {
  function recordingTrx(found) {
    const calls = [];
    const trx = (table) => {
      const b = {};
      ['where', 'whereRaw'].forEach((m) => { b[m] = (...args) => { calls.push({ table, m, args }); return b; }; });
      b.first = async () => found;
      b.insert = (row) => { calls.push({ table, m: 'insert', args: [row] }); return { returning: async () => [{ id: 55, ...row }] }; };
      return b;
    };
    trx.fn = { now: () => 'now()' };
    return { trx, calls };
  }

  test('with a phone, reuses only a LOCAL customer matching name AND phone digits', async () => {
    const { trx, calls } = recordingTrx({ id: 12, name: 'Ali Traders' });
    const c = await controller.resolveWalkInCustomer(trx, { name: 'Ali Traders', phone: '0300-123 4567', userId: 1 });
    expect(c.id).toBe(12);
    expect(calls).toContainEqual({ table: 'customers', m: 'where', args: ['customer_type', 'local'] });
    const raws = calls.filter((x) => x.m === 'whereRaw');
    expect(raws[0].args[1]).toEqual(['Ali Traders']);
    expect(raws[1].args[1]).toEqual(['03001234567']);
    expect(calls.some((x) => x.m === 'insert')).toBe(false);
  });

  test('with a phone and no local match, creates a new local customer', async () => {
    const { trx, calls } = recordingTrx(undefined);
    const c = await controller.resolveWalkInCustomer(trx, { name: 'Ali Traders', phone: '03001234567', userId: 1 });
    expect(c.id).toBe(55);
    expect(calls.find((x) => x.m === 'insert').args[0]).toMatchObject({ name: 'Ali Traders', customer_type: 'local', approval_status: 'pending' });
  });

  test('without a phone, never attaches to a same-named customer — always a new local one', async () => {
    const { trx, calls } = recordingTrx({ id: 12, name: 'Ali Traders' }); // would match by name
    const c = await controller.resolveWalkInCustomer(trx, { name: 'Ali Traders', phone: '', userId: 1 });
    expect(c.id).toBe(55);
    expect(calls.filter((x) => x.m !== 'insert')).toHaveLength(0); // no lookup at all
  });
});

describe('LS-09 Money In local rows: due date, aging and overdue', () => {
  const knex = require('knex')({ client: 'pg' });
  const { buildLocalReceivablesQuery } = require('../modules/finance/localReceivablesQuery');

  test('one row per sale, selected by amount owed on confirmed sales — not by status words', () => {
    const sql = buildLocalReceivablesQuery(knex, {}).toSQL().sql;
    expect(sql).toMatch(/group by COALESCE\(ls\.sale_group_no, ls\.sale_no\)/i);
    expect(sql).toMatch(/having SUM\(ls\.due_amount\) > 0/i);
    expect(sql).toMatch(/"ls"\."status" = \?/);
    expect(sql).not.toMatch(/payment_status/);
  });

  test('due date and aging come from COALESCE(due_date, sale_date)', () => {
    const sql = buildLocalReceivablesQuery(knex, {}).toSQL().sql;
    expect(sql).toContain('MIN(COALESCE(ls.due_date, ls.sale_date))::timestamptz as due_date');
    expect(sql).toContain('CURRENT_DATE - MIN(COALESCE(ls.due_date, ls.sale_date))::date');
    expect(sql).not.toMatch(/ls\.sale_date::timestamptz as due_date/);
  });

  test('the overdue filter is applied to local rows', () => {
    const plain = buildLocalReceivablesQuery(knex, {}).toSQL().sql;
    const od = buildLocalReceivablesQuery(knex, { overdue: 'true' }).toSQL().sql;
    expect(plain).not.toMatch(/lr\.due_date < CURRENT_DATE/);
    expect(od).toMatch(/lr\.due_date < CURRENT_DATE/);
  });
});

describe('LS-10 sale date', () => {
  const now = new Date('2026-10-05T10:00:00Z');
  test('absent keeps the old default', () => {
    expect(controller.validateSaleDate(undefined, now)).toEqual({ date: null });
    expect(controller.validateSaleDate('', now)).toEqual({ date: null });
  });
  test('today and past dates are accepted', () => {
    expect(controller.validateSaleDate('2026-10-05', now)).toEqual({ date: '2026-10-05' });
    expect(controller.validateSaleDate('2026-09-30', now)).toEqual({ date: '2026-09-30' });
  });
  test('one day of slack for a local date ahead of the server clock', () => {
    expect(controller.validateSaleDate('2026-10-06', now).date).toBe('2026-10-06');
  });
  test('future and malformed dates are refused', () => {
    expect(controller.validateSaleDate('2026-10-09', now).error).toMatch(/future/);
    expect(controller.validateSaleDate('2026-02-30', now).error).toMatch(/not a real date/);
    expect(controller.validateSaleDate('05/10/2026', now).error).toMatch(/YYYY-MM-DD/);
  });
  test('create refuses a future sale date before writing anything', async () => {
    const r = res();
    await controller.create({ body: { sale_date: '2099-01-01', buyer_name: 'X', items: [{ item_name: 'Rice', quantity_input: 1, rate_input: 1, item_type: 'charge' }] }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/future/);
    expect(mockState.committed).toHaveLength(0);
  });
});

describe('LS-12 gate pass is checked before save', () => {
  test('create returns 409 with the conflicting sale and writes nothing', async () => {
    mockState.first.local_sales = { id: 4, sale_no: 'LS-4', sale_group_no: 'LS-3', buyer_name: 'Bashir' };
    const r = res();
    await controller.create({ body: { gate_pass_no: ' GP-7 ', buyer_name: 'X', items: [{ item_name: 'Loading', quantity_input: 1, rate_input: 100, item_type: 'charge' }] }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ code: 'GATE_PASS_DUPLICATE', conflict: { id: 4, sale_group_no: 'LS-3' } });
    expect(mockState.committed).toHaveLength(0);
  });
});

describe('LS-12 editing an invoice edits the whole sale', () => {
  test('presentation fields are written to every line of the sale_group_no', async () => {
    mockState.first.local_sales = { id: 6, sale_no: 'LS-6', sale_group_no: 'LS-5', status: 'Completed', gate_pass_no: null };
    const r = res();
    await controller.update({ params: { id: '6' }, body: { buyer_name: 'Bashir & Sons', vehicle_no: 'LHR-1' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    const upd = committed('update', 'local_sales');
    expect(upd).toHaveLength(1);
    expect(upd[0].where).toEqual([{ sale_group_no: 'LS-5' }]);
    expect(upd[0].patch).toMatchObject({ buyer_name: 'Bashir & Sons', vehicle_no: 'LHR-1' });
  });

  test('a gate pass already on another sale is refused with 409 before saving', async () => {
    const sale = { id: 6, sale_no: 'LS-6', sale_group_no: 'LS-5', status: 'Completed', gate_pass_no: null };
    const other = { id: 99, sale_no: 'LS-99', sale_group_no: 'LS-98', buyer_name: 'Other' };
    // First local_sales lookup is the sale being edited, the second is the
    // gate-pass conflict query.
    let n = 0;
    mockState.first = new Proxy({}, { get: (_t, k) => (k === 'local_sales' ? (n++ === 0 ? sale : other) : undefined) });
    const r = res();
    await controller.update({ params: { id: '6' }, body: { gate_pass_no: 'GP-1', vehicle_no: 'LHR-2' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ code: 'GATE_PASS_DUPLICATE', conflict: { id: 99, sale_group_no: 'LS-98' } });
    expect(mockState.committed).toHaveLength(0);
  });
});
