/**
 * Correct what the old export create form left behind (P3-18 / EXP-17, EXP-40).
 * Reads the findings of detectExportDraftSideCosts.js and fixes only the
 * correctable kinds, each in its own transaction, re-checked under a row lock:
 *
 *   draft_printed_bag (unpaid) — ONLY for the orders listed in ORDER_IDS (the
 *     reviewed list): a SIGNED-DELTA journal reverses the bag bill
 *     (Dr 2010 / Cr 6000, 'Printed Bags', party-stamped like the original);
 *     the payable becomes 'Reversed' with outstanding 0 (original_amount kept);
 *     the printed-bag order becomes 'Cancelled'; and its spec is put back on
 *     the draft (export_orders.draft_side_costs) so Submit posts it again.
 *     Nothing is deleted and no journal is reversed.
 *   open_pr_cancelled — pending / approved purchase requirements of a
 *     cancelled order are cancelled (Finance is told about approved ones).
 *
 * Paid bag orders, cost bills on drafts and side payables of orders cancelled
 * from Draft are LISTED for review, never touched.
 *
 * Dry run by default (prints what it would do, writes nothing):
 *   node scripts/correctExportDraftSideCosts.js
 * Write (after review + backup, see the runbook):
 *   FIX_EXPORT_DRAFT_SIDE_COSTS=1 ORDER_IDS=12,15 node scripts/correctExportDraftSideCosts.js
 * Output: counts + IDs only.
 * Runbook: docs/runbooks/export-draft-side-costs.md
 */
const { detect, summarize } = require('./detectExportDraftSideCosts');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function voidDraftBag(trx, pboId) {
  const printedBags = require('../src/modules/exportOrders/printedBags.service');
  const pbo = await trx('printed_bag_orders').where({ id: pboId }).forUpdate().first();
  if (!pbo || pbo.status === 'Cancelled') return { skipped: 'gone' };
  const order = await trx('export_orders').where({ id: pbo.order_id }).forUpdate().first();
  if (!order || order.status !== 'Draft') return { skipped: 'not_draft' };
  const pay = await trx('payables').where({ source_table: 'printed_bag_orders', source_id: pbo.id }).forUpdate().first();
  if ((Number(pbo.paid_amount) || 0) > 0.01 || (pay && (Number(pay.paid_amount) || 0) > 0.01)) return { skipped: 'paid' };

  const total = r2(pbo.total_amount);
  await printedBags.postCostDelta(trx, { delta: -total, order, pbo, vendorId: pbo.vendor_id, userId: null, reduced: true });
  const note = 'P3-18 correction: posted while the order was a Draft — voided by delta, held on the draft until Submit.';
  if (pay) {
    await trx('payables').where({ id: pay.id }).update({
      status: 'Reversed', outstanding: 0, notes: `${pay.notes ? `${pay.notes} | ` : ''}${note}`, updated_at: trx.fn.now(),
    });
  }
  await trx('printed_bag_orders').where({ id: pbo.id }).update({
    status: 'Cancelled', notes: `${pbo.notes ? `${pbo.notes} | ` : ''}${note}`, updated_at: trx.fn.now(),
  });
  const held = (typeof order.draft_side_costs === 'string' ? JSON.parse(order.draft_side_costs) : order.draft_side_costs)
    || { printed_bags: [], pallet_cost: null };
  held.printed_bags = [...(held.printed_bags || []), {
    bag_type_id: pbo.bag_type_id, bag_type_name: pbo.bag_type_name,
    bag_size_kg: pbo.bag_size_kg != null ? Number(pbo.bag_size_kg) : null, vendor_id: pbo.vendor_id,
    quantity: pbo.quantity, unit_cost: Number(pbo.unit_cost), printing: pbo.printing,
    brand_marking: pbo.brand_marking, notes: pbo.notes,
  }];
  await trx('export_orders').where({ id: order.id }).update({ draft_side_costs: JSON.stringify(held) });
  return { corrected: true };
}

async function cancelOpenPr(trx, prId) {
  const notificationService = require('../src/services/notificationService');
  const pr = await trx('purchase_requirements').where({ id: prId }).forUpdate().first();
  if (!pr || !['pending', 'approved'].includes(pr.status)) return { skipped: 'gone' };
  const order = await trx('export_orders').where({ order_no: pr.linked_ref }).first('status');
  if (!order || order.status !== 'Cancelled') return { skipped: 'order_not_cancelled' };
  await trx('purchase_requirements').where({ id: pr.id }).update({
    status: 'cancelled', cancelled_at: trx.fn.now(), review_required: false,
    notes: `${pr.notes ? `${pr.notes}\n` : ''}Cancelled: its export order was cancelled (P3-18 correction).`,
    updated_at: trx.fn.now(),
  });
  if (pr.status === 'approved') {
    await notificationService.notifyFinance(trx, {
      title: 'Purchase request cancelled',
      message: `${pr.pr_no}: ${pr.item_name} — cancelled, do not purchase.`,
      linkedRef: pr.pr_no,
    });
  }
  return { corrected: true };
}

const parseIds = (s) => String(s || '').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => n > 0);

async function main(env = process.env, log = console.log) {
  const write = env.FIX_EXPORT_DRAFT_SIDE_COSTS === '1';
  const reviewed = new Set(parseIds(env.ORDER_IDS));
  const db = require('../src/config/database');
  try {
    const s = summarize(await detect(db));
    log(`${write ? 'WRITE' : 'DRY RUN'} — draft bag orders unpaid: ${s.draftBagsUnpaid.length} (reviewed orders: ${reviewed.size}); `
      + `paid (Owner review): ${s.draftBagsPaid.length}; draft cost bills (review): ${s.draftCosts.length}; `
      + `cancelled-from-draft side payables (review): ${s.cancelledDraftSide.length}; open PRs on cancelled orders: ${s.openPrsCancelled.length}`);
    for (const f of s.draftBagsPaid) log(`  OWNER REVIEW order #${f.orderId} printed_bag_order #${f.recordId} — paid, not corrected`);
    for (const f of s.draftCosts) log(`  REVIEW order #${f.orderId} export_order_cost #${f.recordId} — submit or cancel the draft`);
    for (const f of s.cancelledDraftSide) log(`  REVIEW order #${f.orderId} ${f.table} #${f.recordId} payable #${f.payableId}`);

    let bags = 0; let prs = 0;
    for (const f of s.draftBagsUnpaid) {
      if (!reviewed.has(f.orderId)) { log(`  not in ORDER_IDS — skipped order #${f.orderId} printed_bag_order #${f.recordId}`); continue; }
      if (!write) { log(`  would void printed_bag_order #${f.recordId} (order #${f.orderId}) by delta and hold it on the draft`); continue; }
      const r = await db.transaction((trx) => voidDraftBag(trx, f.recordId));
      if (r.corrected) { bags += 1; log(`  voided printed_bag_order #${f.recordId} (order #${f.orderId})`); }
      else log(`  skipped printed_bag_order #${f.recordId}: ${r.skipped}`);
    }
    for (const f of s.openPrsCancelled) {
      if (!write) { log(`  would cancel purchase_requirement #${f.recordId} (order #${f.orderId})`); continue; }
      const r = await db.transaction((trx) => cancelOpenPr(trx, f.recordId));
      if (r.corrected) { prs += 1; log(`  cancelled purchase_requirement #${f.recordId}`); }
      else log(`  skipped purchase_requirement #${f.recordId}: ${r.skipped}`);
    }
    if (write) log(`corrected: ${bags} printed-bag order(s), ${prs} purchase requirement(s)`);
    else log('Nothing written. Set FIX_EXPORT_DRAFT_SIDE_COSTS=1 and ORDER_IDS=<reviewed ids> to apply (see runbook).');
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('correctExportDraftSideCosts failed:', err.message);
    process.exit(1);
  });
}

module.exports = { voidDraftBag, cancelOpenPr, main };
