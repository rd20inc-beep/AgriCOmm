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

      return res.json({
        success: true,
        data: {
          range: { from: fromDate.toISOString(), to: toDate.toISOString() },
          revenue,
          costs,
          netProfitPkr,
          marginPct,
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
        .select('p.payment_no', 'p.payment_date', 'p.base_amount_pkr', 'p.payment_method')
        .select(db.raw("COALESCE(c.name, 'Counterparty') as counterparty"))
        .orderBy('p.base_amount_pkr', 'desc')
        .limit(10);

      const topPayments = await db('payments as p')
        .leftJoin('payables as pay', 'p.linked_payable_id', 'pay.id')
        .leftJoin('suppliers as s',  'pay.supplier_id', 's.id')
        .where('p.type', 'payment')
        .whereBetween('p.payment_date', [fromDate, toDate])
        .select('p.payment_no', 'p.payment_date', 'p.base_amount_pkr', 'p.payment_method')
        .select(db.raw("COALESCE(s.name, pay.linked_ref, 'Vendor') as counterparty"))
        .orderBy('p.base_amount_pkr', 'desc')
        .limit(10);

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
            method: r.payment_method,
            amountPkr: parseFloat(r.base_amount_pkr) || 0,
          })),
          topPayments: topPayments.map((r) => ({
            paymentNo: r.payment_no,
            date: r.payment_date,
            counterparty: r.counterparty,
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
          'r.id', 'r.recv_no', 'r.due_date', 'r.outstanding',
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
          counterparty: r.counterparty || '—',
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
          'p.id', 'p.pay_no', 'p.due_date', 'p.outstanding', 'p.source_table',
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
          counterparty: r.counterparty || '—',
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
      // broken lots by grade and surfaces Sortex Rejects / Rice Bran /
      // Husk as their own categories, so a single Stock report can
      // answer "how much B1 do I have, how much B2, how much sortex".
      // Blended-milling output is kept separate from pure stock and from other
      // blends: blended broken carries a batch-scoped grade ('M-033-B1'), so it
      // already splits in the blended branches below. Pure rules are unchanged.
      const SUBTYPE_EXPR = `
        CASE
          WHEN l.processing_type = 'blended' AND l.type = 'finished'
            THEN 'Blended Finished — ' || COALESCE(l.blend_batch_no, 'n/a')
          WHEN l.processing_type = 'blended' AND l.item_name ILIKE '%broken%'
            THEN 'Blended Broken — ' || COALESCE(l.grade, l.blend_batch_no, 'n/a')
          WHEN l.processing_type = 'blended' AND l.item_name ILIKE '%bran%'   THEN 'Blended Bran — '   || COALESCE(l.blend_batch_no, 'n/a')
          WHEN l.processing_type = 'blended' AND l.item_name ILIKE '%husk%'   THEN 'Blended Husk — '   || COALESCE(l.blend_batch_no, 'n/a')
          WHEN l.processing_type = 'blended' AND l.item_name ILIKE '%sortex%' THEN 'Blended Sortex — ' || COALESCE(l.blend_batch_no, 'n/a')
          WHEN l.type = 'finished' THEN 'Finished Rice'
          WHEN l.type = 'raw'      THEN 'Incoming Rice'
          WHEN l.item_name ILIKE '%sortex%' THEN 'Sortex Rejects'
          WHEN l.item_name ILIKE '%bran%'   THEN 'Rice Bran'
          WHEN l.item_name ILIKE '%husk%'   THEN 'Rice Husk'
          WHEN l.item_name ILIKE 'broken%' AND l.grade IN ('B1','B2','B3','CSR','Short Grain')
            THEN 'Broken ' || l.grade
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
          db.raw('COUNT(l.id)::int as lot_count'),
          db.raw('COALESCE(SUM(CASE WHEN l.net_weight_kg > 0 THEN l.net_weight_kg ELSE CAST(l.qty AS DECIMAL) * 1000 END), 0)::numeric as total_kg'),
          db.raw('COALESCE(SUM(CAST(l.available_qty AS DECIMAL) * 1000), 0)::numeric as available_kg'),
          db.raw('COALESCE(SUM(CAST(l.reserved_qty AS DECIMAL) * 1000), 0)::numeric as reserved_kg'),
          db.raw('COALESCE(SUM(CASE WHEN l.landed_cost_total > 0 THEN l.landed_cost_total ELSE l.total_value END), 0)::numeric as total_value_pkr'),
        )
        // Subtype groups by the raw CASE expression itself — passing the long
        // SQL string as a second groupBy arg makes Knex quote it as a column
        // identifier and produces invalid SQL (HTTP 500). Every other dimension
        // must group by both the id column and its joined name.
        .groupBy(...(group_by === 'subtype' ? [db.raw(SUBTYPE_EXPR)] : [groupCol, nameCol]))
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
