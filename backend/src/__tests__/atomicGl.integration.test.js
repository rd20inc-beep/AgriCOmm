/**
 * P2-02 — atomic GL: a business record and its journal commit together or not
 * at all.
 *
 * Expenses, mill-store purchases, store consumption and packing runs used to
 * wrap their journal in a try/catch that only logged. A journal that could not
 * be posted (no posting rule, closed period, missing account) left the record
 * committed with nothing in the GL; a database error inside the journal aborted
 * the Postgres transaction, so COMMIT then silently threw the record away while
 * the user was told it worked. autoPost returned null when its rule was missing.
 *
 * Each path is driven three ways — missing rule / closed period / a thrown
 * error (plain and a real SQL error) — and must leave NO business row behind;
 * a successful run must leave the trial balance balanced.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('atomic GL: ledger failures abort the business write (DB-gated)', () => {
  let db; let accounting; let expenses; let millStore; let consumption; let packing;
  let userId; let supplierId; let batch; let bagItem; let period;
  const tag = `ZZAG${`${Date.now()}`.slice(-6)}`;
  const today = new Date().toISOString().slice(0, 10);

  // Every Posted journal, debits = credits (the trial balance foots).
  const tbDiff = async () => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .where('je.status', 'Posted')
      .select(db.raw('COALESCE(SUM(jl.debit) - SUM(jl.credit), 0)::float AS diff')).first();
    return Math.abs(r.diff);
  };
  const count = async (table, where) => Number((await db(table).where(where).count({ c: '*' }).first()).c);

  const withRuleOff = async (event, fn) => {
    const ids = await db('posting_rules').where({ trigger_event: event, is_active: true }).pluck('id');
    await db('posting_rules').whereIn('id', ids).update({ is_active: false });
    try { return await fn(); } finally { await db('posting_rules').whereIn('id', ids).update({ is_active: true }); }
  };
  const withPeriodClosed = async (fn) => {
    await db('accounting_periods').where({ id: period.id }).update({ status: 'Closed' });
    try { return await fn(); } finally { await db('accounting_periods').where({ id: period.id }).update({ status: 'Open' }); }
  };
  const withJournalThrowing = async (err, fn) => {
    const spy = jest.spyOn(accounting, 'createJournal').mockImplementation(async (trx) => {
      if (err === 'sql') await trx.raw('SELECT 1/0'); // a real Postgres error: aborts the trx
      throw err;
    });
    try { return await fn(); } finally { spy.mockRestore(); }
  };

  beforeAll(async () => {
    db = require('../config/database');
    accounting = require('../modules/accounting/accounting.service');
    expenses = require('../modules/expenses/expenses.service');
    millStore = require('../modules/millStore/millStore.service');
    consumption = require('../modules/millStore/consumption.service');
    packing = require('../modules/millStore/packing.service');

    const [u] = await db('users').insert({
      email: `${tag.toLowerCase()}@test.local`, password_hash: 'x', full_name: `${tag} user`, role_id: 3, is_active: true,
    }).returning('id');
    userId = u.id || u;
    const [s] = await db('suppliers').insert({ name: `${tag} Supplier`, is_active: true }).returning('id');
    supplierId = s.id || s;
    let mill = await db('mills').first('id');
    if (!mill) [mill] = await db('mills').insert({ name: `${tag} Mill` }).returning('id');
    [batch] = await db('milling_batches').insert({
      batch_no: `${tag}-B`, created_by: userId, mill_id: mill.id || mill, status: 'In Progress',
    }).returning('*');
    [bagItem] = await db('mill_items').insert({
      code: `${tag}-BAG`, name: `${tag} Bag`, category: 'packaging', unit: 'pcs',
      avg_cost_per_unit: 10, capacity_kg: 25, tare_weight_kg: 0.1,
    }).returning('*');
    await db('mill_stock').insert({ item_id: bagItem.id, warehouse_id: null, quantity_available: 1000, quantity_reserved: 0 });

    period = await db('accounting_periods').where('period_start', '<=', today).andWhere('period_end', '>=', today).first();
    if (!period) {
      [period] = await db('accounting_periods').insert({
        name: `${tag}`, period_start: today, period_end: today, fiscal_year: Number(today.slice(0, 4)), status: 'Open',
      }).returning('*');
    }
  });

  afterAll(async () => { if (db) await db.destroy(); });

  // ── autoPost itself ──────────────────────────────────────────────────────
  describe('autoPost', () => {
    test('a missing rule throws a typed 400 instead of returning null', async () => {
      await withRuleOff('expense_recorded', async () => {
        const err = await db.transaction((trx) => accounting.autoPost(trx, {
          triggerEvent: 'expense_recorded', amount: 100, refType: 'Test', refNo: `${tag}-AP`,
        })).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.statusCode).toBe(400);
        expect(err.reason).toBe('missing_rule');
        expect(err.message).toMatch(/expense_recorded/);
      });
    });

    test('a closed period throws a typed 400', async () => {
      await withPeriodClosed(async () => {
        const err = await db.transaction((trx) => accounting.autoPost(trx, {
          triggerEvent: 'expense_recorded', amount: 100, refType: 'Test', refNo: `${tag}-AP`,
        })).catch((e) => e);
        expect(err.statusCode).toBe(400);
        expect(err.reason).toBe('period_closed');
      });
      expect(await count('journal_entries', { ref_no: `${tag}-AP` })).toBe(0);
    });

    test('a zero amount is still "nothing to post" (null), not an error', async () => {
      const r = await db.transaction((trx) => accounting.autoPost(trx, {
        triggerEvent: 'expense_recorded', amount: 0, refType: 'Test', refNo: `${tag}-AP0`,
      }));
      expect(r).toBeNull();
    });
  });

  // ── Business expense ─────────────────────────────────────────────────────
  describe('expense create', () => {
    const make = (n, extra = {}) => expenses.create({
      expense_type: 'mill', category: 'electricity', amount: 1234, currency: 'PKR',
      supplier_id: supplierId, vendor_name: `${tag}-EXP-${n}`, expense_date: today, ...extra,
    }, userId);
    const leftovers = async (n) => ({
      expenses: await count('business_expenses', { vendor_name: `${tag}-EXP-${n}` }),
      payables: await count('payables', { linked_ref: `${tag}-EXP-${n}` }),
    });

    test.each([
      ['missing rule', 'm', (fn) => withRuleOff('expense_recorded', fn), 'missing_rule'],
      ['closed period', 'p', withPeriodClosed, 'period_closed'],
      ['thrown error', 't', (fn) => withJournalThrowing(new Error('boom'), fn), undefined],
    ])('%s → 400 and neither the expense nor its payable is saved', async (_label, n, harness, reason) => {
      const err = await harness(() => make(n)).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/^The expense was not saved/);
      if (reason) expect(err.reason).toBe(reason);
      expect(await leftovers(n)).toEqual({ expenses: 0, payables: 0 });
    });

    test('a database error inside the journal surfaces — it is not swallowed into a silent rollback', async () => {
      const err = await withJournalThrowing('sql', () => make('sql')).catch((e) => e);
      expect(err).toBeInstanceOf(Error); // before: create() "succeeded" and COMMIT discarded everything
      expect(await leftovers('sql')).toEqual({ expenses: 0, payables: 0 });
    });

    test('success: expense + payable + one Posted journal, trial balance foots', async () => {
      const exp = await make('ok');
      expect(await leftovers('ok')).toEqual({ expenses: 1, payables: 1 });
      expect(await count('journal_entries', { ref_no: exp.expense_no, status: 'Posted' })).toBe(1);
      expect(await tbDiff()).toBeLessThan(0.01);
    });
  });

  // ── Mill-store purchase ──────────────────────────────────────────────────
  describe('mill store purchase', () => {
    const buy = (inv) => millStore.createPurchase({
      supplier_id: supplierId, invoice_number: `${tag}-${inv}`, purchase_date: today,
      lines: [{ item_id: bagItem.id, quantity: 5, cost_per_unit: 10 }],
    }, userId);
    const stockNow = async () => Number((await db('mill_stock').where({ item_id: bagItem.id }).sum({ q: 'quantity_available' }).first()).q);

    test.each([
      ['missing rule', 'm', (fn) => withRuleOff('store_purchase', fn)],
      ['closed period', 'p', withPeriodClosed],
      ['thrown error', 't', (fn) => withJournalThrowing(new Error('boom'), fn)],
    ])('%s → nothing is saved: no purchase, no payable, no stock', async (_label, inv, harness) => {
      const before = await stockNow();
      const err = await harness(() => buy(inv)).catch((e) => e);
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/^The mill store purchase was not saved/);
      expect(await count('mill_purchases', { invoice_number: `${tag}-${inv}` })).toBe(0);
      expect(await stockNow()).toBe(before);
    });

    test('success: purchase + payable + Posted journal; trial balance foots', async () => {
      const p = await buy('ok');
      expect(await count('payables', { source_table: 'mill_purchases', source_id: p.id })).toBe(1);
      expect(await count('journal_entries', { ref_no: p.purchase_no, status: 'Posted' })).toBe(1);
      expect(await tbDiff()).toBeLessThan(0.01);
    });
  });

  // ── Store consumption ────────────────────────────────────────────────────
  describe('mill store consumption', () => {
    const consume = () => consumption.confirm(batch.id, [{ item_id: bagItem.id, quantity: 3 }], userId);
    const logs = () => count('mill_consumption_logs', { batch_id: batch.id });

    test.each([
      ['closed period', withPeriodClosed],
      ['thrown error', (fn) => withJournalThrowing(new Error('boom'), fn)],
      ['database error', (fn) => withJournalThrowing('sql', fn)],
    ])('%s → the consumption is not recorded', async (_label, harness) => {
      const before = await logs();
      const err = await harness(consume).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(await logs()).toBe(before);
      expect(await count('milling_costs', { batch_id: batch.id, category: 'packaging' })).toBe(0);
    });

    test('a missing 6000 / 1250 account is refused, not skipped', async () => {
      const acc = await db('chart_of_accounts').where({ code: '1250' }).first();
      await db('chart_of_accounts').where({ id: acc.id }).update({ code: `${tag}` });
      try {
        const err = await consume().catch((e) => e);
        expect(err.statusCode).toBe(400);
        expect(err.message).toMatch(/missing 6000 \/ 1250/);
      } finally {
        await db('chart_of_accounts').where({ id: acc.id }).update({ code: '1250' });
      }
    });

    test('success: logged and journalled; trial balance foots', async () => {
      const r = await consume();
      expect(r.lines_consumed).toBe(1);
      expect(await count('journal_entries', { ref_type: 'Mill Store Consumption', ref_no: batch.batch_no, status: 'Posted' })).toBe(1);
      expect(await tbDiff()).toBeLessThan(0.01);
    });
  });

  // ── Packing run ──────────────────────────────────────────────────────────
  describe('packing run', () => {
    const pack = () => packing.pack(batch.id, { bag_item_id: bagItem.id, bags_count: 4 }, userId);
    const runs = () => count('mill_packing_logs', { batch_id: batch.id });

    test.each([
      ['closed period', withPeriodClosed],
      ['thrown error', (fn) => withJournalThrowing(new Error('boom'), fn)],
      ['database error', (fn) => withJournalThrowing('sql', fn)],
    ])('%s → the packing run is not recorded', async (_label, harness) => {
      const before = await runs();
      const err = await harness(pack).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(await runs()).toBe(before);
    });

    test('success: run + Posted journal; trial balance foots', async () => {
      await pack();
      expect(await count('journal_entries', { ref_type: 'Mill Packing', ref_no: batch.batch_no, status: 'Posted' })).toBe(1);
      expect(await tbDiff()).toBeLessThan(0.01);
    });
  });
});
