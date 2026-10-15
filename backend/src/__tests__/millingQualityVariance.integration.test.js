/**
 * P3-16 (MIL-05 / MIL-14 / MIL-36): quality variance columns, QC actions,
 * per-truck grade quality and the Quality Comparison list endpoint.
 *
 *   - Hold / Approve / Renegotiate / Reject write variance_status against a
 *     real DB (they used to 500 — the columns did not exist);
 *   - an unknown variance_status is refused (400), not a DB error;
 *   - saving the sample + arrival analysis stores variance_pct;
 *   - per-truck B1/B2/B3/C.S/short grain/Choba/N.B/O.V survive the whitelist;
 *   - GET /api/milling/quality-comparison returns analyses + variance in one
 *     call.
 *
 * The pure variance rule and the whitelist are tested without a DB.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));

const { computeVariancePct } = require('../modules/milling/qualityVariance');
const { sanitizeVehicleQuality } = require('../modules/milling/milling.controller');

describe('computeVariancePct', () => {
  test('largest absolute difference over the compared parameters', () => {
    expect(computeVariancePct({ moisture: 12, broken: 4, chalky: 2 }, { moisture: 13.5, broken: 3, chalky: '2.2' })).toBe(1.5);
  });
  test('null without both analyses; 0 when nothing is comparable', () => {
    expect(computeVariancePct(null, { moisture: 12 })).toBeNull();
    expect(computeVariancePct({ moisture: 12 }, null)).toBeNull();
    expect(computeVariancePct({ moisture: 12 }, { broken: 3 })).toBe(0);
  });
});

describe('sanitizeVehicleQuality keeps the per-truck grade split', () => {
  test('un-suffixed grade keys (what the drawers send) are kept', () => {
    const q = sanitizeVehicleQuality({
      moisture: '12.5', b1: 2, b2: '1.5', b3: 0.5, csr: 1, short_grain: 3, cobba: 0.25, nb: 0.1, ov: 0.2, junk: 9,
    });
    expect(q).toEqual({ moisture: 12.5, b1: 2, b2: 1.5, b3: 0.5, csr: 1, short_grain: 3, cobba: 0.25, nb: 0.1, ov: 0.2 });
  });
  test('the sample-table spelling (b1_pct …) is stored un-suffixed', () => {
    expect(sanitizeVehicleQuality({ b1_pct: 2, cobba_pct: '0.5' })).toEqual({ b1: 2, cobba: 0.5 });
  });
});

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('milling quality variance (DB-gated)', () => {
  let db; let app; let request; let token;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  let seq = 0;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (url, body = {}) => request(app).post(url).set(auth()).set('Idempotency-Key', `qv-${Math.random()}`).send(body);
  const put = (url, body = {}) => request(app).put(url).set(auth()).set('Idempotency-Key', `qv-${Math.random()}`).send(body);
  const makeBatch = async (over = {}) => {
    seq += 1;
    const [b] = await db('milling_batches').insert({
      batch_no: `MQV${run}-${seq}`, supplier_id: ids.sup, product_id: ids.product, raw_qty_kg: 10000,
      status: 'Queued', created_by: ids.user, mill_id: ids.mill, ...over,
    }).returning('*');
    return b;
  };
  const row = (id) => db('milling_batches').where({ id }).first();

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const [u] = await db('users').insert({
      email: `zz-qv-${run}@test.local`, full_name: `ZZ QV ${run}`, password_hash: 'x', role_id: role.id, is_active: true, status: 'active',
    }).returning('*');
    token = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    const [sup] = await db('suppliers').insert({ name: `ZZ QV Supplier ${run}`, type: 'local' }).returning('*');
    const [p] = await db('products').insert({ name: `ZZ QV Rice ${run}` }).returning('*');
    const [mill] = await db('mills').insert({ name: `ZZ QV Mill ${run}` }).returning('*');
    Object.assign(ids, { user: u.id, sup: sup.id, product: p.id, mill: mill.id });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  test('Hold → On Hold; Resume with Approved → Queued + Approved', async () => {
    const b = await makeBatch();
    const h = await post(`/api/milling/batches/${b.id}/hold`, { variance_status: 'On Hold' });
    expect(h.status).toBe(200);
    expect(await row(b.id)).toMatchObject({ status: 'On Hold', variance_status: 'On Hold' });
    const r = await post(`/api/milling/batches/${b.id}/resume`, { variance_status: 'Approved' });
    expect(r.status).toBe(200);
    expect(await row(b.id)).toMatchObject({ status: 'Queued', variance_status: 'Approved' });
  });

  test('Approve / Renegotiate on a running batch go through PUT', async () => {
    const b = await makeBatch({ status: 'In Progress' });
    expect((await put(`/api/milling/batches/${b.id}`, { variance_status: 'Renegotiation' })).status).toBe(200);
    expect((await row(b.id)).variance_status).toBe('Renegotiation');
    expect((await put(`/api/milling/batches/${b.id}`, { variance_status: 'Approved' })).status).toBe(200);
    expect((await row(b.id)).variance_status).toBe('Approved');
  });

  test('Reject cancels the batch and records Rejected', async () => {
    const b = await makeBatch();
    const r = await post(`/api/milling/batches/${b.id}/cancel`, { variance_status: 'Rejected' });
    expect(r.status).toBe(200);
    expect(await row(b.id)).toMatchObject({ status: 'Cancelled', variance_status: 'Rejected' });
  });

  test('an unknown variance_status is a 400, not a 500', async () => {
    const b = await makeBatch();
    const r = await put(`/api/milling/batches/${b.id}`, { variance_status: 'Maybe' });
    expect(r.status).toBe(400);
    expect((await row(b.id)).variance_status).toBeNull();
    // and the DB itself refuses it
    await expect(db('milling_batches').where({ id: b.id }).update({ variance_status: 'Maybe' })).rejects.toThrow(/chk_milling_batches_variance_status/);
  });

  test('saving sample + arrival analysis stores variance_pct; the list endpoint returns it', async () => {
    const b = await makeBatch();
    const s = await post(`/api/milling/batches/${b.id}/quality`, { analysis_type: 'sample', moisture: 12, broken: 4, chalky: 2 });
    expect(s.status).toBe(200);
    expect((await row(b.id)).variance_pct).toBeNull(); // only one side yet
    const a = await post(`/api/milling/batches/${b.id}/quality`, { analysis_type: 'arrival', moisture: 13.75, broken: 3.5, chalky: 2 });
    expect(a.status).toBe(200);
    expect(a.body.data.variancePct).toBe(1.75);
    expect(Number((await row(b.id)).variance_pct)).toBe(1.75);

    const list = await request(app).get('/api/milling/quality-comparison').set(auth());
    expect(list.status).toBe(200);
    const mine = list.body.data.batches.find((x) => x.id === b.id);
    expect(mine).toMatchObject({ variance_pct: 1.75, has_quality: true });
    expect(mine.sample).toMatchObject({ moisture: 12, broken: 4 });
    expect(mine.arrival).toMatchObject({ moisture: 13.75, broken: 3.5 });
  });

  test('per-truck grade quality round-trips through add + edit vehicle', async () => {
    const b = await makeBatch();
    const add = await post(`/api/milling/batches/${b.id}/vehicles`, {
      vehicle_no: `ZZQV-${run}`, weight_kg: 0,
      quality: { moisture: 12, b1: 2, b2: 1.5, b3: 0.5, csr: 1, short_grain: 3, cobba: 0.25, nb: 0.1, ov: 0.2 },
    });
    expect(add.status).toBe(200);
    const v = await db('milling_vehicle_arrivals').where({ batch_id: b.id }).first();
    expect(v.quality_json).toEqual({ moisture: 12, b1: 2, b2: 1.5, b3: 0.5, csr: 1, short_grain: 3, cobba: 0.25, nb: 0.1, ov: 0.2 });
    const edit = await put(`/api/milling/batches/${b.id}/vehicles/${v.id}`, {
      vehicle_no: `ZZQV-${run}`, quality: { moisture: 12, b1: 2.5, cobba: 0.75 },
    });
    expect(edit.status).toBe(200);
    const v2 = await db('milling_vehicle_arrivals').where({ id: v.id }).first();
    expect(v2.quality_json).toMatchObject({ b1: 2.5, cobba: 0.75 });
  });
});
