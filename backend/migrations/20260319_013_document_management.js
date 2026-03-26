/**
 * Migration: Document Management & Approval Workflow
 */

exports.up = async function (knex) {
  // 1. Document Store
  await knex.schema.createTable('document_store', (t) => {
    t.increments('id').primary();
    t.string('doc_uid', 50).unique().notNullable();
    t.string('entity', 10); // 'export' or 'mill'
    t.string('linked_type', 30).notNullable(); // 'export_order', 'milling_batch', 'purchase_order', 'shipment', 'general'
    t.integer('linked_id');
    t.string('doc_type', 50).notNullable(); // 'proforma_invoice', 'commercial_invoice', 'packing_list', etc.
    t.string('title', 255).notNullable();
    t.text('description');
    t.string('file_name', 255);
    t.text('file_path');
    t.integer('file_size'); // bytes
    t.string('mime_type', 100);
    t.integer('version').defaultTo(1);
    t.boolean('is_latest').defaultTo(true);
    t.integer('previous_version_id').references('id').inTable('document_store');
    t.string('status', 20).defaultTo('Draft'); // Draft, Pending Review, Under Review, Approved, Rejected, Final, Expired, Superseded
    t.integer('uploaded_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // 2. Document Approvals
  await knex.schema.createTable('document_approvals', (t) => {
    t.increments('id').primary();
    t.integer('document_id').unsigned().references('id').inTable('document_store').onDelete('CASCADE');
    t.integer('approver_id').unsigned().references('id').inTable('users');
    t.string('action', 20).notNullable(); // 'approve', 'reject', 'review', 'request_revision'
    t.text('comments');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 3. Document Checklists
  await knex.schema.createTable('document_checklists', (t) => {
    t.increments('id').primary();
    t.string('linked_type', 30).notNullable();
    t.integer('linked_id').notNullable();
    t.string('doc_type', 50).notNullable();
    t.boolean('is_required').defaultTo(true);
    t.boolean('is_fulfilled').defaultTo(false);
    t.integer('document_id').unsigned().references('id').inTable('document_store');
    t.date('due_date');
    t.text('notes');
    t.timestamps(true, true);
  });

  // 4. Document Templates
  await knex.schema.createTable('document_templates', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.string('doc_type', 50).notNullable();
    t.string('entity', 10);
    t.text('template_content'); // HTML/JSON template
    t.jsonb('variables'); // available merge variables
    t.boolean('is_active').defaultTo(true);
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // 5. Document Dispatch Log
  await knex.schema.createTable('document_dispatch_log', (t) => {
    t.increments('id').primary();
    t.integer('document_id').unsigned().references('id').inTable('document_store');
    t.string('dispatched_to', 255); // email or name
    t.string('dispatch_method', 20); // 'email', 'courier', 'hand_delivery', 'portal'
    t.timestamp('dispatch_date');
    t.string('tracking_ref', 100);
    t.string('status', 20).defaultTo('Sent'); // Sent, Delivered, Returned
    t.text('notes');
    t.integer('dispatched_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Seed default document checklists for export orders (7 required docs)
  // These are template entries with linked_id = 0 to serve as defaults
  const exportDocTypes = [
    'phyto',
    'bl_draft',
    'bl_final',
    'commercial_invoice',
    'packing_list',
    'coo',
    'fumigation',
  ];

  const millingDocTypes = [
    'quality_report',
    'costing_sheet',
    'grn',
  ];

  const now = new Date().toISOString();

  // Insert default checklist templates (linked_id = 0 as template marker)
  const exportDefaults = exportDocTypes.map((docType) => ({
    linked_type: 'export_order',
    linked_id: 0,
    doc_type: docType,
    is_required: true,
    is_fulfilled: false,
    notes: 'Default checklist item for export orders',
    created_at: now,
    updated_at: now,
  }));

  const millingDefaults = millingDocTypes.map((docType) => ({
    linked_type: 'milling_batch',
    linked_id: 0,
    doc_type: docType,
    is_required: true,
    is_fulfilled: false,
    notes: 'Default checklist item for milling batches',
    created_at: now,
    updated_at: now,
  }));

  await knex('document_checklists').insert([...exportDefaults, ...millingDefaults]);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('document_dispatch_log');
  await knex.schema.dropTableIfExists('document_templates');
  await knex.schema.dropTableIfExists('document_checklists');
  await knex.schema.dropTableIfExists('document_approvals');
  await knex.schema.dropTableIfExists('document_store');
};
