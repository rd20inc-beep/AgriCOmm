/**
 * P1-12 follow-up — the mill-store API hides cost from cost-blind roles too.
 * StoreOverview gates the columns in the browser; this is the API side: the
 * router-level layer nulls avg cost, stock value and purchase totals for the QC
 * Analyst / Inventory Officer and leaves them for cost-seeing roles.
 */
jest.mock('../config/database', () => require('./helpers/recordingKnex')());
jest.mock('../middleware/rbac', () => {
  const authorize = () => (req, res, next) => next();
  const userHasPermission = async (req, module, action) => {
    if (['Owner', 'Super Admin'].includes(req.user?.role)) return true;
    return !!req.user?.permissions?.has(`${module}.${action}`);
  };
  return Object.assign(authorize, { authorize, authorizeAny: () => (q, r, n) => n(), authorizeRole: () => (q, r, n) => n(), userHasPermission });
});
jest.mock('../middleware/audit', () => () => (req, res, next) => next());
jest.mock('../middleware/ownerApproval', () => () => (req, res, next) => next());

const router = require('../modules/millStore/millStore.routes');

// The first router-level (non-route) layer is the redaction middleware.
const redactLayer = router.stack.find((l) => !l.route);

async function respondAs(user, body) {
  let sent;
  const res = { json: (b) => { sent = b; return res; } };
  await new Promise((resolve, reject) => redactLayer.handle({ user }, res, (err) => (err ? reject(err) : resolve())));
  res.json(JSON.parse(JSON.stringify(body)));
  return sent;
}

const payload = {
  success: true,
  data: {
    items: [{ id: 1, name: 'PP bag 25kg', quantity_available: 900, avg_cost_per_unit: 41.5, stock_value: 37350 }],
    purchases: [{ id: 9, purchase_no: 'MSP-1', total_amount: 125000, lines: [{ item_id: 1, qty: 3000, unit_cost: 41.66, line_total: 125000 }] }],
  },
};

const qc = { id: 5, role: 'QC Analyst', permissions: new Set(['mill_store.view']) };
const operator = { id: 6, role: 'Mill Operator', permissions: new Set(['mill_store.view', 'reports.view_cost', 'reports.view_profit']) };

test('a cost-blind role gets quantities but no cost, stock value or purchase totals', async () => {
  const out = await respondAs(qc, payload);
  expect(out.data.items[0]).toMatchObject({ quantity_available: 900, avg_cost_per_unit: null, stock_value: null });
  expect(out.data.purchases[0]).toMatchObject({ purchase_no: 'MSP-1', total_amount: null });
  expect(out.data.purchases[0].lines[0]).toMatchObject({ qty: 3000, unit_cost: null, line_total: null });
});

test('a cost-seeing role gets the figures untouched', async () => {
  const out = await respondAs(operator, payload);
  expect(out).toEqual(payload);
});
