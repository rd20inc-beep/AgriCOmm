/**
 * Round-13 schema refinement.
 *
 * Polymorphic-link tables (comments, follow_ups, notifications,
 * approval_queue, etc.) store the parent entity as a (type, id) pair
 * because they reference different parent tables. They cannot have
 * FK constraints, but they can — and should — have a compound B-tree
 * index on (type, id), since every "show all X for entity Y" query
 * filters on both columns.
 *
 * Round 11 audit flagged these as having no FK; round 13 audit shows
 * none of them are indexed either. Every comment lookup, every
 * follow-up panel, every "exceptions for this batch" query is full
 * scanning the whole table.
 *
 * Also: export_order_documents lacks a status index, which the doc
 * checklist counts ("3 of 8 approved") needs.
 *
 * All CREATE INDEX IF NOT EXISTS — idempotent, no data risk.
 */

// Polymorphic tables we index. Pair = [table, type_col, id_col].
const POLYMORPHIC_TABLES = [
  ['approval_queue',     'entity_type', 'entity_id'],
  ['comments',           'linked_type', 'linked_id'],
  ['document_checklists','linked_type', 'linked_id'],
  ['email_logs',         'linked_type', 'linked_id'],
  ['exception_inbox',    'linked_type', 'linked_id'],
  ['follow_ups',         'linked_type', 'linked_id'],
  ['mobile_uploads',     'linked_type', 'linked_id'],
  ['predictive_alerts',  'entity_type', 'entity_id'],
  ['risk_scores',        'entity_type', 'entity_id'],
  ['root_cause_analyses','linked_type', 'linked_id'],
  ['tasks_assignments',  'linked_type', 'linked_id'],
  ['whatsapp_logs',      'linked_type', 'linked_id'],
];

exports.up = async function (knex) {
  let added = 0;
  for (const [table, typeCol, idCol] of POLYMORPHIC_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, typeCol))) continue;
    if (!(await knex.schema.hasColumn(table, idCol))) continue;
    const idxName = `idx_${table}_poly`.slice(0, 63);
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS "${idxName}" ON "${table}" ("${typeCol}", "${idCol}")`
    );
    added += 1;
  }
  if (added > 0) console.log(`[085] Ensured ${added} polymorphic-link compound index(es)`);

  // export_order_documents.status — drives the doc-checklist progress count
  // shown on every order detail page.
  if (await knex.schema.hasTable('export_order_documents')
      && (await knex.schema.hasColumn('export_order_documents', 'status'))) {
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS idx_export_order_documents_status ON export_order_documents (status)`
    );
    // Compound for the very common "all docs for order X grouped by status" query.
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS idx_export_order_documents_order_status ON export_order_documents (order_id, status)`
    );
  }
};

exports.down = async function (knex) {
  for (const [table] of POLYMORPHIC_TABLES) {
    await knex.raw(`DROP INDEX IF EXISTS idx_${table}_poly`);
  }
  await knex.raw(`DROP INDEX IF EXISTS idx_export_order_documents_status`);
  await knex.raw(`DROP INDEX IF EXISTS idx_export_order_documents_order_status`);
};
