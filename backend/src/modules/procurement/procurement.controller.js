const db = require('../../config/database');
const procurementService = require('../../services/procurementService');

const procurementController = {
  // ===========================================================================
  // Purchase Requisitions
  // ===========================================================================

  async listRequisitions(req, res) {
    try {
      const result = await procurementService.getRequisitions(req.query);
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Procurement listRequisitions error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createRequisition(req, res) {
    try {
      const requisition = await db.transaction(async (trx) => {
        return procurementService.createRequisition(trx, {
          ...req.body,
          requested_by: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: { requisition } });
    } catch (err) {
      console.error('Procurement createRequisition error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  async approveRequisition(req, res) {
    try {
      const updated = await db.transaction(async (trx) => {
        return procurementService.approveRequisition(trx, {
          reqId: parseInt(req.params.id),
          approvedBy: req.user.id,
        });
      });

      return res.json({ success: true, data: { requisition: updated } });
    } catch (err) {
      console.error('Procurement approveRequisition error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  async rejectRequisition(req, res) {
    try {
      const updated = await db.transaction(async (trx) => {
        return procurementService.rejectRequisition(trx, {
          reqId: parseInt(req.params.id),
          rejectedBy: req.user.id,
          reason: req.body.reason || null,
        });
      });

      return res.json({ success: true, data: { requisition: updated } });
    } catch (err) {
      console.error('Procurement rejectRequisition error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  // ===========================================================================
  // Purchase Orders
  // ===========================================================================

  async listPurchaseOrders(req, res) {
    try {
      const result = await procurementService.getPurchaseOrders(req.query);
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Procurement listPurchaseOrders error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createPurchaseOrder(req, res) {
    try {
      const po = await db.transaction(async (trx) => {
        return procurementService.createPurchaseOrder(trx, {
          ...req.body,
          created_by: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: { purchaseOrder: po } });
    } catch (err) {
      console.error('Procurement createPurchaseOrder error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  async getPurchaseOrder(req, res) {
    try {
      const po = await procurementService.getPurchaseOrderDetail(parseInt(req.params.id));
      if (!po) {
        return res.status(404).json({ success: false, message: 'Purchase order not found.' });
      }
      return res.json({ success: true, data: { purchaseOrder: po } });
    } catch (err) {
      console.error('Procurement getPurchaseOrder error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async cancelPurchaseOrder(req, res) {
    try {
      const updated = await db.transaction(async (trx) => {
        return procurementService.cancelPO(trx, {
          poId: parseInt(req.params.id),
          userId: req.user.id,
        });
      });

      return res.json({ success: true, data: { purchaseOrder: updated } });
    } catch (err) {
      console.error('Procurement cancelPurchaseOrder error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  // ===========================================================================
  // Goods Receipt Notes
  // ===========================================================================

  async listGRNs(req, res) {
    try {
      const result = await procurementService.getGRNs(req.query);
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Procurement listGRNs error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createGRN(req, res) {
    try {
      const grn = await db.transaction(async (trx) => {
        return procurementService.createGRN(trx, {
          ...req.body,
          received_by: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: { grn } });
    } catch (err) {
      console.error('Procurement createGRN error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  async getGRN(req, res) {
    try {
      const grn = await procurementService.getGRNDetail(parseInt(req.params.id));
      if (!grn) {
        return res.status(404).json({ success: false, message: 'GRN not found.' });
      }
      return res.json({ success: true, data: { grn } });
    } catch (err) {
      console.error('Procurement getGRN error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async approveGRNQuality(req, res) {
    try {
      const { quality_status, deductions } = req.body;
      if (!quality_status) {
        return res.status(400).json({ success: false, message: 'quality_status is required.' });
      }

      const updated = await db.transaction(async (trx) => {
        return procurementService.approveGRNQuality(trx, {
          grnId: parseInt(req.params.id),
          qualityStatus: quality_status,
          inspectedBy: req.user.id,
          deductions: deductions || 0,
        });
      });

      return res.json({ success: true, data: { grn: updated } });
    } catch (err) {
      console.error('Procurement approveGRNQuality error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  // ===========================================================================
  // Supplier Invoices
  // ===========================================================================

  async listSupplierInvoices(req, res) {
    try {
      const result = await procurementService.getSupplierInvoices(req.query);
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Procurement listSupplierInvoices error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createSupplierInvoice(req, res) {
    try {
      const invoice = await db.transaction(async (trx) => {
        return procurementService.createSupplierInvoice(trx, {
          ...req.body,
          created_by: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: { invoice } });
    } catch (err) {
      console.error('Procurement createSupplierInvoice error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  async approveInvoice(req, res) {
    try {
      const updated = await db.transaction(async (trx) => {
        return procurementService.approveInvoice(trx, {
          invoiceId: parseInt(req.params.id),
          approvedBy: req.user.id,
        });
      });

      return res.json({ success: true, data: { invoice: updated } });
    } catch (err) {
      console.error('Procurement approveInvoice error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  // ===========================================================================
  // Purchase Returns
  // ===========================================================================

  async createReturn(req, res) {
    try {
      const purchaseReturn = await db.transaction(async (trx) => {
        return procurementService.createReturn(trx, {
          ...req.body,
          created_by: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: { return: purchaseReturn } });
    } catch (err) {
      console.error('Procurement createReturn error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  // ===========================================================================
  // Landed Cost
  // ===========================================================================

  async allocateLandedCost(req, res) {
    try {
      const { cost_type, amount, currency } = req.body;
      if (!amount) {
        return res.status(400).json({ success: false, message: 'amount is required.' });
      }

      const allocation = await db.transaction(async (trx) => {
        return procurementService.allocateLandedCost(trx, {
          grnId: parseInt(req.params.id),
          costType: cost_type || 'Transport',
          amount,
          currency: currency || 'PKR',
        });
      });

      return res.status(201).json({ success: true, data: { allocation } });
    } catch (err) {
      console.error('Procurement allocateLandedCost error:', err);
      return res.status(400).json({ success: false, message: err.message });
    }
  },

  // ===========================================================================
  // Analytics
  // ===========================================================================

  async getSupplierPerformance(req, res) {
    try {
      const performance = await procurementService.getSupplierPerformance(req.params.id);
      return res.json({ success: true, data: { performance } });
    } catch (err) {
      console.error('Procurement getSupplierPerformance error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = procurementController;
