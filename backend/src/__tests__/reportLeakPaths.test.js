/**
 * P1-11 — data-leak paths in scheduled / saved reports, communications and chat.
 *
 * Runs the REAL reporting router + controller + service and the REAL rbac
 * middleware against an in-memory database (helpers/rbacMemoryDb). Only the
 * task runner, the mailer and the heavy report builders are stubbed.
 */
jest.mock('../config/database', () => require('./helpers/rbacMemoryDb').db);
jest.mock('../modules/admin/automation.service', () => ({
  runTask: jest.fn(async (id) => ({ task_id: id, status: 'Success', items_processed: 1 })),
}));

const express = require('express');
const request = require('supertest');
const rdb = require('./helpers/rbacMemoryDb');
const automation = require('../modules/admin/automation.service');
const reportingService = require('../modules/analytics/reporting.service');

// reports.view_finance: what mig 470 grants every reports.view holder but the
// Mill Operator / Mill Manager.
const ROLES = {
  'Finance Manager': ['reports.view', 'reports.view_finance', 'finance.view'],
  'Export Manager': ['reports.view', 'reports.view_finance', 'finance.view'],
  'QC Analyst': ['reports.view', 'reports.view_finance'],
  'Mill Operator': ['reports.view', 'reports.view_cost'],
  Owner: [],
};

let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { ...currentUser }; next(); });
app.use('/api/reporting', require('../modules/analytics/reporting.routes'));
const as = (role) => { currentUser = rdb.userFor(role); };

const tasks = () => rdb.state.tables.scheduled_tasks;

beforeEach(() => {
  automation.runTask.mockClear();
  rdb.reset({
    roles: ROLES,
    tables: {
      scheduled_tasks: [
        { id: 50, task_type: 'payroll_prepare', name: 'Prepare payroll', config: '{}' },
        { id: 51, task_type: 'report_email', name: 'FM digest', config: JSON.stringify({ reportType: 'stock_aging', recipients: ['finance.manager@agri.test'], createdBy: 1 }) },
        { id: 52, task_type: 'report_email', name: 'legacy', config: JSON.stringify({ reportType: 'stock_aging', recipients: ['owner@agri.test'] }) },
      ],
      task_execution_log: [],
      audit_logs: [],
      saved_reports: [
        { id: 70, name: 'FM private', report_type: 'stock_aging', created_by: 1, is_shared: false, filters: {} },
        { id: 71, name: 'FM shared', report_type: 'stock_aging', created_by: 1, is_shared: true, filters: {} },
      ],
    },
  });
});

describe('scheduled report emails', () => {
  it('reports.view alone may not create a schedule', async () => {
    as('QC Analyst');
    const r = await request(app).post('/api/reporting/scheduled-reports').send({ reportType: 'stock_aging', recipients: 'qc.analyst@agri.test' });
    expect(r.status).toBe(403);
  });

  it('rejects a recipient outside the company domains', async () => {
    as('Finance Manager');
    const r = await request(app).post('/api/reporting/scheduled-reports').send({ reportType: 'stock_aging', recipients: 'me@agri.test, leak@gmail.com' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/gmail\.com/);
    expect(tasks()).toHaveLength(3);
  });

  it('honours the report_email_allowed_domains setting when set', async () => {
    rdb.state.tables.system_settings = [{ id: 1, key: 'report_email_allowed_domains', value: 'partner.example' }];
    as('Finance Manager');
    const bad = await request(app).post('/api/reporting/scheduled-reports').send({ reportType: 'stock_aging', recipients: 'me@agri.test' });
    expect(bad.status).toBe(400);
    const ok = await request(app).post('/api/reporting/scheduled-reports').send({ reportType: 'stock_aging', recipients: 'x@partner.example' });
    expect(ok.status).toBe(200);
  });

  it('creates an internal schedule, recording its creator, and audits it', async () => {
    as('Finance Manager');
    const r = await request(app).post('/api/reporting/scheduled-reports').send({ reportType: 'stock_aging', recipients: 'export.manager@agri.test' });
    expect(r.status).toBe(200);
    const row = tasks().find((t) => t.id === r.body.id);
    expect(JSON.parse(row.config).createdBy).toBe(1);
    expect(rdb.state.tables.audit_logs.map((a) => a.action)).toContain('scheduled_report_create');
  });

  it('run-now refuses a non-report task (payroll_prepare) even for its id', async () => {
    as('Finance Manager');
    const r = await request(app).post('/api/reporting/scheduled-reports/50/run');
    expect(r.status).toBe(404);
    expect(automation.runTask).not.toHaveBeenCalled();
  });

  it('run-now / delete refuse another user\'s schedule', async () => {
    as('Export Manager');
    expect((await request(app).post('/api/reporting/scheduled-reports/51/run')).status).toBe(404);
    expect((await request(app).delete('/api/reporting/scheduled-reports/51')).status).toBe(404);
    expect(automation.runTask).not.toHaveBeenCalled();
    expect(tasks().find((t) => t.id === 51)).toBeTruthy();
  });

  it('the creator may run their own; an admin may run a legacy one', async () => {
    as('Finance Manager');
    expect((await request(app).post('/api/reporting/scheduled-reports/51/run')).status).toBe(200);
    expect((await request(app).post('/api/reporting/scheduled-reports/52/run')).status).toBe(404);
    as('Owner');
    expect((await request(app).post('/api/reporting/scheduled-reports/52/run')).status).toBe(200);
    expect(automation.runTask.mock.calls.map((c) => c[0])).toEqual([51, 52]);
  });

  it('lists only your own schedules unless you are an admin', async () => {
    as('Export Manager');
    expect((await request(app).get('/api/reporting/scheduled-reports')).body.rows).toEqual([]);
    as('Owner');
    expect((await request(app).get('/api/reporting/scheduled-reports')).body.rows).toHaveLength(2);
  });
});

describe('saved reports', () => {
  beforeEach(() => {
    jest.spyOn(reportingService, 'getStockAgingReport').mockResolvedValue([{ lotNo: 'L1', qty: 5, totalValue: 900 }]);
  });

  it('another user cannot run a private report, but can run a shared one', async () => {
    as('Export Manager');
    expect((await request(app).post('/api/reporting/saved/70/run')).status).toBe(404);
    expect((await request(app).post('/api/reporting/saved/71/run')).status).toBe(200);
  });

  it('only the owner can delete', async () => {
    as('Export Manager');
    expect((await request(app).delete('/api/reporting/saved/71')).status).toBe(404);
    as('Finance Manager');
    expect((await request(app).delete('/api/reporting/saved/71')).status).toBe(200);
  });

  it('a run is redacted for a cost-blind role', async () => {
    as('QC Analyst');
    const r = await request(app).post('/api/reporting/saved/71/run');
    expect(r.status).toBe(200);
    expect(r.body.data.result[0].totalValue).toBeNull();
  });

  it('the Mill Operator is kept out (noFinanceForOperator)', async () => {
    as('Mill Operator');
    expect((await request(app).get('/api/reporting/saved')).status).toBe(403);
    expect((await request(app).post('/api/reporting/saved/71/run')).status).toBe(403);
  });
});
