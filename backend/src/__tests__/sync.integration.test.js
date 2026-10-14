// Stage 6a — sync pull path (DB-gated). Verifies device bootstrap (idempotent
// upsert), the pull gates (unknown domain / unregistered device), and incremental
// delta pull with a watermark. Runs only when DB_HOST is set (skipped in DB-less
// CI); needs a migrated DB. See docNumber.integration.test.js for the local recipe.
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;

const mockRes = () => ({
  statusCode: 200,
  body: null,
  status(c) { this.statusCode = c; return this; },
  json(j) { this.body = j; return this; },
});

d('sync pull path (DB-gated)', () => {
  let db, controller, saUser, deviceUuid;

  beforeAll(async () => {
    db = require('../config/database');
    controller = require('../modules/sync/sync.controller');
    // Ensure a Super Admin role exists (bypasses per-domain RBAC).
    let sa = await db('roles').where({ name: 'Super Admin' }).first();
    if (!sa) { [sa] = await db('roles').insert({ name: 'Super Admin' }).returning('*'); }
    saUser = { id: 1, role_id: sa.id };
    deviceUuid = '11111111-1111-4111-8111-111111111111';
    // Seed two customers with distinct updated_at for the delta test.
    await db('customers').where('name', 'like', 'ZZTEST%').del().catch(() => {});
    await db('customers').insert([
      { name: 'ZZTEST Cust A', customer_type: 'local', currency: 'PKR', credit_limit: 0, is_active: true, is_favorite: false, archived: false, approval_status: 'approved', created_at: db.fn.now(), updated_at: '2026-01-01T00:00:00Z' },
      { name: 'ZZTEST Cust B', customer_type: 'local', currency: 'PKR', credit_limit: 0, is_active: true, is_favorite: false, archived: false, approval_status: 'approved', created_at: db.fn.now(), updated_at: '2026-06-01T00:00:00Z' },
    ]);
  });

  afterAll(async () => {
    await db('customers').where('name', 'like', 'ZZTEST%').del().catch(() => {});
    await db('devices').where({ device_uuid: deviceUuid }).del().catch(() => {});
    // The pool is closed by the last describe's afterAll.
  });

  test('bootstrap registers the device, and is an idempotent upsert', async () => {
    let res = mockRes();
    await controller.bootstrap({ body: { device_uuid: deviceUuid, platform: 'web', label: 'test' }, user: saUser }, res);
    expect(res.body.success).toBe(true);
    let count = await db('devices').where({ device_uuid: deviceUuid }).count('* as c').first();
    expect(Number(count.c)).toBe(1);

    res = mockRes();
    await controller.bootstrap({ body: { device_uuid: deviceUuid, platform: 'web' }, user: saUser }, res);
    count = await db('devices').where({ device_uuid: deviceUuid }).count('* as c').first();
    expect(Number(count.c)).toBe(1); // still one row (upsert, not duplicate)
  });

  test('pull rejects an unknown domain (400)', async () => {
    const res = mockRes();
    await controller.pull({ body: { device_uuid: deviceUuid, domain: 'nope' }, user: saUser }, res);
    expect(res.statusCode).toBe(400);
  });

  test('pull rejects an unregistered device (403)', async () => {
    const res = mockRes();
    await controller.pull({ body: { device_uuid: '22222222-2222-4222-8222-222222222222', domain: 'customers' }, user: saUser }, res);
    expect(res.statusCode).toBe(403);
  });

  test('pull returns customers, and a watermark filters to newer rows only', async () => {
    let res = mockRes();
    await controller.pull({ body: { device_uuid: deviceUuid, domain: 'customers' }, user: saUser }, res);
    expect(res.body.success).toBe(true);
    const names = res.body.data.rows.map((r) => r.name).filter((n) => n && n.startsWith('ZZTEST'));
    expect(names).toEqual(expect.arrayContaining(['ZZTEST Cust A', 'ZZTEST Cust B']));

    // A legacy (bare timestamp) watermark is read INCLUSIVELY since P1-13 — the
    // boundary row is re-sent rather than risk skipping a tie. One second past
    // Cust A → only the June row (and any other newer rows), never Cust A.
    res = mockRes();
    await controller.pull({ body: { device_uuid: deviceUuid, domain: 'customers', since: '2026-01-01T00:00:01Z' }, user: saUser }, res);
    const after = res.body.data.rows.map((r) => r.name).filter((n) => n && n.startsWith('ZZTEST'));
    expect(after).toContain('ZZTEST Cust B');
    expect(after).not.toContain('ZZTEST Cust A');
    // …and the answer carries the composite v2 watermark.
    expect(res.body.data.watermark).toMatch(/^v2\|.+\|\d+$/);

    // Exactly AT Cust A's timestamp: inclusive, so Cust A comes back.
    res = mockRes();
    await controller.pull({ body: { device_uuid: deviceUuid, domain: 'customers', since: '2026-01-01T00:00:00Z' }, user: saUser }, res);
    expect(res.body.data.rows.map((r) => r.name)).toContain('ZZTEST Cust A');
  });

  test('a malformed watermark is a clean 400', async () => {
    const res = mockRes();
    await controller.pull({ body: { device_uuid: deviceUuid, domain: 'customers', since: 'v2|nope|x' }, user: saUser }, res);
    expect(res.statusCode).toBe(400);
  });
});

// P1-13 — composite cursor, real permissions, projection + cost redaction,
// warehouse scope, and bootstrap never re-binding another user's device.
d('sync pull — P1-13 (DB-gated)', () => {
  let db, controller;
  const TS = '2026-03-03T03:03:03.123456Z';
  const devA = '33333333-3333-4333-8333-333333333333';
  let roleIds = {}; let users = {}; let whIds = []; let lotIds = []; let productId;

  const mockReq = (user, body) => ({ user: { ...user }, body: { device_uuid: devA, ...body } });
  const pullAs = async (user, body) => { const res = mockRes(); await controller.pull(mockReq(user, body), res); return res; };

  beforeAll(async () => {
    db = require('../config/database');
    controller = require('../modules/sync/sync.controller');
    const perm = async (module, action) => {
      let p = await db('permissions').where({ module, action }).first();
      if (!p) [p] = await db('permissions').insert({ module, action }).returning('*');
      return p.id;
    };
    const role = async (name, grants) => {
      await db('roles').where({ name }).del().catch(() => {});
      const [r] = await db('roles').insert({ name }).returning('*');
      for (const [m, a] of grants) await db('role_permissions').insert({ role_id: r.id, permission_id: await perm(m, a) });
      return r.id;
    };
    roleIds.blind = await role('ZZTEST Cost Blind', [['inventory', 'view'], ['export_orders', 'view']]);
    roleIds.seer = await role('ZZTEST Cost Seer', [['inventory', 'view'], ['reports', 'view_cost'], ['reports', 'view_profit']]);
    const mkUser = async (key, roleId) => {
      await db('users').where({ email: `zztest-${key}@example.invalid` }).del().catch(() => {});
      const [u] = await db('users').insert({
        email: `zztest-${key}@example.invalid`, full_name: `ZZTEST ${key}`, password_hash: 'FAKE-test-hash', role_id: roleId,
      }).returning('*');
      users[key] = { id: u.id, role_id: roleId };
    };
    await mkUser('blind', roleIds.blind);
    await mkUser('seer', roleIds.seer);
    await mkUser('other', roleIds.seer);

    const wh = await db('warehouses').insert([
      { name: 'ZZTEST WH 1', type: 'raw', entity: 'mill' },
      { name: 'ZZTEST WH 2', type: 'raw', entity: 'mill' },
    ]).returning('id');
    whIds = wh.map((w) => w.id || w);
    const [p] = await db('products').insert({ name: 'ZZTEST Rice', code: `ZZT-${Date.now()}` }).returning('id');
    productId = p.id || p;
    // Three lots sharing ONE updated_at — the page-boundary tie.
    const lots = await db('inventory_lots').insert([0, 1, 2].map((i) => ({
      lot_no: `ZZTEST-LOT-${i}`, item_name: 'ZZTEST', type: 'raw', entity: 'mill', product_id: productId,
      warehouse_id: whIds[i === 2 ? 1 : 0], qty: 100, available_qty: 100, net_weight_kg: 100,
      rate_per_kg: 120, landed_cost_per_kg: 125, landed_cost_total: 12500, total_value: 12500, updated_at: TS,
    }))).returning('id');
    lotIds = lots.map((l) => l.id || l);
    // Push every other lot's timestamp away so only ours share TS (and sort first).
    await db('inventory_lots').whereNotIn('id', lotIds).update({ updated_at: '2026-09-09T00:00:00Z' });

    await db('devices').where({ device_uuid: devA }).del();
    await db('devices').insert({ device_uuid: devA, user_id: users.seer.id, platform: 'web', registered_at: db.fn.now(), last_seen_at: db.fn.now() });
  });

  afterAll(async () => {
    await db('devices').where({ device_uuid: devA }).del().catch(() => {});
    await db('user_scopes').whereIn('user_id', Object.values(users).map((u) => u.id)).del().catch(() => {});
    await db('inventory_lots').whereIn('id', lotIds).del().catch(() => {});
    await db('products').where({ id: productId }).del().catch(() => {});
    await db('warehouses').whereIn('id', whIds).del().catch(() => {});
    await db('users').whereIn('id', Object.values(users).map((u) => u.id)).del().catch(() => {});
    await db('role_permissions').whereIn('role_id', Object.values(roleIds)).del().catch(() => {});
    await db('roles').whereIn('id', Object.values(roleIds)).del().catch(() => {});
    await db.destroy();
  });

  test('rows with identical timestamps across a page boundary are all pulled', async () => {
    const seen = [];
    let since;
    for (let i = 0; i < 6; i += 1) {
      const res = await pullAs(users.seer, { domain: 'inventory', since, limit: 1 });
      expect(res.statusCode).toBe(200);
      seen.push(...res.body.data.rows.map((r) => r.id));
      since = res.body.data.watermark;
      if (lotIds.every((id) => seen.includes(id))) break;
    }
    expect(seen.slice(0, 3)).toEqual([...lotIds].sort((a, b) => a - b));
  });

  test('a cost-blind role pulls inventory with no cost columns; a cost role keeps them', async () => {
    const blind = await pullAs(users.blind, { domain: 'inventory' });
    expect(blind.statusCode).toBe(200);
    const row = blind.body.data.rows.find((r) => r.id === lotIds[0]);
    expect(row).toMatchObject({ lot_no: 'ZZTEST-LOT-0', net_weight_kg: expect.anything() });
    for (const k of ['rate_per_kg', 'landed_cost_per_kg', 'landed_cost_total', 'total_value', 'cost_per_unit', 'purchase_amount']) {
      expect(row).not.toHaveProperty(k);
    }
    const seer = await pullAs(users.seer, { domain: 'inventory' });
    expect(Number(seer.body.data.rows.find((r) => r.id === lotIds[0]).rate_per_kg)).toBe(120);
  });

  test('domains map to real permissions: customers via export_orders.view, suppliers needs milling.view', async () => {
    expect((await pullAs(users.blind, { domain: 'customers' })).statusCode).toBe(200);
    expect((await pullAs(users.blind, { domain: 'suppliers' })).statusCode).toBe(403);
    expect((await pullAs(users.blind, { domain: 'products' })).statusCode).toBe(200);
  });

  test('a warehouse-scoped user pulls only their warehouses', async () => {
    await db('user_scopes').insert({ user_id: users.blind.id, scope_type: 'warehouse', scope_value: String(whIds[1]) });
    const res = await pullAs(users.blind, { domain: 'inventory' });
    const ids = res.body.data.rows.map((r) => r.id);
    expect(ids).toContain(lotIds[2]);
    expect(ids).not.toContain(lotIds[0]);
    const wh = await pullAs(users.blind, { domain: 'warehouses' });
    expect(wh.body.data.rows.map((r) => r.id)).toEqual([whIds[1]]);
    await db('user_scopes').where({ user_id: users.blind.id }).del();
  });

  test('a module-scoped user cannot pull a domain outside their modules', async () => {
    await db('user_scopes').insert({ user_id: users.blind.id, scope_type: 'module', scope_value: 'export_orders' });
    expect((await pullAs(users.blind, { domain: 'inventory' })).statusCode).toBe(403);
    expect((await pullAs(users.blind, { domain: 'customers' })).statusCode).toBe(200);
    await db('user_scopes').where({ user_id: users.blind.id }).del();
  });

  test('every domain projection is valid SQL and returns a v2 watermark (Super Admin)', async () => {
    const sa = await db('roles').where({ name: 'Super Admin' }).first();
    for (const domain of ['customers', 'suppliers', 'products', 'warehouses', 'bank_accounts', 'inventory', 'lot_ledger', 'milling', 'local_sales', 'export_orders']) {
      const res = await pullAs({ id: users.seer.id, role_id: sa.id }, { domain, limit: 5 });
      expect([domain, res.statusCode]).toEqual([domain, 200]);
      if (res.body.data.rows.length) expect(res.body.data.watermark).toMatch(/^v2\|/);
    }
  });

  test("bootstrap never re-binds another user's device", async () => {
    const res = mockRes();
    await controller.bootstrap({ user: { ...users.other }, body: { device_uuid: devA, platform: 'evil', label: 'x' }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.ownedByAnotherUser).toBe(true);
    const dev = await db('devices').where({ device_uuid: devA }).first();
    expect(dev.user_id).toBe(users.seer.id);
    expect(dev.platform).toBe('web');
  });
});
