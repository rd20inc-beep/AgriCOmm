/**
 * Mill Finance ▸ Suppliers / Customers for the Mill Operator (owner decision
 * 2026-10-05: "see everything regarding the mill"). The operator has no
 * finance.view, so it reads GET /milling/payables and /milling/receivables —
 * the same handlers as the finance feeds, restricted to entity 'mill'.
 *
 * Executes the real handlers against an in-memory database: every query
 * resolves to the rows registered for its table, whatever the builder chain —
 * so the entity restriction is proven on the handler's own row filter, not on
 * SQL the fake cannot run.
 */
jest.mock('../config/database', () => {
  let rows = {};
  const builder = (table) => {
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve(rows[table] || []).then(res, rej);
        if (prop === 'first') return async () => (rows[table] || [])[0];
        return () => b;
      },
    });
    return b;
  };
  const db = (table) => builder(String(table).split(' ')[0]);
  // buildLocalReceivablesQuery wraps the grouped local-sale query in a derived
  // table: db.from(grouped.as('lr')). Its rows are what the test registers here.
  db.from = () => builder('__local_receivables__');
  db.raw = (x) => x;
  db.fn = { now: () => 'now()' };
  db.__set = (r) => { rows = r; };
  return db;
});

jest.mock('../middleware/rbac', () => {
  const authorize = (module, action) => {
    const guard = (req, res, next) => next();
    guard.permission = `${module}.${action}`;
    return guard;
  };
  const passThrough = () => (req, res, next) => next();
  return Object.assign(authorize, {
    authorize, authorizeAny: passThrough, authorizeRole: passThrough, denyRoles: passThrough,
    userHasPermission: async () => true, getScopedWarehouseIds: async () => null,
  });
});

const db = require('../config/database');
const finance = require('../modules/finance/finance.controller');
const { requireCostVisibility } = require('../utils/costVisibility');

const asRole = (role, query = {}) => ({ user: { id: 7, _roleName: role }, query, params: {} });
function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

const payableRows = () => ({
  payables: [
    { id: 1, pay_no: 'PAY-0001', entity: 'mill', category: 'Raw Material', supplier_id: 5, supplier_name: 'Rice Supplier', original_amount: 100000, paid_amount: 0, outstanding: 100000, status: 'Pending', created_at: '2026-10-01' },
    { id: 2, pay_no: 'PAY-0002', entity: 'export', category: 'Printed Bags', supplier_id: 6, supplier_name: 'Bag Vendor', original_amount: 50000, paid_amount: 0, outstanding: 50000, status: 'Pending', created_at: '2026-10-02' },
    { id: 3, pay_no: 'PAY-0003', entity: 'mill', category: 'Transport', hauler_id: 2, hauler_name: 'Truck Co', original_amount: 8000, paid_amount: 0, outstanding: 8000, status: 'Pending', created_at: '2026-10-03' },
  ],
  batch_source_lots: [],
  milling_costs: [{ id: 11, batch_id: 9, category: 'electricity', amount: 4000, batch_no: 'M-009', processing_type: 'standard', created_at: '2026-10-01' }],
  export_order_costs: [{ id: 21, order_id: 4, category: 'freight', amount: 900, order_no: 'EXP-004', customer_name: 'Gulf Buyer', created_at: '2026-10-01' }],
  mill_expenses: [{ id: 31, category: 'fuel', amount: 1500, expense_date: '2026-10-02', created_at: '2026-10-02' }],
});

describe('GET /milling/payables — the mill\'s payables only', () => {
  test('mill stored + derived payables are in; export payables and export costs are out', async () => {
    db.__set(payableRows());
    const r = res();
    await finance.getMillPayables(asRole('Mill Manager'), r);
    expect(r.statusCode).toBe(200);
    const ids = r.body.data.payables.map((p) => p.id).sort();
    expect(ids).toEqual([1, 3, 'MC-11', 'ME-31'].sort());
    expect(r.body.data.payables.every((p) => p.entity === 'mill')).toBe(true);
    expect(r.body.data.pagination.total).toBe(4);
  });

  test('same response shape as /finance/payables, which still returns every entity', async () => {
    db.__set(payableRows());
    const all = res();
    await finance.getPayables(asRole('Mill Manager'), all);
    const ids = all.body.data.payables.map((p) => String(p.id));
    expect(ids).toEqual(expect.arrayContaining(['1', '2', '3', 'MC-11', 'EC-21', 'ME-31']));
    expect(Object.keys(all.body.data).sort()).toEqual(['pagination', 'payables', 'source']);

    db.__set(payableRows());
    const mill = res();
    await finance.getMillPayables(asRole('Mill Manager'), mill);
    expect(Object.keys(mill.body.data).sort()).toEqual(['pagination', 'payables', 'source']);
  });

  test('the Mill Operator sees the mill\'s party names (on the visible list since full mill access)', async () => {
    db.__set(payableRows());
    const r = res();
    await finance.getMillPayables(asRole('Mill Operator'), r);
    const byId = Object.fromEntries(r.body.data.payables.map((p) => [p.id, p]));
    expect(byId[1]).toMatchObject({ supplier_name: 'Rice Supplier', supplier_id: 5, outstanding: 100000 });
    expect(byId[3].hauler_name).toBe('Truck Co');
  });

  test('a still-masked role gets the generic label', async () => {
    db.__set(payableRows());
    const r = res();
    await finance.getMillPayables(asRole('QC Analyst'), r);
    const byId = Object.fromEntries(r.body.data.payables.map((p) => [p.id, p]));
    expect(byId[1]).toMatchObject({ supplier_name: 'Supplier', supplier_id: null });
  });
});

const receivableRows = () => ({
  receivables: [
    { id: 41, recv_no: 'RCV-OB-1', entity: 'mill', expected_amount: 20000, received_amount: 0, outstanding: 20000, customer_id: 8, kind: 'receivable', due_date: '2026-10-01' },
    { id: 42, recv_no: 'RCV-EXP-1', entity: 'export', expected_amount: 99000, received_amount: 0, outstanding: 99000, customer_id: 9, order_id: 4, kind: 'receivable', due_date: '2026-10-02' },
  ],
  __local_receivables__: [
    { id: 51, recv_no: 'LS-0051', entity: 'mill', expected_amount: 30000, received_amount: 10000, outstanding: 20000, customer_id: 8, kind: 'local_sale', due_date: '2026-10-03' },
    { id: 52, recv_no: 'LS-0052', entity: 'export', expected_amount: 7000, received_amount: 0, outstanding: 7000, customer_id: 9, kind: 'local_sale', due_date: '2026-10-04' },
  ],
});

describe('GET /milling/receivables — what the mill is owed only', () => {
  test('mill receivables and mill local sales are in; export ones are out', async () => {
    db.__set(receivableRows());
    const r = res();
    await finance.getMillReceivables(asRole('Mill Manager'), r);
    expect(r.statusCode).toBe(200);
    const recvNos = r.body.data.receivables.map((x) => x.recv_no).sort();
    expect(recvNos).toEqual(['LS-0051', 'RCV-OB-1']);
    expect(r.body.data.pagination.total).toBe(2);
  });

  test('/finance/receivables still returns both sides', async () => {
    db.__set(receivableRows());
    const r = res();
    await finance.getReceivables(asRole('Mill Manager'), r);
    expect(r.body.data.receivables.map((x) => x.recv_no).sort()).toEqual(['LS-0051', 'LS-0052', 'RCV-EXP-1', 'RCV-OB-1']);
  });
});

describe('the routes', () => {
  const milling = require('../modules/milling/milling.routes');
  const stackOf = (path) => milling.stack
    .find((l) => l.route && l.route.path === path && l.route.methods.get).route.stack.map((s) => s.handle);

  test.each([
    ['/payables', finance.getMillPayables],
    ['/receivables', finance.getMillReceivables],
  ])('GET /milling%s: milling.view + cost visibility, read-only handler', (path, handler) => {
    const stack = stackOf(path);
    expect(stack.map((h) => h.permission)).toContain('milling.view');
    expect(stack).toContain(requireCostVisibility);
    expect(stack[stack.length - 1]).toBe(handler);
  });

  test('no write route on those paths — paying stays on the finance routes', () => {
    const writes = milling.stack.filter((l) => l.route && ['/payables', '/receivables'].includes(l.route.path)
      && (l.route.methods.post || l.route.methods.put || l.route.methods.patch || l.route.methods.delete));
    expect(writes).toEqual([]);
  });
});
