/**
 * Local-sale receipts and edits:
 *   - a payment is only taken on a CONFIRMED sale (LS-01)
 *   - every settling receipt posts Dr 1000 / Cr 1120, stamped to the customer (LS-03)
 *   - the customer statement does not show a journaled receipt twice (LS-03)
 *   - editing a Pending sale recomputes cost / profit, not just the total (LS-04)
 */

// A tiny table-keyed query-builder fake. Each db('table') call returns a
// chainable builder; first() resolves the table's row, update/insert are
// recorded so a test can assert what was (or was not) written.
const mockState = { rows: {}, updates: [], inserts: [] };
function mockBuilder(table) {
  const b = {
    where: () => b, whereNot: () => b, whereIn: () => b, whereNotIn: () => b, forUpdate: () => b,
    orderBy: () => b, select: () => b, returning: async () => [{ id: 99 }],
    first: async () => mockState.rows[table],
    update: async (patch) => { mockState.updates.push({ table, patch }); return 1; },
    increment: async () => 1,
    insert: (row) => { mockState.inserts.push({ table, row }); return b; },
    // Awaiting a list query (e.g. uncleared cheques on a sale) → the table's list.
    then: (res, rej) => Promise.resolve((mockState.lists || {})[table] || []).then(res, rej),
  };
  return b;
}
jest.mock('../config/database', () => {
  const db = (table) => mockBuilder(table);
  db.transaction = async (cb) => cb(db);
  db.fn = { now: () => 'now()' };
  db.raw = (x) => x;
  return db;
});
jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async () => 'PL-7') }));
jest.mock('../modules/accounting/accounting.service', () => ({
  createJournal: jest.fn(async (_trx, j) => ({ id: 501, ...j })),
  postJournal: jest.fn(async () => ({})),
  autoPost: jest.fn(async () => ({})),
  receiptsWithoutJournal: jest.requireActual('../modules/accounting/accounting.service').receiptsWithoutJournal,
}));

const controller = require('../modules/localSales/localSales.controller');
const accountingService = require('../modules/accounting/accounting.service');
const { buildLocalReceiptJournal, postLocalReceiptJournal } = require('../modules/localSales/receiptJournal');
const { priceSaleLine } = require('../modules/localSales/salePricing');

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

beforeEach(() => {
  mockState.rows = {}; mockState.updates = []; mockState.inserts = []; mockState.lists = {};
  jest.clearAllMocks();
});

describe('acceptPayment only settles a confirmed sale', () => {
  test.each(['Pending', 'Cancelled'])('a %s sale is refused with 409 and nothing is written', async (status) => {
    mockState.rows.local_sales = { id: 5, sale_no: 'LS-0005', status, total_amount: 1000, paid_amount: 0, due_amount: 1000 };
    const r = res();
    await controller.acceptPayment({ params: { id: '5' }, body: { amount: 500, payment_method: 'cash' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(409);
    expect(r.body.success).toBe(false);
    expect(mockState.inserts).toHaveLength(0);
    expect(mockState.updates).toHaveLength(0);
    expect(accountingService.createJournal).not.toHaveBeenCalled();
  });

  test('the due check runs against the locked row, inside the transaction', async () => {
    mockState.rows.local_sales = { id: 5, sale_no: 'LS-0005', status: 'Completed', total_amount: 1000, paid_amount: 800, due_amount: 200 };
    const r = res();
    await controller.acceptPayment({ params: { id: '5' }, body: { amount: 500, payment_method: 'cash' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(mockState.inserts).toHaveLength(0);
  });

  test('a completed sale takes the receipt and journals it Dr 1000 / Cr 1120 to the customer', async () => {
    mockState.rows.local_sales = { id: 5, sale_no: 'LS-0005', customer_id: 42, status: 'Completed', total_amount: 1000, paid_amount: 0, due_amount: 1000 };
    mockState.rows.chart_of_accounts = { id: 1, code: '1000', name: 'Cash & Bank' }; // both lookups resolve to a row
    mockState.rows.journal_entries = undefined; // no journal yet for PL-7
    const r = res();
    await controller.acceptPayment({ params: { id: '5' }, body: { amount: 400, payment_method: 'bank_transfer', bank_account_id: 3 }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(accountingService.createJournal).toHaveBeenCalledTimes(1);
    const j = accountingService.createJournal.mock.calls[0][1];
    expect(j).toMatchObject({ refNo: 'PL-7', entity: 'mill', currency: 'PKR', partyType: 'customer', partyId: 42 });
    expect(accountingService.postJournal).toHaveBeenCalledWith(expect.anything(), 501);
  });

  test.each([
    ['post-dated', new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)],
    ['same-day', new Date().toISOString().slice(0, 10)],
    ['undated', undefined],
  ])('a %s cheque is recorded uncleared: no settlement, no bank move, no journal', async (_label, dueDate) => {
    mockState.rows.local_sales = { id: 5, sale_no: 'LS-0005', customer_id: 42, status: 'Completed', total_amount: 1000, paid_amount: 0, due_amount: 1000 };
    const r = res();
    await controller.acceptPayment({ params: { id: '5' }, body: { amount: 400, payment_method: 'cheque', due_date: dueDate, reference: 'CHQ-1' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    const pay = mockState.inserts.find((i) => i.table === 'payments').row;
    expect(pay).toMatchObject({ cleared: false, payment_method: 'cheque', local_sale_id: 5, amount: 400 });
    // Always dated, so Due Dates (which lists dated uncleared cheques) shows it.
    expect(pay.due_date).toBe(dueDate || new Date().toISOString().split('T')[0]);
    // The sale is not settled, no account moves, nothing reaches the GL.
    expect(mockState.updates.filter((u) => u.table === 'local_sales' || u.table === 'receivables')).toHaveLength(0);
    expect(mockState.inserts.find((i) => i.table === 'bank_transactions')).toBeUndefined();
    expect(accountingService.createJournal).not.toHaveBeenCalled();
  });

  test('uncleared cheques already on the sale leave room — the sale cannot be collected twice', async () => {
    mockState.rows.local_sales = { id: 5, sale_no: 'LS-0005', customer_id: 42, status: 'Completed', total_amount: 1000, paid_amount: 0, due_amount: 1000 };
    mockState.lists.payments = [{ local_sale_id: 5, amount: '700' }];
    const r = res();
    await controller.acceptPayment({ params: { id: '5' }, body: { amount: 500, payment_method: 'cash' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/cheques waiting to clear/);
    expect(mockState.inserts).toHaveLength(0);
  });
});

describe('receipt journal', () => {
  const cashAcc = { id: 10, code: '1000', name: 'Cash & Bank' };
  const arAcc = { id: 20, code: '1120', name: 'Local AR' };

  test('lines are Dr 1000 / Cr 1120 for the amount, stamped to the sale customer', () => {
    const j = buildLocalReceiptJournal({ cashAcc, arAcc, amount: 1234.5, paymentNo: 'PL-3', sale: { sale_no: 'LS-0001', customer_id: 7 }, date: '2026-10-01' });
    expect(j.lines).toEqual([
      expect.objectContaining({ account_id: 10, debit: 1234.5, credit: 0 }),
      expect.objectContaining({ account_id: 20, debit: 0, credit: 1234.5 }),
    ]);
    expect(j).toMatchObject({ refNo: 'PL-3', entity: 'mill', currency: 'PKR', fxRate: 1, partyType: 'customer', partyId: 7, date: '2026-10-01' });
  });

  test('a walk-in sale (no customer) posts unstamped', () => {
    const j = buildLocalReceiptJournal({ cashAcc, arAcc, amount: 100, paymentNo: 'PL-4', sale: { sale_no: 'LS-0002', customer_id: null } });
    expect(j.partyType).toBeNull();
    expect(j.partyId).toBeNull();
  });

  test('is idempotent — a payment that already has a journal is left alone', async () => {
    const trx = (table) => ({ where: () => ({ first: async () => (table === 'journal_entries' ? { id: 1 } : cashAcc) }) });
    const out = await postLocalReceiptJournal(trx, { paymentNo: 'PL-5', amount: 100, sale: { customer_id: 1 } });
    expect(out).toBeNull();
    expect(accountingService.createJournal).not.toHaveBeenCalled();
  });

  test('posts the journal it creates', async () => {
    const trx = (table) => ({ where: ({ code } = {}) => ({ first: async () => (table === 'journal_entries' ? undefined : (code === '1000' ? cashAcc : arAcc)) }) });
    await postLocalReceiptJournal(trx, { paymentNo: 'PL-6', amount: 250, sale: { sale_no: 'LS-0009', customer_id: 3 } });
    const j = accountingService.createJournal.mock.calls[0][1];
    expect(j.lines.map((l) => [l.account_id, l.debit, l.credit])).toEqual([[10, 250, 0], [20, 0, 250]]);
    expect(accountingService.postJournal).toHaveBeenCalledWith(trx, 501);
  });
});

describe('customer statement does not double count a journaled local receipt', () => {
  const { receiptsWithoutJournal } = jest.requireActual('../modules/accounting/accounting.service');

  test('a receipt whose journal the statement already includes is dropped from the payments rows', () => {
    const pays = [
      { payment_no: 'PL-1', amount: 500 },   // journaled → comes from the journal scan
      { payment_no: 'PAY-004', amount: 300 }, // historic, no journal → stays
    ];
    const shown = receiptsWithoutJournal(pays, ['PL-1']);
    expect(shown.map((p) => p.payment_no)).toEqual(['PAY-004']);
    // Journal credit (500) + remaining payment rows (300) = every receipt once.
    const journalCredits = 500;
    expect(journalCredits + shown.reduce((s, p) => s + p.amount, 0)).toBe(800);
  });

  test('with no journals every receipt still shows', () => {
    const pays = [{ payment_no: 'PL-1', amount: 1 }, { payment_no: 'PL-2', amount: 2 }];
    expect(receiptsWithoutJournal(pays, [])).toHaveLength(2);
  });
});

describe('editing a Pending sale recomputes cost and profit', () => {
  test('priceSaleLine: halving the quantity halves landed cost and recomputes margin', () => {
    const created = priceSaleLine({ qtyKg: 1000, total: 150000, costPerKg: 100, bagWt: 50, isMillItem: false });
    expect(created).toEqual({ cost_per_kg: 100, landed_cost_total: 100000, gross_profit: 50000, profit_per_kg: 50, margin_pct: 33.33, quantity_bags: 20 });
    const edited = priceSaleLine({ qtyKg: 500, total: 75000, costPerKg: 100, bagWt: 50, isMillItem: false });
    expect(edited).toEqual({ cost_per_kg: 100, landed_cost_total: 50000, gross_profit: 25000, profit_per_kg: 50, margin_pct: 33.33, quantity_bags: 10 });
  });

  test('a mill-item line counts pieces, not bags', () => {
    expect(priceSaleLine({ qtyKg: 12, total: 600, costPerKg: 20, bagWt: 0, isMillItem: true }))
      .toMatchObject({ landed_cost_total: 240, gross_profit: 360, quantity_bags: 12 });
  });

  test('update() writes the recomputed cost/profit fields and create\'s payment status', async () => {
    mockState.rows.local_sales = {
      id: 8, sale_no: 'LS-0008', status: 'Pending', lot_id: 4, payment_mode: 'cash',
      quantity_input: 20, quantity_unit: 'katta', bag_weight_kg: 50, rate_input: 7500, rate_unit: 'katta',
      paid_amount: 0, landed_cost_total: 100000, gross_profit: 50000,
    };
    mockState.rows.inventory_lots = { id: 4, lot_no: 'L-4', available_qty: 5000, landed_cost_per_kg: 100 };
    const r = res();
    await controller.update({ params: { id: '8' }, body: { quantity_input: 10 }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    const patch = mockState.updates.find((u) => u.table === 'local_sales').patch;
    expect(patch).toMatchObject({
      quantity_kg: 500, total_amount: 75000, due_amount: 75000,
      landed_cost_total: 50000, gross_profit: 25000, profit_per_kg: 50, margin_pct: 33.33, quantity_bags: 10,
      payment_status: 'Credit',
    });
  });
});
