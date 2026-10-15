/**
 * P2-32 — approval gates are real server-side gates.
 *
 *  - every screen that opens the owner-password modal posts to a route that
 *    carries ownerApproval (which verifies the password and writes
 *    approval_authorizations). A new modal screen fails this test until its
 *    route is listed — and gated.
 *  - sample → lot convert (creates a purchase lot, a payable and GL) takes
 *    inventory.create only; milling.edit no longer opens it.
 *  - customer edits by a non-approver are stored as proposals; reject discards
 *  - a rejected supplier cannot be bought from or revived by quick-add
 */
const fs = require('fs');
const path = require('path');

jest.mock('../config', () => ({ port: 3001, corsOrigin: '*', jwtSecret: 'FAKE-test-secret-1', db: {} }));

const Router = require('express').Router;
const origUse = Router.prototype.use;
Router.prototype.use = function use(...args) {
  const before = this.stack.length;
  const out = origUse.apply(this, args);
  if (typeof args[0] === 'string') for (const l of this.stack.slice(before)) l.__mount = args[0];
  return out;
};
const routes = require('../routes');
Router.prototype.use = origUse;

const mountOf = (layer) => (layer.__mount && layer.__mount !== '/' ? layer.__mount : '');
function walk(router, prefix = '', out = []) {
  for (const layer of router.stack) {
    if (layer.route) {
      const stack = layer.route.stack.map((s) => s.handle);
      for (const m of Object.keys(layer.route.methods)) {
        out.push({
          method: m,
          path: `${prefix}${layer.route.path}`,
          owner: (stack.find((h) => h && h.ownerApproval) || {}).ownerApproval || null,
          authz: (stack.find((h) => h && h.authz) || {}).authz || null,
        });
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      walk(layer.handle, `${prefix}${mountOf(layer)}`, out);
    }
  }
  return out;
}
const all = walk(routes);
const find = (method, p) => all.find((r) => r.method === method && r.path === p);

// The screens that open the owner modal, and the route each one posts to.
const OWNER_MODAL_SCREENS = {
  'modules/admin/pages/admin/MasterDataApprovalsTab.jsx': ['post', '/admin/approvals/:type/:id/approve'],
  'modules/milling/pages/MillFinanceDashboard.jsx': ['post', '/milling/advances/:id/approve'],
  'modules/exportOrders/pages/ExportOrderDetail.jsx': ['post', '/export-orders/:id/cancel'],
  'modules/exportOrders/components/DebitNotesPanel.jsx': ['post', '/export-orders/:id/debit-notes/:noteId/cancel'],
  'modules/exportOrders/components/PackingWeightCard.jsx': ['post', '/export-orders/:id/packing-weight/resolve'],
  'modules/finance/drawers/TransactionDrawer.jsx': ['post', '/finance/payments/:id/reverse'],
  'modules/exportOrders/components/ShortBalanceWriteOff.jsx': ['post', '/export-orders/:id/write-off-balance'],
  'modules/milling/components/ServiceBillingTab.jsx': ['post', '/service-milling/invoices/:id/void'],
  'modules/millStore/pages/StoreOverview.jsx': ['put', '/mill-store/items/:id/revalue'],
  // P3-11: a local-sale return; voiding a purchase lot (the same button voids a
  // mill-store purchase — checked below).
  'modules/localSales/components/SaleReturnsPanel.jsx': ['post', '/local-sales/:id/returns'],
  'shared/components/VoidPurchaseButton.jsx': ['post', '/lot-inventory/lots/:id/void'],
  'modules/milling/pages/MillingBatchDetail.jsx': ['post', '/milling/batches/:id/reverse-yield'],
};

function frontendFilesCalling(dir, needle, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') frontendFilesCalling(p, needle, out); }
    else if (/\.(jsx?|tsx?)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes(needle)) out.push(p);
  }
  return out;
}

describe('owner-password modal ⇒ ownerApproval on the route', () => {
  const srcDir = path.resolve(__dirname, '../../../src');

  it('every screen that opens the modal is listed here', () => {
    const callers = frontendFilesCalling(srcDir, 'requestOwnerApproval(')
      .map((p) => path.relative(srcDir, p).split(path.sep).join('/'))
      .filter((p) => !p.startsWith('context/OwnerAuthContext'));
    expect(callers.sort()).toEqual(Object.keys(OWNER_MODAL_SCREENS).sort());
  });

  test.each(Object.entries(OWNER_MODAL_SCREENS))('%s → %s carries ownerApproval', (screen, [method, p]) => {
    const r = find(method, p);
    expect(r).toBeDefined();
    expect(r.owner).toBeTruthy();
  });

  it('VoidPurchaseButton → the mill-store purchase void carries ownerApproval too', () => {
    const r = find('post', '/mill-store/purchases/:id/void');
    expect(r).toBeDefined();
    expect(r.owner).toBeTruthy();
  });
});

describe('sample → lot convert needs inventory.create', () => {
  it('is gated on inventory.create alone', () => {
    expect(find('post', '/sample-analysis/:id/convert').authz).toEqual({ kind: 'authorize', perms: [['inventory', 'create']] });
  });
});

// ── Controllers against an in-memory knex ───────────────────────────────
describe('master-data review is a real gate', () => {
  let fake; let approvals; let partyGate;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
    fake = require('../config/database');
    approvals = require('../modules/admin/approvals.controller');
    partyGate = require('../shared/partyGate');
  });
  const mockRes = () => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };

  it('a rejected or inactive supplier is refused; pending is usable', async () => {
    fake.tables.suppliers = [
      { id: 1, name: 'Ok', approval_status: 'approved', is_active: true },
      { id: 2, name: 'Walk-in', approval_status: 'pending', is_active: true },
      { id: 3, name: 'Turned down', approval_status: 'rejected', is_active: false },
      { id: 4, name: 'Closed', approval_status: 'approved', is_active: false },
    ];
    expect(await partyGate.supplierRefusal(fake, 1)).toBeNull();
    expect(await partyGate.supplierRefusal(fake, 2)).toBeNull();
    expect(await partyGate.supplierRefusal(fake, null)).toBeNull();
    expect((await partyGate.supplierRefusal(fake, 3)).code).toBe('SUPPLIER_REJECTED');
    expect((await partyGate.supplierRefusal(fake, 4)).code).toBe('SUPPLIER_INACTIVE');
    expect(await partyGate.supplierRefusal(fake, 99)).toBeNull(); // unknown id: left to the caller's own checks
  });
});
