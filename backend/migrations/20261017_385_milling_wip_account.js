/**
 * P3-09 / owner decision D-6 (a) — Milling Work-in-Progress.
 *
 * Rice committed to a milling batch leaves its stock account (1210 Raw Rice,
 * or 1220 / 1240 for a re-mill) for 1260 Milling WIP when it is committed, and
 * the batch's completion relieves WIP into finished / by-product stock. Before
 * this the GL carried committed rice in 1210 until the yield while the lots
 * had already set it aside, which is the GL-vs-lots gap the stock tie-out
 * could never explain.
 *
 * 1260 is the next free code in the 12xx inventory group (1210 Raw, 1220
 * Finished Mill, 1230 Finished Export, 1240 By-Products, 1250 Bags; 1290 is
 * Suspense). As a 12xx account it is a control account: manual journals can't
 * touch it (controlAccounts.js). Idempotent; down() removes it only when
 * nothing has posted to it.
 */
const CODE = '1260';

exports.up = async function up(knex) {
  const exists = await knex('chart_of_accounts').where({ code: CODE }).first();
  if (exists) return;
  const parent = await knex('chart_of_accounts').where({ code: '1200' }).first('id');
  await knex('chart_of_accounts').insert({
    code: CODE,
    name: 'Milling WIP',
    type: 'Asset',
    sub_type: 'Current Asset',
    parent_id: parent ? parent.id : null,
    entity: 'mill',
    currency: 'PKR',
    normal_balance: 'debit',
    is_system: true,
    is_active: true,
    description: 'Rice committed to an open milling batch (D-6). Relieved into finished / by-product stock at yield; returned to stock when a batch is cancelled.',
  });
};

exports.down = async function down(knex) {
  const acc = await knex('chart_of_accounts').where({ code: CODE }).first('id');
  if (!acc) return;
  const used = await knex('journal_lines').where({ account_id: acc.id }).first('id');
  if (!used) await knex('chart_of_accounts').where({ id: acc.id }).del();
};
