/**
 * P1-05 — the AI read-only role from migration 333, exercised against a real
 * Postgres (DB-gated: needs DB_HOST and AI_DB_PASSWORD, and a database migrated
 * with AI_DB_PASSWORD set so the role can log in). These attacks bypass the SQL
 * guard entirely and hit the role directly — the role alone must stop them.
 *
 *   AI_DB_PASSWORD=FAKE-test-secret-1 npx knex migrate:latest
 *   DB_HOST=... DB_NAME=... DB_USER=... DB_PASSWORD=... AI_DB_PASSWORD=FAKE-test-secret-1 \
 *     npx jest aiReadOnlyRole.integration
 */
const hasDb = !!process.env.DB_HOST && !!process.env.AI_DB_PASSWORD;
const d = hasDb ? describe : describe.skip;

d('AI read-only role (DB-gated)', () => {
  let ro;
  let aiDb;
  beforeAll(() => {
    const knex = require('knex');
    const config = require('../config');
    ro = knex({
      client: 'pg',
      connection: { host: config.db.host, port: config.db.port, database: config.db.name, user: config.ai.dbUser, password: config.ai.dbPassword },
      pool: { min: 0, max: 1 },
    });
    aiDb = require('../modules/ai/aiDb');
  });
  afterAll(async () => {
    await ro.destroy();
    await aiDb._reset();
  });

  const denied = async (sql) => {
    await expect(ro.raw(sql)).rejects.toThrow(/permission denied|does not exist|read-only/);
  };

  it('is not a superuser or otherwise privileged', async () => {
    const r = await ro.raw('SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    expect(r.rows[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false });
  });

  it.each([
    'SELECT * FROM public.audit_logs LIMIT 1',
    'SELECT * FROM public.mill_salary_revisions LIMIT 1',
    'SELECT portal_pin_hash FROM public.mill_workers LIMIT 1',
    'SELECT password_hash FROM public.users LIMIT 1',
    'SELECT * FROM public.system_settings LIMIT 1',
    'SELECT * FROM public.idempotency_keys LIMIT 1',
    'SELECT * FROM public.chat_messages LIMIT 1',
    'SELECT account_number FROM public.bank_accounts LIMIT 1',
  ])('cannot read base tables: %s', (sql) => denied(sql));

  it('query_to_xml cannot reach past the grants', async () => {
    await denied("SELECT query_to_xml('select * from public.users', true, true, '')");
  });

  it('cannot write, even to its own views', async () => {
    await denied("INSERT INTO ai_ro.products (name) VALUES ('x')");
  });

  it('views expose no sensitive columns', async () => {
    await expect(ro.raw('SELECT account_number FROM ai_ro.bank_accounts')).rejects.toThrow(/does not exist/);
    await expect(ro.raw('SELECT phone FROM ai_ro.customers')).rejects.toThrow(/does not exist/);
  });

  it('runReadOnly passes the role check, reads a view and caps rows', async () => {
    const out = await aiDb.runReadOnly('SELECT generate_series(1, 50) AS n', { rowCap: 10 });
    expect(out.rows).toHaveLength(10);
    expect(out.truncated).toBe(true);
    const v = await aiDb.runReadOnly('SELECT count(*)::int AS n FROM products');
    expect(v.rows[0].n).toBeGreaterThanOrEqual(0);
  });
});
