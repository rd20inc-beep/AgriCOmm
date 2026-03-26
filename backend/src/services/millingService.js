const db = require('../config/database');
const inventoryService = require('./inventoryService');

/**
 * Generate sequential number with a given prefix: PP-001, RP-001, etc.
 */
async function generateSeqNo(trx, table, column, prefix) {
  const last = await (trx || db)(table)
    .select(column)
    .orderBy('created_at', 'desc')
    .first();

  if (!last || !last[column]) {
    return `${prefix}-001`;
  }

  const num = parseInt(last[column].replace(`${prefix}-`, ''), 10) || 0;
  return `${prefix}-${String(num + 1).padStart(3, '0')}`;
}

const millingService = {
  // =========================================================================
  // Production Planning
  // =========================================================================

  async createProductionPlan(trx, data) {
    const conn = trx || db;
    const planNo = await generateSeqNo(conn, 'production_plans', 'plan_no', 'PP');

    const [plan] = await conn('production_plans')
      .insert({
        plan_no: planNo,
        batch_id: data.batchId || null,
        mill_id: data.millId || null,
        planned_date: data.plannedDate,
        shift: data.shift || null,
        machine_line: data.machineLine || null,
        planned_qty_mt: parseFloat(data.plannedQtyMT) || 0,
        actual_qty_mt: 0,
        status: 'Planned',
        operator_name: data.operatorName || null,
        notes: data.notes || null,
        created_by: data.userId || null,
      })
      .returning('*');

    return plan;
  },

  async startProduction(trx, { planId, startTime, userId }) {
    const plan = await trx('production_plans').where({ id: planId }).first();
    if (!plan) throw new Error(`Production plan ${planId} not found`);
    if (plan.status !== 'Planned') {
      throw new Error(`Cannot start plan in status "${plan.status}"`);
    }

    const [updated] = await trx('production_plans')
      .where({ id: planId })
      .update({
        status: 'In Progress',
        start_time: startTime || trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*');

    // Update linked batch status to In Progress if it exists
    if (plan.batch_id) {
      await trx('milling_batches')
        .where({ id: plan.batch_id })
        .whereNot({ status: 'Completed' })
        .update({
          status: 'In Progress',
          updated_at: trx.fn.now(),
        });
    }

    return updated;
  },

  async completeProduction(trx, { planId, actualQty, endTime, userId }) {
    const plan = await trx('production_plans').where({ id: planId }).first();
    if (!plan) throw new Error(`Production plan ${planId} not found`);
    if (plan.status !== 'In Progress') {
      throw new Error(`Cannot complete plan in status "${plan.status}"`);
    }

    const end = endTime ? new Date(endTime) : new Date();
    const start = plan.start_time ? new Date(plan.start_time) : end;
    const processingHours = Math.max(0, (end - start) / (1000 * 60 * 60));

    const [updated] = await trx('production_plans')
      .where({ id: planId })
      .update({
        status: 'Completed',
        actual_qty_mt: parseFloat(actualQty) || 0,
        end_time: end,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    // Update linked batch processing hours
    if (plan.batch_id) {
      const batch = await trx('milling_batches').where({ id: plan.batch_id }).first();
      const existingHours = parseFloat(batch.processing_hours) || 0;
      await trx('milling_batches')
        .where({ id: plan.batch_id })
        .update({
          processing_hours: existingHours + parseFloat(processingHours.toFixed(2)),
          updated_at: trx.fn.now(),
        });
    }

    return { plan: updated, processingHours: parseFloat(processingHours.toFixed(2)) };
  },

  // =========================================================================
  // Machine Downtime
  // =========================================================================

  async recordDowntime(trx, { millId, machineLine, batchId, startTime, reason, description, userId }) {
    const [record] = await trx('machine_downtime')
      .insert({
        mill_id: millId,
        machine_line: machineLine,
        batch_id: batchId || null,
        start_time: startTime,
        reason: reason || 'Other',
        description: description || null,
        resolved: false,
        reported_by: userId || null,
      })
      .returning('*');

    return record;
  },

  async resolveDowntime(trx, { downtimeId, endTime, impactMT }) {
    const record = await trx('machine_downtime').where({ id: downtimeId }).first();
    if (!record) throw new Error(`Downtime record ${downtimeId} not found`);
    if (record.resolved) throw new Error('Downtime record is already resolved');

    const end = endTime ? new Date(endTime) : new Date();
    const start = new Date(record.start_time);
    const durationMinutes = Math.max(0, Math.round((end - start) / (1000 * 60)));

    const [updated] = await trx('machine_downtime')
      .where({ id: downtimeId })
      .update({
        end_time: end,
        duration_minutes: durationMinutes,
        impact_mt: parseFloat(impactMT) || 0,
        resolved: true,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    return updated;
  },

  // =========================================================================
  // Utility Consumption
  // =========================================================================

  async recordUtility(trx, { batchId, millId, utilityType, readingStart, readingEnd, ratePerUnit, unit, periodStart, periodEnd, userId }) {
    const start = parseFloat(readingStart) || 0;
    const end = parseFloat(readingEnd) || 0;
    const consumption = end - start;
    const rate = parseFloat(ratePerUnit) || 0;
    const totalCost = consumption * rate;

    const [record] = await trx('utility_consumption')
      .insert({
        batch_id: batchId || null,
        mill_id: millId,
        utility_type: utilityType,
        reading_start: start,
        reading_end: end,
        consumption,
        unit: unit || 'kWh',
        rate_per_unit: rate,
        total_cost: totalCost,
        currency: 'PKR',
        period_start: periodStart || null,
        period_end: periodEnd || null,
        recorded_by: userId || null,
      })
      .returning('*');

    // Auto-create/update milling_cost for the batch if linked
    if (batchId) {
      const costCategory = utilityType ? utilityType.toLowerCase() : 'utility';

      const existing = await trx('milling_costs')
        .where({ batch_id: batchId, category: costCategory })
        .first();

      if (existing) {
        const newAmount = parseFloat(existing.amount) + totalCost;
        await trx('milling_costs')
          .where({ id: existing.id })
          .update({
            amount: newAmount,
            notes: `Auto-updated from utility consumption record`,
            updated_at: trx.fn.now(),
          });
      } else {
        await trx('milling_costs').insert({
          batch_id: batchId,
          category: costCategory,
          amount: totalCost,
          currency: 'PKR',
          notes: `Auto-created from utility consumption record`,
        });
      }
    }

    return record;
  },

  // =========================================================================
  // Recovery Benchmarks
  // =========================================================================

  async getBenchmark(productId, variety) {
    let query = db('recovery_benchmarks');
    if (productId) query = query.where('product_id', productId);
    if (variety) query = query.where('variety', variety);
    return query.first();
  },

  async compareBatchToRecoveryBenchmark(batchId) {
    const batch = await db('milling_batches').where({ id: batchId }).first();
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    // Find applicable benchmark
    let benchmark = null;
    if (batch.benchmark_id) {
      benchmark = await db('recovery_benchmarks').where({ id: batch.benchmark_id }).first();
    }
    if (!benchmark && batch.product_id) {
      benchmark = await db('recovery_benchmarks').where({ product_id: batch.product_id }).first();
    }
    if (!benchmark) {
      return { batch, benchmark: null, comparison: null, message: 'No benchmark found for this batch' };
    }

    const rawQty = parseFloat(batch.raw_qty_mt) || 1;
    const actualFinished = parseFloat(batch.actual_finished_mt) || 0;
    const actualBroken = parseFloat(batch.broken_mt) || 0;
    const actualBran = parseFloat(batch.bran_mt) || 0;
    const actualHusk = parseFloat(batch.husk_mt) || 0;
    const actualWastage = parseFloat(batch.wastage_mt) || 0;

    const actualYieldPct = (actualFinished / rawQty) * 100;
    const actualBrokenPct = (actualBroken / rawQty) * 100;
    const actualBranPct = (actualBran / rawQty) * 100;
    const actualHuskPct = (actualHusk / rawQty) * 100;
    const actualWastagePct = (actualWastage / rawQty) * 100;

    const THRESHOLD = 3.0; // % variance threshold for flagging

    const metrics = [
      {
        metric: 'yield',
        expected: parseFloat(benchmark.expected_yield_pct) || 0,
        actual: parseFloat(actualYieldPct.toFixed(2)),
      },
      {
        metric: 'broken',
        expected: parseFloat(benchmark.expected_broken_pct) || 0,
        actual: parseFloat(actualBrokenPct.toFixed(2)),
      },
      {
        metric: 'bran',
        expected: parseFloat(benchmark.expected_bran_pct) || 0,
        actual: parseFloat(actualBranPct.toFixed(2)),
      },
      {
        metric: 'husk',
        expected: parseFloat(benchmark.expected_husk_pct) || 0,
        actual: parseFloat(actualHuskPct.toFixed(2)),
      },
      {
        metric: 'wastage',
        expected: parseFloat(benchmark.expected_wastage_pct) || 0,
        actual: parseFloat(actualWastagePct.toFixed(2)),
      },
    ];

    const comparison = metrics.map((m) => {
      const variance = parseFloat((m.actual - m.expected).toFixed(2));
      // For yield, negative variance is bad; for others, positive variance is bad
      const isBad =
        m.metric === 'yield'
          ? variance < -THRESHOLD
          : variance > THRESHOLD;
      return {
        ...m,
        variance,
        status: isBad ? 'FAIL' : 'PASS',
      };
    });

    const overallPass = comparison.every((c) => c.status === 'PASS');

    return {
      batch: { id: batch.id, batch_no: batch.batch_no },
      benchmark: { id: benchmark.id, variety: benchmark.variety, season: benchmark.season },
      comparison,
      overall: overallPass ? 'PASS' : 'FAIL',
    };
  },

  // =========================================================================
  // Post-Milling Quality
  // =========================================================================

  async recordPostMillingQuality(trx, { batchId, productType, moisture, brokenPct, chalkyPct, whiteness, grainLength, foreignMatter, gradeAssigned, inspector }) {
    const [record] = await trx('milling_quality_post')
      .insert({
        batch_id: batchId,
        product_type: productType || 'finished',
        moisture: moisture != null ? parseFloat(moisture) : null,
        broken_pct: brokenPct != null ? parseFloat(brokenPct) : null,
        chalky_pct: chalkyPct != null ? parseFloat(chalkyPct) : null,
        whiteness: whiteness != null ? parseFloat(whiteness) : null,
        grain_length: grainLength != null ? parseFloat(grainLength) : null,
        foreign_matter: foreignMatter != null ? parseFloat(foreignMatter) : null,
        grade_assigned: gradeAssigned || null,
        inspector: inspector || null,
        inspected_at: trx.fn.now(),
      })
      .returning('*');

    // Update post_milling_grade on the batch if grade is assigned for finished product
    if (productType === 'finished' && gradeAssigned) {
      await trx('milling_batches')
        .where({ id: batchId })
        .update({
          post_milling_grade: gradeAssigned,
          updated_at: trx.fn.now(),
        });
    }

    return record;
  },

  // =========================================================================
  // Source Lot Management
  // =========================================================================

  async addSourceLot(trx, { batchId, lotId, qtyMT }) {
    const lot = await trx('inventory_lots').where({ id: lotId }).first();
    if (!lot) throw new Error(`Inventory lot ${lotId} not found`);

    const availableQty = parseFloat(lot.available_qty) || 0;
    const requestedQty = parseFloat(qtyMT);
    if (availableQty < requestedQty) {
      throw new Error(
        `Insufficient available qty in lot ${lot.lot_no}: available ${availableQty} ${lot.unit}, requested ${requestedQty}`
      );
    }

    const [record] = await trx('batch_source_lots')
      .insert({
        batch_id: batchId,
        lot_id: lotId,
        qty_mt: requestedQty,
      })
      .returning('*');

    return record;
  },

  async getSourceLots(batchId) {
    return db('batch_source_lots as bsl')
      .leftJoin('inventory_lots as il', 'bsl.lot_id', 'il.id')
      .select(
        'bsl.*',
        'il.lot_no',
        'il.item_name',
        'il.qty as lot_qty',
        'il.available_qty as lot_available_qty'
      )
      .where('bsl.batch_id', batchId)
      .orderBy('bsl.created_at', 'asc');
  },

  // =========================================================================
  // Reprocessing
  // =========================================================================

  async createReprocessingBatch(trx, { originalBatchId, reason, inputProduct, inputQtyMT, userId }) {
    const reprocessNo = await generateSeqNo(trx, 'reprocessing_batches', 'reprocess_no', 'RP');

    const batch = await trx('milling_batches').where({ id: originalBatchId }).first();
    if (!batch) throw new Error(`Original batch ${originalBatchId} not found`);

    const [record] = await trx('reprocessing_batches')
      .insert({
        reprocess_no: reprocessNo,
        original_batch_id: originalBatchId,
        reason,
        input_product: inputProduct || null,
        input_qty_mt: parseFloat(inputQtyMT) || 0,
        output_qty_mt: 0,
        wastage_mt: 0,
        status: 'Pending',
        created_by: userId || null,
      })
      .returning('*');

    // Consume from original batch output — find applicable finished/byproduct lot
    const lotType = (inputProduct || '').toLowerCase().includes('broken') ? 'byproduct' : 'finished';
    const sourceLot = await trx('inventory_lots')
      .where({ batch_ref: `batch-${originalBatchId}`, type: lotType, entity: 'mill' })
      .where('available_qty', '>=', parseFloat(inputQtyMT))
      .first();

    let movement = null;
    if (sourceLot) {
      movement = await inventoryService.postMovement(trx, {
        movementType: inventoryService.MOVEMENT_TYPES.PRODUCTION_ISSUE,
        lotId: sourceLot.id,
        qty: parseFloat(inputQtyMT),
        fromWarehouseId: sourceLot.warehouse_id,
        sourceEntity: 'mill',
        linkedRef: `reprocess-${reprocessNo}`,
        notes: `Consumed for reprocessing ${reprocessNo} from batch ${batch.batch_no}`,
        costPerUnit: parseFloat(sourceLot.cost_per_unit) || 0,
        currency: sourceLot.cost_currency || 'PKR',
        batchId: originalBatchId,
        userId,
      });
    }

    return { reprocessing: record, movement };
  },

  async completeReprocessing(trx, { reprocessId, outputQtyMT, wastageMT }) {
    const record = await trx('reprocessing_batches').where({ id: reprocessId }).first();
    if (!record) throw new Error(`Reprocessing batch ${reprocessId} not found`);
    if (record.status === 'Completed') throw new Error('Reprocessing batch is already completed');

    const [updated] = await trx('reprocessing_batches')
      .where({ id: reprocessId })
      .update({
        output_qty_mt: parseFloat(outputQtyMT) || 0,
        wastage_mt: parseFloat(wastageMT) || 0,
        status: 'Completed',
        updated_at: trx.fn.now(),
      })
      .returning('*');

    return updated;
  },

  // =========================================================================
  // Operational Analytics
  // =========================================================================

  async getMillUtilization(millId, dateFrom, dateTo) {
    let query = db('production_plans').where('mill_id', millId);
    if (dateFrom) query = query.where('planned_date', '>=', dateFrom);
    if (dateTo) query = query.where('planned_date', '<=', dateTo);

    const plans = await query.select('*');

    let totalPlannedHours = 0;
    let totalActualHours = 0;
    let completedPlans = 0;

    for (const plan of plans) {
      const plannedQty = parseFloat(plan.planned_qty_mt) || 0;
      // Estimate planned hours based on mill capacity (assume 8-hour shift produces planned qty)
      totalPlannedHours += 8; // Each plan represents one shift

      if (plan.start_time && plan.end_time) {
        const hours = (new Date(plan.end_time) - new Date(plan.start_time)) / (1000 * 60 * 60);
        totalActualHours += Math.max(0, hours);
      }

      if (plan.status === 'Completed') completedPlans++;
    }

    // Get downtime for this mill in the period
    let dtQuery = db('machine_downtime')
      .where('mill_id', millId)
      .where('resolved', true);
    if (dateFrom) dtQuery = dtQuery.where('start_time', '>=', dateFrom);
    if (dateTo) dtQuery = dtQuery.where('start_time', '<=', dateTo);

    const downtimeRecords = await dtQuery.select('duration_minutes');
    const totalDowntimeHours = downtimeRecords.reduce(
      (sum, r) => sum + ((parseInt(r.duration_minutes) || 0) / 60),
      0
    );

    const effectiveHours = totalActualHours - totalDowntimeHours;
    const utilizationPct = totalPlannedHours > 0
      ? parseFloat(((effectiveHours / totalPlannedHours) * 100).toFixed(2))
      : 0;

    return {
      mill_id: millId,
      period: { from: dateFrom, to: dateTo },
      total_plans: plans.length,
      completed_plans: completedPlans,
      total_planned_hours: parseFloat(totalPlannedHours.toFixed(2)),
      total_actual_hours: parseFloat(totalActualHours.toFixed(2)),
      total_downtime_hours: parseFloat(totalDowntimeHours.toFixed(2)),
      effective_hours: parseFloat(effectiveHours.toFixed(2)),
      utilization_pct: utilizationPct,
    };
  },

  async getRecoveryTrends({ supplierId, productId, dateFrom, dateTo }) {
    let query = db('milling_batches as mb')
      .where('mb.status', 'Completed')
      .where('mb.raw_qty_mt', '>', 0);

    if (supplierId) query = query.where('mb.supplier_id', supplierId);
    if (productId) query = query.where('mb.product_id', productId);
    if (dateFrom) query = query.where('mb.completed_at', '>=', dateFrom);
    if (dateTo) query = query.where('mb.completed_at', '<=', dateTo);

    const batches = await query
      .select(
        'mb.id',
        'mb.batch_no',
        'mb.raw_qty_mt',
        'mb.actual_finished_mt',
        'mb.broken_mt',
        'mb.bran_mt',
        'mb.husk_mt',
        'mb.wastage_mt',
        'mb.yield_pct',
        'mb.completed_at',
        'mb.supplier_id'
      )
      .orderBy('mb.completed_at', 'asc');

    const trends = batches.map((b) => {
      const raw = parseFloat(b.raw_qty_mt) || 1;
      return {
        batch_id: b.id,
        batch_no: b.batch_no,
        completed_at: b.completed_at,
        supplier_id: b.supplier_id,
        yield_pct: parseFloat(((parseFloat(b.actual_finished_mt) / raw) * 100).toFixed(2)),
        broken_pct: parseFloat(((parseFloat(b.broken_mt) / raw) * 100).toFixed(2)),
        bran_pct: parseFloat(((parseFloat(b.bran_mt) / raw) * 100).toFixed(2)),
        husk_pct: parseFloat(((parseFloat(b.husk_mt) / raw) * 100).toFixed(2)),
        wastage_pct: parseFloat(((parseFloat(b.wastage_mt) / raw) * 100).toFixed(2)),
      };
    });

    // Compute averages
    const count = trends.length || 1;
    const avg = {
      yield_pct: parseFloat((trends.reduce((s, t) => s + t.yield_pct, 0) / count).toFixed(2)),
      broken_pct: parseFloat((trends.reduce((s, t) => s + t.broken_pct, 0) / count).toFixed(2)),
      bran_pct: parseFloat((trends.reduce((s, t) => s + t.bran_pct, 0) / count).toFixed(2)),
      husk_pct: parseFloat((trends.reduce((s, t) => s + t.husk_pct, 0) / count).toFixed(2)),
      wastage_pct: parseFloat((trends.reduce((s, t) => s + t.wastage_pct, 0) / count).toFixed(2)),
    };

    return { trends, averages: avg, batch_count: trends.length };
  },

  async getSupplierRecoveryComparison() {
    const rows = await db('milling_batches as mb')
      .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
      .where('mb.status', 'Completed')
      .where('mb.raw_qty_mt', '>', 0)
      .select(
        'mb.supplier_id',
        's.name as supplier_name'
      )
      .avg('mb.yield_pct as avg_yield_pct')
      .sum('mb.raw_qty_mt as total_raw_mt')
      .sum('mb.actual_finished_mt as total_finished_mt')
      .sum('mb.broken_mt as total_broken_mt')
      .count('mb.id as batch_count')
      .groupBy('mb.supplier_id', 's.name')
      .orderBy('avg_yield_pct', 'desc');

    const ranked = rows.map((r, index) => ({
      rank: index + 1,
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
      batch_count: parseInt(r.batch_count),
      total_raw_mt: parseFloat(parseFloat(r.total_raw_mt).toFixed(2)),
      total_finished_mt: parseFloat(parseFloat(r.total_finished_mt).toFixed(2)),
      total_broken_mt: parseFloat(parseFloat(r.total_broken_mt).toFixed(2)),
      avg_yield_pct: parseFloat(parseFloat(r.avg_yield_pct).toFixed(2)),
    }));

    return ranked;
  },

  async getOperatorProductivity() {
    const rows = await db('production_plans')
      .whereNotNull('operator_name')
      .where('status', 'Completed')
      .select('operator_name', 'shift')
      .sum('actual_qty_mt as total_output_mt')
      .count('id as shift_count')
      .groupBy('operator_name', 'shift')
      .orderBy('total_output_mt', 'desc');

    return rows.map((r) => ({
      operator_name: r.operator_name,
      shift: r.shift,
      shift_count: parseInt(r.shift_count),
      total_output_mt: parseFloat(parseFloat(r.total_output_mt).toFixed(2)),
      avg_output_per_shift: parseFloat(
        (parseFloat(r.total_output_mt) / (parseInt(r.shift_count) || 1)).toFixed(2)
      ),
    }));
  },

  async getMoistureAnalysis() {
    // Get pre-milling (arrival) moisture and post-milling moisture for completed batches
    const batches = await db('milling_batches as mb')
      .where('mb.status', 'Completed')
      .select(
        'mb.id',
        'mb.batch_no',
        'mb.moisture_loss_pct',
        'mb.raw_qty_mt'
      )
      .orderBy('mb.completed_at', 'asc');

    const results = [];

    for (const batch of batches) {
      // Get arrival moisture
      const arrivalSample = await db('milling_quality_samples')
        .where({ batch_id: batch.id, analysis_type: 'arrival' })
        .orderBy('created_at', 'desc')
        .first();

      // Get post-milling moisture
      const postQuality = await db('milling_quality_post')
        .where({ batch_id: batch.id, product_type: 'finished' })
        .orderBy('created_at', 'desc')
        .first();

      const arrivalMoisture = arrivalSample ? parseFloat(arrivalSample.moisture) : null;
      const postMoisture = postQuality ? parseFloat(postQuality.moisture) : null;
      const moistureLoss = arrivalMoisture != null && postMoisture != null
        ? parseFloat((arrivalMoisture - postMoisture).toFixed(2))
        : parseFloat(batch.moisture_loss_pct) || null;

      results.push({
        batch_id: batch.id,
        batch_no: batch.batch_no,
        arrival_moisture: arrivalMoisture,
        post_milling_moisture: postMoisture,
        moisture_loss: moistureLoss,
        recorded_loss_pct: parseFloat(batch.moisture_loss_pct) || 0,
      });
    }

    // Averages
    const withData = results.filter((r) => r.moisture_loss != null);
    const avgLoss = withData.length > 0
      ? parseFloat((withData.reduce((s, r) => s + r.moisture_loss, 0) / withData.length).toFixed(2))
      : 0;

    return { batches: results, avg_moisture_loss: avgLoss, sample_count: withData.length };
  },

  async getBatchProfitabilityVariance(batchId) {
    const batch = await db('milling_batches').where({ id: batchId }).first();
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    // Get all costs
    const costs = await db('milling_costs').where({ batch_id: batchId });
    const totalActualCost = costs.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

    // Get benchmark if available
    let benchmark = null;
    if (batch.benchmark_id) {
      benchmark = await db('recovery_benchmarks').where({ id: batch.benchmark_id }).first();
    }

    const rawQty = parseFloat(batch.raw_qty_mt) || 0;
    const finishedQty = parseFloat(batch.actual_finished_mt) || 0;
    const brokenQty = parseFloat(batch.broken_mt) || 0;

    // Estimate expected quantities from benchmark
    let expectedFinished = parseFloat(batch.planned_finished_mt) || 0;
    let expectedBroken = 0;
    if (benchmark) {
      expectedFinished = rawQty * ((parseFloat(benchmark.expected_yield_pct) || 0) / 100);
      expectedBroken = rawQty * ((parseFloat(benchmark.expected_broken_pct) || 0) / 100);
    }

    // Estimated revenue (use average market rates — these would come from config in production)
    // For now, use cost data to derive
    const rawRiceCost = costs.find((c) => c.category === 'rawRice' || c.category === 'raw_rice');
    const rawPricePerMT = rawRiceCost && rawQty > 0
      ? parseFloat(rawRiceCost.amount) / rawQty
      : 0;

    // Typical rice processing: finished rice sells at 1.5-2x raw cost, broken at 0.6x
    const finishedPricePerMT = rawPricePerMT * 1.6;
    const brokenPricePerMT = rawPricePerMT * 0.6;

    const expectedRevenue = (expectedFinished * finishedPricePerMT) + (expectedBroken * brokenPricePerMT);
    const actualRevenue = (finishedQty * finishedPricePerMT) + (brokenQty * brokenPricePerMT);

    const costBreakdown = {};
    for (const c of costs) {
      costBreakdown[c.category] = parseFloat(c.amount) || 0;
    }

    return {
      batch_id: batchId,
      batch_no: batch.batch_no,
      raw_qty_mt: rawQty,
      expected: {
        finished_mt: parseFloat(expectedFinished.toFixed(2)),
        broken_mt: parseFloat(expectedBroken.toFixed(2)),
        revenue: parseFloat(expectedRevenue.toFixed(2)),
      },
      actual: {
        finished_mt: finishedQty,
        broken_mt: brokenQty,
        revenue: parseFloat(actualRevenue.toFixed(2)),
      },
      revenue_variance: parseFloat((actualRevenue - expectedRevenue).toFixed(2)),
      total_cost: parseFloat(totalActualCost.toFixed(2)),
      cost_breakdown: costBreakdown,
      estimated_profit: parseFloat((actualRevenue - totalActualCost).toFixed(2)),
      expected_profit: parseFloat((expectedRevenue - totalActualCost).toFixed(2)),
      profit_variance: parseFloat(((actualRevenue - totalActualCost) - (expectedRevenue - totalActualCost)).toFixed(2)),
    };
  },
};

module.exports = millingService;
