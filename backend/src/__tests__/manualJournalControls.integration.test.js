/**
 * P2-13 — manual journal controls and period-safe reversals (owner decision D-2).
 *
 *   - Joi is wired on POST /journals (the schema existed but was never used)
 *   - a manual journal may not touch a control account (bank / cash, AR,
 *     customer advances, AP, salaries payable, stock) — at create AND at post
 *   - a reversal needs a reason and the Owner's approval, and is a dated
 *     signed-delta journal: the original is never edited, a closed period is
 *     never changed, and reversing twice posts ONE delta
 *   - the /auto-post "testing endpoint" is gone; reopening a period needs the Owner
 *   - every one of these writes its audit row inside its own transaction
 *     (P2-30): a refused / rolled-back request leaves none, a committed one one
 *
 * Real router, controller, service, ownerApproval and Postgres; only the
 * authenticate / rbac layer is stood in for (the permission matrix has its own
 * suite). DB-gated: skipped unless DB_HOST is set.
 */
jest.mock('../middleware/rbac', () => () => (req, res, next) => next());

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('manual journal controls (DB-gated)', () => {
  let db; let request; let app; let accounting; let ownerApproval;
  const run = `${Date.now()}`.slice(-7);
  const ids = {};
  const acc = {};
  let period;
  const today = new Date().toISOString().slice(0, 10);

  const as = (who) => (r) => r.set('x-test-user', String(ids[who]));
  const post = (who, url, body) => as(who)(request(app).post(url)).send(body || {});
  const put = (who, url, body) => as(who)(request(app).put(url)).send(body || {});
  const audits = (action, entityId) => db('audit_logs').where({ action, entity_id: String(entityId) });
  const line = (code, debit, credit) => ({ account_id: acc[code].id, debit, credit });
  const journalBody = (lines, extra = {}) => ({
    date: today, entity: 'general', description: `ZZ manual ${run}`, lines, ...extra,
  });
  const netOf = async (journalIds) => {
    const r = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .whereIn('je.id', journalIds).where('je.status', 'Posted')
      .select(db.raw('COALESCE(SUM(jl.debit), 0)::float AS dr, COALESCE(SUM(jl.credit), 0)::float AS cr')).first();
    return r;
  };

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    accounting = require('../modules/accounting/accounting.service');
    ownerApproval = require('../middleware/ownerApproval');
    const express = require('express');
    const bcrypt = require('bcryptjs');

    const ownerRole = await db('roles').where({ name: 'Owner' }).first();
    const fmRole = await db('roles').where({ name: 'Finance Manager' }).first();
    const user = async (tag, roleId) => (await db('users').insert({
      email: `zz-mj-${tag}-${run}@test.local`, full_name: `ZZ ${tag} ${run}`,
      password_hash: await bcrypt.hash('pw', 4), role_id: roleId, is_active: true, status: 'active',
    }).returning('*'))[0];
    ids.owner = (await user('owner', ownerRole.id)).id;
    ids.fm = (await user('fm', fmRole.id)).id;
    const roleOf = { [ids.owner]: ownerRole.id, [ids.fm]: fmRole.id };

    for (const code of ['1000', '1110', '1250', '2010', '3000', '6000', '6200', '1290']) {
      acc[code] = await db('chart_of_accounts').where({ code }).first();
    }

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const id = parseInt(req.headers['x-test-user'], 10);
      req.user = { id, role_id: roleOf[id] };
      next();
    });
    app.use('/api/accounting', require('../modules/accounting/accounting.routes'));

    period = await db('accounting_periods').where('period_start', '<=', today).andWhere('period_end', '>=', today).first();
  });

  beforeEach(() => ownerApproval._resetAttempts());

  afterAll(async () => {
    if (!db) return;
    if (period) await db('accounting_periods').where({ id: period.id }).update({ status: 'Open' });
    await db.destroy();
  });

  // ── create ────────────────────────────────────────────────────────────────
  test('Joi is wired: a missing description or a line with both sides is a 400', async () => {
    const r1 = await post('fm', '/api/accounting/journals', { date: today, entity: 'general', lines: [line('6000', 10, 0), line('3000', 0, 10)] });
    expect(r1.status).toBe(400);
    expect(r1.body.message).toBe('Validation failed.');
    const r2 = await post('fm', '/api/accounting/journals', journalBody([line('6000', 10, 10), line('3000', 0, 10)]));
    expect(r2.status).toBe(400);
  });

  test.each([['1000'], ['1110'], ['1250'], ['2010']])('a manual line on control account %s is refused and nothing is saved', async (code) => {
    const before = Number((await db('journal_entries').count({ c: '*' }).first()).c);
    const res = await post('fm', '/api/accounting/journals', journalBody([line('6000', 50, 0), line(code, 0, 50)]));
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('control_account');
    expect(res.body.message).toContain(code);
    expect(Number((await db('journal_entries').count({ c: '*' }).first()).c)).toBe(before);
  });

  test('a bank account\'s own GL counts as a control account', async () => {
    const own = await db('chart_of_accounts').where('code', 'like', '10%').whereNot('code', '1000').first();
    const res = await post('fm', '/api/accounting/journals', journalBody([line('6000', 5, 0), { account_id: own.id, debit: 0, credit: 5 }]));
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('control_account');
  });

  test('suspense (1290) is not a control account', async () => {
    const res = await post('fm', '/api/accounting/journals', journalBody([line('1290', 7, 0), line('3000', 0, 7)]));
    expect(res.status).toBe(201);
  });

  let manual;
  test('a non-control journal is created as a Draft with exactly one audit row', async () => {
    const res = await post('fm', '/api/accounting/journals', journalBody([line('6200', 120, 0), line('3000', 0, 120)]));
    expect(res.status).toBe(201);
    manual = res.body.data.journal;
    expect(manual.status).toBe('Draft');
    expect(manual.is_auto).toBe(false);
    await new Promise((r) => setTimeout(r, 100)); // the middleware would log after the response
    expect(await audits('create_journal', manual.id)).toHaveLength(1);
  });

  test('posting it: Posted, one audit row', async () => {
    const res = await put('fm', `/api/accounting/journals/${manual.id}/post`);
    expect(res.status).toBe(200);
    expect(res.body.data.journal.status).toBe('Posted');
    await new Promise((r) => setTimeout(r, 100));
    expect(await audits('post_journal', manual.id)).toHaveLength(1);
  });

  test('a manual DRAFT on a control account (written before the rule) cannot be posted', async () => {
    const j = await accounting.createJournal(null, {
      date: today, entity: 'general', refType: 'Manual Journal', description: `ZZ legacy ${run}`, isAuto: false,
      lines: [line('6000', 9, 0), line('1000', 0, 9)],
    });
    const res = await put('fm', `/api/accounting/journals/${j.id}/post`);
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('control_account');
    expect((await db('journal_entries').where({ id: j.id }).first()).status).toBe('Draft');
    expect(await audits('post_journal', j.id)).toHaveLength(0);
  });

  // ── reverse ───────────────────────────────────────────────────────────────
  test('reversal without the Owner is refused', async () => {
    const res = await post('fm', `/api/accounting/journals/${manual.id}/reverse`, { reason: 'posted to the wrong account' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OWNER_AUTH_REQUIRED');
  });

  test('reversal without a reason is refused', async () => {
    const res = await post('owner', `/api/accounting/journals/${manual.id}/reverse`, {});
    expect(res.status).toBe(400);
  });

  test('reversal in a closed period is refused and leaves no delta and no audit row', async () => {
    await db('accounting_periods').where({ id: period.id }).update({ status: 'Closed' });
    try {
      const res = await post('owner', `/api/accounting/journals/${manual.id}/reverse`, { reason: 'posted to the wrong account' });
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('period_closed');
    } finally {
      await db('accounting_periods').where({ id: period.id }).update({ status: 'Open' });
    }
    expect(await db('journal_entries').where({ reversal_of: manual.id })).toHaveLength(0);
    expect(await audits('reverse_journal', manual.id)).toHaveLength(0);
  });

  test('Owner-approved reversal: a dated signed delta; the original stays Posted and the pair nets to zero', async () => {
    const res = await post('owner', `/api/accounting/journals/${manual.id}/reverse`, { reason: 'posted to the wrong account' });
    expect(res.status).toBe(201);
    const delta = res.body.data.journal;
    expect(delta.reversal_of).toBe(manual.id);
    expect(delta.status).toBe('Posted');
    expect((await db('journal_entries').where({ id: manual.id }).first()).status).toBe('Posted');
    const lines = await db('journal_lines').where({ journal_id: delta.id }).orderBy('id');
    expect(lines.map((l) => [l.account_id, Number(l.debit), Number(l.credit)]))
      .toEqual([[acc['6200'].id, 0, 120], [acc['3000'].id, 120, 0]]);
    const perAccount = await db('journal_lines as jl').join('journal_entries as je', 'je.id', 'jl.journal_id')
      .whereIn('je.id', [manual.id, delta.id]).where('je.status', 'Posted')
      .groupBy('jl.account_id').select('jl.account_id', db.raw('SUM(jl.debit - jl.credit)::float AS net'));
    expect(perAccount.every((r) => Math.abs(r.net) < 0.001)).toBe(true);
    const a = await audits('reverse_journal', manual.id);
    expect(a).toHaveLength(1);
    expect(a[0].details.reason).toBe('posted to the wrong account');
    expect(await db('approval_authorizations').where({ kind: 'journal_reversal', ref: String(manual.id) })).toHaveLength(1);
  });

  test('reversing twice posts ONE delta (idempotent on reversal_of)', async () => {
    const res = await post('owner', `/api/accounting/journals/${manual.id}/reverse`, { reason: 'double click' });
    expect(res.status).toBe(200);
    expect(res.body.data.already_reversed).toBe(true);
    expect(await db('journal_entries').where({ reversal_of: manual.id })).toHaveLength(1);
    expect(await audits('reverse_journal', manual.id)).toHaveLength(1);
  });

  test('the helper is idempotent under a concurrent double call', async () => {
    const j = await accounting.createJournal(null, {
      date: today, entity: 'general', refType: 'Manual Journal', description: `ZZ race ${run}`, isAuto: false,
      lines: [line('6200', 3, 0), line('3000', 0, 3)],
    });
    await accounting.postJournal(null, j.id);
    await Promise.all([1, 2].map(() => accounting.postReversalDelta(null, { journalId: j.id, reason: 'race' })));
    expect(await db('journal_entries').where({ reversal_of: j.id, status: 'Posted' })).toHaveLength(1);
    const n = await netOf([j.id, ...(await db('journal_entries').where({ reversal_of: j.id }).pluck('id'))]);
    expect(n.dr).toBe(n.cr);
  });

  test('a document\'s journal on a control account is not reversed here', async () => {
    const j = await accounting.createJournal(null, {
      date: today, entity: 'general', refType: 'Payment', description: `ZZ doc ${run}`, isAuto: true,
      lines: [line('2010', 4, 0), line('1000', 0, 4)],
    });
    await accounting.postJournal(null, j.id);
    const res = await post('owner', `/api/accounting/journals/${j.id}/reverse`, { reason: 'should go via payment' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('control_account');
  });

  test('the legacy status-flip reverseJournal honours a closed period', async () => {
    const j = await accounting.createJournal(null, {
      date: today, entity: 'general', refType: 'Test', description: `ZZ flip ${run}`, isAuto: true,
      lines: [line('6200', 2, 0), line('3000', 0, 2)],
    });
    await accounting.postJournal(null, j.id);
    await db('accounting_periods').where({ id: period.id }).update({ status: 'Closed' });
    let err;
    try {
      err = await accounting.reverseJournal(null, { journalId: j.id, reason: 'x' }).catch((e) => e);
    } finally {
      await db('accounting_periods').where({ id: period.id }).update({ status: 'Open' });
    }
    expect(err.reason).toBe('period_closed');
    expect((await db('journal_entries').where({ id: j.id }).first()).status).toBe('Posted');
  });

  // ── removed / owner-gated endpoints ───────────────────────────────────────
  test('/auto-post is gone', async () => {
    const res = await post('fm', '/api/accounting/auto-post', { trigger_event: 'expense_recorded', amount: 1 });
    expect(res.status).toBe(404);
  });

  test('reopening a period needs the Owner and a reason', async () => {
    await db('accounting_periods').where({ id: period.id }).update({ status: 'Closed' });
    try {
      const r1 = await put('fm', `/api/accounting/periods/${period.id}/reopen`, { reason: 'late supplier bill' });
      expect(r1.status).toBe(403);
      const r2 = await put('owner', `/api/accounting/periods/${period.id}/reopen`, {});
      expect(r2.status).toBe(400);
      const r3 = await put('owner', `/api/accounting/periods/${period.id}/reopen`, { reason: 'late supplier bill' });
      expect(r3.status).toBe(200);
      expect(r3.body.data.period.status).toBe('Open');
      const a = await audits('reopen_period', period.id);
      expect(a.length).toBeGreaterThanOrEqual(1);
      expect(a[a.length - 1].details.reason).toBe('late supplier bill');
    } finally {
      await db('accounting_periods').where({ id: period.id }).update({ status: 'Open' });
    }
  });
});
