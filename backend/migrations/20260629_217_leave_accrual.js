/**
 * Leave accrual + carry-forward (Phase 24).
 *
 * Adds accrual config to mill_leave_types: `accrues` (balance builds monthly =
 * quota × months-elapsed/12, vs the whole quota being available up-front),
 * `carry_forward` (unused prior-year balance rolls in) + `max_carry` cap.
 * Default accrues=false so existing types keep the Phase-23 whole-quota
 * behaviour until an admin opts a type into accrual. Additive.
 */
exports.up = async function up(knex) {
  if (await knex.schema.hasColumn('mill_leave_types', 'accrues')) return;
  await knex.schema.alterTable('mill_leave_types', (t) => {
    t.boolean('accrues').notNullable().defaultTo(false);
    t.boolean('carry_forward').notNullable().defaultTo(false);
    t.decimal('max_carry', 6, 2).nullable(); // cap on carried-forward days; null = uncapped
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('mill_leave_types', 'accrues'))) return;
  await knex.schema.alterTable('mill_leave_types', (t) => {
    t.dropColumn('accrues'); t.dropColumn('carry_forward'); t.dropColumn('max_carry');
  });
};
