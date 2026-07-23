// Suspense Account (client change request #8) — a Finance holding account for
// money that can't yet be assigned to the right customer / supplier / expense /
// income / order / ledger. Money sits in a real bank/cash account but is booked
// against the 1290 Suspense control account; Finance later RESOLVES (reclassifies)
// each entry to its true account via a balancing journal. The original suspense
// entry + its journal are NEVER deleted — resolution posts a reclass journal and
// reversal flips the journal to 'Reversed' (per the repo's GL reversal semantics).
//
// Tables:
//   suspense_entries      — one unidentified receipt/payment sitting in suspense
//   suspense_resolutions  — the reclass allocations (1..N) that clear an entry
// COA:
//   1290 Suspense Account (Asset / Current Asset) — the control account.

const COA_CODE = '1290';
const ENTRY_STATUSES = ['Open', 'Under Review', 'Partially Resolved', 'Resolved', 'Reversed'];
const DIRECTIONS = ['receipt', 'payment'];

exports.up = async (knex) => {
  // ── 1. Seed the Suspense control account (idempotent) ──
  const existing = await knex('chart_of_accounts').where({ code: COA_CODE }).first();
  if (!existing) {
    await knex('chart_of_accounts').insert({
      code: COA_CODE,
      name: 'Suspense Account',
      type: 'Asset',
      sub_type: 'Current Asset',
      parent_id: null,
      entity: null,
      currency: 'PKR',
      normal_balance: 'debit', // control account — may carry a debit or credit balance
      is_system: true,
      is_active: true,
      description: 'Holding account for unidentified / unallocated money pending resolution.',
    });
  }

  // ── 2. suspense_entries ──
  if (!(await knex.schema.hasTable('suspense_entries'))) {
    await knex.schema.createTable('suspense_entries', (t) => {
      t.increments('id').primary();
      t.string('entry_no', 30).notNullable().unique();
      t.date('date').notNullable();
      t.string('entity', 10); // null | 'mill' | 'export'
      t.string('direction', 20).notNullable(); // 'receipt' (money in) | 'payment' (money out)
      t.decimal('amount', 15, 2).notNullable();
      t.string('currency', 10).notNullable().defaultTo('PKR');
      t.string('payment_method', 30);
      t.integer('bank_account_id').references('id').inTable('bank_accounts');
      t.integer('bank_transaction_id').references('id').inTable('bank_transactions');
      t.integer('origin_journal_id').references('id').inTable('journal_entries'); // DR Bank / CR Suspense (or reverse)
      t.string('reference_no', 100);
      t.string('party_details', 255); // payer or payee, free text (identity unknown by definition)
      t.text('reason');
      t.string('status', 20).notNullable().defaultTo('Open');
      t.decimal('resolved_amount', 15, 2).notNullable().defaultTo(0);
      t.text('attachment_url');
      t.integer('entered_by').references('id').inTable('users');
      t.integer('resolved_by').references('id').inTable('users');
      t.timestamp('resolved_at');
      t.text('notes');
      t.timestamps(true, true);
      t.index(['status']);
      t.index(['bank_account_id']);
    });
    await knex.raw(
      `ALTER TABLE suspense_entries ADD CONSTRAINT chk_suspense_entries_status_valid ` +
      `CHECK (status IN (${ENTRY_STATUSES.map((s) => `'${s}'`).join(', ')}))`
    );
    await knex.raw(
      `ALTER TABLE suspense_entries ADD CONSTRAINT chk_suspense_entries_direction_valid ` +
      `CHECK (direction IN (${DIRECTIONS.map((d) => `'${d}'`).join(', ')}))`
    );
  }

  // ── 3. suspense_resolutions (polymorphic reclass allocations) ──
  if (!(await knex.schema.hasTable('suspense_resolutions'))) {
    await knex.schema.createTable('suspense_resolutions', (t) => {
      t.increments('id').primary();
      t.integer('suspense_entry_id').notNullable().references('id').inTable('suspense_entries').onDelete('CASCADE');
      t.decimal('amount', 15, 2).notNullable();
      t.integer('account_id').notNullable().references('id').inTable('chart_of_accounts'); // reclassified-to GL account
      // Polymorphic business reference (customer|supplier|export_order|local_sale|
      // inventory_lot|service_milling_invoice|mill_worker|expense|income|other) — for
      // traceability + party stamping; string id accommodates order_no/lot_no or numeric id.
      t.string('target_type', 30);
      t.string('target_id', 50);
      t.string('target_ref', 255);
      t.integer('reclass_journal_id').references('id').inTable('journal_entries'); // DR/CR Suspense ↔ account
      t.text('narration');
      t.integer('created_by').references('id').inTable('users');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['suspense_entry_id']);
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('suspense_resolutions');
  await knex.schema.dropTableIfExists('suspense_entries');
  // Leave the 1290 COA account in place if it carries any postings; only remove
  // it when unused so a rollback never orphans journal_lines.
  const acct = await knex('chart_of_accounts').where({ code: COA_CODE }).first();
  if (acct) {
    const used = await knex('journal_lines').where({ account_id: acct.id }).first();
    if (!used) await knex('chart_of_accounts').where({ id: acct.id }).del();
  }
};
