/**
 * In-app team chat: 1:1 direct messages between users plus broadcast messages
 * ("Announcements") sent to everyone. Read state is tracked per user per
 * conversation scope ('broadcast' or the peer's user id) via a last-read marker.
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('chat_messages'))) {
    await knex.schema.createTable('chat_messages', (t) => {
      t.increments('id').primary();
      t.integer('sender_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      // NULL recipient ⇒ broadcast to everyone.
      t.integer('recipient_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
      t.boolean('is_broadcast').notNullable().defaultTo(false);
      t.text('body').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index('sender_id');
      t.index('recipient_id');
      t.index('created_at');
      t.index(['is_broadcast', 'created_at']);
    });
  }

  if (!(await knex.schema.hasTable('chat_reads'))) {
    await knex.schema.createTable('chat_reads', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.string('scope').notNullable(); // 'broadcast' | '<peerUserId>'
      t.timestamp('last_read_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['user_id', 'scope']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('chat_reads');
  await knex.schema.dropTableIfExists('chat_messages');
};
