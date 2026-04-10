const db = require('../../config/database');
const inventoryService = require('../../services/inventoryService');
const accountingService = require('../../services/accountingService');
const automationService = require('../../services/automationService');
const workflowService = require('../../services/exportOrderWorkflowService');
const { publishExportOrderUpdate } = require('../../services/exportOrderEventBus');

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

      // Attach costs to each batch (from milling_costs table)
      const batchIds = batches.map(b => b.id);
      const allCosts = batchIds.length > 0
        ? await db('milling_costs').whereIn('batch_id', batchIds)
        : [];

      const batchesWithCosts = batches.map(b => {
        const batchCosts = allCosts.filter(c => c.batch_id === b.id);
        const costs = {};
        batchCosts.forEach(c => { costs[c.category] = parseFloat(c.amount) || 0; });
        return { ...b, costs };
      });

      return res.json({
        success: true,
        data: {
          batches: batchesWithCosts,
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
        milling_fee_per_kg,
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
            milling_fee_per_kg: milling_fee_per_kg ? parseFloat(milling_fee_per_kg) : 5,
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
        broken, b1_pct, b2_pct, b3_pct, csr_pct, short_grain_pct,
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
            b1_pct: b1_pct != null ? parseFloat(b1_pct) : null,
            b2_pct: b2_pct != null ? parseFloat(b2_pct) : null,
            b3_pct: b3_pct != null ? parseFloat(b3_pct) : null,
            csr_pct: csr_pct != null ? parseFloat(csr_pct) : null,
            short_grain_pct: short_grain_pct != null ? parseFloat(short_grain_pct) : null,
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
        broken_mt, b1_mt, b2_mt, b3_mt, csr_mt, short_grain_mt,
        bran_mt,
        husk_mt,
        wastage_mt,
      } = req.body;

      const batch = await db('milling_batches').where({ id }).first();
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      const finished = parseFloat(actual_finished_mt) || 0;
      const b1 = parseFloat(b1_mt) || 0;
      const b2 = parseFloat(b2_mt) || 0;
      const b3 = parseFloat(b3_mt) || 0;
      const csr = parseFloat(csr_mt) || 0;
      const shortGrain = parseFloat(short_grain_mt) || 0;
      // Total broken = sum of B1+B2+B3+CSR+Short Grain (or legacy broken_mt if new fields not provided)
      const broken = (b1 + b2 + b3 + csr + shortGrain) || parseFloat(broken_mt) || 0;
      const bran = parseFloat(bran_mt) || 0;
      const husk = parseFloat(husk_mt) || 0;
      const wastage = parseFloat(wastage_mt) || 0;
      const totalOutput = finished + broken + bran + husk + wastage;

      // Use actual received weight (from raw lot) if it differs from declared raw_qty_mt
      const rawLot = await db('inventory_lots')
        .where({ batch_ref: `batch-${batch.id}`, type: 'raw', entity: 'mill' })
        .first();
      // The raw qty for yield calculation = lot qty (what was actually received)
      // If lot already consumed, use the original qty from transactions
      let actualRawQty = parseFloat(batch.raw_qty_mt) || 0;
      if (rawLot) {
        const totalReceived = await db('lot_transactions')
          .where({ lot_id: rawLot.id, transaction_type: 'purchase_in' })
          .sum('input_qty as total').first();
        const received = parseFloat(totalReceived?.total) || 0;
        if (received > 0) actualRawQty = received;
      }

      const yieldPct = actualRawQty > 0
        ? ((finished / actualRawQty) * 100).toFixed(2)
        : 0;

      // Yield tolerance check — warn if output differs from input by more than 0.5%
      const outputDiffPct = actualRawQty > 0
        ? Math.abs((totalOutput - actualRawQty) / actualRawQty * 100)
        : 0;
      const yieldWarning = outputDiffPct > 0.5
        ? `Output differs from input by ${outputDiffPct.toFixed(1)}% (${totalOutput.toFixed(2)} MT output vs ${actualRawQty.toFixed(2)} MT input)`
        : null;

      // Prevent duplicate yield recording — if batch already has output lots, skip
      const existingOutputLots = await db('inventory_lots')
        .where({ batch_ref: `batch-${batch.id}` })
        .whereIn('type', ['finished', 'byproduct'])
        .count('id as c').first();
      if (parseInt(existingOutputLots.c) > 0 && batch.status === 'Completed') {
        // Already recorded — update the batch numbers but don't create duplicate lots
        await db('milling_batches').where({ id }).update({
          actual_finished_mt: finished,
          broken_mt: broken, b1_mt: b1, b2_mt: b2, b3_mt: b3, csr_mt: csr, short_grain_mt: shortGrain,
          bran_mt: bran, husk_mt: husk, wastage_mt: wastage,
          yield_pct: yieldPct, updated_at: db.fn.now(),
        });
        return res.json({
          success: true,
          data: { batch: await db('milling_batches').where({ id }).first() },
          warning: yieldWarning,
          message: 'Yield updated (output lots already exist)',
        });
      }

      const updateData = {
        actual_finished_mt: finished,
        broken_mt: broken,
        b1_mt: b1,
        b2_mt: b2,
        b3_mt: b3,
        csr_mt: csr,
        short_grain_mt: shortGrain,
        bran_mt: bran,
        husk_mt: husk,
        wastage_mt: wastage,
        yield_pct: yieldPct,
        updated_at: db.fn.now(),
      };

      // Update raw_qty_mt to actual received weight if different
      if (actualRawQty !== parseFloat(batch.raw_qty_mt)) {
        updateData.raw_qty_mt = actualRawQty;
      }

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

        // =================================================================
        // PHASE 3: Market-Value-Based Joint Cost Allocation
        // =================================================================

        const rawQty = parseFloat(batch.raw_qty_mt) || 0;
        const millingFee = parseFloat(batch.milling_fee_per_kg) || 0;

        // 1. Compute TOTAL BATCH COST POOL (all costs tied to this batch)
        const rawCostTotal = parseFloat(
          (await trx('milling_costs').where({ batch_id: batch.id })
            .where('category', 'raw_rice').sum('amount as total').first())?.total
        ) || 0;

        const processingCosts = parseFloat(
          (await trx('milling_costs').where({ batch_id: batch.id })
            .whereNot('category', 'raw_rice').sum('amount as total').first())?.total
        ) || 0;

        const millingFeeTotal = millingFee * rawQty * 1000; // fee per KG × raw KG
        const totalBatchCostPool = rawCostTotal + processingCosts + millingFeeTotal;

        // 2. Get market prices (from batch if confirmed, otherwise block or use last known)
        const finishedPrice = parseFloat(batch.finished_price_per_mt) || 0;
        const brokenPrice = parseFloat(batch.broken_price_per_mt) || 0;
        const branPrice = parseFloat(batch.bran_price_per_mt) || 0;
        const huskPrice = parseFloat(batch.husk_price_per_mt) || 0;

        // 3. Compute market values for each saleable output
        const outputValues = {
          finished: { qty: finished, price: finishedPrice, marketValue: finished * finishedPrice },
          broken:   { qty: broken,  price: brokenPrice,  marketValue: broken * brokenPrice },
          bran:     { qty: bran,    price: branPrice,    marketValue: bran * branPrice },
          husk:     { qty: husk,    price: huskPrice,    marketValue: husk * huskPrice },
        };
        const totalOutputMarketValue = Object.values(outputValues).reduce((s, o) => s + o.marketValue, 0);

        // 4. Allocate costs proportionally by market value
        const allocations = {};
        for (const [name, o] of Object.entries(outputValues)) {
          if (o.qty > 0 && totalOutputMarketValue > 0) {
            const share = o.marketValue / totalOutputMarketValue;
            const allocatedCost = totalBatchCostPool * share;
            const costPerKg = allocatedCost / (o.qty * 1000);
            allocations[name] = {
              qty: o.qty,
              marketValue: o.marketValue,
              share: share,
              allocatedCost: allocatedCost,
              costPerKg: costPerKg,
              costPerMT: costPerKg * 1000,
            };
          } else {
            allocations[name] = { qty: o.qty, marketValue: 0, share: 0, allocatedCost: 0, costPerKg: 0, costPerMT: 0 };
          }
        }

        // 5. Update batch with full cost decomposition
        const finAlloc = allocations.finished;
        await trx('milling_batches').where({ id }).update({
          raw_cost_total: rawCostTotal,
          raw_cost_per_kg_finished: finAlloc.qty > 0 ? rawCostTotal / (finAlloc.qty * 1000) : 0,
          milling_cost_per_kg_finished: finAlloc.qty > 0 ? (processingCosts + millingFeeTotal) / (finAlloc.qty * 1000) : 0,
          total_cost_per_kg_finished: finAlloc.costPerKg,
        });

        // 6. Store market price allocation snapshot
        await trx('milling_output_market_prices').insert({
          batch_id: batch.id,
          finished_price_per_mt: finishedPrice,
          broken_price_per_mt: brokenPrice,
          bran_price_per_mt: branPrice,
          husk_price_per_mt: huskPrice,
          confirmed_by: req.user?.id || null,
          confirmed_at: trx.fn.now(),
          notes: JSON.stringify({
            totalBatchCost: totalBatchCostPool,
            totalMarketValue: totalOutputMarketValue,
            allocations,
          }),
        });

        // 7. Mark raw lots as consumed
        await trx('inventory_lots')
          .where({ batch_ref: `batch-${batch.id}`, type: 'raw' })
          .update({ milling_status: 'Consumed' });

        // 8. Record finished goods + byproducts with ALLOCATED costs
        await inventoryService.recordMillingOutput(trx, {
          batchId: batch.id,
          finishedMT: parseFloat(finished),
          brokenMT: parseFloat(broken),
          branMT: parseFloat(bran),
          huskMT: parseFloat(husk),
          productName: linkedOrder?.product_name || 'Finished Rice',
          costPerMT: finAlloc.costPerMT,
          rawCostComponent: finAlloc.qty > 0 ? rawCostTotal / (finAlloc.qty * 1000) : 0,
          millingCostComponent: finAlloc.qty > 0 ? (processingCosts + millingFeeTotal) / (finAlloc.qty * 1000) : 0,
          // Pass per-output allocated costs for byproducts
          byproductCosts: {
            broken: allocations.broken.costPerKg,
            bran: allocations.bran.costPerKg,
            husk: allocations.husk.costPerKg,
          },
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
        const millingValue = parseFloat(millingCosts?.total || 0);

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

          // batchCostTotal is in PKR — convert to order currency using order's locked FX rate
          const linkedOrder = await trx('export_orders').where('id', batch.linked_export_order_id).first();
          const orderFxRate = parseFloat(linkedOrder?.booked_fx_rate) || 280;
          const costInOrderCurrency = batchCostTotal / orderFxRate;

          if (existingCost) {
            await trx('export_order_costs')
              .where({ id: existingCost.id })
              .update({
                amount: parseFloat(existingCost.amount || 0) + costInOrderCurrency,
                currency: linkedOrder?.currency || 'USD',
                base_amount_pkr: (parseFloat(existingCost.amount || 0) + costInOrderCurrency) * orderFxRate,
                fx_rate: orderFxRate,
                notes: `Updated from milling batch ${batch.batch_no} (PKR ${Math.round(batchCostTotal).toLocaleString()} ÷ ${orderFxRate})`,
                updated_at: trx.fn.now(),
              });
          } else {
            await trx('export_order_costs').insert({
              order_id: batch.linked_export_order_id,
              category: 'milling',
              amount: costInOrderCurrency,
              currency: linkedOrder?.currency || 'USD',
              base_amount_pkr: batchCostTotal,
              fx_rate: orderFxRate,
              notes: `From milling batch ${batch.batch_no} (PKR ${Math.round(batchCostTotal).toLocaleString()} ÷ ${orderFxRate})`,
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
        warning: yieldWarning,
      });
    } catch (err) {
      console.error('Milling recordYield error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
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

          // Update batch raw_qty_mt to reflect total actually received
          // (arrival weight is truth, not the ordered amount)
          const totalVehicleWeight = await trx('milling_vehicle_arrivals')
            .where({ batch_id: batchId })
            .sum('weight_mt as total').first();
          const actualReceived = parseFloat(totalVehicleWeight?.total) || 0;
          if (actualReceived > 0) {
            await trx('milling_batches').where({ id: batchId }).update({
              raw_qty_mt: actualReceived,
              updated_at: trx.fn.now(),
            });
          }
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
