// Export document page orientation (spec item #13). Every export document
// defaults to A4 PORTRAIT; an admin may configure a specific document as
// landscape in Admin › Document Templates. Orientation is NEVER chosen
// automatically from table width/content — only from this explicit setting.

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('document_templates', 'orientation'))) {
    await knex.schema.alterTable('document_templates', (t) => {
      t.string('orientation', 10).notNullable().defaultTo('portrait'); // 'portrait' | 'landscape'
    });
    await knex.raw(
      "ALTER TABLE document_templates ADD CONSTRAINT chk_doc_templates_orientation " +
      "CHECK (orientation IN ('portrait', 'landscape'))"
    );
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('document_templates', 'orientation')) {
    await knex.raw('ALTER TABLE document_templates DROP CONSTRAINT IF EXISTS chk_doc_templates_orientation');
    await knex.schema.alterTable('document_templates', (t) => t.dropColumn('orientation'));
  }
};
