// EX-003 back to 'Awaiting Advance' (owner decision 2026-10-14).
//
// EX-003 was submitted at 0% advance, so it went straight to 'Advance
// Received'. Its advance was later raised to 20% (USD 3,172) and migration 327
// restored the missing RCV-ADV, but the order still read 'Advance Received'
// with nothing received. update() now does this itself when the advance is
// raised; this moves the one order already in that state.
//
// Guarded: only EX-003, only while it is still 'Advance Received' with an
// advance owed and nothing received. Writes the status-history row. Idempotent.
// down() returns it to 'Advance Received' only if it is still where this left it.

const REASON = 'Advance raised to 20% with nothing received — back to Awaiting Advance (migration 328)';

exports.up = async function up(knex) {
  const o = await knex('export_orders')
    .where({ order_no: 'EX-003', status: 'Advance Received' })
    .andWhere('advance_expected', '>', 0)
    .andWhere(function () { this.whereNull('advance_received').orWhere('advance_received', '<=', 0); })
    .first();
  if (!o) return;
  await knex('export_orders').where({ id: o.id }).update({
    status: 'Awaiting Advance', current_step: 2, updated_at: knex.fn.now(),
  });
  await knex('export_order_status_history').insert({
    order_id: o.id, from_status: 'Advance Received', to_status: 'Awaiting Advance', changed_by: null, reason: REASON,
  });
  // eslint-disable-next-line no-console
  console.log('[328] EX-003: Advance Received → Awaiting Advance');
};

exports.down = async function down(knex) {
  const o = await knex('export_orders').where({ order_no: 'EX-003', status: 'Awaiting Advance' }).first();
  if (!o) return;
  const h = await knex('export_order_status_history').where({ order_id: o.id, reason: REASON }).first();
  if (!h) return;
  await knex('export_orders').where({ id: o.id }).update({ status: 'Advance Received', current_step: 3, updated_at: knex.fn.now() });
  await knex('export_order_status_history').where({ id: h.id }).del();
};
