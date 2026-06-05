/**
 * Blend support on batch_source_lots.
 *
 * A milling batch can consume PARTIAL quantities from MULTIPLE input lots —
 * different varieties blended to cut cost, and even leftover finished
 * ("ready") rice re-milled with raw paddy. batch_source_lots already links a
 * batch to many lots with a per-lot qty_mt; these columns snapshot each
 * input's cost at the moment it's committed to the batch, so the batch's raw
 * cost is a stable weighted blend (Σ unit_cost_pkr × qty) regardless of later
 * lot-cost changes, and so finished-rice inputs carry their own cost basis.
 *
 *   lot_type        : 'raw' | 'finished' | … (copied from the source lot)
 *   unit_cost_pkr   : landed cost per kg of that lot at commit time
 *   cost_total_pkr  : unit_cost_pkr × (qty_mt × 1000)  — this lot's cost contribution
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('batch_source_lots'))) return;
  if (await knex.schema.hasColumn('batch_source_lots', 'unit_cost_pkr')) return;
  await knex.schema.alterTable('batch_source_lots', (t) => {
    t.string('lot_type', 20);
    t.decimal('unit_cost_pkr', 15, 4);
    t.decimal('cost_total_pkr', 15, 2);
  });
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('batch_source_lots'))) return;
  if (await knex.schema.hasColumn('batch_source_lots', 'unit_cost_pkr')) {
    await knex.schema.alterTable('batch_source_lots', (t) => {
      t.dropColumn('lot_type');
      t.dropColumn('unit_cost_pkr');
      t.dropColumn('cost_total_pkr');
    });
  }
};
