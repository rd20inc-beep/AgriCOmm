/**
 * Brand / packing label on an inventory lot.
 *
 * Finished stock is differentiated by who it is packed for — FIZZA, SINDBAD,
 * LA FOOD, ND BROKER — and there was nowhere to record it, so it was going into
 * `grade`. That column is not free: baseGrade() in LotInventory classifies
 * broken grades from it (B1 / B2 / CSR), so a lot carrying "LA FOOD 2" there
 * muddies real grade classification.
 *
 * After this, `grade` holds only genuine grades and `brand` holds the
 * commercial label. Raw lots use `brand` for the supplier's lot reference
 * (SRB 199K, YUS 432K) — the same idea: the marking that tells two otherwise
 * identical lots apart.
 *
 * Idempotent.
 */

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (!(await knex.schema.hasColumn('inventory_lots', 'brand'))) {
    await knex.schema.alterTable('inventory_lots', (t) => {
      t.string('brand', 120).nullable();
    });
  }
};

exports.down = async (knex) => {
  if (!(await knex.schema.hasTable('inventory_lots'))) return;
  if (await knex.schema.hasColumn('inventory_lots', 'brand')) {
    await knex.schema.alterTable('inventory_lots', (t) => { t.dropColumn('brand'); });
  }
};
