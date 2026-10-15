/**
 * P2-02 tie-out — business documents that committed WITHOUT their journal.
 *
 * Until P2-02 the expense / mill-store purchase / store consumption / packing
 * paths swallowed a failed journal, so a record could commit with nothing in
 * the GL. This finds the gaps. READ-ONLY: it writes nothing.
 *
 *   node scripts/glDocumentTieOut.js
 *
 * Output is COUNTS and row IDs only (no party names, no amounts per row).
 * Corrections, after review, are posted by scripts/postMissingDocumentJournals.js
 * (dry-run by default). Runbook: docs/runbooks/gl-document-tie-out.md
 */
require('dotenv').config();

const TOL = 0.01;

/** Every check returns { label, ids, gap } — gap is the PKR total missing (sign: + = GL short). */
async function tieOut(db) {
  const out = [];

  // 1. Expenses with no accrual journal at all (any status — a Reversed one was posted once).
  const exp = await db('business_expenses as e')
    .whereNot('e.payment_status', 'Reversed')
    .where('e.amount_pkr', '>', 0)
    .whereNotExists(db('journal_entries as je')
      .whereRaw('je.ref_no = e.expense_no').where('je.ref_type', 'Business Expense'))
    .select('e.id', 'e.amount_pkr');
  out.push({
    label: 'business_expenses without a Business Expense journal',
    ids: exp.map((r) => r.id),
    gap: exp.reduce((s, r) => s + Number(r.amount_pkr || 0), 0),
  });

  // 2. Mill-store purchases with a value and no store_purchase journal.
  const mp = await db('mill_purchases as p')
    .where('p.total_amount', '>', 0)
    .whereNotExists(db('journal_entries as je')
      .whereRaw('je.ref_no = p.purchase_no').where('je.ref_type', 'Mill Purchase'))
    .select('p.id', 'p.total_amount');
  out.push({
    label: 'mill_purchases without a Mill Purchase journal',
    ids: mp.map((r) => r.id),
    gap: mp.reduce((s, r) => s + Number(r.total_amount || 0), 0),
  });

  // 3 + 4. Store consumption / packing: per batch, the logged cost vs the net
  // credit its journals put on 1250 (Posted only — the trial balance's view).
  const perBatch = async (logTable, refType) => {
    const logged = await db(`${logTable} as l`)
      .join('milling_batches as b', 'b.id', 'l.batch_id')
      .groupBy('b.id', 'b.batch_no')
      .select('b.id', 'b.batch_no', db.raw('COALESCE(SUM(l.total_cost), 0)::float AS cost'));
    const gl = await db('journal_lines as jl')
      .join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_type': refType, 'je.status': 'Posted', 'c.code': '1250' })
      .groupBy('je.ref_no')
      .select('je.ref_no', db.raw('COALESCE(SUM(jl.credit - jl.debit), 0)::float AS booked'));
    const booked = new Map(gl.map((r) => [r.ref_no, r.booked]));
    const rows = logged
      .map((r) => ({ id: r.id, diff: Number((r.cost - (booked.get(r.batch_no) || booked.get(`BATCH-${r.id}`) || 0)).toFixed(2)) }))
      .filter((r) => Math.abs(r.diff) > TOL);
    return { ids: rows.map((r) => r.id), gap: rows.reduce((s, r) => s + r.diff, 0), rows };
  };
  const cons = await perBatch('mill_consumption_logs', 'Mill Store Consumption');
  out.push({ label: 'batches whose store consumption differs from its 1250 journals', ids: cons.ids, gap: cons.gap });
  const pack = await perBatch('mill_packing_logs', 'Mill Packing');
  out.push({ label: 'batches whose packing cost differs from its 1250 journals', ids: pack.ids, gap: pack.gap });

  return out;
}

async function main() {
  const db = require('../src/config/database');
  try {
    const results = await tieOut(db);
    for (const r of results) {
      console.log(`${r.label}: ${r.ids.length}${r.ids.length ? ` — ids ${r.ids.join(', ')}` : ''}`);
      if (r.ids.length) console.log(`  total gap (PKR, + = GL short): ${r.gap.toFixed(2)}`);
    }
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { tieOut };
