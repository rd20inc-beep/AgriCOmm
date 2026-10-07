/**
 * A non-PKR bank account moves only its own currency.
 *
 * A PKR account may pay/receive a USD amount — the bank converts, and the
 * account moves by the payment's stamped PKR figure. A USD account paying a PKR
 * amount (or any other currency) used to be moved by that PKR figure, writing
 * rupees into a dollar balance. It is now refused with a 400 before anything is
 * written. Run against the in-memory knex so the real controller code executes.
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
let mockDocSeq = 0;
jest.mock('../utils/docNumber', () => ({
  nextDocNo: jest.fn(async (_trx, { prefix }) => `${prefix}${++mockDocSeq}`),
}));
jest.mock('../modules/accounting/accounting.service', () => ({
  createJournal: jest.fn(async () => ({ id: 501 })),
  postJournal: jest.fn(async () => ({})),
  autoPost: jest.fn(async () => null),
}));
jest.mock('../modules/finance/fxRate.service', () => ({
  getLatestRate: jest.fn(async () => ({ rate: 280, source: 'test' })),
}));

const db = require('../config/database');
const financeController = require('../modules/finance/finance.controller');
const { accountCurrencyMismatch } = require('../shared/accountCurrency');

const COA = ['1000', '1110', '1120', '1310', '2010', '2040', '2060', '4060'].map((code, i) => ({ id: 10 + i, code, name: `Acct ${code}` }));
const TODAY = new Date().toISOString().slice(0, 10);

function seed(tables) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  for (const [k, rows] of Object.entries({ chart_of_accounts: COA, journal_entries: [], journal_lines: [], bank_transactions: [], payments: [], ...tables })) {
    db.tables[k] = rows.map((r) => ({ ...r }));
  }
  db.locks.length = 0;
}
function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const row = (table, id) => db.tables[table].find((r) => String(r.id) === String(id));

const ACCOUNTS = [
  { id: 8, name: 'HBL PKR', currency: 'PKR', current_balance: 1000000, type: 'bank', entity: 'export' },
  { id: 9, name: 'HBL USD', currency: 'USD', current_balance: 5000, type: 'bank', entity: 'export' },
];

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => console.error.mockRestore());

describe('accountCurrencyMismatch', () => {
  test('a PKR account takes any currency', () => {
    expect(accountCurrencyMismatch({ currency: 'PKR' }, 'USD')).toBeNull();
    expect(accountCurrencyMismatch({ currency: 'PKR' }, 'PKR')).toBeNull();
    expect(accountCurrencyMismatch({ currency: null }, 'USD')).toBeNull();
  });
  test('a USD account takes USD only', () => {
    expect(accountCurrencyMismatch({ currency: 'USD' }, 'usd')).toBeNull();
    expect(accountCurrencyMismatch({ currency: 'USD' }, 'PKR')).toMatch(/This USD account can only pay\/receive USD amounts — choose a PKR account/);
    expect(accountCurrencyMismatch({ currency: 'USD' }, undefined)).toMatch(/USD account/); // missing = PKR
    expect(accountCurrencyMismatch({ currency: 'USD' }, 'EUR')).toMatch(/USD account/);
  });
});

describe('recordPayment', () => {
  const pkrPayable = { id: 21, entity: 'export', original_amount: 100000, paid_amount: 0, outstanding: 100000, status: 'Pending', supplier_id: 3, currency: 'PKR' };
  const usdReceivable = { id: 31, entity: 'export', expected_amount: 1000, received_amount: 0, outstanding: 1000, status: 'Pending', customer_id: 4, currency: 'USD' };

  test('a PKR payment out of a USD account is refused before anything is written', async () => {
    seed({ payables: [pkrPayable], bank_accounts: ACCOUNTS });
    const r = res();
    await financeController.recordPayment({ body: {
      type: 'payment', linked_payable_id: 21, amount: 50000, currency: 'PKR',
      payment_method: 'bank_transfer', bank_account_id: 9, payment_date: TODAY,
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/This USD account can only pay\/receive USD amounts — choose a PKR account/);
    expect(db.tables.payments).toEqual([]);
    expect(db.tables.bank_transactions).toEqual([]);
    expect(row('bank_accounts', 9).current_balance).toBe(5000);
    expect(row('payables', 21).paid_amount).toBe(0);
  });

  test('a USD receipt into a PKR account is still allowed — it banks the PKR figure', async () => {
    seed({ receivables: [usdReceivable], bank_accounts: ACCOUNTS });
    const r = res();
    await financeController.recordPayment({ body: {
      type: 'receipt', linked_receivable_id: 31, amount: 100, currency: 'USD',
      payment_method: 'bank_transfer', bank_account_id: 8, payment_date: TODAY,
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(row('bank_accounts', 8).current_balance).toBe(1000000 + 100 * 280);
    expect(db.tables.bank_transactions[0]).toMatchObject({ bank_account_id: 8, amount: 28000, currency: 'PKR' });
  });

  test('a USD receipt into a USD account moves it natively', async () => {
    seed({ receivables: [usdReceivable], bank_accounts: ACCOUNTS });
    const r = res();
    await financeController.recordPayment({ body: {
      type: 'receipt', linked_receivable_id: 31, amount: 100, currency: 'USD',
      payment_method: 'bank_transfer', bank_account_id: 9, payment_date: TODAY,
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(row('bank_accounts', 9).current_balance).toBe(5100);
  });

  test('a cheque naming a USD account for a PKR payment is refused at recording', async () => {
    seed({ payables: [pkrPayable], bank_accounts: ACCOUNTS });
    const r = res();
    await financeController.recordPayment({ body: {
      type: 'payment', linked_payable_id: 21, amount: 50000, currency: 'PKR',
      payment_method: 'cheque', bank_account_id: 9, payment_date: TODAY, due_date: TODAY,
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(db.tables.payments).toEqual([]);
  });
});

describe('clearCheque', () => {
  test('a PKR cheque cannot clear through a USD account', async () => {
    seed({
      payables: [{ id: 21, entity: 'export', original_amount: 1000, paid_amount: 0, outstanding: 1000, status: 'Pending', supplier_id: 3 }],
      bank_accounts: ACCOUNTS,
      payments: [{ id: 70, payment_no: 'PAY-70', type: 'payment', linked_payable_id: 21, amount: 1000, currency: 'PKR', fx_rate: 1, base_amount_pkr: 1000, payment_method: 'cheque', cleared: false, status: null, bank_account_id: null }],
    });
    const r = res();
    await financeController.clearCheque({ params: { id: 70 }, body: { bank_account_id: 9 }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/USD account/);
    expect(row('payments', 70).cleared).toBe(false);
    expect(row('bank_accounts', 9).current_balance).toBe(5000);
    expect(row('payables', 21).paid_amount).toBe(0);
  });
});

describe('payPurchase', () => {
  test('a purchase (always PKR) cannot be paid from a USD account', async () => {
    seed({
      mill_purchases: [{ id: 5, purchase_no: 'MP-5', total_amount: 1000, paid_amount: 0, supplier_id: 3 }],
      payables: [{ id: 11, source_table: 'mill_purchases', source_id: 5, paid_amount: 0, original_amount: 1000, supplier_id: 3 }],
      bank_accounts: ACCOUNTS,
    });
    const r = res();
    await financeController.payPurchase({ body: {
      source: 'mill_store', source_id: 5, amount: 500, payment_method: 'bank_transfer', bank_account_id: 9,
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/USD account/);
    expect(row('bank_accounts', 9).current_balance).toBe(5000);
    expect(row('mill_purchases', 5).paid_amount).toBe(0);
    expect(db.tables.payments).toEqual([]);
  });
});
