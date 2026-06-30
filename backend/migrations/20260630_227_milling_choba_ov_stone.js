/**
 * New milling yield outputs (#10).
 *
 *  - choba_mt / choba_price_per_mt  — a SELLABLE by-product (like powder/sweeping):
 *    goes to inventory, credited against batch cost at its sale price.
 *  - ov_mt, stone_mt                — RECORD-ONLY residue (like wastage): captured
 *    on the batch for the yield reconciliation, but NO price, NO inventory lot,
 *    NO costing credit.
 *
 * (Choba = the output the mill calls "Choba"; O.V and Stone also exist as quality
 * percentages — cobba_pct / ov_pct — which are a separate concept and untouched.)
 *
 * Phase 5b adds these in MT to match the current schema; Phase 5c converts the
 * whole milling_batches column set MT→KG atomically. Mirrors migration 166.
 * Idempotent.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  const add = async (col, builder) => {
    if (!(await knex.schema.hasColumn('milling_batches', col))) {
      await knex.schema.alterTable('milling_batches', builder);
    }
  };
  await add('choba_mt', (t) => t.decimal('choba_mt', 14, 4).notNullable().defaultTo(0));
  await add('choba_price_per_mt', (t) => t.decimal('choba_price_per_mt', 14, 2).nullable());
  await add('ov_mt', (t) => t.decimal('ov_mt', 14, 4).notNullable().defaultTo(0));
  await add('stone_mt', (t) => t.decimal('stone_mt', 14, 4).notNullable().defaultTo(0));
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  for (const col of ['stone_mt', 'ov_mt', 'choba_price_per_mt', 'choba_mt']) {
    if (await knex.schema.hasColumn('milling_batches', col)) {
      await knex.schema.alterTable('milling_batches', (t) => t.dropColumn(col));
    }
  }
};
