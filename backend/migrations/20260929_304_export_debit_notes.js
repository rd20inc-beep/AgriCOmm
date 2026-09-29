/**
 * Freight escalation debit notes.
 *
 * The escalation clause that migrations 302/303 put on the Proforma and the
 * Sales Contract says that any rise in ocean freight, BAF, war-risk or
 * congestion between the date the rate was quoted and the date of the Bill of
 * Lading is for the Buyer's account, "and shall be invoiced by debit note,
 * payable together with the balance of the contract value."
 *
 * This is that debit note. It is raised AFTER shipment, when the carrier's
 * actual charge is known, so it cannot go through the order edit — quantity,
 * price and freight are all locked by then, and rightly so.
 *
 * It is a document in its own right (its own number, date and reason), but the
 * money it claims is added to the BALANCE, exactly as the clause says: the buyer
 * wires one amount against documents, and the existing balance-confirmation flow
 * settles it with no separate reconciliation. GL is DR 1110 Export AR /
 * CR 4070 Freight & Insurance Recovered, the same pair the original freight
 * used, so the P&L keeps showing recovery against 6010 Freight & Shipping.
 *
 * Cancelling posts a SIGNED DELTA journal rather than reversing and reposting —
 * the trial balance and every ledger count Posted journals only, so a
 * reverse-and-repost would subtract the amount twice.
 */
exports.up = async (knex) => {
  await knex.schema.createTable('export_debit_notes', (t) => {
    t.increments('id').primary();
    t.string('debit_note_no', 50).notNullable().unique();
    t.integer('order_id').notNullable().references('id').inTable('export_orders').onDelete('CASCADE');
    t.integer('customer_id').references('id').inTable('customers').onDelete('SET NULL');
    t.date('issue_date').notNullable();

    // What is being claimed, in the ORDER's currency. amount_pkr is the same at
    // the rate below — journals post in PKR, like every other export journal.
    t.string('currency', 3).notNullable().defaultTo('USD');
    t.decimal('amount', 14, 2).notNullable();
    t.decimal('fx_rate', 14, 6).nullable();
    t.decimal('amount_pkr', 16, 2).notNullable().defaultTo(0);

    // The narrative the buyer needs to accept the claim: what the rate was when
    // the contract was priced, what it became, and over how many tons. All
    // optional — a congestion surcharge is a lump sum with no per-MT story.
    t.string('basis', 30).notNullable().defaultTo('freight_escalation');
    t.decimal('old_rate_per_mt', 14, 2).nullable();
    t.decimal('new_rate_per_mt', 14, 2).nullable();
    t.decimal('qty_mt', 14, 3).nullable();
    t.text('reason').nullable();

    t.string('status', 20).notNullable().defaultTo('Issued');
    t.integer('journal_id').nullable();
    t.integer('cancel_journal_id').nullable();
    t.text('cancel_reason').nullable();
    t.integer('cancelled_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('cancelled_at', { useTz: true }).nullable();

    t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);

    t.index(['order_id']);
    t.index(['customer_id']);
  });

  await knex.raw(`
    ALTER TABLE export_debit_notes
      ADD CONSTRAINT chk_export_debit_notes_status_valid
      CHECK (status IN ('Issued', 'Cancelled'))
  `);
  await knex.raw(`
    ALTER TABLE export_debit_notes
      ADD CONSTRAINT chk_export_debit_notes_basis_valid
      CHECK (basis IN ('freight_escalation', 'insurance', 'surcharge', 'other'))
  `);
  // A debit note claims money. Zero or less is not a claim, and a negative one
  // would quietly reduce AR through a document nobody reads as a credit note.
  await knex.raw(`
    ALTER TABLE export_debit_notes
      ADD CONSTRAINT chk_export_debit_notes_amount_positive
      CHECK (amount > 0)
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('export_debit_notes');
};
