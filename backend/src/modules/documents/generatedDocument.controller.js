const db = require('../../config/database');
const service = require('./generatedDocument.service');
const { maskDocumentForViewer } = require('./exportDocument.controller');
const { userHasPermission } = require('../../middleware/rbac');
const auditService = require('../admin/audit.service');

async function resolveOrderId(id) {
  if (/^\d+$/.test(id)) return parseInt(id, 10);
  const row = await db('export_orders').where({ order_no: id }).select('id').first();
  return row ? row.id : null;
}

// Trim heavy JSON columns off a row for list/meta responses.
function meta(row) {
  if (!row) return row;
  const { snapshot_json, overrides_json, edited_html, ...rest } = row; // eslint-disable-line no-unused-vars
  return rest;
}

// Merge snapshot+overrides and mask the banking block for the requesting user.
async function renderRow(row, req) {
  const doc = service.mergedDocument(row);
  const canSeeFull = await userHasPermission(req, 'finance', 'view_bank_details');
  maskDocumentForViewer(doc, { canSeeFull, audience: row.audience || 'internal' });
  doc._genId = row.id;
  doc._docType = row.doc_type;
  return doc;
}

const generatedDocumentController = {
  // POST /:id/documents/:docType/draft — create or return the open draft.
  async createDraft(req, res) {
    try {
      const orderId = await resolveOrderId(req.params.id);
      if (!orderId) return res.status(404).json({ success: false, message: 'Order not found.' });
      const row = await service.createDraft(orderId, req.params.docType, req.user && req.user.id);
      const document = await renderRow(row, req);
      auditService.log({
        userId: req.user ? req.user.id : null,
        action: 'draft_document',
        entityType: 'generated_document',
        entityId: row.doc_no,
        details: { docType: row.doc_type, version: row.version },
        ipAddress: req.ip,
      }).catch(() => {});
      return res.status(201).json({ success: true, data: { version: meta(row), document } });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
      console.error('createDraft error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // GET /:id/documents/:docType/current — latest live version (merged + masked).
  async getCurrent(req, res) {
    try {
      const orderId = await resolveOrderId(req.params.id);
      if (!orderId) return res.status(404).json({ success: false, message: 'Order not found.' });
      const row = await service.getLatest(orderId, req.params.docType);
      if (!row) return res.json({ success: true, data: { exists: false } });
      const document = await renderRow(row, req);
      return res.json({ success: true, data: { exists: true, version: meta(row), document } });
    } catch (err) {
      console.error('getCurrent error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // PUT /documents/:genId/overrides — save preview edits.
  async saveOverrides(req, res) {
    try {
      const row = await service.saveOverrides(
        parseInt(req.params.genId, 10),
        { overrides: req.body.overrides, editedHtml: req.body.editedHtml },
        req.user && req.user.id,
      );
      const document = await renderRow(row, req);
      auditService.log({
        userId: req.user ? req.user.id : null,
        action: 'edit_document',
        entityType: 'generated_document',
        entityId: row.doc_no,
        details: { docType: row.doc_type, version: row.version },
        ipAddress: req.ip,
      }).catch(() => {});
      return res.json({ success: true, data: { version: meta(row), document } });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
      console.error('saveOverrides error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // GET /:id/documents/:docType/versions — version history (meta only).
  async listVersions(req, res) {
    try {
      const orderId = await resolveOrderId(req.params.id);
      if (!orderId) return res.status(404).json({ success: false, message: 'Order not found.' });
      const rows = await service.listVersions(orderId, req.params.docType);
      return res.json({ success: true, data: { versions: rows.map(meta) } });
    } catch (err) {
      console.error('listVersions error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // GET /documents/:genId — a specific version (merged + masked).
  async getVersion(req, res) {
    try {
      const row = await service.getById(parseInt(req.params.genId, 10));
      if (!row) return res.status(404).json({ success: false, message: 'Document version not found.' });
      const document = await renderRow(row, req);
      return res.json({ success: true, data: { version: meta(row), document } });
    } catch (err) {
      console.error('getVersion error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = generatedDocumentController;
