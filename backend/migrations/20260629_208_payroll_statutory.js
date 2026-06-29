/**
 * Payroll tax & statutory deductions (Phase 12).
 *
 * Configurable, rule-driven deductions (income tax withholding, EOBI, etc.)
 * applied automatically at payroll time and tracked as a liability the company
 * must remit. Three additive pieces:
 *  1. Liability accounts 2050 Tax Payable + 2055 EOBI Payable (children of 2000
 *     Accounts Payable, mirroring 2010) — what statutory withholding credits.
 *  2. mill_statutory_deductions — the org-level rule table (percent / fixed /
 *     slab; gross or basic base; pay-type filter; threshold; target liability).
 *  3. statutory_total + statutory_json snapshot columns on mill_payroll_lines.
 *
 * Rules are NOT seeded (rates change; admin configures them). The accounts are
 * idempotent; the table + columns are guarded.
 */
exports.up = async function up(knex) {
  // 1) Liability accounts (mirror 2010 Supplier Payable classification).
  const parent = await knex('chart_of_accounts').where('code', '2000').first();
  const sup = await knex('chart_of_accounts').where('code', '2010').first();
  const mk = (code, name, description) => ({
    code, name,
    type: sup ? sup.type : 'Liability',
    sub_type: sup ? sup.sub_type : 'Current Liability',
    normal_balance: sup ? sup.normal_balance : 'credit',
    currency: sup ? sup.currency : 'PKR',
    parent_id: parent ? parent.id : null,
    entity: 'mill', is_active: true, is_system: false, description,
  });
  for (const acc of [
    mk('2050', 'Tax Payable', 'Income tax withheld from staff salaries, payable to FBR.'),
    mk('2055', 'EOBI Payable', 'EOBI / statutory contributions withheld from staff, payable to the authority.'),
  ]) {
    const exists = await knex('chart_of_accounts').where('code', acc.code).first();
    if (!exists) await knex('chart_of_accounts').insert(acc);
  }

  // 2) Rule table.
  if (!(await knex.schema.hasTable('mill_statutory_deductions'))) {
    await knex.schema.createTable('mill_statutory_deductions', (t) => {
      t.increments('id').primary();
      t.string('name', 120).notNullable();
      t.string('code', 30).notNullable();
      t.string('calc_method', 20).notNullable().defaultTo('percent'); // percent | fixed | slab
      t.decimal('rate', 9, 4).defaultTo(0);              // percent of base
      t.decimal('fixed_amount', 14, 2).defaultTo(0);     // flat amount
      t.string('base', 20).notNullable().defaultTo('gross'); // gross | basic
      t.jsonb('slabs').nullable();                       // [{threshold, rate, base}] annual brackets
      t.decimal('min_gross', 14, 2).defaultTo(0);        // only apply when base >= this
      t.string('applies_to', 20).notNullable().defaultTo('all'); // all | monthly | daily
      t.string('liability_account_code', 20).notNullable().defaultTo('2050');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').defaultTo(0);
      t.text('notes').nullable();
      t.integer('created_by').nullable();
      t.timestamps(true, true);
    });
  }

  // 3) Per-line snapshot of statutory withheld (+ the per-rule breakdown).
  if (!(await knex.schema.hasColumn('mill_payroll_lines', 'statutory_total'))) {
    await knex.schema.alterTable('mill_payroll_lines', (t) => {
      t.decimal('statutory_total', 14, 2).notNullable().defaultTo(0);
      t.jsonb('statutory_json').nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('mill_payroll_lines', 'statutory_total')) {
    await knex.schema.alterTable('mill_payroll_lines', (t) => {
      t.dropColumn('statutory_total');
      t.dropColumn('statutory_json');
    });
  }
  await knex.schema.dropTableIfExists('mill_statutory_deductions');
  await knex('chart_of_accounts').whereIn('code', ['2050', '2055']).del();
};
