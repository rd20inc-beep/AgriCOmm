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
      const db = require('../../db');
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
          'b.id', 'b.batch_no', 'b.status',
          'b.raw_qty_mt', 'b.planned_finished_mt', 'b.actual_finished_mt', 'b.yield_pct',
          'b.created_at', 'b.completed_at',
          'm.name as mill_name',
          's.name as supplier_name',
          'p.name as product_name',
        )
        .whereBetween('b.created_at', [fromDate, toDate])
        .orderBy('b.created_at', 'asc');

      const num = (v) => parseFloat(v) || 0;
      const summary = batches.reduce(
        (acc, b) => {
          acc.batchCount += 1;
          acc.rawMt += num(b.raw_qty_mt);
          acc.finishedMt += num(b.actual_finished_mt);
          acc.plannedMt += num(b.planned_finished_mt);
          if (b.status === 'Completed' || b.status === 'Approved') acc.completed += 1;
          return acc;
        },
        { batchCount: 0, rawMt: 0, finishedMt: 0, plannedMt: 0, completed: 0 }
      );
      summary.avgYieldPct = summary.rawMt > 0 ? (summary.finishedMt / summary.rawMt) * 100 : 0;

      const groupBy = (key, label) => {
        const map = new Map();
        for (const b of batches) {
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
            rawMt: num(b.raw_qty_mt),
            plannedMt: num(b.planned_finished_mt),
            finishedMt: num(b.actual_finished_mt),
            yieldPct: num(b.yield_pct) || (num(b.raw_qty_mt) > 0 ? num(b.actual_finished_mt) / num(b.raw_qty_mt) * 100 : 0),
            millName: b.mill_name,
            supplierName: b.supplier_name,
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

  // Stock as-of snapshot. Always reflects the current inventory_lots
  // state — no historical roll-back. Grouped per the requested key.
  async printableStock(req, res) {
    try {
      const db = require('../../db');
      const { group_by = 'product', status = 'Available' } = req.query;

      let groupCol, nameCol;
      if (group_by === 'supplier')   { groupCol = 'l.supplier_id';  nameCol = 's.name'; }
      else if (group_by === 'warehouse') { groupCol = 'l.warehouse_id'; nameCol = 'w.name'; }
      else if (group_by === 'variety') { groupCol = 'l.variety';      nameCol = 'l.variety'; }
      else if (group_by === 'type')    { groupCol = 'l.type';         nameCol = 'l.type'; }
      else                              { groupCol = 'l.product_id';  nameCol = 'p.name'; }

      let q = db('inventory_lots as l')
        .leftJoin('suppliers as s',  'l.supplier_id',  's.id')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .leftJoin('products as p',   'l.product_id',   'p.id');
      if (status && status !== 'all') q = q.where('l.status', status);

      const rows = await q
        .select(
          db.raw(`COALESCE(${nameCol}, '—') as group_name`),
          db.raw('COUNT(l.id)::int as lot_count'),
          db.raw('COALESCE(SUM(CASE WHEN l.net_weight_kg > 0 THEN l.net_weight_kg ELSE CAST(l.qty AS DECIMAL) * 1000 END), 0)::numeric as total_kg'),
          db.raw('COALESCE(SUM(CAST(l.available_qty AS DECIMAL) * 1000), 0)::numeric as available_kg'),
          db.raw('COALESCE(SUM(CAST(l.reserved_qty AS DECIMAL) * 1000), 0)::numeric as reserved_kg'),
          db.raw('COALESCE(SUM(CASE WHEN l.landed_cost_total > 0 THEN l.landed_cost_total ELSE l.total_value END), 0)::numeric as total_value_pkr'),
        )
        .groupBy(groupCol, nameCol)
        .orderBy('total_kg', 'desc');

      const num = (v) => parseFloat(v) || 0;
      const grand = rows.reduce(
        (a, r) => ({
          lotCount: a.lotCount + r.lot_count,
          totalKg: a.totalKg + num(r.total_kg),
          availableKg: a.availableKg + num(r.available_kg),
          reservedKg: a.reservedKg + num(r.reserved_kg),
          valuePkr: a.valuePkr + num(r.total_value_pkr),
        }),
        { lotCount: 0, totalKg: 0, availableKg: 0, reservedKg: 0, valuePkr: 0 }
      );

      return res.json({
        success: true,
        data: {
          asOf: new Date().toISOString(),
          groupBy: group_by,
          rows: rows.map(r => ({
            name:        r.group_name,
            lotCount:    r.lot_count,
            totalKg:     num(r.total_kg),
            availableKg: num(r.available_kg),
            reservedKg:  num(r.reserved_kg),
            valuePkr:    num(r.total_value_pkr),
          })),
          grand,
        },
      });
    } catch (err) {
      console.error('Printable stock report error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = reportingController;
