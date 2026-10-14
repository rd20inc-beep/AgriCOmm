/**
 * P2-32 — master-data review is a real gate (DB-gated, real Postgres):
 *  - a customer edit by a non-approver is a PROPOSAL: the live record is
 *    unchanged; it shows in the pending queue; Approve applies it; Reject
 *    discards it and leaves the customer active (it used to deactivate it)
 *  - a rejected supplier: purchase lot refused (409), quick-add dedupe refuses
 *    to hand it back, mill-store purchase refused
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('master-data review gates (DB-gated)', () => {
  let db; let approvals; let lotCtrl; let millStore;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  const mockRes = () => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  const call = async (fn, { user, params = {}, body = {}, query = {} }) => {
    const res = mockRes();
    await fn({ user, params, body, query, ip: '127.0.0.1', headers: {} }, res);
    return res;
  };

  beforeAll(async () => {
    db = require('../config/database');
    approvals = require('../modules/admin/approvals.controller');
    lotCtrl = require('../modules/inventory/lotInventory.controller');
    millStore = require('../modules/millStore/millStore.service');
    const mkUser = async (roleName) => {
      const role = await db('roles').where({ name: roleName }).first();
      const [u] = await db('users').insert({
        email: `zz-mdr-${roleName.replace(/\s/g, '')}-${run}@test.local`, full_name: `ZZ ${roleName}`, password_hash: 'x',
        role_id: role.id, is_active: true, status: 'active',
      }).returning('*');
      return { id: u.id, role_id: role.id };
    };
    ids.clerk = await mkUser('Export Manager');
    ids.owner = await mkUser('Owner');
  });
  afterAll(async () => { await db.destroy(); });

  const newCustomer = async (sfx) => (await db('customers').insert({
    name: `ZZ MDR Buyer ${sfx} ${run}`, phone: `p-${sfx}-${run}`, country: 'UAE', approval_status: 'approved', is_active: true,
  }).returning('*'))[0];

  test('a non-approver edit is held as a proposal; the live record is unchanged', async () => {
    const c = await newCustomer('A');
    const r = await call(approvals.submitCustomerEdit, { user: ids.clerk, params: { id: c.id }, body: { phone: `e-A-${run}`, country: 'Oman' } });
    expect(r.statusCode).toBe(200);
    expect(r.body.data.pending).toBe(true);
    const row = await db('customers').where({ id: c.id }).first();
    expect(row.phone).toBe(c.phone);
    expect(row.country).toBe('UAE');
    expect(row.pending_edit).toEqual({ phone: `e-A-${run}`, country: 'Oman' });
    expect(row.approval_status).toBe('approved');

    const list = await call(approvals.listApprovals, { user: ids.owner, query: { status: 'pending' } });
    expect(list.body.data.customers.map((x) => x.id)).toContain(c.id);
  });

  test('Approve applies the proposal', async () => {
    const c = await newCustomer('B');
    await call(approvals.submitCustomerEdit, { user: ids.clerk, params: { id: c.id }, body: { phone: `e-B-${run}` } });
    const r = await call(approvals.approve, { user: ids.owner, params: { type: 'customers', id: c.id } });
    expect(r.body.data.edit).toBe('applied');
    const row = await db('customers').where({ id: c.id }).first();
    expect(row.phone).toBe(`e-B-${run}`);
    expect(row.pending_edit).toBeNull();
    expect(row.is_active).toBe(true);
  });

  test('Reject discards the proposal and keeps the customer active', async () => {
    const c = await newCustomer('C');
    await call(approvals.submitCustomerEdit, { user: ids.clerk, params: { id: c.id }, body: { name: `ZZ Renamed ${run}` } });
    const r = await call(approvals.reject, { user: ids.owner, params: { type: 'customers', id: c.id }, body: { notes: 'no' } });
    expect(r.body.data.edit).toBe('discarded');
    const row = await db('customers').where({ id: c.id }).first();
    expect(row.name).toBe(c.name);
    expect(row.pending_edit).toBeNull();
    expect(row.is_active).toBe(true);
    expect(row.approval_status).toBe('approved');
  });

  test('an approver edits live', async () => {
    const c = await newCustomer('D');
    const r = await call(approvals.submitCustomerEdit, { user: ids.owner, params: { id: c.id }, body: { phone: `e-D-${run}` } });
    expect(r.body.data.pending).toBe(false);
    expect((await db('customers').where({ id: c.id }).first()).phone).toBe(`e-D-${run}`);
  });

  describe('a rejected supplier', () => {
    let sup;
    beforeAll(async () => {
      [sup] = await db('suppliers').insert({ name: `ZZ MDR Rejected ${run}`, approval_status: 'rejected', is_active: false }).returning('*');
    });

    test('quick-add does not hand it back', async () => {
      const r = await call(approvals.quickAddSupplier, { user: ids.clerk, body: { name: sup.name } });
      expect(r.statusCode).toBe(409);
      expect(r.body.code).toBe('SUPPLIER_REJECTED');
    });

    test('a purchase lot from it is refused', async () => {
      const [p] = await db('products').insert({ name: `ZZ MDR Rice ${run}` }).returning('*');
      const before = await db('inventory_lots').count('id as c').first();
      const r = await call(lotCtrl.createPurchaseLot, { user: ids.owner, body: {
        item_name: 'ZZ rice', type: 'raw', entity: 'mill', supplier_id: sup.id, product_id: p.id,
        quantity_input: 10, quantity_unit: 'katta', rate_input: 100, rate_unit: 'katta',
      } });
      expect(r.statusCode).toBe(409);
      expect(r.body.code).toBe('SUPPLIER_REJECTED');
      const after = await db('inventory_lots').count('id as c').first();
      expect(after.c).toBe(before.c);
    });

    test('a mill-store purchase typed under its name is refused', async () => {
      const [item] = await db('mill_items').insert({ name: `ZZ MDR Bag ${run}`, code: `ZZMDR${run}`, category: 'packaging', unit: 'pcs' }).returning('*');
      await expect(millStore.createPurchase({
        vendor_name: sup.name, purchase_date: new Date().toISOString().slice(0, 10),
        lines: [{ item_id: item.id, quantity: 1, unit_price: 10 }],
      }, ids.owner.id)).rejects.toThrow(/rejected/);
    });
  });
});
