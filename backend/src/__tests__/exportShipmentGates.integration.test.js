/**
 * P3-13 / P3-17 — the export shipment gates, end to end on a real, fully
 * migrated Postgres (owner decisions D-18 (a) and D-17 (a), 2026-10-15).
 *
 * Stock (P3-13):
 *   ship with nothing reserved → refused; nothing moves
 *   confirming the advance reserves nothing (the old auto-reserve is gone)
 *   the suggested lot is the order's product; confirming it reserves it as
 *   'suggested', recording who confirmed it
 *   a shipment of finished rice + by-products relieves 1230 and 1240 by the
 *   value of what left each lot, at the one cost basis the lot ledger uses
 *   the status API cannot ship without a gate pass
 *
 * Documents (P3-17):
 *   the old 'Confirm Ready' tick is refused
 *   an uploaded file does not count until a second person approves it; the
 *   uploader may not; the approval moves the order on to Ready to Ship
 *   the Certificate of Origin cannot be generated or drafted before shipment
 *   an open draft is re-assembled from the order as it is now, keeping its
 *   overrides; a Cancelled draft is followed by a fresh version
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const path = require('path');
const os = require('os');
const fs = require('fs');

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(90000);

const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-gates-'));
process.env.UPLOADS_DIR = UPLOADS;

d('export shipment gates (DB-gated)', () => {
  let db; let app; let request; let receipts; let inventory;
  let adminTok; let ownerTok; let adminId;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  const PRE = ['phyto', 'bl_draft', 'commercial_invoice', 'packing_list', 'fumigation'];

  beforeAll(async () => {
    db = require('../config/database');
    receipts = require('../modules/exportOrders/exportReceipts');
    inventory = require('../modules/inventory/inventory.service');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const { ensureAccountGl } = require('../shared/accountGl');
    const user = async (roleName, tag) => {
      const role = await db('roles').where({ name: roleName }).first();
      const [u] = await db('users').insert({
        email: `zz-gate-${tag}-${run}@test.local`, full_name: `ZZ GATE ${tag} ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
      }).returning('*');
      return { u, tok: jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret) };
    };
    const admin = await user('Super Admin', 'adm');
    const owner = await user('Owner', 'own');
    adminTok = admin.tok; adminId = admin.u.id; ownerTok = owner.tok;

    const [bank] = await db('bank_accounts').insert({
      name: `ZZ GATE USD ${run}`, type: 'bank', is_active: true, currency: 'USD', entity: 'export', current_balance: 0,
    }).returning('*');
    await ensureAccountGl(db, bank);
    const [w] = await db('warehouses').insert({ name: `ZZ GATE WH ${run}`, type: 'finished' }).returning('*');
    const [c] = await db('customers').insert({ name: `ZZ GATE Buyer ${run}`, customer_type: 'export', currency: 'USD' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ GATE Kernel ${run}` }).returning('*');
    const [p2] = await db('products').insert({ name: `ZZ GATE Other ${run}` }).returning('*');
    Object.assign(ids, { bank: bank.id, wh: w.id, cust: c.id, product: p.id, other: p2.id });
  });
  afterAll(async () => {
    if (db) await db.destroy();
    fs.rmSync(UPLOADS, { recursive: true, force: true });
  });

  const auth = (tok = adminTok) => ({ Authorization: `Bearer ${tok}` });

  async function makeLot(tag, { type = 'finished', product = ids.product, qty = 20000, landed = 100, cpu = 90, entity = 'export', ready = true } = {}) {
    const [lot] = await db('inventory_lots').insert({
      lot_no: `ZZ-GATE-${tag}-${run}`, item_name: `ZZ ${tag}`, type, entity, warehouse_id: ids.wh, product_id: product,
      qty, available_qty: qty, unit: 'kg', export_ready: ready, landed_cost_per_kg: landed, cost_per_unit: cpu,
    }).returning('*');
    return lot;
  }

  // An order with no advance due (so the advance gate is out of the way), its
  // shipment facts recorded and, unless told otherwise, its five pre-shipment
  // documents on file and checked by a second person.
  async function makeOrder(tag, { status = 'Ready to Ship', qtyMt = 10, docs = true, advance = 0, atd = '2026-10-15', gatePass = 'GP-1', product = ids.product } = {}) {
    const [o] = await db('export_orders').insert({
      order_no: `ZG-${tag}-${run}`, customer_id: ids.cust, product_id: product, created_by: adminId,
      status, qty_mt: qtyMt, price_per_mt: 500, contract_value: qtyMt * 500, currency: 'USD', booked_fx_rate: 280,
      contract_value_pkr_locked: qtyMt * 500 * 280, advance_expected: advance, balance_expected: qtyMt * 500 - advance,
      financial_status: advance > 0 ? 'Advance Not Entered' : 'Not Required', bank_account_id: ids.bank,
      incoterm: 'FOB', atd, gate_pass_no: gatePass,
    }).returning('*');
    await db('export_order_items').insert({
      order_id: o.id, line_no: 1, product_id: product, product_name: 'ZZ Kernel', qty_mt: qtyMt, price_per_mt: 500,
      line_total: qtyMt * 500, hs_code: '1006.30',
    });
    if (docs) {
      for (const t of PRE) {
        await db('document_store').insert({
          doc_uid: `ZZ-${tag}-${t}-${run}`, linked_type: 'export_order', linked_id: o.id, doc_type: t, title: t,
          file_name: `${t}.pdf`, file_path: path.join(UPLOADS, `${t}.pdf`), version: 1, is_latest: true, status: 'Approved',
          uploaded_by: adminId, checked_by: (await db('users').where({ email: `zz-gate-own-${run}@test.local` }).first()).id,
          checked_at: db.fn.now(),
        });
      }
    }
    return o;
  }

  const setStatus = (o, status, tok = adminTok) => request(app).put(`/api/export-orders/${o.id}/status`).set(auth(tok)).send({ status });
  const glNet = async (refNo, code) => {
    const r = await db('journal_entries as je').join('journal_lines as jl', 'jl.journal_id', 'je.id')
      .join('chart_of_accounts as a', 'a.id', 'jl.account_id')
      .where({ 'je.ref_no': refNo, 'je.status': 'Posted', 'a.code': code })
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0) AS n')).first();
    return Math.round(Number(r.n) * 100) / 100;
  };

  // ── P3-13 ────────────────────────────────────────────────────────────────
  test('shipping with nothing reserved is refused and nothing moves', async () => {
    const lot = await makeLot('NORES');
    const o = await makeOrder('NORES');
    const r = await setStatus(o, 'Shipped');
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/no stock is reserved for this order/);
    expect((await db('export_orders').where({ id: o.id }).first()).status).toBe('Ready to Ship');
    expect(Number((await db('inventory_lots').where({ id: lot.id }).first()).qty)).toBe(20000);
    expect(await db('journal_entries').where({ ref_no: o.order_no })).toHaveLength(0);
  });

  test('a reservation short of the order by more than the tolerance is refused; within it ships', async () => {
    const lot = await makeLot('TOL');
    const o = await makeOrder('TOL');
    await db.transaction((trx) => inventory.reserveStock(trx, { lotId: lot.id, orderId: o.id, qtyKg: 9700, userId: adminId }));
    let r = await setStatus(o, 'Shipped');
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/9,700 kg is reserved, short of the order's 10,000 kg by more than the ±2%/);
    await db.transaction((trx) => inventory.reserveStock(trx, { lotId: lot.id, orderId: o.id, qtyKg: 150, userId: adminId }));
    r = await setStatus(o, 'Shipped');
    expect(r.status).toBe(200);
    expect(Number((await db('inventory_lots').where({ id: lot.id }).first()).qty)).toBe(20000 - 9850);
  });

  test('the status API cannot ship without a gate pass', async () => {
    const lot = await makeLot('GP');
    const o = await makeOrder('GP', { gatePass: null });
    await db.transaction((trx) => inventory.reserveStock(trx, { lotId: lot.id, orderId: o.id, qtyKg: 10000, userId: adminId }));
    const r = await setStatus(o, 'Shipped');
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/gate pass number is required/);
  });

  test('confirming the advance reserves nothing', async () => {
    await makeLot('ADV', { qty: 50000 });
    const o = await makeOrder('ADV', { status: 'In Milling', advance: 1000, docs: false });
    await db('receivables').insert({
      recv_no: `ZGA${run}`, type: 'Advance', entity: 'export', order_id: o.id, customer_id: ids.cust, currency: 'USD',
      expected_amount: 1000, received_amount: 0, outstanding: 1000, base_amount_pkr: 280000, fx_rate: 280, status: 'Pending',
    });
    await db.transaction((trx) => receipts.postExportReceipt(trx, {
      orderWhere: { id: o.id }, kind: 'advance', amount: 1000, fxRate: 280, bankAccountId: ids.bank,
      paymentMethod: 'bank_transfer', userId: adminId,
    }));
    expect((await db('export_orders').where({ id: o.id }).first()).financial_status).toBe('Confirmed');
    expect(await db('inventory_reservations').where({ order_id: o.id })).toHaveLength(0);
  });

  test('the suggested lot is the order\'s product, and confirming it records who confirmed it', async () => {
    // Its own product, so lots from the other tests don't compete. The lot of
    // another product is older (first by id) — the auto-reserve took that one.
    const [mine] = await db('products').insert({ name: `ZZ GATE Sug ${run}` }).returning('*');
    const wrong = await makeLot('SUG-OTHER', { product: ids.other, qty: 50000 });
    const right = await makeLot('SUG-MATCH', { product: mine.id, qty: 50000 });
    const o = await makeOrder('SUG', { status: 'In Milling', docs: false, product: mine.id });
    const s = await request(app).get(`/api/export-orders/${o.id}/suggested-lots`).set(auth());
    expect(s.status).toBe(200);
    const sg = s.body.data.suggestions[0];
    expect(sg.lot.id).toBe(right.id);
    expect(sg.lot.id).not.toBe(wrong.id);
    expect(sg.qty_kg).toBe(10000);
    expect(await db('inventory_reservations').where({ order_id: o.id })).toHaveLength(0); // a suggestion reserves nothing

    const a = await request(app).post(`/api/export-orders/${o.id}/allocate-stock`).set(auth())
      .send({ lot_id: sg.lot.id, qty_mt: sg.qty_kg / 1000, item_id: sg.item_id, suggested: true });
    expect(a.status).toBe(200);
    const [res] = await db('inventory_reservations').where({ order_id: o.id });
    expect(res).toMatchObject({ lot_id: right.id, source: 'suggested', created_by: adminId, status: 'Active' });
    expect(res.created_at).toBeTruthy();
    expect(Number(res.reserved_qty)).toBe(10000);
  });

  test('finished rice and by-products leave 1230 and 1240 at the value the lot ledger records', async () => {
    const fin = await makeLot('FIN', { landed: 100, cpu: 90 });
    const byp = await makeLot('BYP', { type: 'byproduct', landed: 50, cpu: 40 });
    const o = await makeOrder('MIX');
    await db.transaction(async (trx) => {
      await inventory.reserveStock(trx, { lotId: fin.id, orderId: o.id, qtyKg: 8000, userId: adminId });
      await inventory.reserveStock(trx, { lotId: byp.id, orderId: o.id, qtyKg: 2000, userId: adminId });
    });
    const r = await setStatus(o, 'Shipped');
    expect(r.status).toBe(200);

    expect(await glNet(o.order_no, '1230')).toBe(-800000);   // 8,000 kg × Rs 100 landed
    expect(await glNet(o.order_no, '1240')).toBe(-100000);   // 2,000 kg × Rs 50 landed
    expect(await glNet(o.order_no, '5020')).toBe(900000);
    const shipped = await db('export_orders').where({ id: o.id }).first();
    expect(Number(shipped.inventory_cogs_total_pkr)).toBe(900000);

    // The lot ledger values the same kilos at the same cost/kg (EXP-42).
    const out = await db('lot_transactions').whereIn('lot_id', [fin.id, byp.id])
      .where({ reference_module: 'export_order', reference_id: o.id }).whereNotNull('total_cost');
    const value = out.reduce((a, t) => a + Math.abs(Number(t.total_cost)), 0);
    expect(Math.round(value)).toBe(900000);
    expect(Number((await db('inventory_lots').where({ id: fin.id }).first()).qty)).toBe(12000);
    expect(Number((await db('inventory_lots').where({ id: byp.id }).first()).qty)).toBe(18000);
    expect((await db('inventory_reservations').where({ order_id: o.id })).map((x) => x.status)).toEqual(['Consumed', 'Consumed']);
  });

  test('inventory_lots no longer carries reserved_against; the lot list derives it from reservations', async () => {
    expect(await db.schema.hasColumn('inventory_lots', 'reserved_against')).toBe(false);
    const lot = await makeLot('RA');
    const o = await makeOrder('RA', { status: 'In Milling', docs: false });
    await db.transaction((trx) => inventory.reserveStock(trx, { lotId: lot.id, orderId: o.id, qtyKg: 1000, userId: adminId }));
    const r = await request(app).get('/api/inventory').query({ search: lot.lot_no }).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.data.lots[0].reserved_against).toBe(o.order_no);
  });

  // ── P3-17 ────────────────────────────────────────────────────────────────
  test('the old Confirm Ready tick is refused', async () => {
    const o = await makeOrder('TICK', { status: 'Docs In Preparation', docs: false });
    const r = await request(app).post(`/api/export-orders/${o.id}/documents/approve`).set(auth()).send({ doc_type: 'phyto' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/D-17/);
  });

  test('an upload counts only once a second person approves it, and that approval moves the order on', async () => {
    const lot = await makeLot('UPL');
    const o = await makeOrder('UPL', { status: 'Docs In Preparation' });
    await db.transaction((trx) => inventory.reserveStock(trx, { lotId: lot.id, orderId: o.id, qtyKg: 10000, userId: adminId }));
    // The fumigation certificate is replaced by a new upload: the checked copy
    // is superseded and the new file waits for its own check.
    const up = await request(app).post('/api/documents/upload').set(auth())
      .field('linked_type', 'export_order').field('linked_id', String(o.id))
      .field('doc_type', 'fumigation').field('title', 'Fumigation')
      .attach('files', Buffer.from('%PDF-1.4 zz'), 'fumigation.pdf');
    expect(up.status).toBe(201);
    const docId = up.body.data.document.id;
    const gateOf = async () => (await request(app).get(`/api/export-orders/${o.id}`).set(auth())).body.data.order.document_gate;
    expect((await gateOf()).fumigation).toMatchObject({ fulfilled: false, state: 'awaiting_check' });
    expect((await db('export_orders').where({ id: o.id }).first()).status).toBe('Docs In Preparation');

    // Maker/checker: the uploader may not approve their own file.
    const self = await request(app).put(`/api/documents/${docId}/approve`).set(auth()).send({});
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('MAKER_CHECKER');

    const ok = await request(app).put(`/api/documents/${docId}/approve`).set(auth(ownerTok)).send({});
    expect(ok.status).toBe(200);
    expect((await gateOf()).fumigation).toMatchObject({ fulfilled: true, source: 'file', documentId: docId });
    expect((await db('export_orders').where({ id: o.id }).first()).status).toBe('Ready to Ship');
    const cl = await db('document_checklists').where({ linked_type: 'export_order', linked_id: o.id });
    expect(cl).toHaveLength(0); // inserted orders here carry no checklist rows; the gate defaults to the seven
  });

  test('the Certificate of Origin cannot be generated or drafted before shipment', async () => {
    const o = await makeOrder('COO', { status: 'Ready to Ship' });
    const g = await request(app).get(`/api/export-orders/${o.id}/documents/generate/certificate-of-origin`).set(auth());
    expect(g.status).toBe(409);
    expect(g.body.code).toBe('POST_SHIPMENT_DOCUMENT');
    const dr = await request(app).post(`/api/export-orders/${o.id}/documents/certificate-of-origin/draft`).set(auth()).send({});
    expect(dr.status).toBe(409);
    const av = await request(app).get(`/api/export-orders/${o.id}/documents/available`).set(auth());
    expect(av.body.data.documents.find((x) => x.key === 'certificate-of-origin')).toMatchObject({ ready: false });

    await db('export_orders').where({ id: o.id }).update({ status: 'Shipped' });
    const g2 = await request(app).get(`/api/export-orders/${o.id}/documents/generate/certificate-of-origin`).set(auth());
    expect(g2.status).toBe(200);
  });

  test('an open draft is re-assembled from the order as it is now, keeping its overrides', async () => {
    const o = await makeOrder('DRAFT', { status: 'Docs In Preparation', docs: false });
    const dr = await request(app).post(`/api/export-orders/${o.id}/documents/commercial-invoice/draft`).set(auth()).send({});
    expect(dr.status).toBe(201);
    const genId = dr.body.data.version.id;
    const ov = await request(app).put(`/api/export-orders/documents/${genId}/overrides`).set(auth())
      .send({ overrides: { notes: 'ZZ keep me' }, editedHtml: '<p>old price 500</p>' });
    expect(ov.status).toBe(200);

    // The price changes after the draft was first generated.
    await db('export_order_items').where({ order_id: o.id }).update({ price_per_mt: 550, line_total: 5500 });
    await db('export_orders').where({ id: o.id }).update({ price_per_mt: 550, contract_value: 5500 });

    const cur = await request(app).get(`/api/export-orders/${o.id}/documents/commercial-invoice/current`).set(auth());
    expect(cur.status).toBe(200);
    expect(cur.body.data.sourceChanged).toBe(true);
    expect(cur.body.data.editsDiscarded).toBe(true);
    expect(cur.body.data.editedHtml).toBeNull();
    expect(JSON.stringify(cur.body.data.document.items)).toContain('550');
    const row = await db('generated_documents').where({ id: genId }).first();
    expect(row.overrides_json).toMatchObject({ notes: 'ZZ keep me' });
    expect(JSON.stringify(row.snapshot_json.items)).toContain('550');
    expect(row.rendered_html).toBeNull();

    // Unchanged order → nothing re-written.
    const again = await request(app).get(`/api/export-orders/${o.id}/documents/commercial-invoice/current`).set(auth());
    expect(again.body.data.sourceChanged).toBe(false);

    // A Cancelled draft is not reopened: a fresh version follows it.
    await db('generated_documents').where({ id: genId }).update({ status: 'Cancelled' });
    const next = await request(app).post(`/api/export-orders/${o.id}/documents/commercial-invoice/draft`).set(auth()).send({});
    expect(next.status).toBe(201);
    expect(next.body.data.version.id).not.toBe(genId);
    expect(next.body.data.version).toMatchObject({ version: 2, status: 'Draft', previous_version_id: genId });
  });

  // ── The pre-deploy detection script (read-only) ─────────────────────────
  test('the detection script lists what each gate would refuse, ids only', async () => {
    const { detect, report } = require('../../scripts/detectExportGateFailures');
    const before = await db('inventory_reservations').count('id as n').first();
    const res = await detect(db);
    const o = await db('export_orders').where({ order_no: `ZG-NORES-${run}` }).first();
    expect(res.A.none).toEqual(expect.arrayContaining([expect.objectContaining({ id: o.id, rts: true })]));
    const tick = await db('export_orders').where({ order_no: `ZG-TICK-${run}` }).first();
    expect(res.B.find((r) => r.id === tick.id).docs).toEqual(expect.arrayContaining(['phyto:missing']));
    const lines = [];
    report(res, (l) => lines.push(l));
    expect(lines.join('\n')).toContain(`${o.id} ZG-NORES-${run}*`);
    expect(lines.join('\n')).not.toMatch(/ZZ GATE Buyer/); // no customer names
    expect((await db('inventory_reservations').count('id as n').first()).n).toBe(before.n); // wrote nothing
  });
});
