/**
 * Fewer approvals (owner decision 2026-10-06, "I want less restrictions"):
 *
 *  A. Export advance / balance receipts post on Finance's confirmation alone —
 *     no ownerApproval on the confirm routes (permission + audit stay).
 *  B. Master-data quick-add creates a LIVE ('approved') record, creator kept.
 *  C. Fund-transfer accept: no Owner step; authorised by the RECEIVING side
 *     (finance.confirm_payment for Head Office, milling.edit for the Mill).
 *  D. A 2nd / later document upload goes live at once; a new version
 *     supersedes the previous one, which stays in the history.
 *  E. Fund-transfer reversal: signed-delta journals equal-and-opposite to the
 *     originals, the bank moves undone with offsetting rows, the transfer marked
 *     'reversed' (kept, not deleted), and a second reversal refused with 409.
 *     Migration 315 widens the status CHECK to admit 'reversed'.
 */
const os = require('os');
const path = require('path');

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `fewer-approvals-${process.pid}`);

jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex());

// Tag every ownerApproval(...) middleware so a route stack can be searched for it.
jest.mock('../middleware/ownerApproval', () => jest.fn((kind) => {
  const mw = (req, res, next) => next();
  mw.ownerApprovalKind = kind;
  return mw;
}));

// Doc numbers use MAX() over regexp_replace, which the fake cannot evaluate.
jest.mock('../utils/docNumber', () => {
  const seq = {};
  return {
    nextDocNo: jest.fn(async (trx, { prefix, pad = 4 }) => {
      seq[prefix] = (seq[prefix] || 0) + 1;
      return `${prefix}${String(seq[prefix]).padStart(pad, '0')}`;
    }),
  };
});

// Journals: write real rows into the fake so the test can read them back.
jest.mock('../modules/accounting/accounting.service', () => {
  const db = require('../config/database');
  return {
    createJournal: jest.fn(async (trx, { date, entity, refType, refNo, description, lines }) => {
      const [j] = await trx('journal_entries').insert({
        journal_no: `JE-${Math.random().toString(36).slice(2, 8)}`, date, entity,
        ref_type: refType, ref_no: refNo, description, status: 'Draft',
      }).returning('*');
      for (const l of lines) {
        await trx('journal_lines').insert({ journal_id: j.id, account_id: l.account_id, account: l.account, debit: l.debit, credit: l.credit });
      }
      return j;
    }),
    postJournal: jest.fn(async (trx, id) => {
      await (trx || db)('journal_entries').where({ id }).update({ status: 'Posted' });
    }),
  };
});

const db = require('../config/database');

function reset(tables) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  for (const [k, rows] of Object.entries(tables)) db.tables[k] = rows.map((r) => ({ ...r }));
}

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.on = () => r;
  return r;
}

function routeLayer(router, method, routePath) {
  return router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
}
const ownerKinds = (layer) => layer.route.stack.map((s) => s.handle.ownerApprovalKind).filter(Boolean);

// ─────────────────────────── A ───────────────────────────
describe('A. export receipts post on Finance confirmation alone', () => {
  const router = require('../modules/exportOrders/exportOrders.routes');

  test.each([
    ['/:id/confirm-advance'],
    ['/:id/confirm-balance'],
    ['/receipts/:paymentId/confirm'],
  ])('%s has no ownerApproval but keeps its permission check and audit', (p) => {
    const layer = routeLayer(router, 'post', p);
    expect(layer).toBeTruthy();
    expect(ownerKinds(layer)).toEqual([]);
    // permission check first, controller last, audit somewhere in between
    expect(layer.route.stack.length).toBeGreaterThanOrEqual(4);
  });

  test('cancelling an order is still owner-approved (not part of this decision)', () => {
    expect(ownerKinds(routeLayer(router, 'post', '/:id/cancel'))).toEqual(['export_cancel']);
  });
});

// ─────────────────────────── B ───────────────────────────
describe('B. master-data quick-add goes live', () => {
  const ctrl = require('../modules/admin/approvals.controller');
  const clerk = { id: 42, role_id: 5 }; // no master_data.approve

  beforeEach(() => reset({ roles: [{ id: 5, name: 'Mill Operator' }], role_permissions: [], suppliers: [], customers: [], products: [] }));

  test.each([
    ['quickAddSupplier', 'suppliers', 'supplier'],
    ['quickAddCustomer', 'customers', 'customer'],
    ['quickAddProduct', 'products', 'product'],
  ])('%s creates an approved record and records who created it', async (fn, table, key) => {
    const r = res();
    await ctrl[fn]({ body: { name: 'ZZ New One' }, user: clerk }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body.data[key]).toMatchObject({ approval_status: 'approved', submitted_by: 42, is_active: true });
    expect(db.tables[table]).toHaveLength(1);
    expect(db.tables[table][0].approval_status).toBe('approved');
  });

  test('an existing pending record is left pending (no bulk approval)', async () => {
    reset({ roles: [{ id: 5, name: 'Mill Operator' }], role_permissions: [], suppliers: [{ id: 3, name: 'Old Pending', approval_status: 'pending' }] });
    const r = res();
    await ctrl.quickAddSupplier({ body: { name: 'Brand New' }, user: clerk }, r);
    expect(db.tables.suppliers.find((s) => s.id === 3).approval_status).toBe('pending');
  });
});

// ─────────────────────────── C ───────────────────────────
describe('C. fund-transfer accept is authorised by the receiving side', () => {
  const router = require('../modules/finance/finance.routes');
  const layer = routeLayer(router, 'post', '/fund-transfers/:id/accept');
  const gate = layer.route.stack[0].handle;

  const seed = (toEntity) => reset({
    fund_transfers: [{ id: 9, to_entity: toEntity, status: 'pending' }],
    roles: [{ id: 3, name: 'Finance Manager' }, { id: 4, name: 'Mill Supervisor' }],
    role_permissions: [
      { role_id: 3, module: 'finance', action: 'confirm_payment' },
      { role_id: 4, module: 'milling', action: 'edit' },
    ],
    user_scopes: [],
    users: [],
  });
  async function run(user) {
    const r = res();
    const next = jest.fn();
    await gate({ params: { id: '9' }, user: { ...user } }, r, next);
    return { allowed: next.mock.calls.length === 1, status: r.statusCode };
  }

  test('the route carries no ownerApproval', () => {
    expect(ownerKinds(layer)).toEqual([]);
  });

  test('Head Office transfer: finance.confirm_payment accepts, milling.edit alone does not', async () => {
    seed('general');
    expect((await run({ id: 1, role_id: 3 })).allowed).toBe(true);
    const mill = await run({ id: 2, role_id: 4 });
    expect(mill.allowed).toBe(false);
    expect(mill.status).toBe(403);
  });

  test('Mill transfer: milling.edit accepts, finance.confirm_payment alone does not', async () => {
    seed('mill');
    expect((await run({ id: 2, role_id: 4 })).allowed).toBe(true);
    expect((await run({ id: 1, role_id: 3 })).allowed).toBe(false);
  });

  test('an unknown transfer is a 404', async () => {
    seed('mill');
    const r = res();
    await gate({ params: { id: '77' }, user: { id: 1, role_id: 3 } }, r, jest.fn());
    expect(r.statusCode).toBe(404);
  });

  test('reversal (POST /reverse and DELETE) is Owner / Super Admin only', async () => {
    // authorizeRole joins users→roles; the fake does not resolve joins, so the
    // joined role_name is seeded on the user row.
    reset({ users: [{ id: 1, role_name: 'Finance Manager' }, { id: 2, role_name: 'Owner' }, { id: 3, role_name: 'Super Admin' }] });
    for (const [m, p] of [['post', '/fund-transfers/:id/reverse'], ['delete', '/fund-transfers/:id']]) {
      const l = routeLayer(router, m, p);
      expect(ownerKinds(l)).toEqual([]);
      const guard = l.route.stack[0].handle;
      for (const [uid, ok] of [[1, false], [2, true], [3, true]]) {
        const r = res();
        const next = jest.fn();
        await guard({ params: { id: '9' }, user: { id: uid } }, r, next);
        expect(next.mock.calls.length === 1).toBe(ok);
        if (!ok) expect(r.statusCode).toBe(403);
      }
    }
  });
});

// ─────────────────────────── D ───────────────────────────
describe('D. document re-uploads go live', () => {
  const docs = require('../modules/documents/documents.service');

  beforeEach(() => reset({ document_store: [], document_checklists: [] }));

  test('a 2nd file of the same type is Approved, not Pending Review', async () => {
    const base = { entity: 'export', linkedType: 'export_order', linkedId: 5, docType: 'bl', title: 'BL', uploadedBy: 7 };
    const first = await docs.uploadDocument(db, base);
    const second = await docs.uploadDocument(db, base);
    expect(first.status).toBe('Approved');
    expect(second.status).toBe('Approved');
    expect(second.version).toBe(2);
    // Since 2026-10-07 a re-upload REPLACES the live file; the first is kept as Superseded.
    expect(db.tables.document_store.find((d) => d.id === first.id)).toMatchObject({ status: 'Superseded', is_latest: false });
  });

  test('a new version is live and supersedes the previous one, which stays in history', async () => {
    reset({
      document_store: [{ id: 1, doc_uid: 'DOC-1', entity: 'export', linked_type: 'export_order', linked_id: 5, doc_type: 'bl', title: 'BL', version: 1, is_latest: true, status: 'Approved', file_name: 'a.pdf', file_path: '/x/a.pdf' }],
      document_checklists: [{ id: 2, linked_type: 'export_order', linked_id: 5, doc_type: 'bl', document_id: 1, is_fulfilled: true }],
    });
    const v2 = await docs.uploadNewVersion(db, { documentId: 1, file: null, uploadedBy: 8 });
    expect(v2).toMatchObject({ status: 'Approved', is_latest: true, version: 2, previous_version_id: 1 });
    const old = db.tables.document_store.find((d) => d.id === 1);
    expect(old).toMatchObject({ status: 'Superseded', is_latest: false });
    expect(db.tables.document_store).toHaveLength(2);
    expect(db.tables.document_checklists[0]).toMatchObject({ document_id: v2.id, is_fulfilled: true });
  });
});

// ─────────────────────────── E ───────────────────────────
describe('E. fund-transfer reversal', () => {
  const ft = require('../modules/finance/fundTransfers.service');

  function seedBooks() {
    reset({
      bank_accounts: [
        { id: 1, name: 'HO Bank', entity: 'general', currency: 'PKR', current_balance: 10000 },
        { id: 2, name: 'Mill Cash', entity: 'mill', currency: 'PKR', current_balance: 0 },
      ],
      chart_of_accounts: [{ id: 100, code: '1000', name: 'Cash' }, { id: 130, code: '1130', name: 'Inter-Company Receivable - Mill' }],
      bank_transactions: [], journal_entries: [], journal_lines: [], fund_transfers: [],
    });
  }
  const balances = () => db.tables.bank_accounts.map((a) => Number(a.current_balance));
  // Net (debit - credit) per account over POSTED journals — the trial balance view.
  function tb() {
    const posted = new Set(db.tables.journal_entries.filter((j) => j.status === 'Posted').map((j) => j.id));
    const out = {};
    for (const l of db.tables.journal_lines) {
      if (!posted.has(l.journal_id)) continue;
      out[l.account_id] = (out[l.account_id] || 0) + Number(l.debit) - Number(l.credit);
    }
    return out;
  }

  test('a completed transfer: delta journals mirror every original, bank undone, marked reversed', async () => {
    seedBooks();
    const t = await ft.create({ direction: 'ho_to_mill', from_account_id: 1, to_account_id: 2, amount: 2500 }, 1);
    await ft.accept(t.id, 2);
    expect(balances()).toEqual([7500, 2500]);
    const originals = db.tables.journal_entries.filter((j) => j.ref_type === 'Fund Transfer').map((j) => ({ ...j }));
    expect(originals).toHaveLength(2);

    const out = await ft.reverse(t.id, 1, { reason: 'wrong account' });

    expect(out.transfer.status).toBe('reversed');
    expect(db.tables.fund_transfers).toHaveLength(1); // kept, not deleted
    expect(balances()).toEqual([10000, 0]);

    const deltas = db.tables.journal_entries.filter((j) => j.ref_type === 'Fund Transfer Reversal');
    expect(deltas).toHaveLength(2);
    expect(deltas.every((d) => d.status === 'Posted' && d.ref_no === t.transfer_no)).toBe(true);
    // Each delta is the exact mirror of an original: same entity, debit<->credit swapped.
    originals.forEach((o, i) => {
      const d = deltas[i];
      expect(d.entity).toBe(o.entity);
      const ol = db.tables.journal_lines.filter((l) => l.journal_id === o.id);
      const dl = db.tables.journal_lines.filter((l) => l.journal_id === d.id);
      expect(dl.map((l) => [l.account_id, Number(l.debit), Number(l.credit)]))
        .toEqual(ol.map((l) => [l.account_id, Number(l.credit), Number(l.debit)]));
    });
    // Originals stay Posted (signed delta, not reverse+repost) and the TB nets to zero.
    expect(db.tables.journal_entries.filter((j) => j.ref_type === 'Fund Transfer').every((j) => j.status === 'Posted')).toBe(true);
    expect(Object.values(tb()).every((v) => Math.abs(v) < 1e-9)).toBe(true);

    // Offsetting bank rows: sender credited back, receiver debited.
    const rev = db.tables.bank_transactions.filter((b) => b.category === 'Fund Transfer Reversal');
    expect(rev.map((b) => [b.bank_account_id, b.type, b.amount])).toEqual([[1, 'credit', 2500], [2, 'debit', 2500]]);
    expect(rev.every((b) => /^BT-\d{4}$/.test(b.transaction_no) && b.reference === t.transfer_no && b.status === 'posted')).toBe(true);
    expect(db.tables.bank_transactions).toHaveLength(4); // nothing deleted
  });

  test('a pending transfer reverses only the sender side (it already moved)', async () => {
    seedBooks();
    const t = await ft.create({ direction: 'ho_to_mill', from_account_id: 1, to_account_id: 2, amount: 400 }, 1);
    expect(balances()).toEqual([9600, 0]);
    await ft.reverse(t.id, 1);
    expect(balances()).toEqual([10000, 0]);
    expect(db.tables.journal_entries.filter((j) => j.ref_type === 'Fund Transfer Reversal')).toHaveLength(1);
    expect(db.tables.bank_transactions.filter((b) => b.category === 'Fund Transfer Reversal').map((b) => [b.bank_account_id, b.type])).toEqual([[1, 'credit']]);
    expect(Object.values(tb()).every((v) => Math.abs(v) < 1e-9)).toBe(true);
  });

  test('a second reversal is refused with 409 and moves nothing', async () => {
    seedBooks();
    const t = await ft.create({ direction: 'mill_to_ho', from_account_id: 2, to_account_id: 1, amount: 0.5 }, 1);
    await ft.reverse(t.id, 1);
    const before = JSON.stringify(db.tables);
    const err = await ft.reverse(t.id, 1).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  test('accepting a reversed transfer is refused', async () => {
    seedBooks();
    const t = await ft.create({ direction: 'ho_to_mill', from_account_id: 1, to_account_id: 2, amount: 10 }, 1);
    await ft.reverse(t.id, 1);
    await expect(ft.accept(t.id, 2)).rejects.toThrow(/already reversed/);
  });
});

describe('E. migration 315 widens the fund_transfers status CHECK', () => {
  const mig = require('../../migrations/20261006_315_fund_transfer_reversed_status');
  const { fakeKnex } = require('./helpers/fakeKnex');

  test('up allows reversed; down restores {pending, completed}', async () => {
    const k = fakeKnex({ fund_transfers: [{ id: 1, status: 'completed' }] });
    k.raw = jest.fn(async () => {});
    await mig.up(k);
    const upSql = k.raw.mock.calls.map((c) => c[0]).join('\n');
    expect(upSql).toMatch(/DROP CONSTRAINT IF EXISTS "chk_fund_transfers_status_valid"/);
    expect(upSql).toMatch(/ADD CONSTRAINT "chk_fund_transfers_status_valid" CHECK .*'pending', 'completed', 'reversed'/);

    k.raw.mockClear();
    await mig.down(k);
    const downSql = k.raw.mock.calls.map((c) => c[0]).join('\n');
    expect(downSql).toMatch(/IN \('pending', 'completed'\)\)\)$/m);
    expect(downSql).not.toMatch(/reversed/);
  });

  test('down refuses while a reversed transfer exists', async () => {
    const k = fakeKnex({ fund_transfers: [{ id: 1, status: 'reversed' }] });
    k.raw = jest.fn(async () => {});
    await expect(mig.down(k)).rejects.toThrow(/1 fund transfer\(s\) are 'reversed'/);
    expect(k.raw).not.toHaveBeenCalled();
  });

  test("the service only writes values the CHECK allows", () => {
    expect(mig.NEW_VALUES).toEqual(['pending', 'completed', 'reversed']);
  });
});
