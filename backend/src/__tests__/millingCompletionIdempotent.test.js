/**
 * The milling_completion journal is posted once per batch.
 *
 * Prod, M-004 (2026-09-29): first yield 21,825 kg posted JE-202609-0055
 * (Dr 1220 / Cr 1210 Rs 5,206,175.25). A re-yield of all zeros then retired the
 * only output lot; with no output lots the next save (49,023 kg) was treated as
 * a FIRST yield and posted JE-202609-0056 — the same Rs 5,206,175.25 again.
 *
 * Three guards, each tested here:
 *   1. yieldMode treats a batch with a Posted completion as a re-yield even
 *      when its output lots are gone;
 *   2. a re-yield that records no output is refused;
 *   3. postMillingCompletion posts nothing once the batch's completion is
 *      Posted (unit + DB-gated: real accounting service + Postgres).
 */
const fs = require('fs');
const path = require('path');
const lifecycle = require('../modules/milling/batchLifecycle');

describe('yieldMode — a posted completion means the yield was taken', () => {
  test('Completed, output lots retired, completion posted → re-yield (not a second first-yield)', () => {
    expect(lifecycle.yieldMode({ status: 'Completed', hasOutputs: false, hasCompletion: true })).toBe('reyield');
  });
  test('no outputs and no completion is still a first yield', () => {
    expect(lifecycle.yieldMode({ status: 'Completed', hasOutputs: false, hasCompletion: false })).toBe('first');
    expect(lifecycle.yieldMode({ status: 'Queued', hasOutputs: false })).toBe('first');
  });
  test('a held batch is still refused', () => {
    expect(lifecycle.yieldMode({ status: 'On Hold', hasOutputs: false, hasCompletion: true })).toBe('refuse');
  });
});

describe('recordYield wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../modules/milling/milling.controller.js'), 'utf8');
  const at = src.indexOf('async recordYield(');
  const body = src.slice(at, src.indexOf('async getBatchKatta(', at));

  test('the completion goes through the idempotent helper, never a bare autoPost', () => {
    expect(body).toMatch(/postMillingCompletion\(trx, accountingService/);
    expect(body).not.toMatch(/triggerEvent: 'milling_completion'/);
  });
  test('both mode decisions consult the posted completion', () => {
    expect((body.match(/hasCompletion: await hasPostedCompletion\(/g) || []).length).toBe(2);
  });
  test('a re-yield with no output is refused before anything is written', () => {
    const re = body.indexOf("if (mode === 'reyield') {");
    const guard = body.indexOf('a re-recorded yield must still produce some output', re);
    const resync = body.indexOf('resyncBatchOutputsFromBatch', re);
    expect(re).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(re);
    expect(guard).toBeLessThan(resync);
  });
});

describe('postMillingCompletion (no DB)', () => {
  const { postMillingCompletion } = require('../modules/milling/millingCompletionJournal');
  // Minimal knex double: journal_entries answers whether a completion is
  // Posted; the transfer query answers `net`.
  const fakeTrx = ({ posted, net = 0 }) => {
    const t = (table) => {
      const b = {
        join: () => b, leftJoin: () => b, where: () => b, whereIn: () => b, groupBy: () => b, select: () => b, sum: () => b,
        pluck: async () => [],
        // A batch with no source lots (direct truck intake): all CR 1210.
        then: (resolve) => resolve([]),
        first: async () => {
          if (table === 'journal_entries') return posted ? { id: 55 } : undefined;
          if (table === 'journal_lines as jl') return { net };
          // The whole cost is the raw-rice line (no processing to absorb).
          if (table === 'milling_costs') return { t: '5206175.25' };
          return undefined;
        },
      };
      return b;
    };
    t.raw = (x) => x;
    return t;
  };
  const acct = () => ({ autoPost: jest.fn(async () => ({ id: 1 })), createJournal: jest.fn(), postJournal: jest.fn() });
  const batch = { id: 4, batch_no: 'M-004' };

  test('first completion posts the full amount through the rule', async () => {
    const a = acct();
    const out = await postMillingCompletion(fakeTrx({ posted: false }), a, { batch, amount: 5206175.25, finishedKg: 21825 });
    expect(out.posted).toBe('full');
    expect(a.autoPost).toHaveBeenCalledTimes(1);
    expect(a.autoPost.mock.calls[0][1]).toMatchObject({ triggerEvent: 'milling_completion', amount: 5206175.25, refType: 'Milling Batch', refNo: 'M-004' });
    // The quantity is KG — the old description called it MT.
    expect(a.autoPost.mock.calls[0][1].description).toMatch(/21,825 kg finished/);
  });

  test('the M-004 replay: completion already Posted → nothing posted', async () => {
    const a = acct();
    const out = await postMillingCompletion(fakeTrx({ posted: true, net: '5206175.25' }), a, { batch, amount: 5206175.25, finishedKg: 49023 });
    expect(out).toMatchObject({ posted: 'none', alreadyPosted: 5206175.25 });
    expect(a.autoPost).not.toHaveBeenCalled();
    expect(a.createJournal).not.toHaveBeenCalled();
  });

  test('already Posted but the cost sheet moved on → still nothing (addCost / Mill Packing carry those)', async () => {
    const a = acct();
    const out = await postMillingCompletion(fakeTrx({ posted: true, net: '1000' }), a, { batch, amount: 1250, finishedKg: 10 });
    expect(out.posted).toBe('none');
    expect(a.autoPost).not.toHaveBeenCalled();
  });

  test('a zero-cost batch posts nothing', async () => {
    const a = acct();
    const out = await postMillingCompletion(fakeTrx({ posted: false }), a, { batch, amount: 0, finishedKg: 10 });
    expect(out.posted).toBe('none');
    expect(a.autoPost).not.toHaveBeenCalled();
  });
});

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('postMillingCompletion against Postgres (DB-gated)', () => {
  let db; let accounting; let helper;
  const batchNo = `ZZ-M-${`${Date.now()}`.slice(-7)}`;
  beforeAll(() => {
    db = require('../config/database');
    accounting = require('../modules/accounting/accounting.service');
    helper = require('../modules/milling/millingCompletionJournal');
  });
  afterAll(async () => {
    const ids = await db('journal_entries').where({ ref_no: batchNo }).pluck('id');
    if (ids.length) {
      await db('journal_lines').whereIn('journal_id', ids).del();
      await db('journal_entries').whereIn('id', ids).del();
    }
    await db.destroy();
  });

  const net1220 = () => helper.postedMillingTransfer(db, batchNo);

  test('posting the same completion twice capitalises it once', async () => {
    const batch = { batch_no: batchNo };
    await db.transaction((trx) => helper.postMillingCompletion(trx, accounting, { batch, amount: 5206175.25, finishedKg: 21825 }));
    expect(await net1220()).toBe(5206175.25);
    // The second (M-004 replay) save.
    await db.transaction((trx) => helper.postMillingCompletion(trx, accounting, { batch, amount: 5206175.25, finishedKg: 49023 }));
    expect(await net1220()).toBe(5206175.25);
    const posted = await db('journal_entries').where({ ref_no: batchNo, status: 'Posted' }).count('id as c').first();
    expect(parseInt(posted.c, 10)).toBe(1);
  });

  test('a later completion with a different cost posts nothing either', async () => {
    const batch = { batch_no: batchNo };
    await db.transaction((trx) => helper.postMillingCompletion(trx, accounting, { batch, amount: 5300000, finishedKg: 49023 }));
    expect(await net1220()).toBe(5206175.25);
    expect(await helper.hasPostedCompletion(db, batchNo)).toBe(true);
  });
});
