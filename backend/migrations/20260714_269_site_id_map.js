// Offline Stage 16b — site↔cloud transactional identity mapping. Additive, site-only
// (empty/unread on the cloud). When the site replays a locally-created transaction, the
// cloud assigns the FINAL id + official doc number; we record the local→cloud mapping so
// the site has an audit trail of "provisional LS-local-5 → cloud LS-0042" without ever
// mutating the business rows (no risky id/FK rewrites).

exports.up = async (knex) => {
  // Capture what the site's OWN create response told us: which entity + local row id
  // the recorded request produced. Filled in by the site outbox recorder.
  if (await knex.schema.hasTable('site_outbox')) {
    const hasEntity = await knex.schema.hasColumn('site_outbox', 'entity');
    if (!hasEntity) {
      await knex.schema.alterTable('site_outbox', (t) => {
        t.string('entity', 60);       // e.g. 'local-sales'
        t.string('local_ref', 60);    // the local row id this request created
        t.string('cloud_ref', 60);    // the cloud row id, once replayed
        t.string('cloud_doc_no', 60); // the cloud's official doc number, once replayed
      });
    }
  }

  if (!(await knex.schema.hasTable('site_id_map'))) {
    await knex.schema.createTable('site_id_map', (t) => {
      t.increments('id').primary();
      t.uuid('idempotency_key').notNullable().unique(); // 1:1 with the site_outbox row
      t.string('entity', 60).notNullable();
      t.string('local_ref', 60);
      t.string('cloud_ref', 60);
      t.string('cloud_doc_no', 60);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['entity', 'local_ref'], 'idx_site_id_map_entity_local');
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('site_id_map');
  if (await knex.schema.hasTable('site_outbox')) {
    const hasEntity = await knex.schema.hasColumn('site_outbox', 'entity');
    if (hasEntity) {
      await knex.schema.alterTable('site_outbox', (t) => {
        t.dropColumn('entity');
        t.dropColumn('local_ref');
        t.dropColumn('cloud_ref');
        t.dropColumn('cloud_doc_no');
      });
    }
  }
};
