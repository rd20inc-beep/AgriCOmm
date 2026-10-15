/**
 * READ-ONLY: confirmed local sales whose reported COGS disagrees with the
 * COGS the GL posted (P3-12 / INV-54). Writes nothing.
 *
 *   node scripts/detectLocalSaleCogsLock.js
 *
 * Before P3-12 the COGS journal (Dr 5000) was posted from landed_cost_total
 * while cogs_total_pkr — what every report reads — was re-derived from the
 * lot at confirmation with a different fallback (no cost_per_unit), so the two
 * could differ. The GL is the record; the report field is what drifts.
 *
 * Counts, with sale-line IDS only (no names, no amounts):
 *   A. confirmed lot sales with cogs_total_pkr NULL but a posted COGS journal;
 *   B. confirmed lot sales whose cogs_total_pkr ≠ the net Dr 5000 of their
 *      posted 'Local Sale COGS' journal(s) (> Rs 0.01);
 *   C. confirmed lot sales with a cost but NO posted COGS journal — the GL is
 *      short, not the report: left for manual review (not corrected here).
 *
 * Runbook: docs/runbooks/local-sale-cogs-lock.md
 */

// Net Dr 5000 per sale, from its posted 'Local Sale COGS' journal(s).
const SQL = `
  WITH gl AS (
    SELECT je.ref_no, SUM(jl.debit - jl.credit) AS cogs
      FROM journal_entries je
      JOIN journal_lines jl ON jl.journal_id = je.id
      JOIN chart_of_accounts c ON c.id = jl.account_id AND c.code = '5000'
     WHERE je.ref_type = 'Local Sale COGS' AND je.status = 'Posted'
     GROUP BY je.ref_no
  )
  SELECT ls.id, ls.cogs_total_pkr, gl.cogs AS gl_cogs,
         COALESCE(ls.landed_cost_total, 0) AS landed
    FROM local_sales ls
    LEFT JOIN gl ON gl.ref_no = ls.sale_no
   WHERE ls.status = 'Completed' AND ls.lot_id IS NOT NULL AND ls.mill_item_id IS NULL
   ORDER BY ls.id`;

async function detect(db) {
  const { rows } = await db.raw(SQL);
  const nullLocked = [];
  const mismatch = [];
  const noJournal = [];
  for (const r of rows) {
    const gl = r.gl_cogs == null ? null : parseFloat(r.gl_cogs);
    const locked = r.cogs_total_pkr == null ? null : parseFloat(r.cogs_total_pkr);
    if (gl == null || Math.abs(gl) <= 0.01) {
      if ((locked || 0) > 0.01 || parseFloat(r.landed) > 0.01) noJournal.push(r.id);
      continue;
    }
    if (locked == null) nullLocked.push(r.id);
    else if (Math.abs(locked - gl) > 0.01) mismatch.push(r.id);
  }
  return { nullLocked, mismatch, noJournal };
}

function report(r, log = console.log) {
  log(`A. confirmed lot sales, cogs_total_pkr NULL, journal posted (ids): ${r.nullLocked.length} ${JSON.stringify(r.nullLocked)}`);
  log(`B. cogs_total_pkr ≠ posted COGS journal (ids):                   ${r.mismatch.length} ${JSON.stringify(r.mismatch)}`);
  log(`C. cost but no posted COGS journal — manual review (ids):        ${r.noJournal.length} ${JSON.stringify(r.noJournal)}`);
}

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    report(await detect(db), log);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectLocalSaleCogsLock failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, report, SQL };
