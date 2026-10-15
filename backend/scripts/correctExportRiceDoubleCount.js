/**
 * Correction (P2-05) for OWNER-CONFIRMED duplicate rice costs on shipped export
 * orders — run only on cost ids the Owner / accountant has reviewed from
 * scripts/checkExportCostDoubleCount.js (group A).
 *
 * For each confirmed cost row it posts ONE signed-delta journal that takes the
 * duplicate back out of the books — Dr 2010 Supplier Payable / Cr the expense
 * account the cost was accrued to (6000) — and writes the cost's unpaid payable
 * off (status 'Written Off', outstanding 0) so Money Out cannot pay it. The
 * original journal, the cost row and the payable row are never edited away or
 * deleted (signed-delta rule; the shipment COGS stays the one rice cost).
 *
 * Refuses (and reports) a cost that is not rice / raw_rice, whose order has not
 * shipped with a locked COGS, or that is partly / fully PAID (money went out:
 * that needs a human). Idempotent: a cost already corrected is skipped.
 *
 * DRY RUN by default. Writes only with APPLY=1.
 *
 *   COST_IDS=12,15 node scripts/correctExportRiceDoubleCount.js          # dry run
 *   COST_IDS=12,15 APPLY=1 node scripts/correctExportRiceDoubleCount.js  # post
 */
const db = require('../src/config/database');
const accountingService = require('../src/modules/accounting/accounting.service');

const APPLY = process.env.APPLY === '1';
const SHIPPED = ['Shipped', 'Arrived', 'Closed'];
const REF_TYPE = 'Export Order Cost Correction';
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function main() {
  const ids = String(process.env.COST_IDS || '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
  if (!ids.length) {
    console.log('Set COST_IDS to the owner-confirmed cost ids (comma separated). Nothing to do.');
    return 0;
  }
  console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'} — ${ids.length} cost id(s)`);
  const [ap, exp] = await Promise.all([
    db('chart_of_accounts').where({ code: '2010' }).first(),
    db('chart_of_accounts').where({ code: '6000' }).first(),
  ]);
  if (!ap || !exp) throw new Error('chart of accounts is missing 2010 / 6000');

  const counts = { corrected: 0, wouldCorrect: 0, skipped: 0, refused: 0 };
  for (const id of ids) {
    // Each cost in its own transaction: one refusal never rolls back another.
    // eslint-disable-next-line no-await-in-loop
    await db.transaction(async (trx) => {
      const c = await trx('export_order_costs').where({ id }).forUpdate().first();
      const o = c ? await trx('export_orders').where({ id: c.order_id }).first() : null;
      const cat = String(c?.category || '').toLowerCase();
      const why = !c ? 'not found'
        : !['rice', 'raw_rice'].includes(cat) ? `category '${c.category}' is not rice`
          : !(o && SHIPPED.includes(o.status) && parseFloat(o.inventory_cogs_total_pkr) > 0) ? 'order has not shipped with a locked COGS'
            : parseFloat(c.paid_amount) > 0 ? 'cost is partly/fully paid — needs manual handling'
              : null;
      if (why) { counts.refused += 1; console.log(`  cost #${id}: REFUSED — ${why}`); return; }

      const refNo = `cost #${c.id}`;
      const done = await trx('journal_entries').where({ ref_type: REF_TYPE, ref_no: refNo, status: 'Posted' }).first('id');
      if (done) { counts.skipped += 1; console.log(`  cost #${id}: already corrected (journal #${done.id})`); return; }
      const payable = await trx('payables').where({ source_table: 'export_order_costs', source_id: c.id }).first();
      if (payable && parseFloat(payable.paid_amount) > 0) {
        counts.refused += 1; console.log(`  cost #${id}: REFUSED — its payable is partly/fully paid`); return;
      }
      const amt = round2(parseFloat(c.base_amount_pkr) || parseFloat(c.amount) || 0);
      if (!(amt > 0)) { counts.skipped += 1; console.log(`  cost #${id}: zero amount, nothing to correct`); return; }
      if (!APPLY) { counts.wouldCorrect += 1; console.log(`  cost #${id} (order #${o.id}): would post Dr 2010 / Cr 6000 and write off payable ${payable ? `#${payable.id}` : '(none)'}`); return; }

      const je = await accountingService.createJournal(trx, {
        date: new Date().toISOString().slice(0, 10),
        entity: 'export',
        refType: REF_TYPE,
        refNo,
        description: `Reverse duplicate rice cost ${refNo} on ${o.order_no} — the rice is costed by shipment COGS (P2-05)`,
        currency: 'PKR', fxRate: 1, isAuto: true, userId: null,
        partyType: c.supplier_id ? 'supplier' : null,
        partyId: c.supplier_id || null,
        lines: [
          { account_id: ap.id, account: ap.name, debit: amt, credit: 0, narration: `DR 2010 ${ap.name} — duplicate rice cost ${refNo}` },
          { account_id: exp.id, account: exp.name, debit: 0, credit: amt, narration: `CR 6000 ${exp.name} — duplicate rice cost ${refNo}` },
        ],
      });
      if (je?.id) await accountingService.postJournal(trx, je.id);
      if (payable) {
        await trx('payables').where({ id: payable.id }).update({
          status: 'Written Off', outstanding: 0,
          notes: [payable.notes, `Written off: duplicate of shipment COGS (P2-05, journal #${je?.id})`].filter(Boolean).join(' — '),
          updated_at: trx.fn.now(),
        });
      }
      counts.corrected += 1;
      console.log(`  cost #${id}: corrected (journal #${je?.id})`);
    });
  }
  console.log(`Summary: ${JSON.stringify(counts)}`);
  return 0;
}

main()
  .then((code) => db.destroy().then(() => process.exit(code)))
  .catch((err) => {
    console.error('Correction failed:', err.message);
    db.destroy().finally(() => process.exit(1));
  });
