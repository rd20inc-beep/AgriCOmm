const db = require('../../config/database');
const service = require('./generatedDocument.service');
const { maskDocumentForViewer } = require('./exportDocument.controller');
const { userHasPermission } = require('../../middleware/rbac');
const auditService = require('../admin/audit.service');
const pdfService = require('./pdf.service');
const whatsappQr = require('../communications/whatsappQr.service');
const whatsappService = require('../communications/whatsapp.service');
const emailService = require('../communications/email.service');

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

// Merge snapshot+overrides, re-resolve the selected bank, and mask the banking
// block for the requesting user + the document's audience.
async function renderRow(row, req) {
  const doc = await service._assembledForRow(row);
  const canSeeFull = await userHasPermission(req, 'finance', 'view_bank_details');
  maskDocumentForViewer(doc, { canSeeFull, audience: row.audience || 'internal' });
  doc._genId = row.id;
  doc._docType = row.doc_type;
  doc._status = row.status;
  doc._version = row.version;
  doc._locked = row.locked;
  doc._copyLabel = row.copy_label || 'ORIGINAL';
  doc._audience = row.audience;
  return doc;
}

// Shared handler for the workflow transitions (submit / approve / setStatus /
// revise). Runs the service method, audits it, and returns the fresh document.
async function transition(req, res, action) {
  try {
    const genId = parseInt(req.params.genId, 10);
    const userId = req.user && req.user.id;
    let row;
    let auditAction = action;
    if (action === 'submit') row = await service.submit(genId, userId);
    else if (action === 'approve') { row = await service.approve(genId, userId); auditAction = 'approve_document'; }
    else if (action === 'setStatus') { row = await service.setStatus(genId, req.body.status, userId); auditAction = `status:${req.body.status}`; }
    else if (action === 'revise') { row = await service.revise(genId, userId, req.body.reason); auditAction = 'revise_document'; }
    const document = await renderRow(row, req);
    auditService.log({
      userId: userId || null,
      action: auditAction,
      entityType: 'generated_document',
      entityId: row.doc_no,
      details: { docType: row.doc_type, version: row.version, status: row.status },
      ipAddress: req.ip,
    }).catch(() => {});
    return res.json({ success: true, data: { version: meta(row), document } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, code: err.code, message: err.message, errors: err.errors });
    console.error(`${action} error:`, err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
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
      return res.status(201).json({ success: true, data: { version: meta(row), document, editedHtml: row.edited_html || null } });
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
      return res.json({ success: true, data: { exists: true, version: meta(row), document, editedHtml: row.edited_html || null } });
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

  // PUT /documents/:genId/settings — bank account / audience / copy label.
  async updateSettings(req, res) {
    try {
      const row = await service.updateSettings(parseInt(req.params.genId, 10), {
        bankAccountId: req.body.bankAccountId,
        audience: req.body.audience,
        copyLabel: req.body.copyLabel,
      }, req.user && req.user.id);
      const document = await renderRow(row, req);
      return res.json({ success: true, data: { version: meta(row), document } });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
      console.error('updateSettings error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Workflow transitions. approve is gated on documents.approve at the route.
  async submit(req, res) { return transition(req, res, 'submit'); },
  async approve(req, res) { return transition(req, res, 'approve'); },
  async setStatus(req, res) { return transition(req, res, 'setStatus'); },
  async revise(req, res) { return transition(req, res, 'revise'); },

  // PUT /:id/documents/customer-style — save the consignee's preferred document
  // font (family + size scale) so future documents for this customer use it.
  async saveCustomerStyle(req, res) {
    try {
      const orderId = await resolveOrderId(req.params.id);
      if (!orderId) return res.status(404).json({ success: false, message: 'Order not found.' });
      const order = await db('export_orders').where({ id: orderId }).select('customer_id').first();
      if (!order || !order.customer_id) return res.status(404).json({ success: false, message: 'Order has no customer.' });
      const patch = { updated_at: db.fn.now() };
      if (req.body.fontFamily !== undefined) patch.doc_font_family = req.body.fontFamily || null;
      if (req.body.fontScale !== undefined) patch.doc_font_scale = req.body.fontScale || 1;
      await db('customers').where({ id: order.customer_id }).update(patch);
      auditService.log({
        userId: req.user ? req.user.id : null,
        action: 'save_document_style',
        entityType: 'customer',
        entityId: order.customer_id,
        details: { fontFamily: patch.doc_font_family, fontScale: patch.doc_font_scale },
        ipAddress: req.ip,
      }).catch(() => {});
      return res.json({ success: true, data: { customerId: order.customer_id, style: { fontFamily: patch.doc_font_family, fontScale: patch.doc_font_scale } } });
    } catch (err) {
      console.error('saveCustomerStyle error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // POST /:id/documents/:docType/send-whatsapp — render the posted document HTML
  // to a PDF and send it to the customer's WhatsApp via the QR-paired session.
  async sendWhatsApp(req, res) {
    try {
      const orderId = await resolveOrderId(req.params.id);
      if (!orderId) return res.status(404).json({ success: false, message: 'Order not found.' });
      const { html, to, caption, filename } = req.body;
      if (!html || !String(html).trim()) return res.status(400).json({ success: false, message: 'Document content is required.' });

      // Recipient: explicit number, else the order's customer phone.
      let phone = to;
      let toName = null;
      const cust = await db('export_orders as eo').leftJoin('customers as c', 'eo.customer_id', 'c.id')
        .where('eo.id', orderId).select('c.phone as phone', 'c.name as name').first();
      if (!phone) phone = cust && cust.phone;
      toName = cust && cust.name;
      if (!phone) return res.status(400).json({ success: false, code: 'NO_PHONE', message: 'No WhatsApp number for this customer. Add a phone on the customer record, or enter one to send.' });

      const wa = whatsappQr.getStatus();
      if (wa.status !== 'connected') {
        return res.status(409).json({ success: false, code: 'WA_NOT_CONNECTED', message: 'WhatsApp is not connected. Connect it in Admin → WhatsApp by scanning the QR code.' });
      }

      let pdf;
      try {
        pdf = await pdfService.htmlToPdf(html);
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to render the document PDF.' });
      }

      const safeName = String(filename || `${req.params.docType}.pdf`).replace(/[^\w.\- ]+/g, '_');
      const result = await whatsappQr.sendDocument(phone, pdf, { fileName: safeName, caption });

      whatsappService.logMessage({
        to_phone: phone, to_name: toName, body: caption || `Document: ${req.params.docType}`,
        linked_type: 'export_order', linked_id: orderId,
        status: result.ok ? 'Sent' : 'Failed', error_message: result.ok ? null : result.error,
        sent_by: req.user ? req.user.id : null, sent_at: result.ok ? new Date() : null,
      }).catch(() => {});
      auditService.log({
        userId: req.user ? req.user.id : null, action: 'send_document_whatsapp',
        entityType: 'export_order', entityId: orderId,
        details: { docType: req.params.docType, to: phone, ok: result.ok }, ipAddress: req.ip,
      }).catch(() => {});

      if (!result.ok) return res.status(502).json({ success: false, message: result.error || 'WhatsApp send failed.' });
      return res.json({ success: true, data: { to: phone, messageId: result.messageId } });
    } catch (err) {
      console.error('sendWhatsApp error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // POST /:id/documents/:docType/send-email — render the posted document HTML to
  // a PDF and email it to the customer as an attachment.
  async sendEmail(req, res) {
    try {
      const orderId = await resolveOrderId(req.params.id);
      if (!orderId) return res.status(404).json({ success: false, message: 'Order not found.' });
      const { html, to, subject, message, filename } = req.body;
      if (!html || !String(html).trim()) return res.status(400).json({ success: false, message: 'Document content is required.' });

      // Recipient: explicit email, else the order's customer email.
      let email = to && String(to).trim();
      const cust = await db('export_orders as eo').leftJoin('customers as c', 'eo.customer_id', 'c.id')
        .where('eo.id', orderId).select('c.email as email', 'c.name as name').first();
      if (!email) email = cust && cust.email;
      const toName = cust && cust.name;
      if (!email) return res.status(400).json({ success: false, code: 'NO_EMAIL', message: 'No email for this customer. Add one on the customer record, or enter an address to send.' });

      let pdf;
      try {
        pdf = await pdfService.htmlToPdf(html);
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message || 'Failed to render the document PDF.' });
      }

      const docLabel = req.params.docType;
      const safeName = String(filename || `${docLabel}.pdf`).replace(/[^\w.\- ]+/g, '_');
      const finalSubject = (subject && String(subject).trim()) || `${docLabel} — ${req.params.id}`;
      const bodyHtml = (message && String(message).trim())
        ? String(message).replace(/\n/g, '<br/>')
        : `<p>Dear ${toName || 'Customer'},</p><p>Please find the attached ${docLabel}.</p><p>Regards,<br/>Agri Commodities</p>`;

      const result = await emailService.sendEmail({
        to: email, subject: finalSubject, body: bodyHtml,
        attachments: [{ filename: safeName, content: pdf, contentType: 'application/pdf' }],
        linkedType: 'export_order', linkedId: orderId, userId: req.user ? req.user.id : null,
      });

      auditService.log({
        userId: req.user ? req.user.id : null, action: 'send_document_email',
        entityType: 'export_order', entityId: orderId,
        details: { docType: docLabel, to: email, ok: result.status === 'Sent' }, ipAddress: req.ip,
      }).catch(() => {});

      if (result.status !== 'Sent') return res.status(502).json({ success: false, message: result.error_message || 'Email send failed.' });
      return res.json({ success: true, data: { to: email } });
    } catch (err) {
      console.error('sendEmail error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // POST /:id/documents/:docType/pdf — render the posted document HTML to a PDF
  // on the SERVER (consistent A4, independent of the browser print dialog) and
  // return it as a download.
  async downloadPdf(req, res) {
    try {
      const orderId = await resolveOrderId(req.params.id);
      if (!orderId) return res.status(404).json({ success: false, message: 'Order not found.' });
      const { html, filename } = req.body;
      if (!html || !String(html).trim()) return res.status(400).json({ success: false, message: 'Document content is required.' });

      // TEMP DEBUG (remove after diagnosis): capture exactly what the browser sends.
      try { require('fs').writeFileSync('/tmp/pdf_debug_last.html', String(html || '')); } catch (_) { /* ignore */ }

      let pdf;
      try {
        pdf = await pdfService.htmlToPdf(html);
      } catch (e) {
        return res.status(e.status || 503).json({ success: false, message: e.message || 'Failed to render the document PDF.' });
      }
      const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
      const safeName = String(filename || `${req.params.docType}.pdf`).replace(/[^\w.\- ]+/g, '_');

      auditService.log({
        userId: req.user ? req.user.id : null, action: 'download_document_pdf',
        entityType: 'export_order', entityId: orderId,
        details: { docType: req.params.docType }, ipAddress: req.ip,
      }).catch(() => {});

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.setHeader('Content-Length', buf.length);
      return res.end(buf);
    } catch (err) {
      console.error('downloadPdf error:', err);
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
