const controlService = require('../services/controlService');
const db = require('../config/database');

/**
 * Control Systems Controller — Phase 11
 * Approvals (maker-checker), Margin Analysis, Supplier/Customer Intelligence,
 * Milling Performance, Stock Counts.
 */
const controlController = {
  // ═══════════════════════════════════════════════════════════════════
  // APPROVALS (Maker-Checker)
  // ═══════════════════════════════════════════════════════════════════

  async submitForApproval(req, res) {
    try {
      const result = await db.transaction(async (trx) => {
        return controlService.submitForApproval(trx, {
          approvalType: req.body.approval_type,
          entityType: req.body.entity_type,
          entityId: req.body.entity_id,
          entityRef: req.body.entity_ref,
          requestedBy: req.user.id,
          currentData: req.body.current_data,
          proposedData: req.body.proposed_data,
          amount: req.body.amount,
          currency: req.body.currency,
          notes: req.body.notes,
          priority: req.body.priority,
        });
      });
      return res.status(201).json({ success: true, data: result, message: 'Request submitted for approval.' });
    } catch (err) {
      console.error('Submit for approval error:', err);
      return res.status(err.message.includes('not found') ? 404 : 500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async approveRequest(req, res) {
    try {
      const result = await db.transaction(async (trx) => {
        return controlService.approveRequest(trx, {
          approvalId: parseInt(req.params.id, 10),
          approvedBy: req.user.id,
          notes: req.body.notes,
        });
      });
      return res.json({ success: true, data: result, message: 'Request approved.' });
    } catch (err) {
      console.error('Approve request error:', err);
      const status = err.message.includes('not found') ? 404
        : err.message.includes('violation') ? 403
        : err.message.includes('Cannot') ? 400
        : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async rejectRequest(req, res) {
    try {
      const result = await db.transaction(async (trx) => {
        return controlService.rejectRequest(trx, {
          approvalId: parseInt(req.params.id, 10),
          rejectedBy: req.user.id,
          reason: req.body.reason,
        });
      });
      return res.json({ success: true, data: result, message: 'Request rejected.' });
    } catch (err) {
      console.error('Reject request error:', err);
      const status = err.message.includes('not found') ? 404 : err.message.includes('Cannot') ? 400 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getPendingApprovals(req, res) {
    try {
      const { approval_type, page, limit } = req.query;
      const result = await controlService.getPendingApprovals({
        userId: req.user.id,
        approvalType: approval_type,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 20,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('Get pending approvals error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getMyRequests(req, res) {
    try {
      const { page, limit } = req.query;
      const result = await controlService.getMyRequests(req.user.id, {
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 20,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('Get my requests error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // MARGIN ANALYSIS
  // ═══════════════════════════════════════════════════════════════════

  async calculateOrderMargin(req, res) {
    try {
      const result = await controlService.calculateOrderMargin(parseInt(req.params.id, 10));
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Calculate order margin error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getMarginComparison(req, res) {
    try {
      const { date_from, date_to, customer_id, country } = req.query;
      const result = await controlService.getMarginComparison({
        dateFrom: date_from,
        dateTo: date_to,
        customerId: customer_id ? parseInt(customer_id, 10) : undefined,
        country,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('Get margin comparison error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async simulatePricing(req, res) {
    try {
      const result = await controlService.simulatePricing({
        productId: req.body.product_id,
        qtyMT: req.body.qty_mt,
        targetMarginPct: req.body.target_margin_pct,
        costs: req.body.costs || {},
        fxRate: req.body.fx_rate,
        name: req.body.name,
        userId: req.user.id,
      });
      return res.status(201).json({ success: true, data: result, message: 'Pricing simulation created.' });
    } catch (err) {
      console.error('Simulate pricing error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // SUPPLIER INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════════

  async calculateSupplierScore(req, res) {
    try {
      const { period_start, period_end } = req.body;
      if (!period_start || !period_end) {
        return res.status(400).json({ success: false, message: 'period_start and period_end are required.' });
      }
      const result = await controlService.calculateSupplierScore(parseInt(req.params.id, 10), {
        periodStart: period_start,
        periodEnd: period_end,
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      console.error('Calculate supplier score error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getSupplierScoreboard(req, res) {
    try {
      const { period_start, period_end } = req.query;
      const result = await controlService.getSupplierScoreboard({
        periodStart: period_start,
        periodEnd: period_end,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('Get supplier scoreboard error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // CUSTOMER INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════════

  async calculateCustomerScore(req, res) {
    try {
      const { period_start, period_end } = req.body;
      if (!period_start || !period_end) {
        return res.status(400).json({ success: false, message: 'period_start and period_end are required.' });
      }
      const result = await controlService.calculateCustomerScore(parseInt(req.params.id, 10), {
        periodStart: period_start,
        periodEnd: period_end,
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      console.error('Calculate customer score error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getCustomerScoreboard(req, res) {
    try {
      const { period_start, period_end } = req.query;
      const result = await controlService.getCustomerScoreboard({
        periodStart: period_start,
        periodEnd: period_end,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('Get customer scoreboard error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getCustomerPaymentTrends(req, res) {
    try {
      const result = await controlService.getCustomerPaymentTrends(parseInt(req.params.id, 10));
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Get customer payment trends error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // MILLING INTELLIGENCE
  // ═══════════════════════════════════════════════════════════════════

  async calculateMillPerformance(req, res) {
    try {
      const { period_start, period_end } = req.body;
      if (!period_start || !period_end) {
        return res.status(400).json({ success: false, message: 'period_start and period_end are required.' });
      }
      const result = await controlService.calculateMillPerformance(parseInt(req.params.id, 10), {
        periodStart: period_start,
        periodEnd: period_end,
      });
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      console.error('Calculate mill performance error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getRecoveryAnalysis(req, res) {
    try {
      const { supplier_id, product_id, date_from, date_to } = req.query;
      const result = await controlService.getRecoveryAnalysis({
        supplierId: supplier_id ? parseInt(supplier_id, 10) : undefined,
        productId: product_id ? parseInt(product_id, 10) : undefined,
        dateFrom: date_from,
        dateTo: date_to,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('Get recovery analysis error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // STOCK COUNT
  // ═══════════════════════════════════════════════════════════════════

  async createStockCount(req, res) {
    try {
      const result = await db.transaction(async (trx) => {
        return controlService.createStockCount(trx, {
          countType: req.body.count_type,
          warehouseId: req.body.warehouse_id,
          plannedDate: req.body.planned_date,
          userId: req.user.id,
        });
      });
      return res.status(201).json({ success: true, data: result, message: 'Stock count created.' });
    } catch (err) {
      console.error('Create stock count error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async recordCountItem(req, res) {
    try {
      const result = await db.transaction(async (trx) => {
        return controlService.recordCountItem(trx, {
          stockCountId: parseInt(req.params.id, 10),
          itemId: req.body.item_id,
          countedQty: req.body.counted_qty,
          notes: req.body.notes,
          userId: req.user.id,
        });
      });
      return res.json({ success: true, data: result, message: 'Count recorded.' });
    } catch (err) {
      console.error('Record count item error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async approveStockCount(req, res) {
    try {
      const result = await db.transaction(async (trx) => {
        return controlService.approveStockCount(trx, {
          stockCountId: parseInt(req.params.id, 10),
          userId: req.user.id,
        });
      });
      return res.json({ success: true, data: result, message: 'Stock count approved and adjustments applied.' });
    } catch (err) {
      console.error('Approve stock count error:', err);
      const status = err.message.includes('not found') ? 404
        : err.message.includes('already') ? 400
        : err.message.includes('not been counted') ? 400
        : 500;
      return res.status(status).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getStockCounts(req, res) {
    try {
      const { status, warehouse_id, page, limit } = req.query;
      const result = await controlService.getStockCounts({
        status,
        warehouseId: warehouse_id ? parseInt(warehouse_id, 10) : undefined,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 20,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('Get stock counts error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getStockCountDetail(req, res) {
    try {
      const result = await controlService.getStockCountDetail(parseInt(req.params.id, 10));
      if (!result) return res.status(404).json({ success: false, message: 'Stock count not found.' });
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Get stock count detail error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = controlController;
