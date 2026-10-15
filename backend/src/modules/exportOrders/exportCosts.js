/**
 * Export order costs (P2-05) — what the order's own vendors bill: freight,
 * clearing, loading, bags, inspection… one row per bill, in PKR.
 *
 *   recordOrderCost      a bill: the row, its accrual journal (Dr expense /
 *                        Cr 2010) and its payable — all in the caller's
 *                        transaction; any failure throws so nothing half-saves.
 *   derivedMillingCosts  the milling batch(es) behind the order, costed from
 *                        the batch's own milling_costs at read time.
 *
 * Rice is NOT an order expense. The finished rice is costed at shipment from
 * stock (Dr 5020 / Cr 1230); a manual 'rice' cost posted Dr 6000 / Cr 2010 for
 * the same rice and counted it twice. Milling is the batch's cost — it used to
 * be copied onto the order at completion, in the order's currency (÷ the booked
 * rate, or a literal 280) and never refreshed. Both are refused here.
 */
const accountingService = require('../accounting/accounting.service');
const { ledgerFailure, missingAccounts } = require('../../shared/ledgerFailure');
const { nextDocNo } = require('../../utils/docNumber');

const INTERNAL_COST_CATEGORIES = ['rice', 'raw_rice', 'milling'];
const isInternalCostCategory = (c) => INTERNAL_COST_CATEGORIES.includes(String(c || '').trim().toLowerCase());

// A bill cannot land on an order that is finished with.
const COST_LOCKED_STATUSES = ['Closed', 'Cancelled'];

// Export-order costs have purpose-built accounts in the chart; anything else
// is 6000 Operating Expenses.
const COST_CATEGORY_ACCOUNT = {
  freight: '6010',
  clearing: '6020',
  loading: '6030',
  insurance: '6050',
  commission: '6060',
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const httpError = (message, statusCode = 400) => { const e = new Error(message); e.statusCode = statusCode; return e; };

/**
 * Record one vendor bill against an export order. `order` is the order row
 * (read under lock by the caller). Returns the export_order_costs row.
 */
async function recordOrderCost(trx, {
  order, category, amount, currency = 'PKR', fxRate = null, notes = null,
  supplierId = null, vendorName = null, billRef = null, userId = null,
}) {
  const cat = String(category || '').trim().toLowerCase();
  if (!cat) throw httpError('A cost category is required.');
  if (isInternalCostCategory(cat)) {
    throw httpError('Rice and milling are costed from stock at shipment and from the milling batch — they cannot be added as an order expense.');
  }
  if (COST_LOCKED_STATUSES.includes(order.status)) {
    throw httpError(`Cannot add a cost to an order in '${order.status}' status.`);
  }
  // A Draft carries no vendor bills (P3-18, EXP-17): it may be abandoned, and
  // its payable stayed behind. The create form's pallet cost waits on the draft
  // (export_orders.draft_side_costs) and is posted at Submit.
  if (order.status === 'Draft') {
    throw httpError('This order is still a Draft. Submit it first — costs are posted once the order is live.', 409);
  }
  const rawAmt = round2(amount);
  if (!(rawAmt > 0)) throw httpError('The amount must be greater than zero.');

  // Costs are stored and reported in PKR. A foreign bill is converted at the
  // rate given, else the order's booked rate; with neither it is refused —
  // never a guessed rate (D-10).
  const cur = String(currency || 'PKR').toUpperCase();
  let rate = 1;
  if (cur !== 'PKR') {
    rate = parseFloat(fxRate) > 0 ? parseFloat(fxRate)
      : (parseFloat(order.booked_fx_rate) || parseFloat(order.advance_fx_rate) || 0);
    if (!(rate > 0)) throw httpError(`An FX rate is required to record a ${cur} cost (no booked rate on the order).`);
  }
  const amtPkr = round2(rawAmt * rate);

  let supplier = null;
  if (supplierId) {
    supplier = await trx('suppliers').where({ id: supplierId }).first('id', 'name');
    if (!supplier) throw httpError('Vendor (supplier) not found.', 404);
  }
  const vendor = (supplier && supplier.name) || (vendorName && String(vendorName).trim()) || null;
  const costNote = [
    notes || null,
    cur !== 'PKR' ? `${cur} ${rawAmt.toLocaleString()} @ ${rate}` : null,
  ].filter(Boolean).join(' — ') || null;

  const [row] = await trx('export_order_costs').insert({
    order_id: order.id,
    category: cat,
    amount: amtPkr,
    currency: 'PKR',
    base_amount_pkr: amtPkr,
    fx_rate: 1,
    notes: costNote,
    supplier_id: supplier ? supplier.id : null,
    vendor_name: vendor,
    bill_ref: billRef ? String(billRef).trim() : null,
    created_by: userId || null,
  }).returning('*');

  const refLabel = `${order.order_no} ${cat}`;
  const billLabel = [vendor, billRef ? `bill ${billRef}` : null, `cost #${row.id}`].filter(Boolean).join(', ');

  // Accrual: Dr the category's expense account / Cr 2010 Supplier Payable. The
  // payment later clears 2010. A bill whose journal cannot post is not saved.
  const wantCode = COST_CATEGORY_ACCOUNT[cat] || '6000';
  const expAcc = (wantCode !== '6000' ? await trx('chart_of_accounts').where({ code: wantCode }).first() : null)
    || await trx('chart_of_accounts').where({ code: '6000' }).first();
  const apAcc = await trx('chart_of_accounts').where({ code: '2010' }).first();
  if (!expAcc || !apAcc) throw missingAccounts([wantCode, '2010'], 'The cost');
  try {
    const journal = await accountingService.createJournal(trx, {
      date: new Date().toISOString().slice(0, 10),
      entity: 'export',
      refType: 'Export Order Cost',
      refNo: refLabel,
      description: `Cost recorded Rs ${Math.round(amtPkr).toLocaleString()} for ${refLabel} (${billLabel})`,
      currency: 'PKR',
      fxRate: 1,
      isAuto: true,
      userId: userId || null,
      partyType: supplier ? 'supplier' : null,
      partyId: supplier ? supplier.id : null,
      lines: [
        { account_id: expAcc.id, account: expAcc.name, debit: amtPkr, credit: 0, narration: `DR ${expAcc.code} ${expAcc.name} — ${refLabel}` },
        { account_id: apAcc.id, account: apAcc.name, debit: 0, credit: amtPkr, narration: `CR ${apAcc.code} ${apAcc.name} — ${refLabel}${vendor ? ` (${vendor})` : ''}` },
      ],
    });
    if (journal?.id) await accountingService.postJournal(trx, journal.id);
  } catch (e) {
    throw ledgerFailure(e, 'The cost');
  }

  // The bill's payable — what Money Out pays (1:1 with the cost row).
  const payNo = await nextDocNo(trx, { table: 'payables', column: 'pay_no', prefix: 'PAY-EOC', pad: 4 });
  await trx('payables').insert({
    pay_no: payNo,
    entity: 'export',
    category: cat,
    supplier_id: supplier ? supplier.id : null,
    linked_ref: refLabel,
    original_amount: amtPkr,
    paid_amount: 0,
    outstanding: amtPkr,
    currency: 'PKR',
    due_date: new Date().toISOString().slice(0, 10),
    status: 'Pending',
    source_table: 'export_order_costs',
    source_id: row.id,
    payable_type: 'expense',
    notes: [`Export order cost ${refLabel}`, billLabel, notes].filter(Boolean).join(' — '),
  });

  return row;
}

/**
 * The milling batch(es) linked to an order, costed from each batch's own
 * milling_costs now (PKR) — so the figure follows every later cost edit
 * instead of being a stale copy. Returned in the shape of a cost row, flagged
 * derived (never stored, never paid from here — the batch's own costs carry
 * their payables).
 */
async function derivedMillingCosts(conn, orderId) {
  const rows = await conn('milling_batches as mb')
    .leftJoin('milling_costs as mc', 'mc.batch_id', 'mb.id')
    .where('mb.linked_export_order_id', orderId)
    .where('mb.is_service_milling', false)
    .whereNotIn('mb.status', ['Cancelled', 'Rejected'])
    .groupBy('mb.id', 'mb.batch_no', 'mb.status')
    .select('mb.id', 'mb.batch_no', 'mb.status')
    .sum({ total: 'mc.amount' });
  return rows
    .map((b) => ({ ...b, total: round2(parseFloat(b.total) || 0) }))
    .filter((b) => b.total > 0)
    .map((b) => ({
      id: `batch-${b.id}`,
      order_id: orderId,
      category: 'milling',
      amount: b.total,
      currency: 'PKR',
      base_amount_pkr: b.total,
      fx_rate: 1,
      notes: `From milling batch ${b.batch_no} (${b.status}) — live batch cost`,
      derived: true,
      source: 'milling_batch',
      batch_id: b.id,
      batch_no: b.batch_no,
    }));
}

module.exports = {
  recordOrderCost, derivedMillingCosts, isInternalCostCategory,
  INTERNAL_COST_CATEGORIES, COST_LOCKED_STATUSES, COST_CATEGORY_ACCOUNT,
};
