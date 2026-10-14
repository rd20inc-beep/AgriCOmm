/**
 * P2-30 — a reversed statutory remittance keeps its row.
 *
 * Reversing a remittance netted its journal and restored the bank (both kept)
 * but then HARD-DELETED the remittance row, so the record of what was paid to
 * FBR / EOBI, when, from which account and who reversed it was gone. The row
 * now stays with status 'Reversed' and who / when / why.
 *
 * Existing rows are all live remittances → 'Posted'.
 */
exports.up = async function up(knex) {
  const t = 'mill_statutory_remittances';
  if (!(await knex.schema.hasColumn(t, 'status'))) {
    await knex.schema.alterTable(t, (tb) => {
      tb.string('status', 12).notNullable().defaultTo('Posted');
      tb.timestamp('reversed_at', { useTz: true }).nullable();
      tb.integer('reversed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
      tb.text('reversal_reason').nullable();
      tb.index(['reversed_by'], 'idx_mill_statutory_remittances_reversed_by');
    });
  }
  await knex.raw(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS chk_mill_statutory_remittances_status`);
  await knex.raw(`ALTER TABLE ${t} ADD CONSTRAINT chk_mill_statutory_remittances_status CHECK (status IN ('Posted', 'Reversed'))`);
};

exports.down = async function down(knex) {
  const t = 'mill_statutory_remittances';
  await knex.raw(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS chk_mill_statutory_remittances_status`);
  if (await knex.schema.hasColumn(t, 'status')) {
    await knex.schema.alterTable(t, (tb) => {
      tb.dropIndex(['reversed_by'], 'idx_mill_statutory_remittances_reversed_by');
      tb.dropColumn('reversal_reason');
      tb.dropColumn('reversed_by');
      tb.dropColumn('reversed_at');
      tb.dropColumn('status');
    });
  }
};
