/**
 * Migration: CRM, Communication & Workflow Automation
 */

exports.up = async function (knex) {
  // 1. Email Logs
  await knex.schema.createTable('email_logs', (t) => {
    t.increments('id').primary();
    t.string('from_email', 255);
    t.string('to_email', 255).notNullable();
    t.string('cc', 500);
    t.string('subject', 500).notNullable();
    t.text('body');
    t.string('template_used', 100);
    t.string('linked_type', 30); // 'export_order', 'milling_batch', 'payment', 'general'
    t.integer('linked_id');
    t.string('status', 20).defaultTo('Sent'); // Sent, Failed, Queued, Bounced
    t.text('error_message');
    t.integer('sent_by').unsigned().references('id').inTable('users');
    t.timestamp('sent_at').defaultTo(knex.fn.now());
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 2. Email Templates
  await knex.schema.createTable('email_templates', (t) => {
    t.increments('id').primary();
    t.string('name', 100).unique().notNullable();
    t.string('slug', 100).unique().notNullable();
    t.string('subject_template', 500).notNullable();
    t.text('body_template').notNullable();
    t.jsonb('available_variables');
    t.string('entity', 10); // null, 'export', 'mill'
    t.boolean('is_active').defaultTo(true);
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // 3. Scheduled Tasks
  await knex.schema.createTable('scheduled_tasks', (t) => {
    t.increments('id').primary();
    t.string('task_type', 50).notNullable(); // 'email_reminder', 'alert_check', 'overdue_scan', 'report_generation'
    t.string('name', 255).notNullable();
    t.string('cron_expression', 50);
    t.timestamp('next_run');
    t.timestamp('last_run');
    t.string('last_status', 20); // 'Success', 'Failed', 'Running'
    t.boolean('is_active').defaultTo(true);
    t.jsonb('config');
    t.timestamps(true, true);
  });

  // 4. Task Execution Log
  await knex.schema.createTable('task_execution_log', (t) => {
    t.increments('id').primary();
    t.integer('task_id').unsigned().references('id').inTable('scheduled_tasks');
    t.timestamp('started_at');
    t.timestamp('completed_at');
    t.string('status', 20); // 'Success', 'Failed'
    t.integer('items_processed').defaultTo(0);
    t.jsonb('details');
    t.text('error');
  });

  // 5. Comments
  await knex.schema.createTable('comments', (t) => {
    t.increments('id').primary();
    t.string('linked_type', 30).notNullable(); // 'export_order', 'milling_batch', 'receivable', 'payable', 'document'
    t.integer('linked_id').notNullable();
    t.integer('user_id').unsigned().references('id').inTable('users');
    t.text('comment').notNullable();
    t.boolean('is_internal').defaultTo(true); // internal note vs customer-visible
    t.jsonb('mentioned_users'); // array of user IDs mentioned
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 6. Task Assignments
  await knex.schema.createTable('tasks_assignments', (t) => {
    t.increments('id').primary();
    t.string('task_no', 20).unique();
    t.string('title', 255).notNullable();
    t.text('description');
    t.string('linked_type', 30);
    t.integer('linked_id');
    t.integer('assigned_to').unsigned().references('id').inTable('users');
    t.integer('assigned_by').unsigned().references('id').inTable('users');
    t.string('priority', 20).defaultTo('Normal'); // Low, Normal, High, Urgent
    t.date('due_date');
    t.string('status', 20).defaultTo('Open'); // Open, In Progress, Completed, Cancelled
    t.timestamp('completed_at');
    t.timestamps(true, true);
  });

  // 7. Follow-ups
  await knex.schema.createTable('follow_ups', (t) => {
    t.increments('id').primary();
    t.string('linked_type', 30).notNullable();
    t.integer('linked_id').notNullable();
    t.integer('user_id').unsigned().references('id').inTable('users');
    t.date('follow_up_date').notNullable();
    t.text('note');
    t.string('status', 20).defaultTo('Pending'); // Pending, Done, Cancelled
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('follow_ups');
  await knex.schema.dropTableIfExists('tasks_assignments');
  await knex.schema.dropTableIfExists('comments');
  await knex.schema.dropTableIfExists('task_execution_log');
  await knex.schema.dropTableIfExists('scheduled_tasks');
  await knex.schema.dropTableIfExists('email_templates');
  await knex.schema.dropTableIfExists('email_logs');
};
