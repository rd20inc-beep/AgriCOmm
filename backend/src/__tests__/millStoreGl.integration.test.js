/**
 * Mill-store stock adjustments move 1250 Bags & Packaging (A4). "Direct stock
 * set" and an approved adjustment used to change the quantity with no
 * journal, so bags typed into the store never reached 1250 and the packing
 * runs that drew them drove it negative (prod: −60,044.86).
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('mill-store adjustments post to 1250 (DB-gated)', () => {
  let db; let repo; let item; let userId;
  const tag = `ZZMS${`${Date.now()}`.slice(-6)}`;
  const net1250 = async (refNo) => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'c.code': '1250' })
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first();
    return r.n;
  };

  beforeAll(async () => {
    db = require('../config/database');
    repo = require('../modules/millStore/millStore.repository');
    userId = (await db('users').first('id')).id;
    [item] = await db('mill_items').insert({ code: `${tag}-BAG`, name: `${tag} Bag`, category: 'packaging', unit: 'pcs', avg_cost_per_unit: 48.56 }).returning('*');
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('direct stock set up → Dr 1250 / Cr 6000 at average cost; down → the reverse; no cost → no journal', async () => {
    await repo.setStock(item.id, { quantity_available: 7755, reason: 'count' }, userId);
    const mv1 = await db('mill_stock_movements').where({ item_id: item.id }).orderBy('id', 'desc').first();
    expect(await net1250(`MSS-${mv1.id}`)).toBe(376582.8);
    await repo.setStock(item.id, { quantity_available: 7700, reason: 'recount' }, userId);
    const mv2 = await db('mill_stock_movements').where({ item_id: item.id }).orderBy('id', 'desc').first();
    expect(await net1250(`MSS-${mv2.id}`)).toBe(-2670.8);
    const lines = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id').where('je.ref_no', `MSS-${mv2.id}`).orderBy('jl.id').select('c.code', 'jl.debit', 'jl.credit');
    expect(lines.map((l) => [l.code, Number(l.debit), Number(l.credit)])).toEqual([['6000', 2670.8, 0], ['1250', 0, 2670.8]]);

    const [free] = await db('mill_items').insert({ code: `${tag}-FREE`, name: `${tag} Free`, category: 'packaging', unit: 'pcs', avg_cost_per_unit: 0 }).returning('*');
    await repo.setStock(free.id, { quantity_available: 10 }, userId);
    const mv3 = await db('mill_stock_movements').where({ item_id: free.id }).first();
    expect(await db('journal_entries').where({ ref_no: `MSS-${mv3.id}` })).toHaveLength(0);
  });
});
