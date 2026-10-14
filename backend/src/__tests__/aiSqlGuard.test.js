/**
 * P1-05 — the structural SQL check in front of the read-only AI role. Every
 * attack here would also be stopped by the role's grants (see
 * aiReadOnlyRole.integration.test.js); this is the second line.
 */
const { checkSql, tokenize, SqlGuardError } = require('../modules/ai/ai.sqlGuard');
const { VIEWS } = require('../../migrations/20261015_333_ai_readonly_views_and_role');

const ALLOWED = Object.keys(VIEWS);
const ok = (sql) => checkSql(sql, ALLOWED);
const blocked = (sql) => expect(() => ok(sql)).toThrow(SqlGuardError);

describe('accepts ordinary business questions', () => {
  it.each([
    'SELECT lot_no, available_qty FROM inventory_lots WHERE status = \'Available\' ORDER BY available_qty DESC LIMIT 20',
    'SELECT s.name, SUM(p.outstanding) AS owed FROM payables p JOIN suppliers s ON s.id = p.supplier_id GROUP BY s.name ORDER BY owed DESC LIMIT 5',
    "SELECT EXTRACT(MONTH FROM sale_date) AS m, SUM(total_amount) FROM local_sales WHERE sale_date >= date_trunc('month', now()) GROUP BY 1",
    'WITH x AS (SELECT variety, AVG(yield_pct) y FROM milling_batches mb JOIN inventory_lots l ON l.batch_ref = mb.batch_no GROUP BY variety) SELECT * FROM x',
    'SELECT c.name, (SELECT COUNT(*) FROM export_orders e WHERE e.customer_id = c.id) AS n FROM customers c',
    'SELECT a.lot_no FROM inventory_lots a, lot_transactions t WHERE t.lot_id = a.id',
    "SELECT substring(lot_no FROM 1 FOR 3), age(now(), created_at) FROM inventory_lots FETCH FIRST 5 ROWS ONLY",
    'SELECT * FROM ai_ro.stock_summary',
    "SELECT 'drop table users; select * from audit_logs' AS harmless_text FROM products",
    'SELECT count(*) FROM inventory_lots;',
    'SELECT x.* FROM (SELECT id FROM products) x LEFT JOIN warehouses w USING (id)',
  ])('%s', (sql) => {
    expect(() => ok(sql)).not.toThrow();
  });

  it('reports the relations read', () => {
    expect(ok('SELECT 1 FROM local_sales l JOIN customers c ON c.id = l.customer_id').relations).toEqual(['local_sales', 'customers']);
  });
});

describe('rejects', () => {
  it.each([
    ['audit logs', 'SELECT * FROM audit_logs'],
    ['salary revisions', 'SELECT * FROM mill_salary_revisions'],
    ['portal PIN hashes', 'SELECT portal_pin_hash FROM mill_workers'],
    ['users', 'SELECT email, password_hash FROM users'],
    ['public-qualified table', 'SELECT * FROM public.inventory_lots'],
    ['system settings', 'SELECT * FROM system_settings'],
    ['comma-joined hidden table', 'SELECT 1 FROM inventory_lots, users'],
    ['hidden table in a subquery', 'SELECT (SELECT max(id) FROM chat_messages) FROM products'],
    ['query_to_xml dynamic SQL', "SELECT query_to_xml('select * from users', true, true, '')"],
    ['table_to_xml', "SELECT table_to_xml('users', true, true, '')"],
    ['ts_stat dynamic SQL', "SELECT * FROM ts_stat('select 1')"],
    ['pg_read_file', "SELECT pg_read_file('/etc/passwd')"],
    ['pg_sleep', 'SELECT pg_sleep(100)'],
    ['dblink', "SELECT * FROM dblink('host=x', 'select 1') AS t(a int)"],
    ['lo_import', "SELECT lo_import('/etc/passwd')"],
    ['set_config', "SELECT set_config('role', 'postgres', false)"],
    ['current_setting', "SELECT current_setting('data_directory')"],
    ['catalog table', 'SELECT * FROM pg_class'],
    ['catalog via quoted name', 'SELECT * FROM "pg_authid"'],
    ['information_schema', 'SELECT * FROM information_schema.tables'],
    ['regclass cast', "SELECT 'users'::regclass"],
    ['chained statements', 'SELECT 1 FROM products; DROP TABLE products'],
    ['write', 'UPDATE products SET name = 1'],
    ['CTE with a write', 'WITH x AS (DELETE FROM products RETURNING *) SELECT * FROM x'],
    ['SELECT INTO', 'SELECT * INTO newtab FROM products'],
    ['row locks', 'SELECT * FROM products FOR UPDATE'],
    ['TABLE syntax', 'WITH x AS (TABLE users) SELECT * FROM x'],
    ['positional params', 'SELECT * FROM products WHERE id = $1'],
    ['comment-hidden write', 'SELECT 1 FROM products /* x */ ; /* y */ DELETE FROM products'],
    ['unterminated string', "SELECT 'abc FROM products"],
    ['not a select', 'EXPLAIN SELECT 1'],
  ])('%s', (_, sql) => blocked(sql));

  it('a table outside the caller\'s allowed set', () => {
    expect(() => checkSql('SELECT * FROM journal_lines', ['inventory_lots'])).toThrow(/journal_lines/);
  });
});

describe('tokenizer', () => {
  it('keeps keywords inside strings, dollar quotes and comments out of the token stream', () => {
    const t = tokenize("SELECT 'a;b' , $$x;y$$ -- drop\n/* nested /* delete */ */ FROM products").filter((x) => x.type === 'ident').map((x) => x.value);
    expect(t).toEqual(['select', 'from', 'products']);
  });
});
