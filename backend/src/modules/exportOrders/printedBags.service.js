const db = require('../../config/database');
const accountingService = require('../../services/accountingService');

// Printed-bag procurement for export orders. Each order owes a bag vendor, so it
// mirrors the export-order-cost money pattern: a 1:1 payable
// (source_table='printed_bag_orders') + a GL bill (Dr 6000 Operating Expenses /
// Cr 2010 Supplier Payable, entity 'export'). Edits post a signed DELTA journal
// (never reverse+repost — that double-counts the trial balance).

const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

async function nextPboNo(trx) {
  const last = await trx('printed_bag_orders')
    .where('pbo_no', 'like', 'PBO-%')
    .orderBy('id', 'desc')
    .first('pbo_no');
  const seq = last ? (parseInt(String(last.pbo_no).replace(/^PBO-/, ''), 10) || 0) + 1 : 1;
  return `PBO-${String(seq).padStart(4, '0')}`;
}

async function nextPboPayNo(trx) {
  const last = await trx('payables').where('pay_no', 'like', 'PAY-PBO%').orderBy('id', 'desc').first('pay_no');
  const seq = last ? (parseInt(String(last.pay_no).replace(/^PAY-PBO/, ''), 10) || 0) + 1 : 1;
  return `PAY-PBO${String(seq).padStart(4, '0')}`;
}

// Post a signed cost-recognition journal for `delta` PKR against the printed-bag
// payable: +delta => Dr 6000 Operating Expenses / Cr 2010 Supplier Payable;
// -delta swaps the sides. Stamped to the vendor so it lands on their statement.
// Silently skipped if the GL chart isn't seeded.
async function postCostDelta(trx, { delta, order, pbo, vendorId, userId, reduced }) {
  if (Math.abs(delta) <= 0.01) return;
  const opExp = await trx('chart_of_accounts').where({ code: '6000' }).first();
  const supplierPayable = await trx('chart_of_accounts').where({ code: '2010' }).first();
  if (!opExp || !supplierPayable) {
    console.warn(`printedBags: chart_of_accounts missing 6000/2010 — journal skipped for ${pbo.pbo_no}`);
    return;
  }
  const up = delta > 0;
  const amt = Math.abs(delta);
  const debitAcc = up ? opExp : supplierPayable;
  const creditAcc = up ? supplierPayable : opExp;
  const refLabel = `${order.order_no} ${pbo.pbo_no}`;
  const journal = await accountingService.createJournal(trx, {
    date: new Date().toISOString().slice(0, 10),
    entity: 'export',
    refType: 'Printed Bags',
    refNo: refLabel,
    description: reduced
      ? `Printed bags cost adjustment Rs ${Math.round(amt).toLocaleString()} for ${refLabel} (reduced)`
      : `Printed bags cost Rs ${Math.round(amt).toLocaleString()} for ${refLabel}`,
    currency: 'PKR',
    fxRate: 1,
    isAuto: true,
    userId: userId || null,
    partyType: vendorId ? 'supplier' : null,
    partyId: vendorId || null,
    lines: [
      { account_id: debitAcc.id, account: debitAcc.name, debit: amt, credit: 0, narration: `DR ${debitAcc.code} ${debitAcc.name} — ${refLabel}` },
      { account_id: creditAcc.id, account: creditAcc.name, debit: 0, credit: amt, narration: `CR ${creditAcc.code} ${creditAcc.name} — ${refLabel}` },
    ],
  });
  if (journal?.id) await accountingService.postJournal(trx, journal.id);
}

// Upsert the 1:1 payable so the order shows on /finance/money-out and the
// vendor's statement, keeping outstanding in step with what's already paid.
async function syncPayable(trx, { pbo, order, vendorId, total, refLabel, notes }) {
  const existing = await trx('payables')
    .where({ source_table: 'printed_bag_orders', source_id: pbo.id })
    .first();
  const paid = existing ? (parseFloat(existing.paid_amount) || 0) : 0;
  const outstanding = Math.max(0, round2(total - paid));
  const status = total - paid <= 0.01 ? 'Paid' : (paid > 0 ? 'Partial' : 'Pending');
  if (existing) {
    await trx('payables').where({ id: existing.id }).update({
      supplier_id: vendorId || null,
      category: 'Printed Bags',
      linked_ref: refLabel,
      original_amount: total,
      outstanding,
      status,
      notes: notes || existing.notes,
      updated_at: trx.fn.now(),
    });
  } else {
    await trx('payables').insert({
      pay_no: await nextPboPayNo(trx),
      entity: 'export',
      payable_type: 'vendor',
      category: 'Printed Bags',
      supplier_id: vendorId || null,
      linked_ref: refLabel,
      original_amount: total,
      paid_amount: 0,
      outstanding: total,
      currency: 'PKR',
      due_date: new Date().toISOString().slice(0, 10),
      status: total <= 0.01 ? 'Paid' : 'Pending',
      source_table: 'printed_bag_orders',
      source_id: pbo.id,
      notes: notes || `Printed bags for export order ${order.order_no}`,
    });
  }
}

async function list(orderId) {
  const rows = await db('printed_bag_orders as p')
    .leftJoin('suppliers as s', 's.id', 'p.vendor_id')
    .leftJoin('bag_types as b', 'b.id', 'p.bag_type_id')
    .where('p.order_id', orderId)
    .orderBy('p.id', 'desc')
    .select(
      'p.*',
      's.name as vendor_name',
      'b.name as bag_type_current_name',
    );
  // Attach the live payable money state (outstanding may have moved via payments).
  const ids = rows.map((r) => r.id);
  const pays = ids.length
    ? await db('payables').where({ source_table: 'printed_bag_orders' }).whereIn('source_id', ids)
      .select('source_id', 'original_amount', 'paid_amount', 'outstanding', 'status')
    : [];
  const payMap = {};
  for (const p of pays) payMap[p.source_id] = p;
  return rows.map((r) => {
    const pay = payMap[r.id];
    const total = parseFloat(r.total_amount) || 0;
    const paid = pay ? (parseFloat(pay.paid_amount) || 0) : (parseFloat(r.paid_amount) || 0);
    return {
      ...r,
      paid_amount: paid,
      outstanding: pay ? (parseFloat(pay.outstanding) || 0) : Math.max(0, total - paid),
      payment_status: paid >= total - 0.01 && total > 0 ? 'Paid' : (paid > 0 ? 'Partial' : 'Unpaid'),
    };
  });
}

async function create(orderId, body, userId) {
  const order = await db('export_orders').where({ id: orderId }).first();
  if (!order) { const e = new Error('Export order not found.'); e.statusCode = 404; throw e; }

  const quantity = parseInt(body.quantity, 10) || 0;
  const unitCost = parseFloat(body.unit_cost) || 0;
  if (quantity <= 0) { const e = new Error('Quantity (number of bags) must be greater than zero.'); e.statusCode = 400; throw e; }
  const total = round2(quantity * unitCost);
  const vendorId = body.vendor_id ? parseInt(body.vendor_id, 10) : null;

  return db.transaction(async (trx) => {
    const pboNo = await nextPboNo(trx);
    const [row] = await trx('printed_bag_orders').insert({
      pbo_no: pboNo,
      order_id: orderId,
      bag_type_id: body.bag_type_id ? parseInt(body.bag_type_id, 10) : null,
      bag_type_name: body.bag_type_name || null,
      bag_size_kg: body.bag_size_kg != null && body.bag_size_kg !== '' ? parseFloat(body.bag_size_kg) : null,
      printing: body.printing || null,
      brand_marking: body.brand_marking || null,
      vendor_id: vendorId,
      quantity,
      unit_cost: unitCost,
      total_amount: total,
      currency: 'PKR',
      status: 'Ordered',
      ordered_date: body.ordered_date || new Date().toISOString().slice(0, 10),
      paid_amount: 0,
      payment_status: 'Unpaid',
      notes: body.notes || null,
      created_by: userId || null,
    }).returning('*');

    const refLabel = `${order.order_no} ${pboNo}`;
    await syncPayable(trx, { pbo: row, order, vendorId, total, refLabel, notes: body.notes });
    await postCostDelta(trx, { delta: total, order, pbo: row, vendorId, userId, reduced: false });
    return row;
  });
}

async function update(id, body, userId) {
  return db.transaction(async (trx) => {
    const row = await trx('printed_bag_orders').where({ id }).first();
    if (!row) { const e = new Error('Printed bag order not found.'); e.statusCode = 404; throw e; }
    const order = await trx('export_orders').where({ id: row.order_id }).first();

    const quantity = body.quantity != null ? (parseInt(body.quantity, 10) || 0) : row.quantity;
    const unitCost = body.unit_cost != null ? (parseFloat(body.unit_cost) || 0) : parseFloat(row.unit_cost) || 0;
    if (quantity <= 0) { const e = new Error('Quantity must be greater than zero.'); e.statusCode = 400; throw e; }
    const newTotal = round2(quantity * unitCost);
    const oldTotal = parseFloat(row.total_amount) || 0;
    const vendorId = body.vendor_id !== undefined
      ? (body.vendor_id ? parseInt(body.vendor_id, 10) : null)
      : row.vendor_id;

    const [updated] = await trx('printed_bag_orders').where({ id }).update({
      bag_type_id: body.bag_type_id !== undefined ? (body.bag_type_id ? parseInt(body.bag_type_id, 10) : null) : row.bag_type_id,
      bag_type_name: body.bag_type_name !== undefined ? (body.bag_type_name || null) : row.bag_type_name,
      bag_size_kg: body.bag_size_kg !== undefined ? (body.bag_size_kg !== '' && body.bag_size_kg != null ? parseFloat(body.bag_size_kg) : null) : row.bag_size_kg,
      printing: body.printing !== undefined ? (body.printing || null) : row.printing,
      brand_marking: body.brand_marking !== undefined ? (body.brand_marking || null) : row.brand_marking,
      vendor_id: vendorId,
      quantity,
      unit_cost: unitCost,
      total_amount: newTotal,
      notes: body.notes !== undefined ? (body.notes || null) : row.notes,
      updated_at: trx.fn.now(),
    }).returning('*');

    const refLabel = `${order.order_no} ${row.pbo_no}`;
    await syncPayable(trx, { pbo: updated, order, vendorId, total: newTotal, refLabel, notes: updated.notes });
    await postCostDelta(trx, { delta: round2(newTotal - oldTotal), order, pbo: updated, vendorId, userId, reduced: newTotal < oldTotal });
    return updated;
  });
}

async function receive(id, body, userId) {
  return db.transaction(async (trx) => {
    const row = await trx('printed_bag_orders').where({ id }).first();
    if (!row) { const e = new Error('Printed bag order not found.'); e.statusCode = 404; throw e; }
    const receivedQty = body.received_qty != null ? parseInt(body.received_qty, 10) : row.quantity;
    const [updated] = await trx('printed_bag_orders').where({ id }).update({
      status: 'Received',
      received_qty: receivedQty,
      received_date: body.received_date || new Date().toISOString().slice(0, 10),
      updated_at: trx.fn.now(),
    }).returning('*');
    return updated;
  });
}

async function remove(id) {
  return db.transaction(async (trx) => {
    const row = await trx('printed_bag_orders').where({ id }).first();
    if (!row) { const e = new Error('Printed bag order not found.'); e.statusCode = 404; throw e; }
    const paid = parseFloat(row.paid_amount) || 0;
    const payable = await trx('payables').where({ source_table: 'printed_bag_orders', source_id: id }).first();
    const payablePaid = payable ? (parseFloat(payable.paid_amount) || 0) : 0;
    if (paid > 0.01 || payablePaid > 0.01) {
      const e = new Error('This printed-bag order has payments against it. Reverse the payment first, then delete.');
      e.statusCode = 409; throw e;
    }
    const order = await trx('export_orders').where({ id: row.order_id }).first();
    // Reverse the cost bill with a signed negative delta, then drop the payable.
    await postCostDelta(trx, { delta: -(parseFloat(row.total_amount) || 0), order, pbo: row, vendorId: row.vendor_id, userId: null, reduced: true });
    if (payable) await trx('payables').where({ id: payable.id }).del();
    await trx('printed_bag_orders').where({ id }).del();
    return { message: `Printed bag order ${row.pbo_no} deleted.` };
  });
}

module.exports = { list, create, update, receive, remove };
