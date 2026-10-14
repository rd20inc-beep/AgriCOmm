/**
 * P2-16 — service-milling invoices: validation, one live invoice per batch,
 * void through Owner approval + finance (MIL-10, MIL-32, MIL-33).
 *
 *   - Joi on create; no invoice before yield; discount > charges refused
 *   - two concurrent creates → exactly one invoice (lock + partial unique index)
 *   - void needs a reason + the Owner; keeps the invoice (status Void), the
 *     receivable (Written Off) and the journals (signed delta, never deleted);
 *     voids the unpaid client-freight hauler payable, refuses a paid one
 *   - void refuses while a Finance-recorded receipt is live; an old journal-less
 *     receipt is reversed by a finance.reverse_payment holder only
 *   - tax: NOT changed (no decided sales-tax account — deferred)
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('service-milling invoice controls (DB-gated)', () => {
  let db; let app; let request;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};
  const OWNER_PW = 'owner-pw-zz';
  const cred = (s) => Buffer.from(s, 'utf8').toString('base64');
  let seq = 0;

  const net = async (refNo, code) => (await db('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
    .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'c.code': code })
    .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0)::float AS n')).first()).n;
  const makeBatch = async (yielded = true) => {
    seq += 1;
    const [b] = await db('milling_batches').insert({
      batch_no: `S${run}-${seq}`, mill_id: ids.mill, raw_qty_kg: 10000, status: yielded ? 'Completed' : 'In Progress',
      is_service_milling: true, client_customer_id: ids.client, service_milling_rate_per_kg: 2,
      katta_count: 200, service_rental_rate_per_katta: 10, service_labour_rate_per_katta: 5,
      created_by: ids.owner,
      ...(yielded ? { actual_finished_kg: 7000, bran_kg: 1000, husk_kg: 2000 } : {}),
    }).returning('*');
    return b;
  };
  const create = (who, body) => request(app).post('/sm/invoices').set('x-test-user', String(who)).send(body);
  const voidReq = (who, invId, body, ownerPw) => {
    const r = request(app).post(`/sm/invoices/${invId}/void`).set('x-test-user', String(who)).send(body);
    return ownerPw ? r.set('X-Owner-Credential', cred(ownerPw)) : r;
  };

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    const express = require('express');
    const bcrypt = require('bcryptjs');
    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    const [clerkRole] = await db('roles').insert({ name: `ZZ SM Clerk ${run}` }).returning('*');
    const perm = await db('permissions').where({ module: 'service_milling', action: 'create_invoice' }).first();
    await db('role_permissions').insert({ role_id: clerkRole.id, permission_id: perm.id });
    ids.roles = {
      owner: await roleId('Owner'), finance: await roleId('Finance Manager'), clerk: clerkRole.id,
    };
    const user = async (tag, role, pw = 'x') => (await db('users').insert({
      email: `zz-sm-${tag}-${run}@test.local`, full_name: `ZZ SM ${tag} ${run}`, password_hash: await bcrypt.hash(pw, 4),
      role_id: role, is_active: true, status: 'active',
    }).returning('*'))[0].id;
    ids.owner = await user('owner', ids.roles.owner, OWNER_PW);
    ids.finance = await user('fin', ids.roles.finance);
    ids.clerk = await user('clerk', ids.roles.clerk);
    const roleOf = { [ids.owner]: ids.roles.owner, [ids.finance]: ids.roles.finance, [ids.clerk]: ids.roles.clerk };
    ids.client = (await db('customers').insert({ name: `ZZ SM Client ${run}`, customer_type: 'service_milling' }).returning('*'))[0].id;
    ids.hauler = (await db('haulers').insert({ name: `ZZ SM Hauler ${run}` }).returning('*'))[0].id;
    ids.mill = (await db('mills').insert({ name: `ZZ SM Mill ${run}` }).returning('*'))[0].id;
    const [acct] = await db('bank_accounts').insert({ name: `ZZ SM Bank ${run}`, type: 'bank', entity: 'mill', currency: 'PKR', is_active: true, current_balance: 100000 }).returning('*');
    await require('../shared/accountGl').ensureAccountGl(db, acct);
    ids.bank = acct.id;

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const id = parseInt(req.headers['x-test-user'], 10);
      req.user = { id, role_id: roleOf[id] };
      next();
    });
    app.use('/sm', require('../modules/serviceMilling/serviceMilling.routes'));
  });
  beforeEach(() => require('../middleware/ownerApproval')._resetAttempts());
  afterAll(async () => { if (db) await db.destroy(); });

  test('validation: Joi, no invoice before yield, discount larger than the charges', async () => {
    expect((await create(ids.clerk, { milling_rate_per_kg: 2 })).status).toBe(400);
    const b = await makeBatch(true);
    expect((await create(ids.clerk, { service_batch_id: b.id, discount: -5 })).status).toBe(400);
    expect((await create(ids.clerk, { service_batch_id: b.id, tax_pct: 150 })).status).toBe(400);
    const tooMuch = await create(ids.clerk, { service_batch_id: b.id, discount: 999999 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.message).toMatch(/Discount .* more than the service charges/);

    const early = await makeBatch(false);
    const r = await create(ids.clerk, { service_batch_id: early.id });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/no yield recorded/);
    expect(await db('service_milling_invoices').whereIn('service_batch_id', [b.id, early.id])).toHaveLength(0);
  });

  test('two concurrent creates for one batch → one invoice', async () => {
    const b = await makeBatch(true);
    const [r1, r2] = await Promise.all([
      create(ids.clerk, { service_batch_id: b.id }),
      create(ids.clerk, { service_batch_id: b.id }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await db('service_milling_invoices').where({ service_batch_id: b.id })).toHaveLength(1);
  });

  test('void: reason + Owner required; freight payable voided; nothing deleted; GL nets to zero; batch re-invoiceable', async () => {
    const b = await makeBatch(true);
    const c = await create(ids.clerk, { service_batch_id: b.id, freight_amount: 3000, freight_hauler_id: ids.hauler });
    expect(c.status).toBe(201);
    const inv = c.body.data;
    expect(await net(inv.invoice_no, '1120')).toBe(Number(inv.total_amount));

    expect((await voidReq(ids.clerk, inv.id, { reason: 'wrong katta count' })).status).toBe(403); // no owner
    expect((await voidReq(ids.clerk, inv.id, { reason: 'x', authorized_by_owner_id: ids.owner }, OWNER_PW)).status).toBe(400); // reason too short
    const ok = await voidReq(ids.clerk, inv.id, { reason: 'wrong katta count', authorized_by_owner_id: ids.owner }, OWNER_PW);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ voided: inv.invoice_no, voided_hauler_payables: 1 });

    const after = await db('service_milling_invoices').where({ id: inv.id }).first();
    expect(after).toMatchObject({ status: 'Void', void_reason: 'wrong katta count', voided_by: ids.clerk, void_authorized_by: ids.owner });
    expect((await db('receivables').where({ service_invoice_id: inv.id }).first()).status).toBe('Written Off');
    const haul = await db('payables').where({ source_table: 'service_transport', source_id: inv.id }).first();
    expect(haul.status).toBe('Reversed');
    expect((await db('transport_costs').where({ payable_id: haul.id }).first()).status).toBe('cancelled');
    for (const code of ['1120', '4050', '1450', '2010']) expect(await net(inv.invoice_no, code)).toBe(0);
    const js = await db('journal_entries').where({ ref_no: inv.invoice_no }).select('status', 'ref_type');
    expect(js.every((j) => j.status === 'Posted')).toBe(true);
    expect(js.some((j) => j.ref_type === 'Service Milling Invoice Void')).toBe(true);
    // The owner's authorization is logged once the void succeeds (on 'finish').
    await new Promise((r) => setTimeout(r, 150));
    expect(await db('approval_authorizations').where({ kind: 'service_invoice_void', ref: String(inv.id) }))
      .toEqual([expect.objectContaining({ performed_by: ids.clerk, authorized_by_owner_id: ids.owner, verification: 'password' })]);

    expect((await voidReq(ids.owner, inv.id, { reason: 'again please' })).status).toBe(409);
    const again = await create(ids.clerk, { service_batch_id: b.id });
    expect(again.status).toBe(201);
    expect(await db('service_milling_invoices').where({ service_batch_id: b.id })).toHaveLength(2);
    // The batch list bills the live invoice only.
    expect((await db('service_milling_invoices').where({ service_batch_id: b.id, status: 'Active' })).length).toBe(1);
  });

  test('void refused when the transporter was already paid', async () => {
    const b = await makeBatch(true);
    const inv = (await create(ids.clerk, { service_batch_id: b.id, freight_amount: 2000, freight_hauler_id: ids.hauler })).body.data;
    await db('payables').where({ source_table: 'service_transport', source_id: inv.id }).update({ paid_amount: 500, outstanding: 1500, status: 'Partial' });
    const r = await voidReq(ids.owner, inv.id, { reason: 'client cancelled' });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/transporter has already been paid/);
    expect((await db('service_milling_invoices').where({ id: inv.id }).first()).status).toBe('Active');
  });

  test('a Finance-recorded receipt blocks the void until reversed in Finance', async () => {
    const b = await makeBatch(true);
    const inv = (await create(ids.clerk, { service_batch_id: b.id })).body.data;
    const pay = await request(app).post(`/sm/invoices/${inv.id}/payments`).set('x-test-user', String(ids.finance))
      .send({ amount: 1000, payment_method: 'bank_transfer', bank_account_id: ids.bank });
    expect(pay.status).toBe(201);
    const r = await voidReq(ids.owner, inv.id, { reason: 'client cancelled' });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Reverse or reject them in Finance/);
    expect((await db('payments').where({ service_invoice_id: inv.id }).first()).status).not.toBe('Reversed');
  });

  test('an old journal-less receipt is reversed with the void — only by a finance.reverse_payment holder', async () => {
    const b = await makeBatch(true);
    const inv = (await create(ids.clerk, { service_batch_id: b.id })).body.data;
    const before = Number((await db('bank_accounts').where({ id: ids.bank }).first()).current_balance);
    const [p] = await db('payments').insert({
      payment_no: `ZZSMP${run}`, type: 'receipt', amount: 700, currency: 'PKR', status: 'Confirmed',
      service_invoice_id: inv.id, bank_account_id: ids.bank, payment_method: 'bank_transfer', payment_date: db.fn.now(),
    }).returning('*');
    await db('service_milling_invoices').where({ id: inv.id }).update({ received_amount: 700 });

    const denied = await voidReq(ids.clerk, inv.id, { reason: 'client cancelled', authorized_by_owner_id: ids.owner }, OWNER_PW);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toMatch(/payment-reversal permission/);

    const ok = await voidReq(ids.finance, inv.id, { reason: 'client cancelled', authorized_by_owner_id: ids.owner }, OWNER_PW);
    expect(ok.status).toBe(200);
    const pr = await db('payments').where({ id: p.id }).first();
    expect(pr.status).toBe('Reversed');
    expect(pr.reversal_reason).toMatch(/client cancelled/);
    expect(Number((await db('bank_accounts').where({ id: ids.bank }).first()).current_balance)).toBe(before - 700);
    expect(await db('bank_transactions').where({ linked_payment_id: p.id, type: 'debit', source: 'payment_reversal' })).toHaveLength(1);
  });
});
