const db = require('../config/database');

const MOVEMENT_TYPES = {
  PURCHASE_RECEIPT: 'purchase_receipt',
  INTERNAL_RECEIPT: 'internal_receipt',
  PRODUCTION_ISSUE: 'production_issue',
  PRODUCTION_OUTPUT: 'production_output',
  BYPRODUCT_OUTPUT: 'byproduct_output',
  TRANSFER_OUT: 'transfer_out',
  TRANSFER_IN: 'transfer_in',
  EXPORT_DISPATCH: 'export_dispatch',
  ADJUSTMENT_PLUS: 'adjustment_plus',
  ADJUSTMENT_MINUS: 'adjustment_minus',
  RETURN: 'return',
};

// Movement types that reduce stock
const OUTBOUND_TYPES = new Set([
  MOVEMENT_TYPES.PRODUCTION_ISSUE,
  MOVEMENT_TYPES.TRANSFER_OUT,
  MOVEMENT_TYPES.EXPORT_DISPATCH,
  MOVEMENT_TYPES.ADJUSTMENT_MINUS,
]);

// Movement types that increase stock
const INBOUND_TYPES = new Set([
  MOVEMENT_TYPES.PURCHASE_RECEIPT,
  MOVEMENT_TYPES.INTERNAL_RECEIPT,
  MOVEMENT_TYPES.PRODUCTION_OUTPUT,
  MOVEMENT_TYPES.BYPRODUCT_OUTPUT,
  MOVEMENT_TYPES.TRANSFER_IN,
  MOVEMENT_TYPES.ADJUSTMENT_PLUS,
  MOVEMENT_TYPES.RETURN,
]);

const LOT_TRANSACTION_TYPE_MAP = {
  [MOVEMENT_TYPES.PURCHASE_RECEIPT]: 'purchase_in',
  [MOVEMENT_TYPES.INTERNAL_RECEIPT]: 'warehouse_transfer_in',
  [MOVEMENT_TYPES.PRODUCTION_ISSUE]: 'milling_issue',
  [MOVEMENT_TYPES.PRODUCTION_OUTPUT]: 'milling_receipt',
  [MOVEMENT_TYPES.BYPRODUCT_OUTPUT]: 'milling_receipt',
  [MOVEMENT_TYPES.TRANSFER_OUT]: 'warehouse_transfer_out',
  [MOVEMENT_TYPES.TRANSFER_IN]: 'warehouse_transfer_in',
  [MOVEMENT_TYPES.EXPORT_DISPATCH]: 'dispatch_out',
  [MOVEMENT_TYPES.ADJUSTMENT_PLUS]: 'stock_adjustment_plus',
  [MOVEMENT_TYPES.ADJUSTMENT_MINUS]: 'stock_adjustment_minus',
  [MOVEMENT_TYPES.RETURN]: 'return_in',
};

function getMovementDirection(movementType) {
  if (INBOUND_TYPES.has(movementType)) return 1;
  if (OUTBOUND_TYPES.has(movementType)) return -1;
  return 0;
}

async function generateLotTxnNo(trx) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = await trx('lot_transactions').count('id as c').first();
  return `TXN-${today}-${String((count?.c || 0) + 1).padStart(4, '0')}`;
}

function resolveReferenceModule({ orderId, batchId, transferId, sourceEntity }) {
  if (orderId) return 'export_order';
  if (batchId) return 'milling_batch';
  if (transferId) return 'internal_transfer';
  return sourceEntity || null;
}

const inventoryService = {
  MOVEMENT_TYPES,

  /**
   * Generate a unique lot number: LOT-YYYYMMDD-XXXX
   */
  async generateLotNo(trx) {
    const today = new Date();
    const dateStr =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, '0') +
      String(today.getDate()).padStart(2, '0');

    const prefix = `LOT-${dateStr}-`;

    const last = await (trx || db)('inventory_lots')
      .where('lot_no', 'like', `${prefix}%`)
      .orderBy('lot_no', 'desc')
      .select('lot_no')
      .first();

    let seq = 1;
    if (last && last.lot_no) {
      const parts = last.lot_no.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        seq = lastSeq + 1;
      }
    }

    return `${prefix}${String(seq).padStart(4, '0')}`;
  },

  // =========================================================================
  // CORE: Post a stock movement
  // =========================================================================
  async postMovement(trx, {
    movementType,
    lotId,
    qty,
    fromWarehouseId,
    toWarehouseId,
    sourceEntity,
    destEntity,
    linkedRef,
    notes,
    costPerUnit,
    currency,
    batchId,
    orderId,
    transferId,
    userId,
  }) {
    if (!trx) throw new Error('postMovement requires a transaction');
    if (!movementType) throw new Error('movementType is required');
    if (!lotId) throw new Error('lotId is required');
    if (qty == null || qty <= 0) throw new Error('qty must be a positive number');

    const parsedQty = parseFloat(qty);
    const parsedCost = parseFloat(costPerUnit) || 0;
    const totalCost = parsedCost * parsedQty;
    const movementQtyKg = parsedQty * 1000;
    const direction = getMovementDirection(movementType);

    // 1. Validate lot exists
    const lot = await trx('inventory_lots').where('id', lotId).first();
    if (!lot) {
      throw new Error(`Lot ${lotId} not found`);
    }

    // 2. For outbound movements: check sufficient available qty
    if (OUTBOUND_TYPES.has(movementType)) {
      const availableQty = parseFloat(lot.available_qty) || 0;
      if (availableQty < parsedQty) {
        throw new Error(
          `Insufficient stock in lot ${lot.lot_no}: available ${availableQty} ${lot.unit}, required ${parsedQty}`
        );
      }
    }

    // 3. Insert movement record
    const [movement] = await trx('inventory_movements')
      .insert({
        lot_id: lotId,
        movement_type: movementType,
        qty: parsedQty,
        from_warehouse_id: fromWarehouseId || null,
        to_warehouse_id: toWarehouseId || null,
        source_entity: sourceEntity || null,
        dest_entity: destEntity || null,
        linked_ref: linkedRef || null,
        notes: notes || null,
        cost_per_unit: parsedCost,
        total_cost: totalCost,
        currency: currency || 'PKR',
        batch_id: batchId || null,
        order_id: orderId || null,
        transfer_id: transferId || null,
        created_by: userId || null,
      })
      .returning('*');

    // 4. Update lot qty
    const currentQty = parseFloat(lot.qty) || 0;
    const currentReserved = parseFloat(lot.reserved_qty) || 0;
    let newQty;

    if (INBOUND_TYPES.has(movementType)) {
      newQty = currentQty + parsedQty;
    } else if (OUTBOUND_TYPES.has(movementType)) {
      newQty = currentQty - parsedQty;
    } else {
      throw new Error(`Unknown movement type: ${movementType}`);
    }

    // 5. available_qty = qty - reserved_qty
    const newAvailable = newQty - currentReserved;
    const currentNetWeightKg = parseFloat(lot.net_weight_kg) || currentQty * 1000;
    const newNetWeightKg = currentNetWeightKg + (direction * movementQtyKg);
    const newGrossWeightKg = newNetWeightKg;

    // 6. Recalculate total_value
    const newCostPerUnit = parsedCost > 0 ? parsedCost : parseFloat(lot.cost_per_unit) || 0;
    const newTotalValue = newCostPerUnit * newQty;

    await trx('inventory_lots').where('id', lotId).update({
      qty: newQty,
      available_qty: newAvailable,
      cost_per_unit: newCostPerUnit,
      total_value: newTotalValue,
      net_weight_kg: newNetWeightKg,
      gross_weight_kg: newGrossWeightKg,
      updated_at: trx.fn.now(),
    });

    const txnNo = await generateLotTxnNo(trx);
    await trx('lot_transactions').insert({
      transaction_no: txnNo,
      transaction_date: new Date().toISOString().slice(0, 10),
      lot_id: lotId,
      transaction_type: LOT_TRANSACTION_TYPE_MAP[movementType] || movementType,
      reference_module: resolveReferenceModule({ orderId, batchId, transferId, sourceEntity }),
      reference_id: orderId || batchId || transferId || null,
      reference_no: linkedRef || null,
      warehouse_from_id: fromWarehouseId || null,
      warehouse_to_id: toWarehouseId || null,
      input_unit: 'MT',
      input_qty: parsedQty,
      quantity_kg: direction * movementQtyKg,
      quantity_bags: direction * Math.round(movementQtyKg / (parseFloat(lot.bag_weight_kg) || 50)),
      rate_input_unit: 'MT',
      rate_input_value: parsedCost || null,
      rate_per_kg: parsedCost > 0 ? parsedCost / 1000 : null,
      cost_impact: totalCost,
      currency: currency || 'PKR',
      balance_kg: newNetWeightKg,
      balance_bags: Math.round(newNetWeightKg / (parseFloat(lot.bag_weight_kg) || 50)),
      remarks: notes || null,
      created_by: userId || null,
    });

    // 7. Return the movement record
    return movement;
  },

  // =========================================================================
  // Create a new lot
  // =========================================================================
  async createLot(trx, {
    itemName,
    type,
    entity,
    warehouseId,
    qty,
    unit,
    productId,
    batchRef,
    costPerUnit,
    costCurrency,
    userId,
  }) {
    if (!trx) throw new Error('createLot requires a transaction');

    const lotNo = await inventoryService.generateLotNo(trx);
    const parsedQty = parseFloat(qty) || 0;
    const parsedCost = parseFloat(costPerUnit) || 0;

    const [lot] = await trx('inventory_lots')
      .insert({
        lot_no: lotNo,
        item_name: itemName,
        type: type || 'raw',
        entity: entity || 'mill',
        warehouse_id: warehouseId || null,
        qty: 0,
        unit: unit || 'MT',
        product_id: productId || null,
        batch_ref: batchRef || null,
        cost_per_unit: 0,
        cost_currency: costCurrency || 'PKR',
        total_value: 0,
        reserved_qty: 0,
        available_qty: 0,
        net_weight_kg: 0,
        gross_weight_kg: 0,
        status: 'Available',
        created_by: userId || null,
      })
      .returning('*');

    // Post an initial receipt movement
    const movementType =
      type === 'raw'
        ? MOVEMENT_TYPES.PURCHASE_RECEIPT
        : MOVEMENT_TYPES.INTERNAL_RECEIPT;

    const movement = await inventoryService.postMovement(trx, {
      movementType,
      lotId: lot.id,
      qty: parsedQty,
      toWarehouseId: warehouseId,
      destEntity: entity,
      linkedRef: batchRef || null,
      notes: `Initial receipt for lot ${lotNo}`,
      costPerUnit: parsedCost,
      currency: costCurrency || 'PKR',
      userId,
    });

    const updatedLot = await trx('inventory_lots').where('id', lot.id).first();
    return { lot: updatedLot, movement };
  },

  // =========================================================================
  // Receive raw paddy (from vehicle arrival / purchase)
  // =========================================================================
  async receiveRawPaddy(trx, {
    batchId,
    weightMT,
    costPerMT,
    currency,
    supplierId,
    vehicleNo,
    userId,
  }) {
    if (!trx) throw new Error('receiveRawPaddy requires a transaction');

    const parsedWeight = parseFloat(weightMT);
    const parsedCost = parseFloat(costPerMT) || 0;

    // Look for an existing raw paddy lot for this batch in Mill Raw Stock
    let lot = await trx('inventory_lots')
      .where({ batch_ref: `batch-${batchId}`, type: 'raw', entity: 'mill' })
      .first();

    let movement;

    if (lot) {
      // Post receipt to existing lot
      movement = await inventoryService.postMovement(trx, {
        movementType: MOVEMENT_TYPES.PURCHASE_RECEIPT,
        lotId: lot.id,
        qty: parsedWeight,
        toWarehouseId: lot.warehouse_id,
        destEntity: 'mill',
        linkedRef: vehicleNo ? `vehicle-${vehicleNo}` : null,
        notes: `Raw paddy receipt for batch ${batchId}${vehicleNo ? `, vehicle ${vehicleNo}` : ''}`,
        costPerUnit: parsedCost,
        currency: currency || 'PKR',
        batchId,
        userId,
      });

      // Refresh lot
      lot = await trx('inventory_lots').where('id', lot.id).first();
    } else {
      // Find the Mill Raw Stock warehouse
      let warehouse = await trx('warehouses')
        .where({ entity: 'mill', type: 'raw' })
        .first();

      if (!warehouse) {
        // Create one if it does not exist
        [warehouse] = await trx('warehouses')
          .insert({ name: 'Mill Raw Stock', entity: 'mill', type: 'raw' })
          .returning('*');
      }

      const lotNo = await inventoryService.generateLotNo(trx);

      [lot] = await trx('inventory_lots')
        .insert({
          lot_no: lotNo,
          item_name: 'Raw Paddy',
          type: 'raw',
          entity: 'mill',
          warehouse_id: warehouse.id,
          qty: 0,
          unit: 'MT',
          batch_ref: `batch-${batchId}`,
          cost_per_unit: 0,
          cost_currency: currency || 'PKR',
          total_value: 0,
          reserved_qty: 0,
          available_qty: 0,
          net_weight_kg: 0,
          gross_weight_kg: 0,
          status: 'Available',
          created_by: userId || null,
          // Enrichment
          supplier_id: supplierId || null,
          rate_per_kg: 0,
          purchase_amount: 0,
          landed_cost_total: 0,
          landed_cost_per_kg: 0,
        })
        .returning('*');

      movement = await inventoryService.postMovement(trx, {
        movementType: MOVEMENT_TYPES.PURCHASE_RECEIPT,
        lotId: lot.id,
        qty: parsedWeight,
        toWarehouseId: warehouse.id,
        destEntity: 'mill',
        linkedRef: vehicleNo ? `vehicle-${vehicleNo}` : null,
        notes: `Raw paddy receipt for batch ${batchId}${vehicleNo ? `, vehicle ${vehicleNo}` : ''}`,
        costPerUnit: parsedCost,
        currency: currency || 'PKR',
        batchId,
        userId,
      });

      lot = await trx('inventory_lots').where('id', lot.id).first();
    }

    return { lot, movement };
  },

  // =========================================================================
  // Consume raw material for milling
  // =========================================================================
  async consumeForMilling(trx, { batchId, qtyMT, userId }) {
    if (!trx) throw new Error('consumeForMilling requires a transaction');

    const parsedQty = parseFloat(qtyMT);

    // Find raw paddy lot for this batch
    const lot = await trx('inventory_lots')
      .where({ batch_ref: `batch-${batchId}`, type: 'raw', entity: 'mill' })
      .first();

    if (!lot) {
      throw new Error(`No raw paddy lot found for batch ${batchId}`);
    }

    // validateSufficientStock is called inside postMovement for outbound types
    const movement = await inventoryService.postMovement(trx, {
      movementType: MOVEMENT_TYPES.PRODUCTION_ISSUE,
      lotId: lot.id,
      qty: parsedQty,
      fromWarehouseId: lot.warehouse_id,
      sourceEntity: 'mill',
      linkedRef: `batch-${batchId}`,
      notes: `Raw paddy consumed for milling batch ${batchId}`,
      costPerUnit: parseFloat(lot.cost_per_unit) || 0,
      currency: lot.cost_currency || 'PKR',
      batchId,
      userId,
    });

    return movement;
  },

  // =========================================================================
  // Record milling output (finished rice + by-products)
  // =========================================================================
  async recordMillingOutput(trx, {
    batchId,
    finishedMT,
    brokenMT,
    branMT,
    huskMT,
    productName,
    costPerMT,
    rawCostComponent,
    millingCostComponent,
    userId,
    // Optional enrichment from batch/quality
    supplierInfo,
    qualityInfo,
  }) {
    if (!trx) throw new Error('recordMillingOutput requires a transaction');

    const results = { lots: [], movements: [] };

    // Find or create Mill Finished Goods warehouse
    let fgWarehouse = await trx('warehouses')
      .where({ entity: 'mill', type: 'finished' })
      .first();
    if (!fgWarehouse) {
      [fgWarehouse] = await trx('warehouses')
        .insert({ name: 'Mill Finished Goods', entity: 'mill', type: 'finished' })
        .returning('*');
    }

    // Find or create Mill By-Products warehouse
    let bpWarehouse = await trx('warehouses')
      .where({ entity: 'mill', type: 'byproduct' })
      .first();
    if (!bpWarehouse) {
      [bpWarehouse] = await trx('warehouses')
        .insert({ name: 'Mill By-Products', entity: 'mill', type: 'byproduct' })
        .returning('*');
    }

    const parsedCost = parseFloat(costPerMT) || 0;

    // --- Finished rice ---
    const finishedQty = parseFloat(finishedMT) || 0;
    if (finishedQty > 0) {
      const lotNo = await inventoryService.generateLotNo(trx);
      const [lot] = await trx('inventory_lots')
        .insert({
          lot_no: lotNo,
          item_name: productName || 'Finished Rice',
          type: 'finished',
          entity: 'mill',
          warehouse_id: fgWarehouse.id,
          qty: 0,
          unit: 'MT',
          batch_ref: `batch-${batchId}`,
          cost_per_unit: 0,
          cost_currency: 'PKR',
          total_value: 0,
          reserved_qty: 0,
          available_qty: 0,
          status: 'Available',
          created_by: userId || null,
          // Enrichment from batch/quality data
          supplier_id: supplierInfo?.supplierId || null,
          variety: qualityInfo?.variety || null,
          grade: qualityInfo?.grade || null,
          moisture_pct: qualityInfo?.moisture || null,
          broken_pct: qualityInfo?.broken || null,
          net_weight_kg: 0,
          gross_weight_kg: 0,
          rate_per_kg: rawCostComponent ? (rawCostComponent + (millingCostComponent || 0)) : 0,
          purchase_amount: 0,
          landed_cost_total: 0,
          landed_cost_per_kg: rawCostComponent ? (rawCostComponent + (millingCostComponent || 0)) : 0,
          raw_cost_component: rawCostComponent || null,
          milling_cost_component: millingCostComponent || null,
        })
        .returning('*');

      const movement = await inventoryService.postMovement(trx, {
        movementType: MOVEMENT_TYPES.PRODUCTION_OUTPUT,
        lotId: lot.id,
        qty: finishedQty,
        toWarehouseId: fgWarehouse.id,
        destEntity: 'mill',
        linkedRef: `batch-${batchId}`,
        notes: `Finished rice output from milling batch ${batchId}`,
        costPerUnit: parsedCost,
        currency: 'PKR',
        batchId,
        userId,
      });

      const updatedLot = await trx('inventory_lots').where('id', lot.id).first();
      results.lots.push(updatedLot);
      results.movements.push(movement);
    }

    // --- By-products: broken, bran, husk ---
    const byproducts = [
      { name: 'Broken Rice', qty: parseFloat(brokenMT) || 0 },
      { name: 'Rice Bran', qty: parseFloat(branMT) || 0 },
      { name: 'Rice Husk', qty: parseFloat(huskMT) || 0 },
    ];

    for (const bp of byproducts) {
      if (bp.qty <= 0) continue;

      const lotNo = await inventoryService.generateLotNo(trx);
      const [lot] = await trx('inventory_lots')
        .insert({
          lot_no: lotNo,
          item_name: bp.name,
          type: 'byproduct',
          entity: 'mill',
          warehouse_id: bpWarehouse.id,
          qty: 0,
          unit: 'MT',
          batch_ref: `batch-${batchId}`,
          cost_per_unit: 0,
          cost_currency: 'PKR',
          total_value: 0,
          reserved_qty: 0,
          available_qty: 0,
          net_weight_kg: 0,
          gross_weight_kg: 0,
          status: 'Available',
          created_by: userId || null,
        })
        .returning('*');

      const movement = await inventoryService.postMovement(trx, {
        movementType: MOVEMENT_TYPES.BYPRODUCT_OUTPUT,
        lotId: lot.id,
        qty: bp.qty,
        toWarehouseId: bpWarehouse.id,
        destEntity: 'mill',
        linkedRef: `batch-${batchId}`,
        notes: `${bp.name} from milling batch ${batchId}`,
        costPerUnit: 0,
        currency: 'PKR',
        batchId,
        userId,
      });

      const updatedLot = await trx('inventory_lots').where('id', lot.id).first();
      results.lots.push(updatedLot);
      results.movements.push(movement);
    }

    return results;
  },

  // =========================================================================
  // Transfer from mill to export
  // =========================================================================
  async transferToExport(trx, { transferId, lotId, qtyMT, productName, orderId, userId }) {
    if (!trx) throw new Error('transferToExport requires a transaction');

    const parsedQty = parseFloat(qtyMT);

    // Source lot
    const sourceLot = await trx('inventory_lots').where('id', lotId).first();
    if (!sourceLot) throw new Error(`Source lot ${lotId} not found`);

    // Post transfer_out (reduces mill lot)
    const outMovement = await inventoryService.postMovement(trx, {
      movementType: MOVEMENT_TYPES.TRANSFER_OUT,
      lotId: sourceLot.id,
      qty: parsedQty,
      fromWarehouseId: sourceLot.warehouse_id,
      sourceEntity: 'mill',
      destEntity: 'export',
      linkedRef: transferId ? `transfer-${transferId}` : null,
      notes: `Transfer to export${orderId ? ` for order ${orderId}` : ''}`,
      costPerUnit: parseFloat(sourceLot.cost_per_unit) || 0,
      currency: sourceLot.cost_currency || 'PKR',
      orderId: orderId || null,
      transferId: transferId || null,
      userId,
    });

    // Find or create Export Dispatch warehouse
    let exportWarehouse = await trx('warehouses')
      .where({ entity: 'export', type: 'dispatch' })
      .first();
    if (!exportWarehouse) {
      [exportWarehouse] = await trx('warehouses')
        .insert({ name: 'Export Dispatch', entity: 'export', type: 'dispatch' })
        .returning('*');
    }

    // Create a new lot in Export Dispatch warehouse
    const lotNo = await inventoryService.generateLotNo(trx);
    const costPerUnit = parseFloat(sourceLot.cost_per_unit) || 0;

    const [exportLot] = await trx('inventory_lots')
      .insert({
        lot_no: lotNo,
        item_name: productName || sourceLot.item_name,
        type: 'finished',
        entity: 'export',
        warehouse_id: exportWarehouse.id,
        qty: 0,
        unit: sourceLot.unit || 'MT',
        batch_ref: sourceLot.batch_ref || null,
        cost_per_unit: 0,
        cost_currency: sourceLot.cost_currency || 'PKR',
        total_value: 0,
        reserved_qty: 0,
        available_qty: 0,
        status: 'Available',
        created_by: userId || null,
      })
      .returning('*');

    // Post transfer_in (increases export lot)
    const inMovement = await inventoryService.postMovement(trx, {
      movementType: MOVEMENT_TYPES.TRANSFER_IN,
      lotId: exportLot.id,
      qty: parsedQty,
      toWarehouseId: exportWarehouse.id,
      sourceEntity: 'mill',
      destEntity: 'export',
      linkedRef: transferId ? `transfer-${transferId}` : null,
      notes: `Received from mill${orderId ? ` for order ${orderId}` : ''}`,
      costPerUnit,
      currency: sourceLot.cost_currency || 'PKR',
      orderId: orderId || null,
      transferId: transferId || null,
      userId,
    });

    const updatedExportLot = await trx('inventory_lots').where('id', exportLot.id).first();
    return { outMovement, inMovement, exportLot: updatedExportLot };
  },

  // =========================================================================
  // Dispatch for export shipment
  // =========================================================================
  async dispatchForShipment(trx, { orderId, lotId, qtyMT, userId }) {
    if (!trx) throw new Error('dispatchForShipment requires a transaction');

    const parsedQty = parseFloat(qtyMT);

    const lot = await trx('inventory_lots').where('id', lotId).first();
    if (!lot) throw new Error(`Lot ${lotId} not found`);

    const movement = await inventoryService.postMovement(trx, {
      movementType: MOVEMENT_TYPES.EXPORT_DISPATCH,
      lotId: lot.id,
      qty: parsedQty,
      fromWarehouseId: lot.warehouse_id,
      sourceEntity: lot.entity,
      linkedRef: `order-${orderId}`,
      notes: `Export dispatch for order ${orderId}`,
      costPerUnit: parseFloat(lot.cost_per_unit) || 0,
      currency: lot.cost_currency || 'PKR',
      orderId,
      userId,
    });

    return movement;
  },

  // =========================================================================
  // Reserve stock against an export order
  // =========================================================================
  async reserveStock(trx, { lotId, orderId, qtyMT, userId }) {
    if (!trx) throw new Error('reserveStock requires a transaction');

    const parsedQty = parseFloat(qtyMT);

    const lot = await trx('inventory_lots').where('id', lotId).first();
    if (!lot) throw new Error(`Lot ${lotId} not found`);

    const availableQty = parseFloat(lot.available_qty) || 0;
    if (availableQty < parsedQty) {
      throw new Error(
        `Insufficient available stock in lot ${lot.lot_no}: available ${availableQty} ${lot.unit}, required ${parsedQty}`
      );
    }

    // Insert reservation
    const [reservation] = await trx('inventory_reservations')
      .insert({
        lot_id: lotId,
        order_id: orderId,
        reserved_qty: parsedQty,
        status: 'Active',
        created_by: userId || null,
      })
      .returning('*');

    // Update lot: increase reserved_qty, decrease available_qty
    const newReserved = parseFloat(lot.reserved_qty) + parsedQty;
    const newAvailable = parseFloat(lot.qty) - newReserved;

    await trx('inventory_lots').where('id', lotId).update({
      reserved_qty: newReserved,
      available_qty: newAvailable,
      updated_at: trx.fn.now(),
    });

    return reservation;
  },

  // =========================================================================
  // Release reservation
  // =========================================================================
  async releaseReservation(trx, { reservationId, userId }) {
    if (!trx) throw new Error('releaseReservation requires a transaction');

    const reservation = await trx('inventory_reservations')
      .where('id', reservationId)
      .first();

    if (!reservation) {
      throw new Error(`Reservation ${reservationId} not found`);
    }

    if (reservation.status !== 'Active') {
      throw new Error(`Reservation ${reservationId} is already ${reservation.status}`);
    }

    const lot = await trx('inventory_lots').where('id', reservation.lot_id).first();
    if (!lot) throw new Error(`Lot ${reservation.lot_id} not found`);

    const releasedQty = parseFloat(reservation.reserved_qty);
    const newReserved = Math.max(0, parseFloat(lot.reserved_qty) - releasedQty);
    const newAvailable = parseFloat(lot.qty) - newReserved;

    await trx('inventory_lots').where('id', lot.id).update({
      reserved_qty: newReserved,
      available_qty: newAvailable,
      updated_at: trx.fn.now(),
    });

    await trx('inventory_reservations').where('id', reservationId).update({
      status: 'Released',
      updated_at: trx.fn.now(),
    });

    return { reservationId, status: 'Released', releasedQty };
  },

  // =========================================================================
  // Stock adjustment
  // =========================================================================
  async adjustStock(trx, { lotId, adjustmentQty, reason, userId }) {
    if (!trx) throw new Error('adjustStock requires a transaction');

    const parsedQty = parseFloat(adjustmentQty);
    if (parsedQty === 0) throw new Error('Adjustment qty cannot be zero');

    const lot = await trx('inventory_lots').where('id', lotId).first();
    if (!lot) throw new Error(`Lot ${lotId} not found`);

    const movementType =
      parsedQty > 0
        ? MOVEMENT_TYPES.ADJUSTMENT_PLUS
        : MOVEMENT_TYPES.ADJUSTMENT_MINUS;

    const absQty = Math.abs(parsedQty);

    const movement = await inventoryService.postMovement(trx, {
      movementType,
      lotId,
      qty: absQty,
      fromWarehouseId: parsedQty < 0 ? lot.warehouse_id : null,
      toWarehouseId: parsedQty > 0 ? lot.warehouse_id : null,
      sourceEntity: lot.entity,
      destEntity: lot.entity,
      notes: reason || `Stock adjustment: ${parsedQty > 0 ? '+' : ''}${parsedQty} ${lot.unit}`,
      costPerUnit: parseFloat(lot.cost_per_unit) || 0,
      currency: lot.cost_currency || 'PKR',
      userId,
    });

    return movement;
  },

  // =========================================================================
  // Query helpers
  // =========================================================================
  async getLotById(lotId) {
    const lot = await db('inventory_lots as il')
      .leftJoin('warehouses as w', 'il.warehouse_id', 'w.id')
      .leftJoin('products as p', 'il.product_id', 'p.id')
      .select(
        'il.*',
        'w.name as warehouse_name',
        'p.name as product_name'
      )
      .where('il.id', lotId)
      .first();
    return lot || null;
  },

  async getLotsByWarehouse(warehouseId) {
    return db('inventory_lots as il')
      .leftJoin('warehouses as w', 'il.warehouse_id', 'w.id')
      .select('il.*', 'w.name as warehouse_name')
      .where('il.warehouse_id', warehouseId)
      .orderBy('il.created_at', 'desc');
  },

  async getLotsByEntity(entity) {
    return db('inventory_lots as il')
      .leftJoin('warehouses as w', 'il.warehouse_id', 'w.id')
      .select('il.*', 'w.name as warehouse_name')
      .where('il.entity', entity)
      .orderBy('il.created_at', 'desc');
  },

  async getMovementsByLot(lotId) {
    return db('inventory_movements')
      .where('lot_id', lotId)
      .orderBy('created_at', 'desc');
  },

  async getMovementsByBatch(batchId) {
    return db('inventory_movements')
      .where('batch_id', batchId)
      .orderBy('created_at', 'desc');
  },

  async getMovementsByOrder(orderId) {
    return db('inventory_movements')
      .where('order_id', orderId)
      .orderBy('created_at', 'desc');
  },

  // =========================================================================
  // Stock summary
  // =========================================================================
  async getStockSummary() {
    const rows = await db('inventory_lots as il')
      .leftJoin('warehouses as w', 'il.warehouse_id', 'w.id')
      .select(
        'il.type',
        'il.entity',
        'w.name as warehouse_name',
        'il.warehouse_id'
      )
      .sum('il.qty as total_qty')
      .sum('il.reserved_qty as total_reserved')
      .sum('il.available_qty as total_available')
      .sum('il.total_value as total_value')
      .where('il.status', '!=', 'Depleted')
      .groupBy('il.type', 'il.entity', 'w.name', 'il.warehouse_id')
      .orderBy(['il.entity', 'il.type']);

    // Aggregate high-level summary
    const summary = {
      total_raw: 0,
      total_finished_mill: 0,
      total_finished_export: 0,
      total_byproduct: 0,
      total_value: 0,
      by_warehouse: rows,
    };

    for (const row of rows) {
      const qty = parseFloat(row.total_qty) || 0;
      const val = parseFloat(row.total_value) || 0;
      summary.total_value += val;

      if (row.type === 'raw') {
        summary.total_raw += qty;
      } else if (row.type === 'finished' && row.entity === 'mill') {
        summary.total_finished_mill += qty;
      } else if (row.type === 'finished' && row.entity === 'export') {
        summary.total_finished_export += qty;
      } else if (row.type === 'byproduct') {
        summary.total_byproduct += qty;
      }
    }

    return summary;
  },

  // =========================================================================
  // Negative stock prevention (standalone validator)
  // =========================================================================
  async validateSufficientStock(trx, lotId, requiredQty) {
    const lot = await (trx || db)('inventory_lots').where('id', lotId).first();
    if (!lot) throw new Error(`Lot ${lotId} not found`);
    if (parseFloat(lot.available_qty) < parseFloat(requiredQty)) {
      throw new Error(
        `Insufficient stock in lot ${lot.lot_no}: available ${lot.available_qty} ${lot.unit}, required ${requiredQty}`
      );
    }
    return lot;
  },
};

module.exports = inventoryService;
