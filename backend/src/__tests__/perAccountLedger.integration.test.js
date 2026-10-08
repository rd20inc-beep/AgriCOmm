/**
 * Per-account ledger (G-8): every cash / bank account posts to its own GL
 * account under 1000 Cash & Bank. Exercises the writers the payment-engine and
 * contra suites do not: the local-sale receipt journal, a suspense entry, a
 * Head Office ⇄ Mill transfer (both halves), the legacy-journal remap on a
 * signed-delta reversal, the 1000 fallback for an unmapped account, and the
 * trial-balance roll-up / cash-flow group.
 *
 * DB-gated: skipped unless DB_HOST is set (fully migrated throwaway Postgres —
 * see contraTransfer.integration.test.js for the recipe).
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('per-account ledger (DB-gated)', () => {
  let db; let accounting; let gl;
  const run = `${Date.now()}`.slice(-7);
  const TODAY = new Date().toISOString().slice(0, 10);
  const acc = {};
  const code = {};

  const linesFor = async (refNo) => (await db('journal_entries as je')
    .join('journal_lines as jl', 'jl.journal_id', 'je.id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_no': refNo, 'je.status': 'Posted' })
    .orderBy(['je.id', 'jl.id'])
    .select('c.code', 'jl.debit', 'jl.credit'))
    .map((l) => [l.code, Number(l.debit), Number(l.credit)]);
  const netBy = (lines) => lines.reduce((m, [c, dr, cr]) => ({ ...m, [c]: Math.round(((m[c] || 0) + dr - cr) * 100) / 100 }), {});

  beforeAll(async () => {
    db = require('../config/database');
    accounting = require('../modules/accounting/accounting.service');
    gl = require('../shared/accountGl');
    const mk = async (key, row, mapped = true) => {
      const [a] = await db('bank_accounts').insert({ name: `ZZ GL ${key} ${run}`, is_active: true, ...row }).returning('*');
      if (mapped) {
        const g = await gl.ensureAccountGl(db, a);
        acc[key] = { ...a, gl_account_id: g.id };
        code[key] = g.code;
      } else acc[key] = a;
    };
    await mk('hoBank', { type: 'bank', entity: 'general', currency: 'PKR', current_balance: 500000 });
    await mk('millCash', { type: 'cash', entity: 'mill', currency: 'PKR', current_balance: 100000 });
    await mk('loose', { type: 'bank', entity: 'general', currency: 'PKR', current_balance: 0 }, false);
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('ensureAccountGl: an Asset under 1000, idempotent, codes never collide', async () => {
    const parent = await db('chart_of_accounts').where({ code: '1000' }).first();
    const row = await db('chart_of_accounts').where({ code: code.hoBank }).first();
    expect(row).toMatchObject({ type: 'Asset', parent_id: parent.id, currency: 'PKR', entity: 'general', normal_balance: 'debit' });
    const again = await gl.ensureAccountGl(db, await db('bank_accounts').where({ id: acc.hoBank.id }).first());
    expect(again.id).toBe(row.id);
    expect(code.hoBank).not.toBe(code.millCash);
    expect(gl.nextFreeCode(['1011', '1012', '1020'])).toBe('1013');
    expect(gl.nextFreeCode(['1011', '1012', '1013', '1014', '1015', '1016', '1017', '1018', '1019', '1020'])).toBe('1021');
  });

  test('an unmapped account falls back to 1000 (and the writer still posts)', async () => {
    const g = await gl.glAccountFor(db, acc.loose.id);
    expect(g.code).toBe('1000');
    expect((await gl.glAccountFor(db, null)).code).toBe('1000');
  });

  test('local-sale receipt journal debits the receiving account GL', async () => {
    const { postLocalReceiptJournal } = require('../modules/localSales/receiptJournal');
    const no = `ZZ-PL-${run}`;
    await db.transaction((trx) => postLocalReceiptJournal(trx, {
      paymentNo: no, amount: 1500, sale: { sale_no: 'LS-ZZ' }, date: TODAY, userId: null, bankAccountId: acc.millCash.id,
    }));
    expect(await linesFor(no)).toEqual([[code.millCash, 1500, 0], ['1120', 0, 1500]]);
  });

  test('suspense receipt: Dr account GL / Cr 1290', async () => {
    const suspense = require('../modules/finance/suspense.service');
    const e = await suspense.create({ direction: 'receipt', amount: 777, bank_account_id: acc.hoBank.id, date: TODAY, reason: 'zz' }, null);
    expect(await linesFor(e.entry_no)).toEqual([[code.hoBank, 777, 0], ['1290', 0, 777]]);
  });

  test('Head Office → Mill: sender credits its account GL, receiver debits its own on accept', async () => {
    const ft = require('../modules/finance/fundTransfers.service');
    const t = await ft.create({ direction: 'ho_to_mill', from_account_id: acc.hoBank.id, to_account_id: acc.millCash.id, amount: 20000, transfer_date: TODAY }, null);
    await ft.accept(t.id, null);
    expect(await linesFor(t.transfer_no)).toEqual([
      ['1130', 20000, 0], [code.hoBank, 0, 20000],
      [code.millCash, 20000, 0], ['1130', 0, 20000],
    ]);
    await ft.reverse(t.id, null, { reason: 'zz' });
    const net = netBy(await linesFor(t.transfer_no));
    expect(net).toEqual({ 1130: 0, [code.hoBank]: 0, [code.millCash]: 0 });
  });

  test('a pre-G-8 journal on 1000 is reversed off the account GL (the reclass moved it there)', async () => {
    const { postDeltaOf } = require('../modules/finance/paymentSettlement');
    const [cash, sup] = await Promise.all([
      db('chart_of_accounts').where({ code: '1000' }).first(),
      db('chart_of_accounts').where({ code: '2010' }).first(),
    ]);
    const no = `ZZ-OLD-${run}`;
    await db.transaction(async (trx) => {
      const j = await accounting.createJournal(trx, {
        date: TODAY, entity: 'mill', refType: 'Payment', refNo: no, description: 'legacy', currency: 'PKR', fxRate: 1, isAuto: true,
        lines: [
          { account_id: sup.id, account: sup.name, debit: 900, credit: 0 },
          { account_id: cash.id, account: cash.name, debit: 0, credit: 900 },
        ],
      });
      await accounting.postJournal(trx, j.id);
      await postDeltaOf(trx, { refNo: no, refTypes: ['Payment'], refType: 'Payment Reversal', description: 'rev', cashAccountId: acc.hoBank.id });
    });
    const lines = await linesFor(no);
    expect(lines).toEqual([['2010', 900, 0], ['1000', 0, 900], ['2010', 0, 900], [code.hoBank, 900, 0]]);
  });

  test('trial balance carries the 1000 group; cash flow counts the per-account GL', async () => {
    const tb = await accounting.getTrialBalance({});
    const row = tb.accounts.find((a) => a.code === code.hoBank);
    expect(row).toMatchObject({ parent_code: '1000', parent_name: 'Cash & Bank' });
    expect(tb.is_balanced).toBe(true);
    const cf = await accounting.getCashFlow({ periodStart: TODAY, periodEnd: TODAY });
    expect(cf.operating.items.some((i) => i.account_code === code.hoBank)).toBe(true);
  });
});
