// Packed-weight variance resolution (Phase 2). Records HOW an over/under-packed
// variance is resolved and drives the stock/invoice impact:
//   approve_extra  → ship the extra free; deduct the actual packed net from stock.
//   update_invoice → re-price the order to the actual packed qty (customer charged).
//   remove_extra   → the extra is pulled from the shipment; nothing extra leaves stock.
//   adjustment     → book the extra as a packing adjustment/loss; deduct from stock.
exports.up = async (knex) => {
  await knex.schema.alterTable('export_packing_weights', (t) => {
    t.string('resolution', 20).nullable(); // approve_extra | update_invoice | remove_extra | adjustment
    t.text('resolution_notes').nullable();
    t.timestamp('resolved_at', { useTz: true }).nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('export_packing_weights', (t) => {
    t.dropColumn('resolution');
    t.dropColumn('resolution_notes');
    t.dropColumn('resolved_at');
  });
};
