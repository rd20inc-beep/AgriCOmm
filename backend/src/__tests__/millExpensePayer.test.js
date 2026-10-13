/**
 * A mill expense paid now draws on the MILL's own accounts unless the caller
 * holds finance.confirm_payment (audit R10c).
 *
 * POST /api/milling/expenses is gated on milling.create — the Mill Operator's
 * permission — and its pay-now leg went through the payment engine without
 * `millOnly`, so a mill user could pay a mill bill out of a Head Office bank.
 * The same held for materializing a recurring mill expense and for a service
 * (toll) milling receipt, gated on service_milling.record_payment.
 *
 * Executes the real route handlers, expenses service and payment engine against
 * the in-memory knex (helpers/fakeKnex).
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
    autoPost: jest.fn(async () => ({})),
  };
});
jest.mock('../middleware/rbac', () => {
  const authorize = (module, action) => {
    const guard = (req, res, next) => next();
    guard.permission = `${module}.${action}`;
    return guard;
  };
  const passThrough = () => (req, res, next) => next();
  const userHasPermission = async (req, module, action) => {
    if (['Owner', 'Super Admin'].includes(req.user?.role)) return true;
    return !!req.user?.permissions?.has(`${module}.${action}`);
  };
  return Object.assign(authorize, {
    authorize, authorizeAny: passThrough, authorizeRole: passThrough, denyRoles: passThrough,
    userHasPermission, getScopedWarehouseIds: async () => null,
  });
});

const db = require('../config/database');
const accounting = require('../modules/accounting/accounting.service');
const milling = require('../modules/milling/milling.routes');
const serviceMilling = require('../modules/serviceMilling/serviceMilling.controller');

const OPERATOR = { id: 7, role: 'Mill Operator', permissions: new Set(['milling.view', 'milling.create', 'milling.edit']) };
const MILL_MANAGER = { id: 8, role: 'Mill Manager', permissions: new Set(['milling.create', 'service_milling.record_payment']) };
const FINANCE = { id: 3, role: 'Finance Manager', permissions: new Set(['milling.create', 'finance.view', 'finance.confirm_payment']) };

const COA = ['1000', '1110', '1120', '2010', '2040', '6135'].map((code, i) => ({ id: 10 + i, code, name: `Acct ${code}` }));
function seed(tables = {}) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  const base = {
    chart_of_accounts: COA, journal_entries: [], journal_lines: [], bank_transactions: [], payments: [],
    business_expenses: [], payables: [], suppliers: [],
    bank_accounts: [
      { id: 8, name: 'Mill Cash', entity: 'mill', type: 'cash', currency: 'PKR', current_balance: 10000, is_active: true },
      { id: 9, name: 'HO Bank', entity: 'general', type: 'bank', currency: 'PKR', current_balance: 50000, is_active: true },
    ],
  };
  for (const [k, rows] of Object.entries({ ...base, ...tables })) db.tables[k] = rows.map((r) => ({ ...r }));
  db.locks.length = 0;
  accounting.journals.length = 0;
}
function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function handlerOf(router, method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method} ${path}`);
  const stack = layer.route.stack.map((s) => s.handle);
  return stack[stack.length - 1];
}
const asUser = (u) => ({ ...u, permissions: new Set(u.permissions) });
const balance = (id) => db.tables.bank_accounts.find((a) => a.id === id).current_balance;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { console.error.mockRestore(); console.warn.mockRestore(); });

describe('POST /milling/expenses — pay now', () => {
  const createExpense = handlerOf(milling, 'post', '/expenses');
  const body = (accountId) => ({
    category: 'electricity', amount: 1200, expense_date: '2026-10-10', pay_now: true,
    payment_method: accountId === 8 ? 'cash' : 'bank_transfer', bank_account_id: accountId,
  });

  test('a mill user paying from a Head Office bank is refused with 403 and nothing moves', async () => {
    seed();
    const r = res();
    await createExpense({ body: body(9), user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(403);
    expect(r.body.message).toMatch(/mill's own accounts/);
    expect(balance(9)).toBe(50000);
    expect(db.tables.payments).toHaveLength(0);
  });

  test('a mill user paying from Mill Cash goes through', async () => {
    seed();
    const r = res();
    await createExpense({ body: body(8), user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(200);
    expect(balance(8)).toBe(8800);
    expect(db.tables.payments).toHaveLength(1);
  });

  test('Finance may still pay a mill expense from a Head Office bank', async () => {
    seed();
    const r = res();
    await createExpense({ body: body(9), user: asUser(FINANCE) }, r);
    expect(r.statusCode).toBe(200);
    expect(balance(9)).toBe(48800);
  });

  test('the Owner is unrestricted', async () => {
    seed();
    const r = res();
    await createExpense({ body: body(9), user: { id: 1, role: 'Owner', permissions: new Set() } }, r);
    expect(r.statusCode).toBe(200);
  });

  test('recording a mill expense without paying needs no account check', async () => {
    seed();
    const r = res();
    await createExpense({ body: { ...body(9), pay_now: false }, user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(200);
    expect(db.tables.payments).toHaveLength(0);
  });
});

describe('POST /milling/expenses/recurring/:id/materialize — pay now', () => {
  const materialize = handlerOf(milling, 'post', '/expenses/recurring/:id/materialize');
  const tmpl = { id: 40, expense_no: 'EXP-2026-0001', expense_type: 'mill', category: 'rent', amount: 3000, expense_date: '2026-09-01', is_recurring: true, recurrence: 'monthly' };

  test('a mill user cannot pay the next occurrence from a Head Office bank', async () => {
    seed({ business_expenses: [tmpl] });
    const r = res();
    await materialize({ params: { id: 40 }, body: { pay_now: true, bank_account_id: 9, payment_method: 'bank_transfer' }, user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(403);
    expect(balance(9)).toBe(50000);
  });
});

describe('service milling receipt', () => {
  const tables = () => ({
    service_milling_invoices: [{ id: 5, invoice_no: 'SMI-5', total_amount: 9000, received_amount: 0, status: 'Unpaid' }],
    receivables: [{ id: 31, entity: 'mill', service_invoice_id: 5, expected_amount: 9000, received_amount: 0, outstanding: 9000, status: 'Pending' }],
  });
  const pay = (accountId) => ({ amount: 1000, payment_method: 'bank_transfer', bank_account_id: accountId, payment_date: '2026-10-10' });

  test('a Mill Manager cannot bank a toll-milling receipt into Head Office', async () => {
    seed(tables());
    const r = res();
    await serviceMilling.recordPayment({ params: { id: 5 }, body: pay(9), user: asUser(MILL_MANAGER) }, r);
    expect(r.statusCode).toBe(403);
    expect(balance(9)).toBe(50000);
  });

  test('Finance can', async () => {
    seed(tables());
    const r = res();
    await serviceMilling.recordPayment({ params: { id: 5 }, body: pay(9), user: asUser(FINANCE) }, r);
    expect(r.statusCode).toBe(201);
    expect(balance(9)).toBe(51000);
  });
});
