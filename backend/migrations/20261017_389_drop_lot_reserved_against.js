/**
 * Drop inventory_lots.reserved_against (P3-13 / DAT-10).
 *
 * A single string on the lot naming the ONE order holding it. reserveStock
 * wrote 'order-<id>'; readers matched the order number, 'order-<id>' or both,
 * so some never matched (the packing-list packaging lookup found nothing); and
 * a lot reserved to two orders could only name one. inventory_reservations
 * (lot_id, order_id, status) is the order → lot link and every reader now uses
 * it; the inventory list derives the same field from Active reservations.
 *
 * down() re-adds the column and fills it from Active reservations, in the
 * 'order-<id>' form reserveStock used to write (the latest reservation wins).
 */

exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('inventory_lots', 'reserved_against')) {
    await knex.schema.alterTable('inventory_lots', (t) => { t.dropColumn('reserved_against'); });
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('inventory_lots', 'reserved_against'))) {
    await knex.schema.alterTable('inventory_lots', (t) => { t.string('reserved_against', 50); });
    await knex.raw(`
      UPDATE inventory_lots l
         SET reserved_against = 'order-' || r.order_id
        FROM (SELECT DISTINCT ON (lot_id) lot_id, order_id
                FROM inventory_reservations
               WHERE status = 'Active' AND order_id IS NOT NULL
               ORDER BY lot_id, id DESC) r
       WHERE r.lot_id = l.id`);
  }
};
