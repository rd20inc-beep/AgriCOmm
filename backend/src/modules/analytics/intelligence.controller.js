const intelligenceService = require('../../services/intelligenceService');
const db = require('../../config/database');

/**
 * Intelligence Controller — Phase 12
 * Exception inbox, risk monitoring, root cause analysis, dashboard data.
 */
const intelligenceController = {
  // ═══════════════════════════════════════════════════════════════════
  // EXCEPTION INBOX
  // ═══════════════════════════════════════════════════════════════════

  async scanExceptions(req, res) {
    try {
      const summary = await intelligenceService.scanAllExceptions();
      return res.json({ success: true, data: summary, message: `Exception scan complete. ${summary.total} new exception(s) created.` });
    } catch (err) {
      console.error('Scan exceptions error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async listExceptions(req, res) {
    try {
      const { status, severity, entity, exception_type, assigned_to, page, limit } = req.query;
      const result = await intelligenceService.getExceptions({
        status,
        severity,
        entity,
        exceptionType: exception_type,
        assignedTo: assigned_to ? parseInt(assigned_to, 10) : undefined,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 25,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('List exceptions error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getExceptionStats(req, res) {
    try {
      const stats = await intelligenceService.getExceptionStats();
      return res.json({ success: true, data: stats });
    } catch (err) {
      console.error('Exception stats error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async acknowledgeException(req, res) {
    try {
      const result = await intelligenceService.acknowledgeException(
        parseInt(req.params.id, 10),
        req.user.id
      );
      return res.json({ success: true, data: result, message: 'Exception acknowledged.' });
    } catch (err) {
      console.error('Acknowledge exception error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async assignException(req, res) {
    try {
      const { assigned_to } = req.body;
      if (!assigned_to) {
        return res.status(400).json({ success: false, message: 'assigned_to is required.' });
      }
      const result = await intelligenceService.assignException(
        parseInt(req.params.id, 10),
        parseInt(assigned_to, 10),
        req.user.id
      );
      return res.json({ success: true, data: result, message: 'Exception assigned.' });
    } catch (err) {
      console.error('Assign exception error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async resolveException(req, res) {
    try {
      const { resolution_notes } = req.body;
      const result = await intelligenceService.resolveException(
        parseInt(req.params.id, 10),
        { resolutionNotes: resolution_notes, userId: req.user.id }
      );
      return res.json({ success: true, data: result, message: 'Exception resolved.' });
    } catch (err) {
      console.error('Resolve exception error:', err);
      const status = err.message.includes('not found') || err.message.includes('already') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async snoozeException(req, res) {
    try {
      const { snoozed_until } = req.body;
      if (!snoozed_until) {
        return res.status(400).json({ success: false, message: 'snoozed_until date is required.' });
      }
      const result = await intelligenceService.snoozeException(
        parseInt(req.params.id, 10),
        { snoozedUntil: snoozed_until, userId: req.user.id }
      );
      return res.json({ success: true, data: result, message: `Exception snoozed until ${snoozed_until}.` });
    } catch (err) {
      console.error('Snooze exception error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async escalateException(req, res) {
    try {
      const result = await intelligenceService.escalateException(
        parseInt(req.params.id, 10),
        req.user.id
      );
      return res.json({ success: true, data: result, message: 'Exception escalated to critical.' });
    } catch (err) {
      console.error('Escalate exception error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // RISK MONITORING
  // ═══════════════════════════════════════════════════════════════════

  async calculateOrderRisk(req, res) {
    try {
      const result = await intelligenceService.calculateOrderRisk(parseInt(req.params.id, 10));
      return res.json({ success: true, data: result, message: `Risk calculated for order: ${result.risk_level} (${result.risk_score}).` });
    } catch (err) {
      console.error('Calculate order risk error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async calculateCustomerRisk(req, res) {
    try {
      const result = await intelligenceService.calculateCustomerRisk(parseInt(req.params.id, 10));
      return res.json({ success: true, data: result, message: `Risk calculated for customer: ${result.risk_level} (${result.risk_score}).` });
    } catch (err) {
      console.error('Calculate customer risk error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getTopRiskOrders(req, res) {
    try {
      const limit = parseInt(req.query.limit, 10) || 10;
      const data = await intelligenceService.getTopRiskOrders(limit);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Top risk orders error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getTopRiskCustomers(req, res) {
    try {
      const limit = parseInt(req.query.limit, 10) || 10;
      const data = await intelligenceService.getTopRiskCustomers(limit);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Top risk customers error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getRiskDashboard(req, res) {
    try {
      const data = await intelligenceService.getRiskDashboard();
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Risk dashboard error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // ROOT CAUSE ANALYSIS
  // ═══════════════════════════════════════════════════════════════════

  async analyzeMarginDrop(req, res) {
    try {
      const result = await intelligenceService.analyzeMarginDrop(
        parseInt(req.params.orderId, 10),
        req.user.id
      );
      return res.status(201).json({ success: true, data: result, message: 'Margin drop analysis complete.' });
    } catch (err) {
      console.error('Analyze margin drop error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async analyzeCostOverrun(req, res) {
    try {
      const result = await intelligenceService.analyzeCostOverrun(
        parseInt(req.params.orderId, 10),
        req.user.id
      );
      return res.status(201).json({ success: true, data: result, message: 'Cost overrun analysis complete.' });
    } catch (err) {
      console.error('Analyze cost overrun error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async analyzeYieldLoss(req, res) {
    try {
      const result = await intelligenceService.analyzeYieldLoss(
        parseInt(req.params.batchId, 10),
        req.user.id
      );
      return res.status(201).json({ success: true, data: result, message: 'Yield loss analysis complete.' });
    } catch (err) {
      console.error('Analyze yield loss error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async analyzePaymentDelay(req, res) {
    try {
      const result = await intelligenceService.analyzePaymentDelay(
        parseInt(req.params.orderId, 10),
        req.user.id
      );
      return res.status(201).json({ success: true, data: result, message: 'Payment delay analysis complete.' });
    } catch (err) {
      console.error('Analyze payment delay error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async listRootCauseAnalyses(req, res) {
    try {
      const { linked_type, linked_id, analysis_type, page, limit } = req.query;
      const result = await intelligenceService.getRootCauseAnalyses({
        linkedType: linked_type,
        linkedId: linked_id ? parseInt(linked_id, 10) : undefined,
        analysisType: analysis_type,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 25,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('List RCA error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════

  async getDashboardData(req, res) {
    try {
      const { entity, date_from, date_to } = req.query;
      const data = await intelligenceService.getDashboardData({
        entity,
        dateFrom: date_from,
        dateTo: date_to,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Dashboard data error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getKPIDrilldown(req, res) {
    try {
      const kpiName = req.params.kpi;
      const { entity, date_from, date_to, page, limit } = req.query;
      const data = await intelligenceService.getKPIDrilldown(kpiName, {
        entity,
        dateFrom: date_from,
        dateTo: date_to,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 25,
      });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('KPI drilldown error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async saveSnapshot(req, res) {
    try {
      const { entity } = req.body;
      const result = await intelligenceService.saveSnapshot(entity);
      return res.status(201).json({ success: true, data: result, message: 'Dashboard snapshot saved.' });
    } catch (err) {
      console.error('Save snapshot error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getSnapshotHistory(req, res) {
    try {
      const { entity, date_from, date_to } = req.query;
      const data = await intelligenceService.getSnapshotHistory({
        entity,
        dateFrom: date_from,
        dateTo: date_to,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Snapshot history error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },
};

module.exports = intelligenceController;
