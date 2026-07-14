// Offline Stage 3 — device registry + per-device sync watermarks. Additive: two
// new tables, nothing else touched. `devices` registers each web/desktop/Android
// install (revocable); `sync_state` tracks how far each device has pulled per
// domain so sync is incremental.

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('devices'))) {
    await knex.schema.createTable('devices', (t) => {
      t.increments('id').primary();
      t.uuid('device_uuid').notNullable().unique(); // client-generated, stable
      t.integer('user_id');
      t.string('platform', 20);   // web | tauri | capacitor
      t.string('label', 120);
      t.text('public_key');
      t.string('status', 20).notNullable().defaultTo('active'); // active | revoked
      t.string('app_version', 40);
      t.timestamp('registered_at').defaultTo(knex.fn.now());
      t.timestamp('last_seen_at');
      t.timestamp('revoked_at');
      t.integer('revoked_by');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('sync_state'))) {
    await knex.schema.createTable('sync_state', (t) => {
      t.increments('id').primary();
      t.integer('device_id');          // soft FK → devices.id
      t.string('domain', 60).notNullable();  // 'inventory' | 'milling' | ...
      t.string('watermark', 60);       // last-synced cursor (server_seq / timestamp)
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.unique(['device_id', 'domain'], { indexName: 'uq_sync_state_device_domain' });
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('sync_state');
  await knex.schema.dropTableIfExists('devices');
};
