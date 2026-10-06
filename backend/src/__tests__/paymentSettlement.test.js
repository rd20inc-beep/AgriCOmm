/**
 * Money safety for record / clear / reverse — run against the in-memory knex
 * (helpers/fakeKnex), so the real controller and service code executes and the
 * rows it leaves behind are inspected:
 *
 *  - a payment over a payable's outstanding (net of uncleared cheques) is refused;
 *  - the payable / source row is read under a row lock;
 *  - a reversed cheque cannot be cleared and is not listed as upcoming;
 *  - reversing a cheque that never cleared leaves the payable alone;
 *  - clearing a cheque moves the bank by the NET (after WHT), in the account's currency;
 *  - reversing a receipt restores the receivable / sale / bank and posts the
 *    signed delta of the receipt's journal;
 *  - every source row hears about a payment, expenses included.
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
  };
});

const db = require('../config/database');
const accounting = require('../modules/accounting/accounting.service');
const financeController = require('../modules/finance/finance.controller');
const expensesService = require('../modules/expenses/expenses.service');

const COA = ['1000', '1110', '1120', '1310', '2010', '2040', '2060', '4060'].map((code, i) => ({ id: 10 + i, code, name: `Acct ${code}` }));

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

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => console.error.mockRestore());

describe('recordPayment against a payable', () => {
  const base = () => ({
    payables: [{ id: 21, entity: 'mill', original_amount: 500, paid_amount: 300, outstanding: 200, status: 'Partial', supplier_id: 3, source_table: 'printed_bag_orders', source_id: 7 }],
    printed_bag_orders: [{ id: 7, total_amount: 500, paid_amount: 300, payment_status: 'Partial' }],
    bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 10000, type: 'bank' }],
    payments: [{ id: 1, payment_no: 'PAY-001', type: 'payment', linked_payable_id: 21, amount: 100, cleared: false, status: 'Confirmed' }],
  });
  const body = (amount) => ({ type: 'payment', linked_payable_id: 21, amount, currency: 'PKR', payment_method: 'bank_transfer', bank_account_id: 8, payment_date: '2026-10-01' });

  test('refuses more than the outstanding left after uncleared cheques', async () => {
    seed(base());
    const r = res();
    await financeController.recordPayment({ body: body(150), user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/exceeds the outstanding balance of 100\.00 \(after 100\.00 in uncleared cheques\)/);
    expect(row('payables', 21).paid_amount).toBe(300);
    expect(db.tables.payments).toHaveLength(1);
  });

  test('settles under a lock and mirrors onto the printed-bag order', async () => {
    seed(base());
    const r = res();
    await financeController.recordPayment({ body: body(100), user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(db.locks.map((l) => l.table)).toEqual(expect.arrayContaining(['payables', 'printed_bag_orders']));
    expect(row('payables', 21)).toMatchObject({ paid_amount: 400, outstanding: 100, status: 'Partial' });
    expect(row('printed_bag_orders', 7)).toMatchObject({ paid_amount: 400, payment_status: 'Partial' });
    expect(row('bank_accounts', 8).current_balance).toBe(9900);
  });

  test('a foreign payment with no order rate converts at the latest rate, not 280', async () => {
    seed({ ...base(), fx_rates: [{ id: 1, from_currency: 'USD', to_currency: 'PKR', is_active: true, rate: 300, effective_date: '2026-10-01' }] });
    db.tables.payables[0].original_amount = 100000; db.tables.payables[0].paid_amount = 0;
    const r = res();
    await financeController.recordPayment({ body: { ...body(10), currency: 'USD' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body.data.payment).toMatchObject({ fx_rate: 300, base_amount_pkr: 3000 });
  });
});

describe('cheques', () => {
  test('a reversed cheque cannot be cleared and is not listed as upcoming', async () => {
    seed({
      payments: [
        { id: 5, payment_no: 'PAY-005', type: 'payment', payment_method: 'cheque', due_date: '2026-12-01', amount: 100, cleared: false, status: 'Reversed', linked_payable_id: 21 },
        { id: 6, payment_no: 'PAY-006', type: 'payment', payment_method: 'cheque', due_date: '2026-12-02', amount: 70, cleared: false, status: 'Confirmed', linked_payable_id: 21 },
      ],
      payables: [{ id: 21, original_amount: 500, paid_amount: 0 }],
      receivables: [], local_sales: [], bank_accounts: [],
    });
    const r = res();
    await financeController.clearCheque({ params: { id: 5 }, body: {}, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/reversed — it cannot be cleared/);
    expect(row('payments', 5).cleared).toBe(false);
    expect(row('payables', 21).paid_amount).toBe(0);

    const u = res();
    await financeController.getUpcoming({ query: {} }, u);
    expect(u.statusCode).toBe(200);
    expect(u.body.data.giving.map((g) => g.paymentId)).toEqual([6]);
  });

  test('clearing moves the bank by the net after WHT and discount', async () => {
    seed({
      payments: [{ id: 6, payment_no: 'PAY-006', type: 'payment', payment_method: 'cheque', amount: 1000, base_amount_pkr: 1000, currency: 'PKR', wht_amount: 50, discount_amount: 20, cleared: false, status: 'Confirmed', linked_payable_id: 21, bank_account_id: 8 }],
      payables: [{ id: 21, original_amount: 1000, paid_amount: 0, hauler_id: 4 }],
      transport_costs: [{ id: 2, payable_id: 21, status: 'unpaid' }],
      bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 5000 }],
    });
    const r = res();
    await financeController.clearCheque({ params: { id: 6 }, body: {}, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(row('bank_accounts', 8).current_balance).toBe(4070);
    expect(db.tables.bank_transactions[0]).toMatchObject({ amount: 930, type: 'debit', currency: 'PKR' });
    expect(row('payables', 21)).toMatchObject({ paid_amount: 1000, status: 'Paid' });
    expect(row('transport_costs', 2).status).toBe('paid');
  });

  test('a USD cheque into a USD account moves dollars and says so', async () => {
    seed({
      payments: [{ id: 7, payment_no: 'PAY-007', type: 'receipt', payment_method: 'cheque', amount: 100, base_amount_pkr: 28000, currency: 'USD', cleared: false, status: 'Confirmed', linked_receivable_id: 31, bank_account_id: 9 }],
      receivables: [{ id: 31, expected_amount: 100, received_amount: 0 }],
      bank_accounts: [{ id: 9, currency: 'USD', current_balance: 0 }],
    });
    const r = res();
    await financeController.clearCheque({ params: { id: 7 }, body: {}, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(row('bank_accounts', 9).current_balance).toBe(100);
    expect(db.tables.bank_transactions[0]).toMatchObject({ amount: 100, currency: 'USD', type: 'credit' });
    expect(row('receivables', 31)).toMatchObject({ received_amount: 100, status: 'Paid' });
  });
});

describe('reversePayment', () => {
  test('reversing a cheque that never cleared leaves the payable and source alone, and undoes its journal', async () => {
    seed({
      payments: [{ id: 9, payment_no: 'PAY-009', type: 'payment', amount: 200, base_amount_pkr: 200, currency: 'PKR', cleared: false, status: 'Confirmed', linked_payable_id: 21, bank_account_id: 8 }],
      payables: [{ id: 21, original_amount: 500, paid_amount: 100, source_table: 'business_expenses', source_id: 4 }],
      business_expenses: [{ id: 4, amount_pkr: 500, paid_amount: 100, payment_status: 'Partial' }],
      bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 1000 }],
      // A cheque recorded under the old rules, when a post-dated cheque was
      // journalled at recording (today none is until it clears).
      journal_entries: [{ id: 70, ref_no: 'PAY-009', ref_type: 'Payment', status: 'Posted', entity: 'mill', party_type: 'supplier', party_id: 3 }],
      journal_lines: [
        { id: 1, journal_id: 70, account_id: 14, account: 'Acct 2010', debit: 200, credit: 0 },
        { id: 2, journal_id: 70, account_id: 10, account: 'Acct 1000', debit: 0, credit: 200 },
      ],
    });
    const r = res();
    await financeController.reversePayment({ params: { id: '9' }, body: { reason: 'wrong party' }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(row('payables', 21).paid_amount).toBe(100);
    expect(row('business_expenses', 4).paid_amount).toBe(100);
    expect(row('bank_accounts', 8).current_balance).toBe(1000);
    expect(db.tables.bank_transactions).toEqual([]);
    expect(accounting.journals).toHaveLength(1);
    expect(accounting.journals[0]).toMatchObject({ refType: 'Payment Reversal', refNo: 'PAY-009', partyType: 'supplier', partyId: 3 });
    expect(accounting.journals[0].lines.map((l) => [l.account_id, l.debit, l.credit])).toEqual([[14, 0, 200], [10, 200, 0]]);
    expect(row('payments', 9).status).toBe('Reversed');
    expect(db.locks.map((l) => l.table)).toContain('payments');
  });

  test('a cleared payment reversal restores payable and every source table', async () => {
    seed({
      payments: [{ id: 10, payment_no: 'PAY-010', type: 'payment', amount: 300, base_amount_pkr: 300, currency: 'PKR', cleared: true, status: 'Confirmed', linked_payable_id: 22, bank_account_id: 8 }],
      payables: [{ id: 22, original_amount: 300, paid_amount: 300, status: 'Paid', source_table: 'export_order_costs', source_id: 6 }],
      export_order_costs: [{ id: 6, amount: 300, base_amount_pkr: 300, paid_amount: 300, payment_status: 'Paid', paid_at: '2026-10-01' }],
      bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 0 }],
    });
    const r = res();
    await financeController.reversePayment({ params: { id: '10' }, body: {}, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(row('payables', 22)).toMatchObject({ paid_amount: 0, status: 'Pending' });
    expect(row('export_order_costs', 6)).toMatchObject({ paid_amount: 0, payment_status: 'Pending', paid_at: null });
    expect(row('bank_accounts', 8).current_balance).toBe(300);
    // No journal under the payment number (a Purchases-tab payment) → the inverse is built.
    expect(accounting.journals[0].lines.map((l) => [l.account_id, l.debit, l.credit])).toEqual([[10, 300, 0], [14, 0, 300]]);
  });

  test('a local-sale receipt reversal restores receivable, sale and bank, with the delta journal', async () => {
    seed({
      payments: [{ id: 11, payment_no: 'PL-11', type: 'receipt', amount: 400, base_amount_pkr: 400, currency: 'PKR', cleared: true, status: 'Confirmed', local_sale_id: 3, bank_account_id: 41 }],
      receivables: [{ id: 31, local_sale_id: 3, expected_amount: 1000, received_amount: 400, outstanding: 600, status: 'Partial' }],
      local_sales: [{ id: 3, total_amount: 1000, paid_amount: 400, due_amount: 600, payment_status: 'Partial', payment_mode: 'credit' }],
      bank_accounts: [{ id: 41, currency: 'PKR', current_balance: 900 }],
      journal_entries: [{ id: 80, ref_no: 'PL-11', ref_type: 'Local Sale Receipt', status: 'Posted', entity: 'mill', party_type: 'customer', party_id: 5 }],
      journal_lines: [
        { id: 1, journal_id: 80, account_id: 10, account: 'Acct 1000', debit: 400, credit: 0 },
        { id: 2, journal_id: 80, account_id: 12, account: 'Acct 1120', debit: 0, credit: 400 },
      ],
    });
    const r = res();
    await financeController.reversePayment({ params: { id: '11' }, body: {}, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(row('receivables', 31)).toMatchObject({ received_amount: 0, outstanding: 1000, status: 'Pending' });
    expect(row('local_sales', 3)).toMatchObject({ paid_amount: 0, due_amount: 1000, payment_status: 'Credit' });
    expect(row('bank_accounts', 41).current_balance).toBe(500);
    expect(db.tables.bank_transactions[0]).toMatchObject({ type: 'debit', amount: 400, source: 'payment_reversal' });
    expect(accounting.journals[0]).toMatchObject({ refType: 'Payment Reversal', refNo: 'PL-11', partyType: 'customer', partyId: 5 });
    expect(accounting.journals[0].lines.map((l) => [l.account_id, l.debit, l.credit])).toEqual([[10, 0, 400], [12, 400, 0]]);
    expect(row('payments', 11).status).toBe('Reversed');
  });

  test('an export receipt confirmed on the order is refused', async () => {
    seed({
      payments: [{ id: 12, payment_no: 'PAY-012', type: 'receipt', amount: 100, base_amount_pkr: 28000, currency: 'USD', cleared: true, status: 'Confirmed', linked_receivable_id: 33, bank_account_id: 9 }],
      receivables: [{ id: 33, order_id: 2, expected_amount: 100, received_amount: 100 }],
      bank_accounts: [{ id: 9, currency: 'USD', current_balance: 100 }],
    });
    const r = res();
    await financeController.reversePayment({ params: { id: '12' }, body: {}, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/Reverse it from the export order/);
    expect(row('bank_accounts', 9).current_balance).toBe(100);
    expect(row('payments', 12).status).toBe('Confirmed');
  });

  test('a payment already reversed cannot be reversed again', async () => {
    seed({ payments: [{ id: 13, payment_no: 'PAY-013', type: 'payment', amount: 1, status: 'Reversed', linked_payable_id: 1 }] });
    const r = res();
    await financeController.reversePayment({ params: { id: '13' }, body: {}, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/already been reversed/);
  });
});

describe('expenses.markPaid', () => {
  const tables = () => ({
    business_expenses: [{ id: 4, expense_no: 'EXP-4', amount_pkr: 300.5, paid_amount: 0, payment_status: 'Pending', expense_type: 'mill', category: 'diesel' }],
    payables: [{ id: 31, original_amount: 300.5, paid_amount: 0, outstanding: 300.5, source_table: 'business_expenses', source_id: 4 }],
    bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 1000, type: 'bank' }],
  });

  test('reads under a lock and moves the expense paid_amount with the payable', async () => {
    seed(tables());
    await expensesService.markPaid(4, { amount: 100.25, payment_method: 'bank_transfer', bank_account_id: 8, paid_date: '2026-10-01' }, 1);
    expect(db.locks.map((l) => l.table)).toEqual(expect.arrayContaining(['business_expenses', 'payables']));
    expect(row('business_expenses', 4)).toMatchObject({ paid_amount: 100.25, payment_status: 'Partial' });
    expect(row('payables', 31)).toMatchObject({ paid_amount: 100.25, outstanding: 200.25 });
  });

  test('refuses to overpay, to the paisa', async () => {
    seed(tables());
    await expect(expensesService.markPaid(4, { amount: 300.6, payment_method: 'bank_transfer', bank_account_id: 8 }, 1))
      .rejects.toMatchObject({ message: expect.stringMatching(/Rs 300\.60\) exceeds the outstanding balance \(Rs 300\.50\)/) });
  });
});

describe('payPurchase', () => {
  test('the payable is the truth for what is still owed', async () => {
    seed({
      // The source row never heard about a Money-Out payment; its payable did.
      printed_bag_orders: [{ id: 7, total_amount: 500, paid_amount: 0, payment_status: 'Unpaid' }],
      payables: [{ id: 21, original_amount: 500, paid_amount: 400, source_table: 'printed_bag_orders', source_id: 7 }],
      bank_accounts: [{ id: 8, currency: 'PKR', current_balance: 1000 }],
    });
    const r = res();
    await financeController.payPurchase({ body: { source: 'printed_bag', source_id: 7, amount: 500, payment_method: 'bank_transfer', bank_account_id: 8 }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/exceeds the outstanding balance of 100\.00/);
    expect(row('bank_accounts', 8).current_balance).toBe(1000);
    expect(db.locks.map((l) => l.table)).toEqual(expect.arrayContaining(['printed_bag_orders', 'payables']));
  });
});
