/**
 * Full mill access for the Mill Operator (owner decision 2026-10-05): it may
 * MOVE money for the mill — pay mill payables / purchases, take receipts on mill
 * local sales — through the mill's own accounts. Company money stays Finance's.
 *
 * Executes the real handlers against the in-memory knex (helpers/fakeKnex): the
 * operator holds milling.edit but not finance.confirm_payment, so the handlers
 * restrict it to entity 'mill' on the row they lock; Finance is unchanged.
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
// authorize() guards carry their tag; authorizeAny() guards carry their pairs.
// The programmatic check reads the Set on req.user, as the real one does once
// the route guard has loaded it.
jest.mock('../middleware/rbac', () => {
  const authorize = (module, action) => {
    const guard = (req, res, next) => next();
    guard.permission = `${module}.${action}`;
    return guard;
  };
  const authorizeAny = (...pairs) => {
    const guard = (req, res, next) => next();
    guard.anyOf = pairs.map(([m, a]) => `${m}.${a}`);
    return guard;
  };
  const passThrough = () => (req, res, next) => next();
  const userHasPermission = async (req, module, action) => {
    if (['Owner', 'Super Admin'].includes(req.user?.role)) return true;
    return !!req.user?.permissions?.has(`${module}.${action}`);
  };
  return Object.assign(authorize, {
    authorize, authorizeAny, authorizeRole: passThrough, denyRoles: passThrough,
    userHasPermission, getScopedWarehouseIds: async () => null,
  });
});

const db = require('../config/database');
const accounting = require('../modules/accounting/accounting.service');
const finance = require('../modules/finance/finance.controller');
const localSales = require('../modules/localSales/localSales.controller');

const OPERATOR = { id: 7, role: 'Mill Operator', permissions: new Set(['milling.view', 'milling.edit', 'inventory.view', 'inventory.edit', 'reports.view', 'reports.view_cost', 'reports.view_profit']) };
const FINANCE = { id: 3, role: 'Finance Manager', permissions: new Set(['finance.view', 'finance.confirm_payment']) };

const COA = ['1000', '1110', '1120', '1310', '2010', '2060', '4060'].map((code, i) => ({ id: 10 + i, code, name: `Acct ${code}` }));
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
const asUser = (user) => ({ ...user, permissions: new Set(user.permissions) });

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => console.error.mockRestore());

const payableTables = () => ({
  payables: [
    { id: 21, entity: 'mill', original_amount: 500, paid_amount: 0, outstanding: 500, status: 'Pending', supplier_id: 3 },
    { id: 22, entity: 'export', original_amount: 900, paid_amount: 0, outstanding: 900, status: 'Pending', supplier_id: 4 },
  ],
  bank_accounts: [
    { id: 8, name: 'Mill Cash', entity: 'mill', type: 'cash', currency: 'PKR', current_balance: 10000, is_active: true },
    { id: 9, name: 'HO Bank', entity: 'general', type: 'bank', currency: 'PKR', current_balance: 50000, is_active: true },
  ],
});
const pay = (payableId, accountId, amount = 200) => ({
  type: 'payment', linked_payable_id: payableId, amount, currency: 'PKR',
  payment_method: accountId === 8 ? 'cash' : 'bank_transfer', bank_account_id: accountId, payment_date: '2026-10-05',
});

describe('recordPayment — the Mill Operator pays mill payables only', () => {
  test('a mill payable through Mill Cash: paid, account moved, journal posted', async () => {
    seed(payableTables());
    const r = res();
    await finance.recordPayment({ body: pay(21, 8), user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(201);
    expect(row('payables', 21)).toMatchObject({ paid_amount: 200, outstanding: 300 });
    expect(row('bank_accounts', 8).current_balance).toBe(9800);
    expect(accounting.journals).toHaveLength(1);
  });

  test('an export payable is refused with 403 and nothing moves', async () => {
    seed(payableTables());
    const r = res();
    await finance.recordPayment({ body: pay(22, 8), user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(403);
    expect(r.body.message).toMatch(/only record payments on mill payables/);
    expect(row('payables', 22).paid_amount).toBe(0);
    expect(row('bank_accounts', 8).current_balance).toBe(10000);
    expect(db.tables.payments).toHaveLength(0);
    expect(accounting.journals).toHaveLength(0);
  });

  test('a mill payable through a Head Office account is refused with 403', async () => {
    seed(payableTables());
    const r = res();
    await finance.recordPayment({ body: pay(21, 9), user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(403);
    expect(r.body.message).toMatch(/mill's own accounts/);
    expect(row('bank_accounts', 9).current_balance).toBe(50000);
    expect(db.tables.payments).toHaveLength(0);
  });

  test('the over-payment guard still applies to the operator', async () => {
    seed(payableTables());
    const r = res();
    await finance.recordPayment({ body: pay(21, 8, 600), user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toMatch(/exceeds the outstanding balance of 500\.00/);
  });

  test('Finance is unchanged: pays the export payable from the Head Office bank', async () => {
    seed(payableTables());
    const r = res();
    await finance.recordPayment({ body: pay(22, 9), user: asUser(FINANCE) }, r);
    expect(r.statusCode).toBe(201);
    expect(row('payables', 22).paid_amount).toBe(200);
    expect(row('bank_accounts', 9).current_balance).toBe(49800);
  });
});

describe('payPurchase — mill purchases only', () => {
  const tables = () => ({
    ...payableTables(),
    payables: [],
    mill_purchases: [{ id: 5, purchase_no: 'MP-5', total_amount: 600, paid_amount: 0, payment_status: 'Pending' }],
    export_order_costs: [{ id: 6, order_id: 1, amount: 100, base_amount_pkr: 28000, paid_amount: 0 }],
  });

  test('the operator pays a mill-store purchase from Mill Cash', async () => {
    seed(tables());
    const r = res();
    await finance.payPurchase({ body: { source: 'mill_store', source_id: 5, amount: 600, payment_method: 'cash', bank_account_id: 8 }, user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(200);
    expect(row('mill_purchases', 5)).toMatchObject({ paid_amount: 600, payment_status: 'Paid' });
    expect(row('bank_accounts', 8).current_balance).toBe(9400);
  });

  test('an export cost is refused with 403', async () => {
    seed(tables());
    const r = res();
    await finance.payPurchase({ body: { source: 'export_cost', source_id: 6, amount: 1000, payment_method: 'cash', bank_account_id: 8 }, user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(403);
    expect(row('export_order_costs', 6).paid_amount).toBe(0);
    expect(row('bank_accounts', 8).current_balance).toBe(10000);
  });
});

describe('local-sale receipts', () => {
  const tables = (entity = 'mill') => ({
    local_sales: [{ id: 5, sale_no: 'LS-0005', entity, customer_id: 42, status: 'Completed', total_amount: 1000, paid_amount: 0, due_amount: 1000 }],
    receivables: [],
    bank_accounts: payableTables().bank_accounts,
  });

  test('the operator takes a receipt on a mill sale into Mill Cash', async () => {
    seed(tables());
    const r = res();
    await localSales.acceptPayment({ params: { id: '5' }, body: { amount: 400, payment_method: 'cash', bank_account_id: 8 }, user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(200);
    expect(row('local_sales', 5)).toMatchObject({ paid_amount: 400, due_amount: 600 });
    expect(row('bank_accounts', 8).current_balance).toBe(10400);
  });

  test('an export-side sale is refused with 403', async () => {
    seed(tables('export'));
    const r = res();
    await localSales.acceptPayment({ params: { id: '5' }, body: { amount: 400, payment_method: 'cash', bank_account_id: 8 }, user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(403);
    expect(row('local_sales', 5).paid_amount).toBe(0);
  });

  test('cash collected at Head Office is Finance\'s to record', async () => {
    seed(tables());
    const r = res();
    await localSales.acceptPayment({ params: { id: '5' }, body: { amount: 400, payment_method: 'cash', collection_location: 'Head Office' }, user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(403);
    expect(row('local_sales', 5).paid_amount).toBe(0);
  });

  test('the whole-sale (group) receipt applies the same rule', async () => {
    seed(tables('export'));
    const r = res();
    await localSales.acceptGroupPayment({ params: { groupNo: 'LS-0005' }, body: { amount: 400, payment_method: 'cash', bank_account_id: 8 }, user: asUser(OPERATOR) }, r);
    expect(r.statusCode).toBe(403);
  });
});

describe('the routes', () => {
  const stackOf = (router, method, path) => router.stack
    .find((l) => l.route && l.route.path === path && l.route.methods[method]).route.stack.map((s) => s.handle);

  test.each(['/payments', '/purchases/pay'])('finance POST %s: finance.confirm_payment or milling.edit', (path) => {
    const guard = stackOf(require('../modules/finance/finance.routes'), 'post', path).find((h) => h.anyOf);
    expect(guard.anyOf).toEqual(['finance.confirm_payment', 'milling.edit']);
  });

  test('reversing a payment stays finance.confirm_payment only', () => {
    const stack = stackOf(require('../modules/finance/finance.routes'), 'post', '/payments/:id/reverse');
    expect(stack.map((h) => h.permission)).toContain('finance.confirm_payment');
    expect(stack.some((h) => h.anyOf)).toBe(false);
  });

  test.each(['/:id/payments', '/group/:groupNo/payments'])('local sales POST %s admits milling.edit', (path) => {
    const guard = stackOf(require('../modules/localSales/localSales.routes'), 'post', path).find((h) => h.anyOf);
    expect(guard.anyOf).toEqual(['inventory.create', 'finance.confirm_payment', 'milling.edit']);
  });
});

describe('GET /milling/bank-accounts', () => {
  test('mill accounts only; balance only with reports.view_cost', async () => {
    seed(payableTables());
    const r = res();
    await finance.getMillBankAccounts({ user: asUser(OPERATOR), query: {} }, r);
    expect(r.body.data.accounts.map((a) => a.id)).toEqual([8]);
    expect(r.body.data.accounts[0]).toMatchObject({ name: 'Mill Cash', current_balance: 10000 });

    const blind = res();
    await finance.getMillBankAccounts({ user: { id: 9, role: 'QC Analyst', permissions: new Set(['milling.view']) }, query: {} }, blind);
    expect(blind.body.data.accounts[0].current_balance).toBeNull();
  });
});
