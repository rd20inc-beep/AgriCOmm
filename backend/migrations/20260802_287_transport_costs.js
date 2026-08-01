// Transport Cost / Transporter Payable backbone (spec item #14, Phase 1a).
//
// A dedicated record for every transport charge — richer than the lot's
// transport_cost field and able to represent charges that are NOT a company
// payable (supplier-paid / client-paid), which a payable-only model can't.
// When paid_by='company' the row links to a payables row (payable_id) and the
// cost is capitalised into the lot/batch cost; otherwise no company payable is
// created. Powers the AP → Transporters view, transporter ledger, payment
// workflow, reports and reconciliation built in later phases.

const PAID_BY = [
  'company', 'supplier', 'customer', 'service_client',
  'included_in_supplier_rate', 'deduct_from_supplier', 'other',
];
const STATUSES = [
  'draft', 'pending_approval', 'approved', 'unpaid',
  'partially_paid', 'paid', 'disputed', 'cancelled', 'reversed',
];

exports.up = async (knex) => {
  if (await knex.schema.hasTable('transport_costs')) return;
  await knex.schema.createTable('transport_costs', (t) => {
    t.increments('id').primary();
    // Parties / references
    t.integer('hauler_id').references('id').inTable('haulers').onDelete('SET NULL');
    t.integer('lot_id').references('id').inTable('inventory_lots').onDelete('SET NULL');
    t.integer('batch_id').references('id').inTable('milling_batches').onDelete('SET NULL');
    t.integer('warehouse_id').references('id').inTable('warehouses').onDelete('SET NULL');
    // Who ultimately bears the charge → whether a company payable is created.
    t.integer('supplier_id').references('id').inTable('suppliers').onDelete('SET NULL'); // deduct-from / included-in-rate
    t.integer('customer_id').references('id').inTable('customers').onDelete('SET NULL'); // client / service-milling
    // Operational detail
    t.string('vehicle_no', 60);
    t.string('driver_name', 120);
    t.string('transport_type', 40);        // inbound / outbound / inter-warehouse / other (free-form)
    t.decimal('amount', 14, 2).notNullable().defaultTo(0);
    t.string('paid_by', 32).notNullable().defaultTo('company');
    t.string('status', 24).notNullable().defaultTo('unpaid');
    t.date('expense_date');
    t.string('doc_no', 80);                 // invoice / bilty / receipt number
    t.string('attachment_path', 500);
    t.text('notes');
    t.string('entity', 20).notNullable().defaultTo('mill');
    // Company payable link (set only when paid_by='company')
    t.integer('payable_id').references('id').inTable('payables').onDelete('SET NULL');
    t.integer('created_by').references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['hauler_id']);
    t.index(['lot_id']);
    t.index(['batch_id']);
    t.index(['status']);
    t.index(['paid_by']);
  });
  await knex.raw(
    `ALTER TABLE transport_costs ADD CONSTRAINT chk_transport_costs_paid_by ` +
    `CHECK (paid_by IN (${PAID_BY.map((s) => `'${s}'`).join(', ')}))`
  );
  await knex.raw(
    `ALTER TABLE transport_costs ADD CONSTRAINT chk_transport_costs_status ` +
    `CHECK (status IN (${STATUSES.map((s) => `'${s}'`).join(', ')}))`
  );
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('transport_costs');
};
