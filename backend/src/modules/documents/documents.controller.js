const db = require('../../config/database');
const documentService = require('../../services/documentService');
const automationService = require('../../services/automationService');

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

      const result = await db.transaction(async (trx) => {
        return documentService.uploadDocument(trx, {
          entity: entity || null,
          linkedType: linked_type,
          linkedId: linked_id ? parseInt(linked_id) : null,
          docType: doc_type,
          title,
          description: description || null,
          file: req.file || null,
          uploadedBy: req.user.id,
        });
      });

      return res.status(201).json({
        success: true,
        data: { document: result },
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

  // === Get by Reference ===
  async getByRef(req, res) {
    try {
      const { linkedType, linkedId } = req.params;
      const documents = await documentService.getDocumentsByRef(linkedType, parseInt(linkedId));

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
          file: req.file || null,
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
