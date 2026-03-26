/**
 * Migration: Intelligence Dashboard & Exception System (Phase 12)
 * Tables: exception_inbox, risk_scores, root_cause_analyses, dashboard_snapshots
 */

exports.up = async function (knex) {
  // 1. Exception Inbox
  await knex.schema.createTable('exception_inbox', (t) => {
    t.increments('id').primary();
    t.string('exception_type', 50).notNullable(); // qc_failure, overdue_advance, overdue_balance, missing_documents, low_margin, negative_margin, unmatched_bank, delayed_shipment, stock_shortage, high_cost_variance, yield_below_benchmark, supplier_rejection
    t.string('severity', 10).notNullable().defaultTo('warning'); // critical, warning, info
    t.string('entity', 10); // 'export', 'mill', null for shared
    t.string('linked_type', 30); // export_order, milling_batch, receivable, bank_transaction, inventory_lot, supplier
    t.integer('linked_id');
    t.string('linked_ref', 50); // e.g. 'EX-101', 'M-201'
    t.string('title', 255).notNullable();
    t.text('description');
    t.decimal('metric_value', 15, 2); // the problematic value (e.g. margin %, days overdue)
    t.decimal('threshold_value', 15, 2); // what it should be
    t.decimal('amount_at_risk', 15, 2);
    t.string('currency', 10);
    t.integer('assigned_to').unsigned().references('id').inTable('users');
    t.string('status', 20).defaultTo('Open'); // Open, Acknowledged, In Progress, Resolved, Snoozed, Escalated
    t.text('resolution_notes');
    t.integer('resolved_by').unsigned().references('id').inTable('users');
    t.timestamp('resolved_at');
    t.date('snoozed_until');
    t.boolean('auto_generated').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // 2. Risk Scores
  await knex.schema.createTable('risk_scores', (t) => {
    t.increments('id').primary();
    t.string('entity_type', 30).notNullable(); // export_order, customer, supplier, milling_batch
    t.integer('entity_id').notNullable();
    t.string('entity_ref', 50);
    t.decimal('risk_score', 5, 2); // 0-100 (higher = more risky)
    t.string('risk_level', 20); // Low, Medium, High, Critical
    t.jsonb('risk_factors'); // array of { factor, score, weight, detail }
    t.decimal('financial_exposure', 15, 2);
    t.string('currency', 10);
    t.timestamp('calculated_at').defaultTo(knex.fn.now());
  });

  // 3. Root Cause Analyses
  await knex.schema.createTable('root_cause_analyses', (t) => {
    t.increments('id').primary();
    t.string('analysis_type', 50).notNullable(); // margin_drop, cost_overrun, yield_loss, payment_delay, quality_issue
    t.string('linked_type', 30);
    t.integer('linked_id');
    t.string('linked_ref', 50);
    t.text('summary');
    t.jsonb('factors'); // array of { category, expected, actual, variance, impact_pct, explanation }
    t.decimal('total_impact', 15, 2);
    t.string('currency', 10);
    t.jsonb('recommendations'); // array of strings
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 4. Dashboard Snapshots
  await knex.schema.createTable('dashboard_snapshots', (t) => {
    t.increments('id').primary();
    t.date('snapshot_date').notNullable();
    t.string('entity', 10); // null for all, 'export', 'mill'
    t.jsonb('metrics'); // full snapshot of all KPIs
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('dashboard_snapshots');
  await knex.schema.dropTableIfExists('root_cause_analyses');
  await knex.schema.dropTableIfExists('risk_scores');
  await knex.schema.dropTableIfExists('exception_inbox');
};
