const db = require('../config/database');

const whatsappService = {
  // ============================================================
  // Settings
  // ============================================================
  async getWhatsAppSettings() {
    const keys = ['whatsapp_api_url', 'whatsapp_api_key', 'whatsapp_sender_phone', 'whatsapp_provider'];
    const rows = await db('system_settings').whereIn('key', keys).select('key', 'value');

    const settings = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }

    return {
      apiUrl: settings.whatsapp_api_url || null,
      apiKey: settings.whatsapp_api_key || null,
      senderPhone: settings.whatsapp_sender_phone || null,
      provider: settings.whatsapp_provider || null,
    };
  },

  // ============================================================
  // Template Engine
  // ============================================================
  async getTemplate(idOrSlug) {
    const query = typeof idOrSlug === 'number' || /^\d+$/.test(idOrSlug)
      ? { id: parseInt(idOrSlug) }
      : { slug: idOrSlug };

    const template = await db('whatsapp_templates')
      .where(query)
      .first();

    return template || null;
  },

  renderTemplate(template, variables) {
    let body = template.body_template;

    if (variables && typeof variables === 'object') {
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        body = body.replace(regex, value != null ? String(value) : '');
      }
    }

    return body;
  },

  async renderTemplateBySlug(templateSlug, variables) {
    const template = await this.getTemplate(templateSlug);
    if (!template) {
      throw new Error(`WhatsApp template "${templateSlug}" not found.`);
    }
    if (!template.is_active) {
      throw new Error(`WhatsApp template "${templateSlug}" is inactive.`);
    }

    return this.renderTemplate(template, variables);
  },

  // ============================================================
  // Send Message
  // ============================================================
  async sendMessage(to, body, options = {}) {
    const settings = await this.getWhatsAppSettings();

    if (!settings.apiUrl || !settings.apiKey) {
      throw new Error('WhatsApp API not configured. Please set API URL and API Key in Admin Settings.');
    }

    const response = await fetch(settings.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        to: to,
        body: body,
        from: settings.senderPhone || undefined,
        ...options,
      }),
    });

    const result = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };

    try {
      result.data = await response.json();
    } catch {
      result.data = null;
    }

    return result;
  },

  async sendTemplateMessage({ templateSlug, to, toName, variables, linkedType, linkedId, sentBy }) {
    const template = await this.getTemplate(templateSlug);
    if (!template) {
      throw new Error(`WhatsApp template "${templateSlug}" not found.`);
    }

    const body = this.renderTemplate(template, variables);

    let status = 'Sent';
    let errorMessage = null;
    let sentAt = new Date();

    try {
      const response = await this.sendMessage(to, body);
      if (!response.ok) {
        status = 'Failed';
        errorMessage = response.data
          ? JSON.stringify(response.data)
          : `HTTP ${response.status}: ${response.statusText}`;
      }
    } catch (err) {
      status = 'Failed';
      errorMessage = err.message || 'Unknown WhatsApp send error';
      console.error('WhatsApp send error:', err.message);
    }

    // Log to whatsapp_logs
    const log = await this.logMessage({
      to_phone: to,
      to_name: toName || null,
      template_used: templateSlug,
      body,
      linked_type: linkedType || null,
      linked_id: linkedId || null,
      status,
      error_message: errorMessage,
      sent_by: sentBy || null,
      sent_at: status === 'Sent' ? sentAt : null,
    });

    return log;
  },

  // ============================================================
  // Template CRUD
  // ============================================================
  async getTemplates() {
    return db('whatsapp_templates').orderBy('name', 'asc');
  },

  async getTemplateById(id) {
    const template = await db('whatsapp_templates').where({ id }).first();
    return template || null;
  },

  async createTemplate(data) {
    const insert = {
      name: data.name,
      slug: data.slug,
      body_template: data.body_template,
      available_variables: data.available_variables
        ? (typeof data.available_variables === 'string'
          ? data.available_variables
          : JSON.stringify(data.available_variables))
        : null,
      entity: data.entity || null,
      trigger_event: data.trigger_event || null,
      is_active: data.is_active != null ? data.is_active : true,
      auto_send: data.auto_send != null ? data.auto_send : false,
      recipient_type: data.recipient_type || 'customer',
      created_by: data.created_by || null,
    };

    const [template] = await db('whatsapp_templates').insert(insert).returning('*');
    return template;
  },

  async updateTemplate(id, data) {
    const updates = { ...data };
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;

    if (updates.available_variables && typeof updates.available_variables !== 'string') {
      updates.available_variables = JSON.stringify(updates.available_variables);
    }

    updates.updated_at = db.fn.now();

    const [template] = await db('whatsapp_templates')
      .where({ id })
      .update(updates)
      .returning('*');

    return template || null;
  },

  async deleteTemplate(id) {
    // Soft delete: set is_active = false
    const [template] = await db('whatsapp_templates')
      .where({ id })
      .update({ is_active: false, updated_at: db.fn.now() })
      .returning('*');

    return template || null;
  },

  // ============================================================
  // Message Logs
  // ============================================================
  async logMessage(data) {
    const [log] = await db('whatsapp_logs')
      .insert({
        to_phone: data.to_phone,
        to_name: data.to_name || null,
        template_used: data.template_used || null,
        body: data.body,
        linked_type: data.linked_type || null,
        linked_id: data.linked_id || null,
        status: data.status || 'Pending',
        error_message: data.error_message || null,
        sent_by: data.sent_by || null,
        sent_at: data.sent_at || null,
      })
      .returning('*');

    return log;
  },

  async getLogs({ linkedType, linkedId, status, page = 1, limit = 20 } = {}) {
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    let query = db('whatsapp_logs as wl')
      .leftJoin('users as u', 'wl.sent_by', 'u.id')
      .select('wl.*', 'u.full_name as sent_by_name');

    if (linkedType) {
      query = query.where('wl.linked_type', linkedType);
    }
    if (linkedId) {
      query = query.where('wl.linked_id', linkedId);
    }
    if (status) {
      query = query.where('wl.status', status);
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('wl.id as total').first();

    const [logs, countResult] = await Promise.all([
      query.orderBy('wl.created_at', 'desc').limit(parseInt(limit)).offset(offset),
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

module.exports = whatsappService;
