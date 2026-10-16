/**
 * P5-01 — the notifications table becomes the one place a user's alerts land
 * (the header bell reads it).
 *
 * 1. `link` — an optional in-app route a writer can attach (e.g. the store
 *    adjustment queue). The bell still re-checks it against the reader's
 *    permissions before showing it; when it is null the link is derived from
 *    `linked_ref` at read time.
 * 2. Two more types in the closed CHECK set: 'approval' (something is waiting
 *    for you to approve) and 'alert' (an automation scan found an exception —
 *    these used to sit unseen in the `alerts` table).
 * 3. An index for the bell's "my unread, newest first" read.
 *
 * Additive; idempotent; down() restores the previous CHECK (after relabelling
 * the two new types as 'info' so the old constraint can be re-added).
 */
const CHECK = 'notifications_type_check';
const OLD_TYPES = ['payment', 'milling', 'document', 'shipment', 'mention', 'task', 'info'];
const NEW_TYPES = [...OLD_TYPES, 'approval', 'alert'];
const INDEX = 'notifications_user_unread_idx';

const checkSql = (types) => `ALTER TABLE notifications ADD CONSTRAINT ${CHECK}
  CHECK (type IS NULL OR type IN (${types.map((t) => `'${t}'`).join(', ')}))`;

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('notifications', 'link'))) {
    await knex.schema.alterTable('notifications', (t) => { t.string('link', 255).nullable(); });
  }
  await knex.raw(`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ${CHECK}`);
  await knex.raw(checkSql(NEW_TYPES));
  await knex.raw(`CREATE INDEX IF NOT EXISTS ${INDEX} ON notifications (user_id, is_read, created_at DESC)`);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX}`);
  await knex('notifications').whereIn('type', ['approval', 'alert']).update({ type: 'info' });
  await knex.raw(`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ${CHECK}`);
  await knex.raw(checkSql(OLD_TYPES));
  if (await knex.schema.hasColumn('notifications', 'link')) {
    await knex.schema.alterTable('notifications', (t) => { t.dropColumn('link'); });
  }
};
