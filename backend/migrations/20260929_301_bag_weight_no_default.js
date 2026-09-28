/**
 * inventory_lots.bag_weight_kg carried a column DEFAULT of 50.
 *
 * That default is applied by the DATABASE, so it lands on any insert that omits
 * the column no matter what bag_size_kg the same row carries. A loader writing
 * lots directly — which is how the opening stock was loaded — set the sack size
 * and left the weight alone, and `1121 CSR 25KG` came out as size 25 / weight 50.
 * bag_weight_kg is what every katta <-> kg conversion divides by, so that lot
 * reported 8 katta where it held 16.
 *
 * Dropping the default does not change any number that is read today: every
 * reader already falls back to 50 when the column is null. What it changes is
 * honesty — a null reads as "not recorded", where 50 reads as a measurement
 * nobody took. The paths that matter (lot creation, the katta figures on the
 * stock report) now prefer bag_size_kg before falling back to 50, so a 25kg lot
 * with no explicit weight comes out at 25 rather than silently at 50.
 *
 * Existing rows are left exactly as they are: they were corrected individually
 * after being checked against their received weight and bag counts.
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE inventory_lots ALTER COLUMN bag_weight_kg DROP DEFAULT');
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE inventory_lots ALTER COLUMN bag_weight_kg SET DEFAULT 50");
};
