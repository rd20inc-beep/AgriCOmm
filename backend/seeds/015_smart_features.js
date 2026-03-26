/**
 * Seed: Smart Features — Competitive Intelligence Engine (Phase 13)
 * Cost predictions, scenarios, country doc requirements, predictive alerts.
 */

exports.seed = async function (knex) {
  // Clear in reverse-dependency order
  await knex('predictive_alerts').del();
  await knex('mobile_uploads').del();
  await knex('scenarios').del();
  await knex('cost_predictions').del();
  // country_doc_requirements are seeded in the migration; only re-seed if empty
  const existingDocs = await knex('country_doc_requirements').count('* as count').first();

  // Look up referenced entities
  const users = await knex('users').select('id', 'full_name').limit(5);
  const userId1 = users[0] ? users[0].id : 1;
  const userId2 = users[1] ? users[1].id : userId1;

  const products = await knex('products').select('id', 'name').where('is_active', true).limit(10);
  const productMap = {};
  for (const p of products) {
    productMap[p.name] = p;
  }

  // Find specific products or fallback
  const irri6 = products.find((p) => p.name.includes('IRRI-6') || p.name.includes('IRRI')) || products[0];
  const basmati = products.find((p) => p.name.includes('Basmati') || p.name.includes('Super Basmati')) || products[1] || products[0];
  const pk386 = products.find((p) => p.name.includes('PK-386') || p.name.includes('386')) || products[2] || products[0];

  const orders = await knex('export_orders').select('id', 'order_no', 'customer_id', 'product_id', 'product_name', 'country').orderBy('id').limit(10);
  const batches = await knex('milling_batches').select('id', 'batch_no', 'supplier_id', 'supplier_name').orderBy('id').limit(10);
  const customers = await knex('customers').select('id', 'name').limit(5);

  const oid = (idx) => orders[idx] ? orders[idx].id : 1;
  const oref = (idx) => orders[idx] ? orders[idx].order_no : `EX-${100 + idx}`;
  const bid = (idx) => batches[idx] ? batches[idx].id : 1;
  const bref = (idx) => batches[idx] ? batches[idx].batch_no : `M-${200 + idx}`;
  const custId = (idx) => customers[idx] ? customers[idx].id : 1;
  const custName = (idx) => customers[idx] ? customers[idx].name : `Customer ${idx + 1}`;

  // =========================================================================
  // 1. Cost Predictions — 3 products
  // =========================================================================
  await knex('cost_predictions').insert([
    {
      product_id: irri6 ? irri6.id : 1,
      product_name: irri6 ? irri6.name : 'IRRI-6 White Rice',
      prediction_date: '2026-03-20',
      predicted_raw_cost_per_mt: 85000.00,
      predicted_milling_cost_per_mt: 8500.00,
      predicted_bags_per_mt: 12.50,
      predicted_freight_per_mt: 9500.00,
      predicted_clearing_per_mt: 4200.00,
      predicted_total_cost_per_mt: 107200.00,
      predicted_min_sell_price: 440.00,
      confidence_pct: 82.00,
      data_points_used: 24,
      methodology: 'weighted_average',
      factors: JSON.stringify({
        exportCostEntries: 18,
        millingCostEntries: 6,
        fxRate: 280,
        lookbackMonths: 6,
        weightFormula: '1 + (6 - months_ago) * 0.3',
        marginTarget: '15%',
        recentTrend: 'stable',
      }),
    },
    {
      product_id: basmati ? basmati.id : 2,
      product_name: basmati ? basmati.name : 'Super Basmati',
      prediction_date: '2026-03-20',
      predicted_raw_cost_per_mt: 165000.00,
      predicted_milling_cost_per_mt: 12000.00,
      predicted_bags_per_mt: 18.00,
      predicted_freight_per_mt: 11000.00,
      predicted_clearing_per_mt: 5500.00,
      predicted_total_cost_per_mt: 193500.00,
      predicted_min_sell_price: 795.00,
      confidence_pct: 75.00,
      data_points_used: 14,
      methodology: 'weighted_average',
      factors: JSON.stringify({
        exportCostEntries: 10,
        millingCostEntries: 4,
        fxRate: 280,
        lookbackMonths: 6,
        weightFormula: '1 + (6 - months_ago) * 0.3',
        marginTarget: '15%',
        recentTrend: 'increasing',
        note: 'Basmati paddy prices rose 8% in last quarter',
      }),
    },
    {
      product_id: pk386 ? pk386.id : 3,
      product_name: pk386 ? pk386.name : 'PK-386',
      prediction_date: '2026-03-20',
      predicted_raw_cost_per_mt: 125000.00,
      predicted_milling_cost_per_mt: 10000.00,
      predicted_bags_per_mt: 15.00,
      predicted_freight_per_mt: 10200.00,
      predicted_clearing_per_mt: 4800.00,
      predicted_total_cost_per_mt: 150000.00,
      predicted_min_sell_price: 616.00,
      confidence_pct: 68.00,
      data_points_used: 9,
      methodology: 'weighted_average',
      factors: JSON.stringify({
        exportCostEntries: 6,
        millingCostEntries: 3,
        fxRate: 280,
        lookbackMonths: 6,
        weightFormula: '1 + (6 - months_ago) * 0.3',
        marginTarget: '15%',
        recentTrend: 'stable',
      }),
    },
  ]);

  // =========================================================================
  // 2. Scenarios — 2 saved scenarios
  // =========================================================================
  await knex('scenarios').insert([
    {
      name: `FOB vs CIF — ${irri6 ? irri6.name : 'IRRI-6'} to UAE`,
      scenario_type: 'fob_vs_cif',
      parameters: JSON.stringify({
        productId: irri6 ? irri6.id : 1,
        qtyMT: 500,
        pricePerMT: 420,
        destinationCountry: 'UAE',
        fxRate: 280,
      }),
      results: JSON.stringify({
        fob: {
          incoterm: 'FOB',
          pricePerMT: 420,
          totalRevenue: 210000,
          sellerFreight: 0,
          sellerInsurance: 0,
          netToSeller: 210000,
          cashFlowTiming: 'Faster — payment on BL release',
          riskLevel: 'Lower — risk transfers at port of loading',
        },
        cif: {
          incoterm: 'CIF',
          pricePerMT: 468,
          totalRevenue: 234000,
          sellerFreight: 20000,
          sellerInsurance: 4000,
          netToSeller: 210000,
          cashFlowTiming: 'Slower — payment after docs presented',
          riskLevel: 'Higher — risk until destination port',
        },
      }),
      comparison_data: JSON.stringify({
        freightPerMT: 40,
        insurancePerMT: 8,
        fxRate: 280,
      }),
      recommendation: 'FOB is recommended for this route. Net revenue is equivalent, but with lower risk exposure and faster cash flow.',
      created_by: userId1,
    },
    {
      name: `Supplier Comparison — ${basmati ? basmati.name : 'Super Basmati'} (3 suppliers)`,
      scenario_type: 'supplier_comparison',
      parameters: JSON.stringify({
        productId: basmati ? basmati.id : 2,
        qtyMT: 200,
        supplierIds: [1, 2, 3],
      }),
      results: JSON.stringify([
        {
          supplier: { id: 1, name: 'Punjab Rice Mills' },
          avgPricePerMT: 158000,
          qualityScore: 88.5,
          deliveryReliability: 92,
          overallScore: 87.3,
          qualityRisk: 'Low',
          deliveryRisk: 'Low',
        },
        {
          supplier: { id: 2, name: 'Sindh Agri Traders' },
          avgPricePerMT: 152000,
          qualityScore: 78.2,
          deliveryReliability: 80,
          overallScore: 74.1,
          qualityRisk: 'Medium',
          deliveryRisk: 'Medium',
        },
        {
          supplier: { id: 3, name: 'Karachi Rice Co' },
          avgPricePerMT: 162000,
          qualityScore: 92.1,
          deliveryReliability: 95,
          overallScore: 89.5,
          qualityRisk: 'Low',
          deliveryRisk: 'Low',
        },
      ]),
      comparison_data: JSON.stringify({
        bestPrice: 'Sindh Agri Traders at PKR 152,000/MT',
        bestQuality: 'Karachi Rice Co with 92.1 score',
        bestOverall: 'Karachi Rice Co with 89.5 overall',
      }),
      recommendation: 'Karachi Rice Co ranks highest overall (89.5) with best quality (92.1). Punjab Rice Mills is a strong alternative at better price. Sindh Agri Traders offers lowest price but medium quality risk.',
      created_by: userId1,
    },
  ]);

  // =========================================================================
  // 3. Country Doc Requirements — seed only if migration didn't already seed
  // =========================================================================
  if (parseInt(existingDocs.count) === 0) {
    const countries = [
      { country: 'UAE', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'fumigation'] },
      { country: 'Saudi Arabia', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'fumigation', 'saso_certificate'] },
      { country: 'Nigeria', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'nafdac_clearance'] },
      { country: 'Germany', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'eur1_certificate'] },
      { country: 'Singapore', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo'] },
      { country: 'Senegal', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'fumigation'] },
      { country: 'Oman', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'fumigation'] },
      { country: 'Kenya', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'kebs_clearance'] },
      { country: 'UK', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo'] },
      { country: 'Canada', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'cfia_clearance'] },
    ];

    const validationRulesMap = {
      phyto: JSON.stringify({ maxAgeDays: 14, requiresNotarization: false }),
      bl: JSON.stringify({ requiresOriginal: true }),
      invoice: JSON.stringify({ requiresSignature: true }),
      packing_list: JSON.stringify({ requiresSignature: true }),
      coo: JSON.stringify({ maxAgeDays: 30, requiresNotarization: true }),
      fumigation: JSON.stringify({ maxAgeDays: 21, requiresCertifiedOperator: true }),
      saso_certificate: JSON.stringify({ maxAgeDays: 60, requiresSASOApproval: true }),
      nafdac_clearance: JSON.stringify({ maxAgeDays: 90, requiresNAFDACNumber: true }),
      eur1_certificate: JSON.stringify({ maxAgeDays: 120, requiresEUAuthorization: true }),
      kebs_clearance: JSON.stringify({ maxAgeDays: 60, requiresKEBSInspection: true }),
      cfia_clearance: JSON.stringify({ maxAgeDays: 60, requiresCFIAInspection: true }),
    };

    const notesMap = {
      phyto: 'Phytosanitary certificate issued by Pakistan DPP',
      bl: 'Original bill of lading — 3/3 originals required',
      invoice: 'Commercial invoice with HS code and full product description',
      packing_list: 'Detailed packing list matching BL and invoice',
      coo: 'Certificate of Origin from Chamber of Commerce',
      fumigation: 'Fumigation certificate — methyl bromide or phosphine treatment',
      saso_certificate: 'Saudi Standards, Metrology and Quality Organization certificate',
      nafdac_clearance: 'National Agency for Food and Drug Administration and Control clearance',
      eur1_certificate: 'EUR.1 movement certificate for EU preferential tariff',
      kebs_clearance: 'Kenya Bureau of Standards pre-export verification of conformity',
      cfia_clearance: 'Canadian Food Inspection Agency import clearance',
    };

    const rows = [];
    for (const c of countries) {
      for (const doc of c.docs) {
        rows.push({
          country: c.country,
          incoterm: null,
          doc_type: doc,
          is_required: true,
          validation_rules: validationRulesMap[doc] || null,
          notes: notesMap[doc] || null,
        });
      }
    }

    for (let i = 0; i < rows.length; i += 20) {
      await knex('country_doc_requirements').insert(rows.slice(i, i + 20));
    }
  }

  // =========================================================================
  // 4. Predictive Alerts — 5 alerts
  // =========================================================================
  await knex('predictive_alerts').insert([
    // 2 margin risk alerts
    {
      alert_type: 'margin_risk',
      severity: 'critical',
      entity_type: 'export_order',
      entity_id: oid(0),
      entity_ref: oref(0),
      prediction: `Order ${oref(0)} margin is at 3.2% (costs are 96.8% of contract value). High risk of loss if any additional costs arise.`,
      confidence_pct: 88.00,
      recommended_action: 'Urgent: Review costs immediately. Renegotiate freight charges if possible. Consider holding shipment until costs are confirmed.',
      supporting_data: JSON.stringify({
        contractValue: 5880000,
        totalCost: 5691840,
        costRatio: 96.8,
        margin: 3.2,
        fxRate: 280,
        productName: orders[0] ? orders[0].product_name : 'IRRI-6',
      }),
      status: 'Active',
      expires_at: new Date('2026-04-03'),
    },
    {
      alert_type: 'margin_risk',
      severity: 'warning',
      entity_type: 'export_order',
      entity_id: oid(2),
      entity_ref: oref(2),
      prediction: `Order ${oref(2)} margin is at 12.5% (costs are 87.5% of contract value). Below target of 15%. Monitor closely.`,
      confidence_pct: 78.00,
      recommended_action: 'Monitor freight and clearing costs. Current margin is below 15% target but still positive.',
      supporting_data: JSON.stringify({
        contractValue: 4200000,
        totalCost: 3675000,
        costRatio: 87.5,
        margin: 12.5,
        fxRate: 280,
        productName: orders[2] ? orders[2].product_name : 'PK-386',
      }),
      status: 'Active',
      expires_at: new Date('2026-04-03'),
    },
    // 1 yield anomaly
    {
      alert_type: 'yield_anomaly',
      severity: 'warning',
      entity_type: 'milling_batch',
      entity_id: bid(1),
      entity_ref: bref(1),
      prediction: `Batch ${bref(1)} yield is 54.2%, which is 2.8 std deviations below the average of 62.1%. Significant underperformance.`,
      confidence_pct: 82.00,
      recommended_action: `Investigate quality of raw material. Supplier (${batches[1] ? batches[1].supplier_name : 'Supplier'}) may be delivering lower-quality paddy. Check moisture and broken content.`,
      supporting_data: JSON.stringify({
        actualYield: 54.2,
        expectedYield: 62.1,
        stdDeviation: -2.8,
        historicalBatches: 15,
        supplierName: batches[1] ? batches[1].supplier_name : 'Supplier',
        likelyCause: 'High moisture content in raw paddy (16.8% vs expected 13%)',
      }),
      status: 'Active',
      expires_at: new Date('2026-03-27'),
    },
    // 1 payment risk
    {
      alert_type: 'payment_risk',
      severity: 'warning',
      entity_type: 'customer',
      entity_id: custId(1),
      entity_ref: custName(1),
      prediction: `${custName(1)} has $42,500 USD outstanding across 2 receivables. Current aging (68 days) exceeds historical pattern (35 days). Payment delay is 33 days beyond normal.`,
      confidence_pct: 72.00,
      recommended_action: 'Contact customer for payment status. Consider tightening credit terms on next order. Require larger advance percentage.',
      supporting_data: JSON.stringify({
        totalOutstanding: 42500,
        currency: 'USD',
        currentAvgAging: 68,
        maxAging: 75,
        historicalAvgAging: 35,
        predictedDelay: 33,
        receivableCount: 2,
      }),
      status: 'Active',
      expires_at: new Date('2026-04-19'),
    },
    // 1 cost spike
    {
      alert_type: 'cost_spike',
      severity: 'warning',
      entity_type: 'cost_category',
      entity_id: null,
      entity_ref: 'freight',
      prediction: 'Freight costs have spiked 32% above the 3-month average. Recent avg: PKR 13,200/MT vs baseline: PKR 10,000/MT.',
      confidence_pct: 85.00,
      recommended_action: 'Review freight contracts. Renegotiate with shipping lines. 3 recent orders affected. Consider alternative shipping routes.',
      supporting_data: JSON.stringify({
        category: 'freight',
        baselineAvg: 10000,
        recentAvg: 13200,
        spikePct: 32,
        baselineEntries: 12,
        recentEntries: 4,
        affectedOrders: [
          { orderNo: oref(0), amount: 14500 },
          { orderNo: oref(1), amount: 12800 },
          { orderNo: oref(2), amount: 12300 },
        ],
      }),
      status: 'Active',
      expires_at: new Date('2026-04-03'),
    },
  ]);
};
