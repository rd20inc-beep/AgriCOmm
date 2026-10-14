/**
 * The database connection the NL→SQL assistant runs model-written SQL on
 * (P1-05 / D-28). It is NOT the app's pool: a separate, tiny pool logged in as
 * the read-only role from migration 333 (AI_DB_USER, default agri_ai_query,
 * password AI_DB_PASSWORD), whose only grants are SELECT on the ai_ro views.
 *
 * Every query also runs in a READ ONLY transaction with a statement timeout and
 * search_path=ai_ro, wrapped so at most `rowCap + 1` rows come back.
 *
 * Without AI_DB_PASSWORD — or if the role turns out to be privileged — the
 * feature reports "not configured". It never falls back to the app role.
 */
const knex = require('knex');
const config = require('../../config');

class AiQueryNotConfigured extends Error {
  constructor(message = 'AI querying is not configured on this server.') {
    super(message);
    this.name = 'AiQueryNotConfigured';
  }
}

let pool = null;
let verified = null; // Promise<true> once the role has been checked

function isConfigured() {
  return !!config.ai.dbPassword && config.ai.dbUser !== config.db.user;
}

function getPool() {
  if (!pool) {
    pool = knex({
      client: 'pg',
      connection: {
        host: config.db.host,
        port: config.db.port,
        database: config.db.name,
        user: config.ai.dbUser,
        password: config.ai.dbPassword,
        application_name: 'agri-ai-readonly',
      },
      pool: {
        min: 0,
        max: 2,
        afterCreate: (conn, done) => conn.query('SET search_path TO ai_ro', (err) => done(err, conn)),
      },
      acquireConnectionTimeout: 5000,
    });
  }
  return pool;
}

// The role must be what migration 333 made it: no superuser / createrole /
// createdb / bypassrls, and unable to read ANY relation in public.
async function verifyRole(p) {
  const r = await p.raw(`
    SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
           has_schema_privilege(current_user, 'ai_ro', 'USAGE') AS ai_usage,
           EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
                     AND has_table_privilege(current_user, c.oid, 'SELECT')) AS reads_public
    FROM pg_roles r WHERE r.rolname = current_user`);
  const row = r.rows[0];
  if (!row || row.rolsuper || row.rolcreaterole || row.rolcreatedb || row.rolbypassrls || !row.ai_usage || row.reads_public) {
    throw new AiQueryNotConfigured('AI querying is disabled: its database role is not the restricted read-only role.');
  }
  return true;
}

/**
 * Run an already-validated SELECT. Returns { rows, truncated }.
 * Throws AiQueryNotConfigured, or the raw DB error (callers must not echo it).
 */
async function runReadOnly(sql, { rowCap = 200, timeoutMs = 8000 } = {}) {
  if (!isConfigured()) throw new AiQueryNotConfigured();
  const p = getPool();
  if (!verified) verified = verifyRole(p).catch((e) => { verified = null; throw e; });
  try {
    await verified;
  } catch (e) {
    if (e instanceof AiQueryNotConfigured) throw e;
    // Could not log in / connect as the AI role: treat as not configured.
    console.error('[ai] read-only role check failed:', e.code || e.message);
    throw new AiQueryNotConfigured();
  }
  const cap = Math.max(1, Math.min(1000, parseInt(rowCap, 10) || 200));
  const timeout = Math.max(1000, Math.min(30000, parseInt(timeoutMs, 10) || 8000));
  // knex.raw treats a bare ? as a binding; the jsonb ? operators must survive.
  const body = String(sql).replace(/\?/g, '\\?');
  return p.transaction(async (trx) => {
    await trx.raw('SET TRANSACTION READ ONLY');
    await trx.raw(`SET LOCAL statement_timeout = ${timeout}`);
    await trx.raw('SET LOCAL search_path = ai_ro');
    const r = await trx.raw(`SELECT * FROM (${body}\n) AS ai_q LIMIT ${cap + 1}`);
    const rows = r.rows || [];
    return { rows: rows.slice(0, cap), truncated: rows.length > cap };
  });
}

// For tests.
function _reset() { verified = null; if (pool) { const p = pool; pool = null; return p.destroy(); } return Promise.resolve(); }

module.exports = { runReadOnly, isConfigured, AiQueryNotConfigured, _reset };
