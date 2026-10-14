/**
 * P2-17 + P2-19 end to end over HTTP against a real, migrated Postgres.
 *
 *  P2-19 (owner decision D-3): a payment reversal needs a reason AND the
 *  Owner's approval (an Owner self-approves; anyone else has an Owner enter
 *  their password); Mill Manager and Export Manager no longer hold
 *  finance.reverse_payment (mig 364). Reversing twice posts one reversal; a
 *  payment whose journal was status-flipped earlier gets no inverse built
 *  (no double reversal). A payment is in its document's currency.
 *
 *  P2-17: after each money path the touched accounts still tie out —
 *  balance = Σ posted bank rows = own GL (PKR).
 *
 * DB-gated: skipped unless DB_HOST is set. Rows carry a per-run suffix.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('payment reversal controls + cash tie-out (DB-gated)', () => {
  let db; let app; let request; let bankTieOut;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};
  const acc = {};
  const TODAY = new Date().toISOString().slice(0, 10);
  const OWNER_PW = 'zz-owner-pw';

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body, headers = {}) => request(app).post(url).set({ ...auth(who), ...headers }).send(body);
  const ownerHeader = (pw = OWNER_PW) => ({ 'X-Owner-Credential': Buffer.from(pw, 'utf8').toString('base64') });
  const tiesOut = async (accountId) => {
    const t = await bankTieOut(db);
    return t.accounts.find((a) => Number(a.account_id) === Number(accountId));
  };

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    ({ bankTieOut } = require('../modules/finance/bankTieOut'));
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcryptjs');
    const config = require('../config');
    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    const hash = await bcrypt.hash(OWNER_PW, 4);
    for (const [key, role] of [['owner', 'Owner'], ['fm', 'Finance Manager'], ['mm', 'Mill Manager'], ['em', 'Export Manager']]) {
      const [u] = await db('users').insert({
        email: `zz-p219-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: key === 'owner' ? hash : 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      ids[key] = u.id;
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }
    // Accounts made the real way (createBankAccount): own GL, opening balance
    // booked as a bank row + journal, so they tie out from the start.
    const { createBankAccount } = require('../modules/admin/bankAccounts.service');
    for (const [key, opening] of [['bank', 100000], ['empty', 0]]) {
      const out = await db.transaction((trx) => createBankAccount(trx, {
        name: `ZZ ${key} ${run}`, type: 'bank', entity: 'general', currency: 'PKR', is_active: true, opening_balance: opening,
      }, ids.owner));
      acc[key] = out.bank_account;
    }
    const [sup] = await db('suppliers').insert({ name: `ZZ Supplier ${run}`, type: 'local' }).returning('*');
    ids.sup = sup.id;
    const [cust] = await db('customers').insert({ name: `ZZ Buyer ${run}`, customer_type: 'export', currency: 'USD' }).returning('*');
    ids.cust = cust.id;
  });

  afterAll(async () => { if (db) await db.destroy(); });

  const newPayable = async (amount, currency = 'PKR') => {
    const [pa] = await db('payables').insert({
      pay_no: `ZZP219-${run}-${Math.random().toString(36).slice(2, 7)}`, entity: 'general', supplier_id: ids.sup,
      original_amount: amount, paid_amount: 0, outstanding: amount, status: 'Pending', currency, category: 'Other',
    }).returning('*');
    return pa;
  };
  const pay = (who, pa, extra = {}) => post(who, '/api/finance/payments', {
    type: 'payment', linked_payable_id: pa.id, amount: Number(pa.original_amount), currency: 'PKR',
    payment_method: 'bank_transfer', bank_account_id: acc.bank.id, payment_date: TODAY, ...extra,
  });
  const reversalJournals = (paymentNo) => db('journal_entries').where({ ref_no: paymentNo, ref_type: 'Payment Reversal', status: 'Posted' });

  test('new accounts tie out (opening balance is a bank row + journal)', async () => {
    expect(await tiesOut(acc.bank.id)).toMatchObject({ balance: 100000, sub_ledger: 100000, gl_balance_pkr: 100000, ok: true });
    expect(await tiesOut(acc.empty.id)).toMatchObject({ balance: 0, ok: true });
  });

  test('a reason is mandatory', async () => {
    const p = (await pay('fm', await newPayable(1000))).body.data.payment;
    const r = await post('owner', `/api/finance/payments/${p.id}/reverse`, {});
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/reason is required/i);
    const blank = await post('owner', `/api/finance/payments/${p.id}/reverse`, { reason: '   ' });
    expect(blank.status).toBe(400);
    expect((await db('payments').where({ id: p.id }).first()).status).not.toBe('Reversed');
  });

  test('Mill Manager and Export Manager can no longer reverse (D-3, mig 364)', async () => {
    const p = (await pay('fm', await newPayable(1000))).body.data.payment;
    for (const who of ['mm', 'em']) {
      const r = await post(who, `/api/finance/payments/${p.id}/reverse`, { reason: 'wrong bill', authorized_by_owner_id: ids.owner }, ownerHeader());
      expect(r.status).toBe(403);
    }
    expect((await db('payments').where({ id: p.id }).first()).status).not.toBe('Reversed');
  });

  test('a Finance Manager needs the Owner: no owner → 403, wrong password → 403, owner password → 200 and logged', async () => {
    const pa = await newPayable(2500);
    const p = (await pay('fm', pa)).body.data.payment;
    const none = await post('fm', `/api/finance/payments/${p.id}/reverse`, { reason: 'duplicate' });
    expect(none.status).toBe(403);
    expect(none.body.code).toBe('OWNER_AUTH_REQUIRED');
    const wrong = await post('fm', `/api/finance/payments/${p.id}/reverse`, { reason: 'duplicate', authorized_by_owner_id: ids.owner }, ownerHeader('nope'));
    expect(wrong.status).toBe(403);
    expect((await db('payments').where({ id: p.id }).first()).status).not.toBe('Reversed');

    const ok = await post('fm', `/api/finance/payments/${p.id}/reverse`, { reason: 'duplicate', authorized_by_owner_id: ids.owner }, ownerHeader());
    expect(ok.status).toBe(200);
    expect(ok.body.data.payment).toMatchObject({ status: 'Reversed', reversal_reason: 'duplicate', reversed_by: ids.fm });
    await new Promise((r) => setTimeout(r, 50)); // the approval log is written on response finish
    const log = await db('approval_authorizations').where({ kind: 'payment_reversal', ref: String(p.id) }).first();
    expect(log).toMatchObject({ performed_by: ids.fm, authorized_by_owner_id: ids.owner, verification: 'password' });
    expect(Number((await db('payables').where({ id: pa.id }).first()).paid_amount)).toBe(0);
    expect(await tiesOut(acc.bank.id)).toMatchObject({ ok: true });
  });

  test('reversing twice posts one reversal', async () => {
    const p = (await pay('fm', await newPayable(3000))).body.data.payment;
    const before = (await tiesOut(acc.bank.id)).balance;
    expect((await post('owner', `/api/finance/payments/${p.id}/reverse`, { reason: 'typo' })).status).toBe(200);
    const again = await post('owner', `/api/finance/payments/${p.id}/reverse`, { reason: 'typo' });
    expect(again.status).toBe(400);
    expect(await reversalJournals(p.payment_no)).toHaveLength(1);
    expect((await tiesOut(acc.bank.id)).balance).toBe(before + 3000);
    expect(await tiesOut(acc.bank.id)).toMatchObject({ ok: true });
  });

  test('a payment whose journal was status-flipped earlier gets no second (inverse) reversal', async () => {
    const p = (await pay('fm', await newPayable(4000))).body.data.payment;
    // An old "reverse" that only flipped the journal's status: the GL is
    // already undone for this payment.
    await db('journal_entries').where({ ref_no: p.payment_no, ref_type: 'Payment' }).update({ status: 'Reversed' });
    const r = await post('owner', `/api/finance/payments/${p.id}/reverse`, { reason: 'cleanup' });
    expect(r.status).toBe(200);
    expect(await reversalJournals(p.payment_no)).toHaveLength(0);
  });

  test('a reversal journal already posted blocks another one (409)', async () => {
    const p = (await pay('fm', await newPayable(1500))).body.data.payment;
    expect((await post('owner', `/api/finance/payments/${p.id}/reverse`, { reason: 'first' })).status).toBe(200);
    // Someone flips the payment back by hand.
    await db('payments').where({ id: p.id }).update({ status: 'Confirmed' });
    const r = await post('owner', `/api/finance/payments/${p.id}/reverse`, { reason: 'second' });
    expect(r.status).toBe(409);
    expect(await reversalJournals(p.payment_no)).toHaveLength(1);
  });

  test('payment currency must equal the document currency', async () => {
    const pa = await newPayable(1000);
    const usd = await pay('fm', pa, { currency: 'USD' });
    expect(usd.status).toBe(400);
    expect(usd.body.message).toMatch(/in PKR/);
    const [rv] = await db('receivables').insert({
      recv_no: `ZZR219-${run}`, type: 'Advance', entity: 'general', customer_id: ids.cust,
      currency: 'USD', expected_amount: 100, received_amount: 0, outstanding: 100, status: 'Pending',
    }).returning('*');
    const pkr = await post('fm', '/api/finance/payments', {
      type: 'receipt', linked_receivable_id: rv.id, amount: 100, currency: 'PKR',
      payment_method: 'bank_transfer', bank_account_id: acc.bank.id, payment_date: TODAY,
    });
    expect(pkr.status).toBe(400);
    expect(pkr.body.message).toMatch(/in USD/);
    expect(Number((await db('receivables').where({ id: rv.id }).first()).received_amount)).toBe(0);
  });

  test('P2-31: a payment that overdraws its account goes through with the warning; the account still ties out', async () => {
    const pa = await newPayable(700);
    const r = await pay('fm', pa, { bank_account_id: acc.empty.id });
    expect(r.status).toBe(201);
    expect(r.body.data.warning).toMatchObject({ account_id: acc.empty.id, overdrawn_by: 700, balance_after: -700 });
    expect(await tiesOut(acc.empty.id)).toMatchObject({ balance: -700, sub_ledger: -700, gl_balance_pkr: -700, ok: true });
    const fine = await pay('fm', await newPayable(10));
    expect(fine.body.data.warning).toBeUndefined();
  });
});
