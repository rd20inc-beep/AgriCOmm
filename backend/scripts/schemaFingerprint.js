/**
 * Emit a deterministic "fingerprint" of the connected database's structural
 * schema — every column and every constraint, one per line, sorted. This is the
 * canonical shape a database is expected to have; a DB built purely from
 * migrations produces the committed baseline (backend/schema.baseline.txt), and
 * any environment that diverges (e.g. a column ALTERed onto prod by hand) shows
 * up as a diff.
 *
 * Lines are of two kinds, both stable across dumps:
 *   COL <table>.<column>:<type>:<NOT NULL|NULL>
 *   CON <table>.<constraint_name>(<contype>)
 *
 * Nullability is part of the COL line so the drift guard catches a column that
 * gains or loses NOT NULL out-of-band — not just added/removed columns.
 *
 * knex's own bookkeeping tables (knex_migrations*) are excluded — they're
 * environment state, not schema. Run via `npm run schema:fingerprint`.
 */

const db = require('../src/config/database');

async function fingerprint() {
  const cols = await db.raw(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name NOT LIKE 'knex_migrations%'
    ORDER BY table_name, column_name
  `);

  const cons = await db.raw(`
    SELECT c.relname AS table_name, con.conname, con.contype
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname NOT LIKE 'knex_migrations%'
    ORDER BY c.relname, con.conname
  `);

  const lines = [
    ...cols.rows.map((r) => `COL ${r.table_name}.${r.column_name}:${r.data_type}:${r.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`),
    ...cons.rows.map((r) => `CON ${r.table_name}.${r.conname}(${r.contype})`),
  ];
  // Sort the whole set so COL/CON ordering is irrelevant and the output is
  // byte-stable regardless of catalog row order.
  lines.sort();
  return lines;
}

module.exports = { fingerprint };

if (require.main === module) {
  fingerprint()
    .then((lines) => {
      process.stdout.write(lines.join('\n') + '\n');
      return db.destroy();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      db.destroy().finally(() => process.exit(1));
    });
}
