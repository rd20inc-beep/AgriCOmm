/**
 * P3-10 — a purchase lot's payment status and its Purchase Invoice.
 *
 * INV-11: the lot's total was its LANDED cost (rice + extras + bags + broker
 * commission + company freight) while only the supplier's payables mirrored
 * payments onto it — a lot whose supplier was paid in full stayed 'Partial'
 * for ever, and due_amount meant three different things.
 * INV-10: the Purchase Invoice showed the rice payable as "Landed total",
 * dropped bags / commission, read ONE unordered payable by lot number (no
 * supplier filter) and so missed the extras and any added purchase.
 *
 * Now: status and due_amount are measured against the supplier's bills; the
 * invoice lists every supplier bill (rice first), its cost lines foot to the
 * landed total, and its paid / outstanding foot to the bill.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('lot payment status + purchase invoice (DB-gated)', () => {
  let db; let lots; let finance;
  const run = `${Date.now()}`.slice(-6);
  const ids = {};
  const n = (v) => parseFloat(v) || 0;

  const call = async (fn, req) => {
    const out = {};
    const res = {
      status(c) { out.status = c; return this; },
      json(b) { out.status = out.status || 200; out.body = b; return this; },
    };
    await fn({ query: {}, body: {}, params: {}, ...req, user: { id: ids.user, role_id: ids.role } }, res);
    return out;
  };

  // 10,000 kg @ Rs 100 = 1,000,000 rice + labour 5,000 + 200 bags × 10 = 2,000
  //   → owed to the supplier 1,007,000
  // + commission 200 × 25 = 5,000 (broker) + freight 40,000 (company → hauler)
  //   → landed 1,052,000
  const BASE = () => ({
    item_name: 'ZZ P Rice', type: 'raw', entity: 'mill', product_id: ids.product,
    supplier_id: ids.sup, broker_id: ids.broker, hauler_id: ids.hauler,
    quantity_input: 10000, quantity_unit: 'kg', bag_weight_kg: 50, total_bags: 200,
    rate_input: 100, rate_unit: 'kg', labor_cost: 5000, bag_cost_per_bag: 10, bag_cost_included: false,
    transport_cost: 40000, transport_paid_by: 'company', commission_per_bag: 25,
    purchase_date: '2026-10-01',
  });
  const createLot = async () => {
    const r = await call(lots.createPurchaseLot, { body: BASE() });
    expect(r.body && r.body.message).toBeUndefined();
    return db('inventory_lots').where({ id: r.body.data.lot.id }).first();
  };
  const pay = (lotId, amount) => call(finance.payPurchase, {
    body: { source: 'lot', source_id: lotId, payment_method: 'cash', bank_account_id: ids.bank, ...(amount ? { amount } : {}) },
  });
  const invoice = async (lotId) => (await call(lots.getPurchaseInvoice, { params: { id: String(lotId) } })).body.data;

  beforeAll(async () => {
    db = require('../config/database');
    lots = require('../modules/inventory/lotInventory.controller');
    finance = require('../modules/finance/finance.controller');
    const { ensureAccountGl } = require('../shared/accountGl');
    const owner = await db('roles').where({ name: 'Owner' }).first();
    const [u] = await db('users').insert({
      email: `zz-p-${run}@test.local`, full_name: `ZZ P ${run}`, password_hash: 'x', role_id: owner.id, is_active: true, status: 'active',
    }).returning('*');
    const [sup] = await db('suppliers').insert({ name: `ZZ P Supplier ${run}`, type: 'local' }).returning('*');
    const [broker] = await db('suppliers').insert({ name: `ZZ P Broker ${run}`, type: 'local' }).returning('*');
    const [hauler] = await db('haulers').insert({ name: `ZZ P Hauler ${run}` }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ P Rice ${run}` }).returning('*');
    const [bank] = await db('bank_accounts').insert({
      name: `ZZ P cash ${run}`, type: 'cash', currency: 'PKR', entity: 'mill', current_balance: 5000000,
    }).returning('*');
    await ensureAccountGl(db, bank);
    Object.assign(ids, { user: u.id, role: owner.id, sup: sup.id, broker: broker.id, hauler: hauler.id, product: p.id, bank: bank.id });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('a new lot owes its supplier gross, not its landed cost', async () => {
    const lot = await createLot();
    expect(n(lot.landed_cost_total)).toBe(1052000);
    expect([lot.payment_status, n(lot.paid_amount), n(lot.due_amount)]).toEqual(['Pending', 0, 1007000]);
  });

  test('paying the supplier in full → Paid, although freight and commission are still owed to others', async () => {
    const lot = await createLot();
    const part = await pay(lot.id, 400000);
    expect(part.body && part.body.message).toBeUndefined();
    let l = await db('inventory_lots').where({ id: lot.id }).first();
    expect([l.payment_status, n(l.paid_amount), n(l.due_amount)]).toEqual(['Partial', 400000, 607000]);
    const rest = await pay(lot.id);
    expect(rest.body && rest.body.message).toBeUndefined();
    l = await db('inventory_lots').where({ id: lot.id }).first();
    expect([l.payment_status, n(l.paid_amount), n(l.due_amount)]).toEqual(['Paid', 1007000, 0]);
    // The hauler's and broker's bills are untouched and still open.
    const others = await db('payables').where({ linked_ref: lot.lot_no }).whereIn('source_table', ['lot_transport', 'lot_commission']);
    expect(others.map((p) => n(p.outstanding)).sort((a, b) => a - b)).toEqual([5000, 40000]);
    // Purchases-tab trail shows the supplier figures.
    const trail = await call(finance.getPurchasePayments, { params: { source: 'lot', sourceId: String(lot.id) } });
    expect([trail.body.data.total, trail.body.data.outstanding]).toEqual([1007000, 0]);
  });

  test('the Purchase Invoice foots: costs → landed, bill lines → supplier total, paid + outstanding → bill', async () => {
    const lot = await createLot();
    await pay(lot.id, 300000);
    const inv = await invoice(lot.id);
    const c = inv.costs;
    const footed = c.riceCost + c.labor + c.unloading + c.packing + c.other + c.bags + c.commission
      + (c.transportCapitalised ? c.transport : 0) + c.adjustment;
    expect(Math.round(footed * 100) / 100).toBe(1052000);
    expect([c.bags, c.commission, c.transport, c.transportCapitalised, c.adjustment]).toEqual([2000, 5000, 40000, true, 0]);
    expect(inv.purchase.landedTotal).toBe(1052000);
    expect(inv.purchase.supplierTotal).toBe(1007000);
    // Every supplier bill, rice first; no hauler / broker bill.
    expect(inv.supplierBill.lines.map((b) => b.category)).toEqual(['Raw Material', 'Labor', 'Bags']);
    expect(inv.supplierBill.lines.reduce((s, b) => s + b.amount, 0)).toBe(1007000);
    expect(inv.purchase.paid + inv.purchase.outstanding).toBe(1007000);
    expect([inv.purchase.paid, inv.purchase.paymentStatus]).toEqual([300000, 'Partial']);
    // The timeline ends at the outstanding balance.
    expect(inv.payments[inv.payments.length - 1].balance).toBe(707000);
    expect(inv.payments[0].amount).toBe(1007000);
  });

  test('an added purchase joins the bill, the status and the invoice', async () => {
    const lot = await createLot();
    await pay(lot.id); // supplier fully paid → Paid
    const r = await call(lots.addPurchaseToLot, {
      params: { id: String(lot.id) },
      body: { quantity_input: 1000, quantity_unit: 'kg', rate_input: 110, rate_unit: 'kg', purchase_date: '2026-10-02' },
    });
    expect(r.body && r.body.message).toBeUndefined();
    const l = await db('inventory_lots').where({ id: lot.id }).first();
    expect([l.payment_status, n(l.due_amount)]).toEqual(['Partial', 110000]);
    expect([n(l.qty), n(l.available_qty), n(l.received_net_weight_kg)]).toEqual([11000, 11000, 11000]);
    const inv = await invoice(lot.id);
    expect(inv.purchase.supplierTotal).toBe(1007000 + 110000);
    expect(inv.purchase.outstanding).toBe(110000);
    expect(inv.supplierBill.lines.filter((b) => b.category === 'Raw Material')).toHaveLength(2);
    // The ledger reconciles to the lot: receipt + added purchase.
    const sum = await db('lot_transactions').where({ lot_id: lot.id }).sum('quantity_kg as s').first();
    expect(n(sum.s)).toBe(11000);
  });

  test('restateLotPaymentStatus fixes a lot left Partial by the old landed-cost rule', async () => {
    const script = require('../../scripts/restateLotPaymentStatus');
    const lot = await createLot();
    await pay(lot.id);
    // What the old mirror wrote: measured against landed 1,052,000.
    await db('inventory_lots').where({ id: lot.id }).update({ payment_status: 'Partial', due_amount: 45000 });
    const found = await script.detect(db);
    expect(found.changes.map((c) => c.id)).toContain(lot.id);
    await script.restate(db, { write: false, log: () => {} });
    expect((await db('inventory_lots').where({ id: lot.id }).first()).payment_status).toBe('Partial');
    await script.restate(db, { write: true, log: () => {} });
    const l = await db('inventory_lots').where({ id: lot.id }).first();
    expect([l.payment_status, n(l.due_amount), n(l.paid_amount)]).toEqual(['Paid', 0, 1007000]);
    expect((await script.detect(db)).changes.map((c) => c.id)).not.toContain(lot.id);
  });

  test('another supplier\'s payable on the same lot number is not on this invoice', async () => {
    const lot = await createLot();
    const [stranger] = await db('suppliers').insert({ name: `ZZ P Other ${run}`, type: 'local' }).returning('*');
    await db('payables').insert({
      pay_no: `ZZP-X-${run}`, entity: 'mill', category: 'Raw Material', supplier_id: stranger.id,
      linked_ref: lot.lot_no, original_amount: 999, paid_amount: 0, outstanding: 999, status: 'Pending', currency: 'PKR',
    });
    const inv = await invoice(lot.id);
    expect(inv.purchase.supplierTotal).toBe(1007000);
    expect(inv.supplierBill.lines.every((b) => b.payNo !== `ZZP-X-${run}`)).toBe(true);
  });
});
