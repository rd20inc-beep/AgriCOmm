/**
 * Two new milling yield outputs — Powder and Sweeping — as sellable by-products
 * (go to inventory, credited against batch cost at their sale price).
 *
 * Adds to milling_batches: powder_mt / sweeping_mt (qty, NOT NULL default 0) and
 * powder_price_per_mt / sweeping_price_per_mt (sale price, nullable).
 *
 * Idempotent.
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  const add = async (col, builder) => {
    if (!(await knex.schema.hasColumn('milling_batches', col))) {
      await knex.schema.alterTable('milling_batches', builder);
    }
  };
  await add('powder_mt', (t) => t.decimal('powder_mt', 14, 4).notNullable().defaultTo(0));
  await add('sweeping_mt', (t) => t.decimal('sweeping_mt', 14, 4).notNullable().defaultTo(0));
  await add('powder_price_per_mt', (t) => t.decimal('powder_price_per_mt', 14, 2).nullable());
  await add('sweeping_price_per_mt', (t) => t.decimal('sweeping_price_per_mt', 14, 2).nullable());
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  for (const col of ['sweeping_price_per_mt', 'powder_price_per_mt', 'sweeping_mt', 'powder_mt']) {
    if (await knex.schema.hasColumn('milling_batches', col)) {
      await knex.schema.alterTable('milling_batches', (t) => t.dropColumn(col));
    }
  }
};
