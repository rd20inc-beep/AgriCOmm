// Service-milling client freight recovery (spec item #14, Phase 2b-ii).
// When a toll-milling client bears the freight, the company fronts the hauler and
// recovers it on the client's service invoice: a freight line adds to the invoice
// total (client receivable), a hauler payable is raised, and the freight washes
// through 1450 Freight Recoverable (recovery, not revenue). These columns capture
// the freight amount and the hauler fronted.

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('service_milling_invoices', 'freight_amount'))) {
    await knex.schema.alterTable('service_milling_invoices', (t) => {
      t.decimal('freight_amount', 14, 2).notNullable().defaultTo(0);
      t.integer('freight_hauler_id').references('id').inTable('haulers');
    });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('service_milling_invoices', 'freight_amount')) {
    await knex.schema.alterTable('service_milling_invoices', (t) => {
      t.dropColumn('freight_amount');
      t.dropColumn('freight_hauler_id');
    });
  }
};
