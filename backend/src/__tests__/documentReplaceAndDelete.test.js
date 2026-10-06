/**
 * Document replace + delete-by-approval (owner decision 2026-10-07):
 *
 *  - A re-upload of a document type REPLACES its live file(s): they become
 *    Superseded (is_latest = false), stay in the table and on disk, and show
 *    in the version history with who replaced them.
 *  - Several files in ONE upload are ONE version (a multi-page scan).
 *  - Nothing is deleted without an Owner / Super Admin: anyone else's delete
 *    becomes a request (file untouched); approving it marks the row Deleted —
 *    the file stays on disk — with a document_approvals + audit_logs record.
 *    An Owner / Super Admin deleting directly is allowed and audited the same.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(os.tmpdir(), `doc-replace-delete-${process.pid}`);
process.env.UPLOADS_DIR = ROOT;

jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex());

const db = require('../config/database');
const docs = require('../modules/documents/documents.service');
const ctrl = require('../modules/documents/documents.controller');

const OWNER = { id: 1, role_id: 9 };
const SUPER = { id: 2, role_id: 1 };
const CLERK = { id: 7, role_id: 4 };

function reset(tables) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  const base = {
    roles: [{ id: 1, name: 'Super Admin' }, { id: 9, name: 'Owner' }, { id: 4, name: 'Export Manager' }],
    users: [],
    document_store: [],
    document_checklists: [],
    document_approvals: [],
    audit_logs: [],
  };
  for (const [k, rows] of Object.entries({ ...base, ...tables })) db.tables[k] = rows.map((r) => ({ ...r }));
}

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

// A multer-style temp file with real bytes on disk.
let tmpSeq = 0;
function tempFile(name, body = 'page') {
  const dir = path.join(ROOT, 'temp');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `t-${process.pid}-${tmpSeq++}`);
  fs.writeFileSync(p, body);
  return { originalname: name, path: p, size: Buffer.byteLength(body), mimetype: 'application/pdf' };
}

// A live, file-backed document row.
function liveDoc(id, extra = {}) {
  const dir = path.join(ROOT, 'export', 'export_order', '5');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `seed-${id}.pdf`);
  fs.writeFileSync(filePath, `seed ${id}`);
  return {
    id, doc_uid: `DOC-SEED-${id}`, entity: 'export', linked_type: 'export_order', linked_id: 5,
    doc_type: 'phyto', title: 'Phyto', file_name: `seed-${id}.pdf`, file_path: filePath,
    version: 1, is_latest: true, status: 'Approved', uploaded_by: 3, ...extra,
  };
}

const row = (id) => db.tables.document_store.find((d) => Number(d.id) === Number(id));

afterAll(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) { /* ignore */ } });

describe('re-upload replaces the live file', () => {
  test('a plain re-upload of the same type supersedes the previous file, which is kept', async () => {
    reset({
      document_store: [liveDoc(1)],
      document_checklists: [{ id: 2, linked_type: 'export_order', linked_id: 5, doc_type: 'phyto', document_id: 1, is_fulfilled: true }],
    });
    const before = row(1).file_path;

    const r = res();
    await ctrl.upload({
      body: { entity: 'export', linked_type: 'export_order', linked_id: '5', doc_type: 'phyto', title: 'Phyto' },
      files: { files: [tempFile('phyto-v2.pdf')] },
      user: { id: 8 },
    }, r);

    expect(r.statusCode).toBe(201);
    const fresh = r.body.data.document;
    expect(fresh).toMatchObject({ status: 'Approved', is_latest: true, version: 2, previous_version_id: 1, file_name: 'phyto-v2.pdf' });
    expect(fs.existsSync(fresh.file_path)).toBe(true);

    // The previous file is Superseded, not deleted — row and file both remain.
    expect(row(1)).toMatchObject({ status: 'Superseded', is_latest: false });
    expect(fs.existsSync(before)).toBe(true);
    expect(db.tables.document_store).toHaveLength(2);
    expect(db.tables.document_checklists[0]).toMatchObject({ document_id: fresh.id, is_fulfilled: true });

    // Live list shows only the new one; the history shows the old one + who replaced it.
    const live = await docs.getDocumentsByRef('export_order', 5);
    expect(live.map((d) => d.id)).toEqual([fresh.id]);
    const history = await docs.getDocumentsByRef('export_order', 5, { includeHistory: true });
    const old = history.find((d) => d.id === 1);
    expect(old.status).toBe('Superseded');
    expect('superseded_at' in old).toBe(true);
  });

  test('several files in one upload are ONE version, and all of them are live', async () => {
    reset({ document_store: [liveDoc(1), liveDoc(2, { file_name: 'seed-2.pdf' })] });

    const rows = await docs.uploadDocuments(db, {
      entity: 'export', linkedType: 'export_order', linkedId: 5, docType: 'phyto', title: 'Phyto',
      files: [tempFile('p1.jpg'), tempFile('p2.jpg'), tempFile('p3.jpg')], uploadedBy: 8,
    });

    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((d) => d.version))).toEqual(new Set([2]));
    expect(rows.map((d) => d.file_name)).toEqual(['p1.jpg', 'p2.jpg', 'p3.jpg']);
    rows.forEach((d) => {
      expect(d).toMatchObject({ is_latest: true, status: 'Approved' });
      expect(fs.existsSync(d.file_path)).toBe(true);
    });
    // Both files of the previous version were replaced together.
    expect(row(1)).toMatchObject({ status: 'Superseded', is_latest: false });
    expect(row(2)).toMatchObject({ status: 'Superseded', is_latest: false });

    const live = await docs.getDocumentsByRef('export_order', 5);
    expect(live.map((d) => d.file_name).sort()).toEqual(['p1.jpg', 'p2.jpg', 'p3.jpg']);
  });

  test('the controller takes the old single `file` field and the new `files` field together', async () => {
    reset({});
    const r = res();
    await ctrl.upload({
      body: { linked_type: 'export_order', linked_id: '5', doc_type: 'bl', title: 'BL' },
      files: { file: [tempFile('a.pdf')], files: [tempFile('b.pdf')] },
      user: { id: 8 },
    }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body.data.documents.map((d) => d.file_name)).toEqual(['b.pdf', 'a.pdf']);
    expect(new Set(r.body.data.documents.map((d) => d.version))).toEqual(new Set([1]));
  });

  test('a Deleted row is not revived by a re-upload, and its version number is not reused', async () => {
    reset({ document_store: [liveDoc(1, { status: 'Deleted', is_latest: false, version: 3 })] });
    const [fresh] = await docs.uploadDocuments(db, {
      entity: 'export', linkedType: 'export_order', linkedId: 5, docType: 'phyto', title: 'Phyto',
      files: [tempFile('new.pdf')], uploadedBy: 8,
    });
    expect(fresh.version).toBe(4);
    expect(row(1)).toMatchObject({ status: 'Deleted', is_latest: false });
  });
});

describe('nothing is deleted without an Owner / Super Admin', () => {
  test('a non-owner delete becomes a request — the file and row are untouched', async () => {
    reset({ document_store: [liveDoc(1)] });
    const r = res();
    await ctrl.remove({ params: { id: '1' }, user: { ...CLERK } }, r);

    expect(r.statusCode).toBe(202);
    expect(r.body.data.requested).toBe(true);
    expect(row(1)).toMatchObject({ status: 'Approved', is_latest: true, pending_action: 'delete', pending_by: 7 });
    expect(fs.existsSync(row(1).file_path)).toBe(true);
    expect(db.tables.document_approvals).toHaveLength(0);
    expect(db.tables.audit_logs).toEqual([expect.objectContaining({ user_id: 7, action: 'request_delete', entity_type: 'document', entity_id: '1' })]);
  });

  test('owner approves the request — marked Deleted, file kept on disk, approval + audit rows', async () => {
    reset({
      document_store: [liveDoc(1, { pending_action: 'delete', pending_by: 7, pending_at: 'then' })],
      document_checklists: [{ id: 3, linked_type: 'export_order', linked_id: 5, doc_type: 'phyto', document_id: 1, is_fulfilled: true }],
    });
    const r = res();
    await ctrl.approve({ params: { id: '1' }, body: {}, user: { ...OWNER } }, r);

    expect(r.statusCode).toBe(200);
    expect(r.body.data).toMatchObject({ deleted: true, file_kept: true });
    expect(row(1)).toMatchObject({ status: 'Deleted', is_latest: false, pending_action: null });
    expect(fs.existsSync(row(1).file_path)).toBe(true);
    expect(db.tables.document_approvals).toEqual([expect.objectContaining({ document_id: 1, approver_id: 1, action: 'delete' })]);
    expect(db.tables.audit_logs).toEqual([expect.objectContaining({ user_id: 1, action: 'approve_delete', entity_id: '1' })]);
    expect(JSON.parse(db.tables.audit_logs[0].details)).toMatchObject({ requested_by: 7, file_kept: true });
    expect(db.tables.document_checklists[0]).toMatchObject({ document_id: null, is_fulfilled: false });

    // Gone from the live list, still in the history with who deleted it.
    expect(await docs.getDocumentsByRef('export_order', 5)).toEqual([]);
    const [h] = await docs.getDocumentsByRef('export_order', 5, { includeHistory: true });
    expect(h).toMatchObject({ id: 1, status: 'Deleted', deleted_by: 1 });
  });

  test.each([['Owner', OWNER], ['Super Admin', SUPER]])('%s deletes directly — audited, file kept', async (_, user) => {
    reset({ document_store: [liveDoc(1), liveDoc(2)] });
    const r = res();
    await ctrl.remove({ params: { id: '1' }, user: { ...user } }, r);

    expect(r.statusCode).toBe(200);
    expect(r.body.data).toMatchObject({ deleted: true, requested: false, file_kept: true });
    expect(row(1)).toMatchObject({ status: 'Deleted', is_latest: false });
    expect(fs.existsSync(row(1).file_path)).toBe(true);
    expect(row(2)).toMatchObject({ status: 'Approved', is_latest: true });
    expect(db.tables.document_approvals).toEqual([expect.objectContaining({ document_id: 1, approver_id: user.id, action: 'delete' })]);
    expect(db.tables.audit_logs).toEqual([expect.objectContaining({ user_id: user.id, action: 'delete_direct', entity_id: '1' })]);
  });

  test('an owner refusing a request clears it and records the refusal', async () => {
    reset({ document_store: [liveDoc(1, { pending_action: 'delete', pending_by: 7 })] });
    const r = res();
    await ctrl.cancelDelete({ params: { id: '1' }, body: {}, user: { ...OWNER } }, r);
    expect(r.body.success).toBe(true);
    expect(row(1)).toMatchObject({ status: 'Approved', is_latest: true, pending_action: null });
    expect(db.tables.document_approvals).toEqual([expect.objectContaining({ approver_id: 1, action: 'reject_delete' })]);
  });

  test('the requester withdrawing their own request is not recorded as a refusal', async () => {
    reset({ document_store: [liveDoc(1, { pending_action: 'delete', pending_by: 7 })] });
    const r = res();
    await ctrl.cancelDelete({ params: { id: '1' }, body: {}, user: { ...CLERK } }, r);
    expect(row(1).pending_action).toBeNull();
    expect(db.tables.document_approvals).toHaveLength(0);
  });

  test('the service never removes a file from disk', () => {
    const src = fs.readFileSync(require.resolve('../modules/documents/documents.service'), 'utf8');
    // The only unlink left is the multer TEMP file after it is copied in.
    const unlinks = src.match(/unlinkSync\(([^)]*)\)/g) || [];
    expect(unlinks).toEqual(['unlinkSync(file.path)']);
    expect(src).not.toMatch(/document_store'\)[^;]*\.del\(/);
  });
});

describe('routes and migration', () => {
  const router = require('../modules/documents/documents.routes');
  const layer = (method, p) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);

  test('DELETE /:id exists and goes to the gated controller', () => {
    const l = layer('delete', '/:id');
    expect(l).toBeTruthy();
    expect(l.route.stack[l.route.stack.length - 1].handle).toBe(ctrl.remove);
  });

  test('migration 316 admits Deleted and keeps every earlier status', () => {
    const m = require('../../migrations/20261007_316_document_store_deleted_status');
    expect(m.NEW_VALUES).toEqual(expect.arrayContaining(['Draft', 'Pending Review', 'Approved', 'Final', 'Rejected', 'Superseded', 'Deleted']));
    expect(m.checkSql(m.NEW_VALUES)).toContain("'Deleted'");
    expect(m.checkSql(m.NEW_VALUES)).toContain('chk_document_store_status_valid');
  });
});
