/**
 * Export documents: weight unit, and freight as a real field.
 *
 * WEIGHT UNIT — shipments to the USA and Canada state weights in pounds, the
 * rest of the book in kilograms. The engine stores KG everywhere and that does
 * not change; `doc_weight_unit` only chooses the unit the EXPORT DOCUMENTS are
 * printed in.
 *
 * FREIGHT — with ocean freight volatile, a CFR/CIF price quoted today can be
 * under water by the time the vessel sails. Freight was being handled by typing
 * it into the document by hand: the term was stated as FOB and the freight added
 * as a line at the bottom with a "subject to change" note. That protects the
 * margin but contradicts itself — under FOB the buyer nominates the vessel and
 * pays the freight, so an FOB invoice that also charges freight can be refused
 * as a discrepancy under an L/C, and customs valuation keys off the stated term.
 *
 * So freight becomes structured data: the amount per MT, the insurance per MT,
 * the date its rate was quoted on and how long that holds. `freight_display`
 * chooses how it prints — 'in_price' states the real CFR/CIF term and breaks the
 * unit price into FOB + freight (+ insurance) inside it, which is the split
 * customs wants anyway; 'separate' keeps the existing FOB-plus-a-freight-line
 * presentation for a buyer who insists on it. Either way an escalation clause
 * carries the protection, and `freight_clause` overrides its wording.
 *
 * Nothing here touches price_per_mt, contract_value, revenue or AR.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('export_orders', (t) => {
    t.string('doc_weight_unit', 3).notNullable().defaultTo('kg');
    t.decimal('freight_per_mt', 14, 2).nullable();
    t.decimal('insurance_per_mt', 14, 2).nullable();
    t.date('freight_basis_date').nullable();
    t.date('freight_valid_until').nullable();
    t.string('freight_display', 16).notNullable().defaultTo('in_price');
    t.text('freight_clause').nullable();
  });

  await knex.raw(`
    ALTER TABLE export_orders
      ADD CONSTRAINT chk_export_orders_doc_weight_unit_valid
      CHECK (doc_weight_unit IN ('kg', 'lb'))
  `);
  await knex.raw(`
    ALTER TABLE export_orders
      ADD CONSTRAINT chk_export_orders_freight_display_valid
      CHECK (freight_display IN ('in_price', 'separate'))
  `);
};

exports.down = async (knex) => {
  await knex.raw('ALTER TABLE export_orders DROP CONSTRAINT IF EXISTS chk_export_orders_freight_display_valid');
  await knex.raw('ALTER TABLE export_orders DROP CONSTRAINT IF EXISTS chk_export_orders_doc_weight_unit_valid');
  await knex.schema.alterTable('export_orders', (t) => {
    t.dropColumn('freight_clause');
    t.dropColumn('freight_display');
    t.dropColumn('freight_valid_until');
    t.dropColumn('freight_basis_date');
    t.dropColumn('insurance_per_mt');
    t.dropColumn('freight_per_mt');
    t.dropColumn('doc_weight_unit');
  });
};
