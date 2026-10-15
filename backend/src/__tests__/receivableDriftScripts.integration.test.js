/**
 * The P2-01 / P2-18 data-correction scripts against a real Postgres: the
 * production situation is rebuilt (a receivable reset to fully owing by the
 * old contract save, so the CHECK can only be NOT VALID; an order whose stored
 * advance disagrees with its receivable), then detection finds exactly that,
 * the dry-run writes nothing, and the write run corrects it and validates the
 * CHECK. DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

const NAME = 'chk_receivables_outstanding_equation';
const PREDICATE = "status = 'Written Off' OR abs(outstanding - (expected_amount - received_amount)) <= 0.01";

d('receivable drift detection + correction (DB-gated)', () => {
  let db; let detect; let correct;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  const quiet = () => {};

  beforeAll(async () => {
    db = require('../config/database');
    ({ detect } = require('../../scripts/detectReceivableOutstandingDrift'));
    ({ correct } = require('../../scripts/correctReceivableOutstandingDrift'));
    const role = await db('roles').where({ name: 'Owner' }).first();
    const [u] = await db('users').insert({ email: `zz-drift-${run}@test.local`, full_name: 'ZZ', password_hash: 'x', role_id: role.id, is_active: true, status: 'active' }).returning('*');
    const [c] = await db('customers').insert({ name: `ZZ Drift ${run}`, customer_type: 'export', currency: 'USD' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ Drift Rice ${run}` }).returning('*');
    const [o] = await db('export_orders').insert({
      order_no: `ZZ-DR-${run}`, customer_id: c.id, product_id: p.id, created_by: u.id, status: 'In Milling',
      qty_mt: 10, price_per_mt: 500, contract_value: 5000, currency: 'USD', advance_pct: 20,
      advance_expected: 1000, balance_expected: 4000, advance_received: 1000, booked_fx_rate: 280,
      financial_status: 'Confirmed',
    }).returning('*');
    ids.order = o.id;
    const [r] = await db('receivables').insert({
      recv_no: `RCV-ADV-ZZ-${run}`, entity: 'export', order_id: o.id, customer_id: c.id, type: 'Advance',
      expected_amount: 1000, received_amount: 1000, outstanding: 0, status: 'Paid', currency: 'USD', base_amount_pkr: 280000,
    }).returning('*');
    ids.recv = r.id;

    // What production looks like after deploying migration 341 over EXP-01 rows.
    await db.raw(`ALTER TABLE receivables DROP CONSTRAINT ${NAME}`);
    await db('receivables').where({ id: r.id }).update({ outstanding: 1000, status: 'Pending' });
    await db.raw(`ALTER TABLE receivables ADD CONSTRAINT ${NAME} CHECK (${PREDICATE}) NOT VALID`);
    // …and an order whose stored advance disagrees with its receivable.
    await db.raw('ALTER TABLE receivables DISABLE TRIGGER receivables_refresh_order');
    await db('export_orders').where({ id: o.id }).update({ advance_received: 0, financial_status: 'Advance Not Entered' });
    await db.raw('ALTER TABLE receivables ENABLE TRIGGER receivables_refresh_order');
  });
  afterAll(async () => {
    const v = await db.raw('SELECT convalidated FROM pg_constraint WHERE conname = ?', [NAME]);
    if (!v.rows[0].convalidated) await db.raw(`ALTER TABLE receivables VALIDATE CONSTRAINT ${NAME}`).catch(() => {});
    await db.destroy();
  });

  test('detection finds the reset receivable, the order drift and the NOT VALID constraint', async () => {
    const res = await detect(db);
    expect(res.reset).toContain(ids.recv);
    expect(res.orderDrift.map((r) => r.id)).toContain(ids.order);
    expect(res.constraints[NAME]).toBe('NOT VALID');
  });

  test('the dry-run writes nothing', async () => {
    const out = await correct(db, { write: false, log: quiet });
    expect(out.corrected).toBe(0);
    const r = await db('receivables').where({ id: ids.recv }).first();
    expect(Number(r.outstanding)).toBe(1000);
  });

  test('the write run corrects the rows and validates the CHECK', async () => {
    const out = await correct(db, { write: true, log: quiet });
    expect(out.validated).toContain(NAME);
    const r = await db('receivables').where({ id: ids.recv }).first();
    expect([Number(r.outstanding), r.status]).toEqual([0, 'Paid']);
    const o = await db('export_orders').where({ id: ids.order }).first();
    expect([Number(o.advance_received), o.financial_status]).toEqual([1000, 'Confirmed']);
    const after = await detect(db);
    expect(after.reset).not.toContain(ids.recv);
    expect(after.constraints[NAME]).toBe('VALID');
  });

  test('a mill opening receivable with no order is allowed; an export one is not (migration 370)', async () => {
    const c = await db('customers').where({ name: `ZZ Drift ${run}` }).first();
    const [open] = await db('receivables').insert({
      recv_no: `RCV-O-ZZ-${run}`, entity: 'mill', customer_id: c.id, type: 'Balance',
      expected_amount: 250, received_amount: 0, outstanding: 250, status: 'Pending', currency: 'PKR',
    }).returning('*');
    const res = await detect(db);
    expect(res.links.chk_receivables_export_parent).not.toContain(open.id);
    await expect(db('receivables').insert({
      recv_no: `RCV-X-ZZ-${run}`, entity: 'export', customer_id: c.id, type: 'Advance',
      expected_amount: 1, received_amount: 0, outstanding: 1, status: 'Pending', currency: 'USD',
    })).rejects.toThrow(/chk_receivables_export_parent/);
    await db('receivables').where({ id: open.id }).del();
  });
});
