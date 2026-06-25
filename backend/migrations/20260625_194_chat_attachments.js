/**
 * Chat attachments — a message may carry a single file (image / document) in
 * addition to (or instead of) its text body. Metadata lives on chat_messages;
 * the file itself is stored on disk in the persisted uploads volume.
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('chat_messages', 'attachment_path'))) {
    await knex.schema.alterTable('chat_messages', (t) => {
      t.text('attachment_path');
      t.string('attachment_name');
      t.string('attachment_type');     // mime type
      t.integer('attachment_size');    // bytes
    });
  }
  // body can now be empty when a file is attached.
  await knex.raw('ALTER TABLE chat_messages ALTER COLUMN body DROP NOT NULL');
};

exports.down = async function (knex) {
  await knex.raw("ALTER TABLE chat_messages ALTER COLUMN body SET NOT NULL");
  if (await knex.schema.hasColumn('chat_messages', 'attachment_path')) {
    await knex.schema.alterTable('chat_messages', (t) => {
      t.dropColumn('attachment_path');
      t.dropColumn('attachment_name');
      t.dropColumn('attachment_type');
      t.dropColumn('attachment_size');
    });
  }
};
