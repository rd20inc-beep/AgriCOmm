/**
 * Head Office ⇄ Mill (and Export) fund transfers.
 *
 * Adds an `entity` tag to bank_accounts so an account can belong to Head Office
 * ('general'), the Mill ('mill') or Export ('export'); seeds a dedicated
 * "Mill Cash" cash account for the mill's float; and creates the `fund_transfers`
 * ledger. The transfer's GL side reuses the existing 1000 Cash & Bank control
 * account and the 1130 Inter-Company Receivable — Mill clearing account, so no new
 * chart-of-accounts rows are needed.
 */
exports.up = async function (knex) {
  // 1) Tag bank accounts with the entity that owns them (existing ⇒ Head Office).
  if (!(await knex.schema.hasColumn('bank_accounts', 'entity'))) {
    await knex.schema.alterTable('bank_accounts', (t) => {
      t.string('entity').notNullable().defaultTo('general'); // general | mill | export
    });
  }

  // 2) Seed a dedicated Mill Cash float (idempotent).
  const millCash = await knex('bank_accounts').where({ name: 'Mill Cash' }).first();
  if (!millCash) {
    await knex('bank_accounts').insert({
      uid: 'MILL-CASH', name: 'Mill Cash', type: 'cash', entity: 'mill',
      currency: 'PKR', current_balance: 0, is_active: true,
    });
  } else if (millCash.entity !== 'mill') {
    await knex('bank_accounts').where({ id: millCash.id }).update({ entity: 'mill' });
  }

  // 3) Fund-transfer ledger.
  if (!(await knex.schema.hasTable('fund_transfers'))) {
    await knex.schema.createTable('fund_transfers', (t) => {
      t.increments('id').primary();
      t.string('transfer_no').notNullable().unique();
      t.string('direction').notNullable();          // ho_to_mill | mill_to_ho | (extensible)
      t.string('from_entity').notNullable();         // general | mill | export
      t.string('to_entity').notNullable();
      t.integer('from_account_id').unsigned().references('id').inTable('bank_accounts').onDelete('SET NULL');
      t.integer('to_account_id').unsigned().references('id').inTable('bank_accounts').onDelete('SET NULL');
      t.decimal('amount', 14, 2).notNullable();
      t.string('currency').notNullable().defaultTo('PKR');
      t.date('transfer_date').notNullable();
      t.string('method').notNullable().defaultTo('cash'); // cash | bank_transfer | cheque
      t.string('reference');
      t.text('notes');
      t.string('status').notNullable().defaultTo('completed');
      t.string('je_ref_no');                          // ref_no stamped on the GL journals
      t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
      t.index('from_account_id');
      t.index('to_account_id');
      t.index('transfer_date');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('fund_transfers');
  // Leave the Mill Cash account + bank_accounts.entity in place on rollback; they
  // are harmless and may already carry data.
};
