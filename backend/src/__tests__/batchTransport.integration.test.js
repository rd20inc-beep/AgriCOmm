/**
 * P3-08 / MIL-12 — a milling batch's transport line and its transporter
 * (owner decision D-25b (a): transporters are `haulers`), against a real,
 * migrated Postgres:
 *
 *   - re-saving the costs with no hauler / payer KEEPS the ones on record;
 *   - a lower freight, a switch of payer, or another hauler voids / moves the
 *     transporter payable and posts the accrual change as a signed delta —
 *     at every step AP subledger (live transporter bills) = 2010 for the
 *     batch, and no journal is ever marked Reversed;
 *   - a payment already made is never orphaned (409);
 *   - after yield a payer switch moves the freight 2010 → 2110 without
 *     touching finished stock; the trial balance stays balanced;
 *   - two active transporters cannot share a name or a phone number.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('batch transport payable (DB-gated)', () => {
  let db; let millCtl; let haulerCtl;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};
  let seq = 0;

  const mockRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  const call = async (fn, req) => { const res = mockRes(); await fn(req, res); return res; };
  const asAdmin = (extra) => ({ user: { id: ids.user, role_id: ids.adminRole }, query: {}, ...extra });
  const cost = (batchId, body) => call(millCtl.addCost, asAdmin({ params: { id: String(batchId) }, body: { category: 'transport', ...body } }));
  const net = async (refNo, code, refType) => {
    let q = db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'c.code': code });
    if (refType) q = q.where('je.ref_type', refType);
    return Math.round((await q.select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first()).n * 100) / 100;
  };
  const netFor = async (refNo, haulerId) => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'c.code': '2010', 'je.party_type': 'hauler', 'je.party_id': haulerId })
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return Math.round(r.n * 100) / 100;
  };
  const trialBalance = async () => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .where('je.status', 'Posted').select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return Math.round(r.n * 100) / 100;
  };
  // AP subledger for the batch's transport = live transporter bills' outstanding.
  const apLive = async (batchId) => {
    const r = await db('payables').where({ source_table: 'batch_transport', source_id: batchId })
      .whereNot('status', 'Reversed').sum('outstanding as s').first();
    return Math.round((Number(r.s) || 0) * 100) / 100;
  };
  const expectApMatchesGl = async (b) => {
    expect(await apLive(b.id) + (await net(b.batch_no, '2010', 'Batch Transport'))).toBe(0);
  };
  const makeBatch = async () => {
    seq += 1;
    const [b] = await db('milling_batches').insert({
      batch_no: `T${run}-${seq}`, supplier_id: ids.sup, product_id: ids.product, mill_id: ids.mill,
      raw_qty_kg: 0, status: 'In Progress', created_by: ids.user,
    }).returning('*');
    return b;
  };

  beforeAll(async () => {
    db = require('../config/database');
    millCtl = require('../modules/milling/milling.controller');
    haulerCtl = require('../modules/haulers/haulers.controller');
    const role = async (name) => (await db('roles').where({ name }).first()).id;
    ids.adminRole = await role('Super Admin');
    ids.user = (await db('users').insert({
      email: `zz-bt-${run}@test.local`, full_name: `ZZ BT ${run}`, password_hash: 'x', role_id: ids.adminRole, is_active: true, status: 'active',
    }).returning('*'))[0].id;
    ids.sup = (await db('suppliers').insert({ name: `ZZ BT Supplier ${run}`, type: 'local' }).returning('*'))[0].id;
    ids.product = (await db('products').insert({ name: `ZZ BT Rice ${run}` }).returning('*'))[0].id;
    ids.mill = (await db('mills').insert({ name: `ZZ BT Mill ${run}` }).returning('*'))[0].id;
    ids.haulerA = (await db('haulers').insert({ name: `ZZ BT Hauler A ${run}` }).returning('*'))[0].id;
    ids.haulerB = (await db('haulers').insert({ name: `ZZ BT Hauler B ${run}` }).returning('*'))[0].id;
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('pre-yield: re-save keeps the hauler; switch hauler / payer / amount voids or moves the payable by signed deltas', async () => {
    const tb0 = await trialBalance();
    const b = await makeBatch();
    expect((await cost(b.id, { amount: 10000, hauler_id: ids.haulerA, transport_paid_by: 'company' })).statusCode).toBe(200);
    let pay = await db('payables').where({ source_table: 'batch_transport', source_id: b.id }).first();
    expect(pay).toMatchObject({ hauler_id: ids.haulerA, status: 'Pending' });
    expect(await netFor(b.batch_no, ids.haulerA)).toBe(-10000);
    await expectApMatchesGl(b);

    // The drawer re-sends every line: no hauler / an empty one keeps the one on record.
    expect((await cost(b.id, { amount: 10000 })).statusCode).toBe(200);
    expect((await cost(b.id, { amount: 10000, hauler_id: null, transport_paid_by: '' })).statusCode).toBe(200);
    const tc = await db('transport_costs').where({ batch_id: b.id }).first();
    expect(tc).toMatchObject({ hauler_id: ids.haulerA, paid_by: 'company', status: 'unpaid' });
    expect(await db('journal_entries').where({ ref_no: b.batch_no, ref_type: 'Batch Transport' })).toHaveLength(1);

    // Another hauler: A comes back to 0, B carries it, same payable row.
    expect((await cost(b.id, { amount: 10000, hauler_id: ids.haulerB })).statusCode).toBe(200);
    expect(await netFor(b.batch_no, ids.haulerA)).toBe(0);
    expect(await netFor(b.batch_no, ids.haulerB)).toBe(-10000);
    pay = await db('payables').where({ id: pay.id }).first();
    expect(pay).toMatchObject({ hauler_id: ids.haulerB, status: 'Pending' });
    await expectApMatchesGl(b);

    // The supplier pays it now: the payable is voided, the accrual reversed.
    expect((await cost(b.id, { amount: 10000, transport_paid_by: 'supplier' })).statusCode).toBe(200);
    pay = await db('payables').where({ id: pay.id }).first();
    expect(pay.status).toBe('Reversed');
    expect(Number(pay.original_amount)).toBe(10000); // the figure is kept
    expect(await net(b.batch_no, '2010', 'Batch Transport')).toBe(0);
    expect((await db('transport_costs').where({ batch_id: b.id }).first())).toMatchObject({ paid_by: 'supplier', status: 'approved', hauler_id: ids.haulerB });
    await expectApMatchesGl(b);

    // Back to the company (hauler kept), then down to 0.
    expect((await cost(b.id, { amount: 8000, transport_paid_by: 'company' })).statusCode).toBe(200);
    expect((await db('payables').where({ id: pay.id }).first())).toMatchObject({ status: 'Pending' });
    expect(await netFor(b.batch_no, ids.haulerB)).toBe(-8000);
    await expectApMatchesGl(b);
    expect((await cost(b.id, { amount: 0 })).statusCode).toBe(200);
    expect((await db('payables').where({ id: pay.id }).first()).status).toBe('Reversed');
    expect((await db('transport_costs').where({ batch_id: b.id }).first()).status).toBe('cancelled');
    expect(await net(b.batch_no, '2010', 'Batch Transport')).toBe(0);
    expect(await net(b.batch_no, '1210', 'Batch Transport')).toBe(0);
    await expectApMatchesGl(b);

    expect(await db('journal_entries').where({ ref_no: b.batch_no, status: 'Reversed' })).toHaveLength(0);
    expect(await trialBalance()).toBe(tb0);
  });

  test('a payment already made is never orphaned', async () => {
    const b = await makeBatch();
    await cost(b.id, { amount: 10000, hauler_id: ids.haulerA, transport_paid_by: 'company' });
    const pay = await db('payables').where({ source_table: 'batch_transport', source_id: b.id }).first();
    await db('payables').where({ id: pay.id }).update({ paid_amount: 4000, outstanding: 6000, status: 'Partial' });

    expect((await cost(b.id, { amount: 10000, hauler_id: ids.haulerB })).statusCode).toBe(409);
    expect((await cost(b.id, { amount: 3000 })).statusCode).toBe(409);
    expect((await cost(b.id, { amount: 10000, transport_paid_by: 'supplier' })).statusCode).toBe(409);
    const r = await cost(b.id, { amount: 5000 });
    expect(r.statusCode).toBe(200);
    const p2 = await db('payables').where({ id: pay.id }).first();
    expect(p2).toMatchObject({ status: 'Partial', hauler_id: ids.haulerA });
    expect(Number(p2.outstanding)).toBe(1000);
    expect(await netFor(b.batch_no, ids.haulerA)).toBe(-5000);
  });

  test('post-yield payer switch moves the freight 2010 → 2110; finished stock untouched; TB balanced', async () => {
    const tb0 = await trialBalance();
    const b = await makeBatch();
    await cost(b.id, { amount: 10000, hauler_id: ids.haulerA, transport_paid_by: 'company' });
    // Stand in for the yield: the completion journal moved the staged freight
    // 1210 → 1220 under 'Milling Batch' (what postMillingCompletion posts).
    const accountingService = require('../modules/accounting/accounting.service');
    const [fin, raw] = await Promise.all([
      db('chart_of_accounts').where({ code: '1220' }).first(), db('chart_of_accounts').where({ code: '1210' }).first(),
    ]);
    await db.transaction(async (trx) => {
      const j = await accountingService.createJournal(trx, {
        date: new Date().toISOString().slice(0, 10), entity: 'mill', refType: 'Milling Batch', refNo: b.batch_no,
        description: 'ZZ completion', currency: 'PKR', fxRate: 1, isAuto: true, userId: ids.user,
        lines: [
          { account_id: fin.id, account: fin.name, debit: 10000, credit: 0 },
          { account_id: raw.id, account: raw.name, debit: 0, credit: 10000 },
        ],
      });
      await accountingService.postJournal(trx, j.id);
    });
    const fin0 = await net(b.batch_no, '1220');

    expect((await cost(b.id, { amount: 10000, transport_paid_by: 'supplier' })).statusCode).toBe(200);
    expect(await net(b.batch_no, '1220')).toBe(fin0);
    expect(await net(b.batch_no, '2010')).toBe(0);
    expect(await net(b.batch_no, '1210')).toBe(0);
    expect(await net(b.batch_no, '2110')).toBe(-10000);
    await expectApMatchesGl(b);

    // Lower it post-yield: finished stock comes down by the change.
    expect((await cost(b.id, { amount: 6000 })).statusCode).toBe(200);
    expect(await net(b.batch_no, '1220')).toBe(fin0 - 4000);
    expect(await net(b.batch_no, '2110')).toBe(-6000);
    expect(await trialBalance()).toBe(tb0);
  });

  test('two active transporters cannot share a name or a phone number', async () => {
    const mk = (body) => call(haulerCtl.create, { user: { id: ids.user }, body });
    const a = await mk({ name: `ZZ Dup Hauler ${run}`, phone: `0300-55${run}` });
    expect(a.statusCode).toBe(200);
    const sameName = await mk({ name: `  zz dup hauler ${run} ` });
    expect(sameName.statusCode).toBe(409);
    const samePhone = await mk({ name: `ZZ Other ${run}`, phone: `030055${run}` });
    expect(samePhone.statusCode).toBe(409);
    // The database refuses it too, even past the app check.
    await expect(db('haulers').insert({ name: `ZZ DUP HAULER ${run}` })).rejects.toThrow(/uq_haulers_active_name/);
    // A deactivated duplicate does not block, and re-activating it onto the name is refused.
    const [old] = await db('haulers').insert({ name: `ZZ Dup Hauler ${run}`, is_active: false }).returning('*');
    const re = await call(haulerCtl.update, { user: { id: ids.user }, params: { id: String(old.id) }, body: { is_active: true } });
    expect(re.statusCode).toBe(409);
  });
});
