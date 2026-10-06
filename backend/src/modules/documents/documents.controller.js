const db = require('../../config/database');
const documentService = require('../../services/documentService');
const automationService = require('../../services/automationService');

// multer .fields() puts files under req.files[field]; .single() under req.file.
// Every file of one request becomes ONE version of the document type.
function uploadedFiles(req) {
  const out = [];
  if (req.files && !Array.isArray(req.files)) {
    for (const k of ['files', 'file']) if (Array.isArray(req.files[k])) out.push(...req.files[k]);
  } else if (Array.isArray(req.files)) out.push(...req.files);
  if (req.file) out.push(req.file);
  return out;
}

const documentController = {
  // === Upload ===
  async upload(req, res) {
    try {
      const { entity, linked_type, linked_id, doc_type, title, description } = req.body;

      if (!linked_type || !doc_type || !title) {
        return res.status(400).json({
          success: false,
          message: 'linked_type, doc_type, and title are required.',
        });
      }

      // A re-upload of a type REPLACES its live file(s) — they are marked
      // Superseded and stay in the history. Several files in one request (a
      // multi-page scan) are one version, so no page is lost.
      const rows = await db.transaction(async (trx) => {
        return documentService.uploadDocuments(trx, {
          entity: entity || null,
          linkedType: linked_type,
          linkedId: linked_id ? parseInt(linked_id) : null,
          docType: doc_type,
          title,
          description: description || null,
          files: uploadedFiles(req),
          uploadedBy: req.user.id,
        });
      });

      return res.status(201).json({
        success: true,
        data: { document: rows[0], documents: rows },
      });
    } catch (err) {
      console.error('Document upload error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Get Document ===
  async getById(req, res) {
    try {
      const { id } = req.params;
      const doc = await documentService.getDocument(parseInt(id));

      if (!doc) {
        return res.status(404).json({ success: false, message: 'Document not found.' });
      }

      return res.json({ success: true, data: { document: doc } });
    } catch (err) {
      console.error('Document getById error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Pending approvals, across every order ===
  // Without this an approver had to already know WHICH order was waiting and
  // open its Documents tab to find out — there was no queue anywhere.
  async pendingApprovals(req, res) {
    try {
      const rows = await db('document_store as ds')
        .leftJoin('users as u', 'ds.uploaded_by', 'u.id')
        .leftJoin('users as p', 'ds.pending_by', 'p.id')
        .leftJoin('export_orders as eo', function joinOrder() {
          this.on('eo.id', 'ds.linked_id').andOn(db.raw("ds.linked_type = 'export_order'"));
        })
        .where((q) => q.where('ds.status', 'Pending Review').orWhere('ds.pending_action', 'delete'))
        .select(
          'ds.id', 'ds.doc_type', 'ds.title', 'ds.file_name', 'ds.status', 'ds.pending_action',
          'ds.linked_type', 'ds.linked_id', 'ds.created_at', 'ds.version',
          'u.full_name as uploaded_by_name', 'p.full_name as requested_by_name',
          'eo.order_no as order_no',
        )
        .orderBy('ds.created_at', 'desc')
        .limit(500);
      return res.json({ success: true, data: { documents: rows, count: rows.length } });
    } catch (err) {
      console.error('Document pendingApprovals error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Count only — for the sidebar badge, so it stays cheap to poll.
  async pendingApprovalsCount(req, res) {
    try {
      const r = await db('document_store')
        .where((q) => q.where('status', 'Pending Review').orWhere('pending_action', 'delete'))
        .count('id as c').first();
      return res.json({ success: true, data: { pending: parseInt(r?.c, 10) || 0 } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // === Deletion requests ===
  // An Export Manager asks; nothing is removed until an approver agrees. The
  // requester is never blocked — they carry on uploading and editing while this
  // sits pending.
  async requestDelete(req, res) {
    try {
      const doc = await documentService.requestDelete(null, {
        documentId: parseInt(req.params.id, 10),
        userId: req.user.id,
      });
      return res.json({ success: true, data: { document: doc }, message: 'Deletion requested — awaiting owner approval.' });
    } catch (err) {
      console.error('Document requestDelete error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async cancelDelete(req, res) {
    try {
      const documentId = parseInt(req.params.id, 10);
      const current = await db('document_store').where({ id: documentId }).first();
      if (!current) return res.status(404).json({ success: false, message: 'Document not found.' });
      // An Owner/Super Admin turning down someone else's request is a refusal,
      // and is recorded as one; the requester withdrawing their own is not.
      const isAdmin = await documentService.isDocumentAdmin(req.user);
      const refusing = isAdmin && current.pending_by != null && Number(current.pending_by) !== Number(req.user.id);
      const doc = await documentService.cancelDelete(null, {
        documentId,
        rejectedBy: refusing ? req.user.id : null,
        comments: (req.body && req.body.comments) || null,
      });
      return res.json({
        success: true,
        data: { document: doc },
        message: refusing ? 'Deletion refused — the document is kept.' : 'Deletion request withdrawn.',
      });
    } catch (err) {
      console.error('Document cancelDelete error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // === Delete ===
  // Owner / Super Admin: the document is marked Deleted at once (file kept,
  // audited). Anyone else: this becomes a deletion REQUEST and nothing changes
  // until an Owner/Super Admin approves it from Admin ▸ Approvals.
  async remove(req, res) {
    try {
      const documentId = parseInt(req.params.id, 10);
      const existing = await db('document_store').where({ id: documentId }).first();
      if (!existing) return res.status(404).json({ success: false, message: 'Document not found.' });
      if (await documentService.isDocumentAdmin(req.user)) {
        const out = await db.transaction((trx) => documentService.applyDelete(trx, { documentId, userId: req.user.id, direct: true }));
        return res.json({ success: true, data: { ...out, requested: false }, message: 'Document deleted — the file is kept in its version history.' });
      }
      const doc = await db.transaction((trx) => documentService.requestDelete(trx, { documentId, userId: req.user.id }));
      return res.status(202).json({ success: true, data: { document: doc, requested: true }, message: 'Deletion requested — awaiting owner approval.' });
    } catch (err) {
      console.error('Document remove error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // === Get by Reference ===
  async getByRef(req, res) {
    try {
      const { linkedType, linkedId } = req.params;
      // linked_id is an integer column; a non-numeric reference (an order NUMBER
      // like "EX-006" rather than its id) used to reach the query as NaN and
      // fail with a 500. Nothing is linked to a non-numeric id, so answer empty.
      const id = parseInt(linkedId, 10);
      if (!Number.isFinite(id)) return res.json({ success: true, data: { documents: [] } });
      const includeHistory = ['1', 'true'].includes(String((req.query && req.query.include_history) || ''));
      const documents = await documentService.getDocumentsByRef(linkedType, id, { includeHistory });

      return res.json({ success: true, data: { documents } });
    } catch (err) {
      console.error('Document getByRef error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Search ===
  async search(req, res) {
    try {
      const { entity, doc_type, status, search, linked_type, page, limit } = req.query;

      const result = await documentService.searchDocuments({
        entity,
        docType: doc_type,
        status,
        search,
        linkedType: linked_type,
        page: page || 1,
        limit: limit || 20,
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Document search error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Download ===
  async download(req, res) {
    try {
      const { id } = req.params;
      const doc = await db('document_store').where({ id: parseInt(id) }).first();

      if (!doc) {
        return res.status(404).json({ success: false, message: 'Document not found.' });
      }

      if (!doc.file_path) {
        return res.status(404).json({ success: false, message: 'No file attached to this document.' });
      }

      const fs = require('fs');
      if (!fs.existsSync(doc.file_path)) {
        return res.status(404).json({ success: false, message: 'File not found on disk.' });
      }

      return res.download(doc.file_path, doc.file_name || 'document');
    } catch (err) {
      console.error('Document download error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Version History ===
  async getVersionHistory(req, res) {
    try {
      const { id } = req.params;
      const versions = await documentService.getVersionHistory(parseInt(id));

      return res.json({ success: true, data: { versions } });
    } catch (err) {
      console.error('Document version history error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Upload New Version ===
  async uploadNewVersion(req, res) {
    try {
      const { id } = req.params;

      const result = await db.transaction(async (trx) => {
        return documentService.uploadNewVersion(trx, {
          documentId: parseInt(id),
          files: uploadedFiles(req),
          uploadedBy: req.user.id,
        });
      });

      return res.status(201).json({
        success: true,
        data: { document: result },
      });
    } catch (err) {
      console.error('Document uploadNewVersion error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // === Submit for Review ===
  async submitForReview(req, res) {
    try {
      const { id } = req.params;

      const result = await db.transaction(async (trx) => {
        return documentService.submitForReview(trx, {
          documentId: parseInt(id),
          userId: req.user.id,
        });
      });

      return res.json({ success: true, data: { document: result } });
    } catch (err) {
      console.error('Document submitForReview error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // === Approve ===
  async approve(req, res) {
    try {
      const { id } = req.params;
      const { comments } = req.body;

      // Approving a row flagged for deletion makes the deletion take effect:
      // it is marked Deleted (file kept, in the history) and audited.
      const flagged = await db('document_store').where({ id: parseInt(id, 10) }).first();
      if (flagged && flagged.pending_action === 'delete') {
        const out = await db.transaction((trx) => documentService.applyDelete(trx, { documentId: parseInt(id, 10), userId: req.user.id }));
        return res.json({ success: true, data: out, message: 'Deletion approved — document marked deleted; the file is kept in its history.' });
      }

      const result = await db.transaction(async (trx) => {
        const doc = await documentService.approveDocument(trx, {
          documentId: parseInt(id),
          approverId: req.user.id,
          comments: comments || null,
        });

        // Trigger automation: document approved
        await automationService.onDocumentApproved(trx, {
          documentId: parseInt(id),
          userId: req.user.id,
        });

        return doc;
      });

      return res.json({ success: true, data: { document: result } });
    } catch (err) {
      console.error('Document approve error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // === Reject ===
  async reject(req, res) {
    try {
      const { id } = req.params;
      const { comments } = req.body;

      const result = await db.transaction(async (trx) => {
        return documentService.rejectDocument(trx, {
          documentId: parseInt(id),
          approverId: req.user.id,
          comments: comments || null,
        });
      });

      return res.json({ success: true, data: { document: result } });
    } catch (err) {
      console.error('Document reject error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // === Request Revision ===
  async requestRevision(req, res) {
    try {
      const { id } = req.params;
      const { comments } = req.body;

      const result = await db.transaction(async (trx) => {
        return documentService.requestRevision(trx, {
          documentId: parseInt(id),
          approverId: req.user.id,
          comments: comments || null,
        });
      });

      return res.json({ success: true, data: { document: result } });
    } catch (err) {
      console.error('Document requestRevision error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // === Finalize ===
  async finalize(req, res) {
    try {
      const { id } = req.params;

      const result = await db.transaction(async (trx) => {
        return documentService.finalizeDocument(trx, {
          documentId: parseInt(id),
          userId: req.user.id,
        });
      });

      return res.json({ success: true, data: { document: result } });
    } catch (err) {
      console.error('Document finalize error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // === Checklist: Create ===
  async createChecklist(req, res) {
    try {
      const { linked_type, linked_id, items } = req.body;

      if (!linked_type || !linked_id || !items || !Array.isArray(items)) {
        return res.status(400).json({
          success: false,
          message: 'linked_type, linked_id, and items array are required.',
        });
      }

      const result = await db.transaction(async (trx) => {
        return documentService.createChecklist(trx, {
          linkedType: linked_type,
          linkedId: parseInt(linked_id),
          items,
        });
      });

      return res.status(201).json({ success: true, data: { checklist: result } });
    } catch (err) {
      console.error('Document createChecklist error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Checklist: Get ===
  async getChecklist(req, res) {
    try {
      const { linkedType, linkedId } = req.params;
      const checklist = await documentService.getChecklist(linkedType, parseInt(linkedId));

      return res.json({ success: true, data: { checklist } });
    } catch (err) {
      console.error('Document getChecklist error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Checklist: Missing ===
  async checkMissing(req, res) {
    try {
      const { linkedType, linkedId } = req.params;
      const missing = await documentService.checkMissingDocs(linkedType, parseInt(linkedId));

      return res.json({
        success: true,
        data: {
          missing,
          is_complete: missing.length === 0,
        },
      });
    } catch (err) {
      console.error('Document checkMissing error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Dispatch: Log ===
  async dispatch(req, res) {
    try {
      const { id } = req.params;
      const { dispatched_to, method, tracking_ref, notes } = req.body;

      if (!dispatched_to || !method) {
        return res.status(400).json({
          success: false,
          message: 'dispatched_to and method are required.',
        });
      }

      const result = await db.transaction(async (trx) => {
        return documentService.dispatchDocument(trx, {
          documentId: parseInt(id),
          dispatchedTo: dispatched_to,
          method,
          trackingRef: tracking_ref || null,
          notes: notes || null,
          dispatchedBy: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: { dispatch: result } });
    } catch (err) {
      console.error('Document dispatch error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Dispatch: History ===
  async dispatchHistory(req, res) {
    try {
      const { id } = req.params;
      const history = await documentService.getDispatchHistory(parseInt(id));

      return res.json({ success: true, data: { history } });
    } catch (err) {
      console.error('Document dispatchHistory error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // === Generate PDF ===
  async generatePDF(req, res) {
    try {
      const { docType } = req.params;
      const { linked_type, linked_id } = req.body;

      if (!linked_type || !linked_id) {
        return res.status(400).json({
          success: false,
          message: 'linked_type and linked_id are required.',
        });
      }

      const result = await db.transaction(async (trx) => {
        return documentService.generatePDF(trx, {
          docType,
          linkedType: linked_type,
          linkedId: parseInt(linked_id),
          userId: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: { document: result } });
    } catch (err) {
      console.error('Document generatePDF error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // === Stats ===
  async stats(req, res) {
    try {
      const stats = await documentService.getDocumentStats();

      return res.json({ success: true, data: { stats } });
    } catch (err) {
      console.error('Document stats error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = documentController;
