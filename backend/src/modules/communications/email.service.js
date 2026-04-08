const nodemailer = require('nodemailer');
const db = require('../../config/database');
const config = require('../../config');

let _transporter = null;

const emailService = {
  // ============================================================
  // Get transporter (lazy-initialized)
  // ============================================================
  getTransporter() {
    if (_transporter) return _transporter;

    _transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });

    return _transporter;
  },

  // ============================================================
  // Template Engine
  // ============================================================
  async getTemplate(slug) {
    const template = await db('email_templates')
      .where({ slug, is_active: true })
      .first();
    return template || null;
  },

  renderTemplate(template, variables) {
    let subject = template.subject_template;
    let body = template.body_template;

    if (variables && typeof variables === 'object') {
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        subject = subject.replace(regex, value != null ? String(value) : '');
        body = body.replace(regex, value != null ? String(value) : '');
      }
    }

    return { subject, body };
  },

  // ============================================================
  // Send Email
  // ============================================================
  async sendEmail({ to, cc, subject, body, templateSlug, variables, linkedType, linkedId, userId }) {
    let finalSubject = subject;
    let finalBody = body;
    let templateUsed = null;

    // If templateSlug provided, load template + render
    if (templateSlug) {
      const template = await this.getTemplate(templateSlug);
      if (template) {
        const rendered = this.renderTemplate(template, variables || {});
        finalSubject = rendered.subject;
        finalBody = rendered.body;
        templateUsed = templateSlug;
      }
    }

    const fromEmail = `${config.smtp.senderName} <${config.smtp.senderEmail}>`;
    let status = 'Sent';
    let errorMessage = null;

    try {
      const transporter = this.getTransporter();
      const mailOptions = {
        from: fromEmail,
        to,
        subject: finalSubject,
        html: finalBody,
      };

      if (cc) {
        mailOptions.cc = cc;
      }

      await transporter.sendMail(mailOptions);
    } catch (err) {
      status = 'Failed';
      errorMessage = err.message || 'Unknown email send error';
      console.error('Email send error:', err.message);
    }

    // Log to email_logs
    const [log] = await db('email_logs')
      .insert({
        from_email: config.smtp.senderEmail,
        to_email: to,
        cc: cc || null,
        subject: finalSubject,
        body: finalBody,
        template_used: templateUsed,
        linked_type: linkedType || null,
        linked_id: linkedId || null,
        status,
        error_message: errorMessage,
        sent_by: userId || null,
      })
      .returning('*');

    return log;
  },

  async sendBulkEmails(emails) {
    const results = [];
    for (const email of emails) {
      const result = await this.sendEmail(email);
      results.push(result);
    }
    return results;
  },

  // ============================================================
  // Notification Emails (convenience methods)
  // ============================================================
  async sendAdvanceRequest({ orderId, userId }) {
    const order = await db('export_orders as eo')
      .leftJoin('customers as c', 'eo.customer_id', 'c.id')
      .select('eo.*', 'c.name as customer_name', 'c.email as customer_email')
      .where('eo.id', orderId)
      .first();

    if (!order || !order.customer_email) return null;

    return this.sendEmail({
      to: order.customer_email,
      templateSlug: 'advance_request',
      variables: {
        orderNo: order.order_no,
        customerName: order.customer_name,
        amount: order.advance_expected,
        currency: 'USD',
        totalValue: order.total_value,
        advancePct: order.advance_pct,
      },
      linkedType: 'export_order',
      linkedId: orderId,
      userId,
    });
  },

  async sendBalanceReminder({ orderId, userId }) {
    const order = await db('export_orders as eo')
      .leftJoin('customers as c', 'eo.customer_id', 'c.id')
      .select('eo.*', 'c.name as customer_name', 'c.email as customer_email')
      .where('eo.id', orderId)
      .first();

    if (!order || !order.customer_email) return null;

    const balanceDue = parseFloat(order.balance_expected || 0) - parseFloat(order.balance_received || 0);

    return this.sendEmail({
      to: order.customer_email,
      templateSlug: 'balance_reminder',
      variables: {
        orderNo: order.order_no,
        customerName: order.customer_name,
        amount: balanceDue,
        currency: 'USD',
        totalValue: order.total_value,
      },
      linkedType: 'export_order',
      linkedId: orderId,
      userId,
    });
  },

  async sendProformaInvoice({ orderId, attachmentPath, userId }) {
    const order = await db('export_orders as eo')
      .leftJoin('customers as c', 'eo.customer_id', 'c.id')
      .leftJoin('products as p', 'eo.product_id', 'p.id')
      .select('eo.*', 'c.name as customer_name', 'c.email as customer_email', 'p.name as product_name')
      .where('eo.id', orderId)
      .first();

    if (!order || !order.customer_email) return null;

    const fromEmail = `${config.smtp.senderName} <${config.smtp.senderEmail}>`;
    const template = await this.getTemplate('proforma_invoice');
    let finalSubject = `Proforma Invoice — ${order.order_no}`;
    let finalBody = '';

    if (template) {
      const rendered = this.renderTemplate(template, {
        piNumber: order.order_no,
        customerName: order.customer_name,
        orderNo: order.order_no,
        productName: order.product_name,
        qtyMT: order.qty_mt,
        currency: 'USD',
        pricePerMT: order.price_per_mt,
        totalValue: order.total_value,
      });
      finalSubject = rendered.subject;
      finalBody = rendered.body;
    }

    let status = 'Sent';
    let errorMessage = null;

    try {
      const transporter = this.getTransporter();
      const mailOptions = {
        from: fromEmail,
        to: order.customer_email,
        subject: finalSubject,
        html: finalBody,
      };

      if (attachmentPath) {
        mailOptions.attachments = [{ path: attachmentPath }];
      }

      await transporter.sendMail(mailOptions);
    } catch (err) {
      status = 'Failed';
      errorMessage = err.message || 'Unknown error';
      console.error('Email send error:', err.message);
    }

    const [log] = await db('email_logs')
      .insert({
        from_email: config.smtp.senderEmail,
        to_email: order.customer_email,
        subject: finalSubject,
        body: finalBody,
        template_used: 'proforma_invoice',
        linked_type: 'export_order',
        linked_id: orderId,
        status,
        error_message: errorMessage,
        sent_by: userId || null,
      })
      .returning('*');

    return log;
  },

  async sendShipmentNotification({ orderId, userId }) {
    const order = await db('export_orders as eo')
      .leftJoin('customers as c', 'eo.customer_id', 'c.id')
      .select('eo.*', 'c.name as customer_name', 'c.email as customer_email')
      .where('eo.id', orderId)
      .first();

    if (!order || !order.customer_email) return null;

    return this.sendEmail({
      to: order.customer_email,
      templateSlug: 'shipment_notification',
      variables: {
        orderNo: order.order_no,
        customerName: order.customer_name,
        vesselName: order.vessel_name || 'TBD',
        eta: order.eta || 'TBD',
        destinationPort: order.destination_port || '',
      },
      linkedType: 'export_order',
      linkedId: orderId,
      userId,
    });
  },

  async sendPaymentConfirmation({ orderId, amount, currency, userId }) {
    const order = await db('export_orders as eo')
      .leftJoin('customers as c', 'eo.customer_id', 'c.id')
      .select('eo.*', 'c.name as customer_name', 'c.email as customer_email')
      .where('eo.id', orderId)
      .first();

    if (!order || !order.customer_email) return null;

    return this.sendEmail({
      to: order.customer_email,
      templateSlug: 'payment_confirmation',
      variables: {
        orderNo: order.order_no,
        customerName: order.customer_name,
        amount: amount || 0,
        currency: currency || 'USD',
      },
      linkedType: 'export_order',
      linkedId: orderId,
      userId,
    });
  },

  async sendQualityAlert({ batchId, userId }) {
    const batch = await db('milling_batches').where({ id: batchId }).first();
    if (!batch) return null;

    // Send to mill manager (role_id = 4)
    const millManagers = await db('users').where({ role_id: 4, is_active: true });
    const results = [];

    for (const manager of millManagers) {
      const result = await this.sendEmail({
        to: manager.email,
        templateSlug: 'quality_alert',
        variables: {
          batchNo: batch.batch_no,
          supplierName: batch.supplier_id ? (await db('suppliers').where({ id: batch.supplier_id }).select('name').first())?.name : 'Unknown',
          rawQty: batch.raw_qty_mt,
        },
        linkedType: 'milling_batch',
        linkedId: batchId,
        userId,
      });
      results.push(result);
    }

    return results;
  },

  async sendDocumentApprovalNotification({ documentId, userId }) {
    const doc = await db('document_store').where({ id: documentId }).first();
    if (!doc) return null;

    // Notify the uploader
    const uploader = await db('users').where({ id: doc.uploaded_by }).first();
    if (!uploader) return null;

    return this.sendEmail({
      to: uploader.email,
      templateSlug: 'document_approval',
      variables: {
        docType: doc.doc_type,
        orderNo: doc.linked_type === 'export_order'
          ? (await db('export_orders').where({ id: doc.linked_id }).select('order_no').first())?.order_no || ''
          : '',
        title: doc.title,
      },
      linkedType: 'document',
      linkedId: documentId,
      userId,
    });
  },

  async sendOverdueNotice({ receivableId, userId }) {
    const receivable = await db('receivables').where({ id: receivableId }).first();
    if (!receivable) return null;

    const customer = receivable.customer_id
      ? await db('customers').where({ id: receivable.customer_id }).first()
      : null;

    if (!customer || !customer.email) return null;

    return this.sendEmail({
      to: customer.email,
      templateSlug: 'overdue_notice',
      variables: {
        customerName: customer.name,
        amount: receivable.amount || 0,
        currency: receivable.currency || 'USD',
        dueDate: receivable.due_date,
        refNo: receivable.ref_no || '',
      },
      linkedType: 'export_order',
      linkedId: receivable.order_id || null,
      userId,
    });
  },

  // ============================================================
  // Email Log Queries
  // ============================================================
  async getEmailLog({ linkedType, linkedId, page = 1, limit = 20 }) {
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('email_logs');

    if (linkedType) {
      query = query.where('linked_type', linkedType);
    }
    if (linkedId) {
      query = query.where('linked_id', linkedId);
    }

    const countQuery = query.clone().count('id as total').first();

    const [logs, countResult] = await Promise.all([
      query.orderBy('sent_at', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return {
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  },

  async getEmailsByCustomer(customerId, { page = 1, limit = 20 } = {}) {
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const customer = await db('customers').where({ id: customerId }).select('email').first();
    if (!customer || !customer.email) return { logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

    const countQuery = db('email_logs').where('to_email', customer.email).count('id as total').first();

    const [logs, countResult] = await Promise.all([
      db('email_logs').where('to_email', customer.email).orderBy('sent_at', 'desc').limit(parseInt(limit)).offset(offset),
      countQuery,
    ]);

    const total = parseInt(countResult.total);

    return {
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  },
};

module.exports = emailService;
