// Per-account ledger (owner decision G-8, 2026-10-09): every cash / bank
// account gets its own GL account under 1000 Cash & Bank.
//
//   bank_accounts.gl_account_id → chart_of_accounts(id), nullable (an account
//   with no link still posts to 1000, logged — see shared/accountGl.js).
//
// Mapping, per existing account (id order):
//   - the three the original chart already names, matched by exact account
//     name: Office Petty Cash → 1010, BAHL Agri Commodities → 1020
//     (Bank Al Habib), Meezan Bank Agri Commodities → 1030 (Meezan). The
//     account takes the bank account's name so the trial balance is
//     unambiguous (prod has five BAHL and three Meezan accounts). Neither code
//     carried a journal line on prod when this was written.
//   - every other account: a new Asset under 1000 at the next free code in
//     1011…1099, named after the account, in its currency and entity.
//   1040 "MCB Dollar Account (USD)" and 1050 "HBL Account (PKR)" match no
//   account and are left as they are.
//
// Data only moves the CHART; no journal is written here. Today's balance on
// 1000 is moved onto the per-account codes by the guarded reclassification
// script (run separately, dry-run by default).
//
// down(): drops the column; the chart rows it created stay (they may carry
// journal lines by then) and the three renamed accounts keep their new names.

const EXACT = [
  { name: 'Office Petty Cash', code: '1010' },
  { name: 'BAHL Agri Commodities', code: '1020' },
  { name: 'Meezan Bank Agri Commodities', code: '1030' },
];

function nextFreeCode(taken) {
  for (let c = 1011; c <= 1099; c += 1) if (!taken.has(String(c))) return String(c);
  throw new Error('No free GL code in 1011–1099 for a cash / bank account.');
}

exports.up = async function up(knex) {
  const has = await knex.schema.hasColumn('bank_accounts', 'gl_account_id');
  if (!has) {
    await knex.schema.alterTable('bank_accounts', (t) => {
      t.integer('gl_account_id').nullable().references('id').inTable('chart_of_accounts').onDelete('SET NULL');
      t.index(['gl_account_id'], 'idx_bank_accounts_gl_account_id');
    });
  }

  const parent = await knex('chart_of_accounts').where({ code: '1000' }).first();
  if (!parent) return; // a chart without Cash & Bank: nothing to map

  const accounts = await knex('bank_accounts').whereNull('gl_account_id').orderBy('id');
  const taken = new Set(await knex('chart_of_accounts').pluck('code'));
  const used = new Set(
    (await knex('bank_accounts').whereNotNull('gl_account_id').pluck('gl_account_id')).map(String),
  );

  for (const a of accounts) {
    let gl = null;
    const exact = EXACT.find((e) => e.name === a.name);
    if (exact) {
      const row = await knex('chart_of_accounts').where({ code: exact.code }).first();
      if (row && !used.has(String(row.id))) {
        await knex('chart_of_accounts').where({ id: row.id }).update({
          name: a.name,
          parent_id: parent.id,
          currency: String(a.currency || 'PKR').toUpperCase(),
          sub_type: a.type === 'cash' ? 'cash' : 'bank',
          description: `Cash / bank account #${a.id} (was "${row.name}")`,
          updated_at: knex.fn.now(),
        });
        gl = row;
      }
    }
    if (!gl) {
      const code = nextFreeCode(taken);
      [gl] = await knex('chart_of_accounts').insert({
        code,
        name: String(a.name || `Account #${a.id}`).slice(0, 255),
        type: 'Asset',
        sub_type: a.type === 'cash' ? 'cash' : 'bank',
        parent_id: parent.id,
        entity: ['general', 'mill', 'export'].includes(a.entity) ? a.entity : null,
        currency: String(a.currency || 'PKR').toUpperCase(),
        is_active: true,
        is_system: true,
        normal_balance: 'debit',
        description: `Cash / bank account #${a.id}`,
      }).returning('*');
      taken.add(code);
    }
    used.add(String(gl.id));
    await knex('bank_accounts').where({ id: a.id }).update({ gl_account_id: gl.id });
  }
};

exports.down = async function down(knex) {
  const has = await knex.schema.hasColumn('bank_accounts', 'gl_account_id');
  if (has) {
    await knex.schema.alterTable('bank_accounts', (t) => {
      t.dropIndex(['gl_account_id'], 'idx_bank_accounts_gl_account_id');
      t.dropColumn('gl_account_id');
    });
  }
};
