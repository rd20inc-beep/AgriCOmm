const db = require('../config/database');

/**
 * Background Job Processor — Phase 10 (Enterprise)
 * Manages background jobs, data imports, bulk operations.
 */
const jobService = {
  // ═══════════════════════════════════════════════════════════════════
  // JOB LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Create a new background job.
   */
  async createJob(trx, { jobType, name, inputData, userId }) {
    const conn = trx || db;
    const [job] = await conn('background_jobs')
      .insert({
        job_type: jobType,
        name,
        status: 'Pending',
        progress: 0,
        input_data: inputData ? JSON.stringify(inputData) : null,
        created_by: userId,
      })
      .returning('*');
    return job;
  },

  /**
   * Mark job as running.
   */
  async startJob(jobId) {
    const [job] = await db('background_jobs')
      .where({ id: jobId })
      .update({
        status: 'Running',
        started_at: db.fn.now(),
      })
      .returning('*');
    return job;
  },

  /**
   * Update job progress counters.
   */
  async updateProgress(jobId, { processedItems, failedItems, progress }) {
    const updates = {};
    if (processedItems !== undefined) updates.processed_items = processedItems;
    if (failedItems !== undefined) updates.failed_items = failedItems;
    if (progress !== undefined) updates.progress = progress;

    const [job] = await db('background_jobs')
      .where({ id: jobId })
      .update(updates)
      .returning('*');
    return job;
  },

  /**
   * Mark job as completed.
   */
  async completeJob(jobId, { resultData } = {}) {
    const [job] = await db('background_jobs')
      .where({ id: jobId })
      .update({
        status: 'Completed',
        progress: 100,
        completed_at: db.fn.now(),
        result_data: resultData ? JSON.stringify(resultData) : null,
      })
      .returning('*');
    return job;
  },

  /**
   * Mark job as failed.
   */
  async failJob(jobId, { error }) {
    const [job] = await db('background_jobs')
      .where({ id: jobId })
      .update({
        status: 'Failed',
        error: typeof error === 'string' ? error : JSON.stringify(error),
        completed_at: db.fn.now(),
      })
      .returning('*');
    return job;
  },

  /**
   * Cancel a pending or running job.
   */
  async cancelJob(jobId) {
    const [job] = await db('background_jobs')
      .where({ id: jobId })
      .whereIn('status', ['Pending', 'Running'])
      .update({
        status: 'Cancelled',
        completed_at: db.fn.now(),
      })
      .returning('*');
    return job;
  },

  /**
   * Get a single job by ID.
   */
  async getJob(jobId) {
    return db('background_jobs').where({ id: jobId }).first();
  },

  /**
   * List jobs with optional filters.
   */
  async getJobs({ status, jobType, page = 1, limit = 20 } = {}) {
    const query = db('background_jobs').orderBy('created_at', 'desc');
    if (status) query.where({ status });
    if (jobType) query.where({ job_type: jobType });

    const offset = (page - 1) * limit;
    const [{ count }] = await query.clone().count('id as count');
    const rows = await query.offset(offset).limit(limit);

    return {
      jobs: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: parseInt(count, 10),
        totalPages: Math.ceil(count / limit),
      },
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // IMPORT PROCESSORS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Main import processor — dispatches based on import_type.
   */
  async processImport(jobId, importId) {
    const importRecord = await db('data_imports').where({ id: importId }).first();
    if (!importRecord) throw new Error(`Import ${importId} not found`);

    await this.startJob(jobId);
    await db('data_imports').where({ id: importId }).update({ status: 'Processing' });

    try {
      const inputData = importRecord.file_path
        ? require('fs').readFileSync(importRecord.file_path, 'utf8')
        : null;

      let rows = [];
      if (inputData) {
        try {
          rows = JSON.parse(inputData);
        } catch {
          // Try CSV parse (simple split)
          const lines = inputData.split('\n').filter((l) => l.trim());
          if (lines.length > 1) {
            const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
            rows = lines.slice(1).map((line) => {
              const vals = line.split(',').map((v) => v.trim().replace(/"/g, ''));
              const obj = {};
              headers.forEach((h, i) => {
                obj[h] = vals[i] || '';
              });
              return obj;
            });
          }
        }
      }

      await db('data_imports').where({ id: importId }).update({ total_rows: rows.length });
      await this.updateProgress(jobId, { processedItems: 0, progress: 0 });

      let result;
      switch (importRecord.import_type) {
        case 'customers':
          result = await this.importCustomers(rows, jobId);
          break;
        case 'suppliers':
          result = await this.importSuppliers(rows, jobId);
          break;
        case 'products':
          result = await this.importProducts(rows, jobId);
          break;
        case 'opening_balances':
          result = await this.importOpeningBalances(rows, jobId);
          break;
        default:
          throw new Error(`Unsupported import type: ${importRecord.import_type}`);
      }

      await db('data_imports').where({ id: importId }).update({
        imported_rows: result.imported,
        failed_rows: result.failed,
        errors: JSON.stringify(result.errors),
        status: result.failed > 0 && result.imported === 0 ? 'Failed' : 'Completed',
      });

      await this.completeJob(jobId, {
        resultData: {
          imported: result.imported,
          failed: result.failed,
          totalErrors: result.errors.length,
        },
      });

      return result;
    } catch (err) {
      await db('data_imports').where({ id: importId }).update({ status: 'Failed' });
      await this.failJob(jobId, { error: err.message });
      throw err;
    }
  },

  /**
   * Import customer rows. Validates and upserts.
   */
  async importCustomers(rows, jobId) {
    const imported = [];
    const errors = [];
    let processed = 0;

    for (const row of rows) {
      processed++;
      try {
        if (!row.name) {
          errors.push({ row: processed, field: 'name', error: 'Name is required' });
          continue;
        }

        const existing = await db('customers').where({ name: row.name }).first();
        if (existing) {
          await db('customers').where({ id: existing.id }).update({
            company: row.company || existing.company,
            email: row.email || existing.email,
            phone: row.phone || existing.phone,
            country: row.country || existing.country,
            city: row.city || existing.city,
            updated_at: db.fn.now(),
          });
        } else {
          await db('customers').insert({
            name: row.name,
            company: row.company || null,
            email: row.email || null,
            phone: row.phone || null,
            country: row.country || null,
            city: row.city || null,
          });
        }
        imported.push(row);
      } catch (err) {
        errors.push({ row: processed, field: null, error: err.message });
      }

      if (processed % 10 === 0 || processed === rows.length) {
        const progress = Math.round((processed / rows.length) * 100);
        await this.updateProgress(jobId, {
          processedItems: processed,
          failedItems: errors.length,
          progress,
        });
      }
    }

    return { imported: imported.length, failed: errors.length, errors };
  },

  /**
   * Import supplier rows. Validates and upserts.
   */
  async importSuppliers(rows, jobId) {
    const imported = [];
    const errors = [];
    let processed = 0;

    for (const row of rows) {
      processed++;
      try {
        if (!row.name) {
          errors.push({ row: processed, field: 'name', error: 'Name is required' });
          continue;
        }

        const existing = await db('suppliers').where({ name: row.name }).first();
        if (existing) {
          await db('suppliers').where({ id: existing.id }).update({
            contact_person: row.contact_person || existing.contact_person,
            phone: row.phone || existing.phone,
            city: row.city || existing.city,
            updated_at: db.fn.now(),
          });
        } else {
          await db('suppliers').insert({
            name: row.name,
            contact_person: row.contact_person || null,
            phone: row.phone || null,
            city: row.city || null,
          });
        }
        imported.push(row);
      } catch (err) {
        errors.push({ row: processed, field: null, error: err.message });
      }

      if (processed % 10 === 0 || processed === rows.length) {
        const progress = Math.round((processed / rows.length) * 100);
        await this.updateProgress(jobId, {
          processedItems: processed,
          failedItems: errors.length,
          progress,
        });
      }
    }

    return { imported: imported.length, failed: errors.length, errors };
  },

  /**
   * Import product rows. Validates and upserts.
   */
  async importProducts(rows, jobId) {
    const imported = [];
    const errors = [];
    let processed = 0;

    for (const row of rows) {
      processed++;
      try {
        if (!row.name) {
          errors.push({ row: processed, field: 'name', error: 'Product name is required' });
          continue;
        }

        const existing = await db('products').where({ name: row.name }).first();
        if (existing) {
          await db('products').where({ id: existing.id }).update({
            category: row.category || existing.category,
            variety: row.variety || existing.variety,
            unit: row.unit || existing.unit,
            updated_at: db.fn.now(),
          });
        } else {
          await db('products').insert({
            name: row.name,
            category: row.category || null,
            variety: row.variety || null,
            unit: row.unit || 'KG',
          });
        }
        imported.push(row);
      } catch (err) {
        errors.push({ row: processed, field: null, error: err.message });
      }

      if (processed % 10 === 0 || processed === rows.length) {
        const progress = Math.round((processed / rows.length) * 100);
        await this.updateProgress(jobId, {
          processedItems: processed,
          failedItems: errors.length,
          progress,
        });
      }
    }

    return { imported: imported.length, failed: errors.length, errors };
  },

  /**
   * Import opening balances for accounts.
   */
  async importOpeningBalances(rows, jobId) {
    const imported = [];
    const errors = [];
    let processed = 0;

    for (const row of rows) {
      processed++;
      try {
        if (!row.account_code || (!row.debit && !row.credit)) {
          errors.push({
            row: processed,
            field: row.account_code ? 'debit/credit' : 'account_code',
            error: 'Account code and at least one of debit/credit is required',
          });
          continue;
        }

        const account = await db('chart_of_accounts')
          .where({ account_code: row.account_code })
          .first();

        if (!account) {
          errors.push({ row: processed, field: 'account_code', error: `Account ${row.account_code} not found` });
          continue;
        }

        const seqNum = imported.length + 1;
        const [journal] = await db('journal_entries').insert({
          journal_no: `OB-${String(seqNum).padStart(4, '0')}`,
          date: row.date || new Date().toISOString().slice(0, 10),
          entity: null,
          ref_type: 'Opening Balance',
          ref_no: `OB-${row.account_code}`,
          description: row.description || `Opening balance for ${account.name}`,
          status: 'Posted',
          total_debit: parseFloat(row.debit) || 0,
          total_credit: parseFloat(row.credit) || 0,
        }).returning('id');
        await db('journal_lines').insert({
          journal_id: journal.id,
          account: account.name,
          debit: parseFloat(row.debit) || 0,
          credit: parseFloat(row.credit) || 0,
          narration: `Opening balance import`,
        });

        imported.push(row);
      } catch (err) {
        errors.push({ row: processed, field: null, error: err.message });
      }

      if (processed % 10 === 0 || processed === rows.length) {
        const progress = Math.round((processed / rows.length) * 100);
        await this.updateProgress(jobId, {
          processedItems: processed,
          failedItems: errors.length,
          progress,
        });
      }
    }

    return { imported: imported.length, failed: errors.length, errors };
  },

  // ═══════════════════════════════════════════════════════════════════
  // SYNC PROCESSORS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Sync data from AgriCRM integration.
   */
  async syncFromCRM(integrationId) {
    const integration = await db('api_integrations').where({ id: integrationId }).first();
    if (!integration) throw new Error(`Integration ${integrationId} not found`);
    if (!integration.is_active) throw new Error('Integration is not active');

    const job = await this.createJob(null, {
      jobType: 'sync',
      name: `CRM Sync — ${integration.name}`,
      inputData: { integrationId },
    });

    await this.startJob(job.id);

    const startedAt = new Date();
    let totalSynced = 0;
    let totalFailed = 0;
    const details = {};

    try {
      // Attempt to sync each entity type
      const entityTypes = ['customers', 'suppliers', 'products'];
      for (const entityType of entityTypes) {
        try {
          const baseUrl = integration.base_url.replace(/\/$/, '');
          const url = `${baseUrl}/${entityType}`;

          // Use dynamic import for fetch (Node 18+)
          const response = await fetch(url, {
            headers: this._buildAuthHeaders(integration),
          });

          if (!response.ok) {
            details[entityType] = { status: 'Failed', error: `HTTP ${response.status}` };
            totalFailed++;
            continue;
          }

          const data = await response.json();
          const records = Array.isArray(data) ? data : data.data || [];
          details[entityType] = { status: 'Success', count: records.length };
          totalSynced += records.length;
        } catch (err) {
          details[entityType] = { status: 'Failed', error: err.message };
          totalFailed++;
        }
      }

      // Log sync result
      await db('api_sync_log').insert({
        integration_id: integrationId,
        direction: 'inbound',
        entity_type: 'all',
        records_synced: totalSynced,
        records_failed: totalFailed,
        status: totalFailed === 0 ? 'Success' : totalFailed < entityTypes.length ? 'Partial' : 'Failed',
        details: JSON.stringify(details),
        started_at: startedAt,
        completed_at: new Date(),
      });

      // Update last sync timestamp
      await db('api_integrations').where({ id: integrationId }).update({
        last_sync: db.fn.now(),
        updated_at: db.fn.now(),
      });

      await this.completeJob(job.id, { resultData: { totalSynced, totalFailed, details } });
      return { totalSynced, totalFailed, details, jobId: job.id };
    } catch (err) {
      await this.failJob(job.id, { error: err.message });
      throw err;
    }
  },

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

  // ═══════════════════════════════════════════════════════════════════
  // BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Bulk update status for records in a given table.
   */
  async bulkUpdateStatus(tableName, ids, newStatus, userId) {
    const allowedTables = [
      'export_orders', 'milling_batches', 'purchase_orders',
      'invoices', 'payments', 'background_jobs',
    ];
    if (!allowedTables.includes(tableName)) {
      throw new Error(`Bulk status update not allowed for table: ${tableName}`);
    }
    if (!ids || !ids.length) throw new Error('No IDs provided');

    const updated = await db(tableName)
      .whereIn('id', ids)
      .update({ status: newStatus, updated_at: db.fn.now() });

    return { table: tableName, updated, newStatus };
  },

  /**
   * Bulk archive (soft delete) records.
   */
  async bulkArchive(tableName, ids) {
    const allowedTables = [
      'customers', 'suppliers', 'products',
      'export_orders', 'purchase_orders',
    ];
    if (!allowedTables.includes(tableName)) {
      throw new Error(`Bulk archive not allowed for table: ${tableName}`);
    }
    if (!ids || !ids.length) throw new Error('No IDs provided');

    // Check if table has is_active column, otherwise use status
    const hasIsActive = await db.schema.hasColumn(tableName, 'is_active');
    let updated;
    if (hasIsActive) {
      updated = await db(tableName).whereIn('id', ids).update({ is_active: false });
    } else {
      updated = await db(tableName).whereIn('id', ids).update({ status: 'Archived', updated_at: db.fn.now() });
    }

    return { table: tableName, archived: updated };
  },

  /**
   * Bulk export records as JSON (extensible to CSV/Excel).
   */
  async bulkExport(tableName, filters, format = 'json') {
    const allowedTables = [
      'customers', 'suppliers', 'products', 'export_orders',
      'milling_batches', 'purchase_orders', 'invoices', 'payments',
      'journal_entries', 'chart_of_accounts',
    ];
    if (!allowedTables.includes(tableName)) {
      throw new Error(`Export not allowed for table: ${tableName}`);
    }

    const query = db(tableName);

    // Apply filters
    if (filters) {
      if (filters.status) query.where({ status: filters.status });
      if (filters.dateFrom) query.where('created_at', '>=', filters.dateFrom);
      if (filters.dateTo) query.where('created_at', '<=', filters.dateTo);
      if (filters.ids) query.whereIn('id', filters.ids);
    }

    const rows = await query.orderBy('id', 'asc');

    if (format === 'csv') {
      if (rows.length === 0) return { data: '', rowCount: 0, format: 'csv' };
      const headers = Object.keys(rows[0]);
      const csvLines = [headers.join(',')];
      for (const row of rows) {
        const line = headers.map((h) => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
          return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
        });
        csvLines.push(line.join(','));
      }
      return { data: csvLines.join('\n'), rowCount: rows.length, format: 'csv' };
    }

    return { data: rows, rowCount: rows.length, format: 'json' };
  },
};

module.exports = jobService;
