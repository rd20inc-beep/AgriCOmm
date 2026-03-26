const db = require('../config/database');

/**
 * Smart Service — Competitive Intelligence Engine (Phase 13)
 * Cost prediction, scenario simulation, document automation, mobile API, predictive insights.
 * All methods use real database queries against the RiceFlow ERP schema.
 */
const smartService = {
  // ═══════════════════════════════════════════════════════════════════════════
  // SMART COSTING ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Predict cost per MT for a product based on 6-month weighted historical data.
   */
  async predictCostPerMT(productId) {
    // 1. Get the product
    const product = await db('products').where({ id: productId }).first();
    if (!product) throw new Error(`Product ${productId} not found`);

    // 2. Get last 6 months of actual export order costs for this product
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const exportCosts = await db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .where('eo.product_id', productId)
      .where('eoc.created_at', '>=', sixMonthsAgo)
      .select(
        'eoc.category',
        'eoc.amount',
        'eo.qty_mt',
        'eoc.created_at'
      );

    // 3. Get milling costs for batches linked to this product's export orders
    const millingCosts = await db('milling_costs as mc')
      .join('milling_batches as mb', 'mc.batch_id', 'mb.id')
      .join('export_orders as eo', 'mb.linked_export_order_id', 'eo.id')
      .where('eo.product_id', productId)
      .where('mc.created_at', '>=', sixMonthsAgo)
      .select(
        'mc.category',
        'mc.amount',
        'mc.currency',
        'mb.raw_qty_mt',
        'mc.created_at'
      );

    // 4. Calculate weighted averages per cost category
    // Weight formula: month_weight = 1 + (6 - months_ago) * 0.3
    const now = new Date();
    const calcWeight = (dateVal) => {
      const d = new Date(dateVal);
      const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
      return 1 + (6 - Math.min(monthsAgo, 6)) * 0.3;
    };

    // Aggregate export costs per MT by category
    const costBuckets = {
      raw_material: { weightedSum: 0, totalWeight: 0, count: 0 },
      freight: { weightedSum: 0, totalWeight: 0, count: 0 },
      clearing: { weightedSum: 0, totalWeight: 0, count: 0 },
      bags: { weightedSum: 0, totalWeight: 0, count: 0 },
      documentation: { weightedSum: 0, totalWeight: 0, count: 0 },
      insurance: { weightedSum: 0, totalWeight: 0, count: 0 },
    };

    for (const row of exportCosts) {
      const category = (row.category || '').toLowerCase();
      const perMT = row.qty_mt > 0 ? parseFloat(row.amount) / parseFloat(row.qty_mt) : 0;
      const weight = calcWeight(row.created_at);

      // Map categories
      let bucket = null;
      if (category.includes('raw') || category.includes('paddy') || category.includes('material')) bucket = 'raw_material';
      else if (category.includes('freight') || category.includes('shipping') || category.includes('transport')) bucket = 'freight';
      else if (category.includes('clear') || category.includes('customs') || category.includes('port')) bucket = 'clearing';
      else if (category.includes('bag') || category.includes('pack')) bucket = 'bags';
      else if (category.includes('doc') || category.includes('cert')) bucket = 'documentation';
      else if (category.includes('insur')) bucket = 'insurance';
      else bucket = 'clearing'; // default to clearing for misc

      if (bucket && costBuckets[bucket]) {
        costBuckets[bucket].weightedSum += perMT * weight;
        costBuckets[bucket].totalWeight += weight;
        costBuckets[bucket].count++;
      }
    }

    // Aggregate milling costs per MT
    const millingBucket = { weightedSum: 0, totalWeight: 0, count: 0 };
    for (const row of millingCosts) {
      const perMT = row.raw_qty_mt > 0 ? parseFloat(row.amount) / parseFloat(row.raw_qty_mt) : 0;
      const weight = calcWeight(row.created_at);
      millingBucket.weightedSum += perMT * weight;
      millingBucket.totalWeight += weight;
      millingBucket.count++;
    }

    // Calculate weighted averages
    const avg = (bucket) => bucket.totalWeight > 0 ? bucket.weightedSum / bucket.totalWeight : 0;

    const predictedRawCost = avg(costBuckets.raw_material);
    const predictedMillingCost = avg(millingBucket);
    const predictedBagsCost = avg(costBuckets.bags);
    const predictedFreight = avg(costBuckets.freight);
    const predictedClearing = avg(costBuckets.clearing);

    // 5. Get current PKR/USD rate
    const fxRate = await db('fx_rates')
      .where({ from_currency: 'USD', to_currency: 'PKR' })
      .orderBy('effective_date', 'desc')
      .first();
    const pkrPerUsd = fxRate ? parseFloat(fxRate.rate) : 280;

    // Total cost in PKR per MT
    const totalCostPKR = predictedRawCost + predictedMillingCost + predictedBagsCost + predictedFreight + predictedClearing;

    // Convert bags/freight to USD for display (they may be in USD)
    const totalCostUSD = totalCostPKR / pkrPerUsd;

    // 6. Minimum selling price at 15% margin (USD)
    const minSellPrice = parseFloat((totalCostUSD * 1.15).toFixed(2));

    // 7. Confidence based on data points
    const totalDataPoints = exportCosts.length + millingCosts.length;
    let confidence;
    if (totalDataPoints > 20) confidence = 90;
    else if (totalDataPoints > 10) confidence = 75;
    else if (totalDataPoints > 5) confidence = 60;
    else confidence = 40;

    // 8. Save to cost_predictions
    const predictionRecord = {
      product_id: productId,
      product_name: product.name,
      prediction_date: new Date(),
      predicted_raw_cost_per_mt: parseFloat(predictedRawCost.toFixed(2)),
      predicted_milling_cost_per_mt: parseFloat(predictedMillingCost.toFixed(2)),
      predicted_bags_per_mt: parseFloat(predictedBagsCost.toFixed(2)),
      predicted_freight_per_mt: parseFloat(predictedFreight.toFixed(2)),
      predicted_clearing_per_mt: parseFloat(predictedClearing.toFixed(2)),
      predicted_total_cost_per_mt: parseFloat(totalCostPKR.toFixed(2)),
      predicted_min_sell_price: minSellPrice,
      confidence_pct: confidence,
      data_points_used: totalDataPoints,
      methodology: 'weighted_average',
      factors: JSON.stringify({
        exportCostEntries: exportCosts.length,
        millingCostEntries: millingCosts.length,
        fxRate: pkrPerUsd,
        lookbackMonths: 6,
        weightFormula: '1 + (6 - months_ago) * 0.3',
        marginTarget: '15%',
      }),
    };

    const [saved] = await db('cost_predictions').insert(predictionRecord).returning('*');

    return {
      prediction: saved,
      breakdown: {
        rawMaterial: { perMT_PKR: parseFloat(predictedRawCost.toFixed(2)), dataPoints: costBuckets.raw_material.count },
        milling: { perMT_PKR: parseFloat(predictedMillingCost.toFixed(2)), dataPoints: millingBucket.count },
        bags: { perMT_PKR: parseFloat(predictedBagsCost.toFixed(2)), dataPoints: costBuckets.bags.count },
        freight: { perMT_PKR: parseFloat(predictedFreight.toFixed(2)), dataPoints: costBuckets.freight.count },
        clearing: { perMT_PKR: parseFloat(predictedClearing.toFixed(2)), dataPoints: costBuckets.clearing.count },
      },
      totals: {
        totalCostPerMT_PKR: parseFloat(totalCostPKR.toFixed(2)),
        totalCostPerMT_USD: parseFloat(totalCostUSD.toFixed(2)),
        minSellPriceUSD: minSellPrice,
        fxRate: pkrPerUsd,
      },
      confidence: {
        pct: confidence,
        dataPoints: totalDataPoints,
        methodology: 'weighted_average',
      },
    };
  },

  /**
   * Suggest optimal sourcing for a product based on supplier performance.
   */
  async suggestOptimalSourcing({ productId, qtyMT, targetMarginPct }) {
    const product = await db('products').where({ id: productId }).first();
    if (!product) throw new Error(`Product ${productId} not found`);

    // 1. Get all suppliers who have supplied this product via purchase orders
    const suppliers = await db('purchase_orders as po')
      .join('suppliers as s', 'po.supplier_id', 's.id')
      .where('po.product_id', productId)
      .where('s.is_active', true)
      .groupBy('s.id', 's.name', 's.country')
      .select(
        's.id as supplier_id',
        's.name as supplier_name',
        's.country',
        db.raw('COUNT(po.id) as total_orders'),
        db.raw('AVG(po.price_per_mt) as avg_price_per_mt'),
        db.raw('SUM(po.qty_mt) as total_qty_supplied'),
        db.raw('MAX(po.created_at) as last_order_date')
      );

    // 2. For each supplier, get GRN data for delivery reliability
    const results = [];
    for (const sup of suppliers) {
      // Get GRN data — actual delivery vs expected
      const grns = await db('goods_receipt_notes as grn')
        .join('purchase_orders as po', 'grn.po_id', 'po.id')
        .where('po.supplier_id', sup.supplier_id)
        .where('po.product_id', productId)
        .select(
          'grn.receipt_date',
          'po.delivery_date',
          'grn.accepted_qty_mt',
          'grn.rejected_qty_mt',
          'grn.moisture_actual',
          'grn.broken_actual'
        );

      // Calculate delivery reliability (% on time or early)
      let onTimeCount = 0;
      let totalDeliveryDays = 0;
      for (const g of grns) {
        if (g.delivery_date && g.receipt_date) {
          const expected = new Date(g.delivery_date);
          const actual = new Date(g.receipt_date);
          const diffDays = Math.ceil((actual - expected) / (1000 * 60 * 60 * 24));
          totalDeliveryDays += Math.max(0, diffDays);
          if (diffDays <= 2) onTimeCount++; // within 2 days = on time
        }
      }
      const deliveryReliability = grns.length > 0 ? (onTimeCount / grns.length) * 100 : 50;
      const avgDeliveryDelay = grns.length > 0 ? totalDeliveryDays / grns.length : 0;

      // 3. Get quality scores from supplier_scores
      const score = await db('supplier_scores')
        .where({ supplier_id: sup.supplier_id })
        .orderBy('period_end', 'desc')
        .first();

      const qualityScore = score ? parseFloat(score.quality_score || 0) : 50;
      const overallScore = score ? parseFloat(score.overall_score || 0) : 50;

      // 4. Calculate value score
      // Weights: quality 40%, price competitiveness 35%, delivery reliability 25%
      const avgPrice = parseFloat(sup.avg_price_per_mt) || 0;

      // Price score: lower is better, normalize against the group
      // Will be normalized after loop
      const priceRaw = avgPrice;

      const valueScore = (qualityScore * 0.40) + (deliveryReliability * 0.25);
      // Price component will be added after normalization

      results.push({
        supplier: {
          id: sup.supplier_id,
          name: sup.supplier_name,
          country: sup.country,
        },
        avgCostPerMT: parseFloat(avgPrice.toFixed(2)),
        totalQtySupplied: parseFloat(parseFloat(sup.total_qty_supplied || 0).toFixed(2)),
        totalOrders: parseInt(sup.total_orders),
        qualityScore: parseFloat(qualityScore.toFixed(1)),
        deliveryReliability: parseFloat(deliveryReliability.toFixed(1)),
        avgDeliveryDelay: parseFloat(avgDeliveryDelay.toFixed(1)),
        overallSupplierScore: parseFloat(overallScore.toFixed(1)),
        priceRaw,
        valueScore, // partial, will be completed
      });
    }

    // Normalize price scores: best price = 100, worst = 0
    if (results.length > 0) {
      const prices = results.map((r) => r.priceRaw).filter((p) => p > 0);
      const minPrice = Math.min(...prices, 1);
      const maxPrice = Math.max(...prices, 1);
      const priceRange = maxPrice - minPrice || 1;

      for (const r of results) {
        const priceScore = r.priceRaw > 0
          ? ((maxPrice - r.priceRaw) / priceRange) * 100
          : 50;
        r.valueScore += priceScore * 0.35;
        r.priceScore = parseFloat(priceScore.toFixed(1));
        delete r.priceRaw;
      }
    }

    // Sort by value score descending
    results.sort((a, b) => b.valueScore - a.valueScore);

    // Top 3 recommendations
    const top3 = results.slice(0, 3).map((r, idx) => {
      const estimatedCost = r.avgCostPerMT * (qtyMT || 1);
      const margin = targetMarginPct || 15;
      const minSellPerMT = r.avgCostPerMT * (1 + margin / 100);

      return {
        rank: idx + 1,
        ...r,
        valueScore: parseFloat(r.valueScore.toFixed(1)),
        estimatedTotalCost: parseFloat(estimatedCost.toFixed(2)),
        suggestedMinSellPerMT: parseFloat(minSellPerMT.toFixed(2)),
        recommendation: idx === 0
          ? 'Best overall value — recommended first choice'
          : idx === 1
            ? 'Strong alternative — consider for diversification'
            : 'Viable backup option',
      };
    });

    return {
      product: { id: product.id, name: product.name },
      qtyMT: qtyMT || null,
      targetMarginPct: targetMarginPct || 15,
      totalSuppliersAnalyzed: results.length,
      topRecommendations: top3,
      allSuppliers: results.map((r) => ({ ...r, valueScore: parseFloat(r.valueScore.toFixed(1)) })),
    };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO SIMULATOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Simulate FOB vs CIF comparison for an export order.
   */
  async simulateFobVsCif({ productId, qtyMT, pricePerMT, destinationCountry, fxRate }) {
    const product = await db('products').where({ id: productId }).first();
    if (!product) throw new Error(`Product ${productId} not found`);

    // Get historical freight/insurance costs for this country
    const freightData = await db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .where('eo.country', destinationCountry)
      .whereIn('eoc.category', ['freight', 'shipping', 'transport', 'Freight', 'Shipping'])
      .select(db.raw('AVG(eoc.amount / NULLIF(eo.qty_mt, 0)) as avg_freight_per_mt'))
      .first();

    const insuranceData = await db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .where('eo.country', destinationCountry)
      .whereIn('eoc.category', ['insurance', 'Insurance', 'cargo_insurance'])
      .select(db.raw('AVG(eoc.amount / NULLIF(eo.qty_mt, 0)) as avg_insurance_per_mt'))
      .first();

    // Get current FX rate
    let rate = fxRate;
    if (!rate) {
      const fx = await db('fx_rates')
        .where({ from_currency: 'USD', to_currency: 'PKR' })
        .orderBy('effective_date', 'desc')
        .first();
      rate = fx ? parseFloat(fx.rate) : 280;
    }

    const avgFreightPerMT = freightData && freightData.avg_freight_per_mt
      ? parseFloat(freightData.avg_freight_per_mt)
      : 45; // default estimate USD
    const avgInsurancePerMT = insuranceData && insuranceData.avg_insurance_per_mt
      ? parseFloat(insuranceData.avg_insurance_per_mt)
      : 8; // default estimate USD

    const totalRevenue = pricePerMT * qtyMT;
    const totalFreight = avgFreightPerMT * qtyMT;
    const totalInsurance = avgInsurancePerMT * qtyMT;

    // FOB scenario: buyer pays freight + insurance
    const fob = {
      incoterm: 'FOB',
      pricePerMT,
      totalRevenue,
      sellerFreight: 0,
      sellerInsurance: 0,
      sellerTotalCost: totalRevenue, // seller just delivers to port
      netToSeller: totalRevenue,
      cashFlowTiming: 'Faster — payment on BL release',
      riskLevel: 'Lower — risk transfers at port of loading',
    };

    // CIF scenario: seller pays freight + insurance, but charges higher price
    const cifPricePerMT = pricePerMT + avgFreightPerMT + avgInsurancePerMT;
    const cifTotalRevenue = cifPricePerMT * qtyMT;
    const cif = {
      incoterm: 'CIF',
      pricePerMT: parseFloat(cifPricePerMT.toFixed(2)),
      totalRevenue: parseFloat(cifTotalRevenue.toFixed(2)),
      sellerFreight: parseFloat(totalFreight.toFixed(2)),
      sellerInsurance: parseFloat(totalInsurance.toFixed(2)),
      sellerTotalCost: parseFloat((totalFreight + totalInsurance).toFixed(2)),
      netToSeller: parseFloat((cifTotalRevenue - totalFreight - totalInsurance).toFixed(2)),
      cashFlowTiming: 'Slower — payment after goods arrive or docs presented',
      riskLevel: 'Higher — risk until destination port',
    };

    const savings = parseFloat((cif.netToSeller - fob.netToSeller).toFixed(2));
    const recommendation = savings > 0
      ? `CIF generates $${savings} more net revenue but carries higher risk. Recommended if you have reliable freight contracts.`
      : `FOB is simpler and generates comparable revenue. Recommended for lower risk exposure.`;

    // Save scenario
    const [scenario] = await db('scenarios').insert({
      name: `FOB vs CIF — ${product.name} to ${destinationCountry}`,
      scenario_type: 'fob_vs_cif',
      parameters: JSON.stringify({ productId, qtyMT, pricePerMT, destinationCountry, fxRate: rate }),
      results: JSON.stringify({ fob, cif }),
      comparison_data: JSON.stringify({
        freightPerMT: parseFloat(avgFreightPerMT.toFixed(2)),
        insurancePerMT: parseFloat(avgInsurancePerMT.toFixed(2)),
        fxRate: rate,
      }),
      recommendation,
    }).returning('*');

    return { scenario, fob, cif, recommendation, savings };
  },

  /**
   * Compare multiple suppliers for a product.
   */
  async simulateSupplierComparison({ productId, qtyMT, supplierIds }) {
    const product = await db('products').where({ id: productId }).first();
    if (!product) throw new Error(`Product ${productId} not found`);

    const results = [];
    for (const supplierId of supplierIds) {
      const supplier = await db('suppliers').where({ id: supplierId }).first();
      if (!supplier) continue;

      // Historical avg price from purchase orders
      const priceData = await db('purchase_orders')
        .where({ supplier_id: supplierId, product_id: productId })
        .select(
          db.raw('AVG(price_per_mt) as avg_price'),
          db.raw('COUNT(*) as order_count'),
          db.raw('SUM(qty_mt) as total_qty')
        )
        .first();

      // Quality score
      const score = await db('supplier_scores')
        .where({ supplier_id: supplierId })
        .orderBy('period_end', 'desc')
        .first();

      // GRN quality data — rejection rate and quality metrics
      const grnData = await db('goods_receipt_notes as grn')
        .join('purchase_orders as po', 'grn.po_id', 'po.id')
        .where('po.supplier_id', supplierId)
        .where('po.product_id', productId)
        .select(
          db.raw('AVG(grn.moisture_actual) as avg_moisture'),
          db.raw('AVG(grn.broken_actual) as avg_broken'),
          db.raw('SUM(grn.rejected_qty_mt) as total_rejected'),
          db.raw('SUM(grn.accepted_qty_mt) as total_accepted'),
          db.raw('COUNT(*) as grn_count')
        )
        .first();

      // Milling yield from batches supplied by this supplier
      const yieldData = await db('milling_batches')
        .where({ supplier_id: supplierId })
        .whereNotNull('yield_pct')
        .where('yield_pct', '>', 0)
        .select(db.raw('AVG(yield_pct) as avg_yield'))
        .first();

      // Delivery timing
      const deliveryData = await db('goods_receipt_notes as grn')
        .join('purchase_orders as po', 'grn.po_id', 'po.id')
        .where('po.supplier_id', supplierId)
        .whereNotNull('po.delivery_date')
        .select(
          db.raw('AVG(EXTRACT(DAY FROM (grn.receipt_date::timestamp - po.delivery_date::timestamp))) as avg_delay_days')
        )
        .first();

      const avgPrice = priceData ? parseFloat(priceData.avg_price || 0) : 0;
      const totalCost = avgPrice * (qtyMT || 1);
      const qualityScore = score ? parseFloat(score.quality_score || 50) : 50;
      const rejectionRate = grnData && parseFloat(grnData.total_accepted) > 0
        ? (parseFloat(grnData.total_rejected || 0) / (parseFloat(grnData.total_accepted) + parseFloat(grnData.total_rejected || 0))) * 100
        : 0;
      const avgYield = yieldData ? parseFloat(yieldData.avg_yield || 0) : 0;
      const avgDelay = deliveryData ? parseFloat(deliveryData.avg_delay_days || 0) : 0;

      // Quality risk: higher if rejection rate is high or quality score is low
      const qualityRisk = rejectionRate > 10 ? 'High' : rejectionRate > 5 ? 'Medium' : 'Low';
      const deliveryRisk = avgDelay > 5 ? 'High' : avgDelay > 2 ? 'Medium' : 'Low';

      // Overall score: weighted combination
      const priceNorm = avgPrice > 0 ? Math.max(0, 100 - (avgPrice / 1000)) : 50; // normalize
      const overallScore = (qualityScore * 0.35) + (priceNorm * 0.30) + ((100 - rejectionRate) * 0.20) + ((100 - Math.min(avgDelay * 10, 100)) * 0.15);

      results.push({
        supplier: { id: supplier.id, name: supplier.name, country: supplier.country },
        avgPricePerMT: parseFloat(avgPrice.toFixed(2)),
        totalEstimatedCost: parseFloat(totalCost.toFixed(2)),
        orderHistory: parseInt(priceData ? priceData.order_count : 0),
        qualityScore: parseFloat(qualityScore.toFixed(1)),
        rejectionRate: parseFloat(rejectionRate.toFixed(2)),
        avgMillingYield: parseFloat(avgYield.toFixed(1)),
        avgDeliveryDelay: parseFloat(avgDelay.toFixed(1)),
        avgMoisture: grnData ? parseFloat(parseFloat(grnData.avg_moisture || 0).toFixed(1)) : null,
        avgBroken: grnData ? parseFloat(parseFloat(grnData.avg_broken || 0).toFixed(1)) : null,
        qualityRisk,
        deliveryRisk,
        overallScore: parseFloat(overallScore.toFixed(1)),
      });
    }

    results.sort((a, b) => b.overallScore - a.overallScore);

    const recommendation = results.length > 0
      ? `${results[0].supplier.name} ranks highest with overall score ${results[0].overallScore}. ` +
        (results.length > 1 ? `${results[1].supplier.name} is a viable alternative.` : '')
      : 'No supplier data available for comparison.';

    // Save scenario
    const [scenario] = await db('scenarios').insert({
      name: `Supplier Comparison — ${product.name} (${supplierIds.length} suppliers)`,
      scenario_type: 'supplier_comparison',
      parameters: JSON.stringify({ productId, qtyMT, supplierIds }),
      results: JSON.stringify(results),
      comparison_data: JSON.stringify(results),
      recommendation,
    }).returning('*');

    return { scenario, suppliers: results, recommendation };
  },

  /**
   * Simulate yield scenarios for a milling batch.
   */
  async simulateYieldScenario({ rawQtyMT, moisturePct, brokenPct, productVariety }) {
    // Get benchmark yield for this variety from historical data
    const benchmarkData = await db('milling_batches as mb')
      .join('export_orders as eo', 'mb.linked_export_order_id', 'eo.id')
      .join('products as p', 'eo.product_id', 'p.id')
      .where('p.name', 'ilike', `%${productVariety || ''}%`)
      .where('mb.yield_pct', '>', 0)
      .select(
        db.raw('AVG(mb.yield_pct) as avg_yield'),
        db.raw('STDDEV(mb.yield_pct) as stddev_yield'),
        db.raw('MIN(mb.yield_pct) as min_yield'),
        db.raw('MAX(mb.yield_pct) as max_yield'),
        db.raw('COUNT(*) as batch_count')
      )
      .first();

    const benchmarkYield = benchmarkData && parseFloat(benchmarkData.avg_yield) > 0
      ? parseFloat(benchmarkData.avg_yield)
      : 62; // default benchmark for rice
    const stddevYield = benchmarkData && parseFloat(benchmarkData.stddev_yield) > 0
      ? parseFloat(benchmarkData.stddev_yield)
      : 3;

    // Adjust for moisture and broken content
    // Higher moisture = lower yield (moisture > 14% penalizes)
    // Higher broken = lower yield
    const moistureAdjustment = moisturePct > 14 ? -(moisturePct - 14) * 0.8 : 0;
    const brokenAdjustment = brokenPct > 5 ? -(brokenPct - 5) * 0.5 : 0;

    const adjustedYield = benchmarkYield + moistureAdjustment + brokenAdjustment;

    // Three scenarios
    const bestCase = {
      label: 'Best Case (Benchmark)',
      yieldPct: parseFloat(benchmarkYield.toFixed(1)),
      outputMT: parseFloat((rawQtyMT * benchmarkYield / 100).toFixed(2)),
      brokenMT: parseFloat((rawQtyMT * Math.max(brokenPct - 2, 1) / 100).toFixed(2)),
      branMT: parseFloat((rawQtyMT * 8 / 100).toFixed(2)),
      huskMT: parseFloat((rawQtyMT * 20 / 100).toFixed(2)),
      wastageMT: parseFloat((rawQtyMT * (100 - benchmarkYield - 8 - 20) / 100).toFixed(2)),
    };

    const expected = {
      label: 'Expected (Adjusted)',
      yieldPct: parseFloat(adjustedYield.toFixed(1)),
      outputMT: parseFloat((rawQtyMT * adjustedYield / 100).toFixed(2)),
      brokenMT: parseFloat((rawQtyMT * brokenPct / 100).toFixed(2)),
      branMT: parseFloat((rawQtyMT * 9 / 100).toFixed(2)),
      huskMT: parseFloat((rawQtyMT * 21 / 100).toFixed(2)),
      wastageMT: parseFloat((rawQtyMT * (100 - adjustedYield - 9 - 21) / 100).toFixed(2)),
    };

    const worstYield = adjustedYield - 5;
    const worstCase = {
      label: 'Worst Case (-5%)',
      yieldPct: parseFloat(worstYield.toFixed(1)),
      outputMT: parseFloat((rawQtyMT * worstYield / 100).toFixed(2)),
      brokenMT: parseFloat((rawQtyMT * (brokenPct + 3) / 100).toFixed(2)),
      branMT: parseFloat((rawQtyMT * 10 / 100).toFixed(2)),
      huskMT: parseFloat((rawQtyMT * 22 / 100).toFixed(2)),
      wastageMT: parseFloat((rawQtyMT * (100 - worstYield - 10 - 22) / 100).toFixed(2)),
    };

    // Get average selling price for this variety
    const priceData = await db('export_orders as eo')
      .join('products as p', 'eo.product_id', 'p.id')
      .where('p.name', 'ilike', `%${productVariety || ''}%`)
      .where('eo.price_per_mt', '>', 0)
      .select(db.raw('AVG(eo.price_per_mt) as avg_price'))
      .first();

    const avgSellPrice = priceData && parseFloat(priceData.avg_price) > 0
      ? parseFloat(priceData.avg_price)
      : 450; // default USD/MT

    // Revenue estimates
    bestCase.estimatedRevenue = parseFloat((bestCase.outputMT * avgSellPrice).toFixed(2));
    expected.estimatedRevenue = parseFloat((expected.outputMT * avgSellPrice).toFixed(2));
    worstCase.estimatedRevenue = parseFloat((worstCase.outputMT * avgSellPrice).toFixed(2));

    const keyFactors = [
      { factor: 'Moisture Content', value: `${moisturePct}%`, impact: moistureAdjustment !== 0 ? `${moistureAdjustment.toFixed(1)}% yield reduction` : 'Within acceptable range' },
      { factor: 'Broken Content', value: `${brokenPct}%`, impact: brokenAdjustment !== 0 ? `${brokenAdjustment.toFixed(1)}% yield reduction` : 'Within acceptable range' },
      { factor: 'Variety Benchmark', value: `${benchmarkYield.toFixed(1)}%`, impact: `Based on ${benchmarkData ? benchmarkData.batch_count : 0} historical batches` },
      { factor: 'Yield Std Deviation', value: `${stddevYield.toFixed(1)}%`, impact: stddevYield > 4 ? 'High variability — increased risk' : 'Normal variability' },
    ];

    // Save scenario
    const [scenario] = await db('scenarios').insert({
      name: `Yield Scenario — ${productVariety || 'Rice'} (${rawQtyMT} MT)`,
      scenario_type: 'yield_scenario',
      parameters: JSON.stringify({ rawQtyMT, moisturePct, brokenPct, productVariety }),
      results: JSON.stringify({ bestCase, expected, worstCase }),
      comparison_data: JSON.stringify({ bestCase, expected, worstCase, keyFactors }),
      recommendation: `Expected yield is ${adjustedYield.toFixed(1)}% producing ${expected.outputMT} MT. Revenue range: $${worstCase.estimatedRevenue} to $${bestCase.estimatedRevenue}.`,
    }).returning('*');

    return { scenario, bestCase, expected, worstCase, keyFactors };
  },

  /**
   * Simulate FX rate impact on an export contract.
   */
  async simulateFxScenario({ contractValueUSD, currentRate, scenarios: rateScenarios }) {
    // Get actual current rate if not provided
    let actualCurrentRate = currentRate;
    if (!actualCurrentRate) {
      const fx = await db('fx_rates')
        .where({ from_currency: 'USD', to_currency: 'PKR' })
        .orderBy('effective_date', 'desc')
        .first();
      actualCurrentRate = fx ? parseFloat(fx.rate) : 280;
    }

    // Get average PKR costs from recent export orders
    const avgCostData = await db('export_order_costs as eoc')
      .join('export_orders as eo', 'eoc.order_id', 'eo.id')
      .where('eo.status', '!=', 'Cancelled')
      .select(
        db.raw('SUM(eoc.amount) / NULLIF(SUM(eo.qty_mt), 0) as avg_total_cost_per_mt_pkr')
      )
      .first();

    const avgCostPKR = avgCostData && parseFloat(avgCostData.avg_total_cost_per_mt_pkr) > 0
      ? parseFloat(avgCostData.avg_total_cost_per_mt_pkr)
      : 120000; // default estimate

    // Estimate total PKR costs based on contract value
    // Assume costs are proportional
    const estimatedTotalCostPKR = (contractValueUSD * actualCurrentRate) * 0.75; // ~75% of revenue goes to costs

    const scenarioResults = [];
    let breakevenRate = null;

    for (const s of (rateScenarios || [{ rate: actualCurrentRate }])) {
      const rate = parseFloat(s.rate);
      const prkRevenue = contractValueUSD * rate;
      const profit = prkRevenue - estimatedTotalCostPKR;
      const margin = prkRevenue > 0 ? (profit / prkRevenue) * 100 : 0;

      scenarioResults.push({
        rate,
        prkRevenue: parseFloat(prkRevenue.toFixed(2)),
        estimatedCostPKR: parseFloat(estimatedTotalCostPKR.toFixed(2)),
        profitPKR: parseFloat(profit.toFixed(2)),
        marginPct: parseFloat(margin.toFixed(2)),
        profitUSD: parseFloat((profit / rate).toFixed(2)),
        vsCurrentRate: parseFloat(((rate - actualCurrentRate) / actualCurrentRate * 100).toFixed(2)),
      });

      // Check for breakeven
      if (profit <= 0 && !breakevenRate) {
        breakevenRate = parseFloat((estimatedTotalCostPKR / contractValueUSD).toFixed(2));
      }
    }

    // Calculate breakeven if not found in scenarios
    if (!breakevenRate) {
      breakevenRate = parseFloat((estimatedTotalCostPKR / contractValueUSD).toFixed(2));
    }

    const currentExposure = parseFloat((contractValueUSD * actualCurrentRate).toFixed(2));
    const recommendation = breakevenRate < actualCurrentRate
      ? `Current rate (${actualCurrentRate}) is above breakeven (${breakevenRate}). Position is profitable. Consider hedging if PKR strengthens below ${(breakevenRate * 1.05).toFixed(0)}.`
      : `WARNING: Current rate (${actualCurrentRate}) is near or below breakeven (${breakevenRate}). Margin is at risk. Consider renegotiating price or hedging.`;

    // Save scenario
    const [scenario] = await db('scenarios').insert({
      name: `FX Scenario — $${contractValueUSD.toLocaleString()} contract`,
      scenario_type: 'fx_scenario',
      parameters: JSON.stringify({ contractValueUSD, currentRate: actualCurrentRate, scenarios: rateScenarios }),
      results: JSON.stringify(scenarioResults),
      comparison_data: JSON.stringify({ breakevenRate, currentExposure }),
      recommendation,
    }).returning('*');

    return {
      scenario,
      scenarios: scenarioResults,
      breakevenRate,
      currentRate: actualCurrentRate,
      currentExposure,
      recommendation,
    };
  },

  /**
   * Full end-to-end order simulation.
   */
  async simulateFullOrder({ customerId, productId, qtyMT, incoterm, targetMarginPct }) {
    const product = await db('products').where({ id: productId }).first();
    if (!product) throw new Error(`Product ${productId} not found`);

    const customer = await db('customers').where({ id: customerId }).first();
    if (!customer) throw new Error(`Customer ${customerId} not found`);

    const margin = targetMarginPct || 15;

    // 1. Predict costs
    const costPrediction = await this.predictCostPerMT(productId);
    const totalCostPerMT_USD = costPrediction.totals.totalCostPerMT_USD;
    const fxRate = costPrediction.totals.fxRate;

    // 2. Calculate selling prices
    const minSellPrice = parseFloat((totalCostPerMT_USD * (1 + margin / 100)).toFixed(2));
    const recommendedSellPrice = parseFloat((totalCostPerMT_USD * (1 + (margin + 5) / 100)).toFixed(2)); // +5% buffer
    const totalContractValue = parseFloat((recommendedSellPrice * qtyMT).toFixed(2));

    // 3. Estimate timeline from historical data
    const timelineData = await db('export_orders')
      .where('product_id', productId)
      .where('status', 'Completed')
      .select(
        db.raw("AVG(EXTRACT(DAY FROM (etd::timestamp - created_at::timestamp))) as avg_days_to_ship"),
        db.raw("AVG(EXTRACT(DAY FROM (ata::timestamp - etd::timestamp))) as avg_transit_days")
      )
      .first();

    const avgDaysToShip = timelineData && parseFloat(timelineData.avg_days_to_ship) > 0
      ? Math.round(parseFloat(timelineData.avg_days_to_ship))
      : 30;
    const avgTransitDays = timelineData && parseFloat(timelineData.avg_transit_days) > 0
      ? Math.round(parseFloat(timelineData.avg_transit_days))
      : 20;

    const timeline = {
      procurement: { phase: 'Procurement & Sourcing', daysEstimate: 7 },
      milling: { phase: 'Milling & Processing', daysEstimate: 10 },
      documentation: { phase: 'Documentation & Compliance', daysEstimate: 5 },
      portHandling: { phase: 'Port Handling & Loading', daysEstimate: avgDaysToShip - 22 > 0 ? avgDaysToShip - 22 : 5 },
      transit: { phase: 'Ocean Transit', daysEstimate: avgTransitDays },
      totalDays: avgDaysToShip + avgTransitDays,
    };

    // 4. Cash flow estimate
    const advancePct = 20;
    const advanceAmount = parseFloat((totalContractValue * advancePct / 100).toFixed(2));
    const balanceAmount = parseFloat((totalContractValue - advanceAmount).toFixed(2));
    const totalCost = parseFloat((costPrediction.totals.totalCostPerMT_PKR * qtyMT).toFixed(2));

    const cashFlow = {
      advanceIn: { amount: advanceAmount, currency: 'USD', timing: 'Day 1-5 (on contract)' },
      procurementCost: { amount: parseFloat((costPrediction.prediction.predicted_raw_cost_per_mt * qtyMT).toFixed(2)), currency: 'PKR', timing: 'Day 1-14' },
      millingCost: { amount: parseFloat((costPrediction.prediction.predicted_milling_cost_per_mt * qtyMT).toFixed(2)), currency: 'PKR', timing: 'Day 7-21' },
      freightCost: { amount: parseFloat((costPrediction.prediction.predicted_freight_per_mt * qtyMT).toFixed(2)), currency: 'PKR', timing: `Day ${avgDaysToShip - 5}-${avgDaysToShip}` },
      balanceIn: { amount: balanceAmount, currency: 'USD', timing: `Day ${avgDaysToShip + avgTransitDays - 5}-${avgDaysToShip + avgTransitDays + 10}` },
      totalCostPKR: totalCost,
      totalRevenuePKR: parseFloat((totalContractValue * fxRate).toFixed(2)),
      estimatedProfitPKR: parseFloat(((totalContractValue * fxRate) - totalCost).toFixed(2)),
      estimatedMarginPct: parseFloat((((totalContractValue * fxRate) - totalCost) / (totalContractValue * fxRate) * 100).toFixed(1)),
    };

    // 5. Risk assessment
    // Customer payment history
    const paymentHistory = await db('receivables')
      .where({ customer_id: customerId })
      .select(
        db.raw('COUNT(*) as total_receivables'),
        db.raw("COUNT(CASE WHEN status = 'Overdue' THEN 1 END) as overdue_count"),
        db.raw('AVG(aging) as avg_aging_days')
      )
      .first();

    const customerRisk = paymentHistory && parseInt(paymentHistory.overdue_count) > 0
      ? { level: 'Medium', reason: `${paymentHistory.overdue_count} overdue receivables, avg aging ${Math.round(parseFloat(paymentHistory.avg_aging_days || 0))} days` }
      : { level: 'Low', reason: 'No overdue history' };

    // Country requirements check
    const docReqs = await db('country_doc_requirements')
      .where({ country: customer.country })
      .select('doc_type', 'is_required', 'notes');

    const risks = {
      customer: customerRisk,
      documentation: { requiredDocs: docReqs.length, note: `${docReqs.length} documents required for ${customer.country}` },
      fx: { currentRate: fxRate, note: 'FX exposure on balance payment' },
      margin: {
        targetPct: margin,
        estimatedPct: cashFlow.estimatedMarginPct,
        buffer: parseFloat((cashFlow.estimatedMarginPct - margin).toFixed(1)),
        level: cashFlow.estimatedMarginPct >= margin ? 'On Target' : 'Below Target',
      },
    };

    // Save scenario
    const [scenario] = await db('scenarios').insert({
      name: `Full Order — ${product.name} to ${customer.name} (${qtyMT} MT)`,
      scenario_type: 'full_order',
      parameters: JSON.stringify({ customerId, productId, qtyMT, incoterm, targetMarginPct: margin }),
      results: JSON.stringify({ pricing: { minSellPrice, recommendedSellPrice, totalContractValue }, timeline, cashFlow, risks }),
      comparison_data: JSON.stringify({ costBreakdown: costPrediction.breakdown }),
      recommendation: `Recommended price: $${recommendedSellPrice}/MT (total $${totalContractValue}). Estimated margin: ${cashFlow.estimatedMarginPct}%. Timeline: ~${timeline.totalDays} days.`,
      created_by: null,
    }).returning('*');

    return {
      scenario,
      product: { id: product.id, name: product.name },
      customer: { id: customer.id, name: customer.name, country: customer.country },
      pricing: { minSellPrice, recommendedSellPrice, totalContractValue, fxRate },
      costBreakdown: costPrediction.breakdown,
      timeline,
      cashFlow,
      risks,
    };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCUMENT AUTOMATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get required documents for a country + incoterm.
   */
  async getCountryRequirements(country, incoterm) {
    let query = db('country_doc_requirements')
      .where({ country })
      .orderBy('doc_type');

    if (incoterm) {
      query = query.where(function () {
        this.where({ incoterm }).orWhereNull('incoterm');
      });
    }

    const docs = await query.select('doc_type', 'is_required', 'validation_rules', 'notes', 'incoterm');
    return { country, incoterm: incoterm || 'all', requirements: docs };
  },

  /**
   * Validate all documents for an export order against country requirements.
   */
  async validateOrderDocuments(orderId) {
    // Get order with country + incoterm
    const order = await db('export_orders').where({ id: orderId }).first();
    if (!order) throw new Error(`Order ${orderId} not found`);

    // Get country requirements
    const { requirements } = await this.getCountryRequirements(order.country, order.incoterm);

    // Get current document statuses for this order
    const orderDocs = await db('export_order_documents')
      .where({ order_id: orderId })
      .select('doc_type', 'status', 'upload_date', 'file_path');

    // Build validation items
    const items = [];
    let allComplete = true;

    for (const req of requirements) {
      const existing = orderDocs.find((d) => d.doc_type === req.doc_type);
      const issues = [];

      if (!existing) {
        issues.push('Document not uploaded');
        if (req.is_required) allComplete = false;
      } else {
        if (existing.status !== 'Approved' && existing.status !== 'Verified') {
          issues.push(`Status is "${existing.status}" — needs approval`);
          if (req.is_required) allComplete = false;
        }

        // Check validation rules
        if (req.validation_rules) {
          const rules = typeof req.validation_rules === 'string'
            ? JSON.parse(req.validation_rules)
            : req.validation_rules;

          if (rules.maxAgeDays && existing.upload_date) {
            const uploadDate = new Date(existing.upload_date);
            const daysSinceUpload = Math.ceil((new Date() - uploadDate) / (1000 * 60 * 60 * 24));
            if (daysSinceUpload > rules.maxAgeDays) {
              issues.push(`Document expired — uploaded ${daysSinceUpload} days ago (max ${rules.maxAgeDays})`);
              if (req.is_required) allComplete = false;
            }
          }
        }
      }

      items.push({
        docType: req.doc_type,
        required: req.is_required,
        status: existing ? existing.status : 'Missing',
        valid: issues.length === 0,
        issues,
        notes: req.notes,
      });
    }

    // Check for extra docs that aren't in requirements
    for (const doc of orderDocs) {
      const inReqs = requirements.find((r) => r.doc_type === doc.doc_type);
      if (!inReqs) {
        items.push({
          docType: doc.doc_type,
          required: false,
          status: doc.status,
          valid: true,
          issues: [],
          notes: 'Additional document — not in country requirements',
        });
      }
    }

    return {
      orderId,
      orderNo: order.order_no,
      country: order.country,
      incoterm: order.incoterm,
      complete: allComplete,
      totalRequired: requirements.filter((r) => r.is_required).length,
      totalPresent: items.filter((i) => i.status !== 'Missing').length,
      totalValid: items.filter((i) => i.valid).length,
      items,
    };
  },

  /**
   * Auto-fill document data from order, customer, product, and shipment info.
   */
  async autoFillDocumentData(orderId, docType) {
    const order = await db('export_orders').where({ id: orderId }).first();
    if (!order) throw new Error(`Order ${orderId} not found`);

    const customer = order.customer_id
      ? await db('customers').where({ id: order.customer_id }).first()
      : null;

    const product = order.product_id
      ? await db('products').where({ id: order.product_id }).first()
      : null;

    // Base data common to all docs
    const base = {
      orderNo: order.order_no,
      date: new Date().toISOString().split('T')[0],
      exporter: {
        name: 'RiceFlow Export Company',
        address: 'Karachi, Pakistan',
        country: 'Pakistan',
      },
      importer: customer ? {
        name: customer.name,
        contactPerson: customer.contact_person,
        address: customer.address,
        country: customer.country,
        email: customer.email,
        phone: customer.phone,
      } : {},
      product: product ? {
        name: product.name,
        code: product.code,
        grade: product.grade,
        category: product.category,
        description: product.description,
      } : {},
      shipment: {
        qty: parseFloat(order.qty_mt || 0),
        unit: 'MT',
        incoterm: order.incoterm,
        vesselName: order.vessel_name,
        bookingNo: order.booking_no,
        etd: order.etd,
        eta: order.eta,
        destinationPort: order.destination_port,
      },
    };

    // Document-specific data
    const docData = { ...base };

    switch (docType) {
      case 'invoice': {
        docData.invoiceNo = `INV-${order.order_no}`;
        docData.currency = order.currency || 'USD';
        docData.pricePerMT = parseFloat(order.price_per_mt || 0);
        docData.totalValue = parseFloat(order.contract_value || 0);
        docData.paymentTerms = `${order.advance_pct || 20}% advance, balance against documents`;
        if (customer) {
          docData.bankDetails = {
            bankName: customer.bank_name,
            accountNo: customer.bank_account,
            swift: customer.bank_swift,
            iban: customer.bank_iban,
          };
        }
        break;
      }
      case 'packing_list': {
        docData.packingListNo = `PL-${order.order_no}`;
        // Get bag info if available
        const bags = await db('inventory_lots')
          .where({ reserved_against: order.order_no, type: 'packaging' })
          .select('item_name', 'qty');
        docData.packaging = bags.length > 0 ? bags : [{ item_name: 'PP Bags', qty: Math.ceil(parseFloat(order.qty_mt || 0) * 20) }];
        docData.grossWeight = parseFloat(order.qty_mt || 0);
        docData.netWeight = parseFloat(order.qty_mt || 0);
        break;
      }
      case 'bl': {
        docData.blNo = order.booking_no || `BL-${order.order_no}`;
        docData.shipper = docData.exporter;
        docData.consignee = docData.importer;
        docData.notifyParty = docData.importer;
        docData.portOfLoading = 'Port Qasim, Karachi';
        docData.portOfDischarge = order.destination_port;
        break;
      }
      case 'coo': {
        docData.certificateNo = `COO-${order.order_no}`;
        docData.originCountry = 'Pakistan';
        docData.destinationCountry = order.country;
        docData.hsCode = product ? `1006.30` : '1006.30'; // Rice HS code
        break;
      }
      case 'phyto': {
        docData.certificateNo = `PHYTO-${order.order_no}`;
        docData.plantProduct = product ? product.name : 'Rice';
        docData.originCountry = 'Pakistan';
        docData.destinationCountry = order.country;
        docData.treatment = 'Fumigation with Phosphine';
        break;
      }
      case 'fumigation': {
        docData.certificateNo = `FUM-${order.order_no}`;
        docData.chemical = 'Aluminium Phosphide (Phosphine)';
        docData.dosage = '3 tablets per MT';
        docData.exposureHours = 72;
        docData.temperature = '25-30°C';
        break;
      }
      default:
        docData.docType = docType;
        break;
    }

    return docData;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE API HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Process a mobile file upload with metadata.
   */
  async processMobileUpload(trx, { uploadType, linkedType, linkedId, linkedRef, file, location, deviceInfo, userId }) {
    const conn = trx || db;

    const record = {
      upload_type: uploadType,
      linked_type: linkedType || null,
      linked_id: linkedId || null,
      linked_ref: linkedRef || null,
      file_name: file.originalname,
      file_path: file.path,
      file_size: file.size,
      mime_type: file.mimetype,
      location_lat: location ? location.lat : null,
      location_lng: location ? location.lng : null,
      device_info: deviceInfo || null,
      uploaded_by: userId,
    };

    const [upload] = await conn('mobile_uploads').insert(record).returning('*');

    // If QC photo, link to the milling batch quality sample
    if (uploadType === 'qc_photo' && linkedType === 'milling_batch' && linkedId) {
      // Check if batch exists and update with photo reference
      const batch = await conn('milling_batches').where({ id: linkedId }).first();
      if (batch) {
        // Record the association — could be used by QC review screen
        upload.linkedBatch = batch.batch_no;
      }
    }

    return upload;
  },

  /**
   * Return batch data optimized for mobile QC entry.
   */
  async getMobileQCData(batchId) {
    const batch = await db('milling_batches as mb')
      .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
      .leftJoin('export_orders as eo', 'mb.linked_export_order_id', 'eo.id')
      .leftJoin('products as p', 'eo.product_id', 'p.id')
      .where('mb.id', batchId)
      .select(
        'mb.id',
        'mb.batch_no',
        'mb.status',
        'mb.raw_qty_mt',
        'mb.planned_finished_mt',
        'mb.actual_finished_mt',
        'mb.yield_pct',
        's.id as supplier_id',
        's.name as supplier_name',
        'eo.order_no as export_order_no',
        'p.name as product_name',
        'p.grade as product_grade'
      )
      .first();

    if (!batch) throw new Error(`Batch ${batchId} not found`);

    // Get existing quality samples
    const samples = await db('milling_quality_samples')
      .where({ batch_id: batchId })
      .orderBy('created_at', 'desc')
      .select('id', 'analysis_type', 'moisture', 'broken', 'chalky', 'foreign_matter', 'discoloration', 'purity', 'grain_size', 'created_at');

    // Get photos linked to this batch
    const photos = await db('mobile_uploads')
      .where({ linked_type: 'milling_batch', linked_id: batchId })
      .orderBy('created_at', 'desc')
      .select('id', 'upload_type', 'file_name', 'file_path', 'created_at');

    // Quality parameters needed (mobile form fields)
    const qualityParameters = [
      { field: 'moisture', label: 'Moisture %', min: 8, max: 18, unit: '%' },
      { field: 'broken', label: 'Broken %', min: 0, max: 25, unit: '%' },
      { field: 'chalky', label: 'Chalky %', min: 0, max: 10, unit: '%' },
      { field: 'foreign_matter', label: 'Foreign Matter %', min: 0, max: 2, unit: '%' },
      { field: 'discoloration', label: 'Discoloration %', min: 0, max: 5, unit: '%' },
      { field: 'purity', label: 'Purity %', min: 85, max: 100, unit: '%' },
      { field: 'grain_size', label: 'Grain Size mm', min: 4, max: 9, unit: 'mm' },
    ];

    return {
      batch,
      samples,
      photos,
      qualityParameters,
    };
  },

  /**
   * Return warehouse lots optimized for mobile stock count.
   */
  async getMobileWarehouseData(warehouseId) {
    const warehouse = await db('warehouses').where({ id: warehouseId }).first();
    if (!warehouse) throw new Error(`Warehouse ${warehouseId} not found`);

    const lots = await db('inventory_lots')
      .where({ warehouse_id: warehouseId })
      .where('qty', '>', 0)
      .orderBy('item_name')
      .select(
        'id',
        'lot_no',
        'item_name',
        'type',
        'qty',
        'unit',
        'status',
        'reserved_against',
        'updated_at'
      );

    const summary = {
      totalLots: lots.length,
      totalQtyMT: parseFloat(lots.reduce((sum, l) => sum + parseFloat(l.qty || 0), 0).toFixed(2)),
      byType: {},
    };

    for (const lot of lots) {
      const t = lot.type || 'unknown';
      if (!summary.byType[t]) summary.byType[t] = { count: 0, qtyMT: 0 };
      summary.byType[t].count++;
      summary.byType[t].qtyMT += parseFloat(lot.qty || 0);
    }

    // Round byType values
    for (const key of Object.keys(summary.byType)) {
      summary.byType[key].qtyMT = parseFloat(summary.byType[key].qtyMT.toFixed(2));
    }

    return {
      warehouse: { id: warehouse.id, name: warehouse.name, entity: warehouse.entity, type: warehouse.type },
      summary,
      lots,
    };
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PREDICTIVE INSIGHTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run all predictive models and generate alerts.
   */
  async runPredictiveAnalysis() {
    const alerts = [];
    alerts.push(...await this.predictMarginRisks());
    alerts.push(...await this.detectYieldAnomalies());
    alerts.push(...await this.predictPaymentRisks());
    alerts.push(...await this.detectCostSpikes());

    // Deduplicate: don't insert if same alert_type + entity_ref already Active
    const inserted = [];
    for (const alert of alerts) {
      const existing = await db('predictive_alerts')
        .where({
          alert_type: alert.alert_type,
          entity_ref: alert.entity_ref,
        })
        .where('status', 'Active')
        .first();

      if (!existing) {
        const [record] = await db('predictive_alerts').insert(alert).returning('*');
        inserted.push(record);
      }
    }

    return {
      totalGenerated: alerts.length,
      totalInserted: inserted.length,
      duplicatesSkipped: alerts.length - inserted.length,
      byType: inserted.reduce((acc, a) => {
        acc[a.alert_type] = (acc[a.alert_type] || 0) + 1;
        return acc;
      }, {}),
      bySeverity: inserted.reduce((acc, a) => {
        acc[a.severity] = (acc[a.severity] || 0) + 1;
        return acc;
      }, {}),
    };
  },

  /**
   * Predict margin risks for active export orders.
   */
  async predictMarginRisks() {
    const alerts = [];

    // Get active export orders with their costs
    const orders = await db('export_orders as eo')
      .whereNotIn('eo.status', ['Completed', 'Cancelled'])
      .where('eo.contract_value', '>', 0)
      .select(
        'eo.id',
        'eo.order_no',
        'eo.contract_value',
        'eo.currency',
        'eo.qty_mt',
        'eo.product_name'
      );

    for (const order of orders) {
      // Get total costs for this order
      const costData = await db('export_order_costs')
        .where({ order_id: order.id })
        .select(db.raw('COALESCE(SUM(amount), 0) as total_cost'))
        .first();

      const totalCost = parseFloat(costData.total_cost || 0);
      const contractValue = parseFloat(order.contract_value);

      if (contractValue === 0) continue;

      // Get FX rate for conversion if needed
      const fx = await db('fx_rates')
        .where({ from_currency: 'USD', to_currency: 'PKR' })
        .orderBy('effective_date', 'desc')
        .first();
      const fxRate = fx ? parseFloat(fx.rate) : 280;

      const contractPKR = order.currency === 'USD' ? contractValue * fxRate : contractValue;
      const costRatio = contractPKR > 0 ? (totalCost / contractPKR) * 100 : 0;

      // If costs trending to exceed 85% of contract value
      if (costRatio > 85) {
        const severity = costRatio > 95 ? 'critical' : 'warning';
        const margin = 100 - costRatio;

        alerts.push({
          alert_type: 'margin_risk',
          severity,
          entity_type: 'export_order',
          entity_id: order.id,
          entity_ref: order.order_no,
          prediction: `Order ${order.order_no} margin is at ${margin.toFixed(1)}% (costs are ${costRatio.toFixed(1)}% of contract value). Risk of margin squeeze.`,
          confidence_pct: totalCost > 0 ? 85 : 50,
          recommended_action: costRatio > 95
            ? 'Urgent: Review costs immediately. Consider renegotiating price or reducing expenses.'
            : 'Monitor closely. Look for cost reduction opportunities in freight and clearing.',
          supporting_data: JSON.stringify({
            contractValue: contractPKR,
            totalCost,
            costRatio: parseFloat(costRatio.toFixed(1)),
            margin: parseFloat(margin.toFixed(1)),
            fxRate,
            productName: order.product_name,
          }),
          status: 'Active',
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        });
      }
    }

    return alerts;
  },

  /**
   * Detect yield anomalies in recent milling batches.
   */
  async detectYieldAnomalies() {
    const alerts = [];

    // Get recent completed batches (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentBatches = await db('milling_batches')
      .where('completed_at', '>=', thirtyDaysAgo)
      .where('yield_pct', '>', 0)
      .select('id', 'batch_no', 'supplier_id', 'supplier_name', 'raw_qty_mt', 'actual_finished_mt', 'yield_pct');

    if (recentBatches.length === 0) return alerts;

    // Get historical average and stddev by supplier
    for (const batch of recentBatches) {
      const histData = await db('milling_batches')
        .where('yield_pct', '>', 0)
        .where('id', '!=', batch.id)
        .modify((qb) => {
          if (batch.supplier_id) {
            qb.where('supplier_id', batch.supplier_id);
          }
        })
        .select(
          db.raw('AVG(yield_pct) as avg_yield'),
          db.raw('STDDEV(yield_pct) as stddev_yield'),
          db.raw('COUNT(*) as batch_count')
        )
        .first();

      const avgYield = histData ? parseFloat(histData.avg_yield || 0) : 0;
      const stddev = histData ? parseFloat(histData.stddev_yield || 0) : 0;
      const batchCount = histData ? parseInt(histData.batch_count) : 0;

      if (avgYield === 0 || stddev === 0 || batchCount < 3) continue;

      const deviation = (parseFloat(batch.yield_pct) - avgYield) / stddev;

      // Flag if more than 2 standard deviations below mean
      if (deviation < -2) {
        // Try to identify cause
        let likelyCause = 'Unknown';
        if (batch.supplier_id) {
          // Check if this supplier consistently has lower yield
          const supplierAvg = await db('milling_batches')
            .where({ supplier_id: batch.supplier_id })
            .where('yield_pct', '>', 0)
            .select(db.raw('AVG(yield_pct) as avg'))
            .first();
          if (supplierAvg && parseFloat(supplierAvg.avg) < avgYield - stddev) {
            likelyCause = `Supplier (${batch.supplier_name}) consistently delivers lower-yielding paddy`;
          } else {
            likelyCause = 'Batch-specific quality issue — check moisture and broken content';
          }
        }

        alerts.push({
          alert_type: 'yield_anomaly',
          severity: deviation < -3 ? 'critical' : 'warning',
          entity_type: 'milling_batch',
          entity_id: batch.id,
          entity_ref: batch.batch_no,
          prediction: `Batch ${batch.batch_no} yield is ${parseFloat(batch.yield_pct).toFixed(1)}%, which is ${Math.abs(deviation).toFixed(1)} std deviations below the average of ${avgYield.toFixed(1)}%.`,
          confidence_pct: batchCount > 10 ? 85 : 65,
          recommended_action: `Investigate quality of raw material. ${likelyCause}. Consider supplier quality review.`,
          supporting_data: JSON.stringify({
            actualYield: parseFloat(batch.yield_pct),
            expectedYield: parseFloat(avgYield.toFixed(1)),
            stdDeviation: parseFloat(deviation.toFixed(2)),
            historicalBatches: batchCount,
            supplierName: batch.supplier_name,
            likelyCause,
          }),
          status: 'Active',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        });
      }
    }

    return alerts;
  },

  /**
   * Predict payment risks for customers with outstanding receivables.
   */
  async predictPaymentRisks() {
    const alerts = [];

    // Get customers with outstanding receivables
    const outstandingByCustomer = await db('receivables as r')
      .join('customers as c', 'r.customer_id', 'c.id')
      .whereIn('r.status', ['Pending', 'Overdue'])
      .where('r.outstanding', '>', 0)
      .groupBy('c.id', 'c.name')
      .select(
        'c.id as customer_id',
        'c.name as customer_name',
        db.raw('SUM(r.outstanding) as total_outstanding'),
        db.raw('MAX(r.aging) as max_aging'),
        db.raw('AVG(r.aging) as avg_aging'),
        db.raw('COUNT(*) as receivable_count'),
        db.raw('MAX(r.currency) as currency')
      );

    for (const cust of outstandingByCustomer) {
      // Get historical payment pattern for this customer
      const histPayments = await db('receivables')
        .where({ customer_id: cust.customer_id })
        .whereIn('status', ['Received', 'Paid', 'Closed'])
        .select(db.raw('AVG(aging) as avg_paid_aging'), db.raw('STDDEV(aging) as stddev_aging'), db.raw('COUNT(*) as paid_count'))
        .first();

      const avgPaidAging = histPayments ? parseFloat(histPayments.avg_paid_aging || 0) : 30;
      const stddevAging = histPayments ? parseFloat(histPayments.stddev_aging || 0) : 10;

      const currentAvgAging = parseFloat(cust.avg_aging || 0);
      const maxAging = parseInt(cust.max_aging || 0);

      // Flag if current delay > avg + 1 std dev
      if (currentAvgAging > avgPaidAging + stddevAging && currentAvgAging > 10) {
        const predictedDelay = Math.round(currentAvgAging - avgPaidAging);
        const probability = Math.min(90, 50 + (currentAvgAging - avgPaidAging) / stddevAging * 15);

        alerts.push({
          alert_type: 'payment_risk',
          severity: maxAging > 90 ? 'critical' : maxAging > 60 ? 'warning' : 'info',
          entity_type: 'customer',
          entity_id: cust.customer_id,
          entity_ref: cust.customer_name,
          prediction: `${cust.customer_name} has ${parseFloat(cust.total_outstanding).toFixed(2)} ${cust.currency} outstanding across ${cust.receivable_count} receivable(s). Current aging (${Math.round(currentAvgAging)} days) exceeds historical pattern (${Math.round(avgPaidAging)} days).`,
          confidence_pct: parseFloat(Math.min(probability, 95).toFixed(1)),
          recommended_action: maxAging > 90
            ? 'Escalate immediately. Consider withholding new shipments until payment is received.'
            : 'Contact customer for payment status. Tighten credit terms on next order.',
          supporting_data: JSON.stringify({
            totalOutstanding: parseFloat(parseFloat(cust.total_outstanding).toFixed(2)),
            currency: cust.currency,
            currentAvgAging: Math.round(currentAvgAging),
            maxAging,
            historicalAvgAging: Math.round(avgPaidAging),
            predictedDelay,
            receivableCount: parseInt(cust.receivable_count),
          }),
          status: 'Active',
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        });
      }
    }

    return alerts;
  },

  /**
   * Detect cost spikes by comparing recent costs to 3-month rolling average.
   */
  async detectCostSpikes() {
    const alerts = [];

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // Get 3-month rolling average by cost category from export_order_costs
    const rollingAvg = await db('export_order_costs')
      .where('created_at', '>=', threeMonthsAgo)
      .groupBy('category')
      .select(
        'category',
        db.raw('AVG(amount) as avg_amount'),
        db.raw('COUNT(*) as entry_count')
      );

    // Get recent month costs
    const recentCosts = await db('export_order_costs')
      .where('created_at', '>=', oneMonthAgo)
      .groupBy('category')
      .select(
        'category',
        db.raw('AVG(amount) as recent_avg'),
        db.raw('COUNT(*) as recent_count')
      );

    const avgMap = {};
    for (const r of rollingAvg) {
      avgMap[r.category] = { avg: parseFloat(r.avg_amount), count: parseInt(r.entry_count) };
    }

    for (const recent of recentCosts) {
      const baseline = avgMap[recent.category];
      if (!baseline || baseline.count < 3) continue;

      const recentAvg = parseFloat(recent.recent_avg);
      const baselineAvg = baseline.avg;
      const spikePct = baselineAvg > 0 ? ((recentAvg - baselineAvg) / baselineAvg) * 100 : 0;

      // Flag if >20% above average
      if (spikePct > 20) {
        // Find affected orders
        const affectedOrders = await db('export_order_costs as eoc')
          .join('export_orders as eo', 'eoc.order_id', 'eo.id')
          .where('eoc.category', recent.category)
          .where('eoc.created_at', '>=', oneMonthAgo)
          .where('eoc.amount', '>', baselineAvg * 1.2)
          .select('eo.order_no', 'eoc.amount')
          .limit(10);

        alerts.push({
          alert_type: 'cost_spike',
          severity: spikePct > 50 ? 'critical' : 'warning',
          entity_type: 'cost_category',
          entity_id: null,
          entity_ref: recent.category,
          prediction: `${recent.category} costs have spiked ${spikePct.toFixed(0)}% above the 3-month average. Recent avg: ${recentAvg.toFixed(0)} vs baseline: ${baselineAvg.toFixed(0)}.`,
          confidence_pct: baseline.count > 10 ? 90 : 70,
          recommended_action: `Review ${recent.category} costs. Renegotiate with vendors if possible. ${affectedOrders.length} recent order(s) affected.`,
          supporting_data: JSON.stringify({
            category: recent.category,
            baselineAvg: parseFloat(baselineAvg.toFixed(2)),
            recentAvg: parseFloat(recentAvg.toFixed(2)),
            spikePct: parseFloat(spikePct.toFixed(1)),
            baselineEntries: baseline.count,
            recentEntries: parseInt(recent.recent_count),
            affectedOrders: affectedOrders.map((o) => ({ orderNo: o.order_no, amount: parseFloat(o.amount) })),
          }),
          status: 'Active',
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        });
      }
    }

    return alerts;
  },

  /**
   * List predictive alerts with filters and pagination.
   */
  async getPredictiveAlerts({ status, alertType, page, limit }) {
    const pg = parseInt(page) || 1;
    const lim = parseInt(limit) || 25;
    const offset = (pg - 1) * lim;

    let query = db('predictive_alerts').orderBy('created_at', 'desc');
    let countQuery = db('predictive_alerts');

    if (status) {
      query = query.where('status', status);
      countQuery = countQuery.where('status', status);
    }
    if (alertType) {
      query = query.where('alert_type', alertType);
      countQuery = countQuery.where('alert_type', alertType);
    }

    const [{ count }] = await countQuery.count('* as count');
    const data = await query.limit(lim).offset(offset);

    return {
      data,
      pagination: {
        page: pg,
        limit: lim,
        total: parseInt(count),
        pages: Math.ceil(parseInt(count) / lim),
      },
    };
  },

  /**
   * Acknowledge a predictive alert.
   */
  async acknowledgePredictiveAlert(id, userId) {
    const [updated] = await db('predictive_alerts')
      .where({ id })
      .update({ status: 'Acknowledged' })
      .returning('*');

    if (!updated) throw new Error(`Alert ${id} not found`);
    return updated;
  },

  /**
   * Dismiss a predictive alert.
   */
  async dismissPredictiveAlert(id, userId) {
    const [updated] = await db('predictive_alerts')
      .where({ id })
      .update({ status: 'Dismissed' })
      .returning('*');

    if (!updated) throw new Error(`Alert ${id} not found`);
    return updated;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO LISTING
  // ═══════════════════════════════════════════════════════════════════════════

  async listScenarios({ scenarioType, page, limit }) {
    const pg = parseInt(page) || 1;
    const lim = parseInt(limit) || 25;
    const offset = (pg - 1) * lim;

    let query = db('scenarios').orderBy('created_at', 'desc');
    let countQuery = db('scenarios');

    if (scenarioType) {
      query = query.where('scenario_type', scenarioType);
      countQuery = countQuery.where('scenario_type', scenarioType);
    }

    const [{ count }] = await countQuery.count('* as count');
    const data = await query.limit(lim).offset(offset);

    return {
      data,
      pagination: {
        page: pg,
        limit: lim,
        total: parseInt(count),
        pages: Math.ceil(parseInt(count) / lim),
      },
    };
  },

  async getScenarioById(id) {
    const scenario = await db('scenarios').where({ id }).first();
    if (!scenario) throw new Error(`Scenario ${id} not found`);
    return scenario;
  },
};

module.exports = smartService;
