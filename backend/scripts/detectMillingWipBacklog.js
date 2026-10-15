/**
 * READ-ONLY. Milling WIP / truck-purchase backlog at the D-6 cut-over
 * (P3-09 / P3-19). Lists what the new rules would have booked for rice that
 * was committed or received BEFORE they shipped — history is not re-posted
 * automatically; correctMillingWip.js books it once, after review.
 *
 * Findings (IDs only):
 *   - wip_not_booked      an open batch whose committed rice is still carried in
 *                         its stock account (1210 / 1220 / 1240) instead of
 *                         1260 Milling WIP — the GL-vs-lots gap
 *                         (memory: project_inventory_gl_vs_lots_gap)
 *   - truck_not_bought    a truck-intake lot (open OR cancelled batch) that is in
 *                         stock with no supplier payable and no GL: AP and 1210
 *                         lag the receipt (MIL-09 / MIL-17)
 *   - wip_after_yield     a yielded / closed batch that still has a WIP balance
 *                         (should be none — investigate by hand)
 * With --totals, also the per-GL-account stock ↔ GL tie-out (aggregate PKR per
 * account, stockValue.inventoryTieOut) — for the accountant, not for chat.
 *
 * Usage:  node scripts/detectMillingWipBacklog.js [--totals]
 * Output: counts and batch / lot IDs (plus account totals with --totals). No party names.
 * Runbook: docs/runbooks/milling-wip-cutover.md
 */
const sv = require('../src/modules/inventory/stockValue');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function detect(q, { batchId = null } = {}) {
  const findings = [];

  // 1. Committed rice not (fully) in WIP, per open batch.
  const commits = await sv.millingCommitments(q, { batchId });
  const byBatch = new Map();
  for (const c of commits) {
    const b = byBatch.get(c.batchId) || { batchId: c.batchId, batchNo: c.batchNo, target: {} };
    b.target[c.account] = r2((b.target[c.account] || 0) + c.value);
    byBatch.set(c.batchId, b);
  }
  const booked = await sv.wipBookedByBatch(q, [...byBatch.values()].map((b) => b.batchNo));
  for (const b of byBatch.values()) {
    const m = booked.get(b.batchNo) || {};
    let gap = 0;
    for (const code of new Set([...Object.keys(b.target), ...Object.keys(m)])) gap = r2(gap + (b.target[code] || 0) - (m[code] || 0));
    const absGap = Object.keys(b.target).concat(Object.keys(m))
      .reduce((s, code) => s + Math.abs((b.target[code] || 0) - (m[code] || 0)), 0);
    if (absGap >= 0.01) findings.push({ kind: 'wip_not_booked', batchId: b.batchId, batchNo: b.batchNo, gap });
  }

  // 2. Truck lots in stock with no purchase on the books (open or cancelled batch).
  const truck = await q.raw(`
    SELECT mb.id AS batch_id, mb.batch_no, mb.status, l.id AS lot_id, l.lot_no,
           ${sv.lotValueSql('l')} AS value
      FROM milling_batches mb
      JOIN inventory_lots l ON l.batch_ref = 'batch-' || mb.id AND l.type = 'raw' AND l.entity = 'mill'
     WHERE mb.is_service_milling IS NOT TRUE AND COALESCE(mb.processing_type, '') <> 'blended'
       AND mb.supplier_id IS NOT NULL AND l.ownership = 'company'
       AND ${sv.lotValueSql('l')} > 0.01
       AND NOT EXISTS (SELECT 1 FROM batch_source_lots b2 WHERE b2.batch_id = mb.id)
       AND NOT EXISTS (SELECT 1 FROM payables p WHERE p.linked_ref = l.lot_no AND p.category = 'Raw Material' AND p.status <> 'Reversed')
       AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type = 'Purchase Lot' AND je.ref_no = l.lot_no)
       AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type = 'Rice Purchase' AND je.ref_no = mb.batch_no)
       AND NOT EXISTS (SELECT 1 FROM payables p WHERE p.source_table = 'milling_raw_rice' AND p.source_id = mb.id)
       AND NOT EXISTS (SELECT 1 FROM inventory_lots o WHERE o.batch_ref = 'batch-' || mb.id AND o.type IN ('finished', 'byproduct'))
       AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type = 'Milling Batch' AND je.ref_no = mb.batch_no AND je.status = 'Posted')
       ${batchId != null ? 'AND mb.id = ?' : ''}
     ORDER BY mb.id`, batchId != null ? [batchId] : []);
  for (const t of truck.rows || []) {
    findings.push({ kind: 'truck_not_bought', batchId: t.batch_id, batchNo: t.batch_no, lotId: t.lot_id, status: t.status, value: r2(t.value) });
  }

  // 3. WIP left on a batch that is no longer open.
  const left = await q.raw(`
    SELECT mb.id AS batch_id, mb.batch_no, SUM(jl.debit - jl.credit) AS bal
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_id AND je.status = 'Posted'
      JOIN chart_of_accounts c ON c.id = jl.account_id AND c.code = ?
      JOIN milling_batches mb ON mb.batch_no = je.ref_no
     WHERE NOT ${sv.openBatchSql('mb')} ${batchId != null ? 'AND mb.id = ?' : ''}
     GROUP BY mb.id, mb.batch_no
    HAVING ABS(SUM(jl.debit - jl.credit)) >= 0.01`, batchId != null ? [sv.WIP_ACCOUNT, batchId] : [sv.WIP_ACCOUNT]);
  for (const w of left.rows || []) findings.push({ kind: 'wip_after_yield', batchId: w.batch_id, batchNo: w.batch_no, value: r2(w.bal) });

  return findings;
}

function summarize(findings) {
  const by = (k) => findings.filter((f) => f.kind === k);
  return { wipNotBooked: by('wip_not_booked'), truckNotBought: by('truck_not_bought'), wipAfterYield: by('wip_after_yield') };
}

async function main(argv = process.argv.slice(2), log = console.log) {
  const db = require('../src/config/database');
  try {
    const s = summarize(await detect(db));
    log(`open batches with committed rice not in 1260 WIP: ${s.wipNotBooked.length}`);
    for (const f of s.wipNotBooked) log(`  batch #${f.batchId}`);
    log(`truck-intake lots in stock with no purchase booked: ${s.truckNotBought.length}`);
    for (const f of s.truckNotBought) log(`  batch #${f.batchId} (${f.status}) lot #${f.lotId}`);
    log(`closed / yielded batches still carrying WIP (investigate): ${s.wipAfterYield.length}`);
    for (const f of s.wipAfterYield) log(`  batch #${f.batchId}`);
    if (!argv.includes('--totals')) return 0;
    const t = await sv.inventoryTieOut(db);
    log('stock ↔ GL tie-out (D-14 value, PKR):');
    log('  account | stock value | committed | expected GL | GL | difference | WIP not booked | unexplained');
    for (const a of t.accounts) {
      log(`  ${a.account} | ${a.value} | ${a.committedValue} | ${a.expectedGl} | ${a.glBalance} | ${a.difference} | ${a.wipNotBooked} | ${a.unexplained}`);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectMillingWipBacklog failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, summarize, main };
