const reportingService = require('../../services/reportingService');

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

  async lotLedger(req, res) {
    try {
      const data = await reportingService.getLotLedger(req.params.id);
      if (!data) return res.status(404).json({ success: false, message: 'Lot not found.' });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Lot ledger error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async batchLedger(req, res) {
    try {
      const data = await reportingService.getBatchLedger(req.params.id);
      if (!data) return res.status(404).json({ success: false, message: 'Batch not found.' });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Batch ledger error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async saleDetail(req, res) {
    try {
      const data = await reportingService.getSaleDetail(req.params.id);
      if (!data) return res.status(404).json({ success: false, message: 'Sale not found.' });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Sale detail error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async inventoryLedger(req, res) {
    try {
      const data = await reportingService.getInventoryLedger(req.query || {});
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Inventory ledger error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async finishedGoodsLedger(req, res) {
    try {
      const data = await reportingService.getFinishedGoodsLedger(req.query || {});
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Finished goods ledger error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async listScheduledReports(req, res) {
    try {
      const data = await reportingService.listScheduledReportEmails();
      return res.json({ success: true, rows: data, types: reportingService.SCHEDULED_REPORT_TYPES });
    } catch (err) {
      console.error('List scheduled reports error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createScheduledReport(req, res) {
    try {
      const { reportType, frequency, recipients, filters } = req.body || {};
      const data = await reportingService.createScheduledReportEmail({ reportType, frequency, recipients, filters });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Create scheduled report error:', err);
      return res.status(400).json({ success: false, message: err.message || 'Could not create scheduled report.' });
    }
  },

  async deleteScheduledReport(req, res) {
    try {
      await reportingService.deleteScheduledReportEmail(req.params.id);
      return res.json({ success: true });
    } catch (err) {
      console.error('Delete scheduled report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async runScheduledReport(req, res) {
    try {
      const automationService = require('../admin/automation.service');
      const result = await automationService.runTask(parseInt(req.params.id, 10));
      return res.json({ success: true, result });
    } catch (err) {
      console.error('Run scheduled report error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async globalSearch(req, res) {
    try {
      const { q, entity, limit } = req.query;
      const data = await reportingService.globalSearch({ q, entity, limit });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Global search error:', err);
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

  async batchMargin(req, res) {
    try {
      const { from_date, to_date, limit } = req.query;
      const data = await reportingService.getBatchMargin({
        from_date, to_date, limit: parseInt(limit, 10) || 200,
      });
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('Batch margin error:', err);
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

  // ═══════════════════════════════════════════════════════════════════
  // PRINTABLE REPORTS — Production & Stock for daily / weekly / monthly
  // ═══════════════════════════════════════════════════════════════════

  // Production for a date range. Returns:
  //   - summary: total batches, raw input MT, finished MT, avg yield
  //   - byMill: per-mill aggregates
  //   - byProduct: per-product aggregates
  //   - batches: every batch in the range with the headline numbers
  // The FE renders this into a print-styled HTML view.
  async printableProduction(req, res) {
    try {
      const db = require('../../config/database');
      const { from, to } = req.query;
      if (!from || !to) {
        return res.status(400).json({ success: false, message: 'from and to dates are required.' });
      }
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid from/to date.' });
      }

      const batches = await db('milling_batches as b')
        .leftJoin('mills as m', 'b.mill_id', 'm.id')
        .leftJoin('suppliers as s', 'b.supplier_id', 's.id')
        .leftJoin('products as p', 'b.product_id', 'p.id')
        .select(
          'b.id', 'b.batch_no', 'b.status', 'b.processing_type', 'b.supplier_id',
          'b.raw_qty_mt', 'b.planned_finished_mt', 'b.actual_finished_mt', 'b.yield_pct',
          'b.total_cost_per_kg_finished', 'b.created_at', 'b.completed_at',
          'm.name as mill_name',
          's.name as supplier_name',
          'p.name as product_name',
        )
        .whereBetween('b.created_at', [fromDate, toDate])
        .orderBy('b.created_at', 'asc');

      const num = (v) => parseFloat(v) || 0;
      // Finished-output katta per batch — sum the finished lots' bags, keyed by
      // batch_ref ('batch-<id>'), so the per-batch detail can show bag counts.
      const bagsByBatch = {};
      if (batches.length) {
        const refs = batches.map((b) => `batch-${b.id}`);
        const bagRows = await db('inventory_lots')
          .whereIn('batch_ref', refs).where('type', 'finished')
          .select('batch_ref').sum({ bags: 'total_bags' }).groupBy('batch_ref');
        for (const r of bagRows) bagsByBatch[r.batch_ref] = parseInt(r.bags, 10) || 0;
      }
      // A blend re-mills already-finished OWNED rice, so its raw_qty_mt is
      // finished rice re-entering as "raw" — counting it as raw input
      // double-counts the original purchase. Keep blends out of the raw/
      // finished/yield totals (and the by-product/by-mill tonnage).
      const isBlend = (b) => b.processing_type === 'blended';
      // Raw is only "input" once it has actually been received/milled. A
      // Queued/Planned/Pending/Draft batch's raw_qty_mt is just a target — the
      // rice hasn't arrived yet — so it must not inflate Raw Input or skew yield.
      const NOT_RECEIVED = ['Queued', 'Planned', 'Pending', 'Draft'];
      const isReceived = (b) => !NOT_RECEIVED.includes(b.status);
      const summary = batches.reduce(
        (acc, b) => {
          acc.batchCount += 1;
          if (b.status === 'Completed' || b.status === 'Approved') acc.completed += 1;
          if (isBlend(b)) {
            acc.blendedCount += 1;
            acc.blendedRawMt += num(b.raw_qty_mt);
            acc.blendedFinishedMt += num(b.actual_finished_mt);
          } else if (!isReceived(b)) {
            acc.pendingCount += 1;
            acc.pendingRawMt += num(b.raw_qty_mt);
          } else {
            acc.rawMt += num(b.raw_qty_mt);
            acc.finishedMt += num(b.actual_finished_mt);
            acc.plannedMt += num(b.planned_finished_mt);
          }
          return acc;
        },
        { batchCount: 0, rawMt: 0, finishedMt: 0, plannedMt: 0, completed: 0,
          blendedCount: 0, blendedRawMt: 0, blendedFinishedMt: 0, pendingCount: 0, pendingRawMt: 0 }
      );
      summary.avgYieldPct = summary.rawMt > 0 ? (summary.finishedMt / summary.rawMt) * 100 : 0;

      // By-product / by-mill tonnage reflects only actually-milled raw rice.
      const nonBlendBatches = batches.filter((b) => !isBlend(b) && isReceived(b));
      const groupBy = (key, label) => {
        const map = new Map();
        for (const b of nonBlendBatches) {
          const k = b[key] || '—';
          const r = map.get(k) || { name: k, batchCount: 0, rawMt: 0, finishedMt: 0 };
          r.batchCount += 1;
          r.rawMt += num(b.raw_qty_mt);
          r.finishedMt += num(b.actual_finished_mt);
          map.set(k, r);
        }
        return Array.from(map.values()).map(r => ({
          ...r,
          yieldPct: r.rawMt > 0 ? (r.finishedMt / r.rawMt) * 100 : 0,
        })).sort((a, b) => b.finishedMt - a.finishedMt);
      };

      return res.json({
        success: true,
        data: {
          range: { from: fromDate.toISOString(), to: toDate.toISOString() },
          summary,
          byMill:    groupBy('mill_name'),
          byProduct: groupBy('product_name'),
          batches:   batches.map(b => ({
            id: b.id, batchNo: b.batch_no, status: b.status,
            processingType: b.processing_type,
            isBlend: isBlend(b),
            rawMt: num(b.raw_qty_mt),
            plannedMt: num(b.planned_finished_mt),
            finishedMt: num(b.actual_finished_mt),
            yieldPct: num(b.yield_pct) || (num(b.raw_qty_mt) > 0 ? num(b.actual_finished_mt) / num(b.raw_qty_mt) * 100 : 0),
            perKgFinished: num(b.total_cost_per_kg_finished),
            bags: bagsByBatch[`batch-${b.id}`] || 0,
            millName: b.mill_name,
            supplierName: b.supplier_name,
            supplierId: b.supplier_id,
            productName: b.product_name,
            createdAt: b.created_at,
            completedAt: b.completed_at,
          })),
        },
      });
    } catch (err) {
      console.error('Printable production report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ──── Profit & Loss (printable) ─────────────────────────────────
  // Period-bound revenue / cost / profit rollup, mirroring what the
  // /finance/profit page shows but in a print-friendly format.
  async printablePnl(req, res) {
    try {
      const db = require('../../config/database');
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ success: false, message: 'from and to dates are required.' });
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid from/to date.' });
      }

      // ─── Revenue ────────────────────────────────────────────────
      // Export: shipped/closed orders booked in PKR at locked rate
      const exportRevRow = await db('export_orders')
        .whereIn('status', ['Shipped', 'Arrived', 'Closed'])
        .whereBetween('updated_at', [fromDate, toDate])
        .sum({ revenuePkr: 'contract_value_pkr_locked' })
        .count({ cnt: 'id' })
        .first();

      // Local sales — completed sales in PKR
      const localRevRow = await db('local_sales')
        .where('status', 'Completed')
        .whereBetween('sale_date', [fromDate, toDate])
        .sum({ revenuePkr: 'total_amount' })
        .sum({ cogsPkr:   'cogs_total_pkr' })
        .count({ cnt: 'id' })
        .first();

      // Mill — completed/approved batches
      const millRow = await db('milling_batches')
        .whereIn('status', ['Completed', 'Approved'])
        .whereBetween('completed_at', [fromDate, toDate])
        .count({ cnt: 'id' })
        .sum({ rawMt: 'raw_qty_mt' })
        .sum({ finishedMt: 'actual_finished_mt' })
        .first();

      // ─── Costs ──────────────────────────────────────────────────
      // Raw rice purchases landed (paid or not — inventory cost basis)
      const lotCostRow = await db('inventory_lots')
        .whereBetween('purchase_date', [fromDate, toDate])
        .sum({ totalPkr: 'landed_cost_total' })
        .count({ cnt: 'id' })
        .first();

      // Mill store consumable purchases
      const millPurchRow = await db('mill_purchases')
        .whereBetween('purchase_date', [fromDate, toDate])
        .sum({ totalPkr: 'total_amount' })
        .count({ cnt: 'id' })
        .first();

      // Operational export costs (transport / customs / commission / etc.)
      const exportCostRow = await db('export_order_costs as eoc')
        .leftJoin('export_orders as eo', 'eoc.order_id', 'eo.id')
        .whereBetween('eoc.created_at', [fromDate, toDate])
        .where('eoc.amount', '>', 0)
        .sum({ totalPkr: db.raw('CASE WHEN COALESCE(eoc.base_amount_pkr,0) > 0 THEN eoc.base_amount_pkr ELSE COALESCE(eoc.amount,0)*COALESCE(eoc.fx_rate,1) END') })
        .count({ cnt: 'eoc.id' })
        .first();

      // Business expenses (utilities, salaries, etc.)
      const expenseRow = await db('business_expenses')
        .whereBetween('expense_date', [fromDate, toDate])
        .sum({ totalPkr: 'amount_pkr' })
        .count({ cnt: 'id' })
        .first();

      const num = (v) => parseFloat(v) || 0;
      const revenue = {
        exportPkr: num(exportRevRow?.revenuePkr),
        exportCount: parseInt(exportRevRow?.cnt, 10) || 0,
        localPkr: num(localRevRow?.revenuePkr),
        localCount: parseInt(localRevRow?.cnt, 10) || 0,
        millFinishedMt: num(millRow?.finishedMt),
        millBatchCount: parseInt(millRow?.cnt, 10) || 0,
      };
      revenue.totalPkr = revenue.exportPkr + revenue.localPkr;

      const costs = {
        rawRicePkr: num(lotCostRow?.totalPkr),
        rawRiceCount: parseInt(lotCostRow?.cnt, 10) || 0,
        millStorePkr: num(millPurchRow?.totalPkr),
        millStoreCount: parseInt(millPurchRow?.cnt, 10) || 0,
        exportOpCostsPkr: num(exportCostRow?.totalPkr),
        exportOpCostsCount: parseInt(exportCostRow?.cnt, 10) || 0,
        businessExpensesPkr: num(expenseRow?.totalPkr),
        businessExpensesCount: parseInt(expenseRow?.cnt, 10) || 0,
        localCogsPkr: num(localRevRow?.cogsPkr),
      };
      costs.totalPkr = costs.rawRicePkr + costs.millStorePkr + costs.exportOpCostsPkr + costs.businessExpensesPkr;

      const netProfitPkr = revenue.totalPkr - costs.totalPkr;
      const marginPct = revenue.totalPkr > 0 ? (netProfitPkr / revenue.totalPkr) * 100 : 0;

      // ─── Line-item detail (clickable drill-downs) ───────────────
      const exportLines = await db('export_orders as o').leftJoin('customers as c', 'o.customer_id', 'c.id')
        .whereIn('o.status', ['Shipped', 'Arrived', 'Closed']).whereBetween('o.updated_at', [fromDate, toDate])
        .select('o.id', 'o.order_no', 'o.product_name', 'o.customer_id', db.raw('COALESCE(o.contract_value_pkr_locked,0) as amount_pkr'), db.raw("COALESCE(c.name,'—') as customer"))
        .orderByRaw('amount_pkr desc').limit(200);
      const localLines = await db('local_sales as ls').leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .where('ls.status', 'Completed').whereBetween('ls.sale_date', [fromDate, toDate])
        .select('ls.id', 'ls.sale_no', 'ls.lot_id', 'ls.item_name', 'ls.total_amount', 'ls.customer_id', db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"))
        .orderBy('ls.total_amount', 'desc').limit(200);
      const purchaseLines = await db('inventory_lots as l').leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .whereBetween('l.purchase_date', [fromDate, toDate])
        .select('l.id', 'l.lot_no', 'l.item_name', 'l.supplier_id', 'l.landed_cost_total', db.raw("COALESCE(s.name,'—') as supplier"))
        .orderBy('l.landed_cost_total', 'desc').limit(200);
      const expenseLines = await db('business_expenses')
        .whereBetween('expense_date', [fromDate, toDate]).where('amount_pkr', '>', 0)
        .select('id', 'expense_no', 'category', 'vendor_name', 'supplier_id', 'amount_pkr', 'expense_type').orderBy('amount_pkr', 'desc').limit(200);

      const detail = {
        export: exportLines.map((r) => ({ id: r.id, ref: r.order_no, party: r.customer, customerId: r.customer_id || null, item: r.product_name, amountPkr: parseFloat(r.amount_pkr) || 0 })),
        local: localLines.map((r) => ({ id: r.id, ref: r.sale_no, lotId: r.lot_id, party: r.customer, customerId: r.customer_id || null, item: r.item_name, amountPkr: parseFloat(r.total_amount) || 0 })),
        purchases: purchaseLines.map((r) => ({ lotId: r.id, ref: r.lot_no, supplierId: r.supplier_id, party: r.supplier, item: r.item_name, amountPkr: parseFloat(r.landed_cost_total) || 0 })),
        expenses: expenseLines.map((r) => ({ ref: r.expense_no, category: r.category, party: r.vendor_name, supplierId: r.supplier_id || null, kind: r.expense_type, amountPkr: parseFloat(r.amount_pkr) || 0 })),
      };

      return res.json({
        success: true,
        data: {
          range: { from: fromDate.toISOString(), to: toDate.toISOString() },
          revenue,
          costs,
          netProfitPkr,
          marginPct,
          detail,
        },
      });
    } catch (err) {
      console.error('Printable P&L report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ──── Cashflow (printable) ─────────────────────────────────────
  // Money In / Money Out from the unified payments feed, plus daily
  // buckets so the FE can render a sparkline / bar chart.
  async printableCashflow(req, res) {
    try {
      const db = require('../../config/database');
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ success: false, message: 'from and to dates are required.' });
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid from/to date.' });
      }

      const totals = await db('payments')
        .whereBetween('payment_date', [fromDate, toDate])
        .select('type')
        .sum({ totalPkr: 'base_amount_pkr' })
        .count({ cnt: 'id' })
        .groupBy('type');

      const summary = { inPkr: 0, outPkr: 0, inCount: 0, outCount: 0 };
      for (const t of totals) {
        if (t.type === 'receipt') {
          summary.inPkr = parseFloat(t.totalPkr) || 0;
          summary.inCount = parseInt(t.cnt, 10) || 0;
        } else if (t.type === 'payment') {
          summary.outPkr = parseFloat(t.totalPkr) || 0;
          summary.outCount = parseInt(t.cnt, 10) || 0;
        }
      }
      summary.netPkr = summary.inPkr - summary.outPkr;

      // Daily buckets — keep it client-friendly for charts.
      const daily = await db('payments')
        .whereBetween('payment_date', [fromDate, toDate])
        .select(db.raw('payment_date::date as day'))
        .select('type')
        .sum({ amt: 'base_amount_pkr' })
        .groupBy('day', 'type')
        .orderBy('day', 'asc');

      const byDay = new Map();
      for (const r of daily) {
        const key = (r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10));
        if (!byDay.has(key)) byDay.set(key, { day: key, In: 0, Out: 0 });
        if (r.type === 'receipt') byDay.get(key).In += parseFloat(r.amt) || 0;
        else if (r.type === 'payment') byDay.get(key).Out += parseFloat(r.amt) || 0;
      }
      const days = Array.from(byDay.values()).map((b) => ({ ...b, Net: b.In - b.Out }));

      // Top 10 receipts + top 10 payments for the body of the report
      const topReceipts = await db('payments as p')
        .leftJoin('receivables as r', 'p.linked_receivable_id', 'r.id')
        .leftJoin('customers as c',   'r.customer_id', 'c.id')
        .where('p.type', 'receipt')
        .whereBetween('p.payment_date', [fromDate, toDate])
        .select('p.payment_no', 'p.payment_date', 'p.base_amount_pkr', 'p.payment_method', 'c.id as customer_id')
        .select(db.raw("COALESCE(c.name, 'Counterparty') as counterparty"))
        .orderBy('p.base_amount_pkr', 'desc')
        .limit(200);

      const topPayments = await db('payments as p')
        .leftJoin('payables as pay', 'p.linked_payable_id', 'pay.id')
        .leftJoin('suppliers as s',  'pay.supplier_id', 's.id')
        .where('p.type', 'payment')
        .whereBetween('p.payment_date', [fromDate, toDate])
        .select('p.payment_no', 'p.payment_date', 'p.base_amount_pkr', 'p.payment_method', 's.id as supplier_id')
        .select(db.raw("COALESCE(s.name, pay.linked_ref, 'Vendor') as counterparty"))
        .orderBy('p.base_amount_pkr', 'desc')
        .limit(200);

      return res.json({
        success: true,
        data: {
          range: { from: fromDate.toISOString(), to: toDate.toISOString() },
          summary,
          daily: days,
          topReceipts: topReceipts.map((r) => ({
            paymentNo: r.payment_no,
            date: r.payment_date,
            counterparty: r.counterparty,
            customerId: r.customer_id,
            method: r.payment_method,
            amountPkr: parseFloat(r.base_amount_pkr) || 0,
          })),
          topPayments: topPayments.map((r) => ({
            paymentNo: r.payment_no,
            date: r.payment_date,
            counterparty: r.counterparty,
            supplierId: r.supplier_id,
            method: r.payment_method,
            amountPkr: parseFloat(r.base_amount_pkr) || 0,
          })),
        },
      });
    } catch (err) {
      console.error('Printable cashflow report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ──── AR Aging (printable) ─────────────────────────────────────
  // Open receivables bucketed by age (0-30 / 31-60 / 61-90 / 90+ days
  // since due). Always reflects current state — no period filter.
  async printableArAging(req, res) {
    try {
      const db = require('../../config/database');
      const today = new Date();
      const rows = await db('receivables as r')
        .leftJoin('customers as c', 'r.customer_id', 'c.id')
        .leftJoin('export_orders as eo', 'r.order_id', 'eo.id')
        .whereNotIn('r.status', ['Paid', 'Written Off'])
        .where('r.outstanding', '>', 0)
        .select(
          'r.id', 'r.recv_no', 'r.due_date', 'r.outstanding', 'r.customer_id',
          'r.currency', 'r.fx_rate', 'r.base_amount_pkr', 'r.type',
          db.raw('COALESCE(c.name, eo.order_no) as counterparty'),
          'eo.order_no'
        )
        .orderBy('r.due_date', 'asc');

      const buckets = { '0-30': { count: 0, totalPkr: 0 }, '31-60': { count: 0, totalPkr: 0 }, '61-90': { count: 0, totalPkr: 0 }, '90+': { count: 0, totalPkr: 0 } };
      let totalPkr = 0;
      const detail = rows.map((r) => {
        const due = r.due_date ? new Date(r.due_date) : null;
        const days = due ? Math.floor((today - due) / (1000 * 60 * 60 * 24)) : 0;
        const bucket = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
        const out = parseFloat(r.outstanding) || 0;
        const cur = String(r.currency || 'PKR').toUpperCase();
        const stamped = parseFloat(r.base_amount_pkr) || 0;
        const fxRate = parseFloat(r.fx_rate) || 280;
        const outPkr = cur === 'PKR' ? out : (stamped > 0 ? stamped * (out / parseFloat(r.outstanding || 1)) : out * fxRate);
        buckets[bucket].count += 1;
        buckets[bucket].totalPkr += outPkr;
        totalPkr += outPkr;
        return {
          recvNo: r.recv_no, dueDate: r.due_date,
          counterparty: r.counterparty || '—', customerId: r.customer_id,
          type: r.type, currency: cur,
          outstanding: out, outstandingPkr: outPkr,
          ageDays: days, bucket,
        };
      });

      return res.json({
        success: true,
        data: {
          asOf: today.toISOString(),
          buckets, totalPkr,
          rows: detail,
        },
      });
    } catch (err) {
      console.error('Printable AR aging report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ──── AP Aging (printable) ─────────────────────────────────────
  async printableApAging(req, res) {
    try {
      const db = require('../../config/database');
      const today = new Date();
      const rows = await db('payables as p')
        .leftJoin('suppliers as s', 'p.supplier_id', 's.id')
        .whereNotIn('p.status', ['Paid', 'Written Off'])
        .where('p.outstanding', '>', 0)
        .select(
          'p.id', 'p.pay_no', 'p.due_date', 'p.outstanding', 'p.source_table', 'p.supplier_id',
          db.raw("COALESCE(s.name, p.linked_ref, 'Vendor') as counterparty")
        )
        .orderBy('p.due_date', 'asc');

      const buckets = { '0-30': { count: 0, totalPkr: 0 }, '31-60': { count: 0, totalPkr: 0 }, '61-90': { count: 0, totalPkr: 0 }, '90+': { count: 0, totalPkr: 0 } };
      let totalPkr = 0;
      const detail = rows.map((r) => {
        const due = r.due_date ? new Date(r.due_date) : null;
        const days = due ? Math.floor((today - due) / (1000 * 60 * 60 * 24)) : 0;
        const bucket = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
        const outPkr = parseFloat(r.outstanding) || 0;
        buckets[bucket].count += 1;
        buckets[bucket].totalPkr += outPkr;
        totalPkr += outPkr;
        return {
          payableNo: r.pay_no, dueDate: r.due_date,
          counterparty: r.counterparty || '—', supplierId: r.supplier_id,
          sourceTable: r.source_table,
          outstandingPkr: outPkr,
          ageDays: days, bucket,
        };
      });

      return res.json({
        success: true,
        data: {
          asOf: today.toISOString(),
          buckets, totalPkr,
          rows: detail,
        },
      });
    } catch (err) {
      console.error('Printable AP aging report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Stock as-of snapshot. Always reflects the current inventory_lots
  // state — no historical roll-back. Grouped per the requested key.
  async printableStock(req, res) {
    try {
      const db = require('../../config/database');
      const { group_by = 'product', status = 'Available' } = req.query;

      let groupCol, nameCol;
      // "Subtype" mirrors the UI's lotSubtype() classification — splits
      // broken lots by grade and surfaces Sortex Rejects / Powder /
      // Sweeping as their own categories, so a single Stock report can
      // answer "how much B1 do I have, how much B2, how much sortex".
      // Blended-milling output is kept separate from pure stock and from other
      // blends: blended broken carries a batch-scoped grade ('M-033-B1'), so it
      // already splits in the blended branches below. Pure rules are unchanged.
      // Grade lots are named by their grade (B1/B2/CSR/…), not "Broken Rice", so
      // classify broken tiers by l.grade. Powder/Sweeping are their own subtypes.
      const SUBTYPE_EXPR = `
        CASE
          WHEN l.processing_type = 'blended' AND l.type = 'finished'
            THEN 'Blended Finished — ' || COALESCE(l.blend_batch_no, 'n/a')
          WHEN l.processing_type = 'blended' AND (l.grade IN ('B1','B2','B3','CSR','Short Grain') OR l.item_name ILIKE '%broken%')
            THEN 'Blended ' || COALESCE(l.grade, 'Broken') || ' — ' || COALESCE(l.blend_batch_no, 'n/a')
          WHEN l.processing_type = 'blended' AND l.item_name ILIKE '%powder%'  THEN 'Blended Powder — '  || COALESCE(l.blend_batch_no, 'n/a')
          WHEN l.processing_type = 'blended' AND l.item_name ILIKE '%sweeping%' THEN 'Blended Sweeping — ' || COALESCE(l.blend_batch_no, 'n/a')
          WHEN l.processing_type = 'blended' AND l.item_name ILIKE '%sortex%' THEN 'Blended Sortex — ' || COALESCE(l.blend_batch_no, 'n/a')
          WHEN l.type = 'finished' THEN 'Finished Rice'
          WHEN l.type = 'raw'      THEN 'Incoming Rice'
          WHEN l.item_name ILIKE '%sortex%' THEN 'Sortex Rejects'
          WHEN l.item_name ILIKE '%powder%' THEN 'Powder'
          WHEN l.item_name ILIKE '%sweeping%' THEN 'Sweeping'
          WHEN l.grade IN ('B1','B2','B3','CSR','Short Grain') THEN l.grade
          WHEN l.item_name ILIKE 'broken%'  THEN 'Broken (ungraded)'
          ELSE COALESCE(p.name, l.item_name, '—')
        END
      `;
      if (group_by === 'supplier')   { groupCol = 'l.supplier_id';  nameCol = 's.name'; }
      else if (group_by === 'warehouse') { groupCol = 'l.warehouse_id'; nameCol = 'w.name'; }
      else if (group_by === 'variety') { groupCol = 'l.variety';      nameCol = 'l.variety'; }
      else if (group_by === 'type')    { groupCol = 'l.type';         nameCol = 'l.type'; }
      else if (group_by === 'grade')   { groupCol = 'l.grade';        nameCol = 'l.grade'; }
      else if (group_by === 'processing_type') { groupCol = 'l.processing_type'; nameCol = 'l.processing_type'; }
      else if (group_by === 'subtype') { groupCol = db.raw(SUBTYPE_EXPR); nameCol = SUBTYPE_EXPR; }
      else                              { groupCol = 'l.product_id';  nameCol = 'p.name'; }

      let q = db('inventory_lots as l')
        .leftJoin('suppliers as s',  'l.supplier_id',  's.id')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .leftJoin('products as p',   'l.product_id',   'p.id');
      if (status && status !== 'all') q = q.where('l.status', status);

      const rows = await q
        .select(
          db.raw(`COALESCE(${nameCol}, '—') as group_name`),
          // Supplier-grouped rows carry the supplier id so the report can link the
          // name to that supplier's ledger. Null for every other grouping (a group
          // like a product spans many suppliers, so no single id applies).
          db.raw(group_by === 'supplier' ? 'l.supplier_id as group_id' : 'NULL::integer as group_id'),
          db.raw('COUNT(l.id)::int as lot_count'),
          db.raw('COALESCE(SUM(CASE WHEN l.net_weight_kg > 0 THEN l.net_weight_kg ELSE CAST(l.qty AS DECIMAL) * 1000 END), 0)::numeric as total_kg'),
          db.raw('COALESCE(SUM(CAST(l.available_qty AS DECIMAL) * 1000), 0)::numeric as available_kg'),
          db.raw('COALESCE(SUM(CAST(l.reserved_qty AS DECIMAL) * 1000), 0)::numeric as reserved_kg'),
          db.raw('COALESCE(SUM(l.total_bags), 0)::int as total_bags'),
          // Value of what's on hand = on-hand kg × cost/kg (NOT the stale
          // landed_cost_total, which carries the original intake value).
          db.raw(`COALESCE(SUM(
            (CASE WHEN l.net_weight_kg > 0 THEN l.net_weight_kg ELSE CAST(l.qty AS DECIMAL) * 1000 END)
            * COALESCE(NULLIF(l.landed_cost_per_kg, 0), NULLIF(l.rate_per_kg, 0), CAST(l.cost_per_unit AS DECIMAL) / 1000.0, 0)
          ), 0)::numeric as total_value_pkr`),
        )
        // Subtype groups by the raw CASE expression itself — passing the long
        // SQL string as a second groupBy arg makes Knex quote it as a column
        // identifier and produces invalid SQL (HTTP 500). Every other dimension
        // must group by both the id column and its joined name.
        .groupBy(...(group_by === 'subtype' ? [db.raw(SUBTYPE_EXPR)] : [groupCol, nameCol]))
        .orderBy('total_kg', 'desc');

      // Per-group lot detail so the report can expand a group inline (no extra
      // round-trip). Grouped in JS by the SAME group_name the aggregate uses, so
      // every dimension — including the subtype CASE — lines up exactly.
      let lotsQ = db('inventory_lots as l')
        .leftJoin('suppliers as s',  'l.supplier_id',  's.id')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .leftJoin('products as p',   'l.product_id',   'p.id');
      if (status && status !== 'all') lotsQ = lotsQ.where('l.status', status);
      const lotRows = await lotsQ.select(
        db.raw(`COALESCE(${nameCol}, '—') as group_name`),
        'l.id as lot_id', 'l.lot_no',
        db.raw("COALESCE(p.name, l.item_name, '—') as item"),
        'l.variety', 'l.grade',
        db.raw('(CASE WHEN l.net_weight_kg > 0 THEN l.net_weight_kg ELSE CAST(l.qty AS DECIMAL) * 1000 END)::numeric as on_hand_kg'),
        db.raw('(CAST(l.available_qty AS DECIMAL) * 1000)::numeric as available_kg'),
        db.raw('COALESCE(l.total_bags, 0)::int as bags'),
        db.raw('COALESCE(NULLIF(l.landed_cost_per_kg, 0), NULLIF(l.rate_per_kg, 0), CAST(l.cost_per_unit AS DECIMAL) / 1000.0, 0)::numeric as cost_per_kg'),
        'l.supplier_id', db.raw("COALESCE(s.name, '—') as supplier"),
        db.raw("COALESCE(w.name, '—') as warehouse"),
      ).orderByRaw('on_hand_kg DESC');
      const lotsByGroup = {};
      for (const lr of lotRows) {
        const onHand = parseFloat(lr.on_hand_kg) || 0;
        const perKg = parseFloat(lr.cost_per_kg) || 0;
        (lotsByGroup[lr.group_name] = lotsByGroup[lr.group_name] || []).push({
          lotId: lr.lot_id, lotNo: lr.lot_no, item: lr.item, variety: lr.variety, grade: lr.grade,
          onHandKg: onHand, availableKg: parseFloat(lr.available_kg) || 0, bags: parseInt(lr.bags, 10) || 0,
          perKg, supplier: lr.supplier, supplierId: lr.supplier_id || null, warehouse: lr.warehouse,
          valuePkr: Math.round(onHand * perKg * 100) / 100,
        });
      }

      const num = (v) => parseFloat(v) || 0;
      const grand = rows.reduce(
        (a, r) => ({
          lotCount: a.lotCount + r.lot_count,
          totalKg: a.totalKg + num(r.total_kg),
          availableKg: a.availableKg + num(r.available_kg),
          reservedKg: a.reservedKg + num(r.reserved_kg),
          bags: a.bags + (parseInt(r.total_bags, 10) || 0),
          valuePkr: a.valuePkr + num(r.total_value_pkr),
        }),
        { lotCount: 0, totalKg: 0, availableKg: 0, reservedKg: 0, bags: 0, valuePkr: 0 }
      );
      grand.perKg = grand.totalKg > 0 ? grand.valuePkr / grand.totalKg : 0;

      return res.json({
        success: true,
        data: {
          asOf: new Date().toISOString(),
          groupBy: group_by,
          rows: rows.map(r => ({
            name:        r.group_name,
            supplierId:  r.group_id || null,
            lotCount:    r.lot_count,
            totalKg:     num(r.total_kg),
            availableKg: num(r.available_kg),
            reservedKg:  num(r.reserved_kg),
            bags:        parseInt(r.total_bags, 10) || 0,
            perKg:       num(r.total_kg) > 0 ? num(r.total_value_pkr) / num(r.total_kg) : 0,
            valuePkr:    num(r.total_value_pkr),
            lots:        lotsByGroup[r.group_name] || [],
          })),
          grand,
        },
      });
    } catch (err) {
      console.error('Printable stock report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ── Purchase ledger — every raw-rice purchase lot, who we bought it from,
  // qty/rate/value. Each row links to the lot. ──
  async printablePurchaseLedger(req, res) {
    try {
      const db = require('../../config/database');
      const { from, to } = req.query;
      let q = db('inventory_lots as l')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .leftJoin('products as p', 'l.product_id', 'p.id')
        .where('l.type', 'raw');
      if (from) q = q.where('l.created_at', '>=', from);
      if (to) q = q.where('l.created_at', '<=', to);
      const rows = await q.select(
        'l.id', 'l.lot_no', 'l.created_at', 'l.item_name', 'l.variety', 'l.grade',
        'l.rate_per_kg', 'l.total_bags', 'l.supplier_id', 'l.payment_status', 'l.net_weight_kg',
        's.name as supplier_name', 'p.name as product_name',
        db.raw('COALESCE(NULLIF(l.received_net_weight_kg,0), NULLIF(l.net_weight_kg,0), l.qty*1000) as kg'),
      ).orderBy('l.created_at', 'desc');

      // Per-lot disposition: direct sales (+ buyers) and milling consumption.
      const lotIds = rows.map((r) => r.id);
      const salesByLot = {}; const milledByLot = {}; const downstreamByLot = {};
      if (lotIds.length) {
        const sales = await db('local_sales as ls')
          .leftJoin('customers as c', 'ls.customer_id', 'c.id')
          .whereIn('ls.lot_id', lotIds)
          .select('ls.lot_id', 'ls.sale_no', 'ls.sale_date', 'ls.quantity_kg', 'ls.total_amount',
            'ls.rate_per_kg', 'ls.payment_status', 'ls.customer_id',
            db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"))
          .orderBy('ls.sale_date', 'asc');
        for (const s of sales) (salesByLot[s.lot_id] = salesByLot[s.lot_id] || []).push(s);

        const milled = await db('batch_source_lots as bsl')
          .leftJoin('milling_batches as mb', 'mb.id', 'bsl.batch_id')
          .whereIn('bsl.lot_id', lotIds)
          .select('bsl.lot_id', 'bsl.qty_mt', 'mb.id as batch_id', 'mb.batch_no');
        for (const m of milled) (milledByLot[m.lot_id] = milledByLot[m.lot_id] || []).push(m);

        // Trace THROUGH milling: each batch's finished/by-product output lots and
        // who bought them, attributed back to the raw lots that fed the batch.
        const batchIds = [...new Set(milled.map((m) => m.batch_id).filter(Boolean))];
        if (batchIds.length) {
          // Total raw input per batch (all source lots) → split a blend's output
          // proportionally among the raw lots that fed it.
          const allSrc = await db('batch_source_lots').whereIn('batch_id', batchIds).select('batch_id', 'qty_mt');
          const batchTotalQty = {};
          for (const x of allSrc) batchTotalQty[x.batch_id] = (batchTotalQty[x.batch_id] || 0) + (parseFloat(x.qty_mt) || 0);

          const refs = batchIds.map((id) => `batch-${id}`);
          const outLots = await db('inventory_lots')
            .whereIn('batch_ref', refs).whereIn('type', ['finished', 'byproduct'])
            .select('id', 'batch_ref', 'type', 'item_name', 'grade');
          const outMeta = {}; const batchOfOut = {};
          for (const o of outLots) {
            outMeta[o.id] = o;
            batchOfOut[o.id] = parseInt(String(o.batch_ref).replace(/^batch-/, ''), 10);
          }
          const outIds = outLots.map((o) => o.id);
          const outSales = outIds.length
            ? await db('local_sales as ls').leftJoin('customers as c', 'ls.customer_id', 'c.id')
              .whereIn('ls.lot_id', outIds)
              .select('ls.id as sale_id', 'ls.lot_id', 'ls.sale_no', 'ls.sale_date', 'ls.quantity_kg', 'ls.rate_per_kg',
                'ls.total_amount', 'ls.payment_status', 'ls.customer_id',
                db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"))
              .orderBy('ls.sale_date', 'asc')
            : [];
          const batchNoById = {};
          for (const m of milled) batchNoById[m.batch_id] = m.batch_no;
          const salesByBatch = {};
          for (const s of outSales) {
            const bid = batchOfOut[s.lot_id]; const om = outMeta[s.lot_id] || {};
            (salesByBatch[bid] = salesByBatch[bid] || []).push({
              batchId: bid, batchNo: batchNoById[bid],
              outputType: om.type, outputItem: om.grade || om.item_name,
              saleId: s.sale_id, saleNo: s.sale_no, date: s.sale_date, customer: s.customer, customerId: s.customer_id || null,
              kg: parseFloat(s.quantity_kg) || 0, ratePerKg: parseFloat(s.rate_per_kg) || 0,
              valuePkr: parseFloat(s.total_amount) || 0, paymentStatus: s.payment_status,
            });
          }
          // Attribute a batch's output sales to each raw lot that fed it,
          // proportional to the lot's share of the batch's raw input.
          for (const [rawLotId, batches] of Object.entries(milledByLot)) {
            const acc = [];
            for (const m of batches) {
              const sales = salesByBatch[m.batch_id];
              if (!sales) continue;
              const tot = batchTotalQty[m.batch_id] || (parseFloat(m.qty_mt) || 0);
              const share = tot > 0 ? (parseFloat(m.qty_mt) || 0) / tot : 1;
              for (const sale of sales) acc.push({ ...sale, kg: sale.kg * share, valuePkr: sale.valuePkr * share, sharePct: share * 100 });
            }
            if (acc.length) downstreamByLot[rawLotId] = acc;
          }
        }
      }

      const detail = rows.map((r) => {
        const kg = parseFloat(r.kg) || 0; const rate = parseFloat(r.rate_per_kg) || 0;
        const lotSales = salesByLot[r.id] || [];
        const lotMilled = milledByLot[r.id] || [];
        const soldKg = lotSales.reduce((s, x) => s + (parseFloat(x.quantity_kg) || 0), 0);
        const milledKg = lotMilled.reduce((s, x) => s + (parseFloat(x.qty_mt) || 0) * 1000, 0);
        const remainingKg = Math.max(0, parseFloat(r.net_weight_kg) || 0);
        return {
          lotId: r.id, lotNo: r.lot_no, date: r.created_at, supplier: r.supplier_name || '—', supplierId: r.supplier_id,
          riceType: r.product_name || r.item_name, variety: r.variety, grade: r.grade,
          mt: kg / 1000, ratePerKg: rate, valuePkr: kg * rate, bags: r.total_bags, paymentStatus: r.payment_status,
          receivedKg: kg, remainingKg, soldKg, milledKg,
          buyers: lotSales.map((x) => ({
            saleNo: x.sale_no, date: x.sale_date, customer: x.customer, customerId: x.customer_id || null,
            kg: parseFloat(x.quantity_kg) || 0, ratePerKg: parseFloat(x.rate_per_kg) || 0,
            valuePkr: parseFloat(x.total_amount) || 0, paymentStatus: x.payment_status,
          })),
          milledInto: lotMilled.map((x) => ({ batchId: x.batch_id, batchNo: x.batch_no, kg: (parseFloat(x.qty_mt) || 0) * 1000 })),
          // Through-milling trace: who bought the finished / by-product output.
          downstreamSales: downstreamByLot[r.id] || [],
        };
      });
      return res.json({ success: true, data: { rows: detail, totals: { lots: detail.length, mt: detail.reduce((s, d) => s + d.mt, 0), valuePkr: detail.reduce((s, d) => s + d.valuePkr, 0) }, period: { from, to } } });
    } catch (err) { console.error('Purchase ledger error:', err); return res.status(500).json({ success: false, message: 'Internal server error.' }); }
  },

  // ── Lot Tracker — one row per purchased (raw) lot with its FULL lifecycle:
  // purchase + payment, delivering vehicles (with per-truck quality), and
  // disposition (remaining / sold-direct + buyers / milled + the finished-rice
  // buyers it produced). Powers the dashboard "Lots" tab. ──
  async lotTracker(req, res) {
    try {
      const db = require('../../config/database');
      const { entity, from, to } = req.query;
      const num = (v) => parseFloat(v) || 0;
      let q = db('inventory_lots as l')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .leftJoin('products as p', 'l.product_id', 'p.id')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .where('l.type', 'raw');
      if (entity) q = q.where('l.entity', entity);
      if (from) q = q.where('l.created_at', '>=', from);
      if (to) q = q.where('l.created_at', '<=', to);
      const lots = await q.select(
        'l.id', 'l.lot_no', 'l.created_at', 'l.purchase_date', 'l.item_name', 'l.variety', 'l.grade',
        'l.rate_per_kg', 'l.landed_cost_per_kg', 'l.landed_cost_total', 'l.total_bags', 'l.bag_weight_kg',
        'l.supplier_id', 'l.payment_status', 'l.paid_amount', 'l.due_amount', 'l.net_weight_kg',
        'l.moisture_pct', 'l.broken_pct', 'l.quality_json', 'l.milling_status',
        's.name as supplier_name', 'p.name as product_name', 'w.name as warehouse_name',
        db.raw('COALESCE(NULLIF(l.received_net_weight_kg,0), NULLIF(l.net_weight_kg,0), l.qty*1000) as kg'),
      ).orderBy('l.created_at', 'desc');
      const lotIds = lots.map((l) => l.id);

      const vehByLot = {}; const salesByLot = {}; const milledByLot = {}; const downstreamByLot = {};
      if (lotIds.length) {
        // Delivering trucks (with per-truck quality)
        const vehs = await db('milling_vehicle_arrivals').whereIn('lot_id', lotIds)
          .select('lot_id', 'vehicle_no', 'driver_name', 'driver_phone', 'weight_mt', 'total_bags', 'bag_size_kg', 'arrival_date', 'quality_json')
          .orderBy('id', 'asc');
        for (const v of vehs) (vehByLot[v.lot_id] = vehByLot[v.lot_id] || []).push(v);

        // Direct sales (sold as raw) + buyers
        const sales = await db('local_sales as ls').leftJoin('customers as c', 'ls.customer_id', 'c.id')
          .whereIn('ls.lot_id', lotIds)
          .select('ls.id as sale_id', 'ls.lot_id', 'ls.sale_no', 'ls.sale_date', 'ls.quantity_kg', 'ls.rate_per_kg',
            'ls.total_amount', 'ls.payment_status', 'ls.customer_id', db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"))
          .orderBy('ls.sale_date', 'asc');
        for (const s of sales) (salesByLot[s.lot_id] = salesByLot[s.lot_id] || []).push(s);

        // Milled into batches
        const milled = await db('batch_source_lots as bsl').leftJoin('milling_batches as mb', 'mb.id', 'bsl.batch_id')
          .whereIn('bsl.lot_id', lotIds).select('bsl.lot_id', 'bsl.qty_mt', 'mb.id as batch_id', 'mb.batch_no');
        for (const m of milled) (milledByLot[m.lot_id] = milledByLot[m.lot_id] || []).push(m);

        // Through-milling: who bought the batch output
        const batchIds = [...new Set(milled.map((m) => m.batch_id).filter(Boolean))];
        if (batchIds.length) {
          // Total raw contribution per batch (ALL its source lots) so a blend's
          // output is split proportionally among the lots that fed it.
          const allSrc = await db('batch_source_lots').whereIn('batch_id', batchIds).select('batch_id', 'qty_mt');
          const batchTotalQty = {};
          for (const x of allSrc) batchTotalQty[x.batch_id] = (batchTotalQty[x.batch_id] || 0) + num(x.qty_mt);

          const refs = batchIds.map((id) => `batch-${id}`);
          const outLots = await db('inventory_lots').whereIn('batch_ref', refs).whereIn('type', ['finished', 'byproduct'])
            .select('id', 'batch_ref', 'type', 'item_name', 'grade', 'landed_cost_per_kg');
          const outMeta = {}; const batchOfOut = {};
          for (const o of outLots) { outMeta[o.id] = o; batchOfOut[o.id] = parseInt(String(o.batch_ref).replace(/^batch-/, ''), 10); }
          const outIds = outLots.map((o) => o.id);
          const outSales = outIds.length ? await db('local_sales as ls').leftJoin('customers as c', 'ls.customer_id', 'c.id')
            .whereIn('ls.lot_id', outIds)
            .select('ls.id as sale_id', 'ls.lot_id', 'ls.sale_no', 'ls.sale_date', 'ls.quantity_kg', 'ls.rate_per_kg', 'ls.total_amount', 'ls.payment_status', 'ls.customer_id', db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"))
            .orderBy('ls.sale_date', 'asc') : [];
          const batchNoById = {}; for (const m of milled) batchNoById[m.batch_id] = m.batch_no;
          const salesByBatch = {};
          for (const s of outSales) {
            const bid = batchOfOut[s.lot_id]; const om = outMeta[s.lot_id] || {};
            const cpk = num(om.landed_cost_per_kg); const kg = num(s.quantity_kg);
            (salesByBatch[bid] = salesByBatch[bid] || []).push({ batchId: bid, batchNo: batchNoById[bid], outputType: om.type, outputItem: om.grade || om.item_name, saleId: s.sale_id, saleNo: s.sale_no, date: s.sale_date, customer: s.customer, customerId: s.customer_id || null, kg, ratePerKg: num(s.rate_per_kg), valuePkr: num(s.total_amount), costPerKg: cpk, cost: cpk * kg, paymentStatus: s.payment_status });
          }
          for (const [rawLotId, batches] of Object.entries(milledByLot)) {
            const acc = [];
            for (const m of batches) {
              const sales = salesByBatch[m.batch_id];
              if (!sales) continue;
              const tot = batchTotalQty[m.batch_id] || num(m.qty_mt);
              const share = tot > 0 ? num(m.qty_mt) / tot : 1; // this lot's slice of the batch
              for (const sale of sales) {
                acc.push({ ...sale, kg: sale.kg * share, valuePkr: sale.valuePkr * share, cost: sale.cost * share, sharePct: share * 100 });
              }
            }
            if (acc.length) downstreamByLot[rawLotId] = acc;
          }
        }
      }

      const rows = lots.map((l) => {
        const kg = num(l.kg); const rate = num(l.rate_per_kg) || num(l.landed_cost_per_kg);
        const lotSales = salesByLot[l.id] || [];
        const lotMilled = milledByLot[l.id] || [];
        const soldKg = lotSales.reduce((a, x) => a + num(x.quantity_kg), 0);
        const milledKg = lotMilled.reduce((a, x) => a + num(x.qty_mt) * 1000, 0);
        const remainingKg = Math.max(0, num(l.net_weight_kg));
        const status = milledKg > 0 ? 'Milled' : soldKg > 0 ? (remainingKg > 0 ? 'Part-sold' : 'Sold') : remainingKg > 0 ? 'In stock' : 'Empty';
        // Realized trading margin = revenue from what's been sold (this lot sold
        // as raw + the finished/by-product it produced) minus the landed cost of
        // those sold goods (raw lot cost for direct sales; output lot residual
        // cost for downstream sales).
        const lotCpk = num(l.landed_cost_per_kg);
        const downstream = downstreamByLot[l.id] || [];
        const directRevenue = lotSales.reduce((a, x) => a + num(x.total_amount), 0);
        const directCost = lotSales.reduce((a, x) => a + num(x.quantity_kg) * lotCpk, 0);
        const downRevenue = downstream.reduce((a, x) => a + num(x.valuePkr), 0);
        const downCost = downstream.reduce((a, x) => a + num(x.cost), 0);
        const realizedRevenue = directRevenue + downRevenue;
        const realizedCost = directCost + downCost;
        const realizedMargin = realizedRevenue - realizedCost;
        const realizedMarginPct = realizedRevenue > 0 ? (realizedMargin / realizedRevenue) * 100 : 0;
        return {
          lotId: l.id, lotNo: l.lot_no, date: l.purchase_date || l.created_at,
          supplier: l.supplier_name || '—', supplierId: l.supplier_id,
          riceType: l.product_name || l.item_name, variety: l.variety, grade: l.grade,
          warehouse: l.warehouse_name,
          receivedKg: kg, ratePerKg: num(l.rate_per_kg), landedCostPerKg: num(l.landed_cost_per_kg), landedTotal: num(l.landed_cost_total) || kg * rate,
          bags: l.total_bags, bagWeightKg: num(l.bag_weight_kg),
          paymentStatus: l.payment_status, paidAmount: num(l.paid_amount), dueAmount: num(l.due_amount),
          moisturePct: l.moisture_pct, brokenPct: l.broken_pct, qualityJson: l.quality_json || null,
          remainingKg, soldKg, milledKg, status,
          realizedRevenue, realizedCost, realizedMargin, realizedMarginPct, hasSales: realizedRevenue > 0,
          vehicles: (vehByLot[l.id] || []).map((v) => ({ vehicleNo: v.vehicle_no, driverName: v.driver_name, driverPhone: v.driver_phone, weightMt: num(v.weight_mt), totalBags: v.total_bags, bagSizeKg: num(v.bag_size_kg), arrivalDate: v.arrival_date, quality: v.quality_json || null })),
          buyers: lotSales.map((x) => ({ saleId: x.sale_id, saleNo: x.sale_no, date: x.sale_date, customer: x.customer, customerId: x.customer_id || null, kg: num(x.quantity_kg), ratePerKg: num(x.rate_per_kg), valuePkr: num(x.total_amount), paymentStatus: x.payment_status })),
          milledInto: lotMilled.map((x) => ({ batchId: x.batch_id, batchNo: x.batch_no, kg: num(x.qty_mt) * 1000 })),
          downstreamSales: downstreamByLot[l.id] || [],
        };
      });
      return res.json({ success: true, data: { rows, totals: { lots: rows.length, mt: rows.reduce((s, r) => s + r.receivedKg / 1000, 0), valuePkr: rows.reduce((s, r) => s + r.landedTotal, 0) } } });
    } catch (err) { console.error('Lot tracker error:', err); return res.status(500).json({ success: false, message: 'Internal server error.' }); }
  },

  // ── Sales Tracker — one row per local sale with its FULL lifecycle traced
  // BACKWARDS: the sold lot, its provenance (raw lot + supplier; for milled
  // output → the batch and the raw lots that fed it), cost-of-goods vs sale
  // margin, and payment. Powers the dashboard "Sales" tab Sale-360 slider. ──
  async salesTracker(req, res) {
    try {
      const db = require('../../config/database');
      const { entity, from, to } = req.query;
      const num = (v) => parseFloat(v) || 0;
      let q = db('local_sales as ls')
        .leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
        .leftJoin('suppliers as sup', 'il.supplier_id', 'sup.id');
      if (entity) q = q.where('ls.entity', entity);
      if (from) q = q.where('ls.sale_date', '>=', from);
      if (to) q = q.where('ls.sale_date', '<=', to);
      const sales = await q.select(
        'ls.id', 'ls.sale_no', 'ls.sale_date', 'ls.item_name', 'ls.item_type', 'ls.quantity_kg', 'ls.quantity_bags',
        'ls.rate_per_kg', 'ls.total_amount', 'ls.paid_amount', 'ls.due_amount', 'ls.payment_status', 'ls.payment_mode',
        'ls.collection_location', 'ls.lot_id', 'ls.customer_id', db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"),
        'il.lot_no', 'il.type as lot_type', 'il.landed_cost_per_kg', 'il.batch_ref',
        'il.supplier_id as lot_supplier_id', 'sup.name as lot_supplier',
      ).orderBy('ls.sale_date', 'desc');

      // Provenance for sold MILLED output: batch → raw source lots + suppliers.
      const batchIds = [...new Set(sales.map((s) => s.batch_ref).filter(Boolean)
        .map((r) => parseInt(String(r).replace(/^batch-/, ''), 10)).filter(Boolean))];
      const rawByBatch = {}; const batchNoById = {};
      if (batchIds.length) {
        const srcs = await db('batch_source_lots as bsl')
          .leftJoin('inventory_lots as src', 'bsl.lot_id', 'src.id')
          .leftJoin('suppliers as s', 'src.supplier_id', 's.id')
          .leftJoin('milling_batches as mb', 'bsl.batch_id', 'mb.id')
          .whereIn('bsl.batch_id', batchIds)
          .select('bsl.batch_id', 'bsl.qty_mt', 'mb.batch_no', 'src.id as raw_lot_id', 'src.lot_no as raw_lot_no',
            'src.supplier_id as raw_supplier_id', 's.name as raw_supplier');
        // Total raw input per batch → each source lot's % contribution (blend share).
        const batchTotalQty = {};
        for (const r of srcs) batchTotalQty[r.batch_id] = (batchTotalQty[r.batch_id] || 0) + num(r.qty_mt);
        for (const r of srcs) {
          batchNoById[r.batch_id] = r.batch_no;
          const tot = batchTotalQty[r.batch_id] || num(r.qty_mt);
          (rawByBatch[r.batch_id] = rawByBatch[r.batch_id] || []).push({
            lotId: r.raw_lot_id, lotNo: r.raw_lot_no, supplier: r.raw_supplier, supplierId: r.raw_supplier_id || null,
            kg: num(r.qty_mt) * 1000, sharePct: tot > 0 ? (num(r.qty_mt) / tot) * 100 : 100,
          });
        }
      }

      const rows = sales.map((s) => {
        const kg = num(s.quantity_kg); const total = num(s.total_amount); const cpk = num(s.landed_cost_per_kg);
        const cost = cpk * kg; const margin = total - cost; const marginPct = total > 0 ? (margin / total) * 100 : 0;
        let provenance;
        if ((s.lot_type || '') === 'raw') {
          provenance = { kind: 'raw', rawLots: s.lot_id ? [{ lotId: s.lot_id, lotNo: s.lot_no, supplier: s.lot_supplier, supplierId: s.lot_supplier_id || null }] : [] };
        } else if (s.batch_ref) {
          const bid = parseInt(String(s.batch_ref).replace(/^batch-/, ''), 10);
          provenance = { kind: 'milled', batchId: bid, batchNo: batchNoById[bid], rawLots: rawByBatch[bid] || [] };
        } else {
          provenance = { kind: 'unknown', rawLots: [] };
        }
        return {
          saleId: s.id, saleNo: s.sale_no, saleDate: s.sale_date,
          customer: s.customer, customerName: s.customer, customerId: s.customer_id || null,
          itemName: s.item_name, itemType: s.item_type, quantityKg: kg, quantityBags: s.quantity_bags,
          ratePerKg: num(s.rate_per_kg), totalAmount: total, paidAmount: num(s.paid_amount), dueAmount: num(s.due_amount),
          paymentStatus: s.payment_status, paymentMode: s.payment_mode, collectionLocation: s.collection_location,
          lotId: s.lot_id, lotNo: s.lot_no, lotType: s.lot_type,
          soldCostPerKg: cpk, cost, margin, marginPct,
          provenance,
        };
      });
      return res.json({ success: true, data: { rows, totals: { count: rows.length, valuePkr: rows.reduce((a, r) => a + r.totalAmount, 0), margin: rows.reduce((a, r) => a + r.margin, 0), due: rows.reduce((a, r) => a + r.dueAmount, 0) } } });
    } catch (err) { console.error('Sales tracker error:', err); return res.status(500).json({ success: false, message: 'Internal server error.' }); }
  },

  // ── Sales ledger — local sales + export orders, each clickable to its sale/order. ──
  async printableSalesLedger(req, res) {
    try {
      const db = require('../../config/database');
      const { from, to } = req.query;
      let ls = db('local_sales as ls').leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .select('ls.id', 'ls.sale_no', 'ls.sale_date', 'ls.item_name', 'ls.item_type', 'ls.quantity_kg', 'ls.quantity_bags', 'ls.rate_per_kg', 'ls.total_amount', 'ls.lot_no', 'ls.lot_id', 'ls.payment_status', 'ls.customer_id', db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer"));
      if (from) ls = ls.where('ls.sale_date', '>=', from);
      if (to) ls = ls.where('ls.sale_date', '<=', to);
      const localRows = await ls.orderBy('ls.sale_date', 'desc');
      let eo = db('export_orders as o').leftJoin('customers as c', 'o.customer_id', 'c.id')
        .select('o.id', 'o.order_no', 'o.created_at', 'o.product_name', 'o.qty_mt', 'o.price_per_mt', 'o.total_bags', 'o.status', 'o.customer_id', db.raw("COALESCE(c.name, '—') as customer"));
      if (from) eo = eo.where('o.created_at', '>=', from);
      if (to) eo = eo.where('o.created_at', '<=', to);
      const exportRows = await eo.orderBy('o.created_at', 'desc');
      const local = localRows.map((r) => ({ id: r.id, ref: r.sale_no, date: r.sale_date, customer: r.customer, customerId: r.customer_id || null, item: r.item_name, itemType: r.item_type, mt: (parseFloat(r.quantity_kg) || 0) / 1000, bags: r.quantity_bags || 0, ratePerKg: parseFloat(r.rate_per_kg) || 0, valuePkr: parseFloat(r.total_amount) || 0, lotNo: r.lot_no, lotId: r.lot_id, paymentStatus: r.payment_status }));
      const exp = exportRows.map((r) => ({ id: r.id, ref: r.order_no, date: r.created_at, customer: r.customer, customerId: r.customer_id || null, item: r.product_name, mt: parseFloat(r.qty_mt) || 0, bags: r.total_bags || 0, ratePerMt: parseFloat(r.price_per_mt) || 0, valueUsd: (parseFloat(r.qty_mt) || 0) * (parseFloat(r.price_per_mt) || 0), status: r.status }));
      return res.json({ success: true, data: { local, export: exp, totals: { localCount: local.length, localMt: local.reduce((s, d) => s + d.mt, 0), localPkr: local.reduce((s, d) => s + d.valuePkr, 0), exportCount: exp.length, exportMt: exp.reduce((s, d) => s + d.mt, 0), exportUsd: exp.reduce((s, d) => s + d.valueUsd, 0) }, period: { from, to } } });
    } catch (err) { console.error('Sales ledger error:', err); return res.status(500).json({ success: false, message: 'Internal server error.' }); }
  },

  // ── Detailed stock — every lot on hand with the supplier it was purchased from
  // (and, for milled output, the raw-rice supplier traced via its batch) + the
  // mill store. Each lot links to its detail. ──
  async printableStockDetail(req, res) {
    try {
      const db = require('../../config/database');
      const { status = 'Available' } = req.query;
      let q = db('inventory_lots as l')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .leftJoin('products as p', 'l.product_id', 'p.id')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id');
      if (status && status !== 'all') q = q.where('l.status', status);
      const lots = await q.select(
        'l.id', 'l.lot_no', 'l.type', 'l.item_name', 'l.variety', 'l.grade', 'l.processing_type',
        'l.blend_batch_no', 'l.batch_ref', 'l.supplier_id', 'l.status', 'l.total_bags',
        's.name as supplier_name', 'p.name as product_name', 'w.name as warehouse_name',
        db.raw('COALESCE(NULLIF(l.net_weight_kg,0), l.qty*1000) as on_hand_kg'),
        db.raw('l.available_qty*1000 as available_kg'),
        db.raw('l.reserved_qty*1000 as reserved_kg'),
        db.raw('COALESCE(NULLIF(l.landed_cost_per_kg,0), NULLIF(l.rate_per_kg,0), l.cost_per_unit/1000.0, 0) as cost_per_kg'),
      ).orderBy([{ column: 'l.type' }, { column: 'l.lot_no' }]);
      // Trace milled output (batch_ref = 'batch-<id>') back to the raw-rice supplier.
      const ids = [...new Set(lots.map((l) => l.batch_ref).filter(Boolean).map((r) => parseInt(String(r).replace(/^batch-/, ''), 10)).filter(Boolean))];
      const batchSrc = {};
      if (ids.length) {
        const bs = await db('milling_batches as mb').leftJoin('suppliers as s', 'mb.supplier_id', 's.id').whereIn('mb.id', ids).select('mb.id', 'mb.batch_no', 's.name as supplier');
        for (const b of bs) batchSrc[`batch-${b.id}`] = { batchNo: b.batch_no, supplier: b.supplier };
      }
      // Subtype tag — the inventory "tag" each lot is filed under (Sweeping, B1,
      // B2, B3, CSR, Powder, Sortex, Broken, Finished/Unprocessed Rice).
      const tagOf = (l) => {
        const name = (l.item_name || '').toLowerCase();
        const grade = (l.grade || '').toUpperCase();
        if (name.includes('sweeping') || (l.grade || '').toLowerCase().includes('sweeping')) return 'Sweeping';
        if (name.includes('powder')) return 'Powder';
        if (name.includes('sortex')) return 'Sortex';
        if (grade === 'SHORT GRAIN') return 'Short Grain';
        if (['B1', 'B2', 'B3', 'CSR'].includes(grade)) return grade;
        if (name.startsWith('broken')) return 'Broken';
        if (l.type === 'finished') return 'Finished Rice';
        if (l.type === 'raw') return 'Unprocessed Rice';
        return 'Other';
      };
      const rows = lots.map((l) => {
        const onHand = parseFloat(l.on_hand_kg) || 0; const cpk = parseFloat(l.cost_per_kg) || 0; const src = batchSrc[l.batch_ref];
        return { lotId: l.id, lotNo: l.lot_no, type: l.type, item: l.product_name || l.item_name, variety: l.variety, grade: l.grade,
          subtype: tagOf(l),
          supplier: l.supplier_name, supplierId: l.supplier_id,
          sourceBatch: src?.batchNo || l.blend_batch_no || null, sourceSupplier: src?.supplier || null,
          warehouse: l.warehouse_name, status: l.status, bags: l.total_bags,
          onHandMt: onHand / 1000, availableMt: (parseFloat(l.available_kg) || 0) / 1000, reservedMt: (parseFloat(l.reserved_kg) || 0) / 1000,
          costPerKg: cpk, valuePkr: onHand * cpk };
      });
      const ms = await db('mill_stock as ms').join('mill_items as mi', 'ms.item_id', 'mi.id').leftJoin('suppliers as s', 'mi.preferred_supplier_id', 's.id')
        .where('ms.quantity_available', '>', 0)
        .select('mi.name', 'mi.category', 'mi.unit', 'ms.quantity_available', 'mi.avg_cost_per_unit', 's.name as supplier').orderBy('mi.category');
      const millStore = ms.map((m) => ({ name: m.name, category: m.category, unit: m.unit, qty: parseFloat(m.quantity_available) || 0, costPerUnit: parseFloat(m.avg_cost_per_unit) || 0, supplier: m.supplier }));
      return res.json({ success: true, data: { rows, millStore, totals: { lots: rows.length, mt: rows.reduce((s, r) => s + r.onHandMt, 0), valuePkr: rows.reduce((s, r) => s + r.valuePkr, 0), millStoreValue: millStore.reduce((s, m) => s + m.qty * m.costPerUnit, 0) } } });
    } catch (err) { console.error('Stock detail error:', err); return res.status(500).json({ success: false, message: 'Internal server error.' }); }
  },

  // ── Sweeping report — every sweeping output lot traced to the milling batch it
  // came from and the raw-rice supplier, so you can see the sweeping yield per
  // milled lot. ──
  async printableSweeping(req, res) {
    try {
      const db = require('../../config/database');
      const { status = 'Available' } = req.query;
      let q = db('inventory_lots as l').leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .where((b) => b.where('l.item_name', 'ilike', '%sweeping%').orWhere('l.grade', 'ilike', '%sweeping%'));
      if (status && status !== 'all') q = q.where('l.status', status);
      const lots = await q.select(
        'l.id', 'l.lot_no', 'l.item_name', 'l.grade', 'l.variety', 'l.batch_ref', 'l.blend_batch_no',
        'l.status', 'l.supplier_id', 'l.total_bags', 'l.available_qty', 's.name as supplier_name',
        db.raw('COALESCE(NULLIF(l.net_weight_kg,0), l.qty*1000) as kg'),
        db.raw('COALESCE(NULLIF(l.landed_cost_per_kg,0), NULLIF(l.rate_per_kg,0), l.cost_per_unit/1000.0, 0) as cost_per_kg'),
      ).orderBy('l.lot_no');
      // Trace each sweeping lot back to its batch (batch_ref='batch-<id>') + raw supplier + raw input MT.
      const ids = [...new Set(lots.map((l) => l.batch_ref).filter(Boolean).map((r) => parseInt(String(r).replace(/^batch-/, ''), 10)).filter(Boolean))];
      const bi = {};
      if (ids.length) {
        const bs = await db('milling_batches as mb').leftJoin('suppliers as s', 'mb.supplier_id', 's.id').leftJoin('products as p', 'mb.product_id', 'p.id')
          .whereIn('mb.id', ids).select('mb.id', 'mb.batch_no', 'mb.raw_qty_mt', 'mb.created_at', 's.name as raw_supplier', 's.id as raw_supplier_id', 'p.name as product');
        for (const b of bs) bi[`batch-${b.id}`] = { batchId: b.id, batchNo: b.batch_no, rawSupplier: b.raw_supplier, rawSupplierId: b.raw_supplier_id, product: b.product, rawMt: parseFloat(b.raw_qty_mt) || 0, date: b.created_at };
      }
      const rows = lots.map((l) => {
        const kg = parseFloat(l.kg) || 0; const cpk = parseFloat(l.cost_per_kg) || 0; const b = bi[l.batch_ref] || {};
        return { lotId: l.id, lotNo: l.lot_no, batchId: b.batchId, batchNo: b.batchNo || l.blend_batch_no || null,
          rawSupplier: b.rawSupplier || l.supplier_name || null, rawSupplierId: b.rawSupplierId || l.supplier_id || null,
          milledProduct: b.product || null, rawMt: b.rawMt || null, date: b.date,
          sweepingMt: kg / 1000, availableMt: parseFloat(l.available_qty) || 0, ratePerKg: cpk, valuePkr: kg * cpk,
          bags: l.total_bags, status: l.status };
      });
      const totals = { lots: rows.length, sweepingMt: rows.reduce((s, r) => s + r.sweepingMt, 0), valuePkr: rows.reduce((s, r) => s + r.valuePkr, 0), batches: new Set(rows.map((r) => r.batchNo).filter(Boolean)).size };
      return res.json({ success: true, data: { rows, totals } });
    } catch (err) { console.error('Sweeping report error:', err); return res.status(500).json({ success: false, message: 'Internal server error.' }); }
  },

  // ── True ACCRUAL P&L — revenue recognized on sale, matched against the COGS of
  // the goods actually sold (local_sales.cogs_total_pkr / export inventory COGS).
  // Unsold purchases stay in inventory (a memo line), so a buy-heavy period no
  // longer shows a false loss. Operating expenses are period costs (business
  // expenses + direct export selling costs, de-duped against expenses). ──
  async printablePnlAccrual(req, res) {
    try {
      const db = require('../../config/database');
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ success: false, message: 'from and to dates are required.' });
      const fromDate = new Date(from); const toDate = new Date(to);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return res.status(400).json({ success: false, message: 'Invalid from/to date.' });
      const num = (v) => parseFloat(v) || 0;

      // Revenue + matched COGS (recognized when sold/shipped).
      const exportRow = await db('export_orders').whereIn('status', ['Shipped', 'Arrived', 'Closed']).whereBetween('updated_at', [fromDate, toDate])
        .sum({ rev: 'contract_value_pkr_locked' }).sum({ cogs: 'inventory_cogs_total_pkr' }).count({ cnt: 'id' }).first();
      const localRow = await db('local_sales').where('status', 'Completed').whereBetween('sale_date', [fromDate, toDate])
        .sum({ rev: 'total_amount' }).sum({ cogs: 'cogs_total_pkr' }).count({ cnt: 'id' }).first();

      // Operating expenses (period costs — NOT inventory). Direct export selling
      // costs not already booked as a business_expense (avoid double-count).
      const opexRow = await db('business_expenses').whereBetween('expense_date', [fromDate, toDate]).where('amount_pkr', '>', 0)
        .sum({ total: 'amount_pkr' }).count({ cnt: 'id' }).first();
      const opexByCat = await db('business_expenses').whereBetween('expense_date', [fromDate, toDate]).where('amount_pkr', '>', 0)
        .select('category').sum({ total: 'amount_pkr' }).count({ cnt: 'id' }).groupBy('category').orderByRaw('SUM(amount_pkr) DESC');
      // Individual expenses so the FE can expand a category to its line items.
      const opexLines = await db('business_expenses as e').leftJoin('suppliers as s', 'e.supplier_id', 's.id')
        .whereBetween('e.expense_date', [fromDate, toDate]).where('e.amount_pkr', '>', 0)
        .select('e.expense_no', 'e.category', 'e.vendor_name', 'e.supplier_id', 'e.amount_pkr', 'e.expense_date', db.raw("COALESCE(s.name, e.vendor_name, '—') as payee"))
        .orderBy('e.amount_pkr', 'desc').limit(500);
      // Export selling costs are matched to the SHIPPED export revenue (recognized
      // when the order ships), not when the cost was incurred — costs for orders
      // still in progress stay deferred (WIP), keeping the accrual matching clean.
      const sellingRow = await db('export_order_costs as eoc')
        .join('export_orders as eo', 'eoc.order_id', 'eo.id')
        .whereIn('eo.status', ['Shipped', 'Arrived', 'Closed']).whereBetween('eo.updated_at', [fromDate, toDate])
        .where('eoc.amount', '>', 0)
        .whereRaw("COALESCE(eoc.notes,'') NOT ILIKE 'From business expense%'")
        .sum({ total: db.raw('CASE WHEN COALESCE(eoc.base_amount_pkr,0) > 0 THEN eoc.base_amount_pkr ELSE COALESCE(eoc.amount,0)*COALESCE(eoc.fx_rate,1) END') }).count({ cnt: 'eoc.id' }).first();

      // Memo: rice still in inventory (its cost is deferred, not yet expensed).
      const invRow = await db('inventory_lots').whereIn('type', ['raw', 'finished']).where('status', 'Available')
        .select(db.raw('COALESCE(SUM((CASE WHEN net_weight_kg>0 THEN net_weight_kg ELSE qty*1000 END) * COALESCE(NULLIF(landed_cost_per_kg,0),NULLIF(rate_per_kg,0),cost_per_unit/1000.0,0)),0) as val')).first();

      // Inventory roll-forward: raw purchases LANDED in the period (cost basis,
      // full intake qty — this is what was added to inventory when bought).
      const purchaseRow = await db('inventory_lots').where('type', 'raw').whereBetween('created_at', [fromDate, toDate])
        .select(db.raw('COALESCE(SUM((CASE WHEN received_net_weight_kg>0 THEN received_net_weight_kg WHEN net_weight_kg>0 THEN net_weight_kg ELSE qty*1000 END) * COALESCE(NULLIF(landed_cost_per_kg,0),NULLIF(rate_per_kg,0),cost_per_unit/1000.0,0)),0) as val')).first();

      const revenue = { exportPkr: num(exportRow.rev), exportCount: parseInt(exportRow.cnt, 10) || 0, localPkr: num(localRow.rev), localCount: parseInt(localRow.cnt, 10) || 0 };
      revenue.totalPkr = revenue.exportPkr + revenue.localPkr;
      const cogs = { exportPkr: num(exportRow.cogs), localPkr: num(localRow.cogs) };
      cogs.totalPkr = cogs.exportPkr + cogs.localPkr;
      const grossProfitPkr = revenue.totalPkr - cogs.totalPkr;
      const grossMarginPct = revenue.totalPkr > 0 ? (grossProfitPkr / revenue.totalPkr) * 100 : 0;
      const opex = { businessPkr: num(opexRow.total), businessCount: parseInt(opexRow.cnt, 10) || 0, sellingPkr: num(sellingRow.total), sellingCount: parseInt(sellingRow.cnt, 10) || 0, byCategory: opexByCat.map((r) => ({ category: r.category, count: parseInt(r.cnt, 10) || 0, amountPkr: num(r.total) })), expenses: opexLines.map((r) => ({ ref: r.expense_no, category: r.category, payee: r.payee, supplierId: r.supplier_id || null, date: r.expense_date, amountPkr: num(r.amount_pkr) })) };
      opex.totalPkr = opex.businessPkr + opex.sellingPkr;
      const netProfitPkr = grossProfitPkr - opex.totalPkr;
      const netMarginPct = revenue.totalPkr > 0 ? (netProfitPkr / revenue.totalPkr) * 100 : 0;

      // Per-sale detail (revenue, COGS, gross) — clickable.
      const exportLines = await db('export_orders as o').leftJoin('customers as c', 'o.customer_id', 'c.id')
        .whereIn('o.status', ['Shipped', 'Arrived', 'Closed']).whereBetween('o.updated_at', [fromDate, toDate])
        .select('o.id', 'o.order_no', 'o.product_name', 'o.customer_id', db.raw('COALESCE(o.contract_value_pkr_locked,0) as rev'), db.raw('COALESCE(o.inventory_cogs_total_pkr,0) as cogs'), db.raw("COALESCE(c.name,'—') as customer")).orderByRaw('rev DESC').limit(200);
      const localLines = await db('local_sales as ls').leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .where('ls.status', 'Completed').whereBetween('ls.sale_date', [fromDate, toDate])
        .select('ls.id', 'ls.sale_no', 'ls.lot_id', 'ls.item_name', 'ls.total_amount', 'ls.cogs_total_pkr', 'ls.customer_id', db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer")).orderBy('ls.total_amount', 'desc').limit(200);
      const sales = [
        ...exportLines.map((r) => ({ channel: 'Export', id: r.id, ref: r.order_no, party: r.customer, customerId: r.customer_id || null, item: r.product_name, revPkr: num(r.rev), cogsPkr: num(r.cogs), grossPkr: num(r.rev) - num(r.cogs) })),
        ...localLines.map((r) => ({ channel: 'Local', id: r.id, lotId: r.lot_id, ref: r.sale_no, party: r.customer, customerId: r.customer_id || null, item: r.item_name, revPkr: num(r.total_amount), cogsPkr: num(r.cogs_total_pkr), grossPkr: num(r.total_amount) - num(r.cogs_total_pkr) })),
      ].sort((a, b) => b.revPkr - a.revPkr);

      return res.json({
        success: true,
        data: {
          range: { from: fromDate.toISOString(), to: toDate.toISOString() },
          revenue, cogs, grossProfitPkr, grossMarginPct, opex, netProfitPkr, netMarginPct,
          inventoryOnHandPkr: num(invRow.val),
          // Roll-forward identity: Opening + Purchases − COGS = Closing. Closing is
          // the current on-hand value; opening is derived so the identity holds
          // exactly (no historical snapshot exists), reconciling COGS to inventory.
          inventory: (() => {
            const closingPkr = num(invRow.val);
            const purchasesPkr = num(purchaseRow.val);
            const openingPkr = closingPkr - purchasesPkr + cogs.totalPkr;
            return { openingPkr, purchasesPkr, cogsPkr: cogs.totalPkr, closingPkr };
          })(),
          detail: { sales, expenses: opex.byCategory },
        },
      });
    } catch (err) { console.error('Accrual P&L error:', err); return res.status(500).json({ success: false, message: 'Internal server error.' }); }
  },

  // ──── Audit Trail (printable) — full activity log over a period, with a
  // category/action/user summary + a detail table. Mirrors the Audit Trail
  // page's data but shaped for a clean printable/CSV report. ────
  async printableAuditTrail(req, res) {
    try {
      const db = require('../../config/database');
      const { from, to, user_id, action, entity_type } = req.query;
      const cap = Math.min(parseInt(req.query.limit, 10) || 1500, 5000);

      const base = () => {
        let q = db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.user_id');
        if (from) q = q.where('a.created_at', '>=', from);
        if (to) q = q.where('a.created_at', '<=', to);
        if (user_id) q = q.where('a.user_id', user_id);
        if (action && action !== 'All') q = q.where('a.action', 'ilike', `%${action}%`);
        if (entity_type && entity_type !== 'All') q = q.where('a.entity_type', entity_type);
        return q;
      };

      const catOf = (act) => {
        const a = (act || '').toLowerCase();
        if (/(create|add|record|new|register)/.test(a)) return 'Create';
        if (/(update|edit|adjust|set|change|rename|price)/.test(a)) return 'Update';
        if (/(delete|remove|void|reject|cancel|reverse)/.test(a)) return 'Delete';
        if (/(approve|confirm|accept|authorize|finalize)/.test(a)) return 'Approve';
        if (/(pay|payment|receipt|settle)/.test(a)) return 'Payment';
        if (/(login|logout|auth)/.test(a)) return 'Auth';
        return 'Other';
      };
      const summarize = (details) => {
        if (!details) return '';
        let d = details;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return String(details).slice(0, 160); } }
        try { const s = JSON.stringify(d); return s.length > 180 ? s.slice(0, 177) + '…' : s; } catch { return ''; }
      };

      const totalRow = await base().count('a.id as c').first();
      const total = parseInt(totalRow.c, 10) || 0;
      const rows = await base()
        .select('a.id', 'a.created_at', 'a.action', 'a.entity_type', 'a.entity_id',
          'a.details', 'a.ip_address', 'a.user_id', 'u.full_name as user_name', 'u.email as user_email')
        .orderBy('a.created_at', 'desc').limit(cap);
      const byActionRows = await base().select('a.action').count('a.id as c').groupBy('a.action').orderBy('c', 'desc');
      const byUserRows = await base().select('a.user_id', 'u.full_name as user_name')
        .count('a.id as c').groupBy('a.user_id', 'u.full_name').orderBy('c', 'desc').limit(20);

      const byCategory = {};
      for (const r of byActionRows) { const c = catOf(r.action); byCategory[c] = (byCategory[c] || 0) + (parseInt(r.c, 10) || 0); }

      const detail = rows.map((r) => ({
        id: r.id, date: r.created_at,
        user: r.user_name || r.user_email || (r.user_id ? `User #${r.user_id}` : 'System'),
        userId: r.user_id, action: r.action, category: catOf(r.action),
        entityType: r.entity_type || '—', entityId: r.entity_id || '',
        ip: r.ip_address || '', details: summarize(r.details),
      }));

      return res.json({ success: true, data: {
        rows: detail, total, shown: detail.length, truncated: total > detail.length,
        byCategory,
        topActions: byActionRows.slice(0, 15).map((r) => ({ action: r.action, count: parseInt(r.c, 10) || 0 })),
        topUsers: byUserRows.map((r) => ({ userId: r.user_id, user: r.user_name || (r.user_id ? `User #${r.user_id}` : 'System'), count: parseInt(r.c, 10) || 0 })),
        period: { from, to },
      } });
    } catch (err) { console.error('Audit trail report error:', err); return res.status(500).json({ success: false, message: 'Internal server error.' }); }
  },
};

module.exports = reportingController;
