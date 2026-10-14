/**
 * P1-05 — /api/ai routes: the query runs only on the read-only AI pool, says
 * "not configured" instead of falling back to the app role, never returns DB
 * error text, refuses guarded SQL, and the helper endpoints need the owning
 * feature permission. Real router + real rbac (in-memory role table); the
 * model and the AI pool are stubbed.
 */
jest.mock('../config/database', () => require('./helpers/rbacMemoryDb').db);
jest.mock('../modules/ai/ai.service', () => ({ enabled: () => true, complete: jest.fn() }));
jest.mock('../modules/ai/aiDb', () => {
  class AiQueryNotConfigured extends Error {}
  return { AiQueryNotConfigured, isConfigured: jest.fn(() => true), runReadOnly: jest.fn() };
});

const express = require('express');
const request = require('supertest');
const rdb = require('./helpers/rbacMemoryDb');
const ai = require('../modules/ai/ai.service');
const aiDb = require('../modules/ai/aiDb');
const router = require('../modules/ai/ai.routes');
const { VIEWS } = require('../../migrations/20261015_333_ai_readonly_views_and_role');

const ROLES = {
  'Finance Manager': ['finance.view', 'reports.view', 'payroll.view'],
  'Export Manager': ['reports.view', 'reports.view_cost'],
  'QC Analyst': ['milling.view'],
  'Mill Manager': ['milling.create', 'milling.view', 'reports.view', 'reports.view_cost'],
  'Read-Only Auditor': ['finance.view', 'reports.view'],
};

let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { ...currentUser }; next(); });
app.use('/api/ai', router);
const as = (role) => { currentUser = rdb.userFor(role); };

beforeEach(() => {
  rdb.reset({ roles: ROLES });
  rdb.db.raw = async () => ({ rows: [] }); // schemaContext's information_schema read
  ai.complete.mockReset();
  aiDb.runReadOnly.mockReset();
  aiDb.isConfigured.mockReturnValue(true);
});

const ask = (sql) => {
  ai.complete.mockResolvedValue({ sql, explanation: 'x' });
  return request(app).post('/api/ai/query').send({ question: 'q' });
};

it('every curated table is a view created by migration 333, and none is payroll', () => {
  for (const t of Object.keys(router.CURATED)) expect(VIEWS).toHaveProperty(t);
  expect(Object.keys(router.CURATED).some((t) => /^mill_(workers|payroll|attendance|worker|salary)/.test(t))).toBe(false);
});

it('without the read-only role it says so, and never calls the model or a DB', async () => {
  aiDb.isConfigured.mockReturnValue(false);
  as('Finance Manager');
  const r = await ask('SELECT 1 FROM products');
  expect(r.status).toBe(503);
  expect(r.body.message).toMatch(/not configured/);
  expect(ai.complete).not.toHaveBeenCalled();
  expect(aiDb.runReadOnly).not.toHaveBeenCalled();
});

it('runs an allowed query on the AI pool with the row cap', async () => {
  aiDb.runReadOnly.mockResolvedValue({ rows: [{ lot_no: 'L1' }], truncated: false });
  as('Export Manager');
  const r = await ask('SELECT lot_no FROM inventory_lots');
  expect(r.status).toBe(200);
  expect(r.body.data.rows).toEqual([{ lot_no: 'L1' }]);
  expect(aiDb.runReadOnly).toHaveBeenCalledWith('SELECT lot_no FROM inventory_lots', expect.objectContaining({ rowCap: 200 }));
});

it('never returns database error text', async () => {
  aiDb.runReadOnly.mockRejectedValue(Object.assign(new Error('relation "secret_table" does not exist at character 15'), { code: '42P01' }));
  as('Export Manager');
  const r = await ask('SELECT lot_no FROM inventory_lots');
  expect(r.status).toBe(400);
  expect(JSON.stringify(r.body)).not.toMatch(/secret_table|42P01|does not exist/);
});

it.each([
  'SELECT * FROM audit_logs',
  'SELECT * FROM mill_salary_revisions',
  'SELECT portal_pin_hash FROM mill_workers',
  "SELECT query_to_xml('select * from users', true, true, '')",
])('refuses %s without touching the DB', async (sql) => {
  as('Finance Manager');
  const r = await ask(sql);
  expect(r.status).toBe(400);
  expect(aiDb.runReadOnly).not.toHaveBeenCalled();
});

it('a cost-only user may not read the finance views', async () => {
  as('Export Manager');
  const r = await ask('SELECT SUM(debit) FROM journal_lines');
  expect(r.status).toBe(403);
  expect(aiDb.runReadOnly).not.toHaveBeenCalled();
});

it('a user with neither reports.view_cost nor finance.view is refused', async () => {
  as('QC Analyst');
  expect((await ask('SELECT 1 FROM products')).status).toBe(403);
});

describe('helper endpoints need their feature permission', () => {
  beforeEach(() => ai.complete.mockResolvedValue({ category: 'fuel', summary: 's' }));

  it('categorize-expense: milling.create', async () => {
    as('Read-Only Auditor');
    expect((await request(app).post('/api/ai/categorize-expense').send({ description: 'diesel' })).status).toBe(403);
    as('Mill Manager');
    expect((await request(app).post('/api/ai/categorize-expense').send({ description: 'diesel' })).status).toBe(200);
  });

  it('summarize-report: reports.view', async () => {
    as('QC Analyst');
    expect((await request(app).post('/api/ai/summarize-report').send({ kind: 'pnl', figures: {} })).status).toBe(403);
    as('Read-Only Auditor');
    expect((await request(app).post('/api/ai/summarize-report').send({ kind: 'pnl', figures: {} })).status).toBe(200);
  });
});
