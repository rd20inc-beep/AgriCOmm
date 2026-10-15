/**
 * P2-02 data scripts: the tie-out finds a document that committed without its
 * journal; the correction is a dry run unless asked, and when asked posts the
 * missing journal once (re-running finds nothing left to post).
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('GL document tie-out scripts (DB-gated)', () => {
  let db; let tieOut; let correct; let expense;
  // Only this suite's row: other suites' fixtures share the database.
  const mine = (kind, id) => kind === 'expense' && id === expense.id;
  const tag = `ZZTO${`${Date.now()}`.slice(-6)}`;

  beforeAll(async () => {
    db = require('../config/database');
    ({ tieOut } = require('../../scripts/glDocumentTieOut'));
    ({ correct } = require('../../scripts/postMissingDocumentJournals'));
    // A pre-P2-02 expense: the row committed, its journal never did.
    [expense] = await db('business_expenses').insert({
      expense_no: `${tag}-EXP`, expense_type: 'general', category: 'rent', amount: 500, currency: 'PKR',
      fx_rate: 1, amount_pkr: 500, expense_date: new Date().toISOString().slice(0, 10), payment_status: 'Pending',
    }).returning('*');
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('the tie-out lists the expense with no journal', async () => {
    const [exp] = await tieOut(db);
    expect(exp.ids).toContain(expense.id);
  });

  test('dry run writes nothing', async () => {
    const r = await correct(db, { write: false });  // the full plan, nothing written
    expect(r.plan).toEqual(expect.arrayContaining([{ kind: 'expense', id: expense.id }]));
    expect(await db('journal_entries').where({ ref_no: expense.expense_no })).toHaveLength(0);
  });

  test('write posts the missing accrual once; a second run has nothing for it', async () => {
    await correct(db, { write: true, only: mine });
    const js = await db('journal_entries').where({ ref_no: expense.expense_no, status: 'Posted' });
    expect(js).toHaveLength(1);
    const [exp] = await tieOut(db);
    expect(exp.ids).not.toContain(expense.id);
    const again = await correct(db, { write: true, only: mine });
    expect(again.planned).toBe(0);
    expect(await db('journal_entries').where({ ref_no: expense.expense_no })).toHaveLength(1);
  });
});
