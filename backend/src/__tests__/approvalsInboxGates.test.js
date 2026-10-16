/**
 * Approvals inbox (P5-02) — no DB.
 *
 * The inbox lists a type only for users who pass that type's approve route
 * guard. These tests pin each source's `gate` to the real route's `authz` tag
 * (so a gate changed on the route cannot silently drift from the inbox), check
 * the per-user filtering and maker-checker rules, and check that every page the
 * inbox / bell links to is a real frontend route.
 */
jest.mock('../config', () => ({ port: 3001, corsOrigin: '*', jwtSecret: 'FAKE-test-secret-1', db: {} }));

const fs = require('fs');
const path = require('path');

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

const { SOURCES, sourcesFor } = require('../modules/approvalsInbox/approvalsInbox.service');
const { accessOf, passesGuard } = require('../services/accessContext');
const { ROUTES, canOpen, safeLink } = require('../services/routeAccess');
const { ACCEPT_PERMISSION } = require('../modules/finance/transferAcceptPermission');

const mountOf = (layer) => (layer.__mount && layer.__mount !== '/' ? layer.__mount : '');
function walk(router, prefix = '', inherited = null, out = []) {
  let guard = inherited;
  for (const layer of router.stack) {
    if (layer.route) {
      const handles = layer.route.stack.map((s) => s.handle);
      const own = handles.map((h) => h && h.authz).find(Boolean);
      for (const m of Object.keys(layer.route.methods)) {
        out.push({ method: m, path: `${prefix}${layer.route.path}`, authz: own || guard, handles });
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      walk(layer.handle, `${prefix}${mountOf(layer)}`, guard, out);
    } else if (layer.handle && layer.handle.authz) {
      guard = layer.handle.authz;
    }
  }
  return out;
}
const all = walk(routes);
const find = ([method, p]) => all.find((r) => r.method === method && r.path === p);

describe('each inbox type uses its approve route\'s guard', () => {
  it.each(SOURCES.filter((s) => !s.gateFor).map((s) => [s.type, s]))('%s', (_type, s) => {
    const r = find(s.route);
    expect(r).toBeDefined();
    expect(r.authz).toEqual(s.gate);
  });

  it('fund transfers: the accept route resolves the shared ACCEPT_PERMISSION per transfer', () => {
    const s = SOURCES.find((x) => x.type === 'fund_transfer');
    expect(find(s.route)).toBeDefined();
    expect(s.gateFor({ to_entity: 'general' })).toEqual({ kind: 'authorize', perms: [ACCEPT_PERMISSION.general] });
    expect(s.gateFor({ to_entity: 'mill' })).toEqual({ kind: 'authorize', perms: [ACCEPT_PERMISSION.mill] });
    expect(s.gateFor({ to_entity: 'export' })).toBeNull();
    const src = fs.readFileSync(path.join(__dirname, '../modules/finance/finance.routes.js'), 'utf8');
    expect(src).toMatch(/require\('\.\/transferAcceptPermission'\)/);
  });

  it('every approval type is listed once', () => {
    const types = SOURCES.map((s) => s.type);
    expect(new Set(types).size).toBe(types.length);
    // The queues P5-02 names, at minimum.
    expect(types).toEqual(expect.arrayContaining([
      'master_data', 'document', 'generated_document', 'stock_adjustment', 'store_adjustment',
      'payroll_run', 'salary_advance', 'purchase_requirement', 'packing_variance', 'fund_transfer',
    ]));
  });
});

describe('per-user filtering', () => {
  const owner = accessOf({ id: 1, roleName: 'Owner' });
  const superAdmin = accessOf({ id: 2, roleName: 'Super Admin' });
  const millMgr = accessOf({ id: 3, roleName: 'Mill Manager', permissions: ['milling.view', 'milling.edit', 'mill_store.view', 'payroll.edit'] });
  const finance = accessOf({ id: 4, roleName: 'Finance Manager', permissions: ['finance.view', 'finance.confirm_payment', 'payroll.approve', 'payroll.view'] });
  const auditor = accessOf({ id: 5, roleName: 'Read-Only Auditor', permissions: ['finance.view', 'payroll.view'] });
  const types = (a) => sourcesFor(a).map((s) => s.type);

  it('Owner sees every type; Super Admin every type (role-list gates name both)', () => {
    expect(types(owner)).toEqual(SOURCES.map((s) => s.type));
    expect(types(superAdmin)).toEqual(SOURCES.map((s) => s.type));
  });

  it('store adjustments reach Owner / Super Admin, not the Mill Manager who cannot approve them', () => {
    expect(types(owner)).toContain('store_adjustment');
    expect(types(superAdmin)).toContain('store_adjustment');
    expect(types(millMgr)).not.toContain('store_adjustment');
  });

  it('role-list gates follow role names', () => {
    expect(types(millMgr)).toEqual(expect.arrayContaining(['purchase_requirement', 'local_sale', 'fund_transfer', 'worker_request']));
    expect(types(millMgr)).not.toContain('milling_batch');
    expect(types(finance)).not.toContain('purchase_requirement');
  });

  it('permission gates follow permissions', () => {
    expect(types(finance)).toEqual(expect.arrayContaining(['export_receipt', 'payroll_run', 'salary_advance', 'leave_request', 'fund_transfer']));
    expect(types(finance)).not.toContain('master_data');
    expect(types(auditor)).toEqual([]);
  });

  it('a module allow-list narrows authorize gates like rbac.js does', () => {
    const scoped = accessOf({ id: 6, roleName: 'Finance Manager', permissions: ['payroll.approve', 'finance.confirm_payment'], moduleScopes: ['payroll'] });
    expect(passesGuard(scoped, { kind: 'authorize', perms: [['payroll', 'approve']] })).toBe(true);
    expect(passesGuard(scoped, { kind: 'authorize', perms: [['finance', 'confirm_payment']] })).toBe(false);
  });
});

describe('links are real routes and permission-safe', () => {
  const app = path.join(__dirname, '../../../src/App.jsx');
  const hasApp = fs.existsSync(app);
  (hasApp ? it : it.skip)('every routeAccess path is an App.jsx route', () => {
    const src = fs.readFileSync(app, 'utf8');
    const paths = new Set([...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
    // /finance/* children are declared relative to the parent route.
    const financeChild = (p) => p.startsWith('/finance/') && paths.has(p.slice('/finance/'.length));
    for (const r of ROUTES) {
      const ok = paths.has(r.path) || financeChild(r.path) || (r.path === '/finance' && paths.has('/finance/*'));
      expect({ path: r.path, ok }).toEqual({ path: r.path, ok: true });
    }
  });

  it('the dead /export-orders/:id link is not used anywhere in the inbox', () => {
    const src = fs.readFileSync(path.join(__dirname, '../modules/approvalsInbox/approvalsInbox.service.js'), 'utf8');
    expect(src).not.toMatch(/link: [^\n]*\/export-orders\//);
  });

  it('a link is only handed to someone who may open the page', () => {
    const fm = accessOf({ id: 4, roleName: 'Finance Manager', permissions: ['finance.view', 'payroll.view', 'payroll.approve'] });
    const noFinance = accessOf({ id: 7, roleName: 'QC Analyst', permissions: ['payroll.approve', 'payroll.view'] });
    expect(safeLink(fm, '/finance/payroll')).toBe('/finance/payroll');
    expect(safeLink(noFinance, '/finance/payroll')).toBeNull(); // /finance/* needs finance.view
    expect(safeLink(fm, '/export/12')).toBeNull(); // no export_orders.view
    expect(canOpen(fm, '/somewhere/unknown')).toBe(false);
    expect(safeLink(fm, '/approvals?type=payroll_run')).toBe('/approvals?type=payroll_run');
  });
});
