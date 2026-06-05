/**
 * Journal currency normalization + correction.
 *
 * The GL is PKR-base — every aggregation (trial balance, P&L, balance sheet,
 * account balances) sums journal_lines RAW assuming PKR. But some historical
 * export journals were stored in USD (lines in USD with fx_rate), so they are
 * silently UNDERSTATED in those reports by ~(fx_rate − 1)×.
 *
 * Phase A — re-denominate every foreign-currency journal to PKR:
 *   lines × fx_rate, currency → PKR, fx_rate → 1, and stamp the original
 *   currency/rate into orig_currency/orig_fx_rate. This CORRECTS the trial
 *   balance and account balances (they will move by the converted amount).
 *
 * Phase B — for PKR-denominated journals tied to a foreign export order that
 *   have no orig metadata yet, stamp orig_currency/orig_fx_rate from the order
 *   (using the exact receipt rate = *_received_pkr / *_received where known,
 *   else the booked rate), so the ledger's USD sub-line is exact.
 *
 * Neither phase changes any PKR total — Phase A makes raw aggregations correct;
 * Phase B only adds metadata. Idempotent: Phase A skips PKR journals, Phase B
 * skips journals already stamped.
 *
 * SAFE: dry-run by default. Pass --commit to write. Wrapped in one transaction
 * so it's all-or-nothing.
 *
 *   node scripts/normalizeJournalCurrency.js            # dry run
 *   node scripts/normalizeJournalCurrency.js --commit   # apply
 */

const db = require('../src/config/database');

const COMMIT = process.argv.includes('--commit');
const r2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
const fmt = (n) => 'Rs ' + Math.round(n).toLocaleString();

async function main() {
  console.log(`\nMode: ${COMMIT ? 'COMMIT (writing)' : 'DRY RUN (no writes)'}\n`);

  // ── Phase A: foreign-denominated journals → PKR ───────────────────────
  const foreign = await db('journal_entries')
    .where('status', 'Posted')
    .whereNotNull('currency')
    .whereNot('currency', 'PKR')
    .select('id', 'journal_no', 'ref_no', 'currency', 'fx_rate', 'total_debit', 'description');

  console.log(`── Phase A: re-denominate foreign journals to PKR (${foreign.length}) ──`);
  let aFixed = 0, addedPkr = 0;
  for (const j of foreign) {
    const rate = parseFloat(j.fx_rate) || 1;
    if (rate <= 1) { console.log(`  SKIP ${j.journal_no} (${j.currency}) — rate ${rate}`); continue; }
    const before = parseFloat(j.total_debit) || 0;
    const after = r2(before * rate);
    addedPkr += (after - before);
    console.log(`  ${COMMIT ? 'FIX ' : 'PLAN'} ${j.journal_no} ${j.ref_no || ''} ${j.currency}@${rate}: ${fmt(before)} → ${fmt(after)}`);
    aFixed++;
  }
  console.log(`  ${COMMIT ? 'Corrected' : 'Would correct'} ${aFixed} journals; trial balance shifts by +${fmt(addedPkr)} into the affected accounts.\n`);

  // ── Phase B: stamp orig metadata on PKR export journals ───────────────
  const exportJ = await db('journal_entries as je')
    .join('export_orders as eo', 'je.ref_no', 'eo.order_no')
    .where('je.status', 'Posted')
    .where(function () { this.where('je.currency', 'PKR').orWhereNull('je.currency'); })
    .whereNull('je.orig_currency')
    .whereNotNull('eo.currency')
    .whereNot('eo.currency', 'PKR')
    .select(
      'je.id', 'je.journal_no', 'je.ref_no', 'je.description', 'je.total_debit',
      'eo.currency as order_cur', 'eo.booked_fx_rate',
      'eo.advance_received', 'eo.advance_received_pkr',
      'eo.balance_received', 'eo.balance_received_pkr',
    );

  console.log(`── Phase B: stamp orig currency/rate on PKR export journals (${exportJ.length}) ──`);
  let bFixed = 0;
  const bPlan = [];
  for (const j of exportJ) {
    const d = j.description || '';
    let rate = parseFloat(j.booked_fx_rate) || 0;
    if (/Adv rcpt/i.test(d) && parseFloat(j.advance_received) > 0) {
      rate = parseFloat(j.advance_received_pkr) / parseFloat(j.advance_received);
    } else if (/Bal rcpt/i.test(d) && parseFloat(j.balance_received) > 0) {
      rate = parseFloat(j.balance_received_pkr) / parseFloat(j.balance_received);
    }
    if (!(rate > 0)) { console.log(`  SKIP ${j.journal_no} ${j.ref_no} — no usable rate`); continue; }
    rate = Math.round(rate * 1e6) / 1e6;
    const usd = r2((parseFloat(j.total_debit) || 0) / rate);
    console.log(`  ${COMMIT ? 'SET ' : 'PLAN'} ${j.journal_no} ${j.ref_no}: orig ${j.order_cur}@${rate} → $${usd.toLocaleString()}`);
    bPlan.push({ id: j.id, cur: j.order_cur, rate });
    bFixed++;
  }
  console.log(`  ${COMMIT ? 'Stamped' : 'Would stamp'} ${bFixed} journals.\n`);

  if (COMMIT) {
    await db.transaction(async (trx) => {
      for (const j of foreign) {
        const rate = parseFloat(j.fx_rate) || 1;
        if (rate <= 1) continue;
        await trx('journal_lines').where('journal_id', j.id).update({
          debit: trx.raw('ROUND(debit * ?, 2)', [rate]),
          credit: trx.raw('ROUND(credit * ?, 2)', [rate]),
        });
        await trx('journal_entries').where('id', j.id).update({
          currency: 'PKR',
          fx_rate: 1,
          total_debit: r2((parseFloat(j.total_debit) || 0) * rate),
          total_credit: r2((parseFloat(j.total_debit) || 0) * rate),
          orig_currency: j.currency,
          orig_fx_rate: rate,
        });
      }
      for (const b of bPlan) {
        await trx('journal_entries').where('id', b.id).update({ orig_currency: b.cur, orig_fx_rate: b.rate });
      }
    });
    console.log('COMMITTED.\n');
  } else {
    console.log('DRY RUN — nothing written. Re-run with --commit to apply.\n');
  }

  await db.destroy();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
