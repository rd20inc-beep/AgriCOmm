/**
 * Repacking a local sale empties the katta the rice was held in.
 *
 * Those sacks are worth something — they are sold — but they do not always come
 * back to us: a buyer can ask to keep the empties as part of the deal. So the
 * decision is recorded per sale rather than assumed, and the count actually
 * credited is stored so the store movement can be traced back and reversed.
 *
 * Freed katta enter the store at ZERO value and pick up a value only when sold,
 * which is why nothing here touches cost.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('local_sale_repacking', (t) => {
    // Default true: the normal case is the empties come back to the mill.
    t.boolean('freed_katta_to_store').notNullable().defaultTo(true);
    // What was actually credited, so the movement is auditable even if the
    // original bag count is edited later.
    t.integer('freed_katta_count').nullable();
    t.decimal('freed_katta_size_kg', 10, 2).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('local_sale_repacking', (t) => {
    t.dropColumn('freed_katta_to_store');
    t.dropColumn('freed_katta_count');
    t.dropColumn('freed_katta_size_kg');
  });
};
