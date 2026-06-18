/**
 * Immutable original-intake quantity for inventory lots.
 *
 * Problem: milling/sales consume a lot by DECREMENTING net_weight_kg (postMovement),
 * so a raw lot loses its original received quantity — e.g. received 30 MT, milled
 * 15 MT, and the row then reads as a 15 MT lot with nothing "utilized".
 *
 * Fix: add `received_net_weight_kg` — set once at intake, grows only on inbound
 * movements, never shrinks on consumption. net_weight_kg keeps tracking the CURRENT
 * remaining physical weight (needed for valuation); available_qty tracks available.
 * Utilized = received - current.
 *
 * Backfill from the ledger: received = GREATEST(current net_weight, Σ inflow
 * lot_transactions). For raw purchased lots this recovers the full purchased qty;
 * for output lots with no inflow ledger it falls back to the current net weight.
 *
 * Idempotent.
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (!(await knex.schema.hasColumn('inventory_lots', 'received_net_weight_kg'))) {
    await knex.schema.alterTable('inventory_lots', (t) => {
      t.decimal('received_net_weight_kg', 14, 2).nullable();
    });
  }
  // Backfill: original intake = max(current net weight, total inflow per the ledger).
  await knex.raw(`
    UPDATE inventory_lots l
    SET received_net_weight_kg = GREATEST(
      COALESCE(l.net_weight_kg, 0),
      COALESCE((
        SELECT SUM(t.quantity_kg)
        FROM lot_transactions t
        WHERE t.lot_id = l.id AND t.quantity_kg > 0
      ), 0)
    )
    WHERE l.received_net_weight_kg IS NULL
  `);
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (await knex.schema.hasColumn('inventory_lots', 'received_net_weight_kg')) {
    await knex.schema.alterTable('inventory_lots', (t) => t.dropColumn('received_net_weight_kg'));
  }
};
