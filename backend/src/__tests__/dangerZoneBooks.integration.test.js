/**
 * P2-23 — the Super-Admin Danger Zone keeps the books balanced (owner decision
 * D-23). Against a real, fully-migrated Postgres:
 *   - a lot with payables / open GL is refused (409) even with force; a lot
 *     with no money attached is deleted with its ledger rows
 *   - deleting a local sale / payment nets their GL to zero with Posted
 *     signed-delta journals — the originals stay, nothing Posted is deleted
 *   - a Posted journal cannot be deleted; a Draft can
 *   - a lot-transaction that moved stock cannot be deleted
 *   - a bank-balance correction posts a delta journal against 1290 Suspense;
 *     a foreign-currency account needs a rate
 *   - a milling batch goes through milling's own delete (Completed → refused)
 *   - financial children are RESTRICT (mig 368)
 *   - reset keeps user_scopes / devices / haulers / salary revisions
 * and the trial balance (Posted lines) is balanced after every action.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('Danger Zone keeps the books balanced (DB-gated)', () => {
  let db; let dz; let acc;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};

  const mockRes = () => ({
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  });
  const call = async (fn, { params = {}, query = {}, body = {} } = {}) => {
    const res = mockRes();
    await fn({ params, query, body, user: { id: ids.user }, ip: '127.0.0.1', headers: {} }, res);
    return res;
  };
  const tb = async () => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .where('je.status', 'Posted')
      .select(db.raw('COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0) as diff')).first();
    return Math.round(parseFloat(r.diff) * 100) / 100;
  };
  const refNet = async (refNo) => {
    const rows = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted' }).groupBy('jl.account_id')
      .select(db.raw('COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0) as net'));
    return rows.reduce((s, r) => s + Math.abs(parseFloat(r.net)), 0);
  };
  const acct = async (code) => db('chart_of_accounts').where({ code }).first();
  const post = async ({ refType, refNo, dr, cr, amount, status = 'Posted' }) => {
    const [a, b] = [await acct(dr), await acct(cr)];
    const j = await db.transaction(async (trx) => {
      const jj = await acc.createJournal(trx, {
        date: new Date().toISOString().slice(0, 10), entity: 'mill', refType, refNo,
        description: `ZZ ${refType}`, currency: 'PKR', fxRate: 1, isAuto: true, userId: ids.user,
        lines: [
          { account_id: a.id, account: a.name, debit: amount, credit: 0 },
          { account_id: b.id, account: b.name, debit: 0, credit: amount },
        ],
      });
      if (status === 'Posted') await acc.postJournal(trx, jj.id);
      return jj;
    });
    return j;
  };
  const lot = async (suffix, fields = {}) => (await db('inventory_lots').insert({
    lot_no: `ZZDZ-${suffix}-${run}`, item_name: `ZZ ${suffix}`, type: 'raw', entity: 'mill',
    unit: 'kg', qty: 1000, available_qty: 1000, warehouse_id: ids.wh, product_id: ids.product, ...fields,
  }).returning('*'))[0];

  beforeAll(async () => {
    db = require('../config/database');
    dz = require('../modules/admin/dangerZone.controller');
    acc = require('../modules/accounting/accounting.service');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-dz-${run}@test.local`, full_name: `ZZ DZ ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    ids.user = u.id;
    ids.wh = (await db('warehouses').insert({ name: `ZZ DZ WH ${run}`, type: 'raw' }).returning('*'))[0].id;
    ids.product = (await db('products').insert({ name: `ZZ DZ Rice ${run}` }).returning('*'))[0].id;
    ids.mill = (await db('mills').insert({ name: `ZZ DZ Mill ${run}` }).returning('*'))[0].id;
  });
  let ltSeq = 0;
  const ledgerRow = (lotId, kg) => ({
    lot_id: lotId, transaction_no: `ZZLT-${run}-${++ltSeq}`, transaction_type: 'purchase_receipt', quantity_kg: kg,
    created_by: ids.user, performed_by: ids.user,
  });
  afterAll(async () => { await db.destroy(); });

  test('trial balance starts balanced', async () => {
    expect(await tb()).toBe(0);
  });

  test('lot with an open payable → 409 even with force; lot survives', async () => {
    const l = await lot('PAY');
    await db('payables').insert({
      pay_no: `ZZDZ-AP-${run}`, payable_type: 'vendor', entity: 'mill', category: 'Raw Material',
      original_amount: 5000, paid_amount: 0, outstanding: 5000, currency: 'PKR', status: 'Pending', linked_ref: l.lot_no,
    });
    const r = await call(dz.hardDeleteLot, { params: { id: l.id }, query: { confirm: 'DELETE', force: 'true' } });
    expect(r.statusCode).toBe(409);
    expect(r.body.data.financialBlockers.length).toBeGreaterThan(0);
    expect(await db('inventory_lots').where('id', l.id).first()).toBeTruthy();
  });

  test('lot with open Purchase Lot GL → 409; impact lists it', async () => {
    const l = await lot('GL');
    await post({ refType: 'Purchase Lot', refNo: l.lot_no, dr: '1210', cr: '2010', amount: 7000 });
    const imp = await call(dz.getLotImpact, { params: { id: l.id } });
    expect(imp.body.data.financialBlockers.join(' ')).toMatch(/Posted GL/);
    const r = await call(dz.hardDeleteLot, { params: { id: l.id }, query: { confirm: 'DELETE', force: 'true' } });
    expect(r.statusCode).toBe(409);
    expect(await tb()).toBe(0);
  });

  test('lot with no money attached is deleted with its ledger rows', async () => {
    const l = await lot('FREE');
    await db('lot_transactions').insert(ledgerRow(l.id, 1000));
    const r = await call(dz.hardDeleteLot, { params: { id: l.id }, query: { confirm: 'DELETE' } });
    expect(r.statusCode).toBe(200);
    expect(await db('inventory_lots').where('id', l.id).first()).toBeUndefined();
    expect(await db('lot_transactions').where('lot_id', l.id).first()).toBeUndefined();
  });

  test('local sale delete nets its GL and its receipt GL to zero; originals kept', async () => {
    const saleNo = `ZZLS-${run}`;
    const [sale] = await db('local_sales').insert({
      sale_no: saleNo, sale_date: new Date().toISOString().slice(0, 10), buyer_name: 'ZZ', item_name: 'ZZ rice',
      quantity_kg: 100, quantity_input: 100, rate_per_kg: 50, rate_input: 50, total_amount: 5000, paid_amount: 5000, due_amount: 0,
      status: 'Completed', payment_status: 'Paid', currency: 'PKR',
    }).returning('*');
    const revenue = await post({ refType: 'Local Sale', refNo: saleNo, dr: '1120', cr: '4000', amount: 5000 });
    const payNo = `ZZPAY-LS-${run}`;
    await db('payments').insert({ payment_no: payNo, type: 'receipt', amount: 5000, currency: 'PKR', payment_date: new Date().toISOString().slice(0, 10), local_sale_id: sale.id });
    await post({ refType: 'Payment', refNo: payNo, dr: '1000', cr: '1120', amount: 5000 });
    expect(await refNet(saleNo)).toBeGreaterThan(0);

    const r = await call(dz.hardDeleteTransaction, { params: { type: 'local_sale', id: sale.id }, query: { confirm: 'DELETE' } });
    expect(r.statusCode).toBe(200);
    expect(await db('local_sales').where('id', sale.id).first()).toBeUndefined();
    expect(await refNet(saleNo)).toBe(0);
    expect(await refNet(payNo)).toBe(0);
    // The original revenue journal is still there, still Posted.
    expect((await db('journal_entries').where('id', revenue.id).first()).status).toBe('Posted');
    expect(await db('journal_entries').where({ reversal_of: revenue.id, status: 'Posted' }).first()).toBeTruthy();
    expect(await tb()).toBe(0);
  });

  test('payment delete nets its GL to zero', async () => {
    const payNo = `ZZPAY-${run}`;
    const [p] = await db('payments').insert({ payment_no: payNo, type: 'payment', amount: 1200, currency: 'PKR', payment_date: new Date().toISOString().slice(0, 10) }).returning('*');
    await post({ refType: 'Payment', refNo: payNo, dr: '2010', cr: '1000', amount: 1200 });
    const r = await call(dz.hardDeleteTransaction, { params: { type: 'payment', id: p.id }, query: { confirm: 'DELETE' } });
    expect(r.statusCode).toBe(200);
    expect(await refNet(payNo)).toBe(0);
    expect(await tb()).toBe(0);
  });

  test('a Posted journal cannot be deleted; a Draft can', async () => {
    const posted = await post({ refType: 'Manual', refNo: `ZZJ-P-${run}`, dr: '6200', cr: '1000', amount: 10 });
    const r1 = await call(dz.hardDeleteTransaction, { params: { type: 'journal_entry', id: posted.id }, query: { confirm: 'DELETE' } });
    expect(r1.statusCode).toBe(409);
    expect(await db('journal_entries').where('id', posted.id).first()).toBeTruthy();

    const draft = await post({ refType: 'Manual', refNo: `ZZJ-D-${run}`, dr: '6200', cr: '1000', amount: 10, status: 'Draft' });
    const r2 = await call(dz.hardDeleteTransaction, { params: { type: 'journal_entry', id: draft.id }, query: { confirm: 'DELETE' } });
    expect(r2.statusCode).toBe(200);
    expect(await db('journal_entries').where('id', draft.id).first()).toBeUndefined();
    expect(await db('journal_lines').where('journal_id', draft.id).first()).toBeUndefined();
    expect(await tb()).toBe(0);
  });

  test('mill purchase delete nets the purchase GL and its payment GL to zero', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [mp] = await db('mill_purchases').insert({ purchase_no: `ZZMP-${run}`, purchase_date: today, total_amount: 800 }).returning('*');
    await post({ refType: 'Store Purchase', refNo: mp.purchase_no, dr: '1250', cr: '2010', amount: 800 });
    const [pay] = await db('payables').insert({
      pay_no: `ZZMP-AP-${run}`, payable_type: 'vendor', entity: 'mill', original_amount: 800, paid_amount: 800, outstanding: 0,
      currency: 'PKR', status: 'Paid', source_table: 'mill_purchases', source_id: mp.id,
    }).returning('*');
    const payNo = `ZZPAY-MP-${run}`;
    await db('payments').insert({ payment_no: payNo, type: 'payment', amount: 800, currency: 'PKR', payment_date: today, linked_payable_id: pay.id });
    await post({ refType: 'Payment', refNo: payNo, dr: '2010', cr: '1000', amount: 800 });
    const r = await call(dz.hardDeleteTransaction, { params: { type: 'mill_purchase', id: mp.id }, query: { confirm: 'DELETE' } });
    expect(r.statusCode).toBe(200);
    expect(await refNet(mp.purchase_no)).toBe(0);
    expect(await refNet(payNo)).toBe(0);
    expect(await tb()).toBe(0);
  });

  test('export order: credit note blocks; otherwise its GL is netted to zero', async () => {
    const [c] = await db('customers').insert({ name: `ZZ DZ Buyer ${run}` }).returning('*');
    const order = async (sfx) => (await db('export_orders').insert({
      order_no: `ZZEO-${sfx}-${run}`, customer_id: c.id, product_id: ids.product, created_by: ids.user, currency: 'USD',
    }).returning('*'))[0];
    const blocked = await order('CN');
    await db('credit_notes').insert({ credit_note_no: `ZZCN-${run}`, order_id: blocked.id, issue_date: new Date().toISOString().slice(0, 10), adjustment_amount: 10 });
    const r1 = await call(dz.hardDeleteTransaction, { params: { type: 'export_order', id: blocked.id }, query: { confirm: 'DELETE' } });
    expect(r1.statusCode).toBe(409);
    expect(await db('export_orders').where('id', blocked.id).first()).toBeTruthy();

    const o = await order('GL');
    await post({ refType: 'Export Shipment', refNo: o.order_no, dr: '1110', cr: '4010', amount: 280000 });
    const r2 = await call(dz.hardDeleteTransaction, { params: { type: 'export_order', id: o.id }, query: { confirm: 'DELETE' } });
    expect(r2.statusCode).toBe(200);
    expect(await refNet(o.order_no)).toBe(0);
    expect(await tb()).toBe(0);
  });

  test('a lot transaction that moved stock cannot be deleted', async () => {
    const l = await lot('LT');
    const [t] = await db('lot_transactions').insert(ledgerRow(l.id, 250)).returning('*');
    const r = await call(dz.hardDeleteTransaction, { params: { type: 'lot_transaction', id: t.id }, query: { confirm: 'DELETE' } });
    expect(r.statusCode).toBe(409);
    expect(await db('lot_transactions').where('id', t.id).first()).toBeTruthy();
  });

  test('bank adjust posts a delta journal against 1290 Suspense', async () => {
    const [b] = await db('bank_accounts').insert({ name: `ZZ DZ Bank ${run}`, currency: 'PKR', current_balance: 1000 }).returning('*');
    const r = await call(dz.adjustBankBalance, { params: { id: b.id }, body: { mode: 'add', amount: 2500, reason: 'ZZ test' } });
    expect(r.statusCode).toBe(200);
    expect(r.body.data.journalNo).toBeTruthy();
    expect(parseFloat((await db('bank_accounts').where('id', b.id).first()).current_balance)).toBe(3500);
    const lines = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': `BANKADJ-${b.id}`, 'je.status': 'Posted' }).select('c.code', 'jl.debit', 'jl.credit');
    const susp = lines.find((l) => l.code === '1290');
    expect(parseFloat(susp.credit)).toBe(2500);
    // set mode: the delta (down 500) is posted the other way.
    const r2 = await call(dz.adjustBankBalance, { params: { id: b.id }, body: { mode: 'set', amount: 3000 } });
    expect(r2.statusCode).toBe(200);
    expect(await tb()).toBe(0);
  });

  test('a foreign-currency bank adjust without a rate is refused (no fallback rate)', async () => {
    const [b] = await db('bank_accounts').insert({ name: `ZZ DZ USD ${run}`, currency: 'USD', current_balance: 0 }).returning('*');
    const r = await call(dz.adjustBankBalance, { params: { id: b.id }, body: { mode: 'add', amount: 100 } });
    expect(r.statusCode).toBe(400);
    expect(parseFloat((await db('bank_accounts').where('id', b.id).first()).current_balance)).toBe(0);
    const ok = await call(dz.adjustBankBalance, { params: { id: b.id }, body: { mode: 'add', amount: 100, fx_rate: 280.5 } });
    expect(ok.statusCode).toBe(200);
    expect(await tb()).toBe(0);
  });

  test('a Completed milling batch is refused through milling\'s own delete', async () => {
    const [mb] = await db('milling_batches').insert({ batch_no: `ZZMB-${run}`, status: 'Completed', created_by: ids.user, mill_id: ids.mill }).returning('*');
    const r = await call(dz.hardDeleteTransaction, { params: { type: 'milling_batch', id: mb.id }, query: { confirm: 'DELETE' } });
    expect(r.statusCode).toBe(409);
    expect(r.body.message).toMatch(/Reverse the yield/);
    expect(await db('milling_batches').where('id', mb.id).first()).toBeTruthy();
  });

  test('a pending milling batch with no money is deleted', async () => {
    const [mb] = await db('milling_batches').insert({ batch_no: `ZZMB2-${run}`, status: 'Queued', created_by: ids.user, mill_id: ids.mill }).returning('*');
    const r = await call(dz.hardDeleteTransaction, { params: { type: 'milling_batch', id: mb.id }, query: { confirm: 'DELETE' } });
    expect(r.statusCode).toBe(200);
    expect(await db('milling_batches').where('id', mb.id).first()).toBeUndefined();
  });

  test('financial children are RESTRICT (mig 368)', async () => {
    const l = await lot('FK');
    await db('lot_transactions').insert(ledgerRow(l.id, 1));
    await expect(db('inventory_lots').where('id', l.id).del()).rejects.toMatchObject({ code: '23503' });
    const j = await post({ refType: 'Manual', refNo: `ZZJ-FK-${run}`, dr: '6200', cr: '1000', amount: 1, status: 'Draft' });
    await expect(db('journal_entries').where('id', j.id).del()).rejects.toMatchObject({ code: '23503' });
    // tidy: drafts only (not in the books)
    await db('journal_lines').where('journal_id', j.id).del();
    await db('journal_entries').where('id', j.id).del();
  });

  test('reset keeps scoping, devices, haulers and salary revisions', () => {
    for (const t of ['user_scopes', 'devices', 'haulers', 'mill_salary_revisions']) {
      expect(dz.KEEP_TABLES.has(t)).toBe(true);
    }
  });
});
