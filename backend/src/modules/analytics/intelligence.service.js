const db = require('../../config/database');
const auditService = require('../admin/audit.service');

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
        'mb.raw_qty_mt'
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
        amount_at_risk: parseFloat(r.raw_qty_mt) * 500, // estimated loss at $500/MT
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
    // Find export_orders where status='Awaiting Balance' and balance outstanding > 0
    // and it's been > 30 days since the order reached that status
    const rows = await db('export_orders')
      .where('status', 'Awaiting Balance')
      .whereRaw('balance_expected - COALESCE(balance_received, 0) > 0')
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
    // Calculate margin for each active export order
    // margin = (contract_value - sum(costs)) / contract_value * 100
    const lowMarginThreshold = 10;

    const rows = await db('export_orders as eo')
      .leftJoin('export_order_costs as c', 'c.order_id', 'eo.id')
      .whereNotIn('eo.status', ['Draft', 'Closed', 'Cancelled'])
      .where('eo.contract_value', '>', 0)
      .select(
        'eo.id',
        'eo.order_no',
        'eo.contract_value',
        'eo.currency',
        db.raw('COALESCE(SUM(c.amount), 0) as total_costs')
      )
      .groupBy('eo.id', 'eo.order_no', 'eo.contract_value', 'eo.currency')
      .havingRaw('COALESCE(SUM(c.amount), 0) > 0');

    const exceptions = [];
    for (const r of rows) {
      const contractValue = parseFloat(r.contract_value);
      const totalCosts = parseFloat(r.total_costs);
      const margin = ((contractValue - totalCosts) / contractValue) * 100;

      if (margin < 0) {
        exceptions.push({
          exception_type: 'negative_margin',
          severity: 'critical',
          entity: 'export',
          linked_type: 'export_order',
          linked_id: r.id,
          linked_ref: r.order_no,
          title: `Negative margin on ${r.order_no}: ${margin.toFixed(2)}%`,
          description: `Contract value: ${r.currency} ${contractValue.toFixed(2)}, Total costs: ${r.currency} ${totalCosts.toFixed(2)}. Loss of ${r.currency} ${(totalCosts - contractValue).toFixed(2)}.`,
          metric_value: parseFloat(margin.toFixed(2)),
          threshold_value: 0,
          amount_at_risk: totalCosts - contractValue,
          currency: r.currency,
          auto_generated: true,
        });
      } else if (margin < lowMarginThreshold) {
        exceptions.push({
          exception_type: 'low_margin',
          severity: margin < 5 ? 'warning' : 'info',
          entity: 'export',
          linked_type: 'export_order',
          linked_id: r.id,
          linked_ref: r.order_no,
          title: `Low margin on ${r.order_no}: ${margin.toFixed(2)}%`,
          description: `Contract value: ${r.currency} ${contractValue.toFixed(2)}, Total costs: ${r.currency} ${totalCosts.toFixed(2)}. Margin is below ${lowMarginThreshold}% threshold.`,
          metric_value: parseFloat(margin.toFixed(2)),
          threshold_value: lowMarginThreshold,
          amount_at_risk: contractValue * (lowMarginThreshold / 100) - (contractValue - totalCosts),
          currency: r.currency,
          auto_generated: true,
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
      .havingRaw('COALESCE(SUM(ir.reserved_qty), 0) < eo.qty_mt');

    return rows.map((r) => {
      const shortfall = parseFloat(r.qty_mt) - parseFloat(r.reserved_qty);
      return {
        exception_type: 'stock_shortage',
        severity: shortfall >= parseFloat(r.qty_mt) ? 'warning' : 'info',
        entity: 'export',
        linked_type: 'export_order',
        linked_id: r.id,
        linked_ref: r.order_no,
        title: `Stock shortage for ${r.order_no}: ${shortfall.toFixed(2)} MT unreserved`,
        description: `Order requires ${parseFloat(r.qty_mt).toFixed(2)} MT, only ${parseFloat(r.reserved_qty).toFixed(2)} MT reserved. Status: ${r.status}.`,
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
              description: `Estimated: ${r.currency} ${est.toFixed(2)}, Actual: ${r.currency} ${act.toFixed(2)}. Variance: ${(act - est).toFixed(2)} (${variancePct.toFixed(1)}%).`,
              metric_value: parseFloat(variancePct.toFixed(2)),
              threshold_value: 20,
              amount_at_risk: act - est,
              currency: r.currency,
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
        'mb.raw_qty_mt',
        'mb.actual_finished_mt'
      );

    return rows.map((r) => {
      const gap = parseFloat(r.expected_yield_pct) - parseFloat(r.yield_pct);
      const lostMT = (gap / 100) * parseFloat(r.raw_qty_mt);
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
      db('exception_inbox')
        .whereIn('status', ['Open', 'Acknowledged', 'In Progress', 'Escalated'])
        .select(db.raw('COALESCE(SUM(amount_at_risk), 0) as total_at_risk'))
        .first(),
    ]);

    return {
      byStatus: byStatus.reduce((acc, r) => { acc[r.status] = parseInt(r.count, 10); return acc; }, {}),
      bySeverity: bySeverity.reduce((acc, r) => { acc[r.severity] = parseInt(r.count, 10); return acc; }, {}),
      byType: byType.reduce((acc, r) => { acc[r.exception_type] = parseInt(r.count, 10); return acc; }, {}),
      totalAmountAtRisk: parseFloat(amountAtRisk.total_at_risk),
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
    if (order.status === 'Awaiting Advance' || order.status === 'Awaiting Balance') {
      const daysCreated = Math.floor((Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60 * 24));
      if (order.status === 'Awaiting Advance' && daysCreated > 14) {
        const score = 30;
        factors.push({ factor: 'Advance Payment Overdue', score, weight: 0.3, detail: `${daysCreated} days since order created, advance not received` });
        totalScore += score;
      }
      if (order.status === 'Awaiting Balance') {
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

    // Factor 2: Outstanding receivables
    const receivables = await db('receivables')
      .where({ customer_id: customerId })
      .whereIn('status', ['Pending', 'Partially Paid', 'Overdue'])
      .select(
        db.raw('COALESCE(SUM(outstanding), 0) as total_outstanding'),
        db.raw('COALESCE(SUM(expected_amount), 0) as total_expected')
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
      db('risk_scores')
        .select(db.raw('COALESCE(SUM(financial_exposure), 0) as total'))
        .first(),
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
      totalFinancialExposure: parseFloat(totalExposure.total),
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
    for (const c of actualCosts) {
      actualCostMap[c.category] = parseFloat(c.amount);
      totalActual += parseFloat(c.amount);
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
      const cv = parseFloat(order.contract_value);
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
        recommendations.push(`Investigate ${f.category} cost increase: actual ${order.currency} ${f.actual.toFixed(2)} vs estimated ${order.currency} ${f.expected.toFixed(2)}. Consider renegotiating or finding alternative providers.`);
      }
    }
    if (totalVariance > 0) {
      recommendations.push('Review pricing formula to account for recent cost increases.');
      recommendations.push('Consider building a larger contingency buffer into future quotations.');
    }

    const contractValue = parseFloat(order.contract_value);
    const estimatedMargin = totalEstimated > 0 ? ((contractValue - totalEstimated) / contractValue * 100) : 0;
    const actualMargin = totalActual > 0 ? ((contractValue - totalActual) / contractValue * 100) : 0;

    const [record] = await db('root_cause_analyses').insert({
      analysis_type: 'margin_drop',
      linked_type: 'export_order',
      linked_id: orderId,
      linked_ref: order.order_no,
      summary: `Margin dropped from ${estimatedMargin.toFixed(2)}% (estimated) to ${actualMargin.toFixed(2)}% (actual) on ${order.order_no}. Total cost overrun: ${order.currency} ${totalVariance.toFixed(2)}.`,
      factors: JSON.stringify(factors),
      total_impact: totalVariance,
      currency: order.currency,
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
    for (const c of actualCosts) {
      actualCostMap[c.category] = parseFloat(c.amount);
      totalActual += parseFloat(c.amount);
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
      recommendations.push(`Top cost overrun: ${overruns[0].category} (+${order.currency} ${overruns[0].variance.toFixed(2)}). Review vendor contracts.`);
    }
    if (totalActual > totalEstimated) {
      recommendations.push(`Total cost overrun is ${order.currency} ${(totalActual - totalEstimated).toFixed(2)}. Update cost estimation models.`);
      recommendations.push('Schedule a cost review meeting with operations and procurement teams.');
    }

    const [record] = await db('root_cause_analyses').insert({
      analysis_type: 'cost_overrun',
      linked_type: 'export_order',
      linked_id: orderId,
      linked_ref: order.order_no,
      summary: `Cost analysis for ${order.order_no}: Estimated ${order.currency} ${totalEstimated.toFixed(2)}, Actual ${order.currency} ${totalActual.toFixed(2)}. Overrun: ${order.currency} ${(totalActual - totalEstimated).toFixed(2)}.`,
      factors: JSON.stringify(factors),
      total_impact: totalActual - totalEstimated,
      currency: order.currency,
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
    const rawQty = parseFloat(batch.raw_qty_mt);
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

    // Export KPIs
    const activeOrdersQ = db('export_orders').whereNotIn('status', ['Draft', 'Closed', 'Cancelled']);
    if (entity === 'mill') activeOrdersQ.where(db.raw('1 = 0')); // no export data for mill entity
    dateFilter(activeOrdersQ, 'created_at');
    const activeOrders = await activeOrdersQ.count('id as count').first();

    const contractValueQ = db('export_orders').whereNotIn('status', ['Draft', 'Cancelled']);
    if (entity === 'mill') contractValueQ.where(db.raw('1 = 0'));
    dateFilter(contractValueQ, 'created_at');
    const contractValue = await contractValueQ.sum('contract_value as total').first();

    const advancePendingQ = db('export_orders').where('status', 'Awaiting Advance');
    dateFilter(advancePendingQ, 'created_at');
    const advancePending = entity === 'mill'
      ? { total: 0 }
      : await advancePendingQ.select(db.raw('COALESCE(SUM(advance_expected - COALESCE(advance_received, 0)), 0) as total')).first();

    const balancePendingQ = db('export_orders').where('status', 'Awaiting Balance');
    dateFilter(balancePendingQ, 'created_at');
    const balancePending = entity === 'mill'
      ? { total: 0 }
      : await balancePendingQ.select(db.raw('COALESCE(SUM(balance_expected - COALESCE(balance_received, 0)), 0) as total')).first();

    const shipmentsInTransitQ = db('export_orders').where('status', 'Shipped');
    const shipmentsInTransit = entity === 'mill'
      ? { count: 0 }
      : await shipmentsInTransitQ.count('id as count').first();

    // Export profit (simple: contract_value - sum of costs)
    let exportProfitTotal = 0;
    if (entity !== 'mill') {
      const orders = await db('export_orders').whereNotIn('status', ['Draft', 'Cancelled']).select('id', 'contract_value');
      for (const o of orders) {
        const costs = await db('export_order_costs').where('order_id', o.id).sum('amount as total').first();
        const costTotal = parseFloat(costs?.total) || 0;
        if (costTotal > 0) exportProfitTotal += parseFloat(o.contract_value) - costTotal;
      }
    }
    const exportProfit = { total: exportProfitTotal };

    // Mill KPIs
    const activeBatchesQ = db('milling_batches').whereIn('status', ['Queued', 'In Progress', 'Processing']);
    const activeBatches = entity === 'export'
      ? { count: 0 }
      : await activeBatchesQ.count('id as count').first();

    const rawStockQ = db('inventory_lots').where('type', 'raw').where('entity', 'mill').where('status', 'Available');
    const rawStock = entity === 'export'
      ? { total: 0 }
      : await rawStockQ.sum('qty as total').first();

    const finishedStockQ = db('inventory_lots').where('type', 'finished').where('status', 'Available');
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

    // Finance KPIs
    const totalReceivables = await db('receivables')
      .whereIn('status', ['Pending', 'Partially Paid', 'Overdue'])
      .sum('outstanding as total')
      .first();

    const totalPayables = await db('payables')
      .whereIn('status', ['Pending', 'Partially Paid', 'Overdue'])
      .sum('outstanding as total')
      .first();

    const cashPosition = await db('bank_accounts')
      .where('is_active', true)
      .sum('current_balance as total')
      .first();

    // Collection rate: received / expected over active orders
    const collectionData = await db('export_orders')
      .whereNotIn('status', ['Draft', 'Cancelled'])
      .select(
        db.raw('COALESCE(SUM(advance_received), 0) + COALESCE(SUM(balance_received), 0) as total_received'),
        db.raw('COALESCE(SUM(contract_value), 0) as total_expected')
      )
      .first();
    const collectionRate = parseFloat(collectionData.total_expected) > 0
      ? (parseFloat(collectionData.total_received) / parseFloat(collectionData.total_expected)) * 100
      : 0;

    // Pipeline: orders by status with count and value
    const pipeline = await db('export_orders')
      .whereNotIn('status', ['Cancelled'])
      .select('status')
      .count('id as count')
      .sum('contract_value as total_value')
      .groupBy('status')
      .orderByRaw("CASE status WHEN 'Draft' THEN 1 WHEN 'Awaiting Advance' THEN 2 WHEN 'Advance Received' THEN 3 WHEN 'Procurement Pending' THEN 4 WHEN 'In Milling' THEN 5 WHEN 'Docs In Preparation' THEN 6 WHEN 'Awaiting Balance' THEN 7 WHEN 'Ready to Ship' THEN 8 WHEN 'Shipped' THEN 9 WHEN 'Arrived' THEN 10 WHEN 'Closed' THEN 11 ELSE 12 END");

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

    // Cost breakdown
    const costBreakdown = await db('export_order_costs')
      .select('category')
      .sum('amount as total')
      .groupBy('category')
      .orderBy('total', 'desc');

    // Receivables aging
    const aging = await db('receivables')
      .whereIn('status', ['Pending', 'Partially Paid', 'Overdue'])
      .select(
        db.raw("COALESCE(SUM(CASE WHEN aging BETWEEN 0 AND 30 THEN outstanding ELSE 0 END), 0) as \"0-30\""),
        db.raw("COALESCE(SUM(CASE WHEN aging BETWEEN 31 AND 60 THEN outstanding ELSE 0 END), 0) as \"31-60\""),
        db.raw("COALESCE(SUM(CASE WHEN aging BETWEEN 61 AND 90 THEN outstanding ELSE 0 END), 0) as \"61-90\""),
        db.raw("COALESCE(SUM(CASE WHEN aging > 90 THEN outstanding ELSE 0 END), 0) as \"90+\"")
      )
      .first();

    return {
      kpis: {
        activeOrders: parseInt(activeOrders.count, 10),
        totalContractValue: parseFloat(contractValue.total || 0),
        advancePending: parseFloat(advancePending.total || 0),
        balancePending: parseFloat(balancePending.total || 0),
        shipmentsInTransit: parseInt(shipmentsInTransit.count, 10),
        exportProfit: parseFloat(exportProfit.total || 0),
        activeBatches: parseInt(activeBatches.count, 10),
        rawStock: parseFloat(rawStock.total || 0),
        finishedStock: parseFloat(finishedStock.total || 0),
        millProfit: parseFloat(millProfit.total || 0),
        avgYield: parseFloat(parseFloat(avgYield.avg || 0).toFixed(2)),
        totalReceivables: parseFloat(totalReceivables.total || 0),
        totalPayables: parseFloat(totalPayables.total || 0),
        cashPosition: parseFloat(cashPosition.total || 0),
        collectionRate: parseFloat(collectionRate.toFixed(2)),
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
        receivablesAging: aging ? {
          '0-30': parseFloat(aging['0-30']),
          '31-60': parseFloat(aging['31-60']),
          '61-90': parseFloat(aging['61-90']),
          '90+': parseFloat(aging['90+']),
        } : { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
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
          .where('eo.status', 'Awaiting Balance')
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

      case 'lowMarginOrders':
        query = db('export_orders as eo')
          .leftJoin('customers as c', 'c.id', 'eo.customer_id')
          .leftJoin(
            db('export_order_costs').select('order_id').sum('amount as total_costs').groupBy('order_id').as('costs'),
            'costs.order_id', 'eo.id'
          )
          .whereNotIn('eo.status', ['Draft', 'Cancelled'])
          .where('eo.contract_value', '>', 0)
          .whereRaw('COALESCE(costs.total_costs, 0) > 0')
          .select(
            'eo.id', 'eo.order_no', 'eo.contract_value',
            db.raw('COALESCE(costs.total_costs, 0) as total_costs'),
            db.raw('ROUND(((eo.contract_value - COALESCE(costs.total_costs, 0)) / eo.contract_value * 100)::numeric, 2) as margin_pct'),
            'eo.currency', 'c.name as customer_name', 'eo.status'
          )
          .orderByRaw('((eo.contract_value - COALESCE(costs.total_costs, 0)) / eo.contract_value * 100) ASC');
        break;

      case 'activeBatches':
        query = db('milling_batches as mb')
          .leftJoin('export_orders as eo', 'eo.id', 'mb.linked_export_order_id')
          .whereIn('mb.status', ['Queued', 'In Progress', 'Processing'])
          .select(
            'mb.id', 'mb.batch_no', 'mb.status', 'mb.raw_qty_mt', 'mb.planned_finished_mt',
            'mb.supplier_name', 'eo.order_no as linked_order'
          )
          .orderBy('mb.created_at', 'desc');
        break;

      case 'totalReceivables':
        query = db('receivables as r')
          .leftJoin('customers as c', 'c.id', 'r.customer_id')
          .leftJoin('export_orders as eo', 'eo.id', 'r.order_id')
          .whereIn('r.status', ['Pending', 'Partially Paid', 'Overdue'])
          .select(
            'r.id', 'r.recv_no', 'r.type', 'r.expected_amount', 'r.received_amount',
            'r.outstanding', 'r.due_date', 'r.aging', 'r.currency', 'r.status',
            'c.name as customer_name', 'eo.order_no'
          )
          .orderBy('r.aging', 'desc');
        break;

      case 'totalPayables':
        query = db('payables as p')
          .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
          .whereIn('p.status', ['Pending', 'Partially Paid', 'Overdue'])
          .select(
            'p.id', 'p.pay_no', 'p.category', 'p.original_amount', 'p.paid_amount',
            'p.outstanding', 'p.due_date', 'p.aging', 'p.currency', 'p.status',
            's.name as supplier_name', 'p.linked_ref'
          )
          .orderBy('p.aging', 'desc');
        break;

      default:
        return { data: [], pagination: { page: 1, limit, total: 0, totalPages: 0 }, message: `Unknown KPI: ${kpiName}` };
    }

    if (dateFrom) query.where(db.raw('1=1')); // dateFrom filter placeholder
    if (dateTo) query.where(db.raw('1=1'));

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
