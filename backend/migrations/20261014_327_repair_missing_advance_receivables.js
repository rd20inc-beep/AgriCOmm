// Repair: export orders whose advance % was raised from 0 after creation
// (finance audit C10 / R8 — prod EX-003, USD 3,172).
//
// update() recomputed advance_expected but only resynced receivables that
// already existed, so these orders have an advance owed with NO RCV-ADV row and
// financial_status still 'Not Required': the advance is missing from
// receivables and aging, and dispatch is not gated on it. The code path is fixed
// in the same change (update() now calls ensureOrderReceivables and re-derives
// financial_status).
//
// Guarded, so it touches only orders in exactly that state:
//   advance_expected > 0, advance_received = 0, financial_status 'Not Required',
//   status not Draft / Cancelled, and no Advance receivable for the order.
// For each it inserts the RCV-ADV receivable the order should have had (same
// shape as ensureOrderReceivables: Pending, order currency, booked rate) and
// sets financial_status = 'Advance Not Entered'. No journal is posted — a
// receivable row is not a GL entry, as at order create. Idempotent: a second run
// finds nothing.
//
// down() removes only the rows this repaired (marked in notes) that have not
// received any money, and puts their orders back to 'Not Required'.

const MARK = '(restored by migration 327)';

exports.up = async function up(knex) {
  const orders = await knex('export_orders as o')
    .where('o.advance_expected', '>', 0)
    .andWhere(function () { this.whereNull('o.advance_received').orWhere('o.advance_received', '<=', 0); })
    .andWhere('o.financial_status', 'Not Required')
    .whereNotIn('o.status', ['Draft', 'Cancelled'])
    .whereNotExists(function () {
      this.select(1).from('receivables as r').whereRaw('r.order_id = o.id').andWhere('r.type', 'Advance');
    })
    .select('o.*');

  for (const o of orders) {
    const amount = parseFloat(o.advance_expected);
    const rate = parseFloat(o.booked_fx_rate) || 280;
    const due = new Date();
    due.setDate(due.getDate() + 14);
    // eslint-disable-next-line no-await-in-loop
    await knex('receivables').insert({
      recv_no: `RCV-ADV-${o.order_no}`,
      entity: 'export',
      order_id: o.id,
      customer_id: o.customer_id,
      type: 'Advance',
      expected_amount: amount,
      received_amount: 0,
      outstanding: amount,
      due_date: due.toISOString().split('T')[0],
      status: 'Pending',
      currency: o.currency || 'USD',
      aging: 0,
      notes: `Advance ${o.advance_pct}% for order ${o.order_no} ${MARK}`,
      fx_rate: o.booked_fx_rate,
      base_amount_pkr: amount * rate,
    });
    // eslint-disable-next-line no-await-in-loop
    await knex('export_orders').where({ id: o.id }).update({ financial_status: 'Advance Not Entered', updated_at: knex.fn.now() });
    // eslint-disable-next-line no-console
    console.log(`[327] ${o.order_no}: RCV-ADV ${o.currency || 'USD'} ${amount} restored; financial_status → Advance Not Entered`);
  }
};

exports.down = async function down(knex) {
  const rows = await knex('receivables')
    .where('type', 'Advance')
    .andWhere('notes', 'like', `%${MARK}%`)
    .andWhere('received_amount', '<=', 0)
    .select('id', 'order_id');
  if (!rows.length) return;
  await knex('receivables').whereIn('id', rows.map((r) => r.id)).del();
  await knex('export_orders')
    .whereIn('id', rows.map((r) => r.order_id))
    .andWhere('financial_status', 'Advance Not Entered')
    .update({ financial_status: 'Not Required', updated_at: knex.fn.now() });
};
