const reportingService = require('../services/reportingService');

const reportingController = {
  // ═══════════════════════════════════════════════════════════════════
  // EXECUTIVE DASHBOARDS
  // ═══════════════════════════════════════════════════════════════════

  async orderPipeline(req, res) {
    try {
      const { entity, dateFrom, dateTo } = req.query;
      const data = await reportingService.getOrderPipeline({ entity, dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Order pipeline error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async advanceFunnel(req, res) {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await reportingService.getAdvanceCollectionFunnel({ dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Advance funnel error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async executiveSummary(req, res) {
    try {
      const { entity, dateFrom, dateTo } = req.query;
      const data = await reportingService.getExecutiveSummary({ entity, dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Executive summary error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // PROFITABILITY
  // ═══════════════════════════════════════════════════════════════════

  async orderProfitability(req, res) {
    try {
      const { entity, dateFrom, dateTo, customerId, country, page, limit } = req.query;
      const data = await reportingService.getOrderProfitability({
        entity,
        dateFrom,
        dateTo,
        customerId: customerId ? parseInt(customerId, 10) : undefined,
        country,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 50,
      });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Order profitability error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async batchProfitability(req, res) {
    try {
      const { dateFrom, dateTo, supplierId, page, limit } = req.query;
      const data = await reportingService.getBatchProfitability({
        dateFrom,
        dateTo,
        supplierId: supplierId ? parseInt(supplierId, 10) : undefined,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 50,
      });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Batch profitability error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async customerProfitability(req, res) {
    try {
      const { dateFrom, dateTo, page, limit } = req.query;
      const data = await reportingService.getCustomerProfitability({
        dateFrom,
        dateTo,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 50,
      });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Customer profitability error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async countryAnalysis(req, res) {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await reportingService.getCountryAnalysis({ dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Country analysis error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async productProfitability(req, res) {
    try {
      const { entity, dateFrom, dateTo } = req.query;
      const data = await reportingService.getProductProfitability({ entity, dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Product profitability error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async monthlyTrend(req, res) {
    try {
      const { entity, months } = req.query;
      const data = await reportingService.getMonthlyProfitTrend({
        entity,
        months: parseInt(months, 10) || 12,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Monthly trend error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // SUPPLIER & QUALITY
  // ═══════════════════════════════════════════════════════════════════

  async supplierQualityRanking(req, res) {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await reportingService.getSupplierQualityRanking({ dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Supplier quality ranking error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async batchRecoveryLeaderboard(req, res) {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await reportingService.getBatchRecoveryLeaderboard({ dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Batch recovery leaderboard error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async recoveryByVariety(req, res) {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await reportingService.getRecoveryByVariety({ dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Recovery by variety error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // FINANCIAL
  // ═══════════════════════════════════════════════════════════════════

  async receivableRecovery(req, res) {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await reportingService.getReceivableRecoveryEfficiency({ dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Receivable recovery error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async payableAnalysis(req, res) {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await reportingService.getPayableAnalysis({ dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Payable analysis error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async cashForecast(req, res) {
    try {
      const { daysAhead } = req.query;
      const data = await reportingService.getCashForecastVsCommitments({
        daysAhead: parseInt(daysAhead, 10) || 30,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Cash forecast error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async fxExposure(req, res) {
    try {
      const data = await reportingService.getFxExposureDashboard();
      return res.json({ success: true, data });
    } catch (err) {
      console.error('FX exposure error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // INVENTORY
  // ═══════════════════════════════════════════════════════════════════

  async stockAging(req, res) {
    try {
      const data = await reportingService.getStockAgingReport();
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Stock aging error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async stockTurnover(req, res) {
    try {
      const { entity } = req.query;
      const data = await reportingService.getStockTurnoverDays({ entity });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Stock turnover error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async stockValuation(req, res) {
    try {
      const { entity, asOfDate } = req.query;
      const data = await reportingService.getStockValuation({ entity, asOfDate });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Stock valuation error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // PRODUCTION
  // ═══════════════════════════════════════════════════════════════════

  async millEfficiency(req, res) {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await reportingService.getProductionEfficiencyByMill({ dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Mill efficiency error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async operatorProductivity(req, res) {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await reportingService.getOperatorProductivityReport({ dateFrom, dateTo });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Operator productivity error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async utilityConsumption(req, res) {
    try {
      const { millId, dateFrom, dateTo } = req.query;
      const data = await reportingService.getUtilityConsumptionReport({
        millId: millId ? parseInt(millId, 10) : undefined,
        dateFrom,
        dateTo,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Utility consumption error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // KPI BENCHMARKS
  // ═══════════════════════════════════════════════════════════════════

  async benchmarkComparison(req, res) {
    try {
      const { entity, periodStart, periodEnd } = req.query;
      const data = await reportingService.getKpiBenchmarkComparison({ entity, periodStart, periodEnd });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('Benchmark comparison error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // SAVED REPORTS
  // ═══════════════════════════════════════════════════════════════════

  async save(req, res) {
    try {
      const { name, reportType, entity, filters, columns, sortBy, isShared } = req.body;

      if (!name || !reportType) {
        return res.status(400).json({ success: false, message: 'name and reportType are required.' });
      }

      const report = await reportingService.saveReport({
        name,
        reportType,
        entity,
        filters,
        columns,
        sortBy,
        createdBy: req.user.id,
        isShared,
      });

      return res.status(201).json({ success: true, data: { report } });
    } catch (err) {
      console.error('Save report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async list(req, res) {
    try {
      const reports = await reportingService.getSavedReports(req.user.id);
      return res.json({ success: true, data: { reports } });
    } catch (err) {
      console.error('List saved reports error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async run(req, res) {
    try {
      const { id } = req.params;
      const result = await reportingService.runSavedReport(parseInt(id, 10));
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Run saved report error:', err);
      if (err.message === 'Saved report not found') {
        return res.status(404).json({ success: false, message: err.message });
      }
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async delete(req, res) {
    try {
      const { id } = req.params;
      const deleted = await reportingService.deleteSavedReport(parseInt(id, 10));
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'Report not found.' });
      }
      return res.json({ success: true, message: 'Report deleted.' });
    } catch (err) {
      console.error('Delete saved report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════

  async exportReport(req, res) {
    try {
      const { reportType, format, filters } = req.body;

      if (!reportType || !format) {
        return res.status(400).json({ success: false, message: 'reportType and format are required.' });
      }

      if (!['csv', 'json'].includes(format)) {
        return res.status(400).json({ success: false, message: 'Supported formats: csv, json.' });
      }

      // Execute the report to get data
      const methodMap = {
        order_pipeline: () => reportingService.getOrderPipeline(filters || {}),
        profitability: () => reportingService.getOrderProfitability(filters || {}),
        batch_profitability: () => reportingService.getBatchProfitability(filters || {}),
        receivable_aging: () => reportingService.getReceivableRecoveryEfficiency(filters || {}),
        supplier_quality: () => reportingService.getSupplierQualityRanking(filters || {}),
        customer_ranking: () => reportingService.getCustomerProfitability(filters || {}),
        stock_aging: () => reportingService.getStockAgingReport(),
        cash_forecast: () => reportingService.getCashForecastVsCommitments(filters || {}),
        production_efficiency: () => reportingService.getProductionEfficiencyByMill(filters || {}),
        country_analysis: () => reportingService.getCountryAnalysis(filters || {}),
        product_profitability: () => reportingService.getProductProfitability(filters || {}),
        executive_summary: () => reportingService.getExecutiveSummary(filters || {}),
        kpi_benchmarks: () => reportingService.getKpiBenchmarkComparison(filters || {}),
        payable_analysis: () => reportingService.getPayableAnalysis(filters || {}),
        fx_exposure: () => reportingService.getFxExposureDashboard(),
        stock_turnover: () => reportingService.getStockTurnoverDays(filters || {}),
        stock_valuation: () => reportingService.getStockValuation(filters || {}),
        mill_efficiency: () => reportingService.getProductionEfficiencyByMill(filters || {}),
        operator_productivity: () => reportingService.getOperatorProductivityReport(filters || {}),
        utility_consumption: () => reportingService.getUtilityConsumptionReport(filters || {}),
      };

      const fn = methodMap[reportType];
      if (!fn) {
        return res.status(400).json({ success: false, message: `Unknown report type: ${reportType}` });
      }

      const rawData = await fn();

      // Normalize to array for export
      let exportData;
      if (Array.isArray(rawData)) {
        exportData = rawData;
      } else if (rawData.data && Array.isArray(rawData.data)) {
        exportData = rawData.data;
      } else {
        exportData = [rawData];
      }

      let content;
      let contentType;
      let fileExtension;

      if (format === 'csv') {
        content = await reportingService.exportToCSV(exportData);
        contentType = 'text/csv';
        fileExtension = 'csv';
      } else {
        content = await reportingService.exportToJSON(exportData);
        contentType = 'application/json';
        fileExtension = 'json';
      }

      // Log the export
      await reportingService.logExport({
        reportType,
        format: fileExtension,
        filePath: null,
        fileSize: Buffer.byteLength(content, 'utf8'),
        userId: req.user.id,
        filters,
      });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${reportType}_${Date.now()}.${fileExtension}"`);
      return res.send(content);
    } catch (err) {
      console.error('Export report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = reportingController;
