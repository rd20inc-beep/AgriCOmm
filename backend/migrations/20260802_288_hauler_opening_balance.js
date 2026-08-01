// Transporter opening balance (spec item #14, Phase 1c ledger). A carried-forward
// amount owed to a transporter at system start, used as the ledger's opening line.

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('haulers', 'opening_balance'))) {
    await knex.schema.alterTable('haulers', (t) => {
      t.decimal('opening_balance', 14, 2).notNullable().defaultTo(0);
    });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('haulers', 'opening_balance')) {
    await knex.schema.alterTable('haulers', (t) => t.dropColumn('opening_balance'));
  }
};
