/**
 * P1-05 — migration 333 must not fail a deploy when the app's DB user lacks
 * CREATEROLE: it creates the ai_ro views, logs how to finish, and returns.
 * Executes the migration against a recording fake knex.
 */
const mig = require('../../migrations/20261015_333_ai_readonly_views_and_role');

function fakeKnex({ privileged, existingRoles = [] }) {
  const sql = [];
  const knex = {
    raw: async (text, bindings) => {
      sql.push(text);
      if (/rolsuper OR rolcreaterole/.test(text)) return { rows: [{ ok: privileged }] };
      if (/FROM pg_roles WHERE rolname = \?/.test(text)) return { rows: existingRoles.includes(bindings[0]) ? [{ 1: 1 }] : [] };
      return { rows: [] };
    },
  };
  return { knex, sql };
}
const quietLog = { warn: jest.fn() };

afterEach(() => { delete process.env.AI_DB_PASSWORD; quietLog.warn.mockClear(); });

it('without CREATEROLE: creates the views, creates no role, warns, does not throw', async () => {
  const { knex, sql } = fakeKnex({ privileged: false });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(mig.up(knex)).resolves.toBeUndefined();
  expect(sql.filter((s) => /CREATE OR REPLACE VIEW ai_ro\./.test(s))).toHaveLength(Object.keys(mig.VIEWS).length);
  expect(sql.some((s) => /CREATE ROLE/.test(s))).toBe(false);
  expect(warn.mock.calls.join(' ')).toMatch(/CREATEROLE/);
  warn.mockRestore();
});

it('no view selects a sensitive column or table', () => {
  const all = Object.values(mig.VIEWS).join('\n');
  expect(all).not.toMatch(/account_number|iban|swift|portal_pin|password|phone|email|address|bank_account\b|driver_/i);
  expect(all).not.toMatch(/FROM public\.(users|audit_logs|system_settings|mill_workers|mill_payroll|chat_|email_logs|idempotency)/);
});

it('with CREATEROLE and no password: roles created NOLOGIN, login never enabled', async () => {
  const { knex, sql } = fakeKnex({ privileged: true });
  const r = await mig.ensureAiRoles(knex, { log: quietLog });
  expect(r).toEqual({ configured: false, reason: 'no_password' });
  expect(sql.filter((s) => /CREATE ROLE/.test(s)).every((s) => /NOLOGIN/.test(s))).toBe(true);
  expect(sql.some((s) => /\bLOGIN PASSWORD/.test(s))).toBe(false);
  expect(sql).toContain("ALTER ROLE agri_ai_query SET default_transaction_read_only = on");
});

it('with a password: enables login; an unsafe password is refused', async () => {
  process.env.AI_DB_PASSWORD = 'FAKE-test-secret-1';
  let f = fakeKnex({ privileged: true, existingRoles: ['agri_ai_readonly', 'agri_ai_query'] });
  expect(await mig.ensureAiRoles(f.knex, { log: quietLog })).toEqual({ configured: true });
  expect(f.sql.some((s) => /ALTER ROLE agri_ai_query LOGIN PASSWORD/.test(s))).toBe(true);

  process.env.AI_DB_PASSWORD = "short'; DROP ROLE x; --";
  f = fakeKnex({ privileged: true, existingRoles: ['agri_ai_readonly', 'agri_ai_query'] });
  expect(await mig.ensureAiRoles(f.knex, { log: quietLog })).toEqual({ configured: false, reason: 'bad_password' });
  expect(f.sql.some((s) => /PASSWORD/.test(s))).toBe(false);
});
