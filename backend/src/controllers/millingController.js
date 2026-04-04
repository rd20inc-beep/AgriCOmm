const db = require('../config/database');
const inventoryService = require('../services/inventoryService');
const accountingService = require('../services/accountingService');
const automationService = require('../services/automationService');
const workflowService = require('../services/exportOrderWorkflowService');
const { publishExportOrderUpdate } = require('../services/exportOrderEventBus');

/** Resolve batch param to numeric ID (supports both "9" and "M-226") */
async function resolveBatchId(idParam) {
  if (/^\d+$/.test(idParam)) return parseInt(idParam);
  const batch = await db('milling_batches').where({ batch_no: idParam }).select('id').first();
  return batch ? batch.id : null;
}

async function generateBatchNo(trx) {
  const last = await (trx || db)('milling_batches')
    .select('batch_no')
    .orderBy('created_at', 'desc')
    .first();

  if (!last || !last.batch_no) {
    return 'M-001';
  }

  const num = parseInt(last.batch_no.replace('M-', ''), 10) || 0;
  return `M-${String(num + 1).padStart(3, '0')}`;
}

const millingController = {
  async list(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        linked_export_order_id,
      } = req.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('milling_batches as mb')
        .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
        .select(
          'mb.*',
          's.name as supplier_name'
        );

      if (status) {
        query = query.where('mb.status', status);
      }
      if (linked_export_order_id) {
        query = query.where('mb.linked_export_order_id', linked_export_order_id);
      }

      const countQuery = query.clone().clearSelect().clearOrder().count('mb.id as total').first();

      const [batches, countResult] = await Promise.all([
        query.orderBy('mb.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          batches,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Milling batches list error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getById(req, res) {
    try {
      const { id } = req.params;

      // Support lookup by numeric id OR batch_no (e.g. "M-226")
      const isNumeric = /^\d+$/.test(id);
      const whereClause = isNumeric ? { 'mb.id': parseInt(id) } : { 'mb.batch_no': id };

      const batch = await db('milling_batches as mb')
        .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
        .select('mb.*', 's.name as supplier_name')
        .where(whereClause)
        .first();

      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      const batchId = batch.id; // resolved numeric ID
      const [qualitySamples, costs, vehicles] = await Promise.all([
        db('milling_quality_samples').where({ batch_id: batchId }).orderBy('created_at', 'asc'),
        db('milling_costs').where({ batch_id: batchId }).orderBy('created_at', 'asc'),
        db('milling_vehicle_arrivals').where({ batch_id: batchId }).orderBy('created_at', 'asc'),
      ]);

      // Separate quality samples by type
      const sampleAnalysis = qualitySamples.filter((q) => q.analysis_type === 'sample');
      const arrivalAnalysis = qualitySamples.filter((q) => q.analysis_type === 'arrival');

      return res.json({
        success: true,
        data: {
          batch,
          quality: {
            sample: sampleAnalysis,
            arrival: arrivalAnalysis,
          },
          costs,
          vehicles,
        },
      });
    } catch (err) {
      console.error('Milling batch getById error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async create(req, res) {
    try {
      const {
        supplier_id,
        linked_export_order_id,
        raw_qty_mt,
        planned_finished_mt,
        notes,
      } = req.body;

      if (!raw_qty_mt) {
        return res.status(400).json({
          success: false,
          message: 'raw_qty_mt is required.',
        });
      }

      const result = await db.transaction(async (trx) => {
        let linkedOrder = null;
        if (linked_export_order_id) {
          linkedOrder = await trx('export_orders').where({ id: linked_export_order_id }).first();
          if (!linkedOrder) {
            const err = new Error('Linked export order not found.');
            err.statusCode = 404;
            throw err;
          }

          if (linkedOrder.milling_order_id) {
            const err = new Error('A milling batch is already linked to this export order.');
            err.statusCode = 400;
            throw err;
          }

          const existingBatch = await trx('milling_batches')
            .where({ linked_export_order_id })
            .first();
          if (existingBatch) {
            const err = new Error('A milling batch is already linked to this export order.');
            err.statusCode = 400;
            throw err;
          }
        }

        const batchNo = await generateBatchNo(trx);

        const [batch] = await trx('milling_batches')
          .insert({
            batch_no: batchNo,
            supplier_id,
            linked_export_order_id: linked_export_order_id || null,
            raw_qty_mt: parseFloat(raw_qty_mt),
            planned_finished_mt: planned_finished_mt ? parseFloat(planned_finished_mt) : null,
            status: 'Pending',
            created_by: req.user.id,
          })
          .returning('*');

        let updatedOrder = null;
        if (linkedOrder) {
          await trx('export_orders').where({ id: linkedOrder.id }).update({
            milling_order_id: batch.id,
            updated_at: trx.fn.now(),
          });

          if (workflowService.canTransition(linkedOrder.status, 'In Milling')) {
            updatedOrder = await workflowService.transitionOrder(trx, {
              order: linkedOrder,
              toStatus: 'In Milling',
              userId: req.user.id,
              reason: `Milling batch ${batch.batch_no} created`,
            });
          } else if (linkedOrder.status === 'In Milling') {
            updatedOrder = {
              ...linkedOrder,
              milling_order_id: batch.id,
            };
          } else {
            const err = new Error(
              `Cannot start milling for an order in '${linkedOrder.status}' status.`
            );
            err.statusCode = 400;
            throw err;
          }
        }

        return { batch, order: updatedOrder };
      });

      if (result.order) {
        publishExportOrderUpdate(result.order.id, {
          eventType: 'milling_started',
          batchId: result.batch.id,
          batchNo: result.batch.batch_no,
          status: result.order.status,
        });
      }

      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      console.error('Milling batch create error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async update(req, res) {
    try {
      const id = await resolveBatchId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Batch not found.' });
      const updates = req.body;

      delete updates.id;
      delete updates.batch_no;
      delete updates.created_at;
      delete updates.created_by;

      updates.updated_at = db.fn.now();

      const [batch] = await db('milling_batches')
        .where({ id })
        .update(updates)
        .returning('*');

      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      return res.json({
        success: true,
        data: { batch },
      });
    } catch (err) {
      console.error('Milling batch update error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async saveQuality(req, res) {
    try {
      const id = await resolveBatchId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Batch not found.' });
      const {
        analysis_type,
        moisture,
        broken,
        chalky,
        foreign_matter,
        discoloration,
        purity,
        grain_size,
        price_per_kg,
        price_per_mt,
      } = req.body;

      if (!analysis_type || !['sample', 'arrival'].includes(analysis_type)) {
        return res.status(400).json({
          success: false,
          message: 'analysis_type must be "sample" or "arrival".',
        });
      }

      const batch = await db('milling_batches').where({ id }).first();
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      const result = await db.transaction(async (trx) => {
        const [sample] = await trx('milling_quality_samples')
          .insert({
            batch_id: id,
            analysis_type,
            moisture: moisture != null ? parseFloat(moisture) : null,
            broken: broken != null ? parseFloat(broken) : null,
            chalky: chalky != null ? parseFloat(chalky) : null,
            foreign_matter: foreign_matter != null ? parseFloat(foreign_matter) : null,
            discoloration: discoloration != null ? parseFloat(discoloration) : null,
            purity: purity != null ? parseFloat(purity) : null,
            grain_size: grain_size || null,
            price_per_kg: price_per_kg != null ? parseFloat(price_per_kg) : null,
            price_per_mt: price_per_mt != null ? parseFloat(price_per_mt) : null,
            created_by: req.user?.id,
          })
          .returning('*');

        // If arrival type with price_per_mt, auto-calculate raw rice cost
        if (analysis_type === 'arrival' && price_per_mt) {
          const rawRiceCost = parseFloat(price_per_mt) * parseFloat(batch.raw_qty_mt);

          // Upsert milling cost for raw_rice category
          const existingCost = await trx('milling_costs')
            .where({ batch_id: id, category: 'raw_rice' })
            .first();

          if (existingCost) {
            await trx('milling_costs')
              .where({ id: existingCost.id })
              .update({ amount: rawRiceCost, updated_at: trx.fn.now() });
          } else {
            await trx('milling_costs').insert({
              batch_id: id,
              category: 'raw_rice',
              amount: rawRiceCost,
              notes: `Auto-calculated: ${price_per_mt}/mt x ${batch.raw_qty_mt} mt`,
            });
          }
        }

        // Calculate variance between sample and arrival if both exist
        let variance = null;
        if (analysis_type === 'arrival') {
          const sampleRecord = await trx('milling_quality_samples')
            .where({ batch_id: id, analysis_type: 'sample' })
            .orderBy('created_at', 'desc')
            .first();

          if (sampleRecord) {
            variance = {
              moisture: sampleRecord.moisture != null && sample.moisture != null
                ? parseFloat(sample.moisture) - parseFloat(sampleRecord.moisture)
                : null,
              broken: sampleRecord.broken != null && sample.broken != null
                ? parseFloat(sample.broken) - parseFloat(sampleRecord.broken)
                : null,
              chalky: sampleRecord.chalky != null && sample.chalky != null
                ? parseFloat(sample.chalky) - parseFloat(sampleRecord.chalky)
                : null,
            };
          }
        }

        return { sample, variance };
      });

      return res.json({
        success: true,
        data: {
          qualitySample: result.sample,
          variance: result.variance,
        },
      });
    } catch (err) {
      console.error('Milling saveQuality error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async recordYield(req, res) {
    try {
      const id = await resolveBatchId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Batch not found.' });
      const {
        actual_finished_mt,
        broken_mt,
        bran_mt,
        husk_mt,
        wastage_mt,
      } = req.body;

      const batch = await db('milling_batches').where({ id }).first();
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      const finished = parseFloat(actual_finished_mt) || 0;
      const broken = parseFloat(broken_mt) || 0;
      const bran = parseFloat(bran_mt) || 0;
      const husk = parseFloat(husk_mt) || 0;
      const wastage = parseFloat(wastage_mt) || 0;
      const totalOutput = finished + broken + bran + husk + wastage;
      const yieldPct = parseFloat(batch.raw_qty_mt) > 0
        ? ((finished / parseFloat(batch.raw_qty_mt)) * 100).toFixed(2)
        : 0;

      const updateData = {
        actual_finished_mt: finished,
        broken_mt: broken,
        bran_mt: bran,
        husk_mt: husk,
        wastage_mt: wastage,
        yield_pct: yieldPct,
        updated_at: db.fn.now(),
      };

      // Auto-complete if output recorded (from Pending or In Progress)
      if (totalOutput > 0 && ['Pending', 'In Progress'].includes(batch.status)) {
        updateData.status = 'Completed';
        updateData.completed_at = db.fn.now();
      }

      const updated = await db.transaction(async (trx) => {
        const [result] = await trx('milling_batches')
          .where({ id })
          .update(updateData)
          .returning('*');

        // Consume raw material
        await inventoryService.consumeForMilling(trx, {
          batchId: batch.id,
          qtyMT: batch.raw_qty_mt,
          userId: req.user?.id,
        });

        // Look up linked export order for product name
        const linkedOrder = batch.linked_export_order_id
          ? await trx('export_orders as eo')
              .leftJoin('products as p', 'eo.product_id', 'p.id')
              .select('p.name as product_name')
              .where('eo.id', batch.linked_export_order_id)
              .first()
          : null;

        // Fetch quality & cost data for lot enrichment
        const arrivalQuality = await trx('milling_quality_samples')
          .where({ batch_id: batch.id, analysis_type: 'arrival' }).first();
        const totalBatchCost = await trx('milling_costs')
          .where({ batch_id: batch.id }).sum('amount as total').first();
        const batchCostTotal = parseFloat(totalBatchCost?.total) || 0;
        // Net cost per MT of finished rice = total batch cost / finished MT
        const effectiveCostPerMT = finished > 0 ? batchCostTotal / finished : 0;

        // Record finished goods + byproducts with enrichment
        await inventoryService.recordMillingOutput(trx, {
          batchId: batch.id,
          finishedMT: parseFloat(finished),
          brokenMT: parseFloat(broken),
          branMT: parseFloat(bran),
          huskMT: parseFloat(husk),
          productName: linkedOrder?.product_name || 'Finished Rice',
          costPerMT: effectiveCostPerMT,
          userId: req.user?.id,
          supplierInfo: { supplierId: batch.supplier_id },
          qualityInfo: arrivalQuality ? {
            variety: linkedOrder?.product_name,
            grade: batch.post_milling_grade || null,
            moisture: arrivalQuality.moisture ? parseFloat(arrivalQuality.moisture) : null,
            broken: arrivalQuality.broken ? parseFloat(arrivalQuality.broken) : null,
          } : null,
        });

        // Auto-post accounting journal for milling completion
        // Calculate cost from batch raw paddy value
        const millingCosts = await trx('milling_costs')
          .where({ batch_id: batch.id })
          .sum('amount as total')
          .first();
        const millingValue = parseFloat(millingCosts?.total || 0) || (parseFloat(batch.raw_qty_mt) * 100);

        if (millingValue > 0) {
          await accountingService.autoPost(trx, {
            triggerEvent: 'milling_completion',
            entity: 'mill',
            amount: millingValue,
            currency: 'PKR',
            refType: 'Milling Batch',
            refNo: batch.batch_no,
            description: `Milling completed for batch ${batch.batch_no} — ${finished} MT finished`,
            userId: req.user?.id,
          });
        }

        if (batch.linked_export_order_id && batchCostTotal > 0) {
          const existingCost = await trx('export_order_costs')
            .where({ order_id: batch.linked_export_order_id, category: 'milling' })
            .first();

          if (existingCost) {
            await trx('export_order_costs')
              .where({ id: existingCost.id })
              .update({
                amount: parseFloat(existingCost.amount || 0) + batchCostTotal,
                notes: `Updated from milling batch ${batch.batch_no}`,
                updated_at: trx.fn.now(),
              });
          } else {
            await trx('export_order_costs').insert({
              order_id: batch.linked_export_order_id,
              category: 'milling',
              amount: batchCostTotal,
              notes: `Updated from milling batch ${batch.batch_no}`,
            });
          }
        }

        // Trigger automation if batch completed
        if (totalOutput > 0 && ['Pending', 'In Progress'].includes(batch.status)) {
          await automationService.onBatchCompleted(trx, {
            batchId: parseInt(id),
            userId: req.user.id,
          });
        }

        return result;
      });

      return res.json({
        success: true,
        data: { batch: updated },
      });
    } catch (err) {
      console.error('Milling recordYield error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async addCost(req, res) {
    try {
      const id = await resolveBatchId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Batch not found.' });
      const { category, amount, notes } = req.body;

      if (!category || amount == null) {
        return res.status(400).json({
          success: false,
          message: 'category and amount are required.',
        });
      }

      const batch = await db('milling_batches').where({ id }).first();
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      // Upsert by batch_id + category
      const existing = await db('milling_costs')
        .where({ batch_id: id, category })
        .first();

      let cost;
      if (existing) {
        [cost] = await db('milling_costs')
          .where({ id: existing.id })
          .update({ amount: parseFloat(amount), notes: notes || null, updated_at: db.fn.now() })
          .returning('*');
      } else {
        [cost] = await db('milling_costs')
          .insert({
            batch_id: id,
            category,
            amount: parseFloat(amount),
            notes: notes || null,
          })
          .returning('*');
      }

      return res.json({
        success: true,
        data: { cost },
      });
    } catch (err) {
      console.error('Milling addCost error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async addVehicle(req, res) {
    try {
      const batchId = await resolveBatchId(req.params.id);
      if (!batchId) return res.status(404).json({ success: false, message: 'Milling batch not found.' });

      const {
        vehicle_no,
        driver_name,
        driver_phone,
        weight_mt,
        arrival_date,
        notes,
      } = req.body;

      const batch = await db('milling_batches').where({ id: batchId }).first();
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      const vehicle = await db.transaction(async (trx) => {
        const [v] = await trx('milling_vehicle_arrivals')
          .insert({
            batch_id: batchId,
            vehicle_no: vehicle_no || null,
            driver_name: driver_name || null,
            driver_phone: driver_phone || null,
            weight_mt: weight_mt ? parseFloat(weight_mt) : null,
            arrival_date: arrival_date || trx.fn.now(),
            notes: notes || null,
          })
          .returning('*');

        // Post inventory: raw paddy received
        if (v.weight_mt > 0) {
          const arrivalQuality = await trx('milling_quality_samples')
            .where({ batch_id: batchId, analysis_type: 'arrival' }).first();
          const costPerMT = arrivalQuality?.price_per_mt || 0;

          await inventoryService.receiveRawPaddy(trx, {
            batchId: batch.id,
            weightMT: parseFloat(v.weight_mt),
            costPerMT,
            currency: 'PKR',
            supplierId: batch.supplier_id,
            vehicleNo: v.vehicle_no,
            userId: req.user?.id,
          });
        }

        return v;
      });

      return res.json({
        success: true,
        data: { vehicle },
      });
    } catch (err) {
      console.error('Milling addVehicle error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = millingController;
