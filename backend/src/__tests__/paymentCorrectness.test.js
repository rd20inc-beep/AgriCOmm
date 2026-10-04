/**
 * Payment correctness — the handlers are run against a recording fake of knex,
 * so these exercise the real controller/service code paths:
 *
 *  - payPurchase writes the canonical method ('bank' was refused by the
 *    payments CHECK constraint) and refuses an over-amount instead of clamping.
 *  - A journal that cannot be posted (closed period, unbalanced) fails the whole
 *    payment with a 400 and rolls the transaction back, instead of committing a
 *    payment with no journal.
 *  - A cash payment with no account lands in the entity's cash float; any other
 *    method with no account is refused, except a post-dated cheque.
 */

jest.mock('../config/database', () => {
  // Rows the fake returns, keyed by table: an object, or (where) => row.
  let rows = {};
  const log = [];
  const outcomes = [];
  const builder = (table) => {
    const state = { table, wheres: [], op: 'select', data: null };
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          return (res, rej) => Promise.resolve(state.op === 'insert' ? [99] : 1).then(res, rej);
        }
        if (prop === 'first') {
          return async () => {
            const r = rows[table];
            const where = Object.assign({}, ...state.wheres);
            return typeof r === 'function' ? r(where) : r;
          };
        }
        if (prop === 'where' || prop === 'andWhere') {
          return (a) => { if (a && typeof a === 'object') state.wheres.push(a); return b; };
        }
        if (prop === 'insert') {
          return (data) => { state.op = 'insert'; state.data = data; log.push({ table, op: 'insert', data }); return b; };
        }
        if (prop === 'update') {
          return (data) => { state.op = 'update'; log.push({ table, op: 'update', data, where: Object.assign({}, ...state.wheres) }); return b; };
        }
        if (prop === 'increment' || prop === 'decrement') {
          return (col, amount) => { log.push({ table, op: prop, amount, where: Object.assign({}, ...state.wheres) }); return b; };
        }
        if (prop === 'returning') {
          return async () => [{ id: 99, ...(state.data || {}) }];
        }
        return () => b;
      },
    });
    return b;
  };
  const db = (table) => builder(table);
  db.fn = { now: () => 'now()' };
  db.raw = (...a) => ({ raw: a });
  db.schema = { hasTable: async () => true };
  db.transaction = async (cb) => {
    try {
      const out = await cb(db);
      outcomes.push('commit');
      return out;
    } catch (e) {
      outcomes.push('rollback');
      throw e;
    }
  };
  db.__set = (r) => { rows = r; log.length = 0; outcomes.length = 0; };
  db.__log = log;
  db.__outcomes = outcomes;
  return db;
});
jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async () => 'PP-1') }));
// services/accountingService re-exports this module, so both import paths get the stub.
jest.mock('../modules/accounting/accounting.service', () => ({
  createJournal: jest.fn(async () => ({ id: 7 })),
  postJournal: jest.fn(async () => ({ id: 7 })),
}));

const db = require('../config/database');
const accountingService = require('../services/accountingService');
const financeController = require('../modules/finance/finance.controller');
const expensesService = require('../modules/expenses/expenses.service');
const { resolvePaymentAccountId } = require('../shared/cashAccounts');

const COA = (w) => (w.code ? { id: Number(w.code), code: w.code, name: `Acct ${w.code}` } : undefined);
const CASH_ACCOUNTS = (w) => {
  if (w.type !== 'cash') return { id: w.id, currency: 'PKR' };
  return w.entity === 'mill' ? { id: 41, name: 'Mill Cash' } : w.entity === 'general' ? { id: 42, name: 'Office Petty Cash' } : { id: 41 };
};

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const inserts = (table) => db.__log.filter((l) => l.table === table && l.op === 'insert').map((l) => l.data);
const updates = (table) => db.__log.filter((l) => l.table === table && l.op === 'update').map((l) => l.data);
const moves = (table) => db.__log.filter((l) => l.table === table && (l.op === 'increment' || l.op === 'decrement'));

const millPurchase = { id: 5, purchase_no: 'MP-5', total_amount: 1000, paid_amount: 400, supplier_id: 3 };
const purchaseRows = () => ({
  mill_purchases: millPurchase,
  payables: { id: 11, paid_amount: 400, original_amount: 1000, supplier_id: 3 },
  chart_of_accounts: COA,
  bank_accounts: CASH_ACCOUNTS,
  bank_transactions: undefined,
});

beforeEach(() => {
  accountingService.createJournal.mockReset().mockResolvedValue({ id: 7 });
  accountingService.postJournal.mockReset().mockResolvedValue({ id: 7 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => console.error.mockRestore());

describe('payPurchase', () => {
  test("stores 'bank' as the canonical 'bank_transfer'", async () => {
    db.__set(purchaseRows());
    const r = res();
    await financeController.payPurchase({ body: {
      source: 'mill_store', source_id: 5, amount: 600, payment_method: 'bank', bank_account_id: 8,
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(inserts('payments')[0].payment_method).toBe('bank_transfer');
    expect(updates('mill_purchases')[0]).toMatchObject({ payment_method: 'bank_transfer', bank_account_id: 8, payment_status: 'Paid' });
    expect(accountingService.createJournal).toHaveBeenCalledTimes(1);
    expect(db.__outcomes).toEqual(['commit']);
  });

  test('refuses an amount over the outstanding instead of clamping it', async () => {
    db.__set(purchaseRows());
    const r = res();
    await financeController.payPurchase({ body: {
      source: 'mill_store', source_id: 5, amount: 1000, payment_method: 'bank_transfer', bank_account_id: 8,
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/exceeds the outstanding balance of 600\.00/);
    expect(inserts('payments')).toEqual([]);
    expect(db.__outcomes).toEqual(['rollback']);
  });

  test('a journal that cannot post fails the payment with the reason and rolls back', async () => {
    db.__set(purchaseRows());
    accountingService.createJournal.mockRejectedValue(new Error("Accounting period 'Sep 2026' is Closed. Cannot post journals."));
    const r = res();
    await financeController.payPurchase({ body: {
      source: 'mill_store', source_id: 5, amount: 600, payment_method: 'bank_transfer', bank_account_id: 8,
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.success).toBe(false);
    expect(r.body.message).toMatch(/not saved.*Closed/);
    expect(db.__outcomes).toEqual(['rollback']);
  });

  test('cash with no account comes out of Mill Cash for a mill-store purchase', async () => {
    db.__set(purchaseRows());
    const r = res();
    await financeController.payPurchase({ body: {
      source: 'mill_store', source_id: 5, amount: 100, payment_method: 'cash', bank_account_id: null,
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(moves('bank_accounts')).toEqual([expect.objectContaining({ op: 'decrement', amount: 100, where: { id: 41 } })]);
    expect(inserts('payments')[0]).toMatchObject({ payment_method: 'cash', bank_account_id: 41 });
  });

  test('a bank transfer with no account is refused', async () => {
    db.__set(purchaseRows());
    const r = res();
    await financeController.payPurchase({ body: {
      source: 'mill_store', source_id: 5, amount: 100, payment_method: 'bank_transfer',
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toBe('Choose the account the money moves through.');
    expect(accountingService.createJournal).not.toHaveBeenCalled();
  });

  test('a post-dated cheque still needs no account and posts nothing yet', async () => {
    db.__set(purchaseRows());
    const r = res();
    await financeController.payPurchase({ body: {
      source: 'mill_store', source_id: 5, amount: 100, payment_method: 'cheque', due_date: '2999-01-01',
    }, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.data.postDated).toBe(true);
    expect(inserts('payments')[0]).toMatchObject({ cleared: false, bank_account_id: null, payment_method: 'cheque' });
    expect(moves('bank_accounts')).toEqual([]);
  });
});

describe('recordPayment', () => {
  const payableRows = () => ({
    payables: { id: 21, entity: 'mill', paid_amount: 0, original_amount: 500, supplier_id: 3 },
    chart_of_accounts: COA,
    bank_accounts: CASH_ACCOUNTS,
    payments: undefined,
    bank_transactions: undefined,
  });
  const body = (extra) => ({
    type: 'payment', linked_payable_id: 21, amount: 200, currency: 'PKR',
    payment_date: '2026-10-01', payment_method: 'cash', ...extra,
  });

  test('cash with no account moves Mill Cash for a mill payable', async () => {
    db.__set(payableRows());
    const r = res();
    await financeController.recordPayment({ body: body(), user: { id: 1 } }, r);
    expect(r.statusCode).toBe(201);
    expect(inserts('payments')[0].bank_account_id).toBe(41);
    expect(moves('bank_accounts')).toEqual([expect.objectContaining({ op: 'increment', amount: -200, where: { id: 41 } })]);
  });

  test('an unbalanced journal fails the payment with a 400 and rolls back', async () => {
    db.__set(payableRows());
    accountingService.createJournal.mockRejectedValue(new Error('Journal is unbalanced: debit=200, credit=150. Difference=50.00'));
    const r = res();
    await financeController.recordPayment({ body: body({ bank_account_id: 8 }), user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/unbalanced/);
    expect(db.__outcomes).toEqual(['rollback']);
  });

  test('a database error in the journal is a 500, not a silent success', async () => {
    db.__set(payableRows());
    const pgErr = Object.assign(new Error('current transaction is aborted'), { code: '25P02' });
    accountingService.createJournal.mockRejectedValue(pgErr);
    const r = res();
    await financeController.recordPayment({ body: body({ bank_account_id: 8 }), user: { id: 1 } }, r);
    expect(r.statusCode).toBe(500);
    expect(db.__outcomes).toEqual(['rollback']);
  });

  test('an online payment with no account is refused', async () => {
    db.__set(payableRows());
    const r = res();
    await financeController.recordPayment({ body: body({ payment_method: 'online' }), user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toBe('Choose the account the money moves through.');
  });
});

describe('reversePayment', () => {
  test('a reversal whose journal cannot post is refused and rolled back', async () => {
    db.__set({
      payments: { id: 9, payment_no: 'PAY-9', type: 'payment', linked_payable_id: 21, amount: 200, base_amount_pkr: 200, currency: 'PKR', cleared: true, bank_account_id: 8 },
      payables: { id: 21, paid_amount: 200, original_amount: 500 },
      chart_of_accounts: COA,
      bank_accounts: { id: 8, currency: 'PKR' },
    });
    accountingService.createJournal.mockRejectedValue(new Error("Accounting period 'Sep 2026' is Locked. Cannot post journals."));
    const r = res();
    await financeController.reversePayment({ params: { id: '9' }, body: {}, user: { id: 1 } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/reversal was not saved.*Locked/);
    expect(db.__outcomes).toEqual(['rollback']);
  });
});

describe('expense settlement', () => {
  test('markPaid fails with the journal reason instead of saving a payment with no journal', async () => {
    db.__set({
      business_expenses: { id: 4, expense_no: 'EXP-4', amount_pkr: 300, payment_status: 'Pending', expense_type: 'mill', category: 'diesel' },
      payables: { id: 31, paid_amount: 0, outstanding: 300 },
      chart_of_accounts: COA,
      bank_accounts: CASH_ACCOUNTS,
    });
    accountingService.createJournal.mockRejectedValue(new Error("Accounting period 'Sep 2026' is Closed. Cannot post journals."));
    await expect(expensesService.markPaid(4, { payment_method: 'cash', paid_date: '2026-10-01' }, 1))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Closed/) });
    expect(db.__outcomes).toEqual(['rollback']);
  });
});

describe('resolvePaymentAccountId', () => {
  const trx = (table) => db(table);
  beforeEach(() => db.__set({ bank_accounts: CASH_ACCOUNTS }));

  test('an explicit account wins', async () => {
    await expect(resolvePaymentAccountId(trx, { bankAccountId: 8, method: 'cash' })).resolves.toBe(8);
  });
  test('head-office cash resolves Office Petty Cash, mill cash resolves Mill Cash', async () => {
    await expect(resolvePaymentAccountId(trx, { method: 'cash', entity: 'export' })).resolves.toBe(42);
    await expect(resolvePaymentAccountId(trx, { method: 'cash', entity: 'mill' })).resolves.toBe(41);
  });
  test('a post-dated cheque needs no account', async () => {
    await expect(resolvePaymentAccountId(trx, { method: 'cheque', isPostDated: true })).resolves.toBeNull();
  });
  test('cash with no cash account set up is refused', async () => {
    db.__set({ bank_accounts: undefined });
    await expect(resolvePaymentAccountId(trx, { method: 'cash' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

// Tag each authorize() guard with the permission it checks, so the router's
// real middleware chain can be inspected.
jest.mock('../middleware/rbac', () => (module, action) => {
  const guard = (req, res, next) => next();
  guard.permission = `${module}.${action}`;
  return guard;
});

describe('mill-store pay route', () => {
  const millStoreController = require('../modules/millStore/millStore.controller');

  test('an amount-less status flip is refused', async () => {
    db.__set(purchaseRows());
    const next = jest.fn();
    await millStoreController.updatePurchasePayment({ params: { id: '5' }, body: { payment_status: 'Paid' }, user: { id: 1 } }, res(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: expect.stringMatching(/Enter the amount paid/) }));
    expect(db.__log).toEqual([]);
  });

  test('a payment goes through the finance settlement, journal included', async () => {
    db.__set(purchaseRows());
    const r = res();
    await millStoreController.updatePurchasePayment({ params: { id: '5' }, body: { amount: 600, payment_method: 'cash' }, user: { id: 1 } }, r, jest.fn());
    expect(r.statusCode).toBe(200);
    expect(r.body.data).toMatchObject({ source: 'mill_store', source_id: 5, amount_paid_pkr: 600, fully_paid: true });
    expect(accountingService.createJournal).toHaveBeenCalledTimes(1);
  });

  test("the route is guarded by finance.confirm_payment, not the store's create_purchase", () => {
    const router = require('../modules/millStore/millStore.routes');
    const layer = router.stack.find((l) => l.route && l.route.path === '/purchases/:id/pay' && l.route.methods.put);
    const perms = layer.route.stack.map((s) => s.handle.permission).filter(Boolean);
    expect(perms).toEqual(['finance.confirm_payment']);
  });
});
