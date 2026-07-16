// Per-customer document typography. The export documents are generated for a
// specific consignee; storing the chosen font family + size scale on the
// customer lets the preview screen save a client's preferred look so every
// future document for that same customer renders with it automatically.

exports.up = async (knex) => {
  const hasFam = await knex.schema.hasColumn('customers', 'doc_font_family');
  if (!hasFam) {
    await knex.schema.alterTable('customers', (t) => {
      t.string('doc_font_family', 80);
    });
  }
  const hasScale = await knex.schema.hasColumn('customers', 'doc_font_scale');
  if (!hasScale) {
    await knex.schema.alterTable('customers', (t) => {
      t.decimal('doc_font_scale', 4, 2).notNullable().defaultTo(1.0);
    });
  }
};

exports.down = async (knex) => {
  const hasScale = await knex.schema.hasColumn('customers', 'doc_font_scale');
  if (hasScale) await knex.schema.alterTable('customers', (t) => t.dropColumn('doc_font_scale'));
  const hasFam = await knex.schema.hasColumn('customers', 'doc_font_family');
  if (hasFam) await knex.schema.alterTable('customers', (t) => t.dropColumn('doc_font_family'));
};
