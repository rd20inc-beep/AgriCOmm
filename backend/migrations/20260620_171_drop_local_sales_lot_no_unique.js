/**
 * Drop the partial UNIQUE index on local_sales.lot_no (added in mig 073, which
 * treated it as a natural key). It is NOT one: with lot-level inventory
 * deduction a single lot can be sold across SEVERAL transactions (partial /
 * repeat sales draw down available_qty), and the unique index wrongly blocked
 * the 2nd+ sale of a lot with "duplicate key value violates uq_local_sales_lot_no".
 */
exports.up = async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS "uq_local_sales_lot_no"');
};

exports.down = async function down(knex) {
  await knex.raw(
    `CREATE UNIQUE INDEX IF NOT EXISTS "uq_local_sales_lot_no" ON "local_sales" ("lot_no")
     WHERE "lot_no" IS NOT NULL AND "lot_no" != ''`,
  );
};
