/**
 * Seed: Control Systems & Operational Intelligence (Phase 11)
 * Approval queue, margin analysis, supplier scores, customer scores,
 * mill performance, stock counts, pricing simulations.
 */

exports.seed = async function (knex) {
  // Clear in reverse-dependency order
  await knex('pricing_simulations').del();
  await knex('stock_count_items').del();
  await knex('stock_counts').del();
  await knex('mill_performance').del();
  await knex('customer_scores').del();
  await knex('supplier_scores').del();
  await knex('margin_analysis').del();
  await knex('approval_queue').del();

  // Look up referenced entities
  const users = await knex('users').select('id', 'full_name').limit(5);
  const userId1 = users[0] ? users[0].id : 1;
  const userId2 = users[1] ? users[1].id : userId1;
  const userId3 = users[2] ? users[2].id : userId1;

  const orders = await knex('export_orders').select('id', 'order_no').orderBy('id').limit(5);
  const orderId1 = orders[0] ? orders[0].id : 1;
  const orderId2 = orders[1] ? orders[1].id : 2;
  const orderId3 = orders[2] ? orders[2].id : 3;

  const suppliers = await knex('suppliers').select('id', 'name').limit(5);
  const supplierId1 = suppliers[0] ? suppliers[0].id : 1;
  const supplierId2 = suppliers[1] ? suppliers[1].id : 2;
  const supplierId3 = suppliers[2] ? suppliers[2].id : 3;

  const customers = await knex('customers').select('id', 'name').limit(5);
  const customerId1 = customers[0] ? customers[0].id : 1;
  const customerId2 = customers[1] ? customers[1].id : 2;
  const customerId3 = customers[2] ? customers[2].id : 3;

  const mills = await knex('mills').select('id', 'name').limit(2);
  const millId1 = mills[0] ? mills[0].id : 1;
  const millId2 = mills[1] ? mills[1].id : 2;

  const warehouses = await knex('warehouses').select('id', 'name').limit(2);
  const warehouseId1 = warehouses[0] ? warehouses[0].id : 1;

  const products = await knex('products').select('id', 'name', 'code').limit(5);
  const productId1 = products[0] ? products[0].id : 1;
  const productId2 = products[1] ? products[1].id : 2;

  const lots = await knex('inventory_lots').select('id', 'lot_no', 'item_name', 'qty').limit(5);

  // =========================================================================
  // 1. Approval Queue — 5 items
  // =========================================================================
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await knex('approval_queue').insert([
    {
      approval_type: 'payment_confirmation',
      entity_type: 'export_order',
      entity_id: orderId1,
      entity_ref: 'EX-101',
      requested_by: userId1,
      current_data: JSON.stringify({ balance_received: 0 }),
      proposed_data: JSON.stringify({ balance_received: 20800 }),
      amount: 20800.00,
      currency: 'USD',
      status: 'Pending',
      priority: 'High',
      notes: 'Balance payment received via TT from Al Ghurair Foods. Ref: SWIFT-AE20260315.',
      expires_at: expiresAt,
    },
    {
      approval_type: 'payment_confirmation',
      entity_type: 'export_order',
      entity_id: orderId2,
      entity_ref: 'EX-102',
      requested_by: userId2,
      current_data: JSON.stringify({ advance_received: 0 }),
      proposed_data: JSON.stringify({ advance_received: 2650 }),
      amount: 2650.00,
      currency: 'USD',
      status: 'Pending',
      priority: 'Normal',
      notes: 'Advance payment received via LC confirmation. Bank ref: MCB-2026-0312.',
      expires_at: expiresAt,
    },
    {
      approval_type: 'stock_adjustment',
      entity_type: 'inventory_lot',
      entity_id: lots[0] ? lots[0].id : 1,
      entity_ref: lots[0] ? lots[0].lot_no : 'LOT-20260301-0001',
      requested_by: userId1,
      requested_at: '2026-03-10 09:00:00',
      current_data: JSON.stringify({ qty: 45.5 }),
      proposed_data: JSON.stringify({ qty: 44.2 }),
      amount: 650.00,
      currency: 'USD',
      status: 'Approved',
      approved_by: userId2,
      approved_at: '2026-03-10 14:30:00',
      priority: 'Normal',
      notes: 'Moisture loss during storage. Verified by warehouse supervisor.',
    },
    {
      approval_type: 'internal_transfer',
      entity_type: 'internal_transfer',
      entity_id: 1,
      entity_ref: 'IT-001',
      requested_by: userId2,
      requested_at: '2026-03-08 11:00:00',
      current_data: JSON.stringify({ from_warehouse: 'Mill Raw Stock', qty: 20 }),
      proposed_data: JSON.stringify({ to_warehouse: 'Export Dispatch', qty: 20 }),
      amount: 10000.00,
      currency: 'USD',
      status: 'Rejected',
      approved_by: userId1,
      approved_at: '2026-03-08 16:00:00',
      rejection_reason: 'Export order EX-104 advance payment not yet received. Cannot dispatch goods.',
      priority: 'High',
      notes: 'Transfer for EX-104 Germany shipment.',
    },
    {
      approval_type: 'quality_override',
      entity_type: 'milling_batch',
      entity_id: 1,
      entity_ref: 'M-201',
      requested_by: userId3,
      current_data: JSON.stringify({ moisture: 14.2, broken: 8.5, grade: 'B' }),
      proposed_data: JSON.stringify({ moisture: 13.8, broken: 7.2, grade: 'A' }),
      amount: null,
      currency: null,
      status: 'Pending',
      priority: 'Urgent',
      notes: 'Re-test shows lower moisture after 48hr stabilization. Requesting grade upgrade from B to A.',
      expires_at: expiresAt,
    },
  ]);

  // =========================================================================
  // 2. Margin Analysis — 3 orders
  // =========================================================================
  await knex('margin_analysis').insert([
    {
      order_id: orderId1,
      analysis_date: '2026-03-15',
      estimated_revenue: 26000.00,
      actual_revenue: 26000.00,
      estimated_costs: JSON.stringify({ rice: 13000, bags: 1250, loading: 1000, clearing: 750, freight: 3250, misc: 500 }),
      actual_costs: JSON.stringify({ rice: 13000, bags: 1250, loading: 800, clearing: 650, freight: 3200, misc: 400 }),
      estimated_margin_pct: 24.04,
      actual_margin_pct: 25.38,
      variance_amount: 350.00,
      variance_pct: 1.35,
      fx_rate_booked: 278.5000,
      fx_rate_actual: 280.2500,
      fx_gain_loss: 162.37,
      risk_flags: JSON.stringify([]),
    },
    {
      order_id: orderId2,
      analysis_date: '2026-03-15',
      estimated_revenue: 13250.00,
      actual_revenue: 2650.00,
      estimated_costs: JSON.stringify({ rice: 6500, bags: 625, loading: 500, clearing: 375, freight: 0, misc: 200 }),
      actual_costs: JSON.stringify({ rice: 6500, bags: 625, loading: 400, clearing: 350, freight: 0, misc: 200 }),
      estimated_margin_pct: 38.11,
      actual_margin_pct: -205.09,
      variance_amount: -7975.00,
      variance_pct: -60.19,
      fx_rate_booked: 279.0000,
      fx_rate_actual: 280.2500,
      fx_gain_loss: 11.87,
      risk_flags: JSON.stringify(['negative_margin', 'outstanding_balance', 'high_variance']),
    },
    {
      order_id: orderId3,
      analysis_date: '2026-03-15',
      estimated_revenue: 45000.00,
      actual_revenue: 45000.00,
      estimated_costs: JSON.stringify({ rice: 24000, bags: 2500, loading: 2000, clearing: 1500, freight: 6500, misc: 1000 }),
      actual_costs: JSON.stringify({ rice: 24000, bags: 2500, loading: 1500, clearing: 1200, freight: 6500, misc: 800 }),
      estimated_margin_pct: 16.67,
      actual_margin_pct: 18.89,
      variance_amount: 1000.00,
      variance_pct: 2.22,
      fx_rate_booked: 277.0000,
      fx_rate_actual: 280.2500,
      fx_gain_loss: 522.08,
      risk_flags: JSON.stringify(['fx_gain']),
    },
  ]);

  // =========================================================================
  // 3. Supplier Scores — 3 suppliers
  // =========================================================================
  await knex('supplier_scores').insert([
    {
      supplier_id: supplierId1,
      period_start: '2026-01-01',
      period_end: '2026-03-31',
      quality_score: 82.00,
      delivery_score: 90.00,
      price_score: 75.00,
      overall_score: 82.30,
      total_qty_mt: 320.50,
      total_value: 14500000.00,
      avg_moisture_variance: 0.80,
      avg_broken_variance: 0.50,
      rejection_pct: 2.10,
      avg_delivery_days: 1.5,
      batches_count: 8,
      grn_count: 12,
      notes: 'Consistent quality supplier. Minor moisture variance in February deliveries.',
    },
    {
      supplier_id: supplierId2,
      period_start: '2026-01-01',
      period_end: '2026-03-31',
      quality_score: 75.00,
      delivery_score: 70.00,
      price_score: 80.00,
      overall_score: 75.00,
      total_qty_mt: 180.00,
      total_value: 7800000.00,
      avg_moisture_variance: 1.50,
      avg_broken_variance: 1.20,
      rejection_pct: 5.00,
      avg_delivery_days: 3.0,
      batches_count: 5,
      grn_count: 7,
      notes: 'Competitive pricing but quality needs improvement. Two rejections in March.',
    },
    {
      supplier_id: supplierId3,
      period_start: '2026-01-01',
      period_end: '2026-03-31',
      quality_score: 68.00,
      delivery_score: 55.00,
      price_score: 85.00,
      overall_score: 69.70,
      total_qty_mt: 95.00,
      total_value: 3800000.00,
      avg_moisture_variance: 2.20,
      avg_broken_variance: 1.80,
      rejection_pct: 8.50,
      avg_delivery_days: 5.5,
      batches_count: 3,
      grn_count: 4,
      notes: 'Best prices but frequent delivery delays and quality issues. On probation.',
    },
  ]);

  // =========================================================================
  // 4. Customer Scores — 3 customers
  // =========================================================================
  await knex('customer_scores').insert([
    {
      customer_id: customerId1,
      period_start: '2026-01-01',
      period_end: '2026-03-31',
      payment_score: 90.00,
      profitability_score: 78.00,
      volume_score: 85.00,
      overall_score: 84.80,
      total_orders: 3,
      total_revenue: 74600.00,
      total_profit: 15200.00,
      avg_margin_pct: 20.38,
      avg_advance_days: 8.5,
      avg_balance_days: 22.0,
      overdue_count: 0,
      risk_level: 'Low',
    },
    {
      customer_id: customerId2,
      period_start: '2026-01-01',
      period_end: '2026-03-31',
      payment_score: 72.00,
      profitability_score: 65.00,
      volume_score: 60.00,
      overall_score: 66.55,
      total_orders: 2,
      total_revenue: 23000.00,
      total_profit: 3800.00,
      avg_margin_pct: 16.52,
      avg_advance_days: 12.0,
      avg_balance_days: 35.0,
      overdue_count: 1,
      risk_level: 'Medium',
    },
    {
      customer_id: customerId3,
      period_start: '2026-01-01',
      period_end: '2026-03-31',
      payment_score: 45.00,
      profitability_score: 55.00,
      volume_score: 90.00,
      overall_score: 59.75,
      total_orders: 4,
      total_revenue: 125800.00,
      total_profit: 12500.00,
      avg_margin_pct: 9.94,
      avg_advance_days: 18.0,
      avg_balance_days: 45.0,
      overdue_count: 2,
      risk_level: 'High',
    },
  ]);

  // =========================================================================
  // 5. Mill Performance — 2 records (Karachi & Hyderabad)
  // =========================================================================
  await knex('mill_performance').insert([
    {
      mill_id: millId1,
      period_start: '2026-01-01',
      period_end: '2026-03-31',
      batches_processed: 18,
      total_input_mt: 680.00,
      total_output_mt: 510.00,
      avg_yield_pct: 75.00,
      avg_broken_pct: 8.50,
      avg_bran_pct: 6.20,
      avg_cost_per_mt: 4500.00,
      total_downtime_hours: 42.50,
      utilization_pct: 85.00,
      total_electricity_cost: 1250000.00,
      total_labor_cost: 850000.00,
      currency: 'PKR',
    },
    {
      mill_id: millId2,
      period_start: '2026-01-01',
      period_end: '2026-03-31',
      batches_processed: 12,
      total_input_mt: 420.00,
      total_output_mt: 302.40,
      avg_yield_pct: 72.00,
      avg_broken_pct: 10.20,
      avg_bran_pct: 7.10,
      avg_cost_per_mt: 5200.00,
      total_downtime_hours: 68.00,
      utilization_pct: 78.00,
      total_electricity_cost: 920000.00,
      total_labor_cost: 620000.00,
      currency: 'PKR',
    },
  ]);

  // =========================================================================
  // 6. Stock Count — 1 completed count with 5 items (2 with variance)
  // =========================================================================
  const [stockCount] = await knex('stock_counts')
    .insert({
      count_no: 'SC-001',
      count_type: 'full',
      warehouse_id: warehouseId1,
      status: 'Completed',
      planned_date: '2026-03-15',
      started_at: '2026-03-15 08:00:00',
      completed_at: '2026-03-15 16:30:00',
      counted_by: userId2,
      approved_by: userId1,
      notes: 'Q1 2026 full warehouse stock count. 2 variances found and adjusted.',
      created_by: userId1,
    })
    .returning('id');

  const scId = typeof stockCount === 'object' ? stockCount.id : stockCount;

  // Build 5 stock count items (use real lots if available, otherwise fabricate)
  const countItems = [];
  for (let i = 0; i < 5; i++) {
    const lot = lots[i] || null;
    const systemQty = lot ? parseFloat(lot.qty) : [45.50, 30.00, 22.80, 18.50, 12.00][i];
    const itemName = lot ? lot.item_name : ['IRRI-6 Paddy', 'C9 Paddy', 'Super Basmati Paddy', 'Rice Bran', 'Rice Husk'][i];

    let countedQty, varianceQty, variancePct, varianceValue, status;

    if (i === 1) {
      // Item with negative variance (shortage)
      countedQty = systemQty - 1.20;
      varianceQty = -1.20;
      variancePct = systemQty > 0 ? (varianceQty / systemQty * 100) : 0;
      varianceValue = -600.00;
      status = 'Adjusted';
    } else if (i === 3) {
      // Item with positive variance (surplus)
      countedQty = systemQty + 0.50;
      varianceQty = 0.50;
      variancePct = systemQty > 0 ? (varianceQty / systemQty * 100) : 0;
      varianceValue = 250.00;
      status = 'Adjusted';
    } else {
      // No variance
      countedQty = systemQty;
      varianceQty = 0;
      variancePct = 0;
      varianceValue = 0;
      status = 'Approved';
    }

    countItems.push({
      stock_count_id: scId,
      lot_id: lot ? lot.id : null,
      item_name: itemName,
      system_qty: systemQty,
      counted_qty: Math.round(countedQty * 100) / 100,
      variance_qty: Math.round(varianceQty * 100) / 100,
      variance_pct: Math.round(variancePct * 100) / 100,
      variance_value: varianceValue,
      status,
      notes: varianceQty !== 0
        ? (varianceQty < 0 ? 'Shortage confirmed by re-count. Possible weighing error at intake.' : 'Surplus found. Likely under-reported bran output from batch M-203.')
        : null,
      counted_at: '2026-03-15 14:00:00',
    });
  }

  await knex('stock_count_items').insert(countItems);

  // =========================================================================
  // 7. Pricing Simulations — 2 simulations
  // =========================================================================
  await knex('pricing_simulations').insert([
    {
      name: 'IRRI-6 Parboiled — Q2 2026 Africa Export',
      product_id: productId1,
      qty_mt: 100.00,
      target_margin_pct: 18.00,
      raw_rice_cost_per_mt: 260.00,
      milling_cost_per_mt: 35.00,
      bags_cost_per_mt: 25.00,
      freight_cost_per_mt: 65.00,
      clearing_cost_per_mt: 18.00,
      other_costs_per_mt: 12.00,
      total_cost_per_mt: 415.00,
      minimum_selling_price: 506.10,
      recommended_price: 531.40,
      fx_rate: 280.2500,
      currency: 'USD',
      created_by: userId1,
    },
    {
      name: 'Super Basmati — Premium Middle East Export',
      product_id: productId2,
      qty_mt: 25.00,
      target_margin_pct: 22.00,
      raw_rice_cost_per_mt: 420.00,
      milling_cost_per_mt: 45.00,
      bags_cost_per_mt: 30.00,
      freight_cost_per_mt: 55.00,
      clearing_cost_per_mt: 20.00,
      other_costs_per_mt: 15.00,
      total_cost_per_mt: 585.00,
      minimum_selling_price: 750.00,
      recommended_price: 787.50,
      fx_rate: 280.2500,
      currency: 'USD',
      created_by: userId1,
    },
  ]);
};
