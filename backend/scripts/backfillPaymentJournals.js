/**
 * One-off backfill — synthesise a journal entry for every payment row
 * that doesn't already have one. Mirrors the inline journal logic now
 * baked into recordPayment, so historical Money In/Out activity finally
 * shows up on /finance/accounting.
 *
 * Idempotent: skips any payment whose payment_no already has a matching
 * ref_type='Payment' journal_entries row, so it's safe to run twice.
 *
 * Usage from project root:
 *   docker exec riceflow-backend node scripts/backfillPaymentJournals.js
 */
require('dotenv').config();
const db = require('../src/config/database');
const accountingService = require('../src/modules/accounting/accounting.service');

async function main() {
  const coa = await db('chart_of_accounts').select('id', 'code', 'name');
  const byCode = Object.fromEntries(coa.map((r) => [r.code, r]));
  const cashAndBank = byCode['1000'];
  const accountsReceivable = byCode['1100'];
  const accountsPayable = byCode['2000'];

  if (!cashAndBank || !accountsReceivable || !accountsPayable) {
    console.error('Missing chart_of_accounts codes 1000 / 1100 / 2000 — cannot backfill.');
    process.exit(1);
  }

  const payments = await db('payments').orderBy('payment_date', 'asc');
  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of payments) {
    const existing = await db('journal_entries')
      .where({ ref_type: 'Payment', ref_no: p.payment_no })
      .first();
    if (existing) {
      skipped += 1;
      continue;
    }

    const isReceipt = p.type === 'receipt';
    const amtPkr = parseFloat(p.base_amount_pkr) || parseFloat(p.amount) || 0;
    if (amtPkr <= 0) {
      skipped += 1;
      continue;
    }

    const counterAcc = isReceipt ? accountsReceivable : accountsPayable;
    const debitAcc = isReceipt ? cashAndBank : counterAcc;
    const creditAcc = isReceipt ? counterAcc : cashAndBank;
    const entity = isReceipt ? 'export' : 'mill';
    const journalDate = (p.payment_date ? new Date(p.payment_date) : new Date(p.created_at || Date.now()))
      .toISOString().slice(0, 10);

    try {
      await db.transaction(async (trx) => {
        // Post in PKR — amtPkr is already PKR-equivalent. Original
        // foreign amount + rate are captured in the description so
        // anyone reading the journal can still see where it came from.
        const cur = (p.currency || 'PKR').toUpperCase();
        const origAmt = parseFloat(p.amount) || 0;
        const fx = parseFloat(p.fx_rate) || 1;
        const noteOriginal = cur !== 'PKR' ? ` (orig ${cur} ${origAmt.toLocaleString()} @ ${fx})` : '';
        const journal = await accountingService.createJournal(trx, {
          date: journalDate,
          entity,
          refType: 'Payment',
          refNo: p.payment_no,
          description: `Payment ${p.payment_no} (backfilled)${noteOriginal}`,
          currency: 'PKR',
          fxRate: 1,
          isAuto: true,
          userId: p.created_by || null,
          lines: [
            { account_id: debitAcc.id,  account: debitAcc.name,  debit: amtPkr, credit: 0,      narration: `DR ${debitAcc.code} ${debitAcc.name} — ${p.payment_no}` },
            { account_id: creditAcc.id, account: creditAcc.name, debit: 0,      credit: amtPkr, narration: `CR ${creditAcc.code} ${creditAcc.name} — ${p.payment_no}` },
          ],
        });
        if (journal?.id) await accountingService.postJournal(trx, journal.id);
      });
      posted += 1;
      console.log(`  ✓ ${p.payment_no}  ${journalDate}  ${isReceipt ? 'receipt' : 'payment'}  Rs ${Math.round(amtPkr).toLocaleString()}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${p.payment_no} failed: ${err.message}`);
    }
  }

  console.log(`\nDone. posted=${posted} skipped=${skipped} failed=${failed} (of ${payments.length} payments).`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
