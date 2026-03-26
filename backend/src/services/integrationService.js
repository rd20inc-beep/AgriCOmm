const db = require('../config/database');

/**
 * External API Integration Service — Phase 10 (Enterprise)
 * Manages API integrations, CRM sync, bank statement import.
 */
const integrationService = {
  // ═══════════════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════════════

  async getIntegrations() {
    return db('api_integrations').orderBy('name', 'asc');
  },

  async getIntegration(id) {
    return db('api_integrations').where({ id }).first();
  },

  async createIntegration(data) {
    const [integration] = await db('api_integrations')
      .insert({
        name: data.name,
        base_url: data.base_url || null,
        auth_type: data.auth_type || 'none',
        auth_credentials: data.auth_credentials ? JSON.stringify(data.auth_credentials) : null,
        is_active: data.is_active !== undefined ? data.is_active : true,
        sync_frequency: data.sync_frequency || 'manual',
        config: data.config ? JSON.stringify(data.config) : null,
      })
      .returning('*');
    return integration;
  },

  async updateIntegration(id, data) {
    const updates = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.base_url !== undefined) updates.base_url = data.base_url;
    if (data.auth_type !== undefined) updates.auth_type = data.auth_type;
    if (data.auth_credentials !== undefined) updates.auth_credentials = JSON.stringify(data.auth_credentials);
    if (data.is_active !== undefined) updates.is_active = data.is_active;
    if (data.sync_frequency !== undefined) updates.sync_frequency = data.sync_frequency;
    if (data.config !== undefined) updates.config = JSON.stringify(data.config);
    updates.updated_at = db.fn.now();

    const [integration] = await db('api_integrations')
      .where({ id })
      .update(updates)
      .returning('*');
    return integration;
  },

  // ═══════════════════════════════════════════════════════════════════
  // CRM SYNC
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Sync customers from CRM API.
   */
  async syncCRMCustomers(integrationId) {
    const integration = await this.getIntegration(integrationId);
    if (!integration) throw new Error('Integration not found');

    const startedAt = new Date();
    let synced = 0;
    let failed = 0;
    const details = {};

    try {
      const baseUrl = integration.base_url.replace(/\/$/, '');
      const headers = this._buildAuthHeaders(integration);
      const response = await fetch(`${baseUrl}/customers`, { headers });

      if (!response.ok) throw new Error(`CRM API returned ${response.status}`);

      const data = await response.json();
      const records = Array.isArray(data) ? data : data.data || [];

      for (const record of records) {
        try {
          const existing = await db('customers').where({ name: record.name }).first();
          if (existing) {
            await db('customers').where({ id: existing.id }).update({
              company: record.company || existing.company,
              email: record.email || existing.email,
              phone: record.phone || existing.phone,
              country: record.country || existing.country,
              updated_at: db.fn.now(),
            });
          } else {
            await db('customers').insert({
              name: record.name,
              company: record.company || null,
              email: record.email || null,
              phone: record.phone || null,
              country: record.country || null,
            });
          }
          synced++;
        } catch (err) {
          failed++;
          details[`customer_${record.name || 'unknown'}`] = err.message;
        }
      }

      await this.logSync(integrationId, {
        direction: 'inbound',
        entityType: 'customers',
        recordsSynced: synced,
        recordsFailed: failed,
        status: failed === 0 ? 'Success' : synced > 0 ? 'Partial' : 'Failed',
        details,
        startedAt,
      });

      return { synced, failed, details };
    } catch (err) {
      await this.logSync(integrationId, {
        direction: 'inbound',
        entityType: 'customers',
        recordsSynced: 0,
        recordsFailed: 0,
        status: 'Failed',
        details: { error: err.message },
        startedAt,
      });
      throw err;
    }
  },

  /**
   * Sync suppliers from CRM API.
   */
  async syncCRMSuppliers(integrationId) {
    const integration = await this.getIntegration(integrationId);
    if (!integration) throw new Error('Integration not found');

    const startedAt = new Date();
    let synced = 0;
    let failed = 0;
    const details = {};

    try {
      const baseUrl = integration.base_url.replace(/\/$/, '');
      const headers = this._buildAuthHeaders(integration);
      const response = await fetch(`${baseUrl}/suppliers`, { headers });

      if (!response.ok) throw new Error(`CRM API returned ${response.status}`);

      const data = await response.json();
      const records = Array.isArray(data) ? data : data.data || [];

      for (const record of records) {
        try {
          const existing = await db('suppliers').where({ name: record.name }).first();
          if (existing) {
            await db('suppliers').where({ id: existing.id }).update({
              contact_person: record.contact_person || existing.contact_person,
              phone: record.phone || existing.phone,
              city: record.city || existing.city,
              updated_at: db.fn.now(),
            });
          } else {
            await db('suppliers').insert({
              name: record.name,
              contact_person: record.contact_person || null,
              phone: record.phone || null,
              city: record.city || null,
            });
          }
          synced++;
        } catch (err) {
          failed++;
          details[`supplier_${record.name || 'unknown'}`] = err.message;
        }
      }

      await this.logSync(integrationId, {
        direction: 'inbound',
        entityType: 'suppliers',
        recordsSynced: synced,
        recordsFailed: failed,
        status: failed === 0 ? 'Success' : synced > 0 ? 'Partial' : 'Failed',
        details,
        startedAt,
      });

      return { synced, failed, details };
    } catch (err) {
      await this.logSync(integrationId, {
        direction: 'inbound',
        entityType: 'suppliers',
        recordsSynced: 0,
        recordsFailed: 0,
        status: 'Failed',
        details: { error: err.message },
        startedAt,
      });
      throw err;
    }
  },

  /**
   * Sync products from CRM API.
   */
  async syncCRMProducts(integrationId) {
    const integration = await this.getIntegration(integrationId);
    if (!integration) throw new Error('Integration not found');

    const startedAt = new Date();
    let synced = 0;
    let failed = 0;
    const details = {};

    try {
      const baseUrl = integration.base_url.replace(/\/$/, '');
      const headers = this._buildAuthHeaders(integration);
      const response = await fetch(`${baseUrl}/products`, { headers });

      if (!response.ok) throw new Error(`CRM API returned ${response.status}`);

      const data = await response.json();
      const records = Array.isArray(data) ? data : data.data || [];

      for (const record of records) {
        try {
          const existing = await db('products').where({ name: record.name }).first();
          if (existing) {
            await db('products').where({ id: existing.id }).update({
              category: record.category || existing.category,
              variety: record.variety || existing.variety,
              updated_at: db.fn.now(),
            });
          } else {
            await db('products').insert({
              name: record.name,
              category: record.category || null,
              variety: record.variety || null,
              unit: record.unit || 'KG',
            });
          }
          synced++;
        } catch (err) {
          failed++;
          details[`product_${record.name || 'unknown'}`] = err.message;
        }
      }

      await this.logSync(integrationId, {
        direction: 'inbound',
        entityType: 'products',
        recordsSynced: synced,
        recordsFailed: failed,
        status: failed === 0 ? 'Success' : synced > 0 ? 'Partial' : 'Failed',
        details,
        startedAt,
      });

      return { synced, failed, details };
    } catch (err) {
      await this.logSync(integrationId, {
        direction: 'inbound',
        entityType: 'products',
        recordsSynced: 0,
        recordsFailed: 0,
        status: 'Failed',
        details: { error: err.message },
        startedAt,
      });
      throw err;
    }
  },

  /**
   * Sync bank accounts from CRM API.
   */
  async syncCRMBankAccounts(integrationId) {
    const integration = await this.getIntegration(integrationId);
    if (!integration) throw new Error('Integration not found');

    const startedAt = new Date();
    let synced = 0;
    let failed = 0;
    const details = {};

    try {
      const baseUrl = integration.base_url.replace(/\/$/, '');
      const headers = this._buildAuthHeaders(integration);
      const response = await fetch(`${baseUrl}/bank-accounts`, { headers });

      if (!response.ok) throw new Error(`CRM API returned ${response.status}`);

      const data = await response.json();
      const records = Array.isArray(data) ? data : data.data || [];

      for (const record of records) {
        try {
          const existing = await db('bank_accounts').where({ account_number: record.account_number }).first();
          if (existing) {
            await db('bank_accounts').where({ id: existing.id }).update({
              bank_name: record.bank_name || existing.bank_name,
              branch: record.branch || existing.branch,
              updated_at: db.fn.now(),
            });
          } else {
            await db('bank_accounts').insert({
              bank_name: record.bank_name,
              account_number: record.account_number,
              account_title: record.account_title || record.bank_name,
              branch: record.branch || null,
              currency: record.currency || 'PKR',
            });
          }
          synced++;
        } catch (err) {
          failed++;
          details[`bank_${record.account_number || 'unknown'}`] = err.message;
        }
      }

      await this.logSync(integrationId, {
        direction: 'inbound',
        entityType: 'bank_accounts',
        recordsSynced: synced,
        recordsFailed: failed,
        status: failed === 0 ? 'Success' : synced > 0 ? 'Partial' : 'Failed',
        details,
        startedAt,
      });

      return { synced, failed, details };
    } catch (err) {
      await this.logSync(integrationId, {
        direction: 'inbound',
        entityType: 'bank_accounts',
        recordsSynced: 0,
        recordsFailed: 0,
        status: 'Failed',
        details: { error: err.message },
        startedAt,
      });
      throw err;
    }
  },

  /**
   * Full CRM sync — run all 4 entity syncs and aggregate.
   */
  async fullCRMSync(integrationId) {
    const results = {
      customers: null,
      suppliers: null,
      products: null,
      bankAccounts: null,
    };
    const errors = [];

    try {
      results.customers = await this.syncCRMCustomers(integrationId);
    } catch (err) {
      errors.push({ entity: 'customers', error: err.message });
    }

    try {
      results.suppliers = await this.syncCRMSuppliers(integrationId);
    } catch (err) {
      errors.push({ entity: 'suppliers', error: err.message });
    }

    try {
      results.products = await this.syncCRMProducts(integrationId);
    } catch (err) {
      errors.push({ entity: 'products', error: err.message });
    }

    try {
      results.bankAccounts = await this.syncCRMBankAccounts(integrationId);
    } catch (err) {
      errors.push({ entity: 'bankAccounts', error: err.message });
    }

    // Update last sync
    await db('api_integrations').where({ id: integrationId }).update({
      last_sync: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const totalSynced = Object.values(results).reduce((sum, r) => sum + (r ? r.synced : 0), 0);
    const totalFailed = Object.values(results).reduce((sum, r) => sum + (r ? r.failed : 0), 0);

    return {
      totalSynced,
      totalFailed,
      results,
      errors,
      status: errors.length === 0 ? 'Success' : errors.length < 4 ? 'Partial' : 'Failed',
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // BANK STATEMENT IMPORT
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Import a bank statement file and attempt auto-matching.
   */
  async importBankStatement(integrationId, { fileData, bankAccountId }) {
    if (!fileData || !bankAccountId) {
      throw new Error('fileData and bankAccountId are required');
    }

    const bankAccount = await db('bank_accounts').where({ id: bankAccountId }).first();
    if (!bankAccount) throw new Error('Bank account not found');

    // Parse CSV lines
    const lines = fileData.split('\n').filter((l) => l.trim());
    if (lines.length < 2) throw new Error('Bank statement file is empty or has no data rows');

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
    const rows = lines.slice(1).map((line) => {
      const vals = line.split(',').map((v) => v.trim().replace(/"/g, ''));
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = vals[i] || '';
      });
      return obj;
    });

    let imported = 0;
    let matched = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const amount = parseFloat(row.amount || row.debit || row.credit || '0');
        const txDate = row.date || row.transaction_date || new Date().toISOString().slice(0, 10);
        const description = row.description || row.narration || row.details || '';

        // Insert as bank reconciliation item (if table exists)
        const hasReconTable = await db.schema.hasTable('bank_reconciliation_items');
        if (hasReconTable) {
          await db('bank_reconciliation_items').insert({
            bank_account_id: bankAccountId,
            transaction_date: txDate,
            description,
            amount,
            status: 'Unmatched',
          });
        }

        imported++;

        // Try auto-matching against receivables/payables by amount
        if (amount > 0) {
          const hasReceivables = await db.schema.hasTable('receivables');
          if (hasReceivables) {
            const matchedReceivable = await db('receivables')
              .where({ amount, status: 'Pending' })
              .first();
            if (matchedReceivable) {
              matched++;
            }
          }
        }
      } catch (err) {
        errors.push({ row: row, error: err.message });
      }
    }

    await this.logSync(integrationId, {
      direction: 'inbound',
      entityType: 'bank_statement',
      recordsSynced: imported,
      recordsFailed: errors.length,
      status: errors.length === 0 ? 'Success' : imported > 0 ? 'Partial' : 'Failed',
      details: { bankAccountId, matched, errors: errors.slice(0, 10) },
      startedAt: new Date(),
    });

    return { imported, matched, failed: errors.length, errors };
  },

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Build authorization headers for an integration.
   */
  _buildAuthHeaders(integration) {
    const headers = { 'Content-Type': 'application/json' };
    const creds = integration.auth_credentials || {};

    switch (integration.auth_type) {
      case 'bearer':
        if (creds.token) headers['Authorization'] = `Bearer ${creds.token}`;
        break;
      case 'basic':
        if (creds.username && creds.password) {
          const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
        }
        break;
      case 'api_key':
        if (creds.key && creds.header) {
          headers[creds.header] = creds.key;
        }
        break;
    }
    return headers;
  },

  /**
   * Log a sync operation.
   */
  async logSync(integrationId, { direction, entityType, recordsSynced, recordsFailed, status, details, startedAt }) {
    const [log] = await db('api_sync_log')
      .insert({
        integration_id: integrationId,
        direction,
        entity_type: entityType,
        records_synced: recordsSynced,
        records_failed: recordsFailed,
        status,
        details: details ? JSON.stringify(details) : null,
        started_at: startedAt || new Date(),
        completed_at: new Date(),
      })
      .returning('*');
    return log;
  },

  /**
   * Get sync history for an integration.
   */
  async getSyncHistory(integrationId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const query = db('api_sync_log')
      .where({ integration_id: integrationId })
      .orderBy('started_at', 'desc');

    const [{ count }] = await query.clone().count('id as count');
    const rows = await query.offset(offset).limit(limit);

    return {
      history: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: parseInt(count, 10),
        totalPages: Math.ceil(count / limit),
      },
    };
  },
};

module.exports = integrationService;
