/**
 * P2-28 / owner decision D-9 — the Owner's personal expenses are DRAWINGS
 * (equity), not operating expense.
 *
 * A "Personal / Owner" expense posted Dr 6000 Operating Expenses, understating
 * profit by every rupee the owner took. It now posts Dr 3030 Owner's Drawings,
 * an Equity account with a debit normal balance: it reduces equity on the
 * balance sheet and never touches the P&L.
 *
 * The chart had no drawings account (3000 Owner's Equity, 3010 Capital, 3020
 * Retained Earnings), so 3030 is added under 3000. Idempotent; down() removes
 * it only when nothing has posted to it.
 */
const CODE = '3030';

exports.up = async function up(knex) {
  const exists = await knex('chart_of_accounts').where({ code: CODE }).first();
  if (exists) return;
  const parent = await knex('chart_of_accounts').where({ code: '3000' }).first('id');
  await knex('chart_of_accounts').insert({
    code: CODE,
    name: "Owner's Drawings",
    type: 'Equity',
    sub_type: 'Equity',
    parent_id: parent ? parent.id : null,
    entity: null,
    currency: 'PKR',
    normal_balance: 'debit',
    is_system: true,
    is_active: true,
    description: "Owner's personal expenses paid by the business (D-9). Reduces equity; not an operating expense.",
  });
};

exports.down = async function down(knex) {
  const acc = await knex('chart_of_accounts').where({ code: CODE }).first('id');
  if (!acc) return;
  const used = await knex('journal_lines').where({ account_id: acc.id }).first('id');
  if (!used) await knex('chart_of_accounts').where({ id: acc.id }).del();
};
