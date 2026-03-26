/**
 * Seed: Reporting, BI & Management Control Tower (Phase 9)
 * KPI Benchmarks, Saved Reports, Scheduled Reports, Report Export Logs
 */

exports.seed = async function (knex) {
  // Clear in reverse-dependency order
  await knex('report_exports').del();
  await knex('scheduled_reports').del();
  await knex('saved_reports').del();
  await knex('kpi_benchmarks').del();

  // ============================================================
  // 1. KPI Benchmarks (12)
  // ============================================================
  const benchmarks = [
    {
      kpi_name: 'Export Margin',
      entity: 'export',
      target_value: 15.00,
      unit: '%',
      comparison: 'gte',
      period: 'monthly',
      notes: 'Target export gross margin >= 15%',
    },
    {
      kpi_name: 'Mill Yield',
      entity: 'mill',
      target_value: 67.00,
      unit: '%',
      comparison: 'gte',
      period: 'monthly',
      notes: 'Target milling yield >= 67% (finished rice from raw paddy)',
    },
    {
      kpi_name: 'Collection Rate',
      entity: 'export',
      target_value: 85.00,
      unit: '%',
      comparison: 'gte',
      period: 'monthly',
      notes: 'Target overall collection rate >= 85% of expected receivables',
    },
    {
      kpi_name: 'Advance Collection Days',
      entity: 'export',
      target_value: 14.00,
      unit: 'days',
      comparison: 'lte',
      period: 'monthly',
      notes: 'Average days to collect advance payment <= 14 days',
    },
    {
      kpi_name: 'Balance Collection Days',
      entity: 'export',
      target_value: 21.00,
      unit: 'days',
      comparison: 'lte',
      period: 'monthly',
      notes: 'Average days to collect balance payment <= 21 days',
    },
    {
      kpi_name: 'Broken Rice Max',
      entity: 'mill',
      target_value: 12.00,
      unit: '%',
      comparison: 'lte',
      period: 'monthly',
      notes: 'Average broken rice percentage <= 12% of raw input',
    },
    {
      kpi_name: 'On-Time Shipment Rate',
      entity: 'export',
      target_value: 90.00,
      unit: '%',
      comparison: 'gte',
      period: 'monthly',
      notes: 'Shipments departed on or before ETD >= 90%',
    },
    {
      kpi_name: 'Document Completion Rate',
      entity: 'export',
      target_value: 95.00,
      unit: '%',
      comparison: 'gte',
      period: 'monthly',
      notes: 'Required export documents completed and approved >= 95%',
    },
    {
      kpi_name: 'Receivable Overdue Ratio',
      entity: 'export',
      target_value: 10.00,
      unit: '%',
      comparison: 'lte',
      period: 'monthly',
      notes: 'Overdue receivables as % of total outstanding <= 10%',
    },
    {
      kpi_name: 'Cost Per MT Export',
      entity: 'export',
      target_value: 420.00,
      unit: 'USD',
      comparison: 'lte',
      period: 'monthly',
      notes: 'Average total cost per MT for export orders <= $420',
    },
    {
      kpi_name: 'Mill Cost Per MT',
      entity: 'mill',
      target_value: 62000.00,
      unit: 'PKR',
      comparison: 'lte',
      period: 'monthly',
      notes: 'Average milling cost per MT of raw paddy processed <= Rs 62,000',
    },
    {
      kpi_name: 'Stock Turnover Days',
      entity: null,
      target_value: 45.00,
      unit: 'days',
      comparison: 'lte',
      period: 'monthly',
      notes: 'Average days inventory remains in stock before consumption/sale <= 45 days',
    },
  ];

  await knex('kpi_benchmarks').insert(benchmarks);

  // ============================================================
  // 2. Saved Reports (3)
  // ============================================================
  const savedReports = [
    {
      name: 'Monthly Export P&L',
      report_type: 'profitability',
      entity: 'export',
      filters: JSON.stringify({
        entity: 'export',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
      }),
      columns: JSON.stringify([
        'orderNo', 'customerName', 'country', 'productName',
        'qtyMT', 'revenue', 'costs', 'grossProfit', 'margin',
      ]),
      sort_by: 'margin',
      created_by: 1,
      is_shared: true,
      last_run: '2026-03-15T10:00:00Z',
    },
    {
      name: 'Supplier Quality Dashboard',
      report_type: 'supplier_quality',
      entity: 'mill',
      filters: JSON.stringify({
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
      }),
      columns: JSON.stringify([
        'supplierName', 'totalBatches', 'totalQtyMT', 'avgYield',
        'avgMoistureVariance', 'avgBrokenVariance', 'rejectionRate', 'qualityScore',
      ]),
      sort_by: 'qualityScore',
      created_by: 1,
      is_shared: true,
      last_run: '2026-03-14T08:00:00Z',
    },
    {
      name: 'Receivable Aging Weekly',
      report_type: 'receivable_aging',
      entity: 'export',
      filters: JSON.stringify({
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      }),
      columns: JSON.stringify([
        'customerName', 'country', 'outstanding', 'avgDays', 'bucket',
      ]),
      sort_by: 'outstanding',
      created_by: 3,
      is_shared: false,
      last_run: '2026-03-17T09:00:00Z',
    },
  ];

  const insertedReports = await knex('saved_reports').insert(savedReports).returning('*');

  // ============================================================
  // 3. Scheduled Reports (2)
  // ============================================================
  const now = new Date();

  // Next Monday 8am
  const nextMonday = new Date(now);
  nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
  nextMonday.setHours(8, 0, 0, 0);

  // First of next month 7am
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 7, 0, 0, 0);

  const plReport = insertedReports.find((r) => r.name === 'Monthly Export P&L');
  const agingReport = insertedReports.find((r) => r.name === 'Receivable Aging Weekly');

  const scheduledReports = [
    {
      saved_report_id: plReport ? plReport.id : insertedReports[0].id,
      frequency: 'weekly',
      delivery_method: 'email',
      recipients: JSON.stringify(['admin@riceflow.com', 'finance@agririce.com']),
      next_run: nextMonday.toISOString(),
      last_run: '2026-03-10T08:00:00Z',
      is_active: true,
      created_by: 1,
    },
    {
      saved_report_id: agingReport ? agingReport.id : insertedReports[2].id,
      frequency: 'monthly',
      delivery_method: 'dashboard',
      recipients: JSON.stringify(['finance@agririce.com']),
      next_run: nextMonth.toISOString(),
      last_run: null,
      is_active: true,
      created_by: 3,
    },
  ];

  await knex('scheduled_reports').insert(scheduledReports);

  // ============================================================
  // 4. Report Export Logs (2)
  // ============================================================
  const exportLogs = [
    {
      report_type: 'profitability',
      format: 'csv',
      file_path: '/exports/reports/profitability_20260315_100500.csv',
      file_size: 24576,
      generated_by: 1,
      filters_used: JSON.stringify({
        entity: 'export',
        dateFrom: '2026-01-01',
        dateTo: '2026-03-15',
      }),
      created_at: '2026-03-15T10:05:00Z',
    },
    {
      report_type: 'supplier_quality',
      format: 'json',
      file_path: '/exports/reports/supplier_quality_20260314_080200.json',
      file_size: 15360,
      generated_by: 1,
      filters_used: JSON.stringify({
        dateFrom: '2026-01-01',
        dateTo: '2026-03-14',
      }),
      created_at: '2026-03-14T08:02:00Z',
    },
  ];

  await knex('report_exports').insert(exportLogs);
};
