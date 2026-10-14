/**
 * P2-05 data scripts against a real DB: the read-only check flags a legacy
 * manual rice cost on a shipped order; the correction script is a dry run by
 * default, and with APPLY=1 posts one signed-delta journal (Dr 2010 / Cr 6000)
 * and writes the unpaid payable off — once (idempotent). A paid cost is refused.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(90000);

const script = (name, env = {}) => spawnSync(process.execPath, [path.join(__dirname, '../../scripts', name)], {
  env: { ...process.env, NODE_ENV: 'development', ...env }, encoding: 'utf8',
});

d('export cost double-count scripts (DB-gated)', () => {
  let db;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};

  beforeAll(async () => {
    db = require('../config/database');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-eocx-${run}@test.local`, full_name: `ZZ EOCX ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    const [c] = await db('customers').insert({ name: `ZZ EOCX Buyer ${run}` }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ EOCX Kernel ${run}` }).returning('*');
    const [o] = await db('export_orders').insert({
      order_no: `ZZ-EOCX-${run}`, customer_id: c.id, product_id: p.id, created_by: u.id, status: 'Shipped',
      qty_mt: 10, contract_value: 6000, currency: 'USD', booked_fx_rate: 280, inventory_cogs_total_pkr: 900000, revenue_posted: true,
    }).returning('*');
    // A legacy manual rice cost (written before P2-05) with its payable; and a paid one.
    const legacy = async (paid) => {
      const [row] = await db('export_order_costs').insert({
        order_id: o.id, category: 'rice', amount: 500000, currency: 'PKR', base_amount_pkr: 500000, fx_rate: 1,
        paid_amount: paid, payment_status: paid > 0 ? 'Partial' : 'Pending',
      }).returning('*');
      // …and the accrual it was posted with then (Dr 6000 / Cr 2010).
      const accounting = require('../modules/accounting/accounting.service');
      const [exp, ap] = await Promise.all([db('chart_of_accounts').where({ code: '6000' }).first(), db('chart_of_accounts').where({ code: '2010' }).first()]);
      await db.transaction(async (trx) => {
        const je = await accounting.createJournal(trx, {
          date: new Date().toISOString().slice(0, 10), entity: 'export', refType: 'Export Order Cost', refNo: `${o.order_no} rice`,
          description: 'legacy rice cost', currency: 'PKR', fxRate: 1, isAuto: true, userId: u.id,
          lines: [
            { account_id: exp.id, account: exp.name, debit: 500000, credit: 0, narration: 'DR 6000' },
            { account_id: ap.id, account: ap.name, debit: 0, credit: 500000, narration: 'CR 2010' },
          ],
        });
        await accounting.postJournal(trx, je.id);
      });
      const [pay] = await db('payables').insert({
        pay_no: `PAY-ZZX-${run}-${row.id}`, entity: 'export', category: 'rice', original_amount: 500000, paid_amount: paid,
        outstanding: 500000 - paid, currency: 'PKR', due_date: '2026-10-01', status: paid > 0 ? 'Partial' : 'Pending',
        source_table: 'export_order_costs', source_id: row.id, payable_type: 'expense',
      }).returning('*');
      return { cost: row.id, payable: pay.id };
    };
    ids.unpaid = await legacy(0);
    ids.paid = await legacy(1000);
    ids.order = o.id;
  });
  afterAll(async () => { if (db) await db.destroy(); });

  const corrections = () => db('journal_entries').where({ ref_type: 'Export Order Cost Correction', ref_no: `cost #${ids.unpaid.cost}`, status: 'Posted' });

  test('the read-only check flags both rice costs (group A) and writes nothing', async () => {
    const before = await db('journal_entries').count('id as n').first();
    const r = script('checkExportCostDoubleCount.js');
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(new RegExp(`cost #${ids.unpaid.cost}\\s+order #${ids.order}`));
    expect(r.stdout).toMatch(new RegExp(`cost #${ids.paid.cost}.*PAID`));
    expect((await db('journal_entries').count('id as n').first()).n).toBe(before.n);
  });

  test('dry run (default) writes nothing', async () => {
    const r = script('correctExportRiceDoubleCount.js', { COST_IDS: `${ids.unpaid.cost}` });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/DRY RUN/);
    expect(r.stdout).toMatch(/would post Dr 2010 \/ Cr 6000/);
    expect(await corrections()).toHaveLength(0);
    expect((await db('payables').where({ id: ids.unpaid.payable }).first()).status).toBe('Pending');
  });

  test('APPLY=1 posts one signed delta and writes the payable off; a paid cost is refused; re-run is a no-op', async () => {
    const r = script('correctExportRiceDoubleCount.js', { COST_IDS: `${ids.unpaid.cost},${ids.paid.cost}`, APPLY: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`cost #${ids.paid.cost}: REFUSED — cost is partly/fully paid`));

    const js = await corrections();
    expect(js).toHaveLength(1);
    const lines = await db('journal_lines as jl').join('chart_of_accounts as a', 'a.id', 'jl.account_id')
      .where('jl.journal_id', js[0].id).select('a.code', 'jl.debit', 'jl.credit');
    expect(lines.map((l) => [l.code, Number(l.debit), Number(l.credit)]).sort()).toEqual([['2010', 500000, 0], ['6000', 0, 500000]]);
    const pay = await db('payables').where({ id: ids.unpaid.payable }).first();
    expect([pay.status, Number(pay.outstanding)]).toEqual(['Written Off', 0]);
    // History kept: the cost row and the paid one untouched.
    expect(await db('export_order_costs').where({ id: ids.unpaid.cost }).first()).toBeTruthy();
    expect((await db('payables').where({ id: ids.paid.payable }).first()).status).toBe('Partial');

    const again = script('correctExportRiceDoubleCount.js', { COST_IDS: `${ids.unpaid.cost}`, APPLY: '1' });
    expect(again.stdout).toMatch(/already corrected/);
    expect(await corrections()).toHaveLength(1);
  });
});
