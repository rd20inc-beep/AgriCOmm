/**
 * P3-05 / P3-06 — read-only: does the mill store tie out to 1250?
 *
 * The store is valued at moving-average cost (Σ on-hand × avg_cost_per_unit,
 * every bucket, active or not) and 1250 Bags & Packaging should equal it. It
 * drifted because freed katta entered at the purchased average with nothing in
 * 1250, packing runs credited 1250 for bags they never drew, batch deletes put
 * consumed stock back without reversing the journal, packaging local sales drew
 * stock with no journal, and average-cost edits revalued stock with no journal.
 * From P3-05 on, every store move carries its value and its journal; the
 * difference reported here is the legacy drift for ONE approved true-up
 * (scripts/correctStoreValuation.js).
 *
 * Also lists (IDs only):
 *   ledgerMismatch       items whose movement ledger does not add up to on-hand
 *   inactiveWithStock    retired items still holding stock (value nobody sees)
 *   legacyKattaBatches   batches whose katta reconcile rows predate valuation
 *                        (kept on their old, unvalued basis — never re-costed)
 *   untaggedPackaging    'packaging' cost lines with no owner (source NULL) on a
 *                        batch that also has packing runs or store issues — a
 *                        run whose tag a store issue overwrote (MIL-23), for a
 *                        person to review
 *   runCostMismatch      packing runs whose cost line ≠ the run's total_cost
 *
 * Output is counts, amounts of the two totals, and IDs — nothing else.
 *   node scripts/detectStoreValuation.js
 * Runbook: docs/runbooks/mill-store-1250-tie-out.md
 */
require('dotenv').config();

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

async function detect(db) {
  const value = await db('mill_stock as ms').join('mill_items as mi', 'mi.id', 'ms.item_id')
    .select(db.raw('COALESCE(SUM(ms.quantity_available * COALESCE(mi.avg_cost_per_unit, 0)), 0) AS v')).first();
  const gl = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.status': 'Posted', 'c.code': '1250' })
    .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0) AS n')).first();
  const storeValue = r2(value && value.v);
  const gl1250 = r2(gl && gl.n);

  const ledgerMismatch = (await db.raw(`
    SELECT s.item_id FROM (
      SELECT item_id, SUM(quantity_available) AS q FROM mill_stock GROUP BY item_id
    ) s LEFT JOIN (
      SELECT item_id, SUM(quantity) AS q FROM mill_stock_movements GROUP BY item_id
    ) m ON m.item_id = s.item_id
    WHERE ABS(s.q - COALESCE(m.q, 0)) > 0.001 ORDER BY s.item_id`)).rows.map((r) => r.item_id);

  const inactiveWithStock = (await db('mill_items as mi').join('mill_stock as ms', 'ms.item_id', 'mi.id')
    .where('mi.is_active', false).groupBy('mi.id').havingRaw('SUM(ms.quantity_available) > 0')
    .select('mi.id').orderBy('mi.id')).map((r) => r.id);

  const legacyKattaBatches = (await db('mill_stock_movements')
    .where({ reference_type: 'batch_katta' }).whereNull('valuation')
    .distinct('reference_id').orderBy('reference_id')).map((r) => r.reference_id);

  const untaggedPackaging = (await db('milling_costs as mc')
    .where({ 'mc.category': 'packaging' }).whereNull('mc.source')
    .whereExists(function () {
      this.select(db.raw('1')).from('milling_costs as o')
        .whereRaw('o.batch_id = mc.batch_id').whereIn('o.source', ['packing_run', 'store_consumption']);
    })
    .select('mc.id').orderBy('mc.id')).map((r) => r.id);

  const runCostMismatch = (await db.raw(`
    SELECT pl.id FROM mill_packing_logs pl
    LEFT JOIN milling_costs mc ON mc.source = 'packing_run' AND mc.source_id = pl.id
    WHERE ABS(COALESCE(pl.total_cost, 0) - COALESCE(mc.amount, 0)) > 0.01
    ORDER BY pl.id`)).rows.map((r) => r.id);

  return {
    storeValue, gl1250, difference: r2(gl1250 - storeValue),
    ledgerMismatch, inactiveWithStock, legacyKattaBatches, untaggedPackaging, runCostMismatch,
  };
}

async function main() {
  const db = require('../src/config/database');
  try {
    const r = await detect(db);
    const list = (xs) => `${xs.length}${xs.length ? ` (ids: ${xs.join(', ')})` : ''}`;
    console.log(`store value (Σ on-hand × average): ${r.storeValue.toFixed(2)}`);
    console.log(`GL 1250 Bags & Packaging (Posted): ${r.gl1250.toFixed(2)}`);
    console.log(`difference (GL − store): ${r.difference.toFixed(2)}${Math.abs(r.difference) > 0.01 ? '  → true-up candidate (correctStoreValuation.js)' : '  → ties out'}`);
    console.log(`items whose movement ledger ≠ on-hand: ${list(r.ledgerMismatch)}`);
    console.log(`retired items still holding stock: ${list(r.inactiveWithStock)}`);
    console.log(`batches on the legacy (unvalued) katta basis: ${list(r.legacyKattaBatches)}`);
    console.log(`packaging cost lines with no owner on batches with runs/issues (review): ${list(r.untaggedPackaging)}`);
    console.log(`packing runs whose cost line ≠ run total: ${list(r.runCostMismatch)}`);
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { detect };
