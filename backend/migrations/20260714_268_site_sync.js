// Offline Stage 16 — on-premises site-server sync state. Additive: two tables used
// ONLY by a backend running in SITE_MODE (a LAN box). On the cloud these tables are
// created but stay empty and untouched — nothing on the cloud reads or writes them.
//
//   site_outbox     — every business mutation the site backend served while acting as
//                     the site's source of truth, captured for idempotent replay UP to
//                     the cloud (the site is "a big offline device").
//   site_sync_state — per-domain watermark for pulling master data DOWN from the cloud.

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('site_outbox'))) {
    await knex.schema.createTable('site_outbox', (t) => {
      t.increments('id').primary();
      t.uuid('idempotency_key').notNullable().unique(); // reused as the cloud Idempotency-Key
      t.string('method', 10).notNullable();
      t.string('path', 500).notNullable();              // original /api path (+query)
      t.jsonb('body');
      t.integer('user_id');
      t.string('status', 20).notNullable().defaultTo('pending'); // pending | synced | conflict
      t.integer('attempts').notNullable().defaultTo(0);
      t.integer('cloud_status');                         // last HTTP status from the cloud
      t.string('conflict_code', 40);                     // when the cloud refused the replay
      t.text('last_error');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('synced_at');
    });
    // FIFO drain + fast "still pending?" lookups.
    await knex.schema.alterTable('site_outbox', (t) => {
      t.index(['status', 'id'], 'idx_site_outbox_status_id');
    });
  }

  if (!(await knex.schema.hasTable('site_sync_state'))) {
    await knex.schema.createTable('site_sync_state', (t) => {
      t.increments('id').primary();
      t.string('domain', 60).notNullable().unique();
      t.string('watermark', 60);       // last-pulled cursor (timestamp) from the cloud
      t.timestamp('last_pull_at');
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('site_outbox');
  await knex.schema.dropTableIfExists('site_sync_state');
};
