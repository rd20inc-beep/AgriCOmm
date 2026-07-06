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
      const data = await millingService.getSourceLots(id);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('listSourceLots error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async addSourceLot(req, res) {
    try {
      const { id } = req.params;
      const { lot_id, qty_kg } = req.body;

      if (!lot_id || !qty_kg) {
        return res.status(400).json({ success: false, message: 'lot_id and qty_kg are required.' });
      }

      const batch = await db('milling_batches').where({ id }).first();
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      const record = await db.transaction(async (trx) => {
        return millingService.addSourceLot(trx, {
          batchId: id,
          lotId: lot_id,
          qtyKg: qty_kg,
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

  // Refuse to delete a mill that any child table points at — a delete
  // would either orphan production history (CASCADE) or 23503 (NO
  // ACTION). Proactively count refs across all known children so the
  // user gets a specific message naming the blocker, and catch any
  // residual FK violation from tables we forgot.
  async deleteMill(req, res) {
    const CHILD_TABLES = [
      ['milling_batches',     'milling batch(es)'],
      ['mill_workers',        'worker(s)'],
      ['mill_expenses',       'expense record(s)'],
      ['mill_performance',    'performance record(s)'],
      ['utility_consumption', 'utility-consumption record(s)'],
      ['machine_downtime',    'downtime record(s)'],
      ['production_plans',    'production plan(s)'],
    ];
    try {
      const { id } = req.params;
      for (const [table, label] of CHILD_TABLES) {
        const exists = await db.schema.hasTable(table);
        if (!exists) continue;
        const row = await db(table).where({ mill_id: id }).count('* as n').first();
        if (parseInt(row.n, 10) > 0) {
          return res.status(409).json({
            success: false,
            message: `Cannot delete: this mill is referenced by ${row.n} ${label}. Reassign or remove them first.`,
          });
        }
      }
      const deleted = await db('mills').where({ id }).del();
      if (deleted === 0) {
        return res.status(404).json({ success: false, message: 'Mill not found.' });
      }
      return res.json({ success: true });
    } catch (err) {
      // Belt-and-braces: some other table we didn't list above also has
      // an FK on mills.id. Surface the generic friendly message instead
      // of a 500.
      if (err.code === '23503') {
        return res.status(409).json({
          success: false,
          message: 'Cannot delete: this mill is referenced by other records. Reassign or remove them first.',
        });
      }
      console.error('deleteMill error:', err);
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

  // =========================================================================
  // Mill cash account — actual money in/out (realized cash), paid-vs-outstanding
  // =========================================================================
  async cashFlow(req, res) {
    try {
      const { from_date, to_date } = req.query;
      // PKR-normalized amount. base_amount_pkr is the locked PKR value, but some
      // rows (e.g. local-sale receipts) leave it 0 — so fall back to the PKR
      // amount, or convert a foreign amount by its fx rate. (COALESCE alone
      // would keep a literal 0 and zero out those receipts.)
      const amtPkr = `CASE
        WHEN p.base_amount_pkr > 0 THEN p.base_amount_pkr
        WHEN COALESCE(p.currency, 'PKR') = 'PKR' THEN p.amount
        ELSE p.amount * COALESCE(NULLIF(p.fx_rate, 0), 1) END`;
      const applyDates = (q) => {
        if (from_date) q.where('p.payment_date', '>=', from_date);
        if (to_date) q.where('p.payment_date', '<=', to_date);
        return q;
      };

      // Cash OUT — payments settling a mill payable.
      const outRows = await applyDates(
        db('payments as p')
          .join('payables as pa', 'pa.id', 'p.linked_payable_id')
          .leftJoin('suppliers as s', 's.id', 'pa.supplier_id')
          .where('p.type', 'payment').andWhere('pa.entity', 'mill')
          .select(
            'p.id', 'p.payment_no', 'p.payment_date', 'p.payment_method',
            db.raw(`${amtPkr} as amount_pkr`),
            'pa.category', 'pa.pay_no as ref', 'pa.source_table', 'pa.source_id', 'pa.linked_ref',
            's.name as counterparty'
          )
      );

      // Cash IN — receipts against a mill local sale.
      const inRows = await applyDates(
        db('payments as p')
          .join('local_sales as ls', 'ls.id', 'p.local_sale_id')
          .leftJoin('customers as c', 'c.id', 'ls.customer_id')
          .where('p.type', 'receipt').andWhere('ls.entity', 'mill')
          .select(
            'p.id', 'p.payment_no', 'p.payment_date', 'p.payment_method',
            db.raw(`${amtPkr} as amount_pkr`),
            'ls.item_name as category', 'ls.sale_no as ref',
            db.raw('COALESCE(c.name, ls.buyer_name) as counterparty')
          )
      );

      const num = (v) => parseFloat(v) || 0;

      // Head Office ⇄ Mill fund transfers touching the mill. The mill's money
      // LEAVES at create (a Mill→HO send counts out immediately), but money
      // ARRIVES only once the mill ACCEPTS an incoming transfer (status completed).
      let ftQ = db('fund_transfers as ft')
        .where(function () {
          this.where('ft.from_entity', 'mill') // mill sent → out (any status)
            .orWhere(function () { this.where('ft.to_entity', 'mill').andWhere('ft.status', 'completed'); }); // accepted in
        })
        .select('ft.id', 'ft.transfer_no', 'ft.transfer_date', 'ft.method', 'ft.amount', 'ft.from_entity', 'ft.to_entity', 'ft.status');
      if (from_date) ftQ = ftQ.where('ft.transfer_date', '>=', from_date);
      if (to_date) ftQ = ftQ.where('ft.transfer_date', '<=', to_date);
      const ftRows = (await ftQ).map((r) => ({
        id: `ft-${r.id}`, payment_no: r.transfer_no, payment_date: r.transfer_date,
        payment_method: r.method, amount_pkr: num(r.amount),
        category: 'Fund transfer', ref: r.transfer_no,
        counterparty: r.to_entity === 'mill' ? 'From Head Office' : 'To Head Office',
        direction: r.to_entity === 'mill' ? 'in' : 'out', isTransfer: true,
      }));

      // Incoming transfers awaiting the mill supervisor's acceptance (the alert).
      const pendingTransfers = (await db('fund_transfers as ft')
        .leftJoin('bank_accounts as fa', 'fa.id', 'ft.from_account_id')
        .leftJoin('bank_accounts as ta', 'ta.id', 'ft.to_account_id')
        .where({ 'ft.to_entity': 'mill', 'ft.status': 'pending' })
        .orderBy('ft.transfer_date', 'desc')
        .select('ft.id', 'ft.transfer_no', 'ft.transfer_date', 'ft.amount', 'ft.method', 'ft.reference', 'fa.name as from_account_name', 'ta.name as to_account_name'))
        .map((r) => ({ id: r.id, transferNo: r.transfer_no, date: r.transfer_date, amount: num(r.amount), method: r.method, reference: r.reference, fromAccount: r.from_account_name, toAccount: r.to_account_name }));

      // The mill's own cash float (so the supervisor sees usable funds on hand).
      const millCashRow = await db('bank_accounts').where({ entity: 'mill', type: 'cash' }).orderBy('id').first();
      const millCashBalance = millCashRow ? num(millCashRow.current_balance) : 0;

      // Attach purchased line items to raw-material (rice lot) payments so the
      // voucher itemises what was bought (rice type + quantity + rate).
      const lotRefs = outRows
        .filter((r) => (r.category === 'Raw Material' || r.source_table === 'inventory_lots') && r.linked_ref)
        .map((r) => r.linked_ref);
      if (lotRefs.length) {
        const lots = await db('inventory_lots as l')
          .leftJoin('products as pr', 'pr.id', 'l.product_id')
          .whereIn('l.lot_no', lotRefs)
          .select('l.lot_no', 'l.rate_per_kg', 'l.variety', 'l.grade', 'l.total_bags',
            db.raw('COALESCE(NULLIF(l.received_net_weight_kg, 0), NULLIF(l.net_weight_kg, 0), 0) as kg'),
            db.raw('COALESCE(pr.name, l.item_name) as item_name'));
        const byLot = {};
        for (const l of lots) byLot[l.lot_no] = l;
        for (const r of outRows) {
          const l = byLot[r.linked_ref];
          if (!l) continue;
          const kg = num(l.kg); const rate = num(l.rate_per_kg);
          // De-dupe name parts (product name often equals variety) case-insensitively.
          const seen = new Set();
          const nameParts = [l.item_name, l.variety, l.grade].filter(Boolean).filter((x) => {
            const k = String(x).trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
          });
          r.items = [{
            name: nameParts.join(' · ') || 'Rice',
            qty: kg ? `${(kg / 1000).toFixed(2)} MT${l.total_bags ? ` · ${l.total_bags} bags` : ''}` : '',
            rate: rate ? `Rs ${rate}/kg` : '',
            amount: kg && rate ? kg * rate : num(r.amount_pkr),
          }];
        }
      }

      // Mill-store purchases (packaging / fuel / operational items) — itemise from
      // mill_purchase_items joined to mill_items, keyed by the payable's source_id.
      const mpIds = outRows
        .filter((r) => r.source_table === 'mill_purchases' && r.source_id)
        .map((r) => r.source_id);
      if (mpIds.length) {
        // Walk-in vendor names (purchases without a registered supplier) so the
        // cash-ledger counterparty / voucher shows who it was bought from.
        const vendors = await db('mill_purchases').whereIn('id', mpIds).select('id', 'vendor_name');
        const vendorByPurchase = {};
        for (const v of vendors) vendorByPurchase[v.id] = v.vendor_name;
        for (const r of outRows) {
          if (r.source_table === 'mill_purchases' && !r.counterparty && vendorByPurchase[r.source_id]) {
            r.counterparty = vendorByPurchase[r.source_id];
          }
        }
        const lines = await db('mill_purchase_items as mpi')
          .leftJoin('mill_items as mi', 'mi.id', 'mpi.item_id')
          .whereIn('mpi.purchase_id', mpIds)
          .select('mpi.purchase_id', 'mpi.quantity', 'mpi.cost_per_unit', 'mpi.total_cost',
            'mi.name as item_name', 'mi.unit');
        const byPurchase = {};
        for (const ln of lines) {
          (byPurchase[ln.purchase_id] = byPurchase[ln.purchase_id] || []).push({
            name: ln.item_name || 'Item',
            qty: `${num(ln.quantity)}${ln.unit ? ` ${ln.unit}` : ''}`,
            rate: num(ln.cost_per_unit) ? `Rs ${num(ln.cost_per_unit)}` : '',
            amount: num(ln.total_cost),
          });
        }
        for (const r of outRows) {
          if (r.source_table === 'mill_purchases' && byPurchase[r.source_id]) r.items = byPurchase[r.source_id];
        }
      }

      const ledger = [
        ...outRows.map((r) => ({ ...r, direction: 'out', amount_pkr: num(r.amount_pkr) })),
        ...inRows.map((r) => ({ ...r, direction: 'in', amount_pkr: num(r.amount_pkr) })),
        ...ftRows,
      ].sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date) || (String(a.id) < String(b.id) ? -1 : 1));

      const cashOut = outRows.reduce((s, r) => s + num(r.amount_pkr), 0) + ftRows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.amount_pkr, 0);
      const cashIn = inRows.reduce((s, r) => s + num(r.amount_pkr), 0) + ftRows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.amount_pkr, 0);

      // Money-out streams: current paid-vs-outstanding snapshot.
      const streamRows = await db('payables')
        .where('entity', 'mill')
        .select(
          db.raw(`CASE
            WHEN source_table = 'milling_costs' THEN 'Rice & batch costs'
            WHEN source_table = 'mill_purchases' THEN 'Mill store purchases'
            WHEN source_table IN ('mill_expenses', 'business_expenses') THEN 'Expenses & overhead'
            ELSE COALESCE(source_table, 'Other') END as stream`),
          db.raw('SUM(original_amount) as billed'),
          db.raw('SUM(paid_amount) as paid'),
          db.raw('SUM(outstanding) as outstanding')
        )
        .groupBy('stream');

      // Money-in summary: local-sale collected vs outstanding.
      const inSummary = await db('local_sales')
        .where('entity', 'mill').whereNotIn('status', ['Cancelled', 'Voided', 'Pending'])
        .select(
          db.raw('COALESCE(SUM(total_amount), 0) as billed'),
          db.raw('COALESCE(SUM(paid_amount), 0) as collected'),
          db.raw('COALESCE(SUM(due_amount), 0) as outstanding')
        ).first();

      return res.json({
        success: true,
        data: {
          ledger,
          summary: { cashIn, cashOut, net: cashIn - cashOut, count: ledger.length },
          moneyOutStreams: streamRows.map((r) => ({
            stream: r.stream, billed: num(r.billed), paid: num(r.paid), outstanding: num(r.outstanding),
          })).sort((a, b) => b.billed - a.billed),
          moneyInSummary: {
            billed: num(inSummary?.billed), collected: num(inSummary?.collected), outstanding: num(inSummary?.outstanding),
          },
          pendingTransfers,
          pendingTransfersTotal: pendingTransfers.reduce((s, r) => s + r.amount, 0),
          millCashBalance,
        },
      });
    } catch (err) {
      console.error('cashFlow error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = millingAdvancedController;
