/**
 * Drop the composite index added in migration 182 — it is REDUNDANT. An
 * equivalent (and better) partial index already existed:
 *   idx_journal_entries_party ON (party_type, party_id) WHERE party_id IS NOT NULL
 * Every party statement filters `party_id = <id>` (never null), so the partial
 * index already serves the lookup and skips the many null-party rows. The
 * non-partial duplicate only added write overhead. (Indexes aren't part of the
 * schema fingerprint, so this doesn't change schema.baseline.txt.)
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('journal_entries', (t) => {
    t.dropIndex(['party_type', 'party_id'], 'journal_entries_party_type_party_id_index');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('journal_entries', (t) => {
    t.index(['party_type', 'party_id'], 'journal_entries_party_type_party_id_index');
  });
};
