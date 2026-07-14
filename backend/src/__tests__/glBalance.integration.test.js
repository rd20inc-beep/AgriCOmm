/**
 * Stage 0 — behaviour lock (DB-gated). Characterizes the GL double-entry guard in
 * `accountingService.createJournal`: an unbalanced journal is rejected, and a
 * journal referencing a non-existent account is rejected. These are the core
 * financial invariants the offline migration must never weaken (Dr = Cr; no
 * postings to phantom accounts).
 *
 * Runs only when DB_HOST is set (skipped in DB-less CI). Needs a migrated DB
 * (chart_of_accounts is seeded by the accounting-engine migrations). See
 * docNumber.integration.test.js header for the local Postgres recipe + migrate.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

d('GL double-entry guard (DB-gated)', () => {
  let db, accounting, acctA, acctB;
  beforeAll(async () => {
    db = require('../config/database');
    accounting = require('../modules/accounting/accounting.service');
    const accts = await db('chart_of_accounts').orderBy('id').limit(2).select('id');
    acctA = accts[0] && accts[0].id;
    acctB = accts[1] && accts[1].id;
  });
  afterAll(async () => { await db.destroy(); });

  test('two real accounts exist to post against', () => {
    expect(acctA).toBeTruthy();
    expect(acctB).toBeTruthy();
  });

  test('unbalanced journal (Dr ≠ Cr) is rejected', async () => {
    await expect(
      db.transaction((trx) => accounting.createJournal(trx, {
        date: '2026-07-14', description: 'Stage0 unbalanced',
        lines: [
          { account_id: acctA, debit: 100, credit: 0 },
          { account_id: acctB, debit: 0, credit: 90 },   // 10 short
        ],
        userId: 1,
      }))
    ).rejects.toThrow(/unbalanced/i);
  });

  test('journal referencing a non-existent account is rejected', async () => {
    await expect(
      db.transaction((trx) => accounting.createJournal(trx, {
        date: '2026-07-14', description: 'Stage0 phantom account',
        lines: [
          { account_id: acctA, debit: 100, credit: 0 },
          { account_id: 999999999, debit: 0, credit: 100 },
        ],
        userId: 1,
      }))
    ).rejects.toThrow(/does not exist/i);
  });
});
