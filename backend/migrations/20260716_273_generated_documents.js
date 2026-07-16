// Phase E of the export-document overhaul — persist generated documents with
// versioning so an approved/issued document is never silently overwritten.
//
// A draft freezes the assembled document data as `snapshot_json`; preview edits
// are stored as a shallow `overrides_json` patch merged over the snapshot at
// render time (so "update this document only" never mutates the order/customer).
// Approving/issuing sets `locked`; a change then requires a Revise, which flips
// the old row's `is_latest` off and inserts a new version (previous_version_id
// chain). A partial-unique index guarantees exactly one live version per
// (order, doc_type).

const STATUSES = ['Draft', 'Under Review', 'Approved', 'Sent to Bank', 'Sent to Chamber', 'Issued to Customer', 'Revised', 'Cancelled'];
const AUDIENCES = ['internal', 'bank', 'chamber', 'customer'];

exports.up = async (knex) => {
  const exists = await knex.schema.hasTable('generated_documents');
  if (!exists) {
    await knex.schema.createTable('generated_documents', (t) => {
      t.increments('id').primary();
      t.string('doc_no', 40).notNullable().unique();
      t.integer('order_id').notNullable().references('id').inTable('export_orders').onDelete('CASCADE');
      t.string('doc_type', 60).notNullable();
      t.integer('version').notNullable().defaultTo(1);
      t.boolean('is_latest').notNullable().defaultTo(true);
      t.integer('previous_version_id').references('id').inTable('generated_documents').onDelete('SET NULL');
      t.string('status', 24).notNullable().defaultTo('Draft');
      t.jsonb('snapshot_json');       // frozen assembled document at draft time
      t.jsonb('overrides_json');      // shallow field patch (preview edits)
      t.text('edited_html');          // optional print-fidelity cache (non-canonical)
      t.string('audience', 16).notNullable().defaultTo('internal');
      t.integer('bank_account_id').references('id').inTable('bank_accounts').onDelete('SET NULL');
      t.string('copy_label', 20);     // Original / Copy / Duplicate
      t.text('revision_reason');
      t.integer('generated_by').references('id').inTable('users');
      t.timestamp('generated_at').defaultTo(knex.fn.now());
      t.integer('approved_by').references('id').inTable('users');
      t.timestamp('approved_at');
      t.boolean('locked').notNullable().defaultTo(false);
      t.timestamps(true, true);
      t.index(['order_id', 'doc_type']);
    });

    await knex.raw(`ALTER TABLE generated_documents ADD CONSTRAINT chk_gendoc_status CHECK (status IN (${STATUSES.map((s) => `'${s}'`).join(', ')}))`);
    await knex.raw(`ALTER TABLE generated_documents ADD CONSTRAINT chk_gendoc_audience CHECK (audience IN (${AUDIENCES.map((s) => `'${s}'`).join(', ')}))`);
    // Exactly one live version per (order, doc_type).
    await knex.raw(`CREATE UNIQUE INDEX uq_gendoc_latest ON generated_documents (order_id, doc_type) WHERE is_latest`);
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('generated_documents');
};
