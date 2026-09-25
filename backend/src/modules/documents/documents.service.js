const path = require('path');
const fs = require('fs');
const db = require('../../config/database');

const { UPLOADS_ROOT: UPLOAD_DIR } = require('../../config/paths');

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
  async uploadDocument(trx, { entity, linkedType, linkedId, docType, title, description, file, uploadedBy }) {
    const conn = trx || db;

    // Build target directory
    const targetDir = path.join(UPLOAD_DIR, entity || 'general', linkedType, String(linkedId || 'misc'));
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let fileName = null;
    let filePath = null;
    let fileSize = null;
    let mimeType = null;

    if (file) {
      fileName = file.originalname;
      const ext = path.extname(fileName);
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      filePath = path.join(targetDir, uniqueName);
      fileSize = file.size;
      mimeType = file.mimetype;

      // Move file from multer temp to target
      fs.copyFileSync(file.path, filePath);
      fs.unlinkSync(file.path);
    }

    // A plain upload ADDS a file; it does not replace one. This used to
    // supersede any existing file of the same type, which meant a document type
    // could only ever hold one file — a phytosanitary certificate scanned as
    // three pages lost the first two, and getDocumentsByRef (is_latest only)
    // would never show them again. Replacing a file is the explicit
    // "new version" action (uploadNewVersion), which still supersedes.
    //
    // version numbers the files within a type so the order is still legible.
    const siblingCount = await conn('document_store')
      .where({ linked_type: linkedType, linked_id: linkedId, doc_type: docType })
      .count('id as n')
      .first();
    const existingCount = parseInt(siblingCount && siblingCount.n, 10) || 0;
    const version = existingCount + 1;
    const previousVersionId = null;

    // Approval protects what is already in place. Filling an EMPTY slot changes
    // nothing and nobody has to wait for it, so the first file of a type is live
    // at once. Anything after that alters a document the business is already
    // relying on, so it waits for an Owner / Super Admin.
    const status = existingCount === 0 ? 'Approved' : 'Pending Review';

    const docUid = await this.generateDocUid(conn);

    const [doc] = await conn('document_store')
      .insert({
        doc_uid: docUid,
        entity: entity || null,
        linked_type: linkedType,
        linked_id: linkedId || null,
        doc_type: docType,
        title,
        description: description || null,
        file_name: fileName,
        file_path: filePath,
        file_size: fileSize,
        mime_type: mimeType,
        version,
        is_latest: true,
        previous_version_id: previousVersionId,
        // First file of its type goes live immediately; a later one waits for
        // approval, with the approved copy staying current in the meantime, so
        // an unapproved replacement can never be the one sent to a bank.
        status,
        uploaded_by: uploadedBy,
      })
      .returning('*');

    // Update document checklist if matching entry exists
    await conn('document_checklists')
      .where({ linked_type: linkedType, linked_id: linkedId, doc_type: docType })
      .whereNot({ linked_id: 0 })
      .update({ document_id: doc.id, is_fulfilled: true, updated_at: conn.fn.now() });

    return doc;
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

  // Everything attached to a reference — approved AND awaiting approval. The
  // caller marks the pending ones; hiding them would leave an Export Manager
  // unable to see the file they just uploaded.
  async getDocumentsByRef(linkedType, linkedId) {
    return db('document_store as ds')
      .leftJoin('users as u', 'ds.uploaded_by', 'u.id')
      .leftJoin('users as p', 'ds.pending_by', 'p.id')
      .select('ds.*', 'u.full_name as uploaded_by_name', 'p.full_name as pending_by_name')
      .where({ 'ds.linked_type': linkedType, 'ds.linked_id': linkedId, 'ds.is_latest': true })
      .orderBy('ds.created_at', 'desc');
  },

  // Ask for a document to be deleted. Nothing is removed until an approver
  // agrees — the file stays downloadable and current until then.
  async requestDelete(trx, { documentId, userId }) {
    const conn = trx || db;
    const doc = await conn('document_store').where({ id: documentId }).first();
    if (!doc) throw new Error('Document not found');
    if (doc.pending_action === 'delete') return doc;
    await conn('document_store').where({ id: documentId }).update({
      pending_action: 'delete', pending_by: userId || null, pending_at: conn.fn.now(), updated_at: conn.fn.now(),
    });
    return conn('document_store').where({ id: documentId }).first();
  },

  // Withdraw a deletion request (the requester changed their mind, or an
  // approver refused it).
  async cancelDelete(trx, { documentId }) {
    const conn = trx || db;
    await conn('document_store').where({ id: documentId }).update({
      pending_action: null, pending_by: null, pending_at: null, updated_at: conn.fn.now(),
    });
    return conn('document_store').where({ id: documentId }).first();
  },

  // Approver agreed to a deletion: remove the row and its file for real.
  async applyDelete(trx, { documentId }) {
    const conn = trx || db;
    const doc = await conn('document_store').where({ id: documentId }).first();
    if (!doc) throw new Error('Document not found');
    if (doc.file_path) {
      try { if (fs.existsSync(doc.file_path)) fs.unlinkSync(doc.file_path); } catch (e) { console.error('applyDelete file removal failed:', e.message); }
    }
    await conn('document_approvals').where({ document_id: documentId }).del();
    await conn('document_checklists').where({ document_id: documentId }).update({ document_id: null, is_fulfilled: false });
    await conn('document_store').where({ id: documentId }).del();
    return { deleted: true, id: documentId };
  },

  // === Version Control ===
  async uploadNewVersion(trx, { documentId, file, uploadedBy }) {
    const conn = trx || db;

    const existing = await conn('document_store').where({ id: documentId }).first();
    if (!existing) {
      throw new Error('Document not found');
    }

    // Build target directory
    const targetDir = path.join(
      UPLOAD_DIR,
      existing.entity || 'general',
      existing.linked_type,
      String(existing.linked_id || 'misc')
    );
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let fileName = null;
    let filePath = null;
    let fileSize = null;
    let mimeType = null;

    if (file) {
      fileName = file.originalname;
      const ext = path.extname(fileName);
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      filePath = path.join(targetDir, uniqueName);
      fileSize = file.size;
      mimeType = file.mimetype;

      fs.copyFileSync(file.path, filePath);
      fs.unlinkSync(file.path);
    }

    // Mark old as superseded
    await conn('document_store')
      .where({ id: documentId })
      .update({ is_latest: false, status: 'Superseded', updated_at: conn.fn.now() });

    const docUid = await this.generateDocUid(conn);

    const [newDoc] = await conn('document_store')
      .insert({
        doc_uid: docUid,
        entity: existing.entity,
        linked_type: existing.linked_type,
        linked_id: existing.linked_id,
        doc_type: existing.doc_type,
        title: existing.title,
        description: existing.description,
        file_name: fileName || existing.file_name,
        file_path: filePath || existing.file_path,
        file_size: fileSize || existing.file_size,
        mime_type: mimeType || existing.mime_type,
        version: existing.version + 1,
        is_latest: true,
        previous_version_id: documentId,
        // Pending, not live: a change only takes effect once an Owner or Super
        // Admin approves it. Whatever was approved before stays current in the
        // meantime, so an unapproved file can never be the one sent to a bank.
        status: 'Pending Review',
        uploaded_by: uploadedBy,
      })
      .returning('*');

    // Update checklist to point to new version
    await conn('document_checklists')
      .where({
        linked_type: existing.linked_type,
        linked_id: existing.linked_id,
        doc_type: existing.doc_type,
      })
      .whereNot({ linked_id: 0 })
      .update({ document_id: newDoc.id, updated_at: conn.fn.now() });

    return newDoc;
  },

  async getVersionHistory(documentId) {
    const versions = [];
    let currentId = documentId;

    // First get the latest version for this chain
    const startDoc = await db('document_store').where({ id: documentId }).first();
    if (!startDoc) return versions;

    // Get all versions for same linked_type+linked_id+doc_type
    const allVersions = await db('document_store')
      .where({
        linked_type: startDoc.linked_type,
        linked_id: startDoc.linked_id,
        doc_type: startDoc.doc_type,
      })
      .orderBy('version', 'desc');

    return allVersions;
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
