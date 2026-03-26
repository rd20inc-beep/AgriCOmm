const jobService = require('../services/jobService');
const healthService = require('../services/healthService');
const integrationService = require('../services/integrationService');
const db = require('../config/database');

/**
 * Enterprise Controller — Phase 10
 * Jobs, Imports, Integrations, Health, Preferences, Bulk Ops.
 */
const enterpriseController = {
  // ═══════════════════════════════════════════════════════════════════
  // BACKGROUND JOBS
  // ═══════════════════════════════════════════════════════════════════

  async listJobs(req, res) {
    try {
      const { status, job_type, page, limit } = req.query;
      const data = await jobService.getJobs({ status, jobType: job_type, page, limit });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('List jobs error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getJob(req, res) {
    try {
      const job = await jobService.getJob(req.params.id);
      if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });
      return res.json({ success: true, data: job });
    } catch (err) {
      console.error('Get job error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async cancelJob(req, res) {
    try {
      const job = await jobService.cancelJob(req.params.id);
      if (!job) {
        return res.status(404).json({ success: false, message: 'Job not found or not cancellable.' });
      }
      return res.json({ success: true, data: job, message: 'Job cancelled.' });
    } catch (err) {
      console.error('Cancel job error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // DATA IMPORTS
  // ═══════════════════════════════════════════════════════════════════

  async listImports(req, res) {
    try {
      const { status, import_type, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;
      const query = db('data_imports').orderBy('created_at', 'desc');
      if (status) query.where({ status });
      if (import_type) query.where({ import_type });

      const [{ count }] = await query.clone().count('id as count');
      const rows = await query.offset(offset).limit(limit);

      return res.json({
        success: true,
        data: rows,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: parseInt(count, 10),
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (err) {
      console.error('List imports error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createImport(req, res) {
    try {
      const { import_type, file_name, file_path, data: rawData } = req.body;
      if (!import_type) {
        return res.status(400).json({ success: false, message: 'import_type is required.' });
      }

      const validTypes = ['customers', 'suppliers', 'products', 'bank_accounts', 'inventory', 'opening_balances'];
      if (!validTypes.includes(import_type)) {
        return res.status(400).json({ success: false, message: `Invalid import_type. Must be one of: ${validTypes.join(', ')}` });
      }

      // Create the background job
      const job = await jobService.createJob(null, {
        jobType: 'import',
        name: `Import ${import_type}`,
        inputData: { import_type, file_name },
        userId: req.user.id,
      });

      // Create the import record
      const [importRecord] = await db('data_imports')
        .insert({
          import_type,
          file_name: file_name || null,
          file_path: file_path || null,
          status: 'Pending',
          job_id: job.id,
          created_by: req.user.id,
        })
        .returning('*');

      // If inline data provided, save to temp file and process
      if (rawData && Array.isArray(rawData)) {
        const fs = require('fs');
        const path = require('path');
        const tempDir = path.join(__dirname, '../../uploads/imports');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const tempFile = path.join(tempDir, `import_${importRecord.id}.json`);
        fs.writeFileSync(tempFile, JSON.stringify(rawData));
        await db('data_imports').where({ id: importRecord.id }).update({
          file_path: tempFile,
          total_rows: rawData.length,
        });
      }

      // Process asynchronously (non-blocking)
      setImmediate(async () => {
        try {
          await jobService.processImport(job.id, importRecord.id);
        } catch (err) {
          console.error(`Import processing failed for job ${job.id}:`, err);
        }
      });

      return res.status(201).json({
        success: true,
        data: { import: importRecord, job },
        message: 'Import created and processing started.',
      });
    } catch (err) {
      console.error('Create import error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getImport(req, res) {
    try {
      const importRecord = await db('data_imports').where({ id: req.params.id }).first();
      if (!importRecord) {
        return res.status(404).json({ success: false, message: 'Import not found.' });
      }

      // Include job info if available
      let job = null;
      if (importRecord.job_id) {
        job = await jobService.getJob(importRecord.job_id);
      }

      return res.json({ success: true, data: { import: importRecord, job } });
    } catch (err) {
      console.error('Get import error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // API INTEGRATIONS
  // ═══════════════════════════════════════════════════════════════════

  async listIntegrations(req, res) {
    try {
      const integrations = await integrationService.getIntegrations();
      return res.json({ success: true, data: integrations });
    } catch (err) {
      console.error('List integrations error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createIntegration(req, res) {
    try {
      const { name, base_url, auth_type, auth_credentials, is_active, sync_frequency, config } = req.body;
      if (!name) {
        return res.status(400).json({ success: false, message: 'Integration name is required.' });
      }
      const integration = await integrationService.createIntegration({
        name, base_url, auth_type, auth_credentials, is_active, sync_frequency, config,
      });
      return res.status(201).json({ success: true, data: integration, message: 'Integration created.' });
    } catch (err) {
      console.error('Create integration error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateIntegration(req, res) {
    try {
      const integration = await integrationService.updateIntegration(req.params.id, req.body);
      if (!integration) {
        return res.status(404).json({ success: false, message: 'Integration not found.' });
      }
      return res.json({ success: true, data: integration, message: 'Integration updated.' });
    } catch (err) {
      console.error('Update integration error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async triggerSync(req, res) {
    try {
      const integration = await integrationService.getIntegration(req.params.id);
      if (!integration) {
        return res.status(404).json({ success: false, message: 'Integration not found.' });
      }

      // Run sync asynchronously
      const result = await integrationService.fullCRMSync(req.params.id);
      return res.json({ success: true, data: result, message: 'Sync completed.' });
    } catch (err) {
      console.error('Trigger sync error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Sync failed.' });
    }
  },

  async syncHistory(req, res) {
    try {
      const { page, limit } = req.query;
      const data = await integrationService.getSyncHistory(req.params.id, { page, limit });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Sync history error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // CRM SYNC SHORTCUT
  // ═══════════════════════════════════════════════════════════════════

  async fullCRMSync(req, res) {
    try {
      // Find the agri_crm integration
      const integration = await db('api_integrations').where({ name: 'agri_crm' }).first();
      if (!integration) {
        return res.status(404).json({ success: false, message: 'AgriCRM integration not configured.' });
      }
      const result = await integrationService.fullCRMSync(integration.id);
      return res.json({ success: true, data: result, message: 'Full CRM sync completed.' });
    } catch (err) {
      console.error('Full CRM sync error:', err);
      return res.status(500).json({ success: false, message: err.message || 'CRM sync failed.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // SYSTEM HEALTH
  // ═══════════════════════════════════════════════════════════════════

  async healthCheck(req, res) {
    try {
      const checks = await healthService.runAllChecks();
      const overallStatus = checks.some((c) => c.status === 'Critical')
        ? 'Critical'
        : checks.some((c) => c.status === 'Warning')
          ? 'Warning'
          : 'Healthy';

      return res.json({
        success: true,
        status: overallStatus,
        checks,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Health check error:', err);
      return res.status(500).json({
        success: false,
        status: 'Critical',
        message: 'Health check failed.',
        error: err.message,
      });
    }
  },

  async healthDetailed(req, res) {
    try {
      const checks = await healthService.runAllChecks();
      const { check_type, limit } = req.query;
      const history = await healthService.getHealthHistory(check_type, limit ? parseInt(limit, 10) : 50);

      const overallStatus = checks.some((c) => c.status === 'Critical')
        ? 'Critical'
        : checks.some((c) => c.status === 'Warning')
          ? 'Warning'
          : 'Healthy';

      return res.json({
        success: true,
        status: overallStatus,
        checks,
        history,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Detailed health check error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async systemMetrics(req, res) {
    try {
      const metrics = await healthService.getSystemMetrics();
      return res.json({ success: true, data: metrics });
    } catch (err) {
      console.error('System metrics error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // USER PREFERENCES
  // ═══════════════════════════════════════════════════════════════════

  async getPreferences(req, res) {
    try {
      let prefs = await db('user_preferences').where({ user_id: req.user.id }).first();
      if (!prefs) {
        // Return defaults
        prefs = {
          user_id: req.user.id,
          language: 'en',
          timezone: 'Asia/Karachi',
          date_format: 'DD/MM/YYYY',
          number_format: 'en-PK',
          currency_display: 'symbol',
          dashboard_layout: null,
          notifications_email: true,
          notifications_push: true,
          notifications_sms: false,
          theme: 'light',
        };
      }
      return res.json({ success: true, data: prefs });
    } catch (err) {
      console.error('Get preferences error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updatePreferences(req, res) {
    try {
      const allowedFields = [
        'language', 'timezone', 'date_format', 'number_format',
        'currency_display', 'dashboard_layout', 'notifications_email',
        'notifications_push', 'notifications_sms', 'theme',
      ];

      const updates = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = field === 'dashboard_layout'
            ? JSON.stringify(req.body[field])
            : req.body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: 'No valid fields to update.' });
      }

      const existing = await db('user_preferences').where({ user_id: req.user.id }).first();

      let prefs;
      if (existing) {
        updates.updated_at = db.fn.now();
        [prefs] = await db('user_preferences')
          .where({ user_id: req.user.id })
          .update(updates)
          .returning('*');
      } else {
        [prefs] = await db('user_preferences')
          .insert({ user_id: req.user.id, ...updates })
          .returning('*');
      }

      return res.json({ success: true, data: prefs, message: 'Preferences updated.' });
    } catch (err) {
      console.error('Update preferences error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════

  async bulkStatusUpdate(req, res) {
    try {
      const { table, ids, status } = req.body;
      if (!table || !ids || !status) {
        return res.status(400).json({ success: false, message: 'table, ids, and status are required.' });
      }
      const result = await jobService.bulkUpdateStatus(table, ids, status, req.user.id);
      return res.json({ success: true, data: result, message: 'Bulk status update completed.' });
    } catch (err) {
      console.error('Bulk status update error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  async bulkArchive(req, res) {
    try {
      const { table, ids } = req.body;
      if (!table || !ids) {
        return res.status(400).json({ success: false, message: 'table and ids are required.' });
      }
      const result = await jobService.bulkArchive(table, ids);
      return res.json({ success: true, data: result, message: 'Bulk archive completed.' });
    } catch (err) {
      console.error('Bulk archive error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  async bulkExport(req, res) {
    try {
      const { table, filters, format } = req.body;
      if (!table) {
        return res.status(400).json({ success: false, message: 'table is required.' });
      }
      const result = await jobService.bulkExport(table, filters, format);

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${table}_export.csv"`);
        return res.send(result.data);
      }

      return res.json({ success: true, data: result.data, rowCount: result.rowCount, format: result.format });
    } catch (err) {
      console.error('Bulk export error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },
};

module.exports = enterpriseController;
