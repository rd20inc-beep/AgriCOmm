const db = require('../../config/database');
const { BALANCE_COLLECTION_STATUSES, BALANCE_OUTSTANDING_SQL } = require('../exportOrders/balanceCollection');
const auditService = require('../admin/audit.service');
const { companyStock } = require('../inventory/stockSql');
const { marginFinding, orderMarginRows } = require('./orderMargins');
const { exportProfit, orderRevenuePkr, costRowPkr } = require('../finance/profitDefinitions');
const { collectionRate: computeCollectionRate } = require('../finance/collectionRate');
const fxRateService = require('../finance/fxRate.service');
const { dayOf } = require('../exportOrders/balanceDueDate');
const {
  RECEIVABLE_CLOSED, PAYABLE_CLOSED, ORDER_COST_PKR_SQL, RECV_PKR_EQUIV_SQL,
  byCurrency, cashSummary, collectionRateFields,
} = require('../finance/currencyFigures');

/**
 * Intelligence Service — Decision Intelligence Engine (Phase 12)
 * Exception scanning, risk monitoring, root cause analysis, dashboard data.
 * All methods use real database queries against the RiceFlow ERP schema.
 */
const intelligenceService = {
  // ═══════════════════════════════════════════════════════════════════
  // EXCEPTION SCANNER
  // ═══════════════════════════════════════════════════════════════════

  async scanAllExceptions() {
    const results = [];
    results.push(...await this.scanQCFailures());
    results.push(...await this.scanOverdueAdvances());
    results.push(...await this.scanOverdueBalances());
    results.push(...await this.scanMissingDocuments());
    results.push(...await this.scanLowMarginOrders());
    results.push(...await this.scanDelayedShipments());
    results.push(...await this.scanStockShortages());
    results.push(...await this.scanHighCostVariance());
    results.push(...await this.scanYieldBelowBenchmark());

    // Deduplicate: don't insert if same type+linked_ref already Open/Acknowledged/In Progress
    const inserted = [];
    for (const exc of results) {
      const existing = await db('exception_inbox')
        .where({
          exception_type: exc.exception_type,
          linked_ref: exc.linked_ref,
        })
        .whereIn('status', ['Open', 'Acknowledged', 'In Progress'])
        .first();

      if (!existing) {
        const [record] = await db('exception_inbox').insert(exc).returning('*');
        inserted.push(record);
      }
    }

    const summary = {
      total: inserted.length,
      critical: inserted.filter((e) => e.severity === 'critical').length,
      warning: inserted.filter((e) => e.severity === 'warning').length,
      info: inserted.filter((e) => e.severity === 'info').length,
      byType: {},
    };
    for (const e of inserted) {
      summary.byType[e.exception_type] = (summary.byType[e.exception_type] || 0) + 1;
    }

    return summary;
  },

  async scanQCFailures() {
    // Find milling batches where quality samples show variance > threshold
    // Compare sample vs arrival analysis; flag if moisture or broken variance > 1%
    const rows = await db('milling_quality_samples as s')
      .join('milling_quality_samples as a', function () {
        this.on('s.batch_id', '=', 'a.batch_id')
          .andOn(db.raw("s.analysis_type = 'sample'"))
          .andOn(db.raw("a.analysis_type = 'arrival'"));
      })
      .join('milling_batches as mb', 'mb.id', 's.batch_id')
      .whereRaw('ABS(a.moisture - s.moisture) > 1 OR ABS(a.broken - s.broken) > 1')
      .whereNotIn('mb.status', ['Cancelled'])
      .select(
        'mb.id as batch_id',
        'mb.batch_no',
        's.moisture as sample_moisture',
        'a.moisture as arrival_moisture',
        's.broken as sample_broken',
        'a.broken as arrival_broken',
        'mb.raw_qty_kg'
      );

    return rows.map((r) => {
      const moistureVar = Math.abs(parseFloat(r.arrival_moisture) - parseFloat(r.sample_moisture));
      const brokenVar = Math.abs(parseFloat(r.arrival_broken) - parseFloat(r.sample_broken));
      const maxVar = Math.max(moistureVar, brokenVar);
      return {
        exception_type: 'qc_failure',
        severity: maxVar > 2 ? 'critical' : 'warning',
        entity: 'mill',
        linked_type: 'milling_batch',
        linked_id: r.batch_id,
        linked_ref: r.batch_no,
        title: `QC variance detected on batch ${r.batch_no}`,
        description: `Moisture variance: ${moistureVar.toFixed(2)}%, Broken variance: ${brokenVar.toFixed(2)}% between sample and arrival analysis.`,
        metric_value: maxVar,
        threshold_value: 1.00,
        amount_at_risk: (parseFloat(r.raw_qty_kg) / 1000) * 500, // estimated loss at $500/MT
        currency: 'USD',
        auto_generated: true,
      };
    });
  },

  async scanOverdueAdvances() {
    // Find export_orders where status='Awaiting Advance' and created > 14 days ago
    const reminderDaysSetting = await db('system_settings').where({ key: 'payment_reminder_days' }).first();
    const reminderDays = reminderDaysSetting ? parseInt(reminderDaysSetting.value, 10) * 2 : 14;

    const rows = await db('export_orders')
      .where('status', 'Awaiting Advance')
      .whereRaw(`created_at < NOW() - INTERVAL '${reminderDays} days'`)
      .select('id', 'order_no', 'advance_expected', 'advance_received', 'currency', 'created_at', 'customer_id');

    return rows.map((r) => {
      const daysOverdue = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
      const amountAtRisk = parseFloat(r.advance_expected) - parseFloat(r.advance_received || 0);
      return {
        exception_type: 'overdue_advance',
        severity: daysOverdue > 30 ? 'critical' : 'warning',
        entity: 'export',
        linked_type: 'export_order',
        linked_id: r.id,
        linked_ref: r.order_no,
        title: `Advance payment overdue ${daysOverdue} days on ${r.order_no}`,
        description: `Order ${r.order_no} has been awaiting advance for ${daysOverdue} days. Expected: ${r.currency} ${parseFloat(r.advance_expected).toFixed(2)}, Received: ${r.currency} ${parseFloat(r.advance_received || 0).toFixed(2)}.`,
        metric_value: daysOverdue,
        threshold_value: reminderDays,
        amount_at_risk: amountAtRisk,
        currency: r.currency,
        auto_generated: true,
      };
    });
  },

  async scanOverdueBalances() {
    // Export orders with a balance still owed where it is collected (after
    // sailing under ship-on-advance, or the legacy 'Awaiting Balance' stage).
    const rows = await db('export_orders')
      .whereIn('status', BALANCE_COLLECTION_STATUSES)
      .whereRaw(BALANCE_OUTSTANDING_SQL)
      .select('id', 'order_no', 'balance_expected', 'balance_received', 'currency', 'updated_at', 'created_at');

    return rows.map((r) => {
      const refDate = r.updated_at || r.created_at;
      const daysSince = Math.floor((Date.now() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24));
      const outstanding = parseFloat(r.balance_expected) - parseFloat(r.balance_received || 0);
      return {
        exception_type: 'overdue_balance',
        severity: outstanding > 20000 ? 'critical' : 'warning',
        entity: 'export',
        linked_type: 'export_order',
        linked_id: r.id,
        linked_ref: r.order_no,
        title: `Balance payment outstanding on ${r.order_no}: ${r.currency} ${outstanding.toFixed(2)}`,
        description: `Order ${r.order_no} has outstanding balance of ${r.currency} ${outstanding.toFixed(2)} pending for ${daysSince} days.`,
        metric_value: daysSince,
        threshold_value: 30,
        amount_at_risk: outstanding,
        currency: r.currency,
        auto_generated: true,
      };
    });
  },

  async scanMissingDocuments() {
    // Find export_orders where shipment_eta is within 14 days
    // and document_checklists have unfulfilled required items
    const rows = await db('export_orders as eo')
      .join('document_checklists as dc', function () {
        this.on('dc.linked_id', '=', 'eo.id')
          .andOn(db.raw("dc.linked_type = 'export_order'"));
      })
      .where('dc.is_required', true)
      .where('dc.is_fulfilled', false)
      .whereNotIn('eo.status', ['Draft', 'Closed', 'Cancelled', 'Arrived'])
      .whereRaw("eo.shipment_eta <= CURRENT_DATE + INTERVAL '14 days'")
      .whereRaw('eo.shipment_eta >= CURRENT_DATE')
      .select(
        'eo.id',
        'eo.order_no',
        'eo.shipment_eta',
        'eo.contract_value',
        'eo.currency',
        db.raw('COUNT(dc.id) as missing_count'),
        db.raw("STRING_AGG(dc.doc_type, ', ') as missing_docs")
      )
      .groupBy('eo.id', 'eo.order_no', 'eo.shipment_eta', 'eo.contract_value', 'eo.currency');

    return rows.map((r) => {
      const daysToETA = Math.floor((new Date(r.shipment_eta).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return {
        exception_type: 'missing_documents',
        severity: daysToETA <= 3 ? 'critical' : 'warning',
        entity: 'export',
        linked_type: 'export_order',
        linked_id: r.id,
        linked_ref: r.order_no,
        title: `${r.missing_count} required document(s) missing on ${r.order_no} — ETA in ${daysToETA} days`,
        description: `Missing documents: ${r.missing_docs}. Shipment ETA: ${r.shipment_eta}.`,
        metric_value: parseInt(r.missing_count, 10),
        threshold_value: 0,
        amount_at_risk: parseFloat(r.contract_value),
        currency: r.currency,
        auto_generated: true,
      };
    });
  },

  async scanLowMarginOrders() {
    // Booked margin per open export order, in PKR (orderMargins.js): revenue
    // at the order's locked / booked rate less its costs in PKR. Orders with
    // no booked rate or no rice cost are skipped — never alarmed on.
    const lowMarginThreshold = 10;

    const rows = await orderMarginRows(db, { excludeStatuses: ['Closed'] });

    const exceptions = [];
    for (const r of rows) {
      const f = marginFinding(r, { lowPct: lowMarginThreshold });
      if (!f) continue;
      const base = {
        entity: 'export',
        linked_type: 'export_order',
        linked_id: r.id,
        linked_ref: r.orderNo,
        description: f.description,
        metric_value: f.marginPct,
        amount_at_risk: f.atRiskPkr,
        currency: 'PKR',
        auto_generated: true,
      };
      if (f.negative) {
        exceptions.push({
          ...base,
          exception_type: 'negative_margin',
          severity: 'critical',
          title: `Negative margin on ${r.orderNo}: ${f.marginPct.toFixed(2)}%`,
          threshold_value: 0,
        });
      } else {
        exceptions.push({
          ...base,
          exception_type: 'low_margin',
          severity: f.marginPct < 5 ? 'warning' : 'info',
          title: `Low margin on ${r.orderNo}: ${f.marginPct.toFixed(2)}%`,
          threshold_value: lowMarginThreshold,
        });
      }
    }
    return exceptions;
  },

  async scanDelayedShipments() {
    // Find export_orders where status is in active shipping states
    // and etd has passed but no atd set, or eta < today (arrival overdue)
    const exceptions = [];

    // Case 1: ETD passed but no ATD (departure delayed)
    const departureDelayed = await db('export_orders')
      .whereNotNull('etd')
      .whereNull('atd')
      .whereRaw('etd < CURRENT_DATE')
      .whereNotIn('status', ['Draft', 'Closed', 'Cancelled', 'Arrived'])
      .select('id', 'order_no', 'etd', 'contract_value', 'currency', 'destination_port');

    for (const r of departureDelayed) {
      const daysDelayed = Math.floor((Date.now() - new Date(r.etd).getTime()) / (1000 * 60 * 60 * 24));
      exceptions.push({
        exception_type: 'delayed_shipment',
        severity: daysDelayed > 7 ? 'critical' : 'warning',
        entity: 'export',
        linked_type: 'export_order',
        linked_id: r.id,
        linked_ref: r.order_no,
        title: `Shipment departure delayed ${daysDelayed} days on ${r.order_no}`,
        description: `Expected departure: ${r.etd}, no actual departure recorded. Destination: ${r.destination_port}.`,
        metric_value: daysDelayed,
        threshold_value: 0,
        amount_at_risk: parseFloat(r.contract_value),
        currency: r.currency,
        auto_generated: true,
      });
    }

    // Case 2: ETA passed but no ATA (arrival overdue)
    const arrivalOverdue = await db('export_orders')
      .where('status', 'Shipped')
      .whereNotNull('eta')
      .whereNull('ata')
      .whereRaw('eta < CURRENT_DATE')
      .select('id', 'order_no', 'eta', 'contract_value', 'currency', 'destination_port');

    for (const r of arrivalOverdue) {
      const daysLate = Math.floor((Date.now() - new Date(r.eta).getTime()) / (1000 * 60 * 60 * 24));
      exceptions.push({
        exception_type: 'delayed_shipment',
        severity: daysLate > 14 ? 'critical' : 'warning',
        entity: 'export',
        linked_type: 'export_order',
        linked_id: r.id,
        linked_ref: r.order_no,
        title: `Shipment arrival overdue ${daysLate} days on ${r.order_no}`,
        description: `Expected arrival: ${r.eta}, vessel has not arrived. Destination: ${r.destination_port}.`,
        metric_value: daysLate,
        threshold_value: 0,
        amount_at_risk: parseFloat(r.contract_value),
        currency: r.currency,
        auto_generated: true,
      });
    }

    return exceptions;
  },

  async scanStockShortages() {
    // Find active export orders that need inventory but no reservation exists
    // or reserved qty < order qty
    const rows = await db('export_orders as eo')
      .leftJoin('inventory_reservations as ir', function () {
        this.on('ir.order_id', '=', 'eo.id').andOn(db.raw("ir.status = 'Active'"));
      })
      .whereIn('eo.status', ['Advance Received', 'In Milling', 'Docs In Preparation', 'Awaiting Balance'])
      .select(
        'eo.id',
        'eo.order_no',
        'eo.qty_mt',
        'eo.contract_value',
        'eo.currency',
        'eo.status',
        db.raw('COALESCE(SUM(ir.reserved_qty), 0) as reserved_qty')
      )
      .groupBy('eo.id', 'eo.order_no', 'eo.qty_mt', 'eo.contract_value', 'eo.currency', 'eo.status')
      // reserved_qty is KG (Phase 5c); export order qty_mt is MT (doc) → ÷1000 to compare.
      .havingRaw('COALESCE(SUM(ir.reserved_qty), 0) / 1000 < eo.qty_mt');

    return rows.map((r) => {
      const reservedMt = parseFloat(r.reserved_qty) / 1000;
      const shortfall = parseFloat(r.qty_mt) - reservedMt;
      return {
        exception_type: 'stock_shortage',
        severity: shortfall >= parseFloat(r.qty_mt) ? 'warning' : 'info',
        entity: 'export',
        linked_type: 'export_order',
        linked_id: r.id,
        linked_ref: r.order_no,
        title: `Stock shortage for ${r.order_no}: ${shortfall.toFixed(2)} MT unreserved`,
        description: `Order requires ${parseFloat(r.qty_mt).toFixed(2)} MT, only ${reservedMt.toFixed(2)} MT reserved. Status: ${r.status}.`,
        metric_value: shortfall,
        threshold_value: 0,
        amount_at_risk: (shortfall / parseFloat(r.qty_mt)) * parseFloat(r.contract_value),
        currency: r.currency,
        auto_generated: true,
      };
    });
  },

  async scanHighCostVariance() {
    // Compare actual costs vs estimated costs per order using margin_analysis
    const rows = await db('margin_analysis')
      .whereNotNull('estimated_costs')
      .whereNotNull('actual_costs')
      .join('export_orders as eo', 'eo.id', 'margin_analysis.order_id')
      .whereNotIn('eo.status', ['Draft', 'Cancelled'])
      .select(
        'margin_analysis.id as analysis_id',
        'eo.id as order_id',
        'eo.order_no',
        'eo.currency',
        'margin_analysis.estimated_costs',
        'margin_analysis.actual_costs',
        'eo.contract_value'
      );

    const exceptions = [];
    for (const r of rows) {
      const estimated = typeof r.estimated_costs === 'string' ? JSON.parse(r.estimated_costs) : r.estimated_costs;
      const actual = typeof r.actual_costs === 'string' ? JSON.parse(r.actual_costs) : r.actual_costs;

      for (const category of Object.keys(estimated)) {
        const est = parseFloat(estimated[category]) || 0;
        const act = parseFloat(actual[category]) || 0;
        if (est > 0 && act > 0) {
          const variancePct = ((act - est) / est) * 100;
          if (variancePct > 20) {
            exceptions.push({
              exception_type: 'high_cost_variance',
              severity: variancePct > 50 ? 'critical' : 'warning',
              entity: 'export',
              linked_type: 'export_order',
              linked_id: r.order_id,
              linked_ref: r.order_no,
              title: `High cost variance in "${category}" on ${r.order_no}: +${variancePct.toFixed(1)}%`,
              // margin_analysis holds both sides in PKR at the booked rate.
              description: `Estimated: Rs ${est.toFixed(2)}, Actual: Rs ${act.toFixed(2)}. Variance: Rs ${(act - est).toFixed(2)} (${variancePct.toFixed(1)}%).`,
              metric_value: parseFloat(variancePct.toFixed(2)),
              threshold_value: 20,
              amount_at_risk: act - est,
              currency: 'PKR',
              auto_generated: true,
            });
          }
        }
      }
    }
    return exceptions;
  },

  async scanYieldBelowBenchmark() {
    // Compare actual yield_pct in milling_batches vs recovery_benchmarks
    // Flag if yield is >3% below benchmark
    const rows = await db('milling_batches as mb')
      .join('recovery_benchmarks as rb', 'rb.id', 'mb.benchmark_id')
      .whereNotIn('mb.status', ['Cancelled', 'Queued'])
      .where('mb.yield_pct', '>', 0)
      .whereRaw('mb.yield_pct < rb.expected_yield_pct - 3')
      .select(
        'mb.id as batch_id',
        'mb.batch_no',
        'mb.yield_pct',
        'rb.expected_yield_pct',
        'rb.variety',
        'mb.raw_qty_kg',
        'mb.actual_finished_kg'
      );

    return rows.map((r) => {
      const gap = parseFloat(r.expected_yield_pct) - parseFloat(r.yield_pct);
      const lostMT = (gap / 100) * (parseFloat(r.raw_qty_kg) / 1000);
      return {
        exception_type: 'yield_below_benchmark',
        severity: gap > 5 ? 'critical' : 'warning',
        entity: 'mill',
        linked_type: 'milling_batch',
        linked_id: r.batch_id,
        linked_ref: r.batch_no,
        title: `Yield ${gap.toFixed(1)}% below benchmark on batch ${r.batch_no}`,
        description: `Actual yield: ${parseFloat(r.yield_pct).toFixed(1)}%, Benchmark: ${parseFloat(r.expected_yield_pct).toFixed(1)}% (${r.variety}). Lost output: ~${lostMT.toFixed(2)} MT.`,
        metric_value: parseFloat(r.yield_pct),
        threshold_value: parseFloat(r.expected_yield_pct) - 3,
        amount_at_risk: lostMT * 500,
        currency: 'USD',
        auto_generated: true,
      };
    });
  },

  // ═══════════════════════════════════════════════════════════════════
  // EXCEPTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  async getExceptions({ status, severity, entity, exceptionType, assignedTo, page = 1, limit = 25 }) {
    const query = db('exception_inbox as ei')
      .leftJoin('users as assigned', 'assigned.id', 'ei.assigned_to')
      .leftJoin('users as resolver', 'resolver.id', 'ei.resolved_by')
      .select(
        'ei.*',
        'assigned.full_name as assigned_to_name',
        'resolver.full_name as resolved_by_name'
      );

    if (status) query.where('ei.status', status);
    if (severity) query.where('ei.severity', severity);
    if (entity) query.where('ei.entity', entity);
    if (exceptionType) query.where('ei.exception_type', exceptionType);
    if (assignedTo) query.where('ei.assigned_to', assignedTo);

    // Exclude snoozed exceptions that are still within snooze period
    query.where(function () {
      this.whereNull('ei.snoozed_until')
        .orWhere('ei.snoozed_until', '<=', db.fn.now())
        .orWhereNot('ei.status', 'Snoozed');
    });

    const severityOrder = db.raw("CASE ei.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 ELSE 4 END");
    query.orderByRaw(`${severityOrder}`).orderBy('ei.created_at', 'desc');

    const offset = (page - 1) * limit;
    const countQuery = query.clone().clearSelect().clearOrder().count('ei.id as total').first();
    const [data, countResult] = await Promise.all([
      query.offset(offset).limit(limit),
      countQuery,
    ]);

    return {
      data,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: parseInt(countResult.total, 10),
        totalPages: Math.ceil(parseInt(countResult.total, 10) / limit),
      },
    };
  },

  async getExceptionStats() {
    const [byStatus, bySeverity, byType, amountAtRisk] = await Promise.all([
      db('exception_inbox')
        .select('status')
        .count('id as count')
        .groupBy('status'),
      db('exception_inbox')
        .whereIn('status', ['Open', 'Acknowledged', 'In Progress', 'Escalated'])
        .select('severity')
        .count('id as count')
        .groupBy('severity'),
      db('exception_inbox')
        .whereIn('status', ['Open', 'Acknowledged', 'In Progress', 'Escalated'])
        .select('exception_type')
        .count('id as count')
        .groupBy('exception_type'),
      // Per currency (RPT-08): each exception carries its own currency; USD and
      // PKR amounts at risk are never added together.
      db('exception_inbox')
        .whereIn('status', ['Open', 'Acknowledged', 'In Progress', 'Escalated'])
        .select(db.raw("UPPER(COALESCE(currency, 'PKR')) as currency"), db.raw('COALESCE(SUM(amount_at_risk), 0) as total_at_risk'))
        .groupByRaw("UPPER(COALESCE(currency, 'PKR'))"),
    ]);
    const atRiskByCurrency = {};
    for (const r of amountAtRisk || []) {
      const v = parseFloat(r.total_at_risk) || 0;
      if (v) atRiskByCurrency[r.currency] = Math.round(v * 100) / 100;
    }
    const atRiskCurs = Object.keys(atRiskByCurrency);

    return {
      byStatus: byStatus.reduce((acc, r) => { acc[r.status] = parseInt(r.count, 10); return acc; }, {}),
      bySeverity: bySeverity.reduce((acc, r) => { acc[r.severity] = parseInt(r.count, 10); return acc; }, {}),
      byType: byType.reduce((acc, r) => { acc[r.exception_type] = parseInt(r.count, 10); return acc; }, {}),
      amountAtRiskByCurrency: atRiskByCurrency,
      // A single figure only when one currency is at risk (else null — read the map).
      totalAmountAtRisk: atRiskCurs.length === 1 ? atRiskByCurrency[atRiskCurs[0]] : (atRiskCurs.length ? null : 0),
    };
  },

  async acknowledgeException(id, userId) {
    const [updated] = await db('exception_inbox')
      .where({ id })
      .whereIn('status', ['Open'])
      .update({ status: 'Acknowledged', assigned_to: userId, updated_at: new Date() })
      .returning('*');
    if (!updated) throw new Error('Exception not found or cannot be acknowledged.');
    return updated;
  },

  async assignException(id, assignedTo, userId) {
    const [updated] = await db('exception_inbox')
      .where({ id })
      .whereIn('status', ['Open', 'Acknowledged', 'Escalated'])
      .update({ assigned_to: assignedTo, status: 'In Progress', updated_at: new Date() })
      .returning('*');
    if (!updated) throw new Error('Exception not found or cannot be assigned.');
    return updated;
  },

  async resolveException(id, { resolutionNotes, userId }) {
    const [updated] = await db('exception_inbox')
      .where({ id })
      .whereIn('status', ['Open', 'Acknowledged', 'In Progress', 'Escalated'])
      .update({
        status: 'Resolved',
        resolution_notes: resolutionNotes,
        resolved_by: userId,
        resolved_at: new Date(),
        updated_at: new Date(),
      })
      .returning('*');
    if (!updated) throw new Error('Exception not found or already resolved.');
    return updated;
  },

  async snoozeException(id, { snoozedUntil, userId }) {
    const [updated] = await db('exception_inbox')
      .where({ id })
      .whereIn('status', ['Open', 'Acknowledged', 'In Progress'])
      .update({
        status: 'Snoozed',
        snoozed_until: snoozedUntil,
        updated_at: new Date(),
      })
      .returning('*');
    if (!updated) throw new Error('Exception not found or cannot be snoozed.');
    return updated;
  },

  async escalateException(id, userId) {
    const [updated] = await db('exception_inbox')
      .where({ id })
      .whereIn('status', ['Open', 'Acknowledged', 'In Progress'])
      .update({
        status: 'Escalated',
        severity: 'critical',
        updated_at: new Date(),
      })
      .returning('*');
    if (!updated) throw new Error('Exception not found or cannot be escalated.');
    return updated;
  },

  // ═══════════════════════════════════════════════════════════════════
  // RISK MONITORING
  // ═══════════════════════════════════════════════════════════════════

  async calculateOrderRisk(orderId) {
    const order = await db('export_orders').where({ id: orderId }).first();
    if (!order) throw new Error('Order not found.');

    const factors = [];
    let totalScore = 0;

    // Factor 1: Payment delay
    if (order.status === 'Awaiting Advance' || BALANCE_COLLECTION_STATUSES.includes(order.status)) {
      const daysCreated = Math.floor((Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60 * 24));
      if (order.status === 'Awaiting Advance' && daysCreated > 14) {
        const score = 30;
        factors.push({ factor: 'Advance Payment Overdue', score, weight: 0.3, detail: `${daysCreated} days since order created, advance not received` });
        totalScore += score;
      }
      if (BALANCE_COLLECTION_STATUSES.includes(order.status)) {
        const outstanding = parseFloat(order.balance_expected) - parseFloat(order.balance_received || 0);
        if (outstanding > 0) {
          const score = 25;
          factors.push({ factor: 'Balance Payment Outstanding', score, weight: 0.25, detail: `${order.currency} ${outstanding.toFixed(2)} balance outstanding` });
          totalScore += score;
        }
      }
    }

    // Factor 2: Margin risk
    const costs = await db('export_order_costs').where({ order_id: orderId }).sum('amount as total').first();
    const totalCosts = parseFloat(costs.total || 0);
    const contractValue = parseFloat(order.contract_value);
    if (contractValue > 0 && totalCosts > 0) {
      const margin = ((contractValue - totalCosts) / contractValue) * 100;
      if (margin < 0) {
        factors.push({ factor: 'Negative Margin', score: 40, weight: 0.4, detail: `Margin is ${margin.toFixed(2)}%` });
        totalScore += 40;
      } else if (margin < 5) {
        factors.push({ factor: 'Very Low Margin', score: 30, weight: 0.3, detail: `Margin is only ${margin.toFixed(2)}%` });
        totalScore += 30;
      } else if (margin < 10) {
        factors.push({ factor: 'Low Margin', score: 20, weight: 0.2, detail: `Margin is ${margin.toFixed(2)}%` });
        totalScore += 20;
      }
    }

    // Factor 3: Document readiness
    const missingDocs = await db('document_checklists')
      .where({ linked_type: 'export_order', linked_id: orderId, is_required: true, is_fulfilled: false })
      .count('id as count')
      .first();
    const missingCount = parseInt(missingDocs.count, 10);
    if (missingCount > 0) {
      const score = Math.min(missingCount * 15, 45);
      factors.push({ factor: 'Missing Documents', score, weight: 0.15, detail: `${missingCount} required document(s) not fulfilled` });
      totalScore += score;
    }

    // Factor 4: Shipment delay
    if (order.etd && !order.atd && new Date(order.etd) < new Date()) {
      const daysLate = Math.floor((Date.now() - new Date(order.etd).getTime()) / (1000 * 60 * 60 * 24));
      const score = 20;
      factors.push({ factor: 'Shipment Delayed', score, weight: 0.2, detail: `Departure ${daysLate} days overdue` });
      totalScore += score;
    }

    // Factor 5: Customer history
    if (order.customer_id) {
      const custScore = await db('customer_scores')
        .where({ customer_id: order.customer_id })
        .orderBy('calculated_at', 'desc')
        .first();

      if (custScore && parseInt(custScore.overdue_count, 10) > 2) {
        const score = 15;
        factors.push({ factor: 'Customer History Risk', score, weight: 0.15, detail: `Customer has ${custScore.overdue_count} overdue instances` });
        totalScore += score;
      }
    }

    // Cap score at 100
    totalScore = Math.min(totalScore, 100);

    // Determine risk level
    let riskLevel;
    if (totalScore > 70) riskLevel = 'Critical';
    else if (totalScore > 50) riskLevel = 'High';
    else if (totalScore > 30) riskLevel = 'Medium';
    else riskLevel = 'Low';

    // Financial exposure = outstanding receivables
    const outstandingAdv = parseFloat(order.advance_expected) - parseFloat(order.advance_received || 0);
    const outstandingBal = parseFloat(order.balance_expected) - parseFloat(order.balance_received || 0);
    const financialExposure = Math.max(outstandingAdv, 0) + Math.max(outstandingBal, 0);

    // Upsert risk_scores
    const existing = await db('risk_scores')
      .where({ entity_type: 'export_order', entity_id: orderId })
      .first();

    const riskData = {
      entity_type: 'export_order',
      entity_id: orderId,
      entity_ref: order.order_no,
      risk_score: totalScore,
      risk_level: riskLevel,
      risk_factors: JSON.stringify(factors),
      financial_exposure: financialExposure,
      currency: order.currency,
      calculated_at: new Date(),
    };

    let record;
    if (existing) {
      [record] = await db('risk_scores').where({ id: existing.id }).update(riskData).returning('*');
    } else {
      [record] = await db('risk_scores').insert(riskData).returning('*');
    }

    return record;
  },

  async calculateCustomerRisk(customerId) {
    const customer = await db('customers').where({ id: customerId }).first();
    if (!customer) throw new Error('Customer not found.');

    const factors = [];
    let totalScore = 0;

    // Get customer's orders
    const orders = await db('export_orders').where({ customer_id: customerId }).whereNotIn('status', ['Draft', 'Cancelled']);
    const orderCount = orders.length;
    if (orderCount === 0) {
      // No orders, low risk by default
      const riskData = {
        entity_type: 'customer',
        entity_id: customerId,
        entity_ref: customer.name,
        risk_score: 0,
        risk_level: 'Low',
        risk_factors: JSON.stringify([{ factor: 'No Order History', score: 0, weight: 0, detail: 'No orders found for this customer' }]),
        financial_exposure: 0,
        currency: 'USD',
        calculated_at: new Date(),
      };
      const existing = await db('risk_scores').where({ entity_type: 'customer', entity_id: customerId }).first();
      let record;
      if (existing) {
        [record] = await db('risk_scores').where({ id: existing.id }).update(riskData).returning('*');
      } else {
        [record] = await db('risk_scores').insert(riskData).returning('*');
      }
      return record;
    }

    // Factor 1: Payment history — avg delay days
    const custScoreRecord = await db('customer_scores')
      .where({ customer_id: customerId })
      .orderBy('calculated_at', 'desc')
      .first();

    if (custScoreRecord) {
      const avgBalanceDays = parseFloat(custScoreRecord.avg_balance_days || 0);
      if (avgBalanceDays > 45) {
        const score = 30;
        factors.push({ factor: 'Slow Payment History', score, weight: 0.3, detail: `Average balance payment takes ${avgBalanceDays} days` });
        totalScore += score;
      } else if (avgBalanceDays > 30) {
        const score = 15;
        factors.push({ factor: 'Moderate Payment Delays', score, weight: 0.15, detail: `Average balance payment takes ${avgBalanceDays} days` });
        totalScore += score;
      }

      // Factor 5: Overdue count
      const overdueCount = parseInt(custScoreRecord.overdue_count || 0, 10);
      if (overdueCount > 2) {
        const score = 20;
        factors.push({ factor: 'Multiple Overdue Instances', score, weight: 0.2, detail: `${overdueCount} overdue payments recorded` });
        totalScore += score;
      } else if (overdueCount > 0) {
        const score = 10;
        factors.push({ factor: 'Previous Overdue', score, weight: 0.1, detail: `${overdueCount} overdue payment(s)` });
        totalScore += score;
      }
    }

    // Factor 2: Outstanding receivables — PKR at each receivable's booked
    // rate, so a customer's USD and PKR receivables aren't added as one
    // number. Rows with no booked figure are left out of both sides.
    const receivables = await db('receivables')
      .where({ customer_id: customerId })
      .whereIn('status', ['Pending', 'Partial', 'Overdue'])
      .whereRaw(`(${RECV_PKR_EQUIV_SQL}) IS NOT NULL`)
      .select(
        db.raw(`COALESCE(SUM(${RECV_PKR_EQUIV_SQL}), 0) as total_outstanding`),
        db.raw(`COALESCE(SUM(CASE
          WHEN COALESCE(currency, 'PKR') = 'PKR' THEN expected_amount
          WHEN base_amount_pkr > 0 THEN base_amount_pkr
          ELSE expected_amount * fx_rate END), 0) as total_expected`)
      )
      .first();

    const totalOutstanding = parseFloat(receivables.total_outstanding || 0);
    const totalExpected = parseFloat(receivables.total_expected || 0);
    if (totalExpected > 0) {
      const outstandingRatio = (totalOutstanding / totalExpected) * 100;
      if (outstandingRatio > 50) {
        const score = 25;
        factors.push({ factor: 'High Outstanding Receivables', score, weight: 0.25, detail: `${outstandingRatio.toFixed(1)}% of receivables outstanding` });
        totalScore += score;
      } else if (outstandingRatio > 25) {
        const score = 10;
        factors.push({ factor: 'Moderate Outstanding Receivables', score, weight: 0.1, detail: `${outstandingRatio.toFixed(1)}% of receivables outstanding` });
        totalScore += score;
      }
    }

    // Factor 3: Concentration risk
    const totalOrderCount = await db('export_orders').whereNotIn('status', ['Draft', 'Cancelled']).count('id as count').first();
    const totalOrders = parseInt(totalOrderCount.count, 10);
    if (totalOrders > 0) {
      const concentration = (orderCount / totalOrders) * 100;
      if (concentration > 50) {
        const score = 15;
        factors.push({ factor: 'Order Concentration Risk', score, weight: 0.15, detail: `${concentration.toFixed(1)}% of all orders are from this customer` });
        totalScore += score;
      }
    }

    // Factor 4: Average margin
    if (custScoreRecord && custScoreRecord.avg_margin_pct !== null) {
      const avgMargin = parseFloat(custScoreRecord.avg_margin_pct);
      if (avgMargin < 5) {
        const score = 20;
        factors.push({ factor: 'Low Profitability', score, weight: 0.2, detail: `Average margin ${avgMargin.toFixed(2)}%` });
        totalScore += score;
      } else if (avgMargin < 10) {
        const score = 10;
        factors.push({ factor: 'Below-Average Profitability', score, weight: 0.1, detail: `Average margin ${avgMargin.toFixed(2)}%` });
        totalScore += score;
      }
    }

    totalScore = Math.min(totalScore, 100);

    let riskLevel;
    if (totalScore > 70) riskLevel = 'Critical';
    else if (totalScore > 50) riskLevel = 'High';
    else if (totalScore > 30) riskLevel = 'Medium';
    else riskLevel = 'Low';

    const riskData = {
      entity_type: 'customer',
      entity_id: customerId,
      entity_ref: customer.name,
      risk_score: totalScore,
      risk_level: riskLevel,
      risk_factors: JSON.stringify(factors),
      financial_exposure: totalOutstanding,
      currency: 'PKR', // booked-rate PKR equivalent of the open receivables
      calculated_at: new Date(),
    };

    const existing = await db('risk_scores').where({ entity_type: 'customer', entity_id: customerId }).first();
    let record;
    if (existing) {
      [record] = await db('risk_scores').where({ id: existing.id }).update(riskData).returning('*');
    } else {
      [record] = await db('risk_scores').insert(riskData).returning('*');
    }
    return record;
  },

  async getTopRiskOrders(limit = 10) {
    return db('risk_scores as rs')
      .join('export_orders as eo', function () {
        this.on('eo.id', '=', 'rs.entity_id').andOn(db.raw("rs.entity_type = 'export_order'"));
      })
      .leftJoin('customers as c', 'c.id', 'eo.customer_id')
      .select(
        'rs.*',
        'eo.order_no',
        'eo.status as order_status',
        'eo.contract_value',
        'eo.country',
        'c.name as customer_name'
      )
      .where('rs.entity_type', 'export_order')
      .orderBy('rs.risk_score', 'desc')
      .limit(limit);
  },

  async getTopRiskCustomers(limit = 10) {
    return db('risk_scores as rs')
      .join('customers as c', function () {
        this.on('c.id', '=', 'rs.entity_id').andOn(db.raw("rs.entity_type = 'customer'"));
      })
      .select(
        'rs.*',
        'c.name as customer_name',
        'c.country',
        'c.email'
      )
      .where('rs.entity_type', 'customer')
      .orderBy('rs.risk_score', 'desc')
      .limit(limit);
  },

  async getRiskDashboard() {
    const [levelCounts, topOrders, topCustomers, totalExposure] = await Promise.all([
      db('risk_scores')
        .select('risk_level')
        .count('id as count')
        .groupBy('risk_level'),
      this.getTopRiskOrders(5),
      this.getTopRiskCustomers(5),
      // Per currency — an order's exposure is in its own currency.
      db('risk_scores')
        .select(db.raw("COALESCE(currency, 'PKR') as currency"), db.raw('COALESCE(SUM(financial_exposure), 0) as total'))
        .groupByRaw("COALESCE(currency, 'PKR')"),
    ]);

    const levels = levelCounts.reduce((acc, r) => { acc[r.risk_level] = parseInt(r.count, 10); return acc; }, {});

    return {
      summary: {
        critical: levels.Critical || 0,
        high: levels.High || 0,
        medium: levels.Medium || 0,
        low: levels.Low || 0,
      },
      topOrders,
      topCustomers,
      totalFinancialExposureByCurrency: byCurrency(totalExposure),
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // ROOT CAUSE ANALYSIS
  // ═══════════════════════════════════════════════════════════════════

  async analyzeMarginDrop(orderId, userId) {
    const order = await db('export_orders').where({ id: orderId }).first();
    if (!order) throw new Error('Order not found.');

    // Get margin analysis for estimated vs actual
    const marginAnalysis = await db('margin_analysis')
      .where({ order_id: orderId })
      .orderBy('analysis_date', 'desc')
      .first();

    // Get actual costs from export_order_costs
    const actualCosts = await db('export_order_costs').where({ order_id: orderId });
    const actualCostMap = {};
    let totalActual = 0;
    // In PKR (each cost at its own / the order's booked rate), the same
    // currency as margin_analysis.estimated_costs — never rupees vs dollars.
    const { revenuePkr: orderPkr, bookedRate: orderRate } = orderRevenuePkr(order);
    for (const c of actualCosts) {
      const pkr = costRowPkr(c, orderRate);
      actualCostMap[c.category] = (actualCostMap[c.category] || 0) + pkr;
      totalActual += pkr;
    }

    // Use margin_analysis estimated_costs if available, else assume 80% of contract as estimate
    let estimatedCostMap = {};
    let totalEstimated = 0;
    if (marginAnalysis && marginAnalysis.estimated_costs) {
      estimatedCostMap = typeof marginAnalysis.estimated_costs === 'string'
        ? JSON.parse(marginAnalysis.estimated_costs)
        : marginAnalysis.estimated_costs;
      for (const k of Object.keys(estimatedCostMap)) {
        totalEstimated += parseFloat(estimatedCostMap[k]) || 0;
      }
    } else {
      // Estimate based on contract value
      const cv = orderPkr || 0; // contract in PKR at the booked rate
      estimatedCostMap = { rice: cv * 0.5, bags: cv * 0.05, loading: cv * 0.04, clearing: cv * 0.03, freight: cv * 0.12, misc: cv * 0.02 };
      totalEstimated = Object.values(estimatedCostMap).reduce((s, v) => s + v, 0);
    }

    // Build factors
    const factors = [];
    const totalVariance = totalActual - totalEstimated;
    const allCategories = new Set([...Object.keys(estimatedCostMap), ...Object.keys(actualCostMap)]);

    for (const cat of allCategories) {
      const est = parseFloat(estimatedCostMap[cat]) || 0;
      const act = parseFloat(actualCostMap[cat]) || 0;
      const variance = act - est;
      if (Math.abs(variance) > 0) {
        const impactPct = totalVariance !== 0 ? (variance / Math.abs(totalVariance)) * 100 : 0;
        let explanation = '';
        if (variance > 0) {
          const pctOver = est > 0 ? ((variance / est) * 100).toFixed(1) : 'N/A';
          explanation = `${cat} cost ${pctOver}% above estimate`;
        } else {
          explanation = `${cat} cost under estimate by ${Math.abs(variance).toFixed(2)}`;
        }
        factors.push({
          category: cat,
          expected: est,
          actual: act,
          variance,
          impact_pct: parseFloat(impactPct.toFixed(2)),
          explanation,
        });
      }
    }

    // Sort by absolute impact
    factors.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

    // Generate recommendations
    const recommendations = [];
    const topFactors = factors.slice(0, 3);
    for (const f of topFactors) {
      if (f.variance > 0) {
        recommendations.push(`Investigate ${f.category} cost increase: actual Rs ${f.actual.toFixed(2)} vs estimated Rs ${f.expected.toFixed(2)}. Consider renegotiating or finding alternative providers.`);
      }
    }
    if (totalVariance > 0) {
      recommendations.push('Review pricing formula to account for recent cost increases.');
      recommendations.push('Consider building a larger contingency buffer into future quotations.');
    }

    const contractValue = orderPkr || 0; // PKR at the booked rate, like the costs
    const estimatedMargin = totalEstimated > 0 ? ((contractValue - totalEstimated) / contractValue * 100) : 0;
    const actualMargin = totalActual > 0 ? ((contractValue - totalActual) / contractValue * 100) : 0;

    const [record] = await db('root_cause_analyses').insert({
      analysis_type: 'margin_drop',
      linked_type: 'export_order',
      linked_id: orderId,
      linked_ref: order.order_no,
      summary: `Margin dropped from ${estimatedMargin.toFixed(2)}% (estimated) to ${actualMargin.toFixed(2)}% (actual) on ${order.order_no}. Total cost overrun: Rs ${totalVariance.toFixed(2)}.`,
      factors: JSON.stringify(factors),
      total_impact: totalVariance,
      currency: 'PKR',
      recommendations: JSON.stringify(recommendations),
      created_by: userId || null,
    }).returning('*');

    return record;
  },

  async analyzeCostOverrun(orderId, userId) {
    const order = await db('export_orders').where({ id: orderId }).first();
    if (!order) throw new Error('Order not found.');

    const marginAnalysis = await db('margin_analysis')
      .where({ order_id: orderId })
      .orderBy('analysis_date', 'desc')
      .first();

    const actualCosts = await db('export_order_costs').where({ order_id: orderId });
    const actualCostMap = {};
    let totalActual = 0;
    // In PKR (each cost at its own / the order's booked rate), the same
    // currency as margin_analysis.estimated_costs — never rupees vs dollars.
    const { revenuePkr: orderPkr, bookedRate: orderRate } = orderRevenuePkr(order);
    for (const c of actualCosts) {
      const pkr = costRowPkr(c, orderRate);
      actualCostMap[c.category] = (actualCostMap[c.category] || 0) + pkr;
      totalActual += pkr;
    }

    let estimatedCostMap = {};
    let totalEstimated = 0;
    if (marginAnalysis && marginAnalysis.estimated_costs) {
      estimatedCostMap = typeof marginAnalysis.estimated_costs === 'string'
        ? JSON.parse(marginAnalysis.estimated_costs)
        : marginAnalysis.estimated_costs;
      for (const k of Object.keys(estimatedCostMap)) {
        totalEstimated += parseFloat(estimatedCostMap[k]) || 0;
      }
    }

    const factors = [];
    const allCategories = new Set([...Object.keys(estimatedCostMap), ...Object.keys(actualCostMap)]);

    for (const cat of allCategories) {
      const est = parseFloat(estimatedCostMap[cat]) || 0;
      const act = parseFloat(actualCostMap[cat]) || 0;
      const variance = act - est;
      const variancePct = est > 0 ? (variance / est) * 100 : (act > 0 ? 100 : 0);
      factors.push({
        category: cat,
        expected: est,
        actual: act,
        variance,
        impact_pct: parseFloat(variancePct.toFixed(2)),
        explanation: variance > 0
          ? `${cat} exceeded budget by ${variancePct.toFixed(1)}%`
          : variance < 0
            ? `${cat} under budget by ${Math.abs(variancePct).toFixed(1)}%`
            : `${cat} on budget`,
      });
    }

    factors.sort((a, b) => b.variance - a.variance);

    const recommendations = [];
    const overruns = factors.filter((f) => f.variance > 0);
    if (overruns.length > 0) {
      recommendations.push(`Top cost overrun: ${overruns[0].category} (+Rs ${overruns[0].variance.toFixed(2)}). Review vendor contracts.`);
    }
    if (totalActual > totalEstimated) {
      recommendations.push(`Total cost overrun is Rs ${(totalActual - totalEstimated).toFixed(2)}. Update cost estimation models.`);
      recommendations.push('Schedule a cost review meeting with operations and procurement teams.');
    }

    const [record] = await db('root_cause_analyses').insert({
      analysis_type: 'cost_overrun',
      linked_type: 'export_order',
      linked_id: orderId,
      linked_ref: order.order_no,
      summary: `Cost analysis for ${order.order_no}: Estimated Rs ${totalEstimated.toFixed(2)}, Actual Rs ${totalActual.toFixed(2)}. Overrun: Rs ${(totalActual - totalEstimated).toFixed(2)}.`,
      factors: JSON.stringify(factors),
      total_impact: totalActual - totalEstimated,
      currency: 'PKR',
      recommendations: JSON.stringify(recommendations),
      created_by: userId || null,
    }).returning('*');

    return record;
  },

  async analyzeYieldLoss(batchId, userId) {
    const batch = await db('milling_batches').where({ id: batchId }).first();
    if (!batch) throw new Error('Milling batch not found.');

    const factors = [];
    let totalImpact = 0;

    // Get benchmark
    let benchmark = null;
    if (batch.benchmark_id) {
      benchmark = await db('recovery_benchmarks').where({ id: batch.benchmark_id }).first();
    }

    const expectedYield = benchmark ? parseFloat(benchmark.expected_yield_pct) : 75;
    const actualYield = parseFloat(batch.yield_pct);
    const yieldGap = expectedYield - actualYield;
    const rawQty = parseFloat(batch.raw_qty_kg) / 1000;
    const lostMT = (yieldGap / 100) * rawQty;

    // Factor 1: Quality parameters from arrival analysis
    const arrivalSample = await db('milling_quality_samples')
      .where({ batch_id: batchId, analysis_type: 'arrival' })
      .first();

    if (arrivalSample) {
      const moisture = parseFloat(arrivalSample.moisture || 0);
      if (benchmark && moisture > parseFloat(benchmark.moisture_range_max || 14)) {
        const excess = moisture - parseFloat(benchmark.moisture_range_max);
        const impactMT = (excess / 100) * rawQty;
        factors.push({
          category: 'High Moisture',
          expected: parseFloat(benchmark.moisture_range_max),
          actual: moisture,
          variance: excess,
          impact_pct: lostMT > 0 ? parseFloat(((impactMT / lostMT) * 100).toFixed(2)) : 0,
          explanation: `Moisture ${moisture}% exceeded max ${benchmark.moisture_range_max}% by ${excess.toFixed(2)}%. Causes additional drying loss.`,
        });
        totalImpact += impactMT * 500;
      }

      const foreignMatter = parseFloat(arrivalSample.foreign_matter || 0);
      if (foreignMatter > 0.5) {
        const impactMT = (foreignMatter / 100) * rawQty;
        factors.push({
          category: 'Foreign Matter',
          expected: 0.5,
          actual: foreignMatter,
          variance: foreignMatter - 0.5,
          impact_pct: lostMT > 0 ? parseFloat(((impactMT / lostMT) * 100).toFixed(2)) : 0,
          explanation: `Foreign matter at ${foreignMatter}% is above 0.5% tolerance. Direct yield reduction.`,
        });
        totalImpact += impactMT * 500;
      }
    }

    // Factor 2: Machine downtime during this batch
    const downtime = await db('machine_downtime')
      .where({ batch_id: batchId })
      .select(
        db.raw('COALESCE(SUM(duration_minutes), 0) as total_minutes'),
        db.raw('COALESCE(SUM(impact_mt), 0) as total_impact_mt')
      )
      .first();

    if (parseFloat(downtime.total_minutes) > 0) {
      factors.push({
        category: 'Machine Downtime',
        expected: 0,
        actual: parseFloat(downtime.total_minutes),
        variance: parseFloat(downtime.total_minutes),
        impact_pct: lostMT > 0 ? parseFloat(((parseFloat(downtime.total_impact_mt) / lostMT) * 100).toFixed(2)) : 0,
        explanation: `${parseFloat(downtime.total_minutes)} minutes of downtime, impacting ~${parseFloat(downtime.total_impact_mt).toFixed(2)} MT.`,
      });
      totalImpact += parseFloat(downtime.total_impact_mt) * 500;
    }

    // Factor 3: Operator / shift factor
    if (batch.shift) {
      // Compare this batch's yield to average yield on same shift
      const shiftAvg = await db('milling_batches')
        .where({ shift: batch.shift })
        .whereNot({ id: batchId })
        .where('yield_pct', '>', 0)
        .avg('yield_pct as avg_yield')
        .first();

      if (shiftAvg && shiftAvg.avg_yield) {
        const shiftAvgYield = parseFloat(shiftAvg.avg_yield);
        if (actualYield < shiftAvgYield - 2) {
          factors.push({
            category: 'Shift Performance',
            expected: parseFloat(shiftAvgYield.toFixed(2)),
            actual: actualYield,
            variance: actualYield - shiftAvgYield,
            impact_pct: 10,
            explanation: `Batch yield ${actualYield}% is ${(shiftAvgYield - actualYield).toFixed(1)}% below average for ${batch.shift} shift (avg ${shiftAvgYield.toFixed(1)}%).`,
          });
        }
      }
    }

    // If no specific factors found, add a general one
    if (factors.length === 0) {
      factors.push({
        category: 'General Yield Loss',
        expected: expectedYield,
        actual: actualYield,
        variance: -yieldGap,
        impact_pct: 100,
        explanation: `Yield ${actualYield}% is ${yieldGap.toFixed(1)}% below benchmark of ${expectedYield}%. No specific cause identified — recommend quality audit.`,
      });
      totalImpact = lostMT * 500;
    }

    const recommendations = [];
    recommendations.push(`Yield gap of ${yieldGap.toFixed(1)}% resulted in ~${lostMT.toFixed(2)} MT lost output.`);
    if (arrivalSample && parseFloat(arrivalSample.moisture || 0) > 13.5) {
      recommendations.push('Enforce stricter moisture limits at GRN. Consider additional drying before milling.');
    }
    if (parseFloat(downtime.total_minutes || 0) > 60) {
      recommendations.push('Review machine maintenance schedule. Downtime contributed to yield loss.');
    }
    recommendations.push('Compare operator performance across shifts to identify training needs.');

    const [record] = await db('root_cause_analyses').insert({
      analysis_type: 'yield_loss',
      linked_type: 'milling_batch',
      linked_id: batchId,
      linked_ref: batch.batch_no,
      summary: `Yield loss analysis for batch ${batch.batch_no}: Actual ${actualYield}% vs Benchmark ${expectedYield}%. Gap: ${yieldGap.toFixed(1)}%. Lost output: ~${lostMT.toFixed(2)} MT.`,
      factors: JSON.stringify(factors),
      total_impact: totalImpact,
      currency: 'USD',
      recommendations: JSON.stringify(recommendations),
      created_by: userId || null,
    }).returning('*');

    return record;
  },

  async analyzePaymentDelay(orderId, userId) {
    const order = await db('export_orders').where({ id: orderId }).first();
    if (!order) throw new Error('Order not found.');

    const factors = [];
    let totalImpact = 0;

    // Customer payment history
    const custScore = await db('customer_scores')
      .where({ customer_id: order.customer_id })
      .orderBy('calculated_at', 'desc')
      .first();

    const customer = await db('customers').where({ id: order.customer_id }).first();

    // Factor 1: Customer historical pattern
    if (custScore) {
      const avgAdvDays = parseFloat(custScore.avg_advance_days || 0);
      const avgBalDays = parseFloat(custScore.avg_balance_days || 0);
      factors.push({
        category: 'Customer Payment Pattern',
        expected: 14,
        actual: avgAdvDays,
        variance: avgAdvDays - 14,
        impact_pct: 30,
        explanation: `Customer ${customer ? customer.name : 'Unknown'} averages ${avgAdvDays} days for advance (norm: 14 days) and ${avgBalDays} days for balance.`,
      });
    }

    // Factor 2: Order-specific advance delay
    if (order.status === 'Awaiting Advance' || (order.advance_date && order.created_at)) {
      const advanceDays = order.advance_date
        ? Math.floor((new Date(order.advance_date).getTime() - new Date(order.created_at).getTime()) / (1000 * 60 * 60 * 24))
        : Math.floor((Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60 * 24));

      factors.push({
        category: 'Advance Payment Timeline',
        expected: 14,
        actual: advanceDays,
        variance: advanceDays - 14,
        impact_pct: 25,
        explanation: order.advance_date
          ? `Advance took ${advanceDays} days (received on ${order.advance_date}).`
          : `Advance still pending after ${advanceDays} days.`,
      });

      if (!order.advance_date) {
        totalImpact += parseFloat(order.advance_expected || 0);
      }
    }

    // Factor 3: Document delays
    const pendingDocs = await db('export_order_documents')
      .where({ order_id: orderId })
      .whereNot({ status: 'Approved' })
      .count('id as count')
      .first();

    if (parseInt(pendingDocs.count, 10) > 0) {
      factors.push({
        category: 'Document Delays',
        expected: 0,
        actual: parseInt(pendingDocs.count, 10),
        variance: parseInt(pendingDocs.count, 10),
        impact_pct: 20,
        explanation: `${pendingDocs.count} document(s) not yet approved — may delay customer payment release.`,
      });
    }

    // Factor 4: Balance payment status
    if (order.balance_expected && parseFloat(order.balance_received || 0) < parseFloat(order.balance_expected)) {
      const outstanding = parseFloat(order.balance_expected) - parseFloat(order.balance_received || 0);
      factors.push({
        category: 'Outstanding Balance',
        expected: parseFloat(order.balance_expected),
        actual: parseFloat(order.balance_received || 0),
        variance: -outstanding,
        impact_pct: 25,
        explanation: `Balance outstanding: ${order.currency} ${outstanding.toFixed(2)} of ${order.currency} ${parseFloat(order.balance_expected).toFixed(2)}.`,
      });
      totalImpact += outstanding;
    }

    const recommendations = [];
    if (custScore && parseInt(custScore.overdue_count || 0, 10) > 1) {
      recommendations.push(`Customer has ${custScore.overdue_count} overdue instances. Consider requiring LC/bank guarantee for future orders.`);
    }
    if (parseInt(pendingDocs.count, 10) > 0) {
      recommendations.push('Expedite document preparation to enable payment release.');
    }
    recommendations.push('Send payment reminder to customer with updated statement.');
    if (totalImpact > 10000) {
      recommendations.push('Escalate to finance manager for collection follow-up.');
    }

    const [record] = await db('root_cause_analyses').insert({
      analysis_type: 'payment_delay',
      linked_type: 'export_order',
      linked_id: orderId,
      linked_ref: order.order_no,
      summary: `Payment delay analysis for ${order.order_no} (${customer ? customer.name : 'Unknown'}). Total outstanding: ${order.currency} ${totalImpact.toFixed(2)}.`,
      factors: JSON.stringify(factors),
      total_impact: totalImpact,
      currency: order.currency,
      recommendations: JSON.stringify(recommendations),
      created_by: userId || null,
    }).returning('*');

    return record;
  },

  async getRootCauseAnalyses({ linkedType, linkedId, analysisType, page = 1, limit = 25 }) {
    const query = db('root_cause_analyses as rca')
      .leftJoin('users as u', 'u.id', 'rca.created_by')
      .select('rca.*', 'u.full_name as created_by_name');

    if (linkedType) query.where('rca.linked_type', linkedType);
    if (linkedId) query.where('rca.linked_id', linkedId);
    if (analysisType) query.where('rca.analysis_type', analysisType);

    query.orderBy('rca.created_at', 'desc');

    const offset = (page - 1) * limit;
    const countQuery = query.clone().clearSelect().clearOrder().count('rca.id as total').first();
    const [data, countResult] = await Promise.all([
      query.offset(offset).limit(limit),
      countQuery,
    ]);

    return {
      data,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: parseInt(countResult.total, 10),
        totalPages: Math.ceil(parseInt(countResult.total, 10) / limit),
      },
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // INTERACTIVE DASHBOARD DATA
  // ═══════════════════════════════════════════════════════════════════

  async getDashboardData({ entity, dateFrom, dateTo }) {
    const dateFilter = (q, dateCol) => {
      if (dateFrom) q.where(dateCol, '>=', dateFrom);
      if (dateTo) q.where(dateCol, '<=', dateTo);
    };

    // Export KPIs — money in each order's own currency: { USD, PKR }, never
    // added together (owner decision G-1).
    const activeOrdersQ = db('export_orders').whereNotIn('status', ['Draft', 'Closed', 'Cancelled']);
    if (entity === 'mill') activeOrdersQ.where(db.raw('1 = 0')); // no export data for mill entity
    dateFilter(activeOrdersQ, 'created_at');
    const activeOrders = await activeOrdersQ.count('id as count').first();

    const CUR = 'UPPER(currency)';
    const contractValueQ = db('export_orders').whereNotIn('status', ['Draft', 'Cancelled']);
    if (entity === 'mill') contractValueQ.where(db.raw('1 = 0'));
    dateFilter(contractValueQ, 'created_at');
    const contractValueRows = await contractValueQ
      .select(db.raw(`${CUR} as currency`), db.raw('COALESCE(SUM(contract_value), 0) as total'))
      .groupByRaw(CUR);

    const advancePendingQ = db('export_orders').where('status', 'Awaiting Advance');
    dateFilter(advancePendingQ, 'created_at');
    const advancePendingRows = entity === 'mill'
      ? []
      : await advancePendingQ
        .select(db.raw(`${CUR} as currency`), db.raw('COALESCE(SUM(advance_expected - COALESCE(advance_received, 0)), 0) as total'))
        .groupByRaw(CUR);

    const balancePendingQ = db('export_orders').whereIn('status', BALANCE_COLLECTION_STATUSES).whereRaw(BALANCE_OUTSTANDING_SQL);
    dateFilter(balancePendingQ, 'created_at');
    const balancePendingRows = entity === 'mill'
      ? []
      : await balancePendingQ
        .select(db.raw(`${CUR} as currency`), db.raw('COALESCE(SUM(balance_expected - COALESCE(balance_received, 0)), 0) as total'))
        .groupByRaw(CUR);

    const shipmentsInTransitQ = db('export_orders').where('status', 'Shipped');
    const shipmentsInTransit = entity === 'mill'
      ? { count: 0 }
      : await shipmentsInTransitQ.count('id as count').first();

    // Export profit — the Booked profit of the one definition every profit
    // tile reads (finance/profitDefinitions.js, G-2), in PKR at each order's
    // booked rate, for orders dated in the range. (Was contract_value − SUM of
    // costs: rupee costs taken off dollar contracts.)
    const exportDefs = entity === 'mill'
      ? { bookedPkr: 0, unpricedCount: 0 }
      : (await exportProfit(db, { startDate: dateFrom, endDate: dateTo })).totals;

    // Mill KPIs
    const activeBatchesQ = db('milling_batches').whereIn('status', ['Queued', 'In Progress', 'Processing']);
    const activeBatches = entity === 'export'
      ? { count: 0 }
      : await activeBatchesQ.count('id as count').first();

    // Company stock only — client-owned service-milling lots are not ours.
    const rawStockQ = companyStock(db('inventory_lots'), null).where('type', 'raw').where('entity', 'mill').where('status', 'Available');
    const rawStock = entity === 'export'
      ? { total: 0 }
      : await rawStockQ.sum('qty as total').first();

    const finishedStockQ = companyStock(db('inventory_lots'), null).where('type', 'finished').where('status', 'Available');
    const finishedStock = entity === 'export'
      ? { total: 0 }
      : await finishedStockQ.sum('qty as total').first();

    const millProfitQ = db('mill_performance');
    dateFilter(millProfitQ, 'period_start');
    const millProfit = entity === 'export'
      ? { total: 0 }
      : await millProfitQ.select(db.raw('COALESCE(SUM(total_input_mt * avg_cost_per_mt), 0) as total')).first();

    const avgYieldQ = db('milling_batches').where('yield_pct', '>', 0);
    const avgYield = entity === 'export'
      ? { avg: 0 }
      : await avgYieldQ.avg('yield_pct as avg').first();

    // Finance KPIs — each currency on its own. Open = something still
    // outstanding and not settled / written off / reversed.
    const OPEN_CUR = "UPPER(COALESCE(currency, 'PKR'))";
    const receivableRows = await db('receivables')
      .whereNotIn('status', RECEIVABLE_CLOSED)
      .where('outstanding', '>', 0)
      .select(db.raw(`${OPEN_CUR} as currency`), db.raw('COALESCE(SUM(outstanding), 0) as total'))
      .groupByRaw(OPEN_CUR);

    const payableRows = await db('payables')
      .whereNotIn('status', PAYABLE_CLOSED)
      .where('outstanding', '>', 0)
      .select(db.raw(`${OPEN_CUR} as currency`), db.raw('COALESCE(SUM(outstanding), 0) as total'))
      .groupByRaw(OPEN_CUR);

    // Cash per currency, every account (as Finance ▸ Home); ≈ PKR at today's rate.
    const bankRows = await db('bank_accounts')
      .select(db.raw(`${OPEN_CUR} as currency`))
      .sum('current_balance as total')
      .count('id as count')
      .groupByRaw(OPEN_CUR);
    const fx = await fxRateService.getLatestRate('USD');

    // Collection rate (C6): received ÷ amounts DUE, per currency.
    const collection = await computeCollectionRate(db);

    // Pipeline: orders by status with count and value — the value per order
    // currency, never one sum.
    const pipelineRows = await db('export_orders')
      .whereNotIn('status', ['Cancelled'])
      .select('status', db.raw(`${CUR} as currency`))
      .count('id as count')
      .sum('contract_value as total_value')
      .groupByRaw(`status, ${CUR}`);
    const STAGE_ORDER = ['Draft', 'Awaiting Advance', 'Advance Received', 'Procurement Pending', 'In Milling',
      'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship', 'Shipped', 'Arrived', 'Closed'];
    const stageRank = (s) => { const i = STAGE_ORDER.indexOf(s); return i < 0 ? STAGE_ORDER.length : i; };
    const pipelineByStatus = new Map();
    for (const r of Array.isArray(pipelineRows) ? pipelineRows : []) {
      const p = pipelineByStatus.get(r.status) || { status: r.status, count: 0, valueByCurrency: {} };
      p.count += parseInt(r.count, 10) || 0;
      const cur = String(r.currency || 'USD').toUpperCase();
      p.valueByCurrency[cur] = (p.valueByCurrency[cur] || 0) + (parseFloat(r.total_value) || 0);
      pipelineByStatus.set(r.status, p);
    }
    const pipeline = [...pipelineByStatus.values()].sort((a, b) => stageRank(a.status) - stageRank(b.status));

    // Exceptions summary
    const exceptionsData = await db('exception_inbox')
      .whereIn('status', ['Open', 'Acknowledged', 'In Progress', 'Escalated'])
      .select(
        db.raw('COUNT(*) as total'),
        db.raw("COUNT(*) FILTER (WHERE severity = 'critical') as critical"),
        db.raw("COUNT(*) FILTER (WHERE severity = 'warning') as warning")
      )
      .first();

    const topExceptions = await db('exception_inbox')
      .whereIn('status', ['Open', 'Acknowledged', 'In Progress', 'Escalated'])
      .orderByRaw("CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END")
      .orderBy('created_at', 'desc')
      .limit(5);

    // Risk summary
    const riskData = await db('risk_scores')
      .select(
        db.raw("COUNT(*) FILTER (WHERE risk_level = 'Critical') as critical"),
        db.raw("COUNT(*) FILTER (WHERE risk_level = 'High') as high")
      )
      .first();

    const topRiskOrders = await this.getTopRiskOrders(5);
    const topRiskCustomers = await this.getTopRiskCustomers(5);

    // Recent activity
    const recentActivity = await db('audit_logs as a')
      .leftJoin('users as u', 'a.user_id', 'u.id')
      .select('a.id', 'a.action', 'a.entity_type', 'a.entity_id', 'a.created_at', 'u.full_name as user_name')
      .orderBy('a.created_at', 'desc')
      .limit(10);

    // Charts: Profit trend (monthly) — simplified
    let profitTrend = [];
    try {
      profitTrend = await db.raw(`
        SELECT TO_CHAR(ma.analysis_date, 'YYYY-MM') as month,
               SUM(ma.actual_revenue) as revenue,
               SUM(ma.actual_revenue - COALESCE(ma.estimated_revenue, 0)) as profit
        FROM margin_analysis ma
        GROUP BY TO_CHAR(ma.analysis_date, 'YYYY-MM')
        ORDER BY month
      `).then(r => r.rows || []);
    } catch (e) { profitTrend = []; }

    // Cost breakdown — in PKR at each cost row's / order's booked rate (a cost
    // row with no rate is counted, not guessed).
    const costBreakdown = (await db('export_order_costs as eoc')
      .join('export_orders as eo', 'eo.id', 'eoc.order_id')
      .select(
        'eoc.category',
        db.raw(`COALESCE(SUM(${ORDER_COST_PKR_SQL}), 0) as total_pkr`),
        db.raw(`COUNT(*) FILTER (WHERE (${ORDER_COST_PKR_SQL}) IS NULL) as unpriced_count`),
      )
      .groupBy('eoc.category')
      .orderBy('total_pkr', 'desc')) || [];

    // Receivables aging, per currency (days past due — the stored aging
    // column is never maintained).
    const AGE = 'GREATEST(0, CURRENT_DATE - due_date::date)';
    const agingRows = await db('receivables')
      .whereNotIn('status', RECEIVABLE_CLOSED)
      .where('outstanding', '>', 0)
      .select(
        db.raw(`${OPEN_CUR} as currency`),
        db.raw(`COALESCE(SUM(CASE WHEN due_date IS NULL OR ${AGE} <= 30 THEN outstanding ELSE 0 END), 0) as "0-30"`),
        db.raw(`COALESCE(SUM(CASE WHEN ${AGE} BETWEEN 31 AND 60 THEN outstanding ELSE 0 END), 0) as "31-60"`),
        db.raw(`COALESCE(SUM(CASE WHEN ${AGE} BETWEEN 61 AND 90 THEN outstanding ELSE 0 END), 0) as "61-90"`),
        db.raw(`COALESCE(SUM(CASE WHEN ${AGE} > 90 THEN outstanding ELSE 0 END), 0) as "90+"`),
      )
      .groupByRaw(OPEN_CUR);
    const receivablesAging = {};
    for (const a of Array.isArray(agingRows) ? agingRows : []) {
      receivablesAging[String(a.currency || 'PKR').toUpperCase()] = {
        '0-30': parseFloat(a['0-30']) || 0,
        '31-60': parseFloat(a['31-60']) || 0,
        '61-90': parseFloat(a['61-90']) || 0,
        '90+': parseFloat(a['90+']) || 0,
      };
    }

    return {
      // Money KPIs are { PKR, USD } per currency — never one added-up figure.
      // (Renamed from totalContractValue / advancePending / balancePending /
      // exportProfit / totalReceivables / totalPayables / cashPosition so a
      // stored snapshot of the old mixed numbers is never read as the new ones.)
      kpis: {
        activeOrders: parseInt(activeOrders.count, 10),
        contractValueByCurrency: byCurrency(contractValueRows, 'total'),
        advancePendingByCurrency: byCurrency(advancePendingRows, 'total'),
        balancePendingByCurrency: byCurrency(balancePendingRows, 'total'),
        shipmentsInTransit: parseInt(shipmentsInTransit.count, 10),
        exportBookedProfitPkr: exportDefs.bookedPkr || 0,
        exportUnpricedOrders: exportDefs.unpricedCount || 0,
        activeBatches: parseInt(activeBatches.count, 10),
        rawStock: parseFloat(rawStock.total || 0),
        finishedStock: parseFloat(finishedStock.total || 0),
        millProfit: parseFloat(millProfit.total || 0),
        avgYield: parseFloat(parseFloat(avgYield.avg || 0).toFixed(2)),
        receivablesByCurrency: byCurrency(receivableRows, 'total'),
        payablesByCurrency: byCurrency(payableRows, 'total'),
        cashPosition: cashSummary(bankRows, { usdRate: parseFloat(fx && fx.rate) || 0, rateDate: dayOf(fx && fx.effectiveDate) }),
        ...collectionRateFields(collection),
      },
      pipeline,
      exceptions: {
        total: parseInt(exceptionsData.total, 10),
        critical: parseInt(exceptionsData.critical, 10),
        warning: parseInt(exceptionsData.warning, 10),
        topItems: topExceptions,
      },
      risks: {
        critical: parseInt(riskData.critical, 10),
        high: parseInt(riskData.high, 10),
        topOrders: topRiskOrders,
        topCustomers: topRiskCustomers,
      },
      recentActivity,
      charts: {
        profitTrend,
        costBreakdown,
        // { USD: { '0-30', '31-60', '61-90', '90+' }, PKR: {...} } — per currency.
        receivablesAging,
      },
    };
  },

  async getKPIDrilldown(kpiName, { entity, dateFrom, dateTo, page = 1, limit = 25 }) {
    const offset = (page - 1) * limit;
    let query;
    let countQuery;

    switch (kpiName) {
      case 'activeOrders':
        query = db('export_orders as eo')
          .leftJoin('customers as c', 'c.id', 'eo.customer_id')
          .whereNotIn('eo.status', ['Draft', 'Closed', 'Cancelled'])
          .select('eo.id', 'eo.order_no', 'eo.status', 'eo.contract_value', 'eo.currency', 'eo.country', 'c.name as customer_name', 'eo.shipment_eta')
          .orderBy('eo.created_at', 'desc');
        break;

      case 'advancePending':
        query = db('export_orders as eo')
          .leftJoin('customers as c', 'c.id', 'eo.customer_id')
          .where('eo.status', 'Awaiting Advance')
          .select(
            'eo.id', 'eo.order_no', 'eo.advance_expected', 'eo.advance_received',
            db.raw('eo.advance_expected - COALESCE(eo.advance_received, 0) as outstanding'),
            'eo.currency', 'c.name as customer_name', 'eo.created_at'
          )
          .orderBy('eo.created_at', 'asc');
        break;

      case 'balancePending':
        query = db('export_orders as eo')
          .leftJoin('customers as c', 'c.id', 'eo.customer_id')
          .whereIn('eo.status', BALANCE_COLLECTION_STATUSES)
          .whereRaw('COALESCE(eo.balance_expected, 0) - COALESCE(eo.balance_received, 0) > 0.01')
          .select(
            'eo.id', 'eo.order_no', 'eo.balance_expected', 'eo.balance_received',
            db.raw('eo.balance_expected - COALESCE(eo.balance_received, 0) as outstanding'),
            'eo.currency', 'c.name as customer_name', 'eo.updated_at'
          )
          .orderBy('eo.updated_at', 'asc');
        break;

      case 'shipmentsInTransit':
        query = db('export_orders as eo')
          .leftJoin('customers as c', 'c.id', 'eo.customer_id')
          .where('eo.status', 'Shipped')
          .select(
            'eo.id', 'eo.order_no', 'eo.vessel_name', 'eo.destination_port',
            'eo.etd', 'eo.atd', 'eo.eta', 'eo.contract_value', 'eo.currency',
            'c.name as customer_name'
          )
          .orderBy('eo.eta', 'asc');
        break;

      case 'lowMarginOrders': {
        // Booked margin in PKR per order (orderMargins.js) — not dollars less
        // rupees. Unpriced orders (no booked rate / no rice cost) are left out.
        const priced = (await orderMarginRows(db, { startDate: dateFrom, endDate: dateTo }))
          .filter((r) => r.priced && r.revenuePkr > 0)
          .sort((a, b) => (a.bookedProfitPkr / a.revenuePkr) - (b.bookedProfitPkr / b.revenuePkr));
        const pageRows = priced.slice(offset, offset + limit);
        const ids = pageRows.map((r) => r.id);
        const names = ids.length
          ? await db('export_orders as eo').leftJoin('customers as c', 'c.id', 'eo.customer_id')
            .whereIn('eo.id', ids).select('eo.id', 'c.name as customer_name')
          : [];
        const nameOf = new Map((names || []).map((n) => [Number(n.id), n.customer_name]));
        return {
          data: pageRows.map((r) => ({
            id: r.id,
            order_no: r.orderNo,
            status: r.status,
            currency: r.currency,
            contract_value: r.contractValueForeign,
            booked_fx_rate: r.bookedFxRate,
            revenue_pkr: r.revenuePkr,
            total_cost_pkr: r.totalCostPkr,
            booked_profit_pkr: r.bookedProfitPkr,
            margin_pct: Math.round((r.bookedProfitPkr / r.revenuePkr) * 10000) / 100,
            rice_cost_estimated: !!r.estimated,
            customer_name: nameOf.get(Number(r.id)) || null,
          })),
          pagination: {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            total: priced.length,
            totalPages: Math.ceil(priced.length / limit),
          },
        };
      }

      case 'activeBatches':
        query = db('milling_batches as mb')
          .leftJoin('export_orders as eo', 'eo.id', 'mb.linked_export_order_id')
          .whereIn('mb.status', ['Queued', 'In Progress', 'Processing'])
          .select(
            'mb.id', 'mb.batch_no', 'mb.status', 'mb.raw_qty_kg', 'mb.planned_finished_kg',
            'mb.supplier_name', 'eo.order_no as linked_order'
          )
          .orderBy('mb.created_at', 'desc');
        break;

      case 'totalReceivables':
        query = db('receivables as r')
          .leftJoin('customers as c', 'c.id', 'r.customer_id')
          .leftJoin('export_orders as eo', 'eo.id', 'r.order_id')
          .whereNotIn('r.status', RECEIVABLE_CLOSED).where('r.outstanding', '>', 0)
          .select(
            'r.id', 'r.recv_no', 'r.type', 'r.expected_amount', 'r.received_amount',
            'r.outstanding', 'r.due_date',
            // Real aging = days overdue (the stored r.aging column is always 0).
            db.raw('GREATEST(0, (CURRENT_DATE - r.due_date::date)) as aging'),
            'r.currency', 'r.status', 'c.name as customer_name', 'eo.order_no'
          )
          .orderByRaw('r.due_date ASC NULLS LAST'); // oldest-due (most overdue) first
        break;

      case 'totalPayables':
        query = db('payables as p')
          .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
          .whereNotIn('p.status', PAYABLE_CLOSED).where('p.outstanding', '>', 0)
          .select(
            'p.id', 'p.pay_no', 'p.category', 'p.original_amount', 'p.paid_amount',
            'p.outstanding', 'p.due_date',
            // Real aging = days overdue (the stored p.aging column is always 0).
            db.raw('GREATEST(0, (CURRENT_DATE - p.due_date::date)) as aging'),
            'p.currency', 'p.status', 's.name as supplier_name', 'p.linked_ref'
          )
          .orderByRaw('p.due_date ASC NULLS LAST'); // oldest-due (most overdue) first
        break;

      default:
        return { data: [], pagination: { page: 1, limit, total: 0, totalPages: 0 }, message: `Unknown KPI: ${kpiName}` };
    }

    // Apply the date-range filter on each KPI's record-creation date. (Was a
    // no-op `1=1` placeholder — dateFrom/dateTo were silently ignored.)
    const DATE_COL = {
      activeOrders: 'eo.created_at', advancePending: 'eo.created_at', balancePending: 'eo.created_at',
      shipmentsInTransit: 'eo.created_at', lowMarginOrders: 'eo.created_at',
      activeBatches: 'mb.created_at', totalReceivables: 'r.created_at', totalPayables: 'p.created_at',
    };
    const dateCol = DATE_COL[kpiName];
    if (dateCol && dateFrom) query.where(dateCol, '>=', dateFrom);
    // Make a plain YYYY-MM-DD dateTo inclusive of the whole day (created_at is a timestamp).
    if (dateCol && dateTo) query.where(dateCol, '<=', /[T:]/.test(String(dateTo)) ? dateTo : `${dateTo} 23:59:59`);

    countQuery = query.clone().clearSelect().clearOrder().count('* as total').first();
    const [data, countResult] = await Promise.all([
      query.offset(offset).limit(limit),
      countQuery,
    ]);

    return {
      data,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: parseInt(countResult.total, 10),
        totalPages: Math.ceil(parseInt(countResult.total, 10) / limit),
      },
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // DASHBOARD SNAPSHOTS
  // ═══════════════════════════════════════════════════════════════════

  async saveSnapshot(entity) {
    const dashboardData = await this.getDashboardData({ entity });

    const [record] = await db('dashboard_snapshots').insert({
      snapshot_date: new Date().toISOString().split('T')[0],
      entity: entity || null,
      metrics: JSON.stringify(dashboardData.kpis),
    }).returning('*');

    return record;
  },

  async getSnapshotHistory({ entity, dateFrom, dateTo }) {
    const query = db('dashboard_snapshots')
      .orderBy('snapshot_date', 'asc');

    if (entity) {
      query.where('entity', entity);
    } else {
      query.whereNull('entity');
    }

    if (dateFrom) query.where('snapshot_date', '>=', dateFrom);
    if (dateTo) query.where('snapshot_date', '<=', dateTo);

    return query;
  },
};

module.exports = intelligenceService;
