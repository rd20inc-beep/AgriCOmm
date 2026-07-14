/**
 * Stage 0 — behaviour lock (DB-gated). Characterizes `nextDocNo` — the MAX(numeric
 * suffix)+1 document-number generator. This is the exact behaviour the offline
 * migration will change (R3: provisional device numbers → server-assigned finals),
 * so locking it now protects that transition.
 *
 * Runs only when a Postgres is available (DB_HOST set). In the DB-less CI job it
 * is skipped. Local run:
 *   docker run -d --name rf-test-pg -e POSTGRES_USER=riceflow -e POSTGRES_PASSWORD=riceflow \
 *     -e POSTGRES_DB=riceflow_erp -p 55432:5432 postgres:16
 *   DB_HOST=localhost DB_PORT=55432 DB_NAME=riceflow_erp DB_USER=riceflow DB_PASSWORD=riceflow \
 *     npx jest docNumber.integration
 */
const { nextDocNo } = require('../utils/docNumber');

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

d('nextDocNo (DB-gated)', () => {
  let db;
  beforeAll(async () => {
    db = require('../config/database');
    await db.schema.dropTableIfExists('tmp_docno_test');
    await db.schema.createTable('tmp_docno_test', (t) => { t.increments('id'); t.string('doc_no'); });
  });
  afterAll(async () => {
    await db.schema.dropTableIfExists('tmp_docno_test');
    await db.destroy();
  });
  const gen = (prefix, pad) => nextDocNo(db, { table: 'tmp_docno_test', column: 'doc_no', prefix, pad });

  test('empty table → prefix + 0001', async () => {
    expect(await gen('LS-')).toBe('LS-0001');
  });

  test('MAX+1, and survives a middle deletion (no reuse)', async () => {
    await db('tmp_docno_test').insert([{ doc_no: 'LS-0001' }, { doc_no: 'LS-0002' }, { doc_no: 'LS-0005' }]);
    expect(await gen('LS-')).toBe('LS-0006');              // MAX(5)+1
    await db('tmp_docno_test').where('doc_no', 'LS-0005').del();
    expect(await gen('LS-')).toBe('LS-0003');              // MAX(2)+1 — gap not reused
  });

  test('prefix-scoped (other prefixes ignored)', async () => {
    await db('tmp_docno_test').insert([{ doc_no: 'PP-0009' }]);
    expect(await gen('LS-')).toBe('LS-0003');              // PP row does not affect LS
    expect(await gen('PP-')).toBe('PP-0010');
  });

  test('date-scoped prefix resets per day', async () => {
    await db('tmp_docno_test').insert([{ doc_no: 'TXN-20260714-0007' }]);
    expect(await gen('TXN-20260714-')).toBe('TXN-20260714-0008');
    expect(await gen('TXN-20260715-')).toBe('TXN-20260715-0001'); // new day starts fresh
  });

  test('pad 0 → no leading zeros', async () => {
    expect(await nextDocNo(db, { table: 'tmp_docno_test', column: 'doc_no', prefix: 'ZZ-', pad: 0 })).toBe('ZZ-1');
  });
});
