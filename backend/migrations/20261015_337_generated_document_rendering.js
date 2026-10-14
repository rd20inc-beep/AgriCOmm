/**
 * P1-08 (EXP-12) — the stored rendering of a generated-document version.
 *
 * PDF download, email and WhatsApp used to render whatever HTML the browser
 * posted. They now render the version's own stored rendering: the document body
 * exactly as the operator saw it (inline edits included), sanitized on save, and
 * frozen when the version is approved. edited_html stays what it was — "the
 * operator hand-edited this" — because the preview treats its presence as that
 * signal; rendered_html is set for every saved version, edited or not.
 *
 * Additive, nullable, idempotent. No backfill: a version without a rendering
 * falls back to edited_html, and otherwise is captured on its next save.
 */
exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('generated_documents', 'rendered_html'))) {
    await knex.schema.alterTable('generated_documents', (t) => { t.text('rendered_html'); });
  }
  if (!(await knex.schema.hasColumn('generated_documents', 'rendered_at'))) {
    await knex.schema.alterTable('generated_documents', (t) => { t.timestamp('rendered_at', { useTz: true }); });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('generated_documents', 'rendered_at')) {
    await knex.schema.alterTable('generated_documents', (t) => { t.dropColumn('rendered_at'); });
  }
  if (await knex.schema.hasColumn('generated_documents', 'rendered_html')) {
    await knex.schema.alterTable('generated_documents', (t) => { t.dropColumn('rendered_html'); });
  }
};
