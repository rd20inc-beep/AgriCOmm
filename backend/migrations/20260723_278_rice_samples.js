// Sample Analysis & Purchase Shortlisting (client change request #7).
//
// Record rice samples offered by suppliers, run quality analysis (an INITIAL and
// an optional FINAL pre-purchase analysis kept separately so differences show),
// shortlist/reject/hold them, then convert an approved sample into a purchase lot
// — carrying supplier / variety / grade / analysis / rate / qty forward and
// keeping a two-way link (rice_samples.converted_lot_id ↔ inventory_lots.sample_id).
//
// Analysis is stored as jsonb (analysis_json / final_analysis_json) so the field
// set can grow without a migration; it reuses the same key set as
// inventory_lots.quality_json so conversion is a straight pass-through.

const STATUSES = ['Under Review', 'Shortlisted', 'Rejected', 'Hold', 'Reanalysis Required', 'Approved for Purchase', 'Converted'];

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('rice_samples'))) {
    await knex.schema.createTable('rice_samples', (t) => {
      t.increments('id').primary();
      t.string('sample_no', 30).notNullable().unique();
      t.date('sample_date').notNullable();
      t.integer('supplier_id').references('id').inTable('suppliers');
      t.string('supplier_sample_ref', 100); // the supplier's own reference for the sample
      t.integer('product_id').references('id').inTable('products');
      t.string('variety', 100);
      t.string('claimed_grade', 60);
      t.string('origin_area', 150);
      t.string('crop_year', 20);
      t.decimal('offered_qty_kg', 15, 2);
      t.decimal('offered_rate_per_kg', 14, 4);
      t.integer('bags');
      t.decimal('bag_weight_kg', 10, 2);
      t.text('remarks');
      t.text('attachment_url'); // convenience pointer; richer attachments via /documents (linked_type='sample')
      // Quality analyses — jsonb, same key set as inventory_lots.quality_json.
      t.jsonb('analysis_json'); // initial sample analysis
      t.jsonb('final_analysis_json'); // final / pre-purchase analysis
      t.timestamp('analyzed_at');
      t.timestamp('final_analyzed_at');
      t.string('status', 30).notNullable().defaultTo('Under Review');
      t.text('decision_notes');
      t.integer('converted_lot_id').references('id').inTable('inventory_lots').onDelete('SET NULL');
      t.timestamp('converted_at');
      t.integer('created_by').references('id').inTable('users');
      t.integer('decided_by').references('id').inTable('users');
      t.timestamps(true, true);
      t.index(['status']);
      t.index(['supplier_id']);
      t.index(['product_id']);
    });
    await knex.raw(
      `ALTER TABLE rice_samples ADD CONSTRAINT chk_rice_samples_status_valid ` +
      `CHECK (status IN (${STATUSES.map((s) => `'${s}'`).join(', ')}))`
    );
  }

  // Reverse link: a purchase lot created from a sample points back at it.
  if (!(await knex.schema.hasColumn('inventory_lots', 'sample_id'))) {
    await knex.schema.alterTable('inventory_lots', (t) => {
      t.integer('sample_id').references('id').inTable('rice_samples');
    });
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_inventory_lots_sample_id ON inventory_lots (sample_id)`);
  }
};

exports.down = async (knex) => {
  await knex.raw(`DROP INDEX IF EXISTS idx_inventory_lots_sample_id`);
  if (await knex.schema.hasColumn('inventory_lots', 'sample_id')) {
    await knex.schema.alterTable('inventory_lots', (t) => t.dropColumn('sample_id'));
  }
  await knex.schema.dropTableIfExists('rice_samples');
};
