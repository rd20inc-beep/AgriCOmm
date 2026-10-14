/**
 * P2-02 correction — post the journals that documents committed without.
 *
 * Reads the gaps from scripts/glDocumentTieOut.js and, for each one, posts the
 * MISSING journal as a fresh Posted entry dated today (never edits, reverses or
 * deletes anything already on the books):
 *   - business expense      Dr 6000 (6135 salaries) / Cr 2010 (2040 salaries)
 *   - mill-store purchase   the store_purchase rule (Dr 1250 / Cr 2010)
 *   - consumption / packing a signed delta for the per-batch difference
 *                           (Dr 6000 / Cr 1250 when the GL is short, reversed
 *                           when it is over)
 *
 * DRY-RUN BY DEFAULT — prints what it would post (counts + IDs) and writes
 * nothing. To post, after review:
 *   POST_MISSING_JOURNALS=1 node scripts/postMissingDocumentJournals.js
 * Each correction is its own transaction; a period that is closed today makes
 * that correction fail and is reported, the rest continue.
 *
 * Runbook: docs/runbooks/gl-document-tie-out.md
 */
require('dotenv').config();
const { tieOut } = require('./glDocumentTieOut');

const WRITE = process.env.POST_MISSING_JOURNALS === '1';
const today = () => new Date().toISOString().slice(0, 10);

async function postPair(trx, accounting, { entity, refType, refNo, drCode, crCode, amount, description, userId, partyType = null, partyId = null }) {
  const [dr, cr] = await Promise.all([
    trx('chart_of_accounts').where({ code: drCode }).first(),
    trx('chart_of_accounts').where({ code: crCode }).first(),
  ]);
  if (!dr || !cr) throw new Error(`chart of accounts missing ${drCode} / ${crCode}`);
  const amt = Math.abs(amount);
  const [d, c] = amount >= 0 ? [dr, cr] : [cr, dr];
  const j = await accounting.createJournal(trx, {
    date: today(), entity, refType, refNo, description, currency: 'PKR', fxRate: 1, isAuto: true,
    userId, partyType, partyId,
    lines: [
      { account_id: d.id, account: d.name, debit: amt, credit: 0, narration: `DR ${d.code} ${d.name} — ${description}`.slice(0, 240) },
      { account_id: c.id, account: c.name, debit: 0, credit: amt, narration: `CR ${c.code} ${c.name} — ${description}`.slice(0, 240) },
    ],
  });
  await accounting.postJournal(trx, j.id);
  return j;
}

// `only(kind, id)` narrows the run (tests, or posting one reviewed item at a time).
async function correct(db, { write = false, userId = null, only = null } = {}) {
  const accounting = require('../src/modules/accounting/accounting.service');
  const [expGap, mpGap, consGap, packGap] = await tieOut(db);
  const plan = [];

  for (const id of expGap.ids) {
    const e = await db('business_expenses').where({ id }).first();
    const salaries = e.category === 'salaries';
    plan.push({
      kind: 'expense', id,
      run: (trx) => postPair(trx, accounting, {
        entity: ['mill', 'export'].includes(e.expense_type) ? e.expense_type : 'general',
        refType: 'Business Expense', refNo: e.expense_no,
        drCode: salaries ? '6135' : '6000', crCode: salaries ? '2040' : '2010',
        amount: Number(e.amount_pkr), userId,
        description: `${e.expense_no} — accrual missing since recording (P2-02 correction)`,
        partyType: e.supplier_id ? 'supplier' : null, partyId: e.supplier_id || null,
      }),
    });
  }
  for (const id of mpGap.ids) {
    const p = await db('mill_purchases').where({ id }).first();
    plan.push({
      kind: 'mill_purchase', id,
      run: (trx) => postPair(trx, accounting, {
        entity: 'mill', refType: 'Mill Purchase', refNo: p.purchase_no,
        drCode: '1250', crCode: '2010', amount: Number(p.total_amount), userId,
        description: `${p.purchase_no} — journal missing since recording (P2-02 correction)`,
        partyType: p.supplier_id ? 'supplier' : null, partyId: p.supplier_id || null,
      }),
    });
  }
  const batchDelta = (gap, refType, kind) => gap.ids.map((id) => ({
    kind, id,
    run: async (trx) => {
      // Recompute inside the transaction: the figure must be current at post time.
      const b = await trx('milling_batches').where({ id }).first();
      const logTable = kind === 'consumption' ? 'mill_consumption_logs' : 'mill_packing_logs';
      const cost = Number((await trx(logTable).where({ batch_id: id }).sum({ s: 'total_cost' }).first()).s || 0);
      const booked = Number((await trx('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
        .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
        .where({ 'je.ref_type': refType, 'je.status': 'Posted', 'c.code': '1250' })
        .whereIn('je.ref_no', [b.batch_no, `BATCH-${id}`])
        .select(trx.raw('COALESCE(SUM(jl.credit - jl.debit), 0) AS n')).first()).n || 0);
      const delta = Number((cost - booked).toFixed(2));
      if (Math.abs(delta) < 0.01) return null;
      return postPair(trx, accounting, {
        entity: 'mill', refType, refNo: b.batch_no || `BATCH-${id}`,
        drCode: '6000', crCode: '1250', amount: delta, userId,
        description: `${b.batch_no || id} ${kind} — GL difference (P2-02 correction)`,
      });
    },
  }));
  plan.push(...batchDelta(consGap, 'Mill Store Consumption', 'consumption'));
  plan.push(...batchDelta(packGap, 'Mill Packing', 'packing'));
  if (only) plan.splice(0, plan.length, ...plan.filter((p) => only(p.kind, p.id)));

  const summary = { planned: plan.length, posted: 0, failed: [] };
  if (!write) return { ...summary, plan: plan.map(({ kind, id }) => ({ kind, id })) };
  for (const p of plan) {
    try {
      await db.transaction((trx) => p.run(trx));
      summary.posted += 1;
    } catch (e) {
      summary.failed.push({ kind: p.kind, id: p.id, reason: e.reason || 'error' });
    }
  }
  return summary;
}

async function main() {
  const db = require('../src/config/database');
  try {
    const r = await correct(db, { write: WRITE });
    if (!WRITE) {
      console.log(`DRY RUN — ${r.planned} correction(s) would be posted:`);
      for (const p of r.plan) console.log(`  ${p.kind} #${p.id}`);
      console.log('Set POST_MISSING_JOURNALS=1 to post them.');
    } else {
      console.log(`posted ${r.posted} of ${r.planned}; failed ${r.failed.length}`);
      for (const f of r.failed) console.log(`  failed ${f.kind} #${f.id} (${f.reason})`);
    }
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { correct };
