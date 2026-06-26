/**
 * Ordered vs received on purchase lots. A lot may be ORDERED for one quantity
 * (e.g. 14 MT) but a different amount RECEIVED (e.g. 10 MT). `received_net_weight_kg`
 * (mig 167) already anchors the supplier bill to what actually arrived; this adds
 * `ordered_net_weight_kg` to record what was ordered, so the lot can show the
 * short/over variance. Existing lots are backfilled to received (no variance).
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('inventory_lots', 'ordered_net_weight_kg');
  if (!has) {
    await knex.schema.alterTable('inventory_lots', (t) => {
      t.decimal('ordered_net_weight_kg', 14, 2).nullable();
    });
  }
  // Backfill: ordered = received (or current net) so existing lots show no variance.
  await knex.raw(`
    UPDATE inventory_lots
       SET ordered_net_weight_kg = COALESCE(NULLIF(received_net_weight_kg, 0), NULLIF(net_weight_kg, 0))
     WHERE ordered_net_weight_kg IS NULL
  `);
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('inventory_lots', 'ordered_net_weight_kg');
  if (has) await knex.schema.alterTable('inventory_lots', (t) => t.dropColumn('ordered_net_weight_kg'));
};
