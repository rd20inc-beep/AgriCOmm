// Service Milling: let the operator declare how much of the received lot is
// being milled (raw kg processed), after the batch is created. The rest stays
// unmilled. This is the authoritative "milled" basis for billing the milling
// service; if left null, "milled" falls back to the sum of yield outputs.

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('milling_batches', 'milled_qty_kg'))) {
    await knex.schema.alterTable('milling_batches', (t) => { t.decimal('milled_qty_kg', 14, 3); });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('milling_batches', 'milled_qty_kg')) {
    await knex.schema.alterTable('milling_batches', (t) => { t.dropColumn('milled_qty_kg'); });
  }
};
