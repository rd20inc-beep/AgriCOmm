const path = require('path');
const fs = require('fs');
const db = require('../../config/database');

const { UPLOADS_ROOT: UPLOAD_DIR } = require('../../config/paths');
const auditService = require('../admin/audit.service');

// A document marked deleted: kept on disk and in the history, never removed.
const DELETED = 'Deleted';
// The only roles that may delete a document without a request.
const DOC_ADMIN_ROLES = ['Super Admin', 'Owner'];

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const documentService = {
  // === Document UID generator ===
  async generateDocUid(trx) {
    const today = new Date();
    const dateStr =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, '0') +
      String(today.getDate()).padStart(2, '0');

    const prefix = `DOC-${dateStr}-`;

    const last = await (trx || db)('document_store')
      .where('doc_uid', 'like', `${prefix}%`)
      .orderBy('doc_uid', 'desc')
      .select('doc_uid')
      .first();

    let seq = 1;
    if (last && last.doc_uid) {
      const parts = last.doc_uid.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        seq = lastSeq + 1;
      }
    }

    return `${prefix}${String(seq).padStart(4, '0')}`;
  },

  // === Upload & Store ===
  // Move one multer temp file into the reference's folder on the uploads volume.
  storeFile(file, targetDir) {
    if (!file) return { fileName: null, filePath: null, fileSize: null, mimeType: null };
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const fileName = file.originalname;
    const ext = path.extname(fileName || '');
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    const filePath = path.join(targetDir, uniqueName);
    fs.copyFileSync(file.path, filePath);
    fs.unlinkSync(file.path);
    return { fileName, filePath, fileSize: file.size, mimeType: file.mimetype };
  },

  // One upload ACTION = one version of a document type. It may carry several
  // files (a phytosanitary certificate scanned as three pages is three rows
  // sharing one version number), and it REPLACES whatever was live for that
  // type (owner decision 2026-10-07): the previous live file(s) are marked
  // Superseded / is_latest = false and stay in the version history, still
  // downloadable. Nothing is deleted.
  //
  // Returns every row written, in upload order.
  async uploadDocuments(trx, {
    entity, linkedType, linkedId, docType, title, description, file, files,
    uploadedBy, previousVersionId = null, inheritFrom = null,
  }) {
    const conn = trx || db;
    const list = [...(Array.isArray(files) ? files : []), ...(file ? [file] : [])];
    const linked = linkedId == null ? null : linkedId;

    const scope = { linked_type: linkedType, linked_id: linked, doc_type: docType };
    const siblings = await conn('document_store').where(scope);
    // Versions number the upload actions within a type. Deleted rows count too,
    // so a number is never reused.
    const version = siblings.reduce((m, d) => Math.max(m, Number(d.version) || 0), 0) + 1;
    const live = siblings.filter((d) => d.is_latest && d.status !== DELETED);
    const prevId = previousVersionId || (live[0] && live[0].id) || null;

    if (live.length) {
      await conn('document_store')
        .whereIn('id', live.map((d) => d.id))
        .update({ is_latest: false, status: 'Superseded', updated_at: conn.fn.now() });
    }

    const targetDir = path.join(UPLOAD_DIR, entity || 'general', linkedType, String(linkedId || 'misc'));
    const stored = list.length ? list.map((f) => this.storeFile(f, targetDir)) : [this.storeFile(null, targetDir)];
    const inherit = inheritFrom || {};

    const rows = [];
    for (const s of stored) {
      const docUid = await this.generateDocUid(conn);
      const [doc] = await conn('document_store')
        .insert({
          doc_uid: docUid,
          entity: entity || null,
          linked_type: linkedType,
          linked_id: linked,
          doc_type: docType,
          title,
          description: description || null,
          file_name: s.fileName || inherit.file_name || null,
          file_path: s.filePath || inherit.file_path || null,
          file_size: s.fileSize || inherit.file_size || null,
          mime_type: s.mimeType || inherit.mime_type || null,
          version,
          is_latest: true,
          previous_version_id: prevId,
          // Live at once, no Owner step (owner decision 2026-10-06).
          status: 'Approved',
          uploaded_by: uploadedBy,
        })
        .returning('*');
      rows.push(doc);
    }

    // The checklist points at the new version.
    await conn('document_checklists')
      .where(scope)
      .whereNot({ linked_id: 0 })
      .update({ document_id: rows[0].id, is_fulfilled: true, updated_at: conn.fn.now() });

    return rows;
  },

  // Single-file form, kept for existing callers: returns the first row.
  async uploadDocument(trx, args) {
    const rows = await this.uploadDocuments(trx, args);
    return rows[0];
  },
  async getDocument(docId) {
    const doc = await db('document_store as ds')
      .leftJoin('users as u', 'ds.uploaded_by', 'u.id')
      .select('ds.*', 'u.full_name as uploaded_by_name')
      .where('ds.id', docId)
      .first();

    if (!doc) return null;

    const approvals = await db('document_approvals as da')
      .leftJoin('users as u', 'da.approver_id', 'u.id')
      .select('da.*', 'u.full_name as approver_name')
      .where('da.document_id', docId)
      .orderBy('da.created_at', 'desc');

    return { ...doc, approvals };
  },

  // What is attached to a reference. By default only the live files
  // (is_latest); with includeHistory, every row — Superseded and Deleted ones
  // too — annotated with who replaced / deleted it and when, for the version
  // history.
  async getDocumentsByRef(linkedType, linkedId, { includeHistory = false } = {}) {
    let q = db('document_store as ds')
      .leftJoin('users as u', 'ds.uploaded_by', 'u.id')
      .leftJoin('users as p', 'ds.pending_by', 'p.id')
      .select('ds.*', 'u.full_name as uploaded_by_name', 'p.full_name as pending_by_name')
      .where({ 'ds.linked_type': linkedType, 'ds.linked_id': linkedId });
    if (!includeHistory) q = q.where({ 'ds.is_latest': true });
    const rows = await q.orderBy('ds.created_at', 'desc');
    return includeHistory ? this.annotateHistory(rows) : rows;
  },

  // Adds superseded_by_name / superseded_at (the uploader and time of the next
  // version of the same type) and deleted_by_name / deleted_at (from the
  // document_approvals 'delete' row) to each row.
  async annotateHistory(rows) {
    const deletedIds = rows.filter((r) => r.status === DELETED).map((r) => r.id);
    const delRows = deletedIds.length
      ? await db('document_approvals as da')
        .leftJoin('users as u', 'da.approver_id', 'u.id')
        .select('da.document_id', 'da.approver_id', 'da.created_at', 'u.full_name as approver_name')
        .whereIn('da.document_id', deletedIds)
        .where({ 'da.action': 'delete' })
      : [];
    const delBy = new Map(delRows.map((d) => [Number(d.document_id), d]));
    return rows.map((r) => {
      const out = { ...r };
      if (r.status === 'Superseded') {
        const next = rows
          .filter((o) => o.doc_type === r.doc_type && (Number(o.version) || 0) > (Number(r.version) || 0))
          .sort((a, b) => (Number(a.version) || 0) - (Number(b.version) || 0))[0];
        if (next) {
          out.superseded_by_name = next.uploaded_by_name || null;
          out.superseded_at = next.created_at || null;
        }
      }
      if (r.status === DELETED) {
        const d = delBy.get(Number(r.id));
        if (d) {
          out.deleted_by = d.approver_id;
          out.deleted_by_name = d.approver_name || null;
          out.deleted_at = d.created_at || null;
        }
      }
      return out;
    });
  },

  // Owner / Super Admin are the only roles that may delete a document outright
  // (and the only ones holding documents.approve since migration 297).
  async isDocumentAdmin(user, trx) {
    if (!user) return false;
    const conn = trx || db;
    let roleId = user.role_id;
    if (!roleId) {
      const u = await conn('users').where({ id: user.id }).first();
      roleId = u && u.role_id;
    }
    if (!roleId) return false;
    const role = await conn('roles').where({ id: roleId }).first();
    return !!role && DOC_ADMIN_ROLES.includes(role.name);
  },

  // Ask for a document to be deleted. Nothing is removed — the file stays
  // downloadable and current until an Owner/Super Admin approves.
  async requestDelete(trx, { documentId, userId }) {
    const conn = trx || db;
    const doc = await conn('document_store').where({ id: documentId }).first();
    if (!doc) throw new Error('Document not found');
    if (doc.status === DELETED) throw new Error('Document is already deleted');
    if (doc.pending_action === 'delete') return doc;
    await conn('document_store').where({ id: documentId }).update({
      pending_action: 'delete', pending_by: userId || null, pending_at: conn.fn.now(), updated_at: conn.fn.now(),
    });
    await auditService.log({
      userId: userId || null,
      action: 'request_delete',
      entityType: 'document',
      entityId: documentId,
      details: { doc_type: doc.doc_type, file_name: doc.file_name, linked_type: doc.linked_type, linked_id: doc.linked_id },
      db_instance: conn,
    });
    return conn('document_store').where({ id: documentId }).first();
  },

  // Withdraw a deletion request (the requester changed their mind), or an
  // approver refused it (rejectedBy set: recorded in document_approvals).
  async cancelDelete(trx, { documentId, rejectedBy = null, comments = null }) {
    const conn = trx || db;
    await conn('document_store').where({ id: documentId }).update({
      pending_action: null, pending_by: null, pending_at: null, updated_at: conn.fn.now(),
    });
    if (rejectedBy) {
      await conn('document_approvals').insert({
        document_id: documentId, approver_id: rejectedBy, action: 'reject_delete', comments: comments || null,
      });
    }
    return conn('document_store').where({ id: documentId }).first();
  },

  // A deletion takes effect — an approved request, or an Owner/Super Admin
  // deleting directly. NOTHING is removed: the row is marked Deleted and drops
  // out of the live list (is_latest = false); the file stays on disk and in the
  // version history. Who/when goes to document_approvals (action 'delete') and
  // audit_logs.
  async applyDelete(trx, { documentId, userId, direct = false }) {
    const conn = trx || db;
    const doc = await conn('document_store').where({ id: documentId }).first();
    if (!doc) throw new Error('Document not found');
    if (doc.status === DELETED) return { deleted: true, id: documentId, already: true, file_kept: true };

    const requestedBy = doc.pending_action === 'delete' ? doc.pending_by : null;
    await conn('document_store').where({ id: documentId }).update({
      status: DELETED,
      is_latest: false,
      pending_action: null,
      pending_by: null,
      pending_at: null,
      updated_at: conn.fn.now(),
    });
    const comments = direct
      ? 'Deleted directly by Owner/Super Admin'
      : `Deletion approved${requestedBy ? ` (requested by user #${requestedBy})` : ''}`;
    await conn('document_approvals').insert({
      document_id: documentId, approver_id: userId || null, action: 'delete', comments,
    });
    await auditService.log({
      userId: userId || null,
      action: direct ? 'delete_direct' : 'approve_delete',
      entityType: 'document',
      entityId: documentId,
      details: {
        doc_type: doc.doc_type,
        file_name: doc.file_name,
        file_path: doc.file_path,
        linked_type: doc.linked_type,
        linked_id: doc.linked_id,
        version: doc.version,
        requested_by: requestedBy,
        file_kept: true,
      },
      db_instance: conn,
    });

    // The checklist follows whatever is still live for the type, if anything.
    const sameType = await conn('document_store')
      .where({ linked_type: doc.linked_type, linked_id: doc.linked_id, doc_type: doc.doc_type, is_latest: true });
    const stillLive = sameType.find((d) => d.status !== DELETED && Number(d.id) !== Number(documentId));
    await conn('document_checklists').where({ document_id: documentId }).update(
      stillLive ? { document_id: stillLive.id } : { document_id: null, is_fulfilled: false },
    );
    return { deleted: true, id: documentId, file_kept: true };
  },

  // === Version Control ===
  // "Upload new version" of a specific document: the same replace as a plain
  // re-upload of its type, recording which file it replaced.
  async uploadNewVersion(trx, { documentId, file, files, uploadedBy }) {
    const conn = trx || db;
    const existing = await conn('document_store').where({ id: documentId }).first();
    if (!existing) throw new Error('Document not found');
    const rows = await this.uploadDocuments(conn, {
      entity: existing.entity,
      linkedType: existing.linked_type,
      linkedId: existing.linked_id,
      docType: existing.doc_type,
      title: existing.title,
      description: existing.description,
      file,
      files,
      uploadedBy,
      previousVersionId: documentId,
      inheritFrom: existing,
    });
    return rows[0];
  },

  async getVersionHistory(documentId) {
    const startDoc = await db('document_store').where({ id: documentId }).first();
    if (!startDoc) return [];
    // Every version of the same linked_type + linked_id + doc_type.
    const rows = await db('document_store as ds')
      .leftJoin('users as u', 'ds.uploaded_by', 'u.id')
      .select('ds.*', 'u.full_name as uploaded_by_name')
      .where({
        'ds.linked_type': startDoc.linked_type,
        'ds.linked_id': startDoc.linked_id,
        'ds.doc_type': startDoc.doc_type,
      })
      .orderBy('ds.version', 'desc');
    return this.annotateHistory(rows);
  },
  // === Approval Workflow ===
  async submitForReview(trx, { documentId, userId }) {
    const conn = trx || db;

    const doc = await conn('document_store').where({ id: documentId }).first();
    if (!doc) throw new Error('Document not found');
    if (doc.status !== 'Draft') {
      throw new Error(`Cannot submit for review: document is in '${doc.status}' status, expected 'Draft'`);
    }

    await conn('document_store')
      .where({ id: documentId })
      .update({ status: 'Pending Review', updated_at: conn.fn.now() });

    return conn('document_store').where({ id: documentId }).first();
  },

  async approveDocument(trx, { documentId, approverId, comments }) {
    const conn = trx || db;

    const doc = await conn('document_store').where({ id: documentId }).first();
    if (!doc) throw new Error('Document not found');
    // Draft included: files uploaded before the approval rule existed are Draft,
    // and an approver must be able to make one live without an artificial
    // "submit for review" step in between.
    if (!['Draft', 'Pending Review', 'Under Review'].includes(doc.status)) {
      throw new Error(`Cannot approve: document is in '${doc.status}' status`);
    }

    // Insert approval record
    await conn('document_approvals').insert({
      document_id: documentId,
      approver_id: approverId,
      action: 'approve',
      comments: comments || null,
    });

    // Change status to Approved
    await conn('document_store')
      .where({ id: documentId })
      .update({ status: 'Approved', updated_at: conn.fn.now() });

    // Update checklist if linked
    if (doc.linked_type && doc.linked_id) {
      await conn('document_checklists')
        .where({
          linked_type: doc.linked_type,
          linked_id: doc.linked_id,
          doc_type: doc.doc_type,
        })
        .whereNot({ linked_id: 0 })
        .update({ is_fulfilled: true, document_id: documentId, updated_at: conn.fn.now() });

      // Check if all required docs are now approved
      const missing = await this.checkMissingDocsWithConn(conn, doc.linked_type, doc.linked_id);
      if (missing.length === 0) {
        console.log(`[DocumentService] All required documents approved for ${doc.linked_type} #${doc.linked_id}`);
      }
    }

    return conn('document_store').where({ id: documentId }).first();
  },

  async rejectDocument(trx, { documentId, approverId, comments }) {
    const conn = trx || db;

    const doc = await conn('document_store').where({ id: documentId }).first();
    if (!doc) throw new Error('Document not found');

    await conn('document_approvals').insert({
      document_id: documentId,
      approver_id: approverId,
      action: 'reject',
      comments: comments || null,
    });

    await conn('document_store')
      .where({ id: documentId })
      .update({ status: 'Rejected', updated_at: conn.fn.now() });

    return conn('document_store').where({ id: documentId }).first();
  },

  async requestRevision(trx, { documentId, approverId, comments }) {
    const conn = trx || db;

    const doc = await conn('document_store').where({ id: documentId }).first();
    if (!doc) throw new Error('Document not found');

    await conn('document_approvals').insert({
      document_id: documentId,
      approver_id: approverId,
      action: 'request_revision',
      comments: comments || null,
    });

    // Back to Draft for rework
    await conn('document_store')
      .where({ id: documentId })
      .update({ status: 'Draft', updated_at: conn.fn.now() });

    return conn('document_store').where({ id: documentId }).first();
  },

  async finalizeDocument(trx, { documentId, userId }) {
    const conn = trx || db;

    const doc = await conn('document_store').where({ id: documentId }).first();
    if (!doc) throw new Error('Document not found');
    if (doc.status !== 'Approved') {
      throw new Error(`Cannot finalize: document is in '${doc.status}' status, expected 'Approved'`);
    }

    await conn('document_store')
      .where({ id: documentId })
      .update({ status: 'Final', updated_at: conn.fn.now() });

    return conn('document_store').where({ id: documentId }).first();
  },

  // === Checklist Management ===
  async createChecklist(trx, { linkedType, linkedId, items }) {
    const conn = trx || db;

    const rows = items.map((item) => ({
      linked_type: linkedType,
      linked_id: linkedId,
      doc_type: item.doc_type,
      is_required: item.is_required !== undefined ? item.is_required : true,
      is_fulfilled: false,
      due_date: item.due_date || null,
      notes: item.notes || null,
    }));

    const inserted = await conn('document_checklists').insert(rows).returning('*');
    return inserted;
  },

  async getChecklist(linkedType, linkedId) {
    return db('document_checklists as dc')
      .leftJoin('document_store as ds', 'dc.document_id', 'ds.id')
      .select(
        'dc.*',
        'ds.doc_uid',
        'ds.title as document_title',
        'ds.status as document_status',
        'ds.file_name',
        'ds.version'
      )
      .where({ 'dc.linked_type': linkedType, 'dc.linked_id': linkedId })
      .orderBy('dc.id', 'asc');
  },

  async checkMissingDocs(linkedType, linkedId) {
    return this.checkMissingDocsWithConn(db, linkedType, linkedId);
  },

  async checkMissingDocsWithConn(conn, linkedType, linkedId) {
    // Return required but unfulfilled docs, or fulfilled but not approved
    const checklist = await conn('document_checklists as dc')
      .leftJoin('document_store as ds', 'dc.document_id', 'ds.id')
      .select('dc.*', 'ds.status as document_status', 'ds.doc_uid', 'ds.title as document_title')
      .where({ 'dc.linked_type': linkedType, 'dc.linked_id': linkedId, 'dc.is_required': true });

    return checklist.filter((item) => {
      if (!item.is_fulfilled) return true;
      if (item.document_status && !['Approved', 'Final'].includes(item.document_status)) return true;
      return false;
    });
  },

  async isDocumentationComplete(linkedType, linkedId) {
    const missing = await this.checkMissingDocs(linkedType, linkedId);
    return missing.length === 0;
  },

  // === Dispatch Log ===
  async dispatchDocument(trx, { documentId, dispatchedTo, method, trackingRef, notes, dispatchedBy }) {
    const conn = trx || db;

    const [entry] = await conn('document_dispatch_log')
      .insert({
        document_id: documentId,
        dispatched_to: dispatchedTo,
        dispatch_method: method,
        dispatch_date: conn.fn.now(),
        tracking_ref: trackingRef || null,
        status: 'Sent',
        notes: notes || null,
        dispatched_by: dispatchedBy,
      })
      .returning('*');

    return entry;
  },

  async getDispatchHistory(documentId) {
    return db('document_dispatch_log as ddl')
      .leftJoin('users as u', 'ddl.dispatched_by', 'u.id')
      .select('ddl.*', 'u.full_name as dispatched_by_name')
      .where('ddl.document_id', documentId)
      .orderBy('ddl.dispatch_date', 'desc');
  },

  // === PDF Generation (simplified) ===
  async generatePDF(trx, { docType, linkedType, linkedId, userId }) {
    const conn = trx || db;

    // Load template
    const template = await conn('document_templates')
      .where({ doc_type: docType, is_active: true })
      .first();

    let htmlContent = '';
    let title = '';

    if (docType === 'proforma_invoice' || docType === 'commercial_invoice') {
      const order = await conn('export_orders as eo')
        .leftJoin('customers as c', 'eo.customer_id', 'c.id')
        .leftJoin('products as p', 'eo.product_id', 'p.id')
        .select('eo.*', 'c.name as customer_name', 'c.country as customer_country', 'p.name as product_name')
        .where('eo.id', linkedId)
        .first();

      if (!order) throw new Error('Export order not found');

      const invoiceType = docType === 'proforma_invoice' ? 'Proforma Invoice' : 'Commercial Invoice';
      title = `${invoiceType} - ${order.order_no}`;

      htmlContent = `
<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
  <h1>${invoiceType}</h1>
  <p><strong>Order:</strong> ${order.order_no}</p>
  <p><strong>Customer:</strong> ${order.customer_name}</p>
  <p><strong>Country:</strong> ${order.customer_country || order.country}</p>
  <p><strong>Product:</strong> ${order.product_name}</p>
  <p><strong>Quantity:</strong> ${order.qty_mt} MT</p>
  <p><strong>Price/MT:</strong> ${order.currency} ${order.price_per_mt}</p>
  <p><strong>Total Value:</strong> ${order.currency} ${order.contract_value || order.total_value}</p>
  <p><strong>Incoterm:</strong> ${order.incoterm || 'N/A'}</p>
  <p><strong>Destination:</strong> ${order.destination_port || 'N/A'}</p>
  <p><strong>Date:</strong> ${new Date().toISOString().split('T')[0]}</p>
</body>
</html>`;
    } else if (docType === 'packing_list') {
      const order = await conn('export_orders as eo')
        .leftJoin('customers as c', 'eo.customer_id', 'c.id')
        .leftJoin('products as p', 'eo.product_id', 'p.id')
        .select('eo.*', 'c.name as customer_name', 'p.name as product_name')
        .where('eo.id', linkedId)
        .first();

      if (!order) throw new Error('Export order not found');

      title = `Packing List - ${order.order_no}`;
      const bags = Math.ceil(parseFloat(order.qty_mt) * 20); // assume 50kg bags

      htmlContent = `
<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
  <h1>Packing List</h1>
  <p><strong>Order:</strong> ${order.order_no}</p>
  <p><strong>Customer:</strong> ${order.customer_name}</p>
  <p><strong>Product:</strong> ${order.product_name}</p>
  <p><strong>Quantity:</strong> ${order.qty_mt} MT</p>
  <p><strong>No. of Bags (50kg):</strong> ${bags}</p>
  <p><strong>Gross Weight:</strong> ${order.qty_mt} MT</p>
  <p><strong>Vessel:</strong> ${order.vessel_name || 'TBD'}</p>
  <p><strong>Booking No:</strong> ${order.booking_no || 'TBD'}</p>
  <p><strong>Date:</strong> ${new Date().toISOString().split('T')[0]}</p>
</body>
</html>`;
    } else if (docType === 'costing_sheet') {
      const order = await conn('export_orders as eo')
        .leftJoin('customers as c', 'eo.customer_id', 'c.id')
        .select('eo.*', 'c.name as customer_name')
        .where('eo.id', linkedId)
        .first();

      if (!order) throw new Error('Export order not found');

      const costs = await conn('export_order_costs').where({ order_id: linkedId });

      title = `Costing Sheet - ${order.order_no}`;
      const costLines = costs.map((c) => `<tr><td>${c.category}</td><td>${c.amount}</td></tr>`).join('\n');

      htmlContent = `
<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
  <h1>Costing Sheet</h1>
  <p><strong>Order:</strong> ${order.order_no}</p>
  <p><strong>Customer:</strong> ${order.customer_name}</p>
  <p><strong>Contract Value:</strong> ${order.currency} ${order.contract_value || order.total_value}</p>
  <table border="1">
    <tr><th>Category</th><th>Amount</th></tr>
    ${costLines}
  </table>
  <p><strong>Date:</strong> ${new Date().toISOString().split('T')[0]}</p>
</body>
</html>`;
    } else {
      title = `${docType} - ${linkedType} #${linkedId}`;
      htmlContent = `
<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
  <h1>${docType.replace(/_/g, ' ').toUpperCase()}</h1>
  <p><strong>Reference:</strong> ${linkedType} #${linkedId}</p>
  <p><strong>Generated:</strong> ${new Date().toISOString().split('T')[0]}</p>
  <p>Document content to be filled.</p>
</body>
</html>`;
    }

    // Save HTML to uploads directory
    const entity = linkedType === 'milling_batch' ? 'mill' : 'export';
    const targetDir = path.join(UPLOAD_DIR, entity, linkedType, String(linkedId));
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileName = `${docType}-${linkedId}-${Date.now()}.html`;
    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, htmlContent);

    const fileSize = Buffer.byteLength(htmlContent, 'utf8');

    // Create document_store record
    const docUid = await this.generateDocUid(conn);

    // Check for previous version
    let version = 1;
    let previousVersionId = null;
    const existingDoc = await conn('document_store')
      .where({ linked_type: linkedType, linked_id: linkedId, doc_type: docType, is_latest: true })
      .first();

    if (existingDoc) {
      await conn('document_store')
        .where({ id: existingDoc.id })
        .update({ is_latest: false, status: 'Superseded', updated_at: conn.fn.now() });
      version = existingDoc.version + 1;
      previousVersionId = existingDoc.id;
    }

    const [doc] = await conn('document_store')
      .insert({
        doc_uid: docUid,
        entity,
        linked_type: linkedType,
        linked_id: linkedId,
        doc_type: docType,
        title,
        description: `Auto-generated ${docType.replace(/_/g, ' ')}`,
        file_name: fileName,
        file_path: filePath,
        file_size: fileSize,
        mime_type: 'text/html',
        version,
        is_latest: true,
        previous_version_id: previousVersionId,
        status: 'Draft',
        uploaded_by: userId,
      })
      .returning('*');

    // Update checklist
    await conn('document_checklists')
      .where({ linked_type: linkedType, linked_id: linkedId, doc_type: docType })
      .whereNot({ linked_id: 0 })
      .update({ document_id: doc.id, is_fulfilled: true, updated_at: conn.fn.now() });

    return doc;
  },

  // === Queries ===
  async searchDocuments({ entity, docType, status, search, linkedType, page = 1, limit = 20 }) {
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('document_store as ds')
      .leftJoin('users as u', 'ds.uploaded_by', 'u.id')
      .select('ds.*', 'u.full_name as uploaded_by_name')
      .where('ds.is_latest', true);

    if (entity) {
      query = query.where('ds.entity', entity);
    }
    if (docType) {
      query = query.where('ds.doc_type', docType);
    }
    if (status) {
      query = query.where('ds.status', status);
    }
    if (linkedType) {
      query = query.where('ds.linked_type', linkedType);
    }
    if (search) {
      query = query.where(function () {
        this.whereILike('ds.title', `%${search}%`)
          .orWhereILike('ds.doc_uid', `%${search}%`)
          .orWhereILike('ds.file_name', `%${search}%`);
      });
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('ds.id as total').first();

    const [documents, countResult] = await Promise.all([
      query.orderBy('ds.created_at', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return {
      documents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  },

  async getDocumentStats() {
    const [totalResult] = await db('document_store').where('is_latest', true).count('id as count');
    const [pendingResult] = await db('document_store').where({ is_latest: true, status: 'Pending Review' }).count('id as count');
    const [approvedResult] = await db('document_store').where({ is_latest: true, status: 'Approved' }).count('id as count');
    const [rejectedResult] = await db('document_store').where({ is_latest: true, status: 'Rejected' }).count('id as count');
    const [draftResult] = await db('document_store').where({ is_latest: true, status: 'Draft' }).count('id as count');
    const [finalResult] = await db('document_store').where({ is_latest: true, status: 'Final' }).count('id as count');

    return {
      total: parseInt(totalResult.count),
      draft: parseInt(draftResult.count),
      pending_review: parseInt(pendingResult.count),
      approved: parseInt(approvedResult.count),
      rejected: parseInt(rejectedResult.count),
      final: parseInt(finalResult.count),
    };
  },

  async getExpiringDocuments(daysAhead = 30) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return db('document_checklists as dc')
      .leftJoin('document_store as ds', 'dc.document_id', 'ds.id')
      .select('dc.*', 'ds.doc_uid', 'ds.title as document_title', 'ds.status as document_status')
      .where('dc.is_required', true)
      .where('dc.is_fulfilled', false)
      .whereNotNull('dc.due_date')
      .where('dc.due_date', '<=', futureDate.toISOString().split('T')[0])
      .whereNot('dc.linked_id', 0)
      .orderBy('dc.due_date', 'asc');
  },
};

module.exports = documentService;
