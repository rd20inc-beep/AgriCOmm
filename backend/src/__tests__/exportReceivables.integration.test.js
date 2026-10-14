/**
 * Export receivables, end to end over HTTP against a real, fully-migrated
 * Postgres (Phase 2: P2-01, P2-18, P2-29).
 *
 *  - P2-01 / EXP-01: a contract-summary save that changes no contract value
 *    never touches the receivables (the audit reproduction: a port-only edit on
 *    a paid order reset RCV-ADV to fully owing); a real change resyncs under
 *    the order lock and writes outstanding = expected − received; pending
 *    receipts and 'Arrived' lock the contract; issued debit notes survive a
 *    recompute and are only issuable once shipped; the receivables CHECK.
 *  - P2-18: the order's advance / balance received and financial_status are
 *    derived from its receivables and their receipts (migration 342); reject
 *    is transactional and validated; parent-link CHECKs; 'On Hold' history.
 *  - P2-29: bank charges on a receipt (→ 6200, ≤ tolerance), the
 *    Owner-approved short-balance write-off, the advance term setting.
 *
 * DB-gated: skipped unless DB_HOST is set. Local run (throwaway database):
 *   export DB_HOST=… DB_PORT=… DB_NAME=<throwaway> DB_USER=… DB_PASSWORD=…
 *   npx knex migrate:latest --env development
 *   npx jest exportReceivables.integration
 *
 * Every row it creates carries a per-run suffix; assertions are per order.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(90000);

d('export receivables (DB-gated)', () => {
  let db; let app; let request; let receipts;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};
  let seq = 0;

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who)).send(body || {});
  const put = (who, url, body) => request(app).put(url).set(auth(who)).send(body || {});
  const n = (v) => Number(v);
  const recv = async (orderId, type) => db('receivables').where({ order_id: orderId, type }).first();
  const order = async (id) => db('export_orders').where({ id }).first();
  const setting = async (key, value) => db('system_settings').where({ key }).update({ value });

  // The Contract Summary editor's PUT body (src/.../orderEdits.contractEditPayload):
  // it ALWAYS carries advance_pct and the freight fields, whatever was edited.
  const contractBody = (o, over = {}) => ({
    incoterm: o.incoterm,
    advance_pct: n(o.advance_pct),
    destination_port: o.destination_port || null,
    shipment_eta: null,
    doc_address_mode: 'country',
    doc_weight_unit: 'kg',
    freight_per_mt: o.freight_per_mt == null ? null : n(o.freight_per_mt),
    insurance_per_mt: o.insurance_per_mt == null ? null : n(o.insurance_per_mt),
    freight_basis_date: null,
    freight_valid_until: null,
    freight_display: o.freight_display || 'in_price',
    freight_clause: null,
    ...over,
  });

  async function createOrder({ currency = 'USD', advancePct = 20, qty = 10, price = 500, fx = 280 } = {}) {
    seq += 1;
    const res = await post('owner', '/api/export-orders', {
      customer_id: ids.customer,
      product_id: ids.product,
      qty_mt: qty,
      price_per_mt: price,
      contract_value: qty * price,
      currency,
      incoterm: 'FOB',
      advance_pct: advancePct,
      bank_account_id: currency === 'USD' ? ids.usdBank : ids.eurBank,
      status: 'Awaiting Advance',
      booked_fx_rate: fx,
      contract_number: `ZZ-C-${run}-${seq}`,
    });
    if (res.status !== 201 && res.status !== 200) throw new Error(`create ${res.status}: ${JSON.stringify(res.body)}`);
    const o = res.body.data.order || res.body.data;
    return order(o.id);
  }

  // Finance Manager records; the Owner confirms (maker-checker).
  async function receive(orderId, { kind = 'advance', amount, bankCharges } = {}) {
    const r = await post('fm', `/api/export-orders/${orderId}/record-receipt`, {
      kind, amount, bank_account_id: ids.usdBank, fx_rate: 285, payment_method: 'bank_transfer',
      ...(bankCharges != null ? { bank_charges: bankCharges } : {}),
    });
    if (r.status !== 201) throw new Error(`record ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body.data.payment;
  }
  async function confirm(paymentId, body = {}) {
    const r = await post('owner', `/api/export-orders/receipts/${paymentId}/confirm`, { fx_rate: 285, ...body });
    if (r.status !== 200) throw new Error(`confirm ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  }
  const ship = async (id, status = 'Shipped') => db('export_orders').where({ id }).update({ status });

  beforeAll(async () => {
    db = require('../config/database');
    receipts = require('../modules/exportOrders/exportReceipts');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    for (const [key, role] of [['owner', 'Owner'], ['fm', 'Finance Manager']]) {
      const [u] = await db('users').insert({
        email: `zz-p2r-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      ids[key] = u.id;
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }
    const [bank] = await db('bank_accounts').insert({
      name: `ZZ USD ${run}`, is_active: true, type: 'bank', entity: 'export', currency: 'USD', current_balance: 0,
    }).returning('*');
    await require('../shared/accountGl').ensureAccountGl(db, bank);
    ids.usdBank = bank.id;
    const [eur] = await db('bank_accounts').insert({
      name: `ZZ EUR ${run}`, is_active: true, type: 'bank', entity: 'export', currency: 'EUR', current_balance: 0,
    }).returning('*');
    await require('../shared/accountGl').ensureAccountGl(db, eur);
    ids.eurBank = eur.id;
    const [c] = await db('customers').insert({ name: `ZZ Buyer ${run}`, customer_type: 'export', currency: 'USD' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ Rice ${run}` }).returning('*');
    ids.customer = c.id; ids.product = p.id;
  });
  afterAll(async () => { if (db) await db.destroy(); });

  // ───────────────────────────────────────────────────────────── P2-01
  describe('P2-01 contract edits never reset paid receivables', () => {
    test('audit reproduction: a port-only save on a fully-paid advance leaves RCV-ADV paid', async () => {
      const o = await createOrder();
      expect(n(o.advance_expected)).toBe(1000);
      await confirm((await receive(o.id, { amount: 1000 })).id);
      const before = await recv(o.id, 'Advance');
      expect(before).toMatchObject({ status: 'Paid' });
      expect(n(before.outstanding)).toBe(0);

      const res = await put('owner', `/api/export-orders/${o.id}`, contractBody(o, { destination_port: 'Jebel Ali', shipment_eta: '2026-12-01' }));
      expect(res.status).toBe(200);

      const after = await recv(o.id, 'Advance');
      expect(n(after.received_amount)).toBe(1000);
      expect(n(after.outstanding)).toBe(0);
      expect(after.status).toBe('Paid');
      expect(after.updated_at.getTime()).toBe(before.updated_at.getTime()); // not rewritten at all
      const oo = await order(o.id);
      expect(oo.destination_port).toBe('Jebel Ali');
      expect(n(oo.advance_received)).toBe(1000);
      expect(oo.financial_status).toBe('Confirmed');
    });

    test('a partial payment survives a soft edit: outstanding stays expected − received', async () => {
      const o = await createOrder();
      await confirm((await receive(o.id, { amount: 400 })).id);
      const res = await put('owner', `/api/export-orders/${o.id}`, contractBody(o, { incoterm: 'CFR' }));
      expect(res.status).toBe(200);
      const r = await recv(o.id, 'Advance');
      expect([n(r.expected_amount), n(r.received_amount), n(r.outstanding), r.status]).toEqual([1000, 400, 600, 'Partial']);
      expect((await order(o.id)).financial_status).toBe('Partially Confirmed');
    });

    test('changing the amount after a payment is refused and nothing moves', async () => {
      const o = await createOrder();
      await confirm((await receive(o.id, { amount: 1000 })).id);
      const res = await put('owner', `/api/export-orders/${o.id}`, contractBody(o, { advance_pct: 30 }));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/payment has been received/);
      const r = await recv(o.id, 'Advance');
      expect([n(r.expected_amount), n(r.outstanding)]).toEqual([1000, 0]);
    });

    test('an amount edit before any money resyncs both receivables, outstanding = expected − received', async () => {
      const o = await createOrder();
      const res = await put('owner', `/api/export-orders/${o.id}`, { qty_mt: 12, advance_pct: 25 });
      expect(res.status).toBe(200);
      const adv = await recv(o.id, 'Advance');
      const bal = await recv(o.id, 'Balance');
      expect([n(adv.expected_amount), n(adv.outstanding)]).toEqual([1500, 1500]);
      expect([n(bal.expected_amount), n(bal.outstanding)]).toEqual([4500, 4500]);
      expect(n(adv.base_amount_pkr)).toBe(1500 * 280);
    });

    test('a receipt awaiting Finance locks the contract; soft edits still save', async () => {
      const o = await createOrder();
      await receive(o.id, { amount: 300 });
      const hard = await put('owner', `/api/export-orders/${o.id}`, contractBody(o, { advance_pct: 10 }));
      expect(hard.status).toBe(400);
      expect(hard.body.message).toMatch(/waiting for Finance/);
      const soft = await put('owner', `/api/export-orders/${o.id}`, contractBody(o, { destination_port: 'Mombasa' }));
      expect(soft.status).toBe(200);
      expect(n((await recv(o.id, 'Advance')).expected_amount)).toBe(1000);
    });

    test("'Arrived' locks the contract (and Shipped / final payment keep the balance paid)", async () => {
      const o = await createOrder();
      await confirm((await receive(o.id, { amount: 1000 })).id);
      await ship(o.id);
      await confirm((await receive(o.id, { kind: 'balance', amount: 4000 })).id);
      await ship(o.id, 'Arrived');
      const soft = await put('owner', `/api/export-orders/${o.id}`, contractBody(await order(o.id), { destination_port: 'Durban' }));
      expect(soft.status).toBe(200);
      const bal = await recv(o.id, 'Balance');
      expect([n(bal.received_amount), n(bal.outstanding), bal.status]).toEqual([4000, 0, 'Paid']);
      // Nothing received on a fresh Arrived order still locks it.
      const o2 = await createOrder({ advancePct: 0 });
      await ship(o2.id, 'Arrived');
      const hard = await put('owner', `/api/export-orders/${o2.id}`, { price_per_mt: 600 });
      expect(hard.status).toBe(400);
      expect(hard.body.message).toMatch(/Arrived/);
    });

    test('a foreign-currency order rebases PKR at its booked rate', async () => {
      const o = await createOrder({ currency: 'EUR', fx: 300 });
      const res = await put('owner', `/api/export-orders/${o.id}`, { price_per_mt: 550, advance_pct: 20 });
      expect(res.status).toBe(200);
      const adv = await recv(o.id, 'Advance');
      expect(adv.currency).toBe('EUR');
      expect([n(adv.expected_amount), n(adv.outstanding), n(adv.base_amount_pkr)]).toEqual([1100, 1100, 1100 * 300]);
    });

    test('a cancelled order: soft edit leaves the written-off receivables alone, contract edit refused', async () => {
      const o = await createOrder();
      const c = await post('owner', `/api/export-orders/${o.id}/cancel`, { reason: 'ZZ test' });
      expect(c.status).toBe(200);
      const soft = await put('owner', `/api/export-orders/${o.id}`, contractBody(await order(o.id), { destination_port: 'Aden' }));
      expect(soft.status).toBe(200);
      expect((await recv(o.id, 'Advance')).status).toBe('Written Off');
      const hard = await put('owner', `/api/export-orders/${o.id}`, { qty_mt: 20 });
      expect(hard.status).toBe(400);
    });

    test('debit notes: refused before shipment; an Issued note survives a contract recompute', async () => {
      const o = await createOrder();
      const early = await post('owner', `/api/export-orders/${o.id}/debit-notes`, { amount: 100, reason: 'freight up' });
      expect(early.status).toBe(400);
      expect(early.body.errors[0].message).toMatch(/Shipped or Arrived/);
      // A note issued before this rule (legacy data) on an order still editable.
      await db('export_debit_notes').insert({
        debit_note_no: `DN-ZZ-${run}`, order_id: o.id, customer_id: ids.customer, issue_date: '2026-10-01',
        currency: 'USD', amount: 250, fx_rate: 280, amount_pkr: 70000, status: 'Issued',
      });
      await db('export_orders').where({ id: o.id }).update({ balance_expected: 4250 });
      await db('receivables').where({ order_id: o.id, type: 'Balance' }).update({ expected_amount: 4250, outstanding: 4250 });
      const res = await put('owner', `/api/export-orders/${o.id}`, { price_per_mt: 600, advance_pct: 20 });
      expect(res.status).toBe(200);
      // 6000 contract − 1200 advance + 250 note
      expect(n((await order(o.id)).balance_expected)).toBe(5050);
      const bal = await recv(o.id, 'Balance');
      expect([n(bal.expected_amount), n(bal.outstanding)]).toEqual([5050, 5050]);
      // Once shipped, a note can be issued.
      await ship(o.id);
      const late = await post('owner', `/api/export-orders/${o.id}/debit-notes`, { amount: 100, reason: 'freight up' });
      expect(late.status).toBe(201);
    });

    test('a receipt confirmed while an edit waits on the lock stops the rebuild', async () => {
      const o = await createOrder();
      const p = await receive(o.id, { amount: 1000 });
      // The confirmation holds the order lock…
      const trx = await db.transaction();
      await receipts.confirmPendingExportReceipt(trx, { paymentId: p.id, fxRate: 285, userId: ids.owner });
      // …while the edit runs: its pre-check still sees the committed pending
      // receipt (refused fast), or it waits on the lock and then sees the
      // money (refused) — either way the receivables are not rebuilt.
      const editing = put('owner', `/api/export-orders/${o.id}`, contractBody(o, { advance_pct: 50 })).then((r) => r); // supertest sends on then()
      await new Promise((r) => setTimeout(r, 300));
      await trx.commit();
      const res = await editing;
      expect([400, 409]).toContain(res.status);
      const adv = await recv(o.id, 'Advance');
      expect([n(adv.expected_amount), n(adv.received_amount), n(adv.outstanding)]).toEqual([1000, 1000, 0]);
    });

    test('the in-transaction re-check (409) catches money that arrived after the pre-check', async () => {
      const o = await createOrder();
      // Hold the order lock, then insert a confirmed receipt straight onto the
      // receivable, as a Money-In receipt would, and commit after the edit queued.
      const trx = await db.transaction();
      await trx('export_orders').where({ id: o.id }).forUpdate().first();
      const editing = put('owner', `/api/export-orders/${o.id}`, contractBody(o, { advance_pct: 40 })).then((r) => r); // supertest sends on then()
      await new Promise((r) => setTimeout(r, 300));
      const r = await trx('receivables').where({ order_id: o.id, type: 'Advance' }).first();
      await trx('receivables').where({ id: r.id }).update({ received_amount: 500, outstanding: 500, status: 'Partial' });
      await trx.commit();
      const res = await editing;
      expect(res.status).toBe(409);
      const adv = await recv(o.id, 'Advance');
      expect([n(adv.expected_amount), n(adv.received_amount), n(adv.outstanding)]).toEqual([1000, 500, 500]);
    });

    test('CHECK: outstanding must equal expected − received (written-off rows exempt)', async () => {
      const o = await createOrder();
      await confirm((await receive(o.id, { amount: 1000 })).id);
      const r = await recv(o.id, 'Advance');
      await expect(db('receivables').where({ id: r.id }).update({ outstanding: 1000 }))
        .rejects.toMatchObject({ code: '23514', constraint: 'chk_receivables_outstanding_equation' });
      await expect(db('receivables').where({ id: r.id }).update({ status: 'Written Off', outstanding: 0, received_amount: 0 }))
        .resolves.toBe(1);
      const con = await db.raw("SELECT convalidated FROM pg_constraint WHERE conname = 'chk_receivables_outstanding_equation'");
      expect(con.rows[0].convalidated).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────── P2-18
  describe('P2-18 order money fields derive from receivables + payments', () => {
    test('record → Pending Confirmation; reject → Rejected; a later partial confirm → Partially Confirmed', async () => {
      const o = await createOrder();
      expect(o.financial_status).toBe('Advance Not Entered');
      const p1 = await receive(o.id, { amount: 200 });
      expect((await order(o.id)).financial_status).toBe('Pending Confirmation');
      const noReason = await post('owner', `/api/export-orders/receipts/${p1.id}/reject`, {});
      expect(noReason.status).toBe(400);
      const rej = await post('owner', `/api/export-orders/receipts/${p1.id}/reject`, { reason: 'not in bank' });
      expect(rej.status).toBe(200);
      expect((await order(o.id)).financial_status).toBe('Rejected');
      const again = await post('owner', `/api/export-orders/receipts/${p1.id}/reject`, { reason: 'twice' });
      expect(again.status).toBe(409);

      await confirm((await receive(o.id, { amount: 300 })).id);
      expect((await order(o.id)).financial_status).toBe('Partially Confirmed');
      // A rejection after money is in no longer stamps 'Rejected' over it.
      const p3 = await receive(o.id, { amount: 100 });
      expect((await order(o.id)).financial_status).toBe('Pending Confirmation');
      await post('owner', `/api/export-orders/receipts/${p3.id}/reject`, { reason: 'bounced' });
      const oo = await order(o.id);
      expect(oo.financial_status).toBe('Partially Confirmed');
      expect(n(oo.advance_received)).toBe(300);
    });

    test('a receivable settled outside the order (Money-In path) moves the order with it', async () => {
      const o = await createOrder();
      const r = await recv(o.id, 'Advance');
      const { applyReceivableDelta } = require('../modules/finance/paymentSettlement');
      await db.transaction((trx) => applyReceivableDelta(trx, r, 1000));
      const oo = await order(o.id);
      expect(n(oo.advance_received)).toBe(1000);
      expect(oo.financial_status).toBe('Confirmed');
      // Derived = receivables, for every order this suite touched.
      const drift = await db.raw(`
        SELECT count(*)::int AS n FROM export_orders o
         WHERE o.order_no IN (SELECT order_no FROM export_orders WHERE customer_id = ?)
           AND EXISTS (SELECT 1 FROM receivables r WHERE r.order_id = o.id AND r.type = 'Advance')
           AND o.advance_received <> (SELECT COALESCE(sum(received_amount), 0) FROM receivables r WHERE r.order_id = o.id AND r.type = 'Advance')`, [ids.customer]);
      expect(drift.rows[0].n).toBe(0);
    });

    test('parent-link CHECKs and the On Hold history row', async () => {
      await expect(db('receivables').insert({
        recv_no: `RCV-ZZ-${run}`, entity: 'export', customer_id: ids.customer, type: 'Advance',
        expected_amount: 1, received_amount: 0, outstanding: 1, currency: 'USD', status: 'Pending',
      })).rejects.toMatchObject({ constraint: 'chk_receivables_export_parent' });
      const o = await createOrder();
      const r = await recv(o.id, 'Advance');
      await expect(db('payments').insert({
        payment_no: `PAY-ZZ-${run}`, type: 'payment', linked_receivable_id: r.id, amount: 1, currency: 'USD', base_amount_pkr: 1,
      })).rejects.toMatchObject({ constraint: 'chk_payments_receivable_is_receipt' });
      await expect(db('export_order_status_history').insert({
        order_id: o.id, from_status: 'In Milling', to_status: 'On Hold', changed_by: ids.owner, reason: 'ZZ',
      })).resolves.toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────── P2-29
  describe('P2-29 bank charges, short-balance write-off, advance term', () => {
    const glFor = async (orderNo) => (await db('journal_entries as je')
      .join('journal_lines as jl', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as c', 'c.id', 'jl.account_id')
      .where({ 'je.ref_no': orderNo, 'je.status': 'Posted' })
      .select('c.code', 'jl.debit', 'jl.credit'))
      .map((l) => ({ code: l.code, debit: n(l.debit), credit: n(l.credit) }));
    const tbBalanced = async () => {
      const t = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
        .where('je.status', 'Posted').sum({ dr: 'jl.debit', cr: 'jl.credit' }).first();
      return Math.abs(n(t.dr) - n(t.cr)) < 0.005;
    };

    test('a balance receipt with USD 15 bank charges settles in full, posts 6200, and the order can close', async () => {
      const o = await createOrder();
      await confirm((await receive(o.id, { amount: 1000 })).id);
      await ship(o.id);
      const bankBefore = n((await db('bank_accounts').where({ id: ids.usdBank }).first()).current_balance);
      const p = await receive(o.id, { kind: 'balance', amount: 3985, bankCharges: 15 });
      expect(n((await db('payments').where({ id: p.id }).first()).bank_charges)).toBe(15);
      await confirm(p.id);

      const bal = await recv(o.id, 'Balance');
      expect([n(bal.received_amount), n(bal.outstanding), bal.status]).toEqual([4000, 0, 'Paid']);
      expect(n((await order(o.id)).balance_received)).toBe(4000);
      expect(n((await db('bank_accounts').where({ id: ids.usdBank }).first()).current_balance) - bankBefore).toBe(3985);
      const posted = await db('payments').where({ source_table: 'export_orders', source_id: o.id, status: 'Confirmed' }).orderBy('id', 'desc').first();
      expect(n(posted.bank_charges)).toBe(15);
      const gl = await glFor(o.order_no);
      expect(gl).toEqual(expect.arrayContaining([
        { code: '6200', debit: 15 * 280, credit: 0 },
        { code: '1110', debit: 0, credit: 15 * 280 },
      ]));
      expect(await tbBalanced()).toBe(true);

      const wf = require('../modules/exportOrders/exportOrders.workflow');
      const problems = await wf.closeProblems(db, await order(o.id));
      expect(problems.filter((m) => /balance is still outstanding/.test(m))).toEqual([]);
    });

    test('advance bank charges credit 1310 at the receipt rate', async () => {
      const o = await createOrder();
      await confirm((await receive(o.id, { amount: 990, bankCharges: 10 })).id);
      const adv = await recv(o.id, 'Advance');
      expect([n(adv.received_amount), n(adv.outstanding)]).toEqual([1000, 0]);
      const oo = await order(o.id);
      expect(oo.financial_status).toBe('Confirmed');
      expect(n(oo.advance_received_pkr)).toBe(1000 * 285);
      expect(await glFor(o.order_no)).toEqual(expect.arrayContaining([
        { code: '6200', debit: 2850, credit: 0 }, { code: '1310', debit: 0, credit: 2850 },
      ]));
    });

    test('charges above the tolerance are refused; the tolerance is a setting', async () => {
      const o = await createOrder();
      const r = await post('fm', `/api/export-orders/${o.id}/record-receipt`, { kind: 'advance', amount: 900, bank_charges: 60, bank_account_id: ids.usdBank });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/tolerance/);
      await setting('export_short_receipt_tolerance_usd', '75');
      const ok = await post('fm', `/api/export-orders/${o.id}/record-receipt`, { kind: 'advance', amount: 900, bank_charges: 60, bank_account_id: ids.usdBank });
      expect(ok.status).toBe(201);
      await setting('export_short_receipt_tolerance_usd', '50');
    });

    test('short-balance write-off: Owner-approved, ≤ tolerance → 6200, above → needs the configured account', async () => {
      const o = await createOrder();
      await confirm((await receive(o.id, { amount: 1000 })).id);
      await ship(o.id);
      await confirm((await receive(o.id, { kind: 'balance', amount: 3900 })).id);

      // Not an Owner and no Owner authorisation → refused.
      const fm = await post('fm', `/api/export-orders/${o.id}/write-off-balance`, { amount: 30, reason: 'bank deduction' });
      expect(fm.status).toBe(403);
      // Above the tolerance with no write-off account named → refused.
      const big = await post('owner', `/api/export-orders/${o.id}/write-off-balance`, { reason: 'buyer short-paid' });
      expect(big.status).toBe(400);
      expect(big.body.message).toMatch(/no write-off account/);
      // Within the tolerance → 6200.
      const small = await post('owner', `/api/export-orders/${o.id}/write-off-balance`, { amount: 40, reason: 'bank deduction' });
      expect(small.status).toBe(200);
      expect(small.body.data.writeOff).toMatchObject({ account_code: '6200', approved_by_owner_id: ids.owner });
      let bal = await recv(o.id, 'Balance');
      expect([n(bal.received_amount), n(bal.outstanding)]).toEqual([3940, 60]);
      // The accountant names an account → the rest can go.
      await setting('export_short_write_off_account', '6200');
      const rest = await post('owner', `/api/export-orders/${o.id}/write-off-balance`, { reason: 'buyer short-paid, agreed' });
      expect(rest.status).toBe(200);
      await setting('export_short_write_off_account', '');
      bal = await recv(o.id, 'Balance');
      expect([n(bal.outstanding), bal.status]).toEqual([0, 'Paid']);
      expect(n((await order(o.id)).balance_received)).toBe(4000);
      await new Promise((r) => setTimeout(r, 200)); // approval logged on response finish
      const audits = await db('approval_authorizations').where({ kind: 'export_short_write_off', ref: String(o.id) });
      expect(audits.length).toBe(2);
      expect(await tbBalanced()).toBe(true);
    });

    test('the advance receivable falls due after the configured term', async () => {
      await setting('export_advance_term_days', '7');
      const o = await createOrder();
      await setting('export_advance_term_days', '14');
      const want = new Date(); want.setDate(want.getDate() + 7);
      const due = (await recv(o.id, 'Advance')).due_date;
      const dueDay = due instanceof Date
        ? `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`
        : String(due).slice(0, 10);
      expect(dueDay).toBe(want.toISOString().slice(0, 10));
    });
  });
});
