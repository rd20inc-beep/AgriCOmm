/**
 * Schema refine: export_order_items carries BOTH a UNIQUE CONSTRAINT
 * (export_order_items_order_id_line_no_unique) and a redundant plain UNIQUE INDEX
 * (export_order_items_order_line_uidx, left over from migration 108) on the SAME
 * columns (order_id, line_no). Two unique indexes enforcing the same rule waste
 * disk and slow every write to the table — drop the plain index; the constraint
 * still enforces uniqueness. (The customers/suppliers "is_favorite" indexes that
 * look similar are PARTIAL indexes — not redundant — and are left in place.)
 */
exports.up = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS export_order_items_order_line_uidx');
};

exports.down = async function (knex) {
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS export_order_items_order_line_uidx ON export_order_items (order_id, line_no)');
};
