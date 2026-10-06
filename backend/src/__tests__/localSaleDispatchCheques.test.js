/**
 * Owner decisions 2026-10-07 for local sales:
 *   1. goods do not leave before a manager confirms a clerk's sale — a Pending
 *      sale is not dispatched and gets no gate pass; confirming dispatches it
 *   2. a cheque is never money until it clears — a cheque taken at the sale is
 *      an UNCLEARED payment: the sale stays Credit, no bank move, no journal
 *   3. a walk-in credit buyer is identified by phone — required, matched on
 *      digits among local customers
 */

// A transactional table-keyed fake. Writes inside db.transaction() go to a
// per-transaction log committed only when the callback resolves (a throw is a
// ROLLBACK). first() resolves mockState.first[table]; awaiting a builder
// resolves mockState.rows[table]; insert().returning() echoes the row back.
const mockState = { rows: {}, first: {}, committed: [] };
let mockId = 0;
function mockBuilder(table, log) {
  const b = {};
  ['whereNot', 'whereIn', 'whereNotIn', 'whereNull', 'whereNotNull', 'whereRaw', 'orWhere', 'orderBy', 'select', 'forUpdate', 'leftJoin', 'limit', 'sum', 'groupBy']
    .forEach((m) => { b[m] = () => b; });
  b.where = (...args) => { b._where = args; return b; };
  b.first = async () => {
    const f = mockState.first[table];
    return typeof f === 'function' ? f(b._where) : f;
  };
  b.then = (res, rej) => Promise.resolve(mockState.rows[table] || []).then(res, rej);
  b.update = async (patch) => { log.push({ op: 'update', table, patch, where: b._where }); return 1; };
  b.increment = async (col, amt) => { log.push({ op: 'increment', table, col, amt }); return 1; };
  b.insert = (row) => {
    log.push({ op: 'insert', table, row });
    return { returning: async () => [{ id: ++mockId, ...row }] };
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

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const committed = (op, table) => mockState.committed.filter((w) => w.op === op && w.table === table);
const today = () => new Date().toISOString().split('T')[0];
// One service-charge line: no lot, so no stock movement — the tests are about
// dispatch, money and identity, not stock.
const ITEM = { item_name: 'Rice', item_type: 'charge', quantity_input: 1, quantity_unit: 'kg', bag_weight_kg: 1, rate_input: 1000, rate_unit: 'kg' };
const CLERK = { id: 4, role_id: 20 };
const MANAGER = { id: 2, role_id: 30 };

beforeEach(() => {
  mockState.rows = {}; mockState.committed = []; mockDocNo = 0; mockId = 0;
  // role_id 30 is a Mill Manager (auto-confirms); anything else is a clerk.
  mockState.first = { roles: (where) => (where && where[1] === 30 ? { name: 'Mill Manager' } : { name: 'Mill Operator' }) };
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('1. a clerk\'s sale does not leave before a manager confirms it', () => {
  test('a Pending sale is saved NOT dispatched, with no dispatch date — even when the form says dispatched', async () => {
    const r = res();
    await controller.create({ body: { customer_id: 9, payment_mode: 'cash', dispatched: true, items: [ITEM] }, user: CLERK }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body.data.pending).toBe(true);
    const [sale] = committed('insert', 'local_sales').map((w) => w.row);
    expect(sale).toMatchObject({ status: 'Pending', dispatched: false, dispatch_date: null });
    // …and nothing moved: no receipt, no bank, no journal.
    expect(committed('insert', 'payments')).toHaveLength(0);
    expect(postLocalReceiptJournal).not.toHaveBeenCalled();
  });

  test('a manager\'s own sale is confirmed and dispatched at once', async () => {
    const r = res();
    await controller.create({ body: { customer_id: 9, payment_mode: 'cash', items: [ITEM] }, user: MANAGER }, r);
    expect(r.statusCode).toBe(201);
    const [sale] = committed('insert', 'local_sales').map((w) => w.row);
    expect(sale).toMatchObject({ status: 'Completed', dispatched: true });
    expect(sale.dispatch_date).toBeTruthy();
  });

  test('confirming dispatches it, dated the day of confirmation', async () => {
    const pending = { id: 11, sale_no: 'LS-11', sale_group_no: 'LS-11', status: 'Pending', item_name: 'Rice', total_amount: 1000, paid_amount: 1000, due_amount: 0, payment_mode: 'cash', customer_id: 9, sale_date: '2026-10-01', dispatched: false };
    mockState.first.local_sales = pending;
    mockState.rows.local_sales = [pending];
    const r = res();
    await controller.confirmSale({ params: { id: '11' }, user: MANAGER }, r);
    expect(r.statusCode).toBe(200);
    const done = committed('update', 'local_sales').map((w) => w.patch).find((p) => p.status === 'Completed');
    expect(done).toMatchObject({ status: 'Completed', dispatched: true, dispatch_date: today() });
  });
});

describe('1. no gate pass for a sale awaiting confirmation', () => {
  const base = (status) => ({ id: 11, sale_no: 'LS-11', sale_group_no: 'LS-11', status, gate_pass_no: 'GP-7', total_amount: 1000, paid_amount: 0, due_amount: 1000, dispatched: status === 'Completed' });

  test('Pending → 409 "Awaiting manager confirmation"', async () => {
    mockState.first['local_sales as ls'] = base('Pending');
    const r = res();
    await controller.getGatePass({ params: { id: '11' } }, r);
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ success: false, code: 'AWAITING_CONFIRMATION' });
    expect(r.body.message).toMatch(/^Awaiting manager confirmation/);
  });

  test('a confirmed sale gets its gate pass, and the invoice says it is dispatched', async () => {
    mockState.first['local_sales as ls'] = base('Completed');
    const r = res();
    await controller.getGatePass({ params: { id: '11' } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.data.sale).toMatchObject({ gatePassNo: 'GP-7', status: 'Completed' });
    expect(r.body.data.dispatch).toMatchObject({ awaitingConfirmation: false, deliveryStatus: 'Dispatched' });
  });

  test('the invoice of a Pending sale reads "Not yet dispatched — awaiting confirmation"', async () => {
    mockState.first['local_sales as ls'] = base('Pending');
    const r = res();
    await controller.getInvoice({ params: { id: '11' } }, r);
    expect(r.body.data.dispatch).toMatchObject({ awaitingConfirmation: true, deliveryStatus: 'Not yet dispatched — awaiting confirmation' });
  });

  test('gatePassRefusal: a rejected sale has nothing to release; a confirmed one is fine', () => {
    expect(controller.gatePassRefusal({ status: 'Cancelled', invoiceNo: 'LS-1' }).code).toBe('SALE_REJECTED');
    expect(controller.gatePassRefusal({ status: 'Completed', invoiceNo: 'LS-1' })).toBeNull();
  });
});

describe('2. a cheque taken at the sale settles nothing until it clears', () => {
  test('recorded uncleared and dated; the sale stays Credit with its receivable open; no bank, no journal', async () => {
    const r = res();
    await controller.create({
      body: { customer_id: 9, payment_mode: 'cheque', payment_reference: 'CHQ-123', sale_date: today(), items: [ITEM] },
      user: MANAGER,
    }, r);
    expect(r.statusCode).toBe(201);

    // The line is saved, then put back to owed-in-full.
    const settle = committed('update', 'local_sales').map((w) => w.patch).find((p) => p.paid_amount === 0);
    expect(settle).toMatchObject({ paid_amount: 0, due_amount: 1000, payment_status: 'Credit' });
    expect(r.body.data.sale).toMatchObject({ paid_amount: 0, due_amount: 1000, payment_status: 'Credit' });

    // One uncleared cheque, carrying a date so Due Dates lists it.
    const pays = committed('insert', 'payments').map((w) => w.row);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ payment_method: 'cheque', cleared: false, amount: 1000, bank_reference: 'CHQ-123', due_date: today(), type: 'receipt' });

    // The whole total is still owed.
    const [rcv] = committed('insert', 'receivables').map((w) => w.row);
    expect(rcv).toMatchObject({ outstanding: 1000, received_amount: 0, status: 'Pending', customer_id: 9 });

    // Nothing reached a bank account or the GL as a receipt.
    expect(committed('increment', 'bank_accounts')).toHaveLength(0);
    expect(committed('insert', 'bank_transactions')).toHaveLength(0);
    expect(postLocalReceiptJournal).not.toHaveBeenCalled();
  });

  test('the cheque date typed on the form is kept', async () => {
    const r = res();
    await controller.create({ body: { customer_id: 9, payment_mode: 'cheque', payment_reference: 'C1', due_date: '2026-12-01', items: [ITEM] }, user: MANAGER }, r);
    expect(committed('insert', 'payments')[0].row).toMatchObject({ cleared: false, due_date: '2026-12-01' });
  });

  test('a clerk\'s cheque sale shows Credit while Pending, and confirmation records the cheque uncleared', async () => {
    const r = res();
    await controller.create({ body: { customer_id: 9, payment_mode: 'cheque', payment_reference: 'C1', items: [ITEM] }, user: CLERK }, r);
    const row = committed('insert', 'local_sales')[0].row;
    expect(row).toMatchObject({ status: 'Pending', payment_status: 'Credit' });
    expect(committed('insert', 'payments')).toHaveLength(0);

    // The manager confirms it.
    const pending = { id: 21, ...row, sale_group_no: 'LS-21' };
    mockState.first.local_sales = pending;
    mockState.rows.local_sales = [pending];
    mockState.committed = [];
    const c = res();
    await controller.confirmSale({ params: { id: '21' }, user: MANAGER }, c);
    expect(c.statusCode).toBe(200);
    expect(committed('insert', 'payments').map((w) => w.row)).toEqual([expect.objectContaining({ cleared: false, amount: 1000, payment_method: 'cheque' })]);
    expect(committed('update', 'local_sales').map((w) => w.patch)).toContainEqual(expect.objectContaining({ paid_amount: 0, due_amount: 1000, payment_status: 'Credit' }));
    expect(committed('increment', 'bank_accounts')).toHaveLength(0);
    expect(postLocalReceiptJournal).not.toHaveBeenCalled();
  });
});

describe('3. a walk-in credit buyer is identified by phone', () => {
  test('a walk-in credit sale without a phone is refused (400) before anything is written', async () => {
    const r = res();
    await controller.create({ body: { buyer_name: 'Ali', payment_mode: 'credit', items: [ITEM] }, user: MANAGER }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('WALK_IN_PHONE_REQUIRED');
    expect(r.body.message).toMatch(/phone/);
    expect(mockState.committed).toHaveLength(0);
  });

  test('a walk-in paying by cheque is a credit buyer too — phone required', async () => {
    const r = res();
    await controller.create({ body: { buyer_name: 'Ali', payment_mode: 'cheque', payment_reference: 'C1', items: [ITEM] }, user: MANAGER }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('WALK_IN_PHONE_REQUIRED');
  });

  test('a cash walk-in needs no phone and creates no customer', async () => {
    const r = res();
    await controller.create({ body: { buyer_name: 'Ali', payment_mode: 'cash', items: [ITEM] }, user: MANAGER }, r);
    expect(r.statusCode).toBe(201);
    expect(committed('insert', 'customers')).toHaveLength(0);
  });

  test('a phone that matches a local customer reuses them — even under another name — and updates nothing', async () => {
    mockState.first.customers = { id: 12, name: 'Ali Traders', phone: '0300-1234567', customer_type: 'local' };
    const r = res();
    await controller.create({ body: { buyer_name: 'Ali Bhai', buyer_phone: '03001234567', payment_mode: 'credit', items: [ITEM] }, user: MANAGER }, r);
    expect(r.statusCode).toBe(201);
    expect(committed('insert', 'customers')).toHaveLength(0);
    expect(committed('update', 'customers')).toHaveLength(0);
    expect(committed('insert', 'local_sales')[0].row.customer_id).toBe(12);
    expect(committed('insert', 'receivables')[0].row.customer_id).toBe(12);
  });

  test('a new phone creates a local customer that stores it', async () => {
    const r = res();
    await controller.create({ body: { buyer_name: 'Ali', buyer_phone: '0300 7654321', payment_mode: 'credit', items: [ITEM] }, user: MANAGER }, r);
    expect(r.statusCode).toBe(201);
    const [cust] = committed('insert', 'customers').map((w) => w.row);
    expect(cust).toMatchObject({ name: 'Ali', phone: '0300 7654321', customer_type: 'local' });
  });
});
