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

// Whitelist + coerce the per-vehicle quality payload so we don't store
// arbitrary keys in the JSONB column. Returns null when nothing usable.
const VEHICLE_QUALITY_KEYS = [
  'moisture', 'broken', 'foreign_matter', 'chalky', 'discoloration',
  'purity', 'grain_size', 'price_per_mt', 'price_per_kg', 'notes',
];
function sanitizeVehicleQuality(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of VEHICLE_QUALITY_KEYS) {
    const v = raw[k];
    if (v == null || v === '') continue;
    if (k === 'notes') {
      out[k] = String(v).slice(0, 500);
    } else {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) out[k] = n;
    }
  }
  return Object.keys(out).length ? out : null;
}

// Find today's open batch (Queued / Pending Approval) for the given
// supplier + variety so a new truck can attach to it instead of
// spawning a new lot. Returns null if none — caller will create a fresh
// batch.
async function findOpenBatchForToday(trx, { supplierId, productId }) {
  if (!supplierId) return null;
  const rowQuery = trx('milling_batches')
    .where('supplier_id', supplierId)
    .whereIn('status', ['Queued', 'Pending Approval'])
    .whereRaw("DATE(created_at) = CURRENT_DATE")
    .orderBy('id', 'desc');
  if (productId) {
    rowQuery.andWhere(function () {
      this.where('product_id', productId).orWhereNull('product_id');
    });
  }
  return rowQuery.first();
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
        .leftJoin('users as approver', 'mb.approved_by', 'approver.id')
        .leftJoin('users as creator', 'mb.created_by', 'creator.id')
        .select(
          'mb.*',
          's.name as supplier_name',
          'approver.full_name as approved_by_name',
          'creator.full_name as created_by_name'
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

      // Attach costs / vehicle arrivals / arrival analysis to each batch
      // so the dashboard board can compute "Pending QC" (arrivals with no
      // arrival analysis) without needing a per-batch detail fetch.
      const batchIds = batches.map(b => b.id);
      const [allCosts, allArrivals, allArrivalSamples, consumedRows] = batchIds.length > 0
        ? await Promise.all([
            db('milling_costs').whereIn('batch_id', batchIds),
            db('milling_vehicle_arrivals').whereIn('batch_id', batchIds),
            db('milling_quality_samples')
              .whereIn('batch_id', batchIds)
              .where({ analysis_type: 'arrival' }),
            // How much of each batch's FINISHED output a downstream blend
            // re-milled (lot_type 'finished' source lots), keyed by the source
            // batch via inventory_lots.batch_ref = 'batch-<id>'. Lets the
            // dashboard count only un-re-milled output and avoid double-counting
            // the blend's revenue against its source batches.
            db('batch_source_lots as bsl')
              .join('inventory_lots as il', 'il.id', 'bsl.lot_id')
              .where('bsl.lot_type', 'finished')
              .whereIn('il.batch_ref', batchIds.map(id => `batch-${id}`))
              .groupBy('il.batch_ref')
              .select('il.batch_ref', db.raw('SUM(bsl.qty_mt) as consumed')),
          ])
        : [[], [], [], []];

      const consumedByRef = {};
      consumedRows.forEach(r => { consumedByRef[r.batch_ref] = parseFloat(r.consumed) || 0; });

      const batchesEnriched = batches.map(b => {
        const batchCosts = allCosts.filter(c => c.batch_id === b.id);
        const costs = {};
        batchCosts.forEach(c => { costs[c.category] = parseFloat(c.amount) || 0; });
        const vehicleArrivals = allArrivals.filter(a => a.batch_id === b.id);
        const arrivalSample = allArrivalSamples.find(q => q.batch_id === b.id) || null;
        return {
          ...b, costs, vehicleArrivals, arrivalAnalysis: arrivalSample,
          finished_consumed_mt: consumedByRef[`batch-${b.id}`] || 0,
        };
      });

      return res.json({
        success: true,
        data: {
          batches: batchesEnriched,
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
        .leftJoin('products as p', 'mb.product_id', 'p.id')
        .select('mb.*', 's.name as supplier_name', 'p.name as product_name')
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
        transport_mode,
        purchase_price_per_kg,
        product_id,
        mill_id,
        machine_line,
        shift,
        notes,
        // Blend input: partial quantities from multiple existing lots (raw
        // and/or leftover finished rice, mixed varieties). [{ lot_id, qty_mt }].
        // When given, raw_qty_mt + the weighted raw cost are derived from it.
        source_lots,
      } = req.body;

      const blendLots = Array.isArray(source_lots)
        ? source_lots.filter((s) => s && s.lot_id && parseFloat(s.qty_mt) > 0)
        : [];

      if (!raw_qty_mt && blendLots.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'raw_qty_mt or source_lots is required.',
        });
      }

      // Rice type is mandatory for traceability. A blend derives its variety
      // from the source lots' recipe; a single-source batch has no recipe, so
      // it MUST carry a product_id — unless it's tied to an export order, which
      // supplies the product itself.
      if (blendLots.length === 0 && !product_id && !linked_export_order_id) {
        return res.status(400).json({
          success: false,
          message: 'product_id (rice type) is required so the batch and its output lots can be traced.',
        });
      }

      // Resolve mill_id: take what the client sent, otherwise fall back to
      // the first active mill in the DB. The "Create Milling Demand" modal
      // on the export order doesn't ask for a mill yet, so this default
      // keeps the flow working until a selector is added.
      let resolvedMillId = mill_id ? parseInt(mill_id) : null;
      if (!resolvedMillId) {
        let fallback = null;
        try {
          fallback = await db('mills').where({ is_active: true }).orderBy('id', 'asc').first('id');
        } catch (_) { /* mills table or column may be unavailable in some envs */ }
        if (!fallback) {
          try { fallback = await db('mills').orderBy('id', 'asc').first('id'); } catch (_) { /* ignore */ }
        }
        resolvedMillId = fallback ? fallback.id : null;
      }
      if (!resolvedMillId) {
        return res.status(400).json({
          success: false,
          message: 'No active mill found in the system. Add a mill before creating milling batches.',
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

        // ── Blend: validate + price each source lot before inserting ──
        // Partial quantities from multiple lots (raw or leftover finished),
        // each priced at its landed cost/kg. raw_qty_mt + the raw cost pool
        // are the weighted sum, so COGS reflects the actual blend.
        let resolvedRawQty = raw_qty_mt ? parseFloat(raw_qty_mt) : 0;
        let resolvedSupplierId = supplier_id || null;
        const blendRows = [];
        let blendRawCostTotal = 0;
        if (blendLots.length > 0) {
          let sumQty = 0;
          for (const s of blendLots) {
            const lot = await trx('inventory_lots').where({ id: parseInt(s.lot_id) }).first();
            if (!lot) { const e = new Error(`Source lot ${s.lot_id} not found.`); e.statusCode = 400; throw e; }
            if (lot.entity !== 'mill') { const e = new Error(`Lot ${lot.lot_no || s.lot_id} is not a mill lot.`); e.statusCode = 400; throw e; }
            if (!['raw', 'finished'].includes(lot.type)) { const e = new Error(`Lot ${lot.lot_no || s.lot_id} (type ${lot.type}) can't be milled.`); e.statusCode = 400; throw e; }
            const qty = parseFloat(s.qty_mt);
            const avail = parseFloat(lot.available_qty) || 0;
            if (qty > avail + 1e-6) { const e = new Error(`Lot ${lot.lot_no || s.lot_id}: only ${avail} MT available, requested ${qty}.`); e.statusCode = 400; throw e; }
            const costKg = parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0;
            const costTotal = Math.round(costKg * qty * 1000 * 100) / 100;
            sumQty += qty;
            blendRawCostTotal += costTotal;
            blendRows.push({ lot, qty, lot_type: lot.type, unit_cost_pkr: costKg, cost_total_pkr: costTotal });
            if (!resolvedSupplierId && lot.supplier_id) resolvedSupplierId = lot.supplier_id;
          }
          resolvedRawQty = Math.round(sumQty * 100) / 100;
        }

        // Processing type: a run that mixes >1 distinct rice TYPE is a blend, so
        // its output is isolated from pure (and from other blends). The operator
        // can force it via req.body.processing_type; otherwise we infer it by
        // DISTINCT TYPE (product_id → variety) — several lots of the same type
        // are NOT a blend.
        const blendTypes = [...new Set(blendRows.map((b) =>
          (b.lot.product_id != null ? `p:${b.lot.product_id}` : (b.lot.variety || '').trim().toLowerCase())
        ).filter(Boolean))];
        const processingType = ['single_variety', 'blended'].includes(req.body.processing_type)
          ? req.body.processing_type
          : (blendTypes.length > 1 ? 'blended' : 'single_variety');

        // Rice type: prefer an explicit product_id; otherwise inherit it from the
        // linked export order, then from the source lots when they share a single
        // product (a single-variety stock batch milled from one purchase lot). So
        // a batch carries its variety from the moment it's created (not only once
        // output is recorded), and the landed cost flows in from the lot.
        const distinctLotProducts = [
          ...new Set(blendRows.map((b) => b.lot.product_id).filter((v) => v != null)),
        ];
        const resolvedProductId = product_id
          ? parseInt(product_id)
          : (linkedOrder && linkedOrder.product_id
            ? linkedOrder.product_id
            : (distinctLotProducts.length === 1 ? distinctLotProducts[0] : null));

        const [batch] = await trx('milling_batches')
          .insert({
            batch_no: batchNo,
            supplier_id: resolvedSupplierId,
            mill_id: resolvedMillId,
            linked_export_order_id: linked_export_order_id || null,
            raw_qty_mt: resolvedRawQty,
            processing_type: processingType,
            planned_finished_mt: planned_finished_mt ? parseFloat(planned_finished_mt) : null,
            milling_fee_per_kg: milling_fee_per_kg ? parseFloat(milling_fee_per_kg) : 5,
            transport_mode: transport_mode || 'with',
            purchase_price_per_kg: purchase_price_per_kg ? parseFloat(purchase_price_per_kg) : null,
            product_id: resolvedProductId,
            machine_line: machine_line || null,
            shift: shift || 'Day',
            notes: notes || null,
            status: 'Pending Approval',
            created_by: req.user.id,
          })
          .returning('*');

        // ── Persist the blend: source-lot links, raw-cost pool, reservations ──
        if (blendRows.length > 0) {
          for (const b of blendRows) {
            await trx('batch_source_lots').insert({
              batch_id: batch.id,
              lot_id: b.lot.id,
              qty_mt: b.qty,
              lot_type: b.lot_type,
              unit_cost_pkr: b.unit_cost_pkr,
              cost_total_pkr: b.cost_total_pkr,
              notes: b.lot_type === 'finished' ? 'Re-milled finished rice' : null,
              // Immutable recipe snapshot — survives later edits to the source lot.
              variety: b.lot.variety || null,
              ratio_pct: resolvedRawQty > 0 ? Math.round((b.qty / resolvedRawQty) * 10000) / 100 : null,
            });
            // Mark the lot In Milling so it isn't double-booked; consumed at yield.
            await trx('inventory_lots').where({ id: b.lot.id }).update({
              milling_status: 'In Milling', updated_at: trx.fn.now(),
            });
          }
          // Feed the weighted raw cost into the batch cost pool (category
          // raw_rice) — recordYield's joint-cost allocation reads this.
          await trx('milling_costs').insert({
            batch_id: batch.id,
            category: 'raw_rice',
            amount: Math.round(blendRawCostTotal * 100) / 100,
            notes: `${processingType === 'blended' ? 'Blended' : 'Milled from'} ${blendRows.length} lot(s): ${blendRows.map((b) => `${b.lot.lot_no || b.lot.id}×${b.qty}MT`).join(', ')}`,
            created_by: req.user.id,
          });

          // Auto-populate the batch's arrival quality analysis from the source
          // lots (qty-weighted), so a blend inherits the analysis already
          // recorded on its lots instead of asking the user to re-enter it. The
          // price/MT is the weighted landed cost of the blend; the raw cost is
          // already set above (milling_costs), so this doesn't double-count.
          const wAvg = (getter) => {
            let num = 0, den = 0;
            for (const b of blendRows) {
              const raw = getter(b.lot);
              const v = raw == null ? NaN : parseFloat(raw);
              if (Number.isNaN(v)) continue;
              num += v * b.qty; den += b.qty;
            }
            return den > 0 ? Math.round((num / den) * 100) / 100 : null;
          };
          const qj = (l, key) => (l.quality_json && l.quality_json[key] != null ? l.quality_json[key] : null);
          const pricePerMt = resolvedRawQty > 0 ? Math.round((blendRawCostTotal / resolvedRawQty) * 100) / 100 : null;
          await trx('milling_quality_samples').insert({
            batch_id: batch.id,
            analysis_type: 'arrival',
            moisture: wAvg((l) => l.moisture_pct ?? qj(l, 'moisture')),
            broken: wAvg((l) => l.broken_pct ?? qj(l, 'broken')),
            chalky: wAvg((l) => qj(l, 'chalky')),
            foreign_matter: wAvg((l) => qj(l, 'foreign_matter')),
            purity: wAvg((l) => qj(l, 'purity')),
            price_per_mt: pricePerMt,
            price_per_kg: pricePerMt != null ? Math.round((pricePerMt / 1000) * 100) / 100 : null,
            created_by: req.user.id,
          });
        }

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

  async approveBatch(req, res) {
    try {
      const id = await resolveBatchId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Batch not found.' });

      const batch = await db('milling_batches').where('id', id).first();
      if (!batch) return res.status(404).json({ success: false, message: 'Batch not found.' });
      if (batch.status !== 'Pending Approval') {
        return res.status(400).json({ success: false, message: `Cannot approve — batch status is "${batch.status}".` });
      }

      const [updated] = await db('milling_batches').where('id', id).update({
        status: 'Queued',
        approved_by: req.user.id,
        approved_at: db.fn.now(),
        updated_at: db.fn.now(),
      }).returning('*');

      return res.json({ success: true, data: { batch: updated } });
    } catch (err) {
      console.error('Batch approve error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async rejectBatch(req, res) {
    try {
      const id = await resolveBatchId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Batch not found.' });

      const { reason } = req.body;
      if (!reason || !reason.trim()) {
        return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
      }

      const batch = await db('milling_batches').where('id', id).first();
      if (!batch) return res.status(404).json({ success: false, message: 'Batch not found.' });
      if (batch.status !== 'Pending Approval') {
        return res.status(400).json({ success: false, message: `Cannot reject — batch status is "${batch.status}".` });
      }

      const [updated] = await db('milling_batches').where('id', id).update({
        status: 'Rejected',
        rejected_by: req.user.id,
        rejection_reason: reason.trim(),
        updated_at: db.fn.now(),
      }).returning('*');

      return res.json({ success: true, data: { batch: updated } });
    } catch (err) {
      console.error('Batch reject error:', err);
      return res.status(500).json({ success: false, message: err.message });
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
        // Pakistani-rice per-grade percentages (added 116)
        cobba_pct, nb_pct, ov_pct,
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
        // Upsert: one canonical row per (batch, analysis_type). Editing
        // the arrival price after seeing the sample-vs-arrival variance
        // updates the existing row instead of stacking duplicates.
        const fields = {
          batch_id: id,
          analysis_type,
          moisture: moisture != null ? parseFloat(moisture) : null,
          broken: broken != null ? parseFloat(broken) : null,
          b1_pct: b1_pct != null ? parseFloat(b1_pct) : null,
          b2_pct: b2_pct != null ? parseFloat(b2_pct) : null,
          b3_pct: b3_pct != null ? parseFloat(b3_pct) : null,
          csr_pct: csr_pct != null ? parseFloat(csr_pct) : null,
          short_grain_pct: short_grain_pct != null ? parseFloat(short_grain_pct) : null,
          cobba_pct: cobba_pct != null ? parseFloat(cobba_pct) : null,
          nb_pct: nb_pct != null ? parseFloat(nb_pct) : null,
          ov_pct: ov_pct != null ? parseFloat(ov_pct) : null,
          chalky: chalky != null ? parseFloat(chalky) : null,
          foreign_matter: foreign_matter != null ? parseFloat(foreign_matter) : null,
          discoloration: discoloration != null ? parseFloat(discoloration) : null,
          purity: purity != null ? parseFloat(purity) : null,
          grain_size: grain_size || null,
          price_per_kg: price_per_kg != null ? parseFloat(price_per_kg) : null,
          price_per_mt: price_per_mt != null ? parseFloat(price_per_mt) : null,
        };
        const existing = await trx('milling_quality_samples')
          .where({ batch_id: id, analysis_type })
          .first();
        let sample;
        if (existing) {
          [sample] = await trx('milling_quality_samples')
            .where({ id: existing.id })
            .update({ ...fields, updated_at: trx.fn.now() })
            .returning('*');
        } else {
          [sample] = await trx('milling_quality_samples')
            .insert({ ...fields, created_by: req.user?.id })
            .returning('*');
        }

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
              created_by: req.user?.id || null,
            });
          }

          // If the batch has already yielded, cascade the updated raw cost into
          // the output lots (re-cost finished + by-products by market value) and
          // recompute non-locked COGS — same as confirming output prices. Without
          // this, editing the arrival cost after yield leaves the existing output
          // lots (and their costing sheet) showing the old cost.
          const yielded = await trx('inventory_lots')
            .where({ batch_ref: `batch-${id}` })
            .whereIn('type', ['finished', 'byproduct'])
            .first('id');
          if (yielded) {
            await inventoryService.recomputeBatchOutputsAfterPriceChange(trx, id, { userId: req.user?.id });
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
        sortex_rejects_mt,
        powder_mt, sweeping_mt,
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
      const sortex = parseFloat(sortex_rejects_mt) || 0;
      const powder = parseFloat(powder_mt) || 0;
      const sweeping = parseFloat(sweeping_mt) || 0;
      const wastage = parseFloat(wastage_mt) || 0;
      const totalOutput = finished + broken + bran + husk + sortex + powder + sweeping + wastage;

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
          bran_mt: bran, husk_mt: husk, sortex_rejects_mt: sortex, wastage_mt: wastage,
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
        sortex_rejects_mt: sortex,
        powder_mt: powder,
        sweeping_mt: sweeping,
        wastage_mt: wastage,
        yield_pct: yieldPct,
        updated_at: db.fn.now(),
      };

      // Update raw_qty_mt to actual received weight if different
      if (actualRawQty !== parseFloat(batch.raw_qty_mt)) {
        updateData.raw_qty_mt = actualRawQty;
      }

      // Auto-complete if any output recorded. Operators commonly leave
      // batches in Queued or Pending Approval and skip the In Progress
      // step entirely, so recording yield should advance status from
      // any pre-completion state.
      if (totalOutput > 0 && ['Queued', 'Pending', 'In Progress', 'Pending Approval'].includes(batch.status)) {
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

        // The batch's own rice-type product is the authoritative name for the
        // finished lot — every batch carries a product_id since rice type became
        // mandatory. Fall back to the linked order's product only when the batch
        // somehow lacks one, so an UNLINKED batch still stamps its real variety
        // (e.g. 'Basmati Rice') instead of the generic 'Finished Rice'/null that
        // then propagates blank into any blend that consumes the lot.
        const batchProduct = batch.product_id
          ? await trx('products').where('id', batch.product_id).select('name').first()
          : null;
        const riceTypeName = batchProduct?.name || linkedOrder?.product_name || null;

        // Fetch quality & cost data for lot enrichment
        const arrivalQuality = await trx('milling_quality_samples')
          .where({ batch_id: batch.id, analysis_type: 'arrival' }).first();
        const totalBatchCost = await trx('milling_costs')
          .where({ batch_id: batch.id }).sum('amount as total').first();
        const batchCostTotal = parseFloat(totalBatchCost?.total) || 0;
        // Net cost per MT of finished rice = total batch cost / finished MT
        const effectiveCostPerMT = finished > 0 ? batchCostTotal / finished : 0;

        // =================================================================
        // PHASE 3: Residual (by-product-credit) cost allocation
        // Finished = max(0, NetPurchase − Σ by-product sale value); by-products
        // valued at their sale price. NetPurchase = raw + milling + other (manual
        // values when set, else fee + recorded processing costs). The same
        // computeResidualAllocation runs on price-confirm, so numbers match.
        // =================================================================
        // Lot-started batches carry no raw_rice milling_cost — derive it from the
        // source lots so Net Purchase has its raw component.
        await inventoryService.ensureRawCostFromSourceLots(trx, batch.id);
        const rawCostTotal = parseFloat(
          (await trx('milling_costs').where({ batch_id: batch.id })
            .where('category', 'raw_rice').sum('amount as total').first())?.total
        ) || 0;
        const processingCosts = parseFloat(
          (await trx('milling_costs').where({ batch_id: batch.id })
            .whereNot('category', 'raw_rice').sum('amount as total').first())?.total
        ) || 0;

        const a = inventoryService.computeResidualAllocation(batch, rawCostTotal, processingCosts);
        const finAlloc = { qty: finished, costPerKg: a.finishedCostPerKg, costPerMT: a.finishedCostPerKg * 1000 };
        const allocations = {};
        for (const [k, perKg] of Object.entries(a.byCostPerKg)) allocations[k] = { costPerKg: perKg };

        await trx('milling_batches').where({ id }).update({
          raw_cost_total: rawCostTotal,
          raw_cost_per_kg_finished: a.finishedCostPerKg * a.rawFrac,
          milling_cost_per_kg_finished: a.finishedCostPerKg * a.millFrac,
          total_cost_per_kg_finished: a.finishedCostPerKg,
        });

        // Snapshot — finished is the DERIVED residual cost; by-products keep their
        // entered sale prices.
        await trx('milling_output_market_prices').insert({
          batch_id: batch.id,
          finished_price_per_mt: a.finishedCostPerKg * 1000,
          broken_price_per_mt: parseFloat(batch.broken_price_per_mt) || 0,
          bran_price_per_mt: parseFloat(batch.bran_price_per_mt) || 0,
          husk_price_per_mt: parseFloat(batch.husk_price_per_mt) || 0,
          confirmed_by: req.user?.id || null,
          confirmed_at: trx.fn.now(),
          notes: JSON.stringify({
            model: 'residual',
            netPurchase: a.netPurchase,
            byproductValue: a.byproductValue,
            finishedCostPerKg: a.finishedCostPerKg,
            clamped: a.clamped,
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
          sortexMT: parseFloat(sortex),
          powderMT: parseFloat(powder),
          sweepingMT: parseFloat(sweeping),
          productName: riceTypeName || 'Finished Rice',
          costPerMT: finAlloc.costPerMT,
          // Finished rice carries the RESIDUAL cost (Net Purchase − by-product
          // value), split into raw vs milling in the Net Purchase ratio.
          rawCostComponent: finAlloc.costPerKg * a.rawFrac,
          millingCostComponent: finAlloc.costPerKg * a.millFrac,
          // Pass per-output allocated costs for byproducts. When the
          // batch has per-grade broken outputs, each grade carries its
          // own cost (derived from its own market value share);
          // otherwise the aggregate broken cost falls through.
          byproductCosts: {
            broken:      allocations.broken?.costPerKg      || 0,
            b1:          allocations.b1?.costPerKg          || 0,
            b2:          allocations.b2?.costPerKg          || 0,
            b3:          allocations.b3?.costPerKg          || 0,
            csr:         allocations.csr?.costPerKg         || 0,
            short_grain: allocations.short_grain?.costPerKg || 0,
            bran:        allocations.bran?.costPerKg        || 0,
            husk:        allocations.husk?.costPerKg        || 0,
            sortex:      allocations.sortex?.costPerKg      || 0,
            powder:      allocations.powder?.costPerKg      || 0,
            sweeping:    allocations.sweeping?.costPerKg    || 0,
          },
          // Split broken into its grades (B1, B2, B3, CSR, Short Grain) so
          // each tier becomes its own inventory lot and can be sold at its
          // own price. Falls back to the aggregate brokenMT when no grade
          // values are present on the batch.
          // Use the just-entered grade quantities (not the stale pre-update batch
          // row, which is still 0 on a first yield) so per-grade lots (B1/B2/…)
          // are actually created instead of one generic broken lot.
          brokenGrades: {
            b1, b2, b3, csr, shortGrain,
          },
          userId: req.user?.id,
          supplierInfo: { supplierId: batch.supplier_id },
          qualityInfo: arrivalQuality ? {
            variety: riceTypeName,
            grade: batch.post_milling_grade || null,
            moisture: arrivalQuality.moisture ? parseFloat(arrivalQuality.moisture) : null,
            broken: arrivalQuality.broken ? parseFloat(arrivalQuality.broken) : null,
          } : null,
        });

        // Recognize the supplier payable for the raw rice purchase so the
        // supplier's GL party ledger / statement reflects what we owe. Only for
        // single-source batches: a blend re-mills already-owned finished stock,
        // so its raw cost isn't a new supplier purchase (would double-count).
        // purchase_invoice rule: DR Raw Rice Stock / CR Supplier Payable. The
        // milling_completion journal below then moves Raw Rice → Finished, so
        // Raw Rice nets to zero and the supplier payable stands. (The business
        // buys milled rice by type, not unmilled paddy — see migration 119.)
        if (batch.processing_type !== 'blended' && batch.supplier_id) {
          const rawCostRow = await trx('milling_costs')
            .where({ batch_id: batch.id, category: 'raw_rice' })
            .sum('amount as total').first();
          const rawRiceValue = parseFloat(rawCostRow?.total || 0);
          const existingAP = await trx('journal_entries')
            .where({ ref_type: 'Rice Purchase', ref_no: batch.batch_no })
            .first();
          if (rawRiceValue > 0 && !existingAP) {
            // A real, settle-able payable row (recordPayment needs a numeric id
            // to apply a payment against). Keyed by batch so getPayables can
            // suppress the derived duplicate. Idempotent.
            const existingPayable = await trx('payables')
              .where({ source_table: 'milling_raw_rice', source_id: batch.id }).first();
            if (!existingPayable) {
              await trx('payables').insert({
                pay_no: `MILL-RICE-${batch.batch_no}`,
                payable_type: 'vendor',
                entity: 'mill',
                supplier_id: batch.supplier_id,
                category: 'Raw Rice',
                original_amount: rawRiceValue,
                paid_amount: 0,
                outstanding: rawRiceValue,
                currency: 'PKR',
                status: 'Pending',
                source_table: 'milling_raw_rice',
                source_id: batch.id,
                linked_ref: batch.batch_no,
                due_date: trx.fn.now(),
                notes: `Rice purchase — ${riceTypeName || 'rice'} (batch ${batch.batch_no})`,
                created_by: req.user?.id || null,
              });
            }
            await accountingService.autoPost(trx, {
              triggerEvent: 'purchase_invoice',
              entity: 'mill',
              amount: rawRiceValue,
              currency: 'PKR',
              refType: 'Rice Purchase',
              refNo: batch.batch_no,
              description: `Rice purchase — ${riceTypeName || 'rice'} (batch ${batch.batch_no})`,
              partyType: 'supplier',
              partyId: batch.supplier_id,
              userId: req.user?.id,
            });
          }
        }

        // Auto-post accounting journal for milling completion
        // Calculate cost from batch raw rice value
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
              created_by: req.user?.id || null,
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
            created_by: req.user?.id || null,
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
        weight_kg,
        bag_size_kg,
        total_bags,
        arrival_date,
        notes,
        quality, // optional per-vehicle quality { moisture, broken, foreign_matter, price_per_mt, ... }
      } = req.body;

      const batch = await db('milling_batches').where({ id: batchId }).first();
      if (!batch) {
        return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      }

      const vehicle = await db.transaction(async (trx) => {
        // Accept either weight_kg (canonical) or legacy weight_mt
        let parsedWeight = null;
        if (weight_kg != null && weight_kg !== '') {
          parsedWeight = parseFloat(weight_kg) / 1000;
        } else if (weight_mt != null && weight_mt !== '') {
          parsedWeight = parseFloat(weight_mt);
        }

        // Bag count + size: prefer explicit total_bags from FE; derive size if missing
        const parsedTotalBags = total_bags != null && total_bags !== '' ? parseInt(total_bags, 10) : null;
        let parsedBagSize = bag_size_kg != null && bag_size_kg !== '' ? parseFloat(bag_size_kg) : null;
        if (!parsedBagSize && parsedWeight && parsedTotalBags && parsedTotalBags > 0) {
          parsedBagSize = (parsedWeight * 1000) / parsedTotalBags;
        }
        const totalBags = parsedTotalBags
          || (parsedWeight && parsedBagSize && parsedBagSize > 0
            ? Math.ceil((parsedWeight * 1000) / parsedBagSize)
            : null);

        const cleanQuality = sanitizeVehicleQuality(quality);

        const [v] = await trx('milling_vehicle_arrivals')
          .insert({
            batch_id: batchId,
            vehicle_no: vehicle_no || null,
            driver_name: driver_name || null,
            driver_phone: driver_phone || null,
            weight_mt: parsedWeight,
            bag_size_kg: parsedBagSize,
            total_bags: totalBags,
            arrival_date: arrival_date || trx.fn.now(),
            notes: notes || null,
            quality_json: cleanQuality,
            created_by: req.user?.id || null,
          })
          .returning('*');

        // Post inventory: rice received
        if (v.weight_mt > 0) {
          // Per-vehicle price wins; fall back to the batch-level arrival sample.
          let costPerMT = cleanQuality && cleanQuality.price_per_mt
            ? parseFloat(cleanQuality.price_per_mt)
            : 0;
          if (!costPerMT) {
            const arrivalQuality = await trx('milling_quality_samples')
              .where({ batch_id: batchId, analysis_type: 'arrival' }).first();
            costPerMT = arrivalQuality?.price_per_mt || 0;
          }

          await inventoryService.receiveRice(trx, {
            batchId: batch.id,
            weightMT: parseFloat(v.weight_mt),
            costPerMT,
            currency: 'PKR',
            supplierId: batch.supplier_id,
            productId: batch.product_id,
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

  // Receive a rice purchase truck — auto-attaches to today's open batch
  // for (supplier, variety) or creates a fresh one. Five trucks of the
  // same D98 from the same supplier on the same day land in one batch
  // and one inventory lot, with five vehicle rows for traceability.
  async receiveRice(req, res) {
    try {
      const {
        supplier_id,
        product_id,
        vehicle_no,
        driver_name,
        driver_phone,
        weight_mt,
        weight_kg,
        bag_size_kg,
        total_bags,
        arrival_date,
        notes,
        quality,
        // Optional batch hints (used only when a new batch must be created)
        mill_id,
        machine_line,
        shift,
        milling_fee_per_kg,
      } = req.body;

      if (!supplier_id) {
        return res.status(400).json({ success: false, message: 'supplier_id is required.' });
      }

      const result = await db.transaction(async (trx) => {
        // 1. Find or create today's open batch for this supplier+variety.
        let batch = await findOpenBatchForToday(trx, {
          supplierId: supplier_id,
          productId: product_id || null,
        });
        let createdBatch = false;
        if (!batch) {
          const supplier = await trx('suppliers').where({ id: supplier_id }).first('name');
          const batchNo = await generateBatchNo(trx);
          [batch] = await trx('milling_batches')
            .insert({
              batch_no: batchNo,
              supplier_id,
              supplier_name: supplier?.name || null,
              product_id: product_id || null,
              mill_id: mill_id || null,
              machine_line: machine_line || null,
              shift: shift || 'Day',
              milling_fee_per_kg: milling_fee_per_kg ? parseFloat(milling_fee_per_kg) : 5,
              raw_qty_mt: 0,
              status: 'Queued',
              notes: notes || null,
              created_by: req.user?.id || null,
            })
            .returning('*');
          createdBatch = true;
        } else if (product_id && !batch.product_id) {
          // First truck didn't know the variety; this one does — fill it in.
          await trx('milling_batches').where({ id: batch.id }).update({
            product_id,
            updated_at: trx.fn.now(),
          });
          batch.product_id = product_id;
        }

        // 2. Parse weight (canonical: kg → MT)
        let parsedWeight = null;
        if (weight_kg != null && weight_kg !== '') {
          parsedWeight = parseFloat(weight_kg) / 1000;
        } else if (weight_mt != null && weight_mt !== '') {
          parsedWeight = parseFloat(weight_mt);
        }

        const parsedTotalBags = total_bags != null && total_bags !== '' ? parseInt(total_bags, 10) : null;
        let parsedBagSize = bag_size_kg != null && bag_size_kg !== '' ? parseFloat(bag_size_kg) : null;
        if (!parsedBagSize && parsedWeight && parsedTotalBags && parsedTotalBags > 0) {
          parsedBagSize = (parsedWeight * 1000) / parsedTotalBags;
        }
        const totalBagsResolved = parsedTotalBags
          || (parsedWeight && parsedBagSize && parsedBagSize > 0
            ? Math.ceil((parsedWeight * 1000) / parsedBagSize)
            : null);

        const cleanQuality = sanitizeVehicleQuality(quality);

        // 3. Insert the vehicle row
        const [v] = await trx('milling_vehicle_arrivals')
          .insert({
            batch_id: batch.id,
            vehicle_no: vehicle_no || null,
            driver_name: driver_name || null,
            driver_phone: driver_phone || null,
            weight_mt: parsedWeight,
            bag_size_kg: parsedBagSize,
            total_bags: totalBagsResolved,
            arrival_date: arrival_date || trx.fn.now(),
            notes: notes || null,
            quality_json: cleanQuality,
            created_by: req.user?.id || null,
          })
          .returning('*');

        // 4. Post the inventory receipt (same lot for all trucks on this batch)
        let lot = null;
        let movement = null;
        if (parsedWeight && parsedWeight > 0) {
          let costPerMT = cleanQuality && cleanQuality.price_per_mt
            ? parseFloat(cleanQuality.price_per_mt)
            : 0;
          if (!costPerMT) {
            const arrivalQuality = await trx('milling_quality_samples')
              .where({ batch_id: batch.id, analysis_type: 'arrival' }).first();
            costPerMT = arrivalQuality?.price_per_mt || 0;
          }
          const receipt = await inventoryService.receiveRice(trx, {
            batchId: batch.id,
            weightMT: parsedWeight,
            costPerMT,
            currency: 'PKR',
            supplierId: batch.supplier_id,
            productId: batch.product_id,
            vehicleNo: v.vehicle_no,
            userId: req.user?.id,
          });
          lot = receipt.lot;
          movement = receipt.movement;

          // 5. Sync batch.raw_qty_mt to the sum of arrivals (truth = scale).
          const totals = await trx('milling_vehicle_arrivals')
            .where({ batch_id: batch.id })
            .sum('weight_mt as total').first();
          const actualReceived = parseFloat(totals?.total) || 0;
          if (actualReceived > 0) {
            await trx('milling_batches').where({ id: batch.id }).update({
              raw_qty_mt: actualReceived,
              updated_at: trx.fn.now(),
            });
            batch.raw_qty_mt = actualReceived;
          }
        }

        return { batch, vehicle: v, lot, movement, createdBatch };
      });

      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      console.error('Milling receiveRice error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // Delete a single vehicle arrival and reverse its inventory receipt
  async deleteVehicle(req, res) {
    try {
      const batchId = await resolveBatchId(req.params.id);
      if (!batchId) return res.status(404).json({ success: false, message: 'Milling batch not found.' });
      const vehicleId = parseInt(req.params.vehicleId, 10);
      if (!vehicleId) return res.status(400).json({ success: false, message: 'Invalid vehicle id.' });

      await db.transaction(async (trx) => {
        const v = await trx('milling_vehicle_arrivals').where({ id: vehicleId, batch_id: batchId }).first();
        if (!v) {
          const err = new Error('Vehicle arrival not found.');
          err.statusCode = 404;
          throw err;
        }

        const wt = parseFloat(v.weight_mt) || 0;
        if (wt > 0) {
          // Reverse the inventory receipt
          const lot = await trx('inventory_lots')
            .where({ batch_ref: `batch-${batchId}`, type: 'raw', entity: 'mill' })
            .first();
          if (lot) {
            await inventoryService.postMovement(trx, {
              movementType: inventoryService.MOVEMENT_TYPES.ADJUSTMENT_MINUS,
              lotId: lot.id,
              qty: wt,
              fromWarehouseId: lot.warehouse_id,
              sourceEntity: 'mill',
              notes: `Reversal: vehicle arrival ${v.vehicle_no || vehicleId} deleted`,
              currency: 'PKR',
              batchId,
              userId: req.user?.id,
            });
          }
        }

        await trx('milling_vehicle_arrivals').where({ id: vehicleId }).del();

        // Recompute batch raw_qty_mt to current vehicle total
        const totals = await trx('milling_vehicle_arrivals')
          .where({ batch_id: batchId })
          .sum('weight_mt as total').first();
        const totalReceived = parseFloat(totals?.total) || 0;
        await trx('milling_batches').where({ id: batchId }).update({
          raw_qty_mt: totalReceived,
          updated_at: trx.fn.now(),
        });
      });

      return res.json({ success: true, message: 'Vehicle arrival deleted; inventory reversed.' });
    } catch (err) {
      console.error('Milling deleteVehicle error:', err);
      return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  // Delete an entire batch (admin/manager only). Reverses raw rice lot if not consumed.
  async deleteBatch(req, res) {
    try {
      const batchId = await resolveBatchId(req.params.id);
      if (!batchId) return res.status(404).json({ success: false, message: 'Milling batch not found.' });

      await db.transaction(async (trx) => {
        const batch = await trx('milling_batches').where({ id: batchId }).first();
        if (!batch) {
          const err = new Error('Milling batch not found.');
          err.statusCode = 404;
          throw err;
        }

        if (batch.status === 'Completed') {
          const err = new Error('Completed batches cannot be deleted. Reverse the yield first.');
          err.statusCode = 400;
          throw err;
        }

        // Detach raw lot if it exists and has no movements other than receipts
        const lot = await trx('inventory_lots')
          .where({ batch_ref: `batch-${batchId}`, type: 'raw', entity: 'mill' })
          .first();
        if (lot) {
          const consumed = await trx('inventory_movements')
            .where('lot_id', lot.id)
            .whereIn('movement_type', ['production_issue', 'adjustment_minus'])
            .count('* as n').first();
          if (parseInt(consumed.n, 10) > 0) {
            const err = new Error('Raw rice from this batch has already been consumed/adjusted; cannot delete.');
            err.statusCode = 400;
            throw err;
          }
          await trx('inventory_movements').where('lot_id', lot.id).del();
          await trx('lot_transactions').where('lot_id', lot.id).del();
          await trx('inventory_lots').where('id', lot.id).del();
        }

        await trx('milling_vehicle_arrivals').where({ batch_id: batchId }).del();
        await trx('milling_quality_samples').where({ batch_id: batchId }).del();
        try { await trx('milling_costs').where({ batch_id: batchId }).del(); } catch (_) { /* table may differ */ }
        await trx('milling_batches').where({ id: batchId }).del();
      });

      return res.json({ success: true, message: 'Batch deleted.' });
    } catch (err) {
      console.error('Milling deleteBatch error:', err);
      return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },
};

module.exports = millingController;
