/**
 * RiceFlow ERP — Lot-Based Inventory Controller
 * Full lot CRUD, purchase-to-lot creation, transactions, costing, reports.
 * All quantities stored in KG; display units derived at read time.
 */

const db = require('../config/database');
const uc = require('../services/unitConversion');

async function generateTxnNo(trx) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = await trx('lot_transactions').count('id as c').first();
  return `TXN-${today}-${String((count?.c || 0) + 1).padStart(4, '0')}`;
}

/** Compute derived unit fields from KG-based lot */
function enrichLot(lot) {
  if (!lot) return lot;
  const bw = parseFloat(lot.bag_weight_kg) || 50;
  const rawNetKg = parseFloat(lot.net_weight_kg) || 0;
  const netKg = rawNetKg > 0 ? rawNetKg : (parseFloat(lot.qty) || 0) * 1000;
  const availKg = (parseFloat(lot.available_qty) || 0) * 1000; // available_qty is in MT
  const reservedKg = (parseFloat(lot.reserved_qty) || 0) * 1000; // reserved_qty is in MT
  const soldKg = parseFloat(lot.sold_weight_kg) || 0;
  const damagedKg = parseFloat(lot.damaged_weight_kg) || 0;
  const rateKg = parseFloat(lot.rate_per_kg) || (parseFloat(lot.cost_per_unit) || 0) / 1000;
  const landedKg = parseFloat(lot.landed_cost_per_kg) || rateKg;

  return {
    ...lot,
    // Derived quantity equivalents
    total_katta: uc.kgToKatta(netKg, bw),
    total_maund: uc.kgToMaund(netKg),
    total_ton: uc.kgToTon(netKg),
    available_katta: uc.kgToKatta(availKg, bw),
    available_maund: uc.kgToMaund(availKg),
    available_ton: uc.kgToTon(availKg),
    reserved_katta: uc.kgToKatta(reservedKg, bw),
    reserved_maund: uc.kgToMaund(reservedKg),
    sold_katta: uc.kgToKatta(soldKg, bw),
    sold_maund: uc.kgToMaund(soldKg),
    damaged_katta: uc.kgToKatta(damagedKg, bw),
    damaged_maund: uc.kgToMaund(damagedKg),
    // Derived rate equivalents
    rate_per_katta: uc.ratePerKgToKatta(rateKg, bw),
    rate_per_maund: uc.ratePerKgToMaund(rateKg),
    rate_per_ton: uc.ratePerKgToTon(rateKg),
    landed_cost_per_katta: uc.ratePerKgToKatta(landedKg, bw),
    landed_cost_per_maund: uc.ratePerKgToMaund(landedKg),
    landed_cost_per_ton: uc.ratePerKgToTon(landedKg),
  };
}

module.exports = {

  // ─── List Lots ───
  async listLots(req, res) {
    try {
      const { page = 1, limit = 50, type, entity, warehouse_id, status, supplier_id, variety, search, sort_by = 'created_at', sort_dir = 'desc' } = req.query;
      const offset = (page - 1) * limit;

      let query = db('inventory_lots as l')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .leftJoin('products as p', 'l.product_id', 'p.id')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .select(
          'l.*',
          'w.name as warehouse_name',
          'p.name as product_name',
          's.name as supplier_name'
        );

      if (type) query = query.where('l.type', type);
      if (entity) query = query.where('l.entity', entity);
      if (warehouse_id) query = query.where('l.warehouse_id', warehouse_id);
      if (status) query = query.where('l.status', status);
      if (supplier_id) query = query.where('l.supplier_id', supplier_id);
      if (variety) query = query.where('l.variety', 'ilike', `%${variety}%`);
      if (search) {
        query = query.where(function () {
          this.where('l.lot_no', 'ilike', `%${search}%`)
            .orWhere('l.item_name', 'ilike', `%${search}%`)
            .orWhere('l.variety', 'ilike', `%${search}%`)
            .orWhere('s.name', 'ilike', `%${search}%`);
        });
      }

      const [{ count: total }] = await query.clone().clearSelect().count('l.id as count');
      const lots = await query.orderBy(`l.${sort_by}`, sort_dir).limit(limit).offset(offset);

      return res.json({
        success: true,
        data: {
          lots: lots.map(enrichLot),
          pagination: { page: +page, limit: +limit, total: +total, totalPages: Math.ceil(total / limit) },
        },
      });
    } catch (err) {
      console.error('listLots error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Get Lot Detail ───
  async getLotDetail(req, res) {
    try {
      const { id } = req.params;
      const isNumeric = /^\d+$/.test(id);
      const where = isNumeric ? { 'l.id': +id } : { 'l.lot_no': id };

      const lot = await db('inventory_lots as l')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .leftJoin('products as p', 'l.product_id', 'p.id')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .select('l.*', 'w.name as warehouse_name', 'p.name as product_name', 's.name as supplier_name')
        .where(where).first();

      if (!lot) return res.status(404).json({ success: false, message: 'Lot not found.' });

      const transactions = await db('lot_transactions')
        .where({ lot_id: lot.id })
        .orderBy('transaction_date', 'desc')
        .orderBy('created_at', 'desc');

      const reservations = await db('inventory_reservations as r')
        .leftJoin('export_orders as eo', 'r.order_id', 'eo.id')
        .select('r.*', 'eo.order_no')
        .where({ 'r.lot_id': lot.id });

      return res.json({
        success: true,
        data: { lot: enrichLot(lot), transactions, reservations },
      });
    } catch (err) {
      console.error('getLotDetail error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Create Lot from Purchase ───
  async createPurchaseLot(req, res) {
    try {
      const {
        item_name, type = 'raw', entity = 'mill', warehouse_id, product_id,
        supplier_id, broker_id, purchase_date, crop_year,
        variety, grade, moisture_pct, broken_pct, sortex_status, whiteness, quality_notes,
        bag_type, bag_quality, bag_size_kg, bag_weight_gm, bag_color,
        bag_cost_per_bag, bag_cost_included,
        // Quantity — user enters in chosen unit
        quantity_input, quantity_unit = 'katta', bag_weight_kg = 50,
        // Rate — user enters in chosen unit
        rate_input, rate_unit = 'katta',
        // Additional costs
        transport_cost = 0, labor_cost = 0, unloading_cost = 0,
        packing_cost = 0, other_cost = 0,
        total_bags: inputTotalBags,
        notes, payment_status = 'Unpaid',
      } = req.body;

      if (!item_name || !quantity_input || !rate_input) {
        return res.status(400).json({ success: false, message: 'item_name, quantity_input, and rate_input are required.' });
      }

      const bagWt = parseFloat(bag_weight_kg) || 50;
      const netWeightKg = uc.toKg(quantity_input, quantity_unit, bagWt);
      const ratePerKg = uc.rateToPerKg(rate_input, rate_unit, bagWt);
      const totalBags = inputTotalBags || (quantity_unit === 'katta' || quantity_unit === 'bag' ? Math.round(parseFloat(quantity_input)) : Math.round(netWeightKg / bagWt));
      const purchaseAmount = uc.round2(netWeightKg * ratePerKg);

      // Landed cost calculation
      const directCosts = [transport_cost, labor_cost, unloading_cost, packing_cost, other_cost].reduce((s, c) => s + (parseFloat(c) || 0), 0);
      const totalBagCost = (bag_cost_included ? 0 : (parseFloat(bag_cost_per_bag) || 0) * totalBags);
      const landedCostTotal = uc.round2(purchaseAmount + directCosts + totalBagCost);
      const landedCostPerKg = netWeightKg > 0 ? uc.round4(landedCostTotal / netWeightKg) : 0;

      const result = await db.transaction(async (trx) => {
        // Generate lot number
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const cnt = await trx('inventory_lots').count('id as c').first();
        const lotNo = `LOT-${today}-${String((cnt?.c || 0) + 1).padStart(4, '0')}`;

        const [lot] = await trx('inventory_lots').insert({
          lot_no: lotNo,
          item_name,
          type,
          entity,
          warehouse_id: warehouse_id || null,
          product_id: product_id || null,
          qty: uc.kgToTon(netWeightKg), // legacy field in MT
          unit: 'MT',
          status: 'Available',
          // Supplier
          supplier_id: supplier_id || null,
          broker_id: broker_id || null,
          purchase_date: purchase_date || new Date().toISOString().slice(0, 10),
          crop_year: crop_year || null,
          // Quality
          variety: variety || null,
          grade: grade || null,
          moisture_pct: moisture_pct || null,
          broken_pct: broken_pct || null,
          sortex_status: sortex_status || null,
          whiteness: whiteness || null,
          quality_notes: quality_notes || null,
          // Bags
          bag_type: bag_type || null,
          bag_quality: bag_quality || null,
          bag_size_kg: bag_size_kg || null,
          bag_weight_gm: bag_weight_gm || null,
          bag_color: bag_color || null,
          bag_cost_per_bag: bag_cost_per_bag || 0,
          bag_cost_included: !!bag_cost_included,
          // Units
          standard_unit_type: quantity_unit || 'katta',
          bag_weight_kg: bagWt,
          total_bags: totalBags,
          gross_weight_kg: netWeightKg,
          net_weight_kg: netWeightKg,
          // Pricing
          rate_input_unit: rate_unit,
          rate_input_value: parseFloat(rate_input),
          rate_per_kg: ratePerKg,
          purchase_amount: purchaseAmount,
          // Costs
          transport_cost: parseFloat(transport_cost) || 0,
          labor_cost: parseFloat(labor_cost) || 0,
          unloading_cost: parseFloat(unloading_cost) || 0,
          packing_cost: parseFloat(packing_cost) || 0,
          other_cost: parseFloat(other_cost) || 0,
          total_bag_cost: totalBagCost,
          landed_cost_total: landedCostTotal,
          landed_cost_per_kg: landedCostPerKg,
          // Stock
          available_qty: netWeightKg / 1000, // legacy field in MT
          reserved_qty: 0,
          sold_weight_kg: 0,
          damaged_weight_kg: 0,
          cost_per_unit: landedCostPerKg * 1000, // per MT for legacy
          total_value: landedCostTotal,
          // Payment
          payment_status,
          paid_amount: 0,
          due_amount: landedCostTotal,
          notes: notes || null,
          created_by: req.user?.id || null,
        }).returning('*');

        // Create initial purchase_in transaction
        const txnNo = await generateTxnNo(trx);
        await trx('lot_transactions').insert({
          transaction_no: txnNo,
          transaction_date: purchase_date || new Date().toISOString().slice(0, 10),
          lot_id: lot.id,
          transaction_type: 'purchase_in',
          reference_module: 'purchase',
          warehouse_to_id: warehouse_id || null,
          input_unit: quantity_unit,
          input_qty: parseFloat(quantity_input),
          quantity_kg: netWeightKg,
          quantity_bags: totalBags,
          rate_input_unit: rate_unit,
          rate_input_value: parseFloat(rate_input),
          rate_per_kg: ratePerKg,
          cost_impact: landedCostTotal,
          currency: 'PKR',
          balance_kg: netWeightKg,
          balance_bags: totalBags,
          remarks: `Purchase: ${parseFloat(quantity_input)} ${quantity_unit} @ ${parseFloat(rate_input)}/${rate_unit}`,
          created_by: req.user?.id || null,
        });

        // Also create legacy inventory_movements entry
        await trx('inventory_movements').insert({
          lot_id: lot.id,
          movement_type: 'purchase_receipt',
          qty: uc.kgToTon(netWeightKg),
          to_warehouse_id: warehouse_id || null,
          dest_entity: entity,
          notes: `Purchase lot ${lotNo}`,
          cost_per_unit: landedCostPerKg * 1000,
          total_cost: landedCostTotal,
          currency: 'PKR',
          created_by: req.user?.id || null,
        });

        return lot;
      });

      return res.status(201).json({
        success: true,
        data: { lot: enrichLot(result) },
      });
    } catch (err) {
      console.error('createPurchaseLot error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Record Lot Transaction ───
  async recordTransaction(req, res) {
    try {
      const { lot_id } = req.params;
      const {
        transaction_type, transaction_date,
        quantity_input, quantity_unit = 'kg', bag_weight_kg = 50,
        warehouse_from_id, warehouse_to_id,
        reference_module, reference_id, reference_no,
        rate_input, rate_unit,
        remarks,
      } = req.body;

      if (!transaction_type || !quantity_input) {
        return res.status(400).json({ success: false, message: 'transaction_type and quantity_input required.' });
      }

      const bagWt = parseFloat(bag_weight_kg) || 50;
      const qtyKg = uc.toKg(quantity_input, quantity_unit, bagWt);
      const bags = Math.round(qtyKg / bagWt);

      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where({ id: lot_id }).first();
        if (!lot) throw new Error('Lot not found');

        const currentKg = parseFloat(lot.net_weight_kg) || 0;
        const currentAvail = parseFloat(lot.available_qty) || 0; // in MT

        // Determine direction
        const outbound = ['milling_issue', 'export_allocation', 'sales_allocation', 'dispatch_out', 'wastage', 'damage', 'shortage', 'lot_split'].includes(transaction_type);
        const inbound = ['purchase_in', 'milling_receipt', 'warehouse_transfer_in', 'return_in', 'lot_merge', 'stock_adjustment_plus'].includes(transaction_type);

        if (outbound) {
          const availKg = currentAvail * 1000; // MT to KG
          if (qtyKg > availKg + 0.001) {
            throw new Error(`Insufficient stock: need ${qtyKg} kg but only ${availKg.toFixed(3)} kg available`);
          }
        }

        // Compute new balances
        let newNetKg = currentKg;
        let newAvailMT = currentAvail;
        let soldDelta = 0, damagedDelta = 0;

        if (outbound) {
          newNetKg = currentKg; // net doesn't change for allocation, only avail
          newAvailMT = currentAvail - (qtyKg / 1000);
          if (['dispatch_out', 'sales_allocation'].includes(transaction_type)) soldDelta = qtyKg;
          if (['wastage', 'damage', 'shortage'].includes(transaction_type)) damagedDelta = qtyKg;
        } else if (inbound) {
          newNetKg = currentKg + qtyKg;
          newAvailMT = currentAvail + (qtyKg / 1000);
        }

        // Update lot
        const updates = {
          net_weight_kg: newNetKg,
          available_qty: Math.max(0, newAvailMT),
          qty: Math.max(0, newAvailMT + (parseFloat(lot.reserved_qty) || 0)),
        };
        if (soldDelta > 0) updates.sold_weight_kg = (parseFloat(lot.sold_weight_kg) || 0) + soldDelta;
        if (damagedDelta > 0) updates.damaged_weight_kg = (parseFloat(lot.damaged_weight_kg) || 0) + damagedDelta;
        if (newAvailMT <= 0.001 && (parseFloat(lot.reserved_qty) || 0) <= 0.001) updates.status = 'Closed';

        await trx('inventory_lots').where({ id: lot_id }).update(updates);

        // Insert transaction
        const txnNo = await generateTxnNo(trx);
        const rateKg = rate_input ? uc.rateToPerKg(rate_input, rate_unit || 'kg', bagWt) : null;

        const [txn] = await trx('lot_transactions').insert({
          transaction_no: txnNo,
          transaction_date: transaction_date || new Date().toISOString().slice(0, 10),
          lot_id: +lot_id,
          transaction_type,
          reference_module: reference_module || null,
          reference_id: reference_id || null,
          reference_no: reference_no || null,
          warehouse_from_id: warehouse_from_id || null,
          warehouse_to_id: warehouse_to_id || null,
          input_unit: quantity_unit,
          input_qty: parseFloat(quantity_input),
          quantity_kg: outbound ? -qtyKg : qtyKg,
          quantity_bags: outbound ? -bags : bags,
          rate_input_unit: rate_unit || null,
          rate_input_value: rate_input ? parseFloat(rate_input) : null,
          rate_per_kg: rateKg,
          cost_impact: rateKg ? uc.round2(qtyKg * rateKg) : null,
          currency: 'PKR',
          balance_kg: newNetKg,
          balance_bags: Math.round(newNetKg / bagWt),
          remarks: remarks || null,
          created_by: req.user?.id || null,
        }).returning('*');

        return txn;
      });

      return res.json({ success: true, data: { transaction: result } });
    } catch (err) {
      console.error('recordTransaction error:', err);
      const status = err.message.includes('Insufficient') ? 400 : 500;
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // ─── Get Lot Transactions ───
  async getLotTransactions(req, res) {
    try {
      const { id } = req.params;
      const txns = await db('lot_transactions')
        .where({ lot_id: id })
        .orderBy('transaction_date', 'desc')
        .orderBy('created_at', 'desc');

      // Enrich with unit equivalents
      const enriched = txns.map(t => {
        const bw = 50; // default
        const absKg = Math.abs(parseFloat(t.quantity_kg) || 0);
        return {
          ...t,
          quantity_katta: uc.kgToKatta(absKg, bw),
          quantity_maund: uc.kgToMaund(absKg),
          quantity_ton: uc.kgToTon(absKg),
          balance_katta: uc.kgToKatta(parseFloat(t.balance_kg) || 0, bw),
          balance_maund: uc.kgToMaund(parseFloat(t.balance_kg) || 0),
        };
      });

      return res.json({ success: true, data: { transactions: enriched } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Inventory Reports ───
  async getStockReport(req, res) {
    try {
      const { group_by = 'supplier', status = 'Available' } = req.query;

      let query = db('inventory_lots as l')
        .leftJoin('suppliers as s', 'l.supplier_id', 's.id')
        .leftJoin('warehouses as w', 'l.warehouse_id', 'w.id');

      if (status && status !== 'all') query = query.where('l.status', status);

      let groupCol, nameCol;
      if (group_by === 'supplier') { groupCol = 'l.supplier_id'; nameCol = 's.name'; }
      else if (group_by === 'warehouse') { groupCol = 'l.warehouse_id'; nameCol = 'w.name'; }
      else if (group_by === 'variety') { groupCol = 'l.variety'; nameCol = 'l.variety'; }
      else { groupCol = 'l.type'; nameCol = 'l.type'; }

      const rows = await query
        .select(
          db.raw(`${nameCol} as group_name`),
          db.raw('COUNT(l.id) as lot_count'),
          db.raw('COALESCE(SUM(CASE WHEN l.net_weight_kg > 0 THEN l.net_weight_kg ELSE CAST(l.qty AS DECIMAL) * 1000 END), 0) as total_kg'),
          db.raw('COALESCE(SUM(CAST(l.available_qty AS DECIMAL) * 1000), 0) as available_kg'),
          db.raw('COALESCE(SUM(CAST(l.reserved_qty AS DECIMAL) * 1000), 0) as reserved_kg'),
          db.raw('COALESCE(SUM(l.sold_weight_kg), 0) as sold_kg'),
          db.raw('COALESCE(SUM(l.damaged_weight_kg), 0) as damaged_kg'),
          db.raw('COALESCE(SUM(CASE WHEN l.landed_cost_total > 0 THEN l.landed_cost_total ELSE l.total_value END), 0) as total_value'),
        )
        .groupBy(groupCol, nameCol)
        .orderBy('total_kg', 'desc');

      const enriched = rows.map(r => ({
        ...r,
        total_katta: uc.kgToKatta(r.total_kg),
        total_maund: uc.kgToMaund(r.total_kg),
        total_ton: uc.kgToTon(r.total_kg),
        available_katta: uc.kgToKatta(r.available_kg),
        available_maund: uc.kgToMaund(r.available_kg),
      }));

      return res.json({ success: true, data: { report: enriched, group_by } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─── Update Lot Costs ───
  async updateLotCosts(req, res) {
    try {
      const { id } = req.params;
      const { transport_cost, labor_cost, unloading_cost, packing_cost, other_cost, bag_cost_per_bag } = req.body;

      const lot = await db('inventory_lots').where({ id }).first();
      if (!lot) return res.status(404).json({ success: false, message: 'Lot not found.' });

      const netKg = parseFloat(lot.net_weight_kg) || 0;
      const totalBags = lot.total_bags || 0;
      const purchaseAmount = parseFloat(lot.purchase_amount) || 0;

      const tc = parseFloat(transport_cost) ?? parseFloat(lot.transport_cost) ?? 0;
      const lc = parseFloat(labor_cost) ?? parseFloat(lot.labor_cost) ?? 0;
      const ulc = parseFloat(unloading_cost) ?? parseFloat(lot.unloading_cost) ?? 0;
      const pc = parseFloat(packing_cost) ?? parseFloat(lot.packing_cost) ?? 0;
      const oc = parseFloat(other_cost) ?? parseFloat(lot.other_cost) ?? 0;
      const bcpb = parseFloat(bag_cost_per_bag) ?? parseFloat(lot.bag_cost_per_bag) ?? 0;
      const totalBagCost = lot.bag_cost_included ? 0 : bcpb * totalBags;
      const directCosts = tc + lc + ulc + pc + oc;
      const landedTotal = uc.round2(purchaseAmount + directCosts + totalBagCost);
      const landedPerKg = netKg > 0 ? uc.round4(landedTotal / netKg) : 0;

      await db('inventory_lots').where({ id }).update({
        transport_cost: tc, labor_cost: lc, unloading_cost: ulc,
        packing_cost: pc, other_cost: oc, bag_cost_per_bag: bcpb,
        total_bag_cost: totalBagCost,
        landed_cost_total: landedTotal,
        landed_cost_per_kg: landedPerKg,
        total_value: landedTotal,
        cost_per_unit: landedPerKg * 1000,
      });

      const updated = await db('inventory_lots').where({ id }).first();
      return res.json({ success: true, data: { lot: enrichLot(updated) } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  /**
   * GET /sources
   * Return milling batches with vehicle arrivals and quality data,
   * used as a dropdown source for purchase lot creation.
   */
  async getLotSources(req, res) {
    try {
      // 1. Get milling batches with supplier info
      const batches = await db('milling_batches as mb')
        .leftJoin('suppliers as s', 'mb.supplier_id', 's.id')
        .select(
          'mb.id', 'mb.batch_no', 'mb.supplier_id', 's.name as supplier_name',
          'mb.status', 'mb.raw_qty_mt', 'mb.actual_finished_mt',
          'mb.broken_mt', 'mb.bran_mt', 'mb.husk_mt', 'mb.wastage_mt',
          'mb.yield_pct', 'mb.linked_export_order_id',
          'mb.post_milling_grade'
        )
        .orderBy('mb.id', 'desc');

      // 2. Get quality samples for all batches
      const qualitySamples = await db('milling_quality_samples')
        .whereIn('batch_id', batches.map(b => b.id))
        .orderBy('created_at', 'desc');

      // 3. Get vehicle arrivals for all batches
      const vehicles = await db('milling_vehicle_arrivals')
        .whereIn('batch_id', batches.map(b => b.id))
        .orderBy('batch_id', 'asc')
        .orderBy('id', 'asc');

      // 4. Get linked export orders info
      const orderIds = batches.filter(b => b.linked_export_order_id).map(b => b.linked_export_order_id);
      const orders = orderIds.length > 0
        ? await db('export_orders').whereIn('id', orderIds).select('id', 'order_no')
        : [];
      const orderMap = {};
      orders.forEach(o => { orderMap[o.id] = o.order_no; });

      // Build response - each batch with its quality, vehicles, and export order info
      const sources = batches.map(batch => {
        const batchQuality = qualitySamples.filter(q => q.batch_id === batch.id);
        const arrivalQuality = batchQuality.find(q => q.analysis_type === 'arrival');
        const sampleQuality = batchQuality.find(q => q.analysis_type === 'sample');
        const batchVehicles = vehicles.filter(v => v.batch_id === batch.id);

        return {
          ...batch,
          export_order_no: orderMap[batch.linked_export_order_id] || null,
          quality: {
            arrival: arrivalQuality ? {
              moisture: arrivalQuality.moisture,
              broken: arrivalQuality.broken,
              chalky: arrivalQuality.chalky,
              foreign_matter: arrivalQuality.foreign_matter,
              purity: arrivalQuality.purity,
              price_per_mt: arrivalQuality.price_per_mt,
            } : null,
            sample: sampleQuality ? {
              moisture: sampleQuality.moisture,
              broken: sampleQuality.broken,
              chalky: sampleQuality.chalky,
              foreign_matter: sampleQuality.foreign_matter,
              purity: sampleQuality.purity,
              price_per_mt: sampleQuality.price_per_mt,
            } : null,
          },
          vehicles: batchVehicles.map(v => ({
            id: v.id,
            vehicle_no: v.vehicle_no,
            driver_name: v.driver_name,
            weight_mt: v.weight_mt,
            arrival_date: v.arrival_date,
          })),
        };
      });

      return res.json({ success: true, data: { sources } });
    } catch (err) {
      console.error('getLotSources error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};
