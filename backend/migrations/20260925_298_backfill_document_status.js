/**
 * Files uploaded before the approval rule (mig 297) all sit at 'Draft'.
 *
 * Under the new rule 'live' means Approved, so those files would suddenly read
 * as awaiting approval and their checklist ticks would go out — documents that
 * were perfectly fine yesterday. Backfill them as the rule would have treated
 * them at the time: the FIRST file of each (reference, doc type) needed no
 * approval, so it becomes Approved; any later file for the same type was a
 * change, so it waits as 'Pending Review' for an owner to decide.
 *
 * Idempotent: only touches rows still at 'Draft'.
 */

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('document_store'))) return;
  const drafts = await knex('document_store').where({ status: 'Draft' })
    .select('id', 'linked_type', 'linked_id', 'doc_type', 'created_at')
    .orderBy('created_at', 'asc').orderBy('id', 'asc');

  const seen = new Set();
  for (const d of drafts) {
    const key = `${d.linked_type}|${d.linked_id}|${d.doc_type}`;
    // Anything already approved for this key means this draft is not the first.
    if (!seen.has(key)) {
      const approvedExists = await knex('document_store')
        .where({ linked_type: d.linked_type, linked_id: d.linked_id, doc_type: d.doc_type, status: 'Approved' })
        .first('id');
      if (approvedExists) seen.add(key);
    }
    const isFirst = !seen.has(key);
    seen.add(key);
    await knex('document_store').where({ id: d.id })
      .update({ status: isFirst ? 'Approved' : 'Pending Review', updated_at: knex.fn.now() });
  }
};

exports.down = async (knex) => {
  // No safe inverse: which rows were Draft before is not recorded, and guessing
  // would un-approve live documents.
};
