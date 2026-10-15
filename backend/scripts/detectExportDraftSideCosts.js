/**
 * READ-ONLY: find export-order side costs and material requests the old
 * behaviour left behind (P3-18 / EXP-17, EXP-40).
 *
 * Before the fix, the Create Export Order form posted its printed-bag orders
 * and pallet cost (payable + Dr 6000 / Cr 2010) straight after saving — for a
 * Draft too — and a cancelled order's packing-material purchase requirements
 * stayed open. Findings, by kind:
 *
 *   draft_printed_bag    a printed-bag order on an order still in Draft.
 *                        unpaid → correctable (correctExportDraftSideCosts.js
 *                        voids it by a signed delta and holds it on the draft
 *                        so Submit posts it again); paid → Owner review only.
 *   draft_cost           an export_order_costs bill (e.g. the pallet cost) on a
 *                        Draft. REVIEW ONLY — submit the order if it is real,
 *                        or cancel the draft (the cancel flow keeps the bill
 *                        payable for vendor review). A cost row has no void
 *                        status and many reports read it, so it is not edited.
 *   cancelled_draft_side a printed-bag order or cost bill with an open payable
 *                        on an order cancelled straight from Draft. REVIEW ONLY.
 *   open_pr_cancelled    a pending / approved purchase requirement raised for
 *                        an order that is now Cancelled → correctable (the
 *                        script cancels it, Finance is told about approved ones).
 *
 * Output: counts + order / record IDs only — no names, no amounts.
 *   node scripts/detectExportDraftSideCosts.js
 * Runbook: docs/runbooks/export-draft-side-costs.md
 */

const OPEN_PAYABLE = ['Pending', 'Partial', 'Overdue'];

async function payableFor(q, table, id) {
  return q('payables').where({ source_table: table, source_id: id }).first();
}

/** Every finding. `orderIds` narrows to those orders (the correction re-checks under lock). */
async function detect(q, { orderIds = null } = {}) {
  const findings = [];
  const scope = (query, col) => (orderIds ? query.whereIn(col, orderIds) : query);

  const draftBags = await scope(q('printed_bag_orders as p')
    .join('export_orders as o', 'o.id', 'p.order_id')
    .where('o.status', 'Draft').whereNot('p.status', 'Cancelled')
    .select('p.id', 'p.order_id', 'p.paid_amount'), 'p.order_id').orderBy('p.id');
  for (const b of draftBags) {
    const pay = await payableFor(q, 'printed_bag_orders', b.id);
    const paid = (Number(b.paid_amount) || 0) > 0.01 || (pay && (Number(pay.paid_amount) || 0) > 0.01);
    findings.push({ kind: 'draft_printed_bag', orderId: b.order_id, recordId: b.id, payableId: pay?.id || null, correctable: !paid, paid: !!paid });
  }

  const draftCosts = await scope(q('export_order_costs as c')
    .join('export_orders as o', 'o.id', 'c.order_id')
    .where('o.status', 'Draft').select('c.id', 'c.order_id'), 'c.order_id').orderBy('c.id');
  for (const c of draftCosts) {
    const pay = await payableFor(q, 'export_order_costs', c.id);
    findings.push({ kind: 'draft_cost', orderId: c.order_id, recordId: c.id, payableId: pay?.id || null, correctable: false });
  }

  // Orders cancelled straight from Draft.
  const fromDraft = await scope(q('export_order_status_history as h')
    .join('export_orders as o', 'o.id', 'h.order_id')
    .where({ 'h.from_status': 'Draft', 'h.to_status': 'Cancelled', 'o.status': 'Cancelled' })
    .distinct('h.order_id'), 'h.order_id');
  for (const { order_id: orderId } of fromDraft) {
    const bags = await q('printed_bag_orders').where({ order_id: orderId }).whereNot('status', 'Cancelled').pluck('id');
    const costs = await q('export_order_costs').where({ order_id: orderId }).pluck('id');
    for (const [table, list] of [['printed_bag_orders', bags], ['export_order_costs', costs]]) {
      for (const id of list) {
        const pay = await payableFor(q, table, id);
        if (pay && OPEN_PAYABLE.includes(pay.status)) {
          findings.push({ kind: 'cancelled_draft_side', orderId, recordId: id, table, payableId: pay.id, correctable: false });
        }
      }
    }
  }

  const prs = await scope(q('purchase_requirements as r')
    .join('export_orders as o', 'o.order_no', 'r.linked_ref')
    .where('o.status', 'Cancelled').whereIn('r.status', ['pending', 'approved'])
    .select('r.id', 'r.status', 'o.id as order_id'), 'o.id').orderBy('r.id');
  for (const r of prs) {
    findings.push({ kind: 'open_pr_cancelled', orderId: r.order_id, recordId: r.id, approved: r.status === 'approved', correctable: true });
  }
  return findings;
}

function summarize(findings) {
  const by = (k) => findings.filter((f) => f.kind === k);
  return {
    draftBagsUnpaid: by('draft_printed_bag').filter((f) => f.correctable),
    draftBagsPaid: by('draft_printed_bag').filter((f) => !f.correctable),
    draftCosts: by('draft_cost'),
    cancelledDraftSide: by('cancelled_draft_side'),
    openPrsCancelled: by('open_pr_cancelled'),
  };
}

async function main(log = console.log) {
  const db = require('../src/config/database');
  try {
    const s = summarize(await detect(db));
    log('Export draft side costs / material requests (P3-18) — read-only');
    log(`  printed-bag orders on Drafts, unpaid (correctable): ${s.draftBagsUnpaid.length}`);
    for (const f of s.draftBagsUnpaid) log(`    order #${f.orderId} printed_bag_order #${f.recordId} payable #${f.payableId ?? '-'}`);
    log(`  printed-bag orders on Drafts, PAID (Owner review): ${s.draftBagsPaid.length}`);
    for (const f of s.draftBagsPaid) log(`    order #${f.orderId} printed_bag_order #${f.recordId} payable #${f.payableId ?? '-'}`);
    log(`  cost bills on Drafts (review — submit or cancel the draft): ${s.draftCosts.length}`);
    for (const f of s.draftCosts) log(`    order #${f.orderId} export_order_cost #${f.recordId} payable #${f.payableId ?? '-'}`);
    log(`  open side payables on orders cancelled from Draft (review): ${s.cancelledDraftSide.length}`);
    for (const f of s.cancelledDraftSide) log(`    order #${f.orderId} ${f.table} #${f.recordId} payable #${f.payableId}`);
    log(`  open purchase requirements on cancelled orders (correctable): ${s.openPrsCancelled.length}`);
    for (const f of s.openPrsCancelled) log(`    order #${f.orderId} purchase_requirement #${f.recordId}${f.approved ? ' (approved)' : ''}`);
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('detectExportDraftSideCosts failed:', err.message);
    process.exit(1);
  });
}

module.exports = { detect, summarize, main };
