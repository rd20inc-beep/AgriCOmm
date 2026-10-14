/**
 * P1-11 — a scheduled report email goes only to internal domains (checked again
 * at send time, so a pre-existing schedule to an outside address stops), and
 * each recipient gets the report redacted for their own role.
 */
jest.mock('../config/database', () => require('./helpers/rbacMemoryDb').db);
jest.mock('../modules/communications/email.service', () => ({ sendEmail: jest.fn(async () => ({ ok: true })) }));
jest.mock('../modules/analytics/reporting.service', () => ({
  buildScheduledReport: jest.fn(async () => ({
    title: 'Stock Aging',
    columns: ['Lot', 'Qty', 'Value', 'Days held'],
    rows: [['L1', '5 kg', 'Rs 900', '3']],
  })),
  renderReportEmailHtml: (report) => JSON.stringify(report.columns),
}));

const rdb = require('./helpers/rbacMemoryDb');
const emailService = require('../modules/communications/email.service');
const automation = require('../modules/admin/automation.service');
const policy = require('../modules/analytics/reportEmailPolicy');

beforeEach(() => {
  emailService.sendEmail.mockClear();
  rdb.reset({ roles: { 'Finance Manager': ['finance.view'], 'QC Analyst': ['milling.view'] } });
});

describe('reportEmailPolicy', () => {
  it('defaults the allowlist to the domains of active users', async () => {
    expect(await policy.allowedDomains(rdb.db)).toEqual(['agri.test']);
  });

  it('a configured setting replaces the default', async () => {
    rdb.state.tables.system_settings = [{ id: 1, key: policy.SETTING_KEY, value: ' Agri.test, @mill.example ' }];
    expect(await policy.allowedDomains(rdb.db)).toEqual(['agri.test', 'mill.example']);
  });

  it('partitions recipients', () => {
    expect(policy.partitionRecipients(['a@agri.test', 'b@gmail.com', 'nonsense', 'c@AGRI.TEST'], ['agri.test'])).toEqual({
      allowed: ['a@agri.test', 'c@AGRI.TEST'], external: ['b@gmail.com'], invalid: ['nonsense'],
    });
  });

  it('a subdomain or look-alike is not the company domain', () => {
    const p = policy.partitionRecipients(['x@agri.test.evil.com', 'y@evilagri.test'], ['agri.test']);
    expect(p.allowed).toEqual([]);
  });

  it('drops cost columns for a cost-blind recipient', () => {
    const r = policy.redactReportColumns({ columns: ['Lot', 'Value', 'Cost'], rows: [['L', 1, 2]], footer: ['T', 1, 2] }, { cost: false, profit: false });
    expect(r).toEqual({ columns: ['Lot'], rows: [['L']], footer: ['T'] });
  });
});

describe('runReportEmail (cron + run-now path)', () => {
  const task = (recipients) => ({ id: 9, config: JSON.stringify({ reportType: 'stock_aging', recipients }) });

  it('never mails an outside address, even on a schedule created before the rule', async () => {
    const out = await automation.runReportEmail(task(['finance.manager@agri.test', 'leak@gmail.com']));
    expect(emailService.sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['finance.manager@agri.test']);
    expect(out.details.skipped).toBe(1);
  });

  it('redacts per recipient: a finance user sees Value, a cost-blind user and a non-user do not', async () => {
    await automation.runReportEmail(task(['finance.manager@agri.test', 'qc.analyst@agri.test', 'nobody@agri.test']));
    const bodies = Object.fromEntries(emailService.sendEmail.mock.calls.map((c) => [c[0].to, JSON.parse(c[0].body)]));
    expect(bodies['finance.manager@agri.test']).toContain('Value');
    expect(bodies['qc.analyst@agri.test']).not.toContain('Value');
    expect(bodies['nobody@agri.test']).not.toContain('Value');
  });
});
