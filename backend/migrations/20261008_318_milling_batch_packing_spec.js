/**
 * A milling batch's packing spec — the bag its finished rice packs into.
 *
 * Until now the spec was never stored on the batch: reconcileBatchKatta read it
 * at yield from the linked export order's line for the batch product (header
 * fallback; jumbo 1,200 kg; container bulk). That still applies — these columns
 * are a per-batch OVERRIDE of it (owner decision 2026-10-08). All NULL = no
 * override; the effective spec is resolved in milling/batchPackSpec.js.
 *
 *   - pack_bag_size_kg         numeric(8,2) NULL  — the retail / sack size
 *   - pack_bag_type            varchar(100) NULL  — descriptor, e.g. "P.P. bag"
 *   - pack_master_bag_size_kg  numeric(8,2) NULL  — outer master bag, if any
 *
 * Same types as export_order_items' bag_size_kg / bag_type / master_bag_size_kg.
 * Nothing to backfill. Idempotent.
 */

const TABLE = 'milling_batches';
const COLS = [
  ['pack_bag_size_kg', (t) => t.decimal('pack_bag_size_kg', 8, 2).nullable()],
  ['pack_bag_type', (t) => t.string('pack_bag_type', 100).nullable()],
  ['pack_master_bag_size_kg', (t) => t.decimal('pack_master_bag_size_kg', 8, 2).nullable()],
];

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  for (const [name, add] of COLS) {
    if (!(await knex.schema.hasColumn(TABLE, name))) {
      await knex.schema.alterTable(TABLE, (t) => add(t));
    }
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  for (const [name] of [...COLS].reverse()) {
    if (await knex.schema.hasColumn(TABLE, name)) {
      await knex.schema.alterTable(TABLE, (t) => t.dropColumn(name));
    }
  }
};
