// Offline Stage 8 — central audit of sync conflicts (a queued offline write the
// server refused on replay: insufficient stock, duplicate, version clash, etc.).
// Recorded by the device, reviewable/resolvable by managers. Additive.

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('sync_conflicts'))) {
    await knex.schema.createTable('sync_conflicts', (t) => {
      t.increments('id').primary();
      t.uuid('device_uuid');
      t.integer('user_id');
      t.uuid('item_uuid');          // the outbox item's UUID (= idempotency key)
      t.text('endpoint');
      t.string('method', 10);
      t.string('conflict_code', 40); // insufficient_stock | duplicate | version_conflict | not_permitted | invalid | rejected
      t.integer('status_code');
      t.text('message');
      t.string('label', 200);
      t.jsonb('payload');
      t.string('resolution', 20).notNullable().defaultTo('pending'); // pending | dismissed | resolved | retried
      t.integer('resolved_by');
      t.timestamp('resolved_at');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_sync_conflicts_resolution ON sync_conflicts (resolution)');
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('sync_conflicts');
};
