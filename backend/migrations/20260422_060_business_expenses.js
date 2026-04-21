/**
 * Unified business expenses table.
 *
 * Replaces the need to route all costs through mill_expenses or
 * export_order_costs. Handles general business expenses (utility bills,
 * rent, insurance, inspection fees, etc.) as well as mill and export
 * costs — with optional linking to a batch or order.
 *
 * On creation:
 * - Always creates a payables row (so it shows in Money Out)
 * - If linked to batch → also upserts milling_costs
 * - If linked to order → also upserts export_order_costs
 * - If paid immediately → creates payments row + adjusts bank balance
 */

exports.up = async function (knex) {
  await knex.schema.createTable('business_expenses', (t) => {
    t.increments('id').primary();
    t.string('expense_no', 50).unique().notNullable();

    // Classification
    t.string('expense_type', 20).notNullable().defaultTo('general');
    t.string('category', 50).notNullable();
    t.string('subcategory', 50);

    // Amount
    t.decimal('amount', 15, 2).notNullable();
    t.string('currency', 10).defaultTo('PKR');
    t.decimal('fx_rate', 12, 4);
    t.decimal('amount_pkr', 15, 2);

    // Vendor / Party
    t.integer('supplier_id').unsigned().references('id').inTable('suppliers');
    t.string('vendor_name', 255);

    // Dates
    t.date('expense_date').notNullable();
    t.date('due_date');

    // References
    t.string('invoice_reference', 100);
    t.text('description');
    t.text('notes');

    // Optional links
    t.integer('batch_id').unsigned().references('id').inTable('milling_batches');
    t.integer('order_id').unsigned().references('id').inTable('export_orders');

    // Payment
    t.string('payment_status', 20).defaultTo('Unpaid');
    t.integer('bank_account_id').unsigned().references('id').inTable('bank_accounts');
    t.date('paid_date');
    t.string('payment_method', 30);
    t.string('payment_reference', 100);

    // Audit
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.integer('approved_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  await knex.schema.alterTable('business_expenses', (t) => {
    t.index('expense_type');
    t.index('category');
    t.index('payment_status');
    t.index('expense_date');
    t.index('batch_id');
    t.index('order_id');
  });

  await knex.raw(`
    ALTER TABLE business_expenses
    ADD CONSTRAINT business_expenses_type_chk
    CHECK (expense_type IN ('general','mill','export'));
    ALTER TABLE business_expenses
    ADD CONSTRAINT business_expenses_payment_chk
    CHECK (payment_status IN ('Unpaid','Partial','Paid'));
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('business_expenses');
};
