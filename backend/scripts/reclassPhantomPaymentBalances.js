/**
 * One-off GL cleanup — reclass phantom balances left by the pre-fix
 * recordPayment journal posts.
 *
 * Background:
 *   - The old recordPayment hardcoded 1100 Accounts Receivable for
 *     every receipt and 2000 Accounts Payable for every payment. But
 *     the matching posting rules (export_revenue, local_sale_recorded,
 *     advance_receipt, expense_recorded, …) used 1110 / 1120 / 1310 /
 *     2010 instead. Net effect: 1100 and 2000 each carry phantom
 *     balances that no future entry will ever clear.
 *   - The bug is fixed going forward in commit 000331e — this script
 *     just moves the already-posted balances to the right accounts.
 *
 * Strategy: for each affected journal entry, post a single reclass
 * journal that moves the misposted side to the correct account without
 * touching the cash leg (which was always right).
 *
 * Idempotent: skips reclass for any payment_no whose reclass journal
 * already exists (looked up by ref_no = "RECLASS-{payment_no}").
 *
 * Run inside the backend container:
 *   docker exec riceflow-backend node scripts/reclassPhantomPaymentBalances.js
 */
require('dotenv').config();
const db = require('../src/config/database');
const accountingService = require('../src/modules/accounting/accounting.service');

async function getAcc(trx, code) {
  return trx('chart_of_accounts').where({ code }).first();
}

async function main() {
  // Find every Payment journal entry; resolve the linked payment + its
  // source, decide the correct target account, then post one reclass.
  const journals = await db('journal_entries as je')
    .where('je.ref_type', 'Payment')
    .select('je.id', 'je.journal_no', 'je.ref_no', 'je.entity', 'je.description', 'je.total_debit', 'je.total_credit');

  const toFix = [];

  for (const je of journals) {
    const lines = await db('journal_lines as jl')
      .join('chart_of_accounts as coa', 'coa.id', 'jl.account_id')
      .where('jl.journal_id', je.id)
      .select('coa.code', 'jl.debit', 'jl.credit');

    const hasBuggyCr1100 = lines.some(l => l.code === '1100' && parseFloat(l.credit) > 0);
    const hasBuggyDr2000 = lines.some(l => l.code === '2000' && parseFloat(l.debit) > 0);
    if (!hasBuggyCr1100 && !hasBuggyDr2000) continue;

    // Resolve the payment + linked source
    const payment_no = je.ref_no;
    const payment = await db('payments').where({ payment_no }).first();
    if (!payment) {
      console.warn(`[skip] ${je.journal_no}: cannot find payment ${payment_no}`);
      continue;
    }

    let kind = null;          // 'receipt-advance' | 'receipt-local' | 'receipt-export' | 'payment'
    let amount = 0;
    let counterEntity = je.entity || 'general';

    if (hasBuggyCr1100) {
      amount = parseFloat(lines.find(l => l.code === '1100').credit) || 0;
      if (payment.linked_receivable_id) {
        const r = await db('receivables').where({ id: payment.linked_receivable_id }).first();
        if (r) {
          if (r.local_sale_id) { kind = 'receipt-local'; counterEntity = 'mill'; }
          else if (String(r.type || '').toLowerCase() === 'advance') { kind = 'receipt-advance'; counterEntity = 'export'; }
          else { kind = 'receipt-export'; counterEntity = 'export'; }
        }
      } else if (String(payment_no).startsWith('PL-')) {
        // PL-prefixed payments are local-sale receipts (notes like "Local sale LS-...").
        kind = 'receipt-local';
        counterEntity = 'mill';
      } else {
        // No clear source — default to Customer Advances since that's
        // where every other linked receipt resolved.
        kind = 'receipt-advance';
        counterEntity = 'export';
      }
    } else if (hasBuggyDr2000) {
      amount = parseFloat(lines.find(l => l.code === '2000').debit) || 0;
      kind = 'payment';
      counterEntity = 'mill';
    }

    toFix.push({ je, payment_no, kind, amount, counterEntity });
  }

  if (toFix.length === 0) {
    console.log('[reclass] No phantom postings to fix — GL already clean.');
    await db.destroy();
    return;
  }

  console.log(`[reclass] Will post ${toFix.length} reclass journals:`);
  toFix.forEach(f => console.log(`  ${f.je.journal_no.padEnd(20)} ${f.payment_no.padEnd(10)} kind=${f.kind.padEnd(20)} amount=${f.amount}`));

  const sysUser = await db('users').orderBy('id', 'asc').first('id');
  let posted = 0;

  for (const f of toFix) {
    const ref_no = `RECLASS-${f.payment_no}`;
    const dup = await db('journal_entries').where({ ref_no }).first('id');
    if (dup) {
      console.log(`  [skip] ${f.payment_no}: already reclassed (${ref_no})`);
      continue;
    }

    await db.transaction(async (trx) => {
      // Resolve target accounts
      let drCode, crCode, narration;
      if (f.kind === 'receipt-advance') {
        drCode = '1100'; crCode = '1310';
        narration = 'Move CR from 1100 A/R to 1310 Customer Advances';
      } else if (f.kind === 'receipt-local') {
        drCode = '1100'; crCode = '1120';
        narration = 'Move CR from 1100 A/R to 1120 Local AR';
      } else if (f.kind === 'receipt-export') {
        drCode = '1100'; crCode = '1110';
        narration = 'Move CR from 1100 A/R to 1110 Export AR';
      } else if (f.kind === 'payment') {
        drCode = '2010'; crCode = '2000';
        narration = 'Move DR from 2000 A/P to 2010 Supplier Payable';
      } else {
        throw new Error('Unknown reclass kind: ' + f.kind);
      }

      const drAcc = await getAcc(trx, drCode);
      const crAcc = await getAcc(trx, crCode);
      if (!drAcc || !crAcc) {
        throw new Error(`Chart of accounts missing code ${drCode} or ${crCode}`);
      }

      const journal = await accountingService.createJournal(trx, {
        date: new Date().toISOString().slice(0, 10),
        entity: f.counterEntity,
        refType: 'Reclass',
        refNo: ref_no,
        description: `Reclass for ${f.payment_no}: ${narration} (fixes pre-000331e wrong-account posting)`,
        currency: 'PKR',
        fxRate: 1,
        isAuto: true,
        userId: sysUser?.id || null,
        lines: [
          { account_id: drAcc.id, account: drAcc.name, debit: f.amount, credit: 0,        narration: `DR ${drCode} ${drAcc.name} — reclass ${f.payment_no}` },
          { account_id: crAcc.id, account: crAcc.name, debit: 0,        credit: f.amount, narration: `CR ${crCode} ${crAcc.name} — reclass ${f.payment_no}` },
        ],
      });
      if (journal?.id) await accountingService.postJournal(trx, journal.id);
    });

    console.log(`  [ok]   ${f.payment_no} reclassed (${f.kind}, Rs ${Math.round(f.amount).toLocaleString('en-PK')})`);
    posted += 1;
  }

  // Re-check trial balance
  const after = await db('journal_lines as jl')
    .join('chart_of_accounts as coa', 'coa.id', 'jl.account_id')
    .whereIn('coa.code', ['1100', '1110', '1120', '1310', '2000', '2010'])
    .groupBy('coa.code', 'coa.name')
    .select('coa.code', 'coa.name', db.raw('SUM(jl.debit) as dr'), db.raw('SUM(jl.credit) as cr'));
  console.log(`\n[reclass] Done. Posted ${posted} reclass journals.\n\nTrial balance after:`);
  for (const r of after.sort((a, b) => a.code.localeCompare(b.code))) {
    const dr = parseFloat(r.dr) || 0;
    const cr = parseFloat(r.cr) || 0;
    console.log(`  ${r.code} ${r.name.padEnd(28)} DR ${String(dr.toFixed(0)).padStart(14)}  CR ${String(cr.toFixed(0)).padStart(14)}  net ${String((dr - cr).toFixed(0)).padStart(14)}`);
  }

  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
