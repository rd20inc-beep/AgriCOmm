/**
 * P3-11 / INV-55 — local-sale returns (credit notes), owner decision D-22 (a).
 *
 * A confirmed local sale could only be undone by the Super-Admin Danger Zone,
 * which hard-deletes it. A return is now its OWN document, linked to the sale
 * and never an edit of it (D-23):
 *
 *   - the returned rice goes back to the ORIGINAL lot at the ORIGINAL cost —
 *     the COGS the sale posted is reversed by a signed delta (Dr stock /
 *     Cr 5000), never a re-post;
 *   - the revenue is reversed by a signed delta (Dr revenue / Cr 1120);
 *   - what the buyer still owed is reduced first (applied_to_receivable); any
 *     part already paid is refunded (money out, refund_payment_id) or held as
 *     the customer's credit in 1310 (credit_amount, credit_status 'Open').
 *
 * One row per return. Rows are never updated except credit_status, and are
 * never deleted (FKs RESTRICT so a parent cannot take them with it).
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('local_sale_returns', (t) => {
    t.increments('id').primary();
    t.string('return_no', 40).notNullable().unique();
    t.integer('local_sale_id').notNullable()
      .references('id').inTable('local_sales').onDelete('RESTRICT');
    t.integer('lot_id').nullable()
      .references('id').inTable('inventory_lots').onDelete('RESTRICT');
    t.integer('mill_item_id').nullable()
      .references('id').inTable('mill_items').onDelete('RESTRICT');
    t.integer('customer_id').nullable()
      .references('id').inTable('customers').onDelete('RESTRICT');
    t.date('return_date').notNullable();
    // KG for a lot line; the item count for a packaging (mill-item) line —
    // the same convention local_sales.quantity_kg follows.
    t.decimal('quantity_kg', 14, 3).notNullable();
    t.decimal('return_value', 15, 2).notNullable();      // revenue reversed
    t.decimal('cogs_reversed', 15, 2).notNullable().defaultTo(0);
    t.decimal('cost_per_kg', 14, 4).nullable();
    t.string('inventory_account_code', 10).nullable();
    t.decimal('applied_to_receivable', 15, 2).notNullable().defaultTo(0);
    t.decimal('refund_amount', 15, 2).notNullable().defaultTo(0);
    t.decimal('credit_amount', 15, 2).notNullable().defaultTo(0);
    t.string('settlement', 12).notNullable();            // refund | credit | none
    t.integer('refund_payment_id').nullable()
      .references('id').inTable('payments').onDelete('RESTRICT');
    t.string('credit_status', 12).nullable();            // Open | Applied (credit only)
    t.string('reason', 500).notNullable();
    t.integer('authorized_by_owner_id').nullable()
      .references('id').inTable('users').onDelete('RESTRICT');
    t.integer('created_by').nullable()
      .references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.index('local_sale_id');
    t.index('lot_id');
    t.index('customer_id');
  });

  await knex.raw(`ALTER TABLE local_sale_returns
    ADD CONSTRAINT chk_lsr_settlement CHECK (settlement IN ('refund', 'credit', 'none')),
    ADD CONSTRAINT chk_lsr_credit_status CHECK (credit_status IS NULL OR credit_status IN ('Open', 'Applied')),
    ADD CONSTRAINT chk_lsr_amounts_nonneg CHECK (quantity_kg > 0 AND return_value >= 0 AND cogs_reversed >= 0
      AND applied_to_receivable >= 0 AND refund_amount >= 0 AND credit_amount >= 0),
    ADD CONSTRAINT chk_lsr_value_split CHECK (abs(return_value - applied_to_receivable - refund_amount - credit_amount) <= 0.01),
    ADD CONSTRAINT chk_lsr_line CHECK ((lot_id IS NULL) <> (mill_item_id IS NULL))`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('local_sale_returns');
};
