/**
 * Custom name + tags for milling batches (esp. blended batches) so operators can
 * reference a batch by a human name ("Super Kernel Export Blend - June 2026") and
 * classify it with free-form tags, instead of only the system batch_no.
 *
 *  - batch_name   — optional human label, shown alongside batch_no everywhere.
 *  - custom_tags  — jsonb array of strings (e.g. ["Export", "June Production"]).
 *
 * Applies to ALL batches; the capture UI emphasises it for blends. Idempotent.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  if (!(await knex.schema.hasColumn('milling_batches', 'batch_name'))) {
    await knex.schema.alterTable('milling_batches', (t) => t.string('batch_name', 200).nullable());
  }
  if (!(await knex.schema.hasColumn('milling_batches', 'custom_tags'))) {
    await knex.schema.alterTable('milling_batches', (t) => t.jsonb('custom_tags').notNullable().defaultTo('[]'));
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('milling_batches'))) return;
  for (const col of ['custom_tags', 'batch_name']) {
    if (await knex.schema.hasColumn('milling_batches', col)) {
      await knex.schema.alterTable('milling_batches', (t) => t.dropColumn(col));
    }
  }
};
