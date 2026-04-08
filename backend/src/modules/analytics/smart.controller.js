const smartService = require('../../services/smartService');
const db = require('../../config/database');

/**
 * Smart Controller — Phase 13
 * Cost prediction, scenario simulation, document automation, mobile API, predictive insights.
 */
const smartController = {
  // ═══════════════════════════════════════════════════════════════════════════
  // SMART COSTING
  // ═══════════════════════════════════════════════════════════════════════════

  async predictCostPerMT(req, res) {
    try {
      const { productId } = req.params;
      const result = await smartService.predictCostPerMT(parseInt(productId, 10));
      return res.json({ success: true, data: result, message: 'Cost prediction generated.' });
    } catch (err) {
      console.error('Predict cost error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async suggestOptimalSourcing(req, res) {
    try {
      const { productId, qtyMT, targetMarginPct } = req.body;
      if (!productId) return res.status(400).json({ success: false, message: 'productId is required.' });

      const result = await smartService.suggestOptimalSourcing({
        productId: parseInt(productId, 10),
        qtyMT: parseFloat(qtyMT) || null,
        targetMarginPct: parseFloat(targetMarginPct) || 15,
      });
      return res.json({ success: true, data: result, message: 'Optimal sourcing analysis complete.' });
    } catch (err) {
      console.error('Optimal sourcing error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════

  async fobVsCif(req, res) {
    try {
      const { productId, qtyMT, pricePerMT, destinationCountry, fxRate } = req.body;
      if (!productId || !qtyMT || !pricePerMT || !destinationCountry) {
        return res.status(400).json({ success: false, message: 'productId, qtyMT, pricePerMT, and destinationCountry are required.' });
      }

      const result = await smartService.simulateFobVsCif({
        productId: parseInt(productId, 10),
        qtyMT: parseFloat(qtyMT),
        pricePerMT: parseFloat(pricePerMT),
        destinationCountry,
        fxRate: fxRate ? parseFloat(fxRate) : null,
      });
      return res.json({ success: true, data: result, message: 'FOB vs CIF simulation complete.' });
    } catch (err) {
      console.error('FOB vs CIF error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async supplierComparison(req, res) {
    try {
      const { productId, qtyMT, supplierIds } = req.body;
      if (!productId || !supplierIds || !Array.isArray(supplierIds)) {
        return res.status(400).json({ success: false, message: 'productId and supplierIds (array) are required.' });
      }

      const result = await smartService.simulateSupplierComparison({
        productId: parseInt(productId, 10),
        qtyMT: parseFloat(qtyMT) || null,
        supplierIds: supplierIds.map((id) => parseInt(id, 10)),
      });
      return res.json({ success: true, data: result, message: 'Supplier comparison complete.' });
    } catch (err) {
      console.error('Supplier comparison error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async yieldScenario(req, res) {
    try {
      const { rawQtyMT, moisturePct, brokenPct, productVariety } = req.body;
      if (!rawQtyMT) {
        return res.status(400).json({ success: false, message: 'rawQtyMT is required.' });
      }

      const result = await smartService.simulateYieldScenario({
        rawQtyMT: parseFloat(rawQtyMT),
        moisturePct: parseFloat(moisturePct) || 12,
        brokenPct: parseFloat(brokenPct) || 5,
        productVariety: productVariety || '',
      });
      return res.json({ success: true, data: result, message: 'Yield scenario simulation complete.' });
    } catch (err) {
      console.error('Yield scenario error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async fxScenario(req, res) {
    try {
      const { contractValueUSD, currentRate, scenarios } = req.body;
      if (!contractValueUSD) {
        return res.status(400).json({ success: false, message: 'contractValueUSD is required.' });
      }

      const result = await smartService.simulateFxScenario({
        contractValueUSD: parseFloat(contractValueUSD),
        currentRate: currentRate ? parseFloat(currentRate) : null,
        scenarios: scenarios || [{ rate: 275 }, { rate: 280 }, { rate: 285 }, { rate: 290 }],
      });
      return res.json({ success: true, data: result, message: 'FX scenario simulation complete.' });
    } catch (err) {
      console.error('FX scenario error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async fullOrder(req, res) {
    try {
      const { customerId, productId, qtyMT, incoterm, targetMarginPct } = req.body;
      if (!customerId || !productId || !qtyMT) {
        return res.status(400).json({ success: false, message: 'customerId, productId, and qtyMT are required.' });
      }

      const result = await smartService.simulateFullOrder({
        customerId: parseInt(customerId, 10),
        productId: parseInt(productId, 10),
        qtyMT: parseFloat(qtyMT),
        incoterm: incoterm || 'FOB',
        targetMarginPct: parseFloat(targetMarginPct) || 15,
      });
      return res.json({ success: true, data: result, message: 'Full order simulation complete.' });
    } catch (err) {
      console.error('Full order simulation error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async listScenarios(req, res) {
    try {
      const { scenario_type, page, limit } = req.query;
      const result = await smartService.listScenarios({
        scenarioType: scenario_type,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 25,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('List scenarios error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getScenario(req, res) {
    try {
      const { id } = req.params;
      const scenario = await smartService.getScenarioById(parseInt(id, 10));
      return res.json({ success: true, data: scenario });
    } catch (err) {
      console.error('Get scenario error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCUMENT AUTOMATION
  // ═══════════════════════════════════════════════════════════════════════════

  async getCountryRequirements(req, res) {
    try {
      const { country } = req.params;
      const { incoterm } = req.query;
      const result = await smartService.getCountryRequirements(country, incoterm || null);
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Country requirements error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async validateOrderDocuments(req, res) {
    try {
      const { orderId } = req.params;
      const result = await smartService.validateOrderDocuments(parseInt(orderId, 10));
      return res.json({
        success: true,
        data: result,
        message: result.complete ? 'All required documents are valid.' : 'Document validation incomplete — see items for details.',
      });
    } catch (err) {
      console.error('Validate documents error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async autoFillDocumentData(req, res) {
    try {
      const { orderId, docType } = req.params;
      const result = await smartService.autoFillDocumentData(parseInt(orderId, 10), docType);
      return res.json({ success: true, data: result, message: `Auto-filled data for ${docType}.` });
    } catch (err) {
      console.error('Auto-fill document error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE
  // ═══════════════════════════════════════════════════════════════════════════

  async processMobileUpload(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'File is required.' });
      }

      const { uploadType, linkedType, linkedId, linkedRef, lat, lng, deviceInfo } = req.body;
      if (!uploadType) {
        return res.status(400).json({ success: false, message: 'uploadType is required.' });
      }

      const result = await smartService.processMobileUpload(null, {
        uploadType,
        linkedType: linkedType || null,
        linkedId: linkedId ? parseInt(linkedId, 10) : null,
        linkedRef: linkedRef || null,
        file: req.file,
        location: lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null,
        deviceInfo: deviceInfo || null,
        userId: req.user.id,
      });

      return res.json({ success: true, data: result, message: 'Upload processed successfully.' });
    } catch (err) {
      console.error('Mobile upload error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getMobileQCData(req, res) {
    try {
      const { batchId } = req.params;
      const result = await smartService.getMobileQCData(parseInt(batchId, 10));
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Mobile QC data error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getMobileWarehouseData(req, res) {
    try {
      const { warehouseId } = req.params;
      const result = await smartService.getMobileWarehouseData(parseInt(warehouseId, 10));
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Mobile warehouse data error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PREDICTIVE INSIGHTS
  // ═══════════════════════════════════════════════════════════════════════════

  async runPredictiveAnalysis(req, res) {
    try {
      const result = await smartService.runPredictiveAnalysis();
      return res.json({
        success: true,
        data: result,
        message: `Predictive analysis complete. ${result.totalInserted} new alert(s) generated.`,
      });
    } catch (err) {
      console.error('Predictive analysis error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async getPredictiveAlerts(req, res) {
    try {
      const { status, alert_type, page, limit } = req.query;
      const result = await smartService.getPredictiveAlerts({
        status,
        alertType: alert_type,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 25,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('Get predictive alerts error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async acknowledgeAlert(req, res) {
    try {
      const { id } = req.params;
      const result = await smartService.acknowledgePredictiveAlert(parseInt(id, 10), req.user.id);
      return res.json({ success: true, data: result, message: 'Alert acknowledged.' });
    } catch (err) {
      console.error('Acknowledge alert error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async dismissAlert(req, res) {
    try {
      const { id } = req.params;
      const result = await smartService.dismissPredictiveAlert(parseInt(id, 10), req.user.id);
      return res.json({ success: true, data: result, message: 'Alert dismissed.' });
    } catch (err) {
      console.error('Dismiss alert error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },
};

module.exports = smartController;
