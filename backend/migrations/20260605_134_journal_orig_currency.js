/**
 * Original transaction currency metadata on journal_entries.
 *
 * The GL is PKR-base: every aggregation (trial balance, P&L, balance sheet,
 * account balances) sums journal_lines RAW, assuming PKR. So all lines must be
 * stored in PKR. These two columns record the ORIGINAL foreign currency + rate
 * of the transaction (e.g. a USD export advance), without affecting the PKR
 * line amounts — purely so party statements can show an EXACT USD equivalent
 * (line_pkr ÷ orig_fx_rate) instead of approximating at the current rate.
 *
 *   orig_currency : 'USD' | 'EUR' | … (null = native PKR transaction)
 *   orig_fx_rate  : the original foreign→PKR rate (e.g. 282)
 *
 * Idempotent.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('journal_entries'))) return;
  if (await knex.schema.hasColumn('journal_entries', 'orig_currency')) return;
  await knex.schema.alterTable('journal_entries', (t) => {
    t.string('orig_currency', 10);
    t.decimal('orig_fx_rate', 15, 6);
  });
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('journal_entries'))) return;
  if (await knex.schema.hasColumn('journal_entries', 'orig_currency')) {
    await knex.schema.alterTable('journal_entries', (t) => {
      t.dropColumn('orig_currency');
      t.dropColumn('orig_fx_rate');
    });
  }
};
