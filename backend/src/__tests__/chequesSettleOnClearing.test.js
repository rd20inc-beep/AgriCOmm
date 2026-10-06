/**
 * Owner decision 2026-10-07: a cheque NEVER counts as money in the bank until it
 * is cleared — same-day cheques included. Recording one (Money In / Money Out,
 * Purchases, Expenses) settles nothing, moves no account and posts no journal;
 * Clear Cheque settles the document, moves the bank by the net and posts the
 * journal. Run against the in-memory knex so the real controller and service
 * code executes and the rows it leaves behind are inspected.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
let mockDocSeq = 0;
jest.mock('../utils/docNumber', () => ({
  nextDocNo: jest.fn(async (_trx, { prefix }) => `${prefix}${++mockDocSeq}`),
}));
jest.mock('../modules/accounting/accounting.service', () => {
  const journals = [];
  return {
    journals,
    createJournal: jest.fn(async (_trx, j) => { journals.push(j); return { id: 500 + journals.length }; }),
    postJournal: jest.fn(async () => ({})),
    autoPost: jest.fn(async () => null), // the expense accrual — not under test here
  };
});

const db = require('../config/database');
const accounting = require('../modules/accounting/accounting.service');
const financeController = require('../modules/finance/finance.controller');
const expensesService = require('../modules/expenses/expenses.service');

// ids: 1000→10, 1110→11, 1120→12, 1310→13, 2010→14, 2040→15, 2060→16, 4060→17
const COA = ['1000', '1110', '1120', '1310', '2010', '2040', '2060', '4060'].map((code, i) => ({ id: 10 + i, code, name: `Acct ${code}` }));
const TODAY = new Date().toISOString().slice(0, 10);

function seed(tables) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  for (const [k, rows] of Object.entries({ chart_of_accounts: COA, journal_entries: [], journal_lines: [], bank_transactions: [], payments: [], ...tables })) {
    db.tables[k] = rows.map((r) => ({ ...r }));
  }
  db.locks.length = 0;
  accounting.journals.length = 0;
}
function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const row = (table, id) => db.tables[table].find((r) => String(r.id) === String(id));
const lines = (j) => j.lines.map((l) => [l.account_id, l.debit, l.credit]);
const lastPayment = () => db.tables.payments[db.tables.payments.length - 1];
async function clear(id, body = {}) {
  const r = res();
  await financeController.clearCheque({ params: { id }, body, user: { id: 1 } }, r);
  return r;
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => console.error.mockRestore());

describe('Money Out: a same-day cheque against a payable', () => {
  const tables = () => ({
    payables: [{ id: 21, entity: 'mill', original_amount: 1000, paid_amount: 0, outstanding: 1000, status: 'Pending', supplier_id: 3 }],
    bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 5000, type: 'bank', entity: 'mill' }],
  });
  const body = { type: 'payment', linked_payable_id: 21, amount: 1000, currency: 'PKR', payment_method: 'cheque', bank_account_id: 8, payment_date: TODAY, due_date: TODAY, wht_amount: 50, discount_amount: 20 };

  test('records but settles nothing, moves no bank and posts no journal', async () => {
    seed(tables());
    const r = res();
    await financeController.recordPayment({ body, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body.data.payment).toMatchObject({ cleared: false, due_date: TODAY, bank_account_id: 8 });
    expect(row('payables', 21)).toMatchObject({ paid_amount: 0, outstanding: 1000, status: 'Pending' });
    expect(row('bank_accounts', 8).current_balance).toBe(5000);
    expect(db.tables.bank_transactions).toEqual([]);
    expect(accounting.journals).toEqual([]);
  });

  test('a cheque with no clearing date is due the day it was recorded', async () => {
    seed(tables());
    const r = res();
    await financeController.recordPayment({ body: { ...body, due_date: null, payment_date: '2026-10-05' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body.data.payment).toMatchObject({ cleared: false, due_date: '2026-10-05' });
  });

  test('clearing settles, moves the bank by the net and posts the journal with the WHT + discount split', async () => {
    seed(tables());
    await financeController.recordPayment({ body, user: { id: 1 } }, res());
    const p = lastPayment();
    const r = await clear(p.id);
    expect(r.statusCode).toBe(200);
    expect(row('payments', p.id).cleared).toBe(true);
    expect(row('payables', 21)).toMatchObject({ paid_amount: 1000, outstanding: 0, status: 'Paid' });
    expect(row('bank_accounts', 8).current_balance).toBe(4070);
    expect(db.tables.bank_transactions[0]).toMatchObject({ type: 'debit', amount: 930, source: 'cheque_clear' });
    expect(accounting.journals).toHaveLength(1);
    expect(accounting.journals[0]).toMatchObject({
      refType: 'Payment', refNo: p.payment_no, entity: 'mill', currency: 'PKR', partyType: 'supplier', partyId: 3,
    });
    expect(lines(accounting.journals[0])).toEqual([[14, 1000, 0], [10, 0, 930], [16, 0, 50], [17, 0, 20]]);
    expect(accounting.postJournal).toHaveBeenCalled();
  });

  test('clearing a second time does nothing', async () => {
    seed(tables());
    await financeController.recordPayment({ body, user: { id: 1 } }, res());
    const p = lastPayment();
    await clear(p.id);
    const r = await clear(p.id);
    expect(r.body.data).toEqual({ alreadyCleared: true });
    expect(accounting.journals).toHaveLength(1);
    expect(row('bank_accounts', 8).current_balance).toBe(4070);
  });

  test('clearing needs an account — refused when neither the cheque nor the clear names one', async () => {
    seed(tables());
    await financeController.recordPayment({ body: { ...body, bank_account_id: null }, user: { id: 1 } }, res());
    const p = lastPayment();
    expect(p.bank_account_id).toBeNull();
    const r = await clear(p.id);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/Choose the bank account/);
    expect(row('payments', p.id).cleared).toBe(false);
    expect(row('payables', 21).paid_amount).toBe(0);
    expect(accounting.journals).toEqual([]);

    const ok = await clear(p.id, { bank_account_id: 8 });
    expect(ok.statusCode).toBe(200);
    expect(row('payments', p.id).bank_account_id).toBe(8);
    expect(row('bank_accounts', 8).current_balance).toBe(4070);
    expect(accounting.journals).toHaveLength(1);
  });

  test('an uncleared cheque still counts against the outstanding', async () => {
    seed(tables());
    await financeController.recordPayment({ body: { ...body, amount: 600, wht_amount: 0, discount_amount: 0 }, user: { id: 1 } }, res());
    const r = res();
    await financeController.recordPayment({ body: { ...body, amount: 500, payment_method: 'bank_transfer', wht_amount: 0, discount_amount: 0 }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/outstanding balance of 400\.00 \(after 600\.00 in uncleared cheques\)/);
  });

  test('reversing a cheque that never cleared posts no deltas and moves nothing', async () => {
    seed(tables());
    await financeController.recordPayment({ body, user: { id: 1 } }, res());
    const p = lastPayment();
    const r = res();
    await financeController.reversePayment({ params: { id: String(p.id) }, body: { reason: 'bounced' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(row('payments', p.id).status).toBe('Reversed');
    expect(accounting.journals).toEqual([]);
    expect(db.tables.bank_transactions).toEqual([]);
    expect(row('bank_accounts', 8).current_balance).toBe(5000);
    expect(row('payables', 21).paid_amount).toBe(0);
  });

  test('a bank transfer still settles and journals at once', async () => {
    seed(tables());
    const r = res();
    await financeController.recordPayment({ body: { ...body, payment_method: 'bank_transfer' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body.data.payment.cleared).toBe(true);
    expect(row('payables', 21).status).toBe('Paid');
    expect(row('bank_accounts', 8).current_balance).toBe(4070);
    expect(lines(accounting.journals[0])).toEqual([[14, 1000, 0], [10, 0, 930], [16, 0, 50], [17, 0, 20]]);
  });
});

describe('Money In: a cheque receipt against an export receivable', () => {
  test('nothing at record; clear credits the receivable and posts Dr 1000 / Cr 1110', async () => {
    seed({
      receivables: [{ id: 31, expected_amount: 5000, received_amount: 0, outstanding: 5000, status: 'Pending', customer_id: 9, entity: 'export' }],
      bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 0, type: 'bank' }],
    });
    const r = res();
    await financeController.recordPayment({ body: { type: 'receipt', linked_receivable_id: 31, amount: 5000, currency: 'PKR', payment_method: 'cheque', payment_date: TODAY }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(row('receivables', 31).received_amount).toBe(0);
    expect(accounting.journals).toEqual([]);

    const p = lastPayment();
    const c = await clear(p.id, { bank_account_id: 8 });
    expect(c.statusCode).toBe(200);
    expect(row('receivables', 31)).toMatchObject({ received_amount: 5000, status: 'Paid' });
    expect(row('bank_accounts', 8).current_balance).toBe(5000);
    expect(accounting.journals[0]).toMatchObject({ refNo: p.payment_no, entity: 'export', partyType: 'customer', partyId: 9 });
    expect(lines(accounting.journals[0])).toEqual([[10, 5000, 0], [11, 0, 5000]]);
  });
});

describe('Purchases tab (payPurchase): a cheque', () => {
  const tables = () => ({
    inventory_lots: [{ id: 5, lot_no: 'LOT-5', entity: 'mill', supplier_id: 4, landed_cost_total: 800, paid_amount: 0, due_amount: 800, payment_status: 'Pending' }],
    payables: [{ id: 41, entity: 'mill', original_amount: 800, paid_amount: 0, outstanding: 800, status: 'Pending', supplier_id: 4, source_table: 'inventory_lots', source_id: 5, linked_ref: 'LOT-5' }],
    bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 2000, type: 'bank', entity: 'mill' }],
  });

  test('records uncleared with its source; clear settles the lot + payable and journals it', async () => {
    seed(tables());
    const r = res();
    await financeController.payPurchase({ body: { source: 'lot', source_id: 5, amount: 800, payment_method: 'cheque', bank_account_id: 8, payment_date: TODAY }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.data.uncleared).toBe(true);
    const p = lastPayment();
    expect(p).toMatchObject({ cleared: false, source_table: 'inventory_lots', source_id: 5, linked_payable_id: 41, due_date: TODAY });
    expect(row('inventory_lots', 5).paid_amount).toBe(0);
    expect(row('payables', 41).paid_amount).toBe(0);
    expect(row('bank_accounts', 8).current_balance).toBe(2000);
    expect(accounting.journals).toEqual([]);

    const c = await clear(p.id);
    expect(c.statusCode).toBe(200);
    expect(row('inventory_lots', 5)).toMatchObject({ paid_amount: 800, payment_status: 'Paid', due_amount: 0 });
    expect(row('payables', 41)).toMatchObject({ paid_amount: 800, status: 'Paid' });
    expect(row('bank_accounts', 8).current_balance).toBe(1200);
    expect(accounting.journals).toHaveLength(1);
    expect(accounting.journals[0]).toMatchObject({ refType: 'Payment', refNo: p.payment_no, entity: 'mill', partyType: 'supplier', partyId: 4 });
    expect(lines(accounting.journals[0])).toEqual([[14, 800, 0], [10, 0, 800]]);
  });

  test('a cleared Purchases-tab cheque reverses through its own journal', async () => {
    seed(tables());
    await financeController.payPurchase({ body: { source: 'lot', source_id: 5, amount: 800, payment_method: 'cheque', bank_account_id: 8 }, user: { id: 1 } }, res());
    const p = lastPayment();
    await clear(p.id);
    // What createJournal would have stored for the clear's journal.
    db.tables.journal_entries.push({ id: 90, ref_no: p.payment_no, ref_type: 'Payment', status: 'Posted', entity: 'mill', party_type: 'supplier', party_id: 4 });
    db.tables.journal_lines.push(
      { id: 1, journal_id: 90, account_id: 14, debit: 800, credit: 0 },
      { id: 2, journal_id: 90, account_id: 10, debit: 0, credit: 800 },
    );
    accounting.journals.length = 0;
    const r = res();
    await financeController.reversePayment({ params: { id: String(p.id) }, body: {}, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(row('inventory_lots', 5).paid_amount).toBe(0);
    expect(row('bank_accounts', 8).current_balance).toBe(2000);
    expect(accounting.journals).toHaveLength(1);
    expect(lines(accounting.journals[0])).toEqual([[14, 0, 800], [10, 800, 0]]);
  });
});

describe('Expenses: a cheque', () => {
  const tables = () => ({
    business_expenses: [{ id: 4, expense_no: 'EXP-4', amount_pkr: 300, paid_amount: 0, payment_status: 'Pending', expense_type: 'mill', category: 'salaries', supplier_id: null }],
    payables: [{ id: 31, original_amount: 300, paid_amount: 0, outstanding: 300, status: 'Pending', source_table: 'business_expenses', source_id: 4 }],
    bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 1000, type: 'bank' }],
  });

  test('markPaid with a same-day cheque settles nothing; clear pays it and journals against 2040', async () => {
    seed(tables());
    await expensesService.markPaid(4, { amount: 300, payment_method: 'cheque', paid_date: TODAY, due_date: TODAY }, 1);
    const p = lastPayment();
    expect(p).toMatchObject({ cleared: false, source_table: 'business_expenses', source_id: 4, linked_payable_id: 31 });
    expect(row('business_expenses', 4)).toMatchObject({ paid_amount: 0, payment_status: 'Pending' });
    expect(row('payables', 31).paid_amount).toBe(0);
    expect(row('bank_accounts', 8).current_balance).toBe(1000);
    expect(accounting.journals).toEqual([]);

    const c = await clear(p.id, { bank_account_id: 8 });
    expect(c.statusCode).toBe(200);
    expect(row('business_expenses', 4)).toMatchObject({ paid_amount: 300, payment_status: 'Paid', bank_account_id: 8, payment_method: 'cheque' });
    expect(row('payables', 31)).toMatchObject({ paid_amount: 300, status: 'Paid' });
    expect(row('bank_accounts', 8).current_balance).toBe(700);
    expect(accounting.journals[0]).toMatchObject({ refType: 'Payment', refNo: p.payment_no, entity: 'mill' });
    expect(lines(accounting.journals[0])).toEqual([[15, 300, 0], [10, 0, 300]]);
  });

  test('pay-now by cheque at create leaves the expense unpaid until it clears', async () => {
    seed({ bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 1000, type: 'bank' }], business_expenses: [], payables: [], suppliers: [] });
    const expense = await expensesService.create({
      expense_type: 'general', category: 'rent', amount: 250, currency: 'PKR', expense_date: TODAY,
      vendor_name: 'Landlord', pay_now: true, payment_method: 'cheque', payment_reference: 'CHQ-77',
    }, 1);
    expect(row('business_expenses', expense.id)).toMatchObject({ payment_status: 'Pending', paid_amount: 0 });
    const payable = db.tables.payables[0];
    expect(payable).toMatchObject({ paid_amount: 0, outstanding: 250, status: 'Pending' });
    const p = lastPayment();
    expect(p).toMatchObject({ cleared: false, payment_method: 'cheque', source_table: 'business_expenses', source_id: expense.id, linked_payable_id: payable.id, due_date: TODAY });
    expect(row('bank_accounts', 8).current_balance).toBe(1000);
    expect(db.tables.bank_transactions).toEqual([]);
    // Only the accrual (if any rule) — never a settlement under the payment number.
    expect(accounting.journals.filter((j) => j.refNo === p.payment_no)).toEqual([]);

    accounting.journals.length = 0;
    const c = await clear(p.id, { bank_account_id: 8 });
    expect(c.statusCode).toBe(200);
    expect(row('business_expenses', expense.id)).toMatchObject({ paid_amount: 250, payment_status: 'Paid' });
    expect(row('payables', payable.id)).toMatchObject({ paid_amount: 250, status: 'Paid' });
    expect(row('bank_accounts', 8).current_balance).toBe(750);
    expect(accounting.journals[0]).toMatchObject({ refNo: p.payment_no, entity: 'general' });
    expect(lines(accounting.journals[0])).toEqual([[14, 250, 0], [10, 0, 250]]);
  });
});

describe('cheques recorded under the old rules', () => {
  test('clearing a post-dated cheque that was journalled at recording settles and moves the bank but posts no second journal', async () => {
    seed({
      payments: [{ id: 6, payment_no: 'PAY-006', type: 'payment', payment_method: 'cheque', due_date: '2026-10-01', amount: 400, base_amount_pkr: 400, currency: 'PKR', cleared: false, status: 'Confirmed', linked_payable_id: 21, bank_account_id: 8 }],
      payables: [{ id: 21, original_amount: 400, paid_amount: 0, supplier_id: 3 }],
      bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 1000 }],
      journal_entries: [{ id: 70, ref_no: 'PAY-006', ref_type: 'Payment', status: 'Posted' }],
    });
    const r = await clear(6);
    expect(r.statusCode).toBe(200);
    expect(row('payables', 21)).toMatchObject({ paid_amount: 400, status: 'Paid' });
    expect(row('bank_accounts', 8).current_balance).toBe(600);
    expect(accounting.journals).toEqual([]);
  });
});

describe('Due Dates', () => {
  test('lists every uncleared cheque, one without a clearing date by its payment date', async () => {
    seed({
      payments: [
        { id: 6, payment_no: 'PAY-006', type: 'payment', payment_method: 'cheque', due_date: null, payment_date: '2026-10-07', amount: 70, cleared: false, status: 'Confirmed', linked_payable_id: 21, bank_account_id: 8 },
      ],
      payables: [], receivables: [], local_sales: [], fx_rates: [],
    });
    const u = res();
    await financeController.getUpcoming({ query: {} }, u);
    expect(u.statusCode).toBe(200);
    expect(u.body.data.giving).toHaveLength(1);
    expect(u.body.data.giving[0]).toMatchObject({ paymentId: 6, paymentNo: 'PAY-006', dueDate: '2026-10-07', bankAccountId: 8 });
  });

  test('a local sale lists once: as its pending cheque, else as one credit row per sale group', async () => {
    seed({
      payments: [
        // A cheque pending against sale 3 (its receivable is RCV-LS-3).
        { id: 7, payment_no: 'PL-7', type: 'receipt', payment_method: 'cheque', due_date: '2026-10-20', payment_date: '2026-10-07', amount: 400, base_amount_pkr: 400, currency: 'PKR', cleared: false, status: 'Confirmed', local_sale_id: 3, linked_receivable_id: 31 },
      ],
      receivables: [
        { id: 31, recv_no: 'RCV-LS-3', local_sale_id: 3, customer_id: 5, outstanding: 1000, status: 'Partial', due_date: '2026-10-15', currency: 'PKR' },
        { id: 32, recv_no: 'RCV-LS-4', local_sale_id: 4, customer_id: 6, outstanding: 300, status: 'Pending', due_date: '2026-10-12', currency: 'PKR' },
        { id: 33, recv_no: 'RCV-EX-1', customer_id: 7, outstanding: 50, status: 'Pending', due_date: '2026-11-01', currency: 'PKR' },
      ],
      local_sales: [
        { id: 3, sale_no: 'LS-3', sale_group_no: 'LS-3', status: 'Completed', due_amount: 1000, due_date: '2026-10-15', sale_date: '2026-10-01', customer_id: 5 },
        // A two-line credit sale, no promised date → one row, dated by the sale.
        { id: 4, sale_no: 'LS-4a', sale_group_no: 'LS-4', status: 'Completed', due_amount: 200, due_date: null, sale_date: '2026-10-02', customer_id: 6 },
        { id: 5, sale_no: 'LS-4b', sale_group_no: 'LS-4', status: 'Completed', due_amount: 100, due_date: null, sale_date: '2026-10-02', customer_id: 6 },
        // Unconfirmed / cancelled sales are not money expected.
        { id: 6, sale_no: 'LS-6', sale_group_no: 'LS-6', status: 'Pending', due_amount: 900, due_date: '2026-10-10', sale_date: '2026-10-03' },
        { id: 8, sale_no: 'LS-8', sale_group_no: 'LS-8', status: 'Cancelled', due_amount: 900, due_date: '2026-10-10', sale_date: '2026-10-03' },
      ],
      payables: [], fx_rates: [],
    });
    const u = res();
    await financeController.getUpcoming({ query: {} }, u);
    expect(u.statusCode).toBe(200);
    // (The in-memory knex does not resolve SQL column aliases, so the export
    // receivable's amount/ref are not asserted — only that it is listed.)
    const rows = u.body.data.receiving.map((x) => [x.label, String(x.dueDate).slice(0, 10)]);
    expect(rows).toEqual([
      ['Local sale (credit)', '2026-10-02'],
      ['Cheque (pending)', '2026-10-20'],
      ['Receivable', '2026-11-01'],
    ]);
    expect(u.body.data.receiving[0]).toMatchObject({ reference: 'LS-4', amount: 300, partyId: 6 });
    expect(u.body.data.receiving[1]).toMatchObject({ kind: 'cheque', amount: 400, paymentId: 7 });
  });
});
