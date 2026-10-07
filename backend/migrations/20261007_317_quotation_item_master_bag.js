/**
 * Per-line master bag on export QUOTATION lines.
 *
 * Export order lines carry their own bag AND master bag (migration 082, and
 * PR #562: documents never borrow line 1's packing on a multi-line order). The
 * quotation lines had the bag (bag_size_kg / bag_type / bag_count) but no
 * master bag, so an order converted from a quotation reached its documents
 * with no master bag on any line. These two columns close that gap; convert()
 * copies them line-for-line onto export_order_items.
 *
 * Same types as export_order_items (082):
 *   - master_bag_size_kg  numeric(8,2) NULL
 *   - master_bag_type     varchar(100) NULL  (descriptor, e.g. "Carton")
 *
 * Nothing to backfill: existing quotations have no master bag recorded, and
 * documents already flag a retail line with none.
 *
 * Idempotent.
 */

const TABLE = 'export_quotation_items';

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (!(await knex.schema.hasColumn(TABLE, 'master_bag_size_kg'))) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.decimal('master_bag_size_kg', 8, 2).nullable();
    });
  }
  if (!(await knex.schema.hasColumn(TABLE, 'master_bag_type'))) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.string('master_bag_type', 100).nullable();
    });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (await knex.schema.hasColumn(TABLE, 'master_bag_type')) {
    await knex.schema.alterTable(TABLE, (t) => t.dropColumn('master_bag_type'));
  }
  if (await knex.schema.hasColumn(TABLE, 'master_bag_size_kg')) {
    await knex.schema.alterTable(TABLE, (t) => t.dropColumn('master_bag_size_kg'));
  }
};
