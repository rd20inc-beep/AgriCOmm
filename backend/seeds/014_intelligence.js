/**
 * Seed: Intelligence Dashboard & Exception System (Phase 12)
 * Exception inbox, risk scores, root cause analyses, dashboard snapshots.
 */

exports.seed = async function (knex) {
  // Clear in reverse-dependency order
  await knex('dashboard_snapshots').del();
  await knex('root_cause_analyses').del();
  await knex('risk_scores').del();
  await knex('exception_inbox').del();

  // Look up referenced entities
  const users = await knex('users').select('id', 'full_name').limit(5);
  const userId1 = users[0] ? users[0].id : 1;
  const userId2 = users[1] ? users[1].id : userId1;
  const userId3 = users[2] ? users[2].id : userId1;

  const orders = await knex('export_orders').select('id', 'order_no', 'customer_id', 'contract_value', 'currency').orderBy('id').limit(10);
  const orderMap = {};
  for (const o of orders) {
    orderMap[o.order_no] = o;
  }

  const batches = await knex('milling_batches').select('id', 'batch_no').orderBy('id').limit(10);
  const batchMap = {};
  for (const b of batches) {
    batchMap[b.batch_no] = b;
  }

  const customers = await knex('customers').select('id', 'name').limit(5);
  const customerId1 = customers[0] ? customers[0].id : 1;
  const customerId2 = customers[1] ? customers[1].id : 2;
  const customerId3 = customers[2] ? customers[2].id : 3;

  // Helper to safely get order/batch IDs
  const oid = (ref) => orderMap[ref] ? orderMap[ref].id : 1;
  const bid = (ref) => batchMap[ref] ? batchMap[ref].id : 1;

  // =========================================================================
  // 1. Exception Inbox — 15 exceptions
  // =========================================================================
  await knex('exception_inbox').insert([
    // === 3 CRITICAL ===
    {
      exception_type: 'overdue_advance',
      severity: 'critical',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-104'),
      linked_ref: 'EX-104',
      title: 'Advance payment overdue 28 days on EX-104',
      description: 'Order EX-104 (Germany, IRRI-6 White Rice) has been awaiting advance for 28 days. Expected: USD 3,600.00, Received: USD 0.00. Customer has not responded to payment reminders.',
      metric_value: 28,
      threshold_value: 14,
      amount_at_risk: 3600.00,
      currency: 'USD',
      assigned_to: userId2,
      status: 'Open',
      auto_generated: true,
      created_at: '2026-03-18 08:00:00',
    },
    {
      exception_type: 'negative_margin',
      severity: 'critical',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-106'),
      linked_ref: 'EX-106',
      title: 'Negative margin on EX-106: -17.48%',
      description: 'Contract value: USD 30,750.00, Total costs: USD 25,375.00 allocated + USD 10,750 additional freight surcharge. Effective margin is negative. Freight cost spike due to Red Sea diversions.',
      metric_value: -17.48,
      threshold_value: 0,
      amount_at_risk: 5375.00,
      currency: 'USD',
      assigned_to: userId1,
      status: 'Escalated',
      auto_generated: true,
      created_at: '2026-03-17 10:30:00',
    },
    {
      exception_type: 'qc_failure',
      severity: 'critical',
      entity: 'mill',
      linked_type: 'milling_batch',
      linked_id: bid('M-205'),
      linked_ref: 'M-205',
      title: 'QC variance detected on batch M-205',
      description: 'Moisture variance: 0.30%, Broken variance: 0.20% between sample and arrival analysis. Batch for EX-106 Senegal order. Broken percentage above customer specification.',
      metric_value: 2.50,
      threshold_value: 1.00,
      amount_at_risk: 49000.00,
      currency: 'USD',
      assigned_to: userId3,
      status: 'In Progress',
      auto_generated: true,
      created_at: '2026-03-16 14:00:00',
    },

    // === 6 WARNING ===
    {
      exception_type: 'overdue_balance',
      severity: 'warning',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-102'),
      linked_ref: 'EX-102',
      title: 'Balance payment outstanding on EX-102: USD 10,600.00',
      description: 'Order EX-102 (Saudi Arabia) has outstanding balance of USD 10,600.00 pending for 22 days. Documents partially prepared.',
      metric_value: 22,
      threshold_value: 30,
      amount_at_risk: 10600.00,
      currency: 'USD',
      assigned_to: userId2,
      status: 'Open',
      auto_generated: true,
      created_at: '2026-03-19 09:00:00',
    },
    {
      exception_type: 'missing_documents',
      severity: 'warning',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-106'),
      linked_ref: 'EX-106',
      title: '5 required document(s) missing on EX-106 — ETA in 21 days',
      description: 'Missing documents: BL Draft, BL Final, Packing List, Certificate of Origin, Fumigation Certificate. Shipment ETA: 2026-04-10.',
      metric_value: 5,
      threshold_value: 0,
      amount_at_risk: 30750.00,
      currency: 'USD',
      status: 'Open',
      auto_generated: true,
      created_at: '2026-03-19 09:00:00',
    },
    {
      exception_type: 'low_margin',
      severity: 'warning',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-105'),
      linked_ref: 'EX-105',
      title: 'Low margin on EX-105: 7.22%',
      description: 'Contract value: USD 21,600.00, Total costs: USD 11,400.00. Margin of 7.22% is below 10% threshold. Rice procurement costs higher than estimated.',
      metric_value: 7.22,
      threshold_value: 10,
      amount_at_risk: 600.00,
      currency: 'USD',
      status: 'Acknowledged',
      auto_generated: true,
      created_at: '2026-03-18 09:00:00',
    },
    {
      exception_type: 'delayed_shipment',
      severity: 'warning',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-101'),
      linked_ref: 'EX-101',
      title: 'Shipment arrival overdue 5 days on EX-101',
      description: 'Expected arrival: 2026-03-15, vessel MV Atlantic Star has not arrived at Jebel Ali, Dubai. Possible port congestion.',
      metric_value: 5,
      threshold_value: 0,
      amount_at_risk: 26000.00,
      currency: 'USD',
      status: 'Open',
      auto_generated: true,
      created_at: '2026-03-20 08:00:00',
    },
    {
      exception_type: 'stock_shortage',
      severity: 'warning',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-107'),
      linked_ref: 'EX-107',
      title: 'Stock shortage for EX-107: 20.00 MT unreserved',
      description: 'Order requires 20.00 MT Super Kernel Basmati, 0.00 MT reserved. Status: Procurement Pending. No finished stock available.',
      metric_value: 20.00,
      threshold_value: 0,
      amount_at_risk: 11600.00,
      currency: 'USD',
      status: 'Open',
      auto_generated: true,
      created_at: '2026-03-19 09:00:00',
    },
    {
      exception_type: 'yield_below_benchmark',
      severity: 'warning',
      entity: 'mill',
      linked_type: 'milling_batch',
      linked_id: bid('M-202'),
      linked_ref: 'M-202',
      title: 'Yield 3.0% below benchmark on batch M-202',
      description: 'Actual yield: 75.0%, Benchmark: 78.0% (C9 Parboiled). Lost output: ~3.90 MT. Higher-than-expected broken percentage.',
      metric_value: 75.0,
      threshold_value: 75.0,
      amount_at_risk: 1950.00,
      currency: 'USD',
      status: 'Open',
      auto_generated: true,
      created_at: '2026-03-18 11:00:00',
    },

    // === 6 INFO ===
    {
      exception_type: 'high_cost_variance',
      severity: 'info',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-103'),
      linked_ref: 'EX-103',
      title: 'Cost variance in "clearing" on EX-103: -20.0%',
      description: 'Estimated: USD 1,500.00, Actual: USD 1,200.00. Saving of USD 300.00 due to favorable clearing agent rate.',
      metric_value: -20.0,
      threshold_value: 20,
      amount_at_risk: 0,
      currency: 'USD',
      status: 'Resolved',
      resolution_notes: 'Favorable variance — no action needed.',
      resolved_by: userId1,
      resolved_at: '2026-03-19 15:00:00',
      auto_generated: true,
      created_at: '2026-03-17 09:00:00',
    },
    {
      exception_type: 'missing_documents',
      severity: 'info',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-110'),
      linked_ref: 'EX-110',
      title: '7 required document(s) missing on EX-110 — ETA in 51 days',
      description: 'Missing documents: all 7. Shipment ETA: 2026-05-10. Early stage — not urgent yet.',
      metric_value: 7,
      threshold_value: 0,
      amount_at_risk: 9750.00,
      currency: 'USD',
      status: 'Snoozed',
      snoozed_until: '2026-04-15',
      auto_generated: true,
      created_at: '2026-03-19 09:00:00',
    },
    {
      exception_type: 'stock_shortage',
      severity: 'info',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-105'),
      linked_ref: 'EX-105',
      title: 'Stock shortage for EX-105: 40.00 MT unreserved',
      description: 'Order requires 40.00 MT IRRI-6 Parboiled. Currently in milling — stock will be available after batch completion.',
      metric_value: 40.00,
      threshold_value: 0,
      amount_at_risk: 21600.00,
      currency: 'USD',
      status: 'Acknowledged',
      auto_generated: true,
      created_at: '2026-03-18 09:00:00',
    },
    {
      exception_type: 'low_margin',
      severity: 'info',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-103'),
      linked_ref: 'EX-103',
      title: 'Margin on EX-103 at 18.89% — within acceptable range',
      description: 'Contract value: USD 45,000.00. Total costs: USD 36,500.00. Margin is above threshold but noted for monitoring.',
      metric_value: 18.89,
      threshold_value: 10,
      amount_at_risk: 0,
      currency: 'USD',
      status: 'Resolved',
      resolution_notes: 'Margin is healthy. No action required.',
      resolved_by: userId1,
      resolved_at: '2026-03-18 16:00:00',
      auto_generated: true,
      created_at: '2026-03-17 09:00:00',
    },
    {
      exception_type: 'high_cost_variance',
      severity: 'info',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: oid('EX-101'),
      linked_ref: 'EX-101',
      title: 'Cost variance in "loading" on EX-101: -20.0%',
      description: 'Estimated: USD 1,000.00, Actual: USD 800.00. Favorable variance from efficient loading operations.',
      metric_value: -20.0,
      threshold_value: 20,
      amount_at_risk: 0,
      currency: 'USD',
      status: 'Resolved',
      resolution_notes: 'Favorable variance. Loading efficiency improved.',
      resolved_by: userId2,
      resolved_at: '2026-03-17 14:00:00',
      auto_generated: true,
      created_at: '2026-03-16 09:00:00',
    },
  ]);

  // =========================================================================
  // 2. Risk Scores — 5 records (3 orders, 2 customers)
  // =========================================================================
  await knex('risk_scores').insert([
    {
      entity_type: 'export_order',
      entity_id: oid('EX-104'),
      entity_ref: 'EX-104',
      risk_score: 75.00,
      risk_level: 'Critical',
      risk_factors: JSON.stringify([
        { factor: 'Advance Payment Overdue', score: 30, weight: 0.3, detail: '28 days since order created, advance not received' },
        { factor: 'Missing Documents', score: 45, weight: 0.15, detail: '7 required document(s) not fulfilled' },
      ]),
      financial_exposure: 18000.00,
      currency: 'USD',
      calculated_at: '2026-03-20 07:00:00',
    },
    {
      entity_type: 'export_order',
      entity_id: oid('EX-106'),
      entity_ref: 'EX-106',
      risk_score: 60.00,
      risk_level: 'High',
      risk_factors: JSON.stringify([
        { factor: 'Negative Margin', score: 40, weight: 0.4, detail: 'Margin is -17.48%' },
        { factor: 'Missing Documents', score: 15, weight: 0.15, detail: '5 required document(s) not fulfilled' },
        { factor: 'Customer History Risk', score: 5, weight: 0.05, detail: 'New customer, limited payment history' },
      ]),
      financial_exposure: 24600.00,
      currency: 'USD',
      calculated_at: '2026-03-20 07:00:00',
    },
    {
      entity_type: 'export_order',
      entity_id: oid('EX-102'),
      entity_ref: 'EX-102',
      risk_score: 35.00,
      risk_level: 'Medium',
      risk_factors: JSON.stringify([
        { factor: 'Balance Payment Outstanding', score: 25, weight: 0.25, detail: 'USD 10,600.00 balance outstanding' },
        { factor: 'Low Margin', score: 10, weight: 0.1, detail: 'Margin below average' },
      ]),
      financial_exposure: 10600.00,
      currency: 'USD',
      calculated_at: '2026-03-20 07:00:00',
    },
    {
      entity_type: 'customer',
      entity_id: customerId3,
      entity_ref: customers[2] ? customers[2].name : 'Customer 3',
      risk_score: 55.00,
      risk_level: 'High',
      risk_factors: JSON.stringify([
        { factor: 'Slow Payment History', score: 30, weight: 0.3, detail: 'Average balance payment takes 45 days' },
        { factor: 'Multiple Overdue Instances', score: 20, weight: 0.2, detail: '2 overdue payments recorded' },
        { factor: 'Below-Average Profitability', score: 10, weight: 0.1, detail: 'Average margin 9.94%' },
      ]),
      financial_exposure: 33750.00,
      currency: 'USD',
      calculated_at: '2026-03-20 07:00:00',
    },
    {
      entity_type: 'customer',
      entity_id: customerId1,
      entity_ref: customers[0] ? customers[0].name : 'Customer 1',
      risk_score: 15.00,
      risk_level: 'Low',
      risk_factors: JSON.stringify([
        { factor: 'Good Payment History', score: 0, weight: 0.3, detail: 'Average balance payment 22 days, on time' },
        { factor: 'Moderate Concentration', score: 15, weight: 0.15, detail: '30% of all orders from this customer' },
      ]),
      financial_exposure: 0,
      currency: 'USD',
      calculated_at: '2026-03-20 07:00:00',
    },
  ]);

  // =========================================================================
  // 3. Root Cause Analyses — 3 records
  // =========================================================================
  await knex('root_cause_analyses').insert([
    {
      analysis_type: 'margin_drop',
      linked_type: 'export_order',
      linked_id: oid('EX-106'),
      linked_ref: 'EX-106',
      summary: 'Margin dropped from estimated 17.5% to actual -17.48% on EX-106. Total cost overrun: USD 10,750.00. Primary driver is freight cost spike due to Red Sea shipping route diversions.',
      factors: JSON.stringify([
        { category: 'freight', expected: 4500, actual: 10750, variance: 6250, impact_pct: 58.1, explanation: 'Freight cost 138% above estimate due to Red Sea diversions and container shortage' },
        { category: 'rice', expected: 16500, actual: 18200, variance: 1700, impact_pct: 15.8, explanation: 'Rice procurement cost 10.3% higher than budgeted due to seasonal price increase' },
        { category: 'bags', expected: 1875, actual: 2100, variance: 225, impact_pct: 2.1, explanation: 'Bag cost increased 12% due to polypropylene shortage' },
        { category: 'clearing', expected: 900, actual: 1050, variance: 150, impact_pct: 1.4, explanation: 'Clearing charges slightly above estimate' },
        { category: 'loading', expected: 1100, actual: 1100, variance: 0, impact_pct: 0, explanation: 'Loading on budget' },
        { category: 'misc', expected: 500, actual: 475, variance: -25, impact_pct: -0.2, explanation: 'Misc costs slightly under budget' },
      ]),
      total_impact: 8300.00,
      currency: 'USD',
      recommendations: JSON.stringify([
        'Investigate freight cost increase: actual USD 10,750 vs estimated USD 4,500. Consider renegotiating or finding alternative shipping lines.',
        'Review pricing formula to account for recent cost increases.',
        'Consider building a larger contingency buffer (5-8%) into future quotations for West Africa routes.',
        'Lock in freight rates early using forward contracts for Q2 2026 shipments.',
      ]),
      created_by: userId1,
      created_at: '2026-03-19 14:00:00',
    },
    {
      analysis_type: 'yield_loss',
      linked_type: 'milling_batch',
      linked_id: bid('M-205'),
      linked_ref: 'M-205',
      summary: 'Yield loss analysis for batch M-205: Actual 75.3% vs Benchmark 78.0%. Gap: 2.7%. Lost output: ~2.65 MT. High moisture at intake and extended machine downtime contributed.',
      factors: JSON.stringify([
        { category: 'High Moisture', expected: 13.0, actual: 13.8, variance: 0.8, impact_pct: 35, explanation: 'Moisture 13.8% exceeded max 13.0% by 0.80%. Causes additional drying loss and reduced head rice recovery.' },
        { category: 'Foreign Matter', expected: 0.5, actual: 0.8, variance: 0.3, impact_pct: 15, explanation: 'Foreign matter at 0.8% is above 0.5% tolerance. Direct yield reduction.' },
        { category: 'Machine Downtime', expected: 0, actual: 45, variance: 45, impact_pct: 25, explanation: '45 minutes of downtime due to belt replacement, impacting ~0.8 MT throughput.' },
        { category: 'Shift Performance', expected: 76.5, actual: 75.3, variance: -1.2, impact_pct: 10, explanation: 'Batch yield 75.3% is 1.2% below average for Night shift (avg 76.5%).' },
      ]),
      total_impact: 1325.00,
      currency: 'USD',
      recommendations: JSON.stringify([
        'Yield gap of 2.7% resulted in ~2.65 MT lost output.',
        'Enforce stricter moisture limits at GRN. Consider additional drying before milling.',
        'Improve foreign matter screening at intake. Install additional pre-cleaner.',
        'Review machine maintenance schedule. Belt was due for replacement.',
        'Compare operator performance across shifts to identify training needs.',
      ]),
      created_by: userId3,
      created_at: '2026-03-18 16:30:00',
    },
    {
      analysis_type: 'payment_delay',
      linked_type: 'export_order',
      linked_id: oid('EX-104'),
      linked_ref: 'EX-104',
      summary: 'Payment delay analysis for EX-104 (Germany). Advance of USD 3,600 pending 28 days. Customer is new with no payment history. Documents not yet prepared as advance not received.',
      factors: JSON.stringify([
        { category: 'Customer Payment Pattern', expected: 14, actual: 0, variance: -14, impact_pct: 30, explanation: 'New customer — no payment history. First order from Germany market.' },
        { category: 'Advance Payment Timeline', expected: 14, actual: 28, variance: 14, impact_pct: 40, explanation: 'Advance still pending after 28 days. Customer cited internal approval delays.' },
        { category: 'Document Delays', expected: 0, actual: 7, variance: 7, impact_pct: 15, explanation: '7 document(s) not yet approved — docs not started as advance not received.' },
        { category: 'Outstanding Balance', expected: 14400, actual: 0, variance: -14400, impact_pct: 15, explanation: 'Balance outstanding: USD 14,400.00 of USD 14,400.00. Full balance pending.' },
      ]),
      total_impact: 18000.00,
      currency: 'USD',
      recommendations: JSON.stringify([
        'Customer is new with no payment track record. Consider requiring LC/bank guarantee.',
        'Expedite follow-up: send formal payment demand letter via email and registered post.',
        'Engage local agent in Germany to facilitate payment release.',
        'Set deadline: if advance not received by 2026-04-01, consider cancelling or reallocating stock.',
        'Escalate to finance manager for collection follow-up.',
      ]),
      created_by: userId2,
      created_at: '2026-03-19 11:00:00',
    },
  ]);

  // =========================================================================
  // 4. Dashboard Snapshots — 2 records (yesterday and today)
  // =========================================================================
  await knex('dashboard_snapshots').insert([
    {
      snapshot_date: '2026-03-19',
      entity: null,
      metrics: JSON.stringify({
        activeOrders: 7,
        totalContractValue: 198350,
        advancePending: 3600,
        balancePending: 10600,
        shipmentsInTransit: 1,
        exportProfit: 15200,
        activeBatches: 2,
        rawStock: 145.50,
        finishedStock: 88.20,
        millProfit: 3250000,
        avgYield: 74.8,
        totalReceivables: 55400,
        totalPayables: 32100,
        cashPosition: 125000,
        collectionRate: 62.5,
      }),
      created_at: '2026-03-19 23:59:00',
    },
    {
      snapshot_date: '2026-03-20',
      entity: null,
      metrics: JSON.stringify({
        activeOrders: 7,
        totalContractValue: 198350,
        advancePending: 3600,
        balancePending: 10600,
        shipmentsInTransit: 1,
        exportProfit: 15200,
        activeBatches: 2,
        rawStock: 142.30,
        finishedStock: 91.50,
        millProfit: 3280000,
        avgYield: 75.0,
        totalReceivables: 54200,
        totalPayables: 31800,
        cashPosition: 126500,
        collectionRate: 63.1,
      }),
      created_at: '2026-03-20 08:00:00',
    },
  ]);
};
