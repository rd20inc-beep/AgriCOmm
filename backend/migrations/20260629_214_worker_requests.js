/**
 * Employee self-service requests (Phase 20 — portal extras).
 *
 * A lightweight request inbox: a worker raises a request from the portal (leave,
 * advance, correction, or general query) and payroll staff respond / approve /
 * reject. Deliberately generic — NOT a full leave-balance/accrual engine (that's
 * still deferred); just a worker↔payroll communication + approval trail.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('mill_worker_requests')) return;
  await knex.schema.createTable('mill_worker_requests', (t) => {
    t.increments('id').primary();
    t.integer('worker_id').notNullable().references('id').inTable('mill_workers').onDelete('CASCADE');
    t.string('type', 20).notNullable().defaultTo('query'); // leave | advance | correction | query
    t.string('subject', 160).nullable();
    t.text('message').nullable();
    t.date('from_date').nullable(); // for leave
    t.date('to_date').nullable();
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | approved | rejected | resolved
    t.text('response').nullable();
    t.integer('handled_by').nullable();
    t.timestamp('handled_at').nullable();
    t.timestamps(true, true);
  });
  await knex.schema.alterTable('mill_worker_requests', (t) => {
    t.index(['status'], 'idx_worker_requests_status');
    t.index(['worker_id'], 'idx_worker_requests_worker');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mill_worker_requests');
};
