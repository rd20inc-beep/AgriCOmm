// Month-end FX revaluation (owner decision G-7, 2026-10-09).
//
// One row per currency + month-end revaluation: the closing rate used (from
// fx_rates — never the 280 / system fallback), what was revalued (open
// foreign AR on 1110, each foreign bank account's GL), the unrealised gain /
// loss posted to 6210, and the journals — dated month-end — plus their
// automatic reversals dated the 1st of the next month.
//
// Idempotent per month: only one 'posted' row per (currency, month_end) (a
// partial unique index). Re-running a month first nets the old pair by signed
// delta and marks its row 'superseded'.

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('fx_revaluations')) return;
  await knex.schema.createTable('fx_revaluations', (t) => {
    t.increments('id').primary();
    t.string('currency', 3).notNullable().defaultTo('USD');
    t.date('month_end').notNullable();
    t.decimal('rate', 14, 6).notNullable();
    t.date('rate_date').notNullable();
    t.integer('rate_id').nullable().references('id').inTable('fx_rates').onDelete('SET NULL');
    t.string('status', 20).notNullable().defaultTo('posted');
    t.decimal('ar_foreign', 18, 2).notNullable().defaultTo(0);
    t.decimal('ar_unrealised_pkr', 18, 2).notNullable().defaultTo(0);
    t.decimal('bank_unrealised_pkr', 18, 2).notNullable().defaultTo(0);
    t.decimal('total_unrealised_pkr', 18, 2).notNullable().defaultTo(0);
    t.jsonb('detail').nullable();
    t.jsonb('journal_ids').nullable();
    t.jsonb('reversal_journal_ids').nullable();
    t.integer('superseded_by').nullable().references('id').inTable('fx_revaluations').onDelete('SET NULL');
    t.timestamp('superseded_at', { useTz: true }).nullable();
    t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['rate_id'], 'idx_fx_revaluations_rate_id');
    t.index(['superseded_by'], 'idx_fx_revaluations_superseded_by');
    t.index(['created_by'], 'idx_fx_revaluations_created_by');
  });
  await knex.raw(`ALTER TABLE fx_revaluations ADD CONSTRAINT chk_fx_revaluations_status_valid CHECK (status IN ('posted', 'superseded'))`);
  await knex.raw(`CREATE UNIQUE INDEX uq_fx_revaluations_posted_month ON fx_revaluations (currency, month_end) WHERE status = 'posted'`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('fx_revaluations');
};
