/**
 * Mill-store purchases can sometimes happen against a vendor that
 * isn't in the supplier master (cash purchase from a hardware shop,
 * a one-off pickup, etc.). Make supplier_id nullable so the New
 * Purchase form can record the receipt without forcing the user to
 * create a supplier first. The FK to suppliers stays — when set, it
 * still refers to a real row.
 */
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE mill_purchases ALTER COLUMN supplier_id DROP NOT NULL');
};

exports.down = async function (knex) {
  // Best-effort: re-add NOT NULL only if all existing rows have a supplier.
  await knex.raw('ALTER TABLE mill_purchases ALTER COLUMN supplier_id SET NOT NULL');
};
