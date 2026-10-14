/**
 * Salary advances are a staff-advance ASSET recovered from salary (owner
 * decision D-11, 2026-10-15) — no longer an expense at payout.
 *
 *   chart_of_accounts            + 1330 Staff Advances (Asset, under 1300)
 *   mill_worker_advances.payout_gl
 *       'expensed' — paid before this change: the payout was booked Dr 6135
 *                    Salaries, so recovering it books nothing more (every row
 *                    already paid is backfilled to this — forward-only, no
 *                    history is rewritten);
 *       'asset'    — paid from now on: Dr 1330 at payout, and each recovery
 *                    from salary moves it to cost (Dr 6135 / Cr 1330).
 *   mill_worker_advances paid_at / paid_by / pay_method / bank_account_id —
 *       what the pay drawer captured (the payout used to take the request date).
 *   mill_worker_advances voided_at / voided_by / void_reason, and 'voided' in
 *       both status CHECKs — a paid advance is voided (its payout reversed),
 *       never deleted (D-23).
 *
 * Idempotent; down() refuses while any row uses a new value.
 */

const APPROVAL = ['pending', 'approved', 'rejected', 'paid'];
const STATUS = ['outstanding', 'recovered', 'pending'];
const list = (vals) => vals.map((v) => `'${v}'`).join(', ');

async function setChecks(knex, approval, status) {
  await knex.raw('ALTER TABLE mill_worker_advances DROP CONSTRAINT IF EXISTS chk_mill_worker_advances_approval_status_valid');
  await knex.raw(`ALTER TABLE mill_worker_advances ADD CONSTRAINT chk_mill_worker_advances_approval_status_valid CHECK ((approval_status IS NULL) OR (approval_status IN (${list(approval)})))`);
  await knex.raw('ALTER TABLE mill_worker_advances DROP CONSTRAINT IF EXISTS chk_mill_worker_advances_status_valid');
  await knex.raw(`ALTER TABLE mill_worker_advances ADD CONSTRAINT chk_mill_worker_advances_status_valid CHECK ((status IS NULL) OR (status IN (${list(status)})))`);
}

const COLS = [
  ['payout_gl', (t) => t.string('payout_gl', 10).notNullable().defaultTo('expensed')],
  ['paid_at', (t) => t.date('paid_at').nullable()],
  ['paid_by', (t) => t.integer('paid_by').nullable().references('id').inTable('users').onDelete('SET NULL')],
  ['pay_method', (t) => t.string('pay_method', 20).nullable()],
  ['bank_account_id', (t) => t.integer('bank_account_id').nullable().references('id').inTable('bank_accounts').onDelete('SET NULL')],
  ['voided_at', (t) => t.timestamp('voided_at', { useTz: true }).nullable()],
  ['voided_by', (t) => t.integer('voided_by').nullable().references('id').inTable('users').onDelete('SET NULL')],
  ['void_reason', (t) => t.text('void_reason').nullable()],
];

exports.up = async (knex) => {
  const parent = await knex('chart_of_accounts').where({ code: '1300' }).first('id');
  if (!(await knex('chart_of_accounts').where({ code: '1330' }).first())) {
    await knex('chart_of_accounts').insert({
      code: '1330', name: 'Staff Advances', type: 'Asset', sub_type: 'Current Asset',
      parent_id: parent ? parent.id : null, entity: null, currency: 'PKR',
      normal_balance: 'debit', is_system: true, is_active: true,
      description: 'Salary advances paid to employees, recovered from their salary (D-11).',
    });
  }
  for (const [name, add] of COLS) {
    if (!(await knex.schema.hasColumn('mill_worker_advances', name))) {
      await knex.schema.alterTable('mill_worker_advances', add);
    }
  }
  await knex.raw('ALTER TABLE mill_worker_advances DROP CONSTRAINT IF EXISTS chk_mill_worker_advances_payout_gl');
  await knex.raw("ALTER TABLE mill_worker_advances ADD CONSTRAINT chk_mill_worker_advances_payout_gl CHECK (payout_gl IN ('expensed', 'asset'))");
  await setChecks(knex, [...APPROVAL, 'voided'], [...STATUS, 'voided']);
};

exports.down = async (knex) => {
  const voided = await knex('mill_worker_advances').where('approval_status', 'voided').orWhere('status', 'voided').count('* as n').first();
  if (Number(voided && voided.n) > 0) throw new Error(`Cannot roll back: ${voided.n} advance(s) are voided.`);
  const asset = await knex('mill_worker_advances').where('payout_gl', 'asset').count('* as n').first();
  if (Number(asset && asset.n) > 0) throw new Error(`Cannot roll back: ${asset.n} advance(s) were paid to 1330 Staff Advances.`);
  await setChecks(knex, APPROVAL, STATUS);
  await knex.raw('ALTER TABLE mill_worker_advances DROP CONSTRAINT IF EXISTS chk_mill_worker_advances_payout_gl');
  for (const [name] of [...COLS].reverse()) {
    if (await knex.schema.hasColumn('mill_worker_advances', name)) {
      await knex.schema.alterTable('mill_worker_advances', (t) => t.dropColumn(name));
    }
  }
  const used = await knex('journal_lines as l').join('chart_of_accounts as c', 'c.id', 'l.account_id').where('c.code', '1330').first('l.id');
  if (!used) await knex('chart_of_accounts').where({ code: '1330' }).del();
};
