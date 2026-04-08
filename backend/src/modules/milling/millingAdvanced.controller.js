const db = require('../../config/database');
const millingService = require('../../services/millingService');

const millingAdvancedController = {
  // =========================================================================
  // Production Plans
  // =========================================================================

  async listPlans(req, res) {
    try {
      const { page = 1, limit = 20, status, mill_id } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('production_plans as pp')
        .leftJoin('milling_batches as mb', 'pp.batch_id', 'mb.id')
        .leftJoin('mills as m', 'pp.mill_id', 'm.id')
        .select(
          'pp.*',
          'mb.batch_no',
          'm.name as mill_name'
        );

      if (status) query = query.where('pp.status', status);
      if (mill_id) query = query.where('pp.mill_id', mill_id);

      const countQuery = query.clone().clearSelect().clearOrder().count('pp.id as total').first();
      const [plans, countResult] = await Promise.all([
        query.orderBy('pp.planned_date', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);
      return res.json({
        success: true,
        data: {
          plans,
          pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
        },
      });
    } catch (err) {
      console.error('listPlans error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createPlan(req, res) {
    try {
      const { batch_id, mill_id, planned_date, shift, machine_line, planned_qty_mt, operator_name, notes } = req.body;

      if (!planned_date) {
        return res.status(400).json({ success: false, message: 'planned_date is required.' });
      }

      const plan = await db.transaction(async (trx) => {
        return millingService.createProductionPlan(trx, {
          batchId: batch_id,
          millId: mill_id,
          plannedDate: planned_date,
          shift,
          machineLine: machine_line,
          plannedQtyMT: planned_qty_mt,
          operatorName: operator_name,
          notes,
          userId: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: { plan } });
    } catch (err) {
      console.error('createPlan error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async startPlan(req, res) {
    try {
      const { id } = req.params;
      const { start_time } = req.body;

      const plan = await db.transaction(async (trx) => {
        return millingService.startProduction(trx, {
          planId: id,
          startTime: start_time,
          userId: req.user.id,
        });
      });

      return res.json({ success: true, data: { plan } });
    } catch (err) {
      console.error('startPlan error:', err);
      const status = err.message.includes('not found') ? 404 : 400;
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  async completePlan(req, res) {
    try {
      const { id } = req.params;
      const { actual_qty_mt, end_time } = req.body;

      const result = await db.transaction(async (trx) => {
        return millingService.completeProduction(trx, {
          planId: id,
          actualQty: actual_qty_mt,
          endTime: end_time,
          userId: req.user.id,
        });
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('completePlan error:', err);
      const status = err.message.includes('not found') ? 404 : 400;
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // =========================================================================
  // Machine Downtime
  // =========================================================================

  async listDowntime(req, res) {
    try {
      const { page = 1, limit = 20, mill_id, resolved } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('machine_downtime as md')
        .leftJoin('mills as m', 'md.mill_id', 'm.id')
        .select('md.*', 'm.name as mill_name');

      if (mill_id) query = query.where('md.mill_id', mill_id);
      if (resolved !== undefined) query = query.where('md.resolved', resolved === 'true');

      const countQuery = query.clone().clearSelect().clearOrder().count('md.id as total').first();
      const [records, countResult] = await Promise.all([
        query.orderBy('md.start_time', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);
      return res.json({
        success: true,
        data: {
          downtime: records,
          pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
        },
      });
    } catch (err) {
      console.error('listDowntime error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async recordDowntime(req, res) {
    try {
      const { mill_id, machine_line, batch_id, start_time, reason, description } = req.body;

      if (!mill_id || !machine_line || !start_time) {
        return res.status(400).json({ success: false, message: 'mill_id, machine_line, and start_time are required.' });
      }

      const record = await db.transaction(async (trx) => {
        return millingService.recordDowntime(trx, {
          millId: mill_id,
          machineLine: machine_line,
          batchId: batch_id,
          startTime: start_time,
          reason,
          description,
          userId: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: { downtime: record } });
    } catch (err) {
      console.error('recordDowntime error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async resolveDowntime(req, res) {
    try {
      const { id } = req.params;
      const { end_time, impact_mt } = req.body;

      const record = await db.transaction(async (trx) => {
        return millingService.resolveDowntime(trx, {
          downtimeId: id,
          endTime: end_time,
          impactMT: impact_mt,
        });
      });

      return res.json({ success: true, data: { downtime: record } });
    } catch (err) {
      console.error('resolveDowntime error:', err);
      const status = err.message.includes('not found') ? 404 : 400;
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // =========================================================================
  // Utility Consumption
  // =========================================================================

  async listUtilities(req, res) {
    try {
      const { page = 1, limit = 20, batch_id, mill_id, utility_type } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('utility_consumption as uc')
        .leftJoin('mills as m', 'uc.mill_id', 'm.id')
        .leftJoin('milling_batches as mb', 'uc.batch_id', 'mb.id')
        .select('uc.*', 'm.name as mill_name', 'mb.batch_no');

      if (batch_id) query = query.where('uc.batch_id', batch_id);
      if (mill_id) query = query.where('uc.mill_id', mill_id);
      if (utility_type) query = query.where('uc.utility_type', utility_type);

      const countQuery = query.clone().clearSelect().clearOrder().count('uc.id as total').first();
      const [records, countResult] = await Promise.all([
        query.orderBy('uc.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);
      return res.json({
        success: true,
        data: {
          utilities: records,
          pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
        },
      });
    } catch (err) {
      console.error('listUtilities error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async recordUtility(req, res) {
    try {
      const { batch_id, mill_id, utility_type, reading_start, reading_end, rate_per_unit, unit, period_start, period_end } = req.body;

      if (!mill_id || !utility_type) {
        return res.status(400).json({ success: false, message: 'mill_id and utility_type are required.' });
      }

      const record = await db.transaction(async (trx) => {
        return millingService.recordUtility(trx, {
          batchId: batch_id,
          millId: mill_id,
          utilityType: utility_type,
          readingStart: reading_start,
          readingEnd: reading_end,
          ratePerUnit: rate_per_unit,
          unit,
          periodStart: period_start,
          periodEnd: period_end,
          userId: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: { utility: record } });
    } catch (err) {
      console.error('recordUtility error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // =========================================================================
  // Recovery Benchmarks
  // =========================================================================

  async listBenchmarks(req, res) {
    try {
      const benchmarks = await db('recovery_benchmarks as rb')
        .leftJoin('products as p', 'rb.product_id', 'p.id')
        .select('rb.*', 'p.name as product_name')
        .orderBy('rb.variety', 'asc');

      return res.json({ success: true, data: { benchmarks } });
    } catch (err) {
      console.error('listBenchmarks error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createBenchmark(req, res) {
    try {
      const {
        product_id, variety, season,
        expected_yield_pct, expected_broken_pct, expected_bran_pct,
        expected_husk_pct, expected_wastage_pct,
        moisture_range_min, moisture_range_max, notes,
      } = req.body;

      const [benchmark] = await db('recovery_benchmarks')
        .insert({
          product_id: product_id || null,
          variety,
          season: season || null,
          expected_yield_pct: parseFloat(expected_yield_pct) || 0,
          expected_broken_pct: parseFloat(expected_broken_pct) || 0,
          expected_bran_pct: parseFloat(expected_bran_pct) || 0,
          expected_husk_pct: parseFloat(expected_husk_pct) || 0,
          expected_wastage_pct: parseFloat(expected_wastage_pct) || 0,
          moisture_range_min: moisture_range_min != null ? parseFloat(moisture_range_min) : null,
          moisture_range_max: moisture_range_max != null ? parseFloat(moisture_range_max) : null,
          notes: notes || null,
        })
        .returning('*');

      return res.status(201).json({ success: true, data: { benchmark } });
    } catch (err) {
      console.error('createBenchmark error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateBenchmark(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      delete updates.id;
      delete updates.created_at;
      updates.updated_at = db.fn.now();

      const [benchmark] = await db('recovery_benchmarks')
        .where({ id })
        .update(updates)
        .returning('*');

      if (!benchmark) {
        return res.status(404).json({ success: false, message: 'Benchmark not found.' });
      }

      return res.json({ success: true, data: { benchmark } });
    } catch (err) {
      console.error('updateBenchmark error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async compareBenchmark(req, res) {
    try {
      const { id } = req.params;
      const result = await millingService.compareBatchToRecoveryBenchmark(id);
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('compareBenchmark error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // =========================================================================
  // Post-Milling Quality
  // =========================================================================

  async listPostQuality(req, res) {
    try {
      const { id } = req.params;
      const records = await db('milling_quality_post')
        .where({ batch_id: id })
        .orderBy('created_at', 'asc');

      return res.json({ success: true, data: { quality: records } });
    } catch (err) {
      console.error('listPostQuality error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async recordPostQuality(req, res) {
    try {
      const { id } = req.params;
      const { product_type, moisture, broken_pct, chalky_pct, whiteness, grain_length, foreign_matter, grade_assigned, inspector } = req.body;

      const batch = await db('milling_batches').where({ id }).first();
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      const record = await db.transaction(async (trx) => {
        return millingService.recordPostMillingQuality(trx, {
          batchId: id,
          productType: product_type,
          moisture,
          brokenPct: broken_pct,
          chalkyPct: chalky_pct,
          whiteness,
          grainLength: grain_length,
          foreignMatter: foreign_matter,
          gradeAssigned: grade_assigned,
          inspector,
        });
      });

      return res.status(201).json({ success: true, data: { quality: record } });
    } catch (err) {
      console.error('recordPostQuality error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // =========================================================================
  // Source Lots
  // =========================================================================

  async listSourceLots(req, res) {
    try {
      const { id } = req.params;
      const lots = await millingService.getSourceLots(id);
      return res.json({ success: true, data: { source_lots: lots } });
    } catch (err) {
      console.error('listSourceLots error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async addSourceLot(req, res) {
    try {
      const { id } = req.params;
      const { lot_id, qty_mt } = req.body;

      if (!lot_id || !qty_mt) {
        return res.status(400).json({ success: false, message: 'lot_id and qty_mt are required.' });
      }

      const batch = await db('milling_batches').where({ id }).first();
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      const record = await db.transaction(async (trx) => {
        return millingService.addSourceLot(trx, {
          batchId: id,
          lotId: lot_id,
          qtyMT: qty_mt,
        });
      });

      return res.status(201).json({ success: true, data: { source_lot: record } });
    } catch (err) {
      console.error('addSourceLot error:', err);
      const status = err.message.includes('not found') ? 404 : 400;
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // =========================================================================
  // Reprocessing
  // =========================================================================

  async listReprocessing(req, res) {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('reprocessing_batches as rb')
        .leftJoin('milling_batches as mb', 'rb.original_batch_id', 'mb.id')
        .select('rb.*', 'mb.batch_no as original_batch_no');

      if (status) query = query.where('rb.status', status);

      const countQuery = query.clone().clearSelect().clearOrder().count('rb.id as total').first();
      const [records, countResult] = await Promise.all([
        query.orderBy('rb.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);
      return res.json({
        success: true,
        data: {
          reprocessing: records,
          pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
        },
      });
    } catch (err) {
      console.error('listReprocessing error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createReprocessing(req, res) {
    try {
      const { original_batch_id, reason, input_product, input_qty_mt } = req.body;

      if (!original_batch_id || !reason) {
        return res.status(400).json({ success: false, message: 'original_batch_id and reason are required.' });
      }

      const result = await db.transaction(async (trx) => {
        return millingService.createReprocessingBatch(trx, {
          originalBatchId: original_batch_id,
          reason,
          inputProduct: input_product,
          inputQtyMT: input_qty_mt,
          userId: req.user.id,
        });
      });

      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      console.error('createReprocessing error:', err);
      const status = err.message.includes('not found') ? 404 : 400;
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  async completeReprocessing(req, res) {
    try {
      const { id } = req.params;
      const { output_qty_mt, wastage_mt } = req.body;

      const result = await db.transaction(async (trx) => {
        return millingService.completeReprocessing(trx, {
          reprocessId: id,
          outputQtyMT: output_qty_mt,
          wastageMT: wastage_mt,
        });
      });

      return res.json({ success: true, data: { reprocessing: result } });
    } catch (err) {
      console.error('completeReprocessing error:', err);
      const status = err.message.includes('not found') ? 404 : 400;
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // =========================================================================
  // Mills (Master Data)
  // =========================================================================

  async listMills(req, res) {
    try {
      const mills = await db('mills').orderBy('name', 'asc');
      return res.json({ success: true, data: { mills } });
    } catch (err) {
      console.error('listMills error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createMill(req, res) {
    try {
      const { name, location, capacity_mt_per_day, status, contact_person, phone, notes } = req.body;

      if (!name) {
        return res.status(400).json({ success: false, message: 'name is required.' });
      }

      const [mill] = await db('mills')
        .insert({
          name,
          location: location || null,
          capacity_mt_per_day: capacity_mt_per_day ? parseFloat(capacity_mt_per_day) : null,
          status: status || 'Active',
          contact_person: contact_person || null,
          phone: phone || null,
          notes: notes || null,
        })
        .returning('*');

      return res.status(201).json({ success: true, data: { mill } });
    } catch (err) {
      console.error('createMill error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateMill(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      delete updates.id;
      delete updates.created_at;
      updates.updated_at = db.fn.now();

      const [mill] = await db('mills')
        .where({ id })
        .update(updates)
        .returning('*');

      if (!mill) {
        return res.status(404).json({ success: false, message: 'Mill not found.' });
      }

      return res.json({ success: true, data: { mill } });
    } catch (err) {
      console.error('updateMill error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // =========================================================================
  // Analytics
  // =========================================================================

  async analyticsUtilization(req, res) {
    try {
      const { mill_id, date_from, date_to } = req.query;
      if (!mill_id) {
        return res.status(400).json({ success: false, message: 'mill_id is required.' });
      }
      const result = await millingService.getMillUtilization(mill_id, date_from, date_to);
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('analyticsUtilization error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async analyticsRecoveryTrends(req, res) {
    try {
      const { supplier_id, product_id, date_from, date_to } = req.query;
      const result = await millingService.getRecoveryTrends({
        supplierId: supplier_id,
        productId: product_id,
        dateFrom: date_from,
        dateTo: date_to,
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('analyticsRecoveryTrends error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async analyticsSupplierComparison(req, res) {
    try {
      const result = await millingService.getSupplierRecoveryComparison();
      return res.json({ success: true, data: { suppliers: result } });
    } catch (err) {
      console.error('analyticsSupplierComparison error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async analyticsOperatorProductivity(req, res) {
    try {
      const result = await millingService.getOperatorProductivity();
      return res.json({ success: true, data: { operators: result } });
    } catch (err) {
      console.error('analyticsOperatorProductivity error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async analyticsMoistureAnalysis(req, res) {
    try {
      const result = await millingService.getMoistureAnalysis();
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('analyticsMoistureAnalysis error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async analyticsBatchProfitability(req, res) {
    try {
      const { id } = req.params;
      const result = await millingService.getBatchProfitabilityVariance(id);
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('analyticsBatchProfitability error:', err);
      const status = err.message.includes('not found') ? 404 : 500;
      return res.status(status).json({ success: false, message: err.message });
    }
  },
};

module.exports = millingAdvancedController;
