/**
 * P2-15 / D-7 — cancelling a paid export order never destroys a receipt.
 * End to end through POST /api/export-orders/:id/cancel on a real, fully
 * migrated Postgres, with receipts posted by the real receipt path:
 *
 *   refund  → the receipts, their bank rows and journals stay; ONE new money-out
 *             payment per receipt (refund_of_payment_id), its own bank row; bank
 *             back to zero; 1310 / 1110 / bank GL net to zero; TB balanced
 *   credit  → nothing leaves the bank; the money stays in 1310 for the buyer
 *   forfeit → Owner only; 1310 → 4080
 *   a balance receipt (1110 at the booked rate, gap on 6210) refunds to zero
 *   on 1110 AND 6210
 *   money received + no disposition → 400; a confirmed pending receipt is
 *   kept as Superseded, not deleted.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(90000);

d('export cancel with money received (DB-gated)', () => {
  let db; let app; let request; let receipts; let ownerTok; let adminTok; let ownerId;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  let bankGl;

  beforeAll(async () => {
    db = require('../config/database');
    receipts = require('../modules/exportOrders/exportReceipts');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const { ensureAccountGl } = require('../shared/accountGl');
    const user = async (roleName, tag) => {
      const role = await db('roles').where({ name: roleName }).first();
      const [u] = await db('users').insert({
        email: `zz-cxl-${tag}-${run}@test.local`, full_name: `ZZ CXL ${tag} ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
      }).returning('*');
      return { u, tok: jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret) };
    };
    const owner = await user('Owner', 'own');
    const admin = await user('Super Admin', 'adm');
    ownerTok = owner.tok; ownerId = owner.u.id; adminTok = admin.tok;
    const [bank] = await db('bank_accounts').insert({
      name: `ZZ CXL USD ${run}`, type: 'bank', is_active: true, currency: 'USD', entity: 'export', current_balance: 0,
    }).returning('*');
    bankGl = (await ensureAccountGl(db, bank)).code;
    const [c] = await db('customers').insert({ name: `ZZ CXL Buyer ${run}`, customer_type: 'export', currency: 'USD' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ CXL Kernel ${run}` }).returning('*');
    Object.assign(ids, { bank: bank.id, cust: c.id, product: p.id });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  // An order in Docs In Preparation with an advance (and optionally a balance)
  // receivable, booked at 280.
  async function makeOrder(tag, { balance = false } = {}) {
    const [o] = await db('export_orders').insert({
      order_no: `ZZ-CXL-${tag}-${run}`, customer_id: ids.cust, product_id: ids.product, created_by: ownerId,
      status: 'Docs In Preparation', qty_mt: 10, contract_value: 10000, currency: 'USD', booked_fx_rate: 280,
      contract_value_pkr_locked: 2800000, advance_expected: 2000, balance_expected: 8000, bank_account_id: ids.bank,
    }).returning('*');
    const recv = (type, usd) => ({
      recv_no: `Z${tag}${type.slice(0, 1)}${run}`, type, entity: 'export', order_id: o.id, customer_id: ids.cust, currency: 'USD',
      expected_amount: usd, received_amount: 0, outstanding: usd, base_amount_pkr: usd * 280, fx_rate: 280, status: 'Pending',
    });
    await db('receivables').insert([recv('Advance', 2000), ...(balance ? [recv('Balance', 8000)] : [])]);
    return o;
  }
  const pay = (o, kind, usd, rate) => db.transaction((trx) => receipts.postExportReceipt(trx, {
    orderWhere: { id: o.id }, kind, amount: usd, fxRate: rate, bankAccountId: ids.bank, paymentMethod: 'bank_transfer', userId: ownerId,
  }));
  const cancel = (o, body, tok = ownerTok) => request(app).post(`/api/export-orders/${o.id}/cancel`)
    .set({ Authorization: `Bearer ${tok}` }).send(body);
  const glNet = async (refNo, code) => {
    const r = await db('journal_entries as je').join('journal_lines as jl', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as a', 'a.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'a.code': code })
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0) AS n')).first();
    return Math.round(Number(r.n) * 100) / 100;
  };
  const tbBalanced = async (refNo) => {
    const r = await db('journal_entries as je').join('journal_lines as jl', 'jl.journal_id', 'je.id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted' })
      .select(db.raw('COALESCE(SUM(jl.debit), 0) AS dr, COALESCE(SUM(jl.credit), 0) AS cr')).first();
    return Math.round((Number(r.dr) - Number(r.cr)) * 100) === 0;
  };
  const bankBalance = async () => Number((await db('bank_accounts').where({ id: ids.bank }).first()).current_balance);
  const receiptsOf = async (o) => db('payments as p').join('receivables as r', 'r.id', 'p.linked_receivable_id')
    .where('r.order_id', o.id).select('p.*').orderBy('p.id');

  test('money received and no disposition chosen → 400, nothing changes', async () => {
    const o = await makeOrder('N');
    await pay(o, 'advance', 1000, 285);
    const res = await cancel(o, { reason: 'buyer withdrew' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Choose what happens to the money/);
    expect((await db('export_orders').where({ id: o.id }).first()).status).toBe('Docs In Preparation');
  });

  test('refund: receipts + their bank rows stay, one reversing payment each, GL and bank net to zero', async () => {
    const before = await bankBalance();
    const o = await makeOrder('R');
    await pay(o, 'advance', 1200, 285);
    // A receipt recorded by a maker and confirmed by Finance — its pending row
    // must survive as Superseded.
    const pending = await db.transaction((trx) => receipts.recordPendingExportReceipt(trx, {
      order: o, kind: 'advance', amount: 800, bankAccountId: ids.bank, fxRate: 286, paymentMethod: 'bank_transfer', userId: ownerId,
    }));
    const confirmed = await db.transaction((trx) => receipts.confirmPendingExportReceipt(trx, { paymentId: pending.id, fxRate: 286, userId: ownerId }));
    const sup = await db('payments').where({ id: pending.id }).first();
    expect(sup.status).toBe('Superseded');
    expect(sup.superseded_by_payment_id).toBe(confirmed.payment.id);

    const rcpts = (await receiptsOf(o)).filter((p) => p.status === 'Confirmed');
    expect(rcpts).toHaveLength(2);
    const rcptBtCount = Number((await db('bank_transactions').whereIn('linked_payment_id', rcpts.map((p) => p.id)).count('id as n').first()).n);
    expect(rcptBtCount).toBe(2);
    expect(await bankBalance()).toBe(before + 2000);

    const res = await cancel(o, { reason: 'buyer withdrew', money_disposition: 'refund' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ refundedReceipts: 2, moneyDisposition: 'refund' });

    // Nothing deleted: the receipts are Confirmed, their bank rows still there.
    for (const p of rcpts) expect((await db('payments').where({ id: p.id }).first()).status).toBe('Confirmed');
    expect(Number((await db('bank_transactions').whereIn('linked_payment_id', rcpts.map((p) => p.id)).count('id as n').first()).n)).toBe(rcptBtCount);
    expect((await db('payments').where({ id: pending.id }).first()).status).toBe('Superseded');
    // One reversing money-out per receipt, each with its own bank row.
    const refunds = await db('payments').whereIn('refund_of_payment_id', rcpts.map((p) => p.id));
    expect(refunds.map((r) => [r.type, r.currency, Number(r.amount)]).sort()).toEqual([['payment', 'USD', 1200], ['payment', 'USD', 800]]);
    expect(Number((await db('bank_transactions').whereIn('linked_payment_id', refunds.map((r) => r.id)).count('id as n').first()).n)).toBe(2);
    expect(await bankBalance()).toBe(before);

    // GL: 1310 and the bank's GL net to zero for the order; TB balanced; AR zero.
    expect(await glNet(o.order_no, '1310')).toBe(0);
    expect(await glNet(o.order_no, '1110')).toBe(0);
    expect(await tbBalanced(o.order_no)).toBe(true);
    // Receipts and refunds both journal under the order number.
    expect(await glNet(o.order_no, bankGl)).toBe(0);

    const recvs = await db('receivables').where({ order_id: o.id });
    expect(recvs.every((r) => r.status === 'Written Off' && Number(r.outstanding) === 0)).toBe(true);
    expect(Number(recvs.find((r) => r.type === 'Advance').received_amount)).toBe(2000); // history kept
    const disp = await db('export_receipt_dispositions').where({ order_id: o.id });
    expect(disp.map((x) => x.disposition)).toEqual(['refund', 'refund']);
    expect((await db('export_orders').where({ id: o.id }).first()).status).toBe('Cancelled');
  });

  test('credit: no money leaves the bank; it stays in 1310 for the buyer', async () => {
    const o = await makeOrder('C');
    await pay(o, 'advance', 2000, 285);
    const bal = await bankBalance();
    const res = await cancel(o, { money_disposition: 'credit' });
    expect(res.status).toBe(200);
    expect(await bankBalance()).toBe(bal);
    expect(await db('payments').whereNotNull('refund_of_payment_id').whereIn('refund_of_payment_id', (await receiptsOf(o)).map((p) => p.id))).toHaveLength(0);
    expect(await glNet(o.order_no, '1310')).toBe(-570000); // still owed to the buyer
    expect(await tbBalanced(o.order_no)).toBe(true);
    const [disp] = await db('export_receipt_dispositions').where({ order_id: o.id });
    expect([disp.disposition, disp.credit_status, Number(disp.amount_pkr)]).toEqual(['credit', 'Open', 570000]);
  });

  test('forfeit needs an Owner: a Super Admin without one is refused', async () => {
    const o = await makeOrder('F1');
    await pay(o, 'advance', 2000, 280);
    const res = await cancel(o, { money_disposition: 'forfeit' }, adminTok);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OWNER_AUTH_REQUIRED');
    expect((await db('export_orders').where({ id: o.id }).first()).status).toBe('Docs In Preparation');
  });

  test('forfeit (Owner): 1310 → 4080, logged as its own approval kind', async () => {
    const o = await makeOrder('F2');
    await pay(o, 'advance', 2000, 280);
    const res = await cancel(o, { money_disposition: 'forfeit', reason: 'contract breach' });
    expect(res.status).toBe(200);
    expect(await glNet(o.order_no, '1310')).toBe(0);
    expect(await glNet(o.order_no, '4080')).toBe(-560000);
    expect(await tbBalanced(o.order_no)).toBe(true);
    const [disp] = await db('export_receipt_dispositions').where({ order_id: o.id });
    expect([disp.disposition, disp.authorized_by_owner_id]).toEqual(['forfeit', ownerId]);
    await new Promise((r) => setTimeout(r, 200)); // approval logged on response finish
    const appr = await db('approval_authorizations').where({ kind: 'export_cancel_forfeit', ref: String(o.id) });
    expect(appr).toHaveLength(1);
  });

  test('debit notes are cancelled by delta; un-ordered PRs cancelled; cost payables flagged, not touched', async () => {
    const o = await makeOrder('D');
    const debitNotes = require('../modules/exportOrders/debitNote.service');
    // A debit note is only issuable once Shipped/Arrived (P2-01); stage that,
    // then put the order back to cancel it.
    const { status: was } = await db('export_orders').where({ id: o.id }).first('status');
    await db('export_orders').where({ id: o.id }).update({ status: 'Shipped' });
    const note = await debitNotes.issue(o.id, { amount: 300 }, ownerId);
    await db('export_orders').where({ id: o.id }).update({ status: was });
    const [pr] = await db('purchase_requisitions').insert({
      req_no: `ZPR${run}`, linked_export_order_id: o.id, status: 'Submitted', qty_mt: 1,
    }).returning('*');
    const costs = require('../modules/exportOrders/exportCosts');
    await db.transaction(async (trx) => costs.recordOrderCost(trx, {
      order: await trx('export_orders').where({ id: o.id }).first(), category: 'freight', amount: 5000, vendorName: 'Line', userId: ownerId,
    }));

    const res = await cancel(o, { reason: 'no vessel' });
    expect(res.status).toBe(200);
    expect(res.body.data.cancelledDebitNotes).toEqual([note.debit_note_no]);
    expect(res.body.data.flagged.openCostPayables).toBe(1);
    expect(res.body.message).toMatch(/1 unpaid cost bill/);

    const n = await db('export_debit_notes').where({ id: note.id }).first();
    expect(n.status).toBe('Cancelled');
    expect(n.cancel_journal_id).toBeTruthy();
    expect(await glNet(note.debit_note_no, '1110')).toBe(0);
    expect(await glNet(note.debit_note_no, '4070')).toBe(0);
    expect((await db('purchase_requisitions').where({ id: pr.id }).first()).status).toBe('Cancelled');
    expect(res.body.data.cancelledRequisitions).toBe(1);
    // The incurred cost stays payable.
    const pay = await db('payables').join('export_order_costs as c', 'c.id', 'payables.source_id')
      .where({ 'payables.source_table': 'export_order_costs', 'c.order_id': o.id }).first('payables.status');
    expect(pay.status).toBe('Pending');
  });

  test('a balance receipt (1110 at booked 280, banked at 285) refunds to zero on 1110 and 6210', async () => {
    const o = await makeOrder('B', { balance: true });
    await pay(o, 'advance', 2000, 280);
    await pay(o, 'balance', 1000, 285);
    expect(await glNet(o.order_no, '6210')).toBe(-5000); // the realised gain at receipt
    const res = await cancel(o, { money_disposition: 'refund' });
    expect(res.status).toBe(200);
    expect(await glNet(o.order_no, '1110')).toBe(0);
    expect(await glNet(o.order_no, '1310')).toBe(0);
    expect(await glNet(o.order_no, '6210')).toBe(0);
    expect(await tbBalanced(o.order_no)).toBe(true);
  });
});
