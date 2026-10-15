/**
 * P3-08 data correction: scripts/detectTransportParty.js finds what the old
 * costs drawer left behind (a wiped hauler, a transporter payable still live
 * after the payer was switched) and scripts/correctTransportParty.js fixes it
 * — dry run by default (writes nothing), signed deltas when applied, paid
 * payables never touched, AP subledger = 2010 afterwards.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('transport party detect / correct scripts (DB-gated)', () => {
  let db; let detect; let correct;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};
  const quiet = () => {};

  const accrue = async (batch, haulerId, amount) => {
    const accountingService = require('../modules/accounting/accounting.service');
    const [raw, ap] = await Promise.all([
      db('chart_of_accounts').where({ code: '1210' }).first(), db('chart_of_accounts').where({ code: '2010' }).first(),
    ]);
    await db.transaction(async (trx) => {
      const j = await accountingService.createJournal(trx, {
        date: new Date().toISOString().slice(0, 10), entity: 'mill', refType: 'Batch Transport', refNo: batch.batch_no,
        description: 'ZZ old accrual', currency: 'PKR', fxRate: 1, isAuto: true, userId: ids.user,
        partyType: 'hauler', partyId: haulerId,
        lines: [
          { account_id: raw.id, account: raw.name, debit: amount, credit: 0 },
          { account_id: ap.id, account: ap.name, debit: 0, credit: amount },
        ],
      });
      await accountingService.postJournal(trx, j.id);
    });
  };
  // A batch as the OLD code left it: payer switched to supplier and hauler
  // wiped on the record, but the payable + accrual still live.
  const oldStyleBatch = async (tag, { paid = 0 } = {}) => {
    const [b] = await db('milling_batches').insert({
      batch_no: `TP${run}-${tag}`, supplier_id: ids.sup, product_id: ids.product, mill_id: ids.mill,
      raw_qty_kg: 0, status: 'In Progress', created_by: ids.user,
    }).returning('*');
    await db('milling_costs').insert({ batch_id: b.id, category: 'transport', amount: 7000 });
    const [p] = await db('payables').insert({
      pay_no: `ZTP${run}-${tag}`, entity: 'mill', payable_type: 'vendor', category: 'Transport', hauler_id: ids.hauler,
      linked_ref: b.batch_no, source_table: 'batch_transport', source_id: b.id,
      original_amount: 7000, paid_amount: paid, outstanding: 7000 - paid, status: paid ? 'Partial' : 'Pending', currency: 'PKR',
    }).returning('*');
    await accrue(b, ids.hauler, 7000);
    const [tc] = await db('transport_costs').insert({
      batch_id: b.id, hauler_id: null, amount: 7000, paid_by: 'supplier', status: 'unpaid', transport_type: 'milling',
      entity: 'mill', payable_id: p.id,
    }).returning('*');
    return { b, p, tc };
  };
  const net2010 = async (batchNo) => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': batchNo, 'je.status': 'Posted', 'c.code': '2010', 'je.ref_type': 'Batch Transport' })
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return Math.round(r.n * 100) / 100;
  };

  beforeAll(async () => {
    db = require('../config/database');
    detect = require('../../scripts/detectTransportParty');
    correct = require('../../scripts/correctTransportParty');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    ids.user = (await db('users').insert({
      email: `zz-tp-${run}@test.local`, full_name: `ZZ TP ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*'))[0].id;
    ids.sup = (await db('suppliers').insert({ name: `ZZ TP Supplier ${run}`, type: 'local' }).returning('*'))[0].id;
    ids.product = (await db('products').insert({ name: `ZZ TP Rice ${run}` }).returning('*'))[0].id;
    ids.mill = (await db('mills').insert({ name: `ZZ TP Mill ${run}` }).returning('*'))[0].id;
    ids.hauler = (await db('haulers').insert({ name: `ZZ TP Hauler ${run}` }).returning('*'))[0].id;
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('detect lists them; dry run writes nothing; apply fixes the unpaid one and leaves the paid one', async () => {
    const unpaid = await oldStyleBatch('u');
    const paid = await oldStyleBatch('p', { paid: 2000 });
    const found = await detect.detect(db);
    expect(found.lostHauler).toEqual(expect.arrayContaining([unpaid.tc.id, paid.tc.id]));
    expect(found.stale).toEqual(expect.arrayContaining([
      { batchId: unpaid.b.id, payableId: unpaid.p.id, kind: 'unpaid' },
      { batchId: paid.b.id, payableId: paid.p.id, kind: 'paid' },
    ]));

    const journalsBefore = await db('journal_entries').count('id as n').first();
    await correct.correct(db, { log: quiet });
    expect((await db('journal_entries').count('id as n').first()).n).toBe(journalsBefore.n);
    expect((await db('payables').where({ id: unpaid.p.id }).first()).status).toBe('Pending');

    await correct.correct(db, { write: true, log: quiet });
    // Hauler restored on both records (no money moves).
    expect((await db('transport_costs').where({ id: unpaid.tc.id }).first()).hauler_id).toBe(ids.hauler);
    expect((await db('transport_costs').where({ id: paid.tc.id }).first()).hauler_id).toBe(ids.hauler);
    // Unpaid: payable voided, accrual reversed by a signed delta.
    expect((await db('payables').where({ id: unpaid.p.id }).first()).status).toBe('Reversed');
    expect(await net2010(unpaid.b.batch_no)).toBe(0);
    expect(await db('journal_entries').where({ ref_no: unpaid.b.batch_no, status: 'Reversed' })).toHaveLength(0);
    // Paid: untouched, still reported for Owner review.
    expect((await db('payables').where({ id: paid.p.id }).first()).status).toBe('Partial');
    expect(await net2010(paid.b.batch_no)).toBe(-7000);
    const after = await detect.detect(db);
    expect(after.stale.find((s) => s.batchId === unpaid.b.id)).toBeUndefined();
    expect(after.stale.find((s) => s.batchId === paid.b.id)).toMatchObject({ kind: 'paid' });
  });
});
