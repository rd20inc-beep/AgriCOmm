/**
 * One-off backfill — ensure every export_order_costs row with amount > 0
 * has a 1:1 row in payables so it surfaces on /finance/money-out alongside
 * mill-store purchases and business expenses.
 *
 * Idempotent — pairs payables to source rows by (source_table='export_order_costs',
 * source_id=cost.id), so re-running this is a no-op for rows that already
 * have a match.
 */
require('dotenv').config();
const db = require('../src/config/database');

async function main() {
  const costs = await db('export_order_costs as eoc')
    .join('export_orders as eo', 'eoc.order_id', 'eo.id')
    .where('eoc.amount', '>', 0)
    .select('eoc.id', 'eoc.category', 'eoc.amount', 'eoc.base_amount_pkr', 'eoc.fx_rate', 'eoc.paid_amount', 'eoc.payment_status', 'eoc.notes', 'eo.order_no');

  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of costs) {
    const existing = await db('payables')
      .where({ source_table: 'export_order_costs', source_id: c.id })
      .first();
    if (existing) { skipped += 1; continue; }

    const amtPkr = parseFloat(c.base_amount_pkr) || (parseFloat(c.amount) || 0) * (parseFloat(c.fx_rate) || 1);
    if (amtPkr <= 0) { skipped += 1; continue; }

    const paidAmt = parseFloat(c.paid_amount) || 0;
    const status = paidAmt >= amtPkr - 0.01 ? 'Paid' : (paidAmt > 0 ? 'Partial' : 'Pending');
    const refLabel = `${c.order_no} ${c.category}`;

    try {
      await db.transaction(async (trx) => {
        const last = await trx('payables').where('pay_no', 'like', 'PAY-EOC%').orderBy('id', 'desc').first();
        const nextSeq = last ? (parseInt(String(last.pay_no).replace(/^PAY-EOC/, ''), 10) || 0) + 1 : 1;
        const payNo = `PAY-EOC${String(nextSeq).padStart(4, '0')}`;
        await trx('payables').insert({
          pay_no: payNo,
          entity: 'export',
          category: c.category || 'export_cost',
          supplier_id: null,
          linked_ref: refLabel,
          original_amount: amtPkr,
          paid_amount: paidAmt,
          outstanding: Math.max(0, amtPkr - paidAmt),
          currency: 'PKR',
          due_date: new Date().toISOString().slice(0, 10),
          status,
          source_table: 'export_order_costs',
          source_id: c.id,
          payable_type: 'expense',
          notes: c.notes || `Export order cost ${refLabel} (backfilled)`,
        });
      });
      posted += 1;
      console.log(`  ✓ ${refLabel.padEnd(28)} Rs ${Math.round(amtPkr).toLocaleString()} (${status})`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${refLabel} failed: ${err.message}`);
    }
  }

  console.log(`\nDone. posted=${posted} skipped=${skipped} failed=${failed} (of ${costs.length} costs).`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
