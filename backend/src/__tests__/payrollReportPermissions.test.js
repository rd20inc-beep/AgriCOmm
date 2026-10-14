/**
 * P1-06 / D-24 — salaries are for payroll.view only.
 *
 * /api/reporting/payroll-* used to need only reports.view, which the seed also
 * grants to Export Manager, QC Analyst and Inventory Officer. Runs the REAL
 * reporting router and the REAL rbac middleware against an in-memory role /
 * permission table; the controller is stubbed (we only test who gets through).
 */
jest.mock('../config/database', () => require('./helpers/rbacMemoryDb').db);
jest.mock('../controllers/reportingController', () => new Proxy({}, {
  get: (_, name) => (req, res) => res.json({ success: true, handler: String(name) }),
}));

const express = require('express');
const request = require('supertest');
const rdb = require('./helpers/rbacMemoryDb');

// Grants as seeded (20260319_008 + later role migrations), reduced to what these
// routes look at. QC / Inventory hold reports.view in the seed under audit.
const ROLES = {
  'Export Manager': ['reports.view', 'reports.view_cost', 'finance.view'],
  'QC Analyst': ['reports.view', 'milling.view'],
  'Inventory Officer': ['reports.view', 'inventory.view'],
  'Mill Operator': ['reports.view', 'reports.view_cost'],
  'Finance Manager': ['reports.view', 'finance.view', 'payroll.view', 'payroll.approve', 'payroll.pay'],
  'Mill Manager': ['reports.view', 'finance.view', 'payroll.view'],
  'Read-Only Auditor': ['reports.view', 'finance.view', 'payroll.view'],
  Owner: [],
  'Super Admin': [],
};

let currentUser;
const app = express();
app.use((req, res, next) => { req.user = { ...currentUser }; next(); });
app.use('/api/reporting', require('../modules/analytics/reporting.routes'));

const PAYROLL_ROUTES = ['/payroll-ledger', '/payroll-overview', '/payroll-pending', '/payroll-analytics'];

beforeEach(() => rdb.reset({ roles: ROLES }));

describe.each(PAYROLL_ROUTES)('GET /api/reporting%s', (route) => {
  it.each(['Export Manager', 'QC Analyst', 'Inventory Officer', 'Mill Operator'])('%s → 403', async (role) => {
    currentUser = rdb.userFor(role);
    const r = await request(app).get(`/api/reporting${route}`);
    expect(r.status).toBe(403);
  });

  it.each(['Finance Manager', 'Mill Manager', 'Read-Only Auditor', 'Owner', 'Super Admin'])('%s → 200', async (role) => {
    currentUser = rdb.userFor(role);
    const r = await request(app).get(`/api/reporting${route}`);
    expect(r.status).toBe(200);
  });
});

it('a non-payroll report is unchanged for reports.view holders', async () => {
  currentUser = rdb.userFor('QC Analyst');
  const r = await request(app).get('/api/reporting/stock-ledger');
  expect(r.status).toBe(200);
});
