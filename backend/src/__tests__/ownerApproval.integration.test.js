/**
 * Owner approval = the Owner enters THEIR password on the requester's screen
 * (owner decision G-11). Real middleware, real bcrypt, real users / roles /
 * approval_authorizations against a fully-migrated Postgres.
 *
 *   - wrong password → 403, the action does not run, nothing is logged
 *   - right password → the action runs and the row stores the verified owner
 *   - a non-owner cannot authorize their own request
 *   - 5 wrong passwords → locked out (429), even for the right password
 *   - an Owner acting themselves passes directly
 *
 * DB-gated: skipped unless DB_HOST is set (see profitDefinitions.integration).
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('ownerApproval — owner password on the spot (DB-gated)', () => {
  let db; let request; let ownerApproval; let app;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  const OWNER_PW = 'Correct horse ✓ 42';
  const done = [];
  const cred = (s) => Buffer.from(s, 'utf8').toString('base64');

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    const express = require('express');
    const bcrypt = require('bcryptjs');
    ownerApproval = require('../middleware/ownerApproval');

    let ownerRole = await db('roles').where({ name: 'Owner' }).first();
    if (!ownerRole) [ownerRole] = await db('roles').insert({ name: 'Owner' }).returning('*');
    const clerkRole = await db('roles').where({ name: 'Finance Manager' }).first()
      || (await db('roles').insert({ name: `ZZ Clerk ${run}` }).returning('*'))[0];
    const user = async (tag, roleId, pw) => (await db('users').insert({
      email: `zz-oa-${tag}-${run}@test.local`, full_name: `ZZ ${tag} ${run}`,
      password_hash: await bcrypt.hash(pw, 4), role_id: roleId, is_active: true, status: 'active',
    }).returning('*'))[0];
    ids.owner = (await user('owner', ownerRole.id, OWNER_PW)).id;
    ids.clerk = (await user('clerk', clerkRole.id, 'clerk-pw')).id;
    ids.clerk2 = (await user('clerk2', clerkRole.id, 'clerk2-pw')).id;
    ids.ownerRole = ownerRole.id; ids.clerkRole = clerkRole.id;

    app = express();
    app.use(express.json());
    // Stand-in for authenticate: the acting user comes from a test header.
    app.use((req, res, next) => {
      const id = parseInt(req.headers['x-test-user'], 10);
      req.user = { id, role_id: id === ids.owner ? ids.ownerRole : ids.clerkRole };
      next();
    });
    app.post('/things/:id/approve', ownerApproval(`zz_kind_${run}`), (req, res) => {
      done.push({ id: req.params.id, ownerAuth: req.ownerAuth });
      res.json({ success: true });
    });
  });

  beforeEach(() => { done.length = 0; ownerApproval._resetAttempts(); });

  afterAll(async () => {
    if (!db) return;
    await db('approval_authorizations').where({ kind: `zz_kind_${run}` }).del();
    await db('users').whereIn('id', [ids.owner, ids.clerk, ids.clerk2].filter(Boolean)).del();
    await db.destroy();
  });

  const logged = async (ref) => {
    // The log is written on 'finish' — give it a moment.
    await new Promise((r) => setTimeout(r, 150));
    return db('approval_authorizations').where({ kind: `zz_kind_${run}`, ref: String(ref) });
  };
  const post = (ref, actor, body, credential) => {
    const r = request(app).post(`/things/${ref}/approve`).set('x-test-user', String(actor)).send(body);
    return credential == null ? r : r.set('X-Owner-Credential', cred(credential));
  };

  test('wrong owner password → 403 and nothing done', async () => {
    const res = await post(101, ids.clerk, { authorized_by_owner_id: ids.owner }, 'nope');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OWNER_AUTH_FAILED');
    expect(done).toHaveLength(0);
    expect(await logged(101)).toHaveLength(0);
  });

  test('naming an owner without their password is refused', async () => {
    const res = await post(102, ids.clerk, { authorized_by_owner_id: ids.owner });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OWNER_AUTH_CREDENTIAL_REQUIRED');
    expect(done).toHaveLength(0);
  });

  test('right owner password → action proceeds; the row stores the verified owner', async () => {
    const res = await post(103, ids.clerk, { authorized_by_owner_id: ids.owner }, OWNER_PW);
    expect(res.status).toBe(200);
    expect(done).toEqual([{ id: '103', ownerAuth: { ownerId: ids.owner, self: false, verification: 'password' } }]);
    const rows = await logged(103);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ performed_by: ids.clerk, authorized_by_owner_id: ids.owner, self_approved: false, verification: 'password' });
  });

  test('a non-owner cannot approve for themselves (with their own password)', async () => {
    const res = await post(104, ids.clerk, { authorized_by_owner_id: ids.clerk }, 'clerk-pw');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OWNER_AUTH_INVALID');
    expect(done).toHaveLength(0);
    // …nor by naming another non-owner and their password.
    const res2 = await post(104, ids.clerk, { authorized_by_owner_id: ids.clerk2 }, 'clerk2-pw');
    expect(res2.status).toBe(403);
    expect(res2.body.code).toBe('OWNER_AUTH_INVALID');
    expect(await logged(104)).toHaveLength(0);
  });

  test('lockout after 5 wrong passwords — even the right one is refused; other requesters unaffected', async () => {
    for (let i = 1; i <= 4; i += 1) {
      const r = await post(105, ids.clerk, { authorized_by_owner_id: ids.owner }, `bad-${i}`);
      expect(r.status).toBe(403);
    }
    const fifth = await post(105, ids.clerk, { authorized_by_owner_id: ids.owner }, 'bad-5');
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('OWNER_AUTH_LOCKED');
    const right = await post(105, ids.clerk, { authorized_by_owner_id: ids.owner }, OWNER_PW);
    expect(right.status).toBe(429);
    expect(done).toHaveLength(0);
    // The lock is per requester + owner: someone else can still get the owner's approval.
    const other = await post(106, ids.clerk2, { authorized_by_owner_id: ids.owner }, OWNER_PW);
    expect(other.status).toBe(200);
  });

  test('an Owner acting themselves passes directly (self)', async () => {
    const res = await post(107, ids.owner, {});
    expect(res.status).toBe(200);
    const rows = await logged(107);
    expect(rows[0]).toMatchObject({ performed_by: ids.owner, authorized_by_owner_id: ids.owner, self_approved: true, verification: 'self' });
  });
});
