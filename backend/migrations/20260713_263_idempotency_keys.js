// Idempotency keys — makes mutating requests replay-safe. The offline write
// outbox (Phase 3) replays queued POST/PUT/PATCH/DELETE calls on reconnect; each
// carries a stable Idempotency-Key so a replay (or a network retry) returns the
// ORIGINAL result instead of executing the effect twice. Critical for money/GL/
// stock, which must never double-post.
//
//   status: 'in_progress' → reserved, handler running (a replay gets 409, never
//                           re-executes — no double-post on a mid-flight retry)
//           'completed'   → response_status/response_body captured; replay returns it
// A failed handler deletes its key so the client can safely retry.

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('idempotency_keys'))) {
    await knex.schema.createTable('idempotency_keys', (t) => {
      t.increments('id').primary();
      t.string('key', 200).notNullable().unique();
      t.string('method', 10);
      t.text('path');
      t.string('request_hash', 64);
      t.string('status', 20).notNullable().defaultTo('in_progress');
      t.integer('response_status');
      t.jsonb('response_body');
      t.integer('user_id');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('completed_at');
    });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasTable('idempotency_keys')) {
    await knex.schema.dropTable('idempotency_keys');
  }
};
