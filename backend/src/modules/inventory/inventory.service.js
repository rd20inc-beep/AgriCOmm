const db = require('../../config/database');

// =============================================================================
// CANONICAL MOVEMENT TAXONOMY — Single source of truth for all stock movements
// =============================================================================

const MOVEMENT_TYPES = {
  // Purchase & receipts
  PURCHASE_RECEIPT: 'purchase_receipt',
  INTERNAL_RECEIPT: 'internal_receipt',
  RETURN: 'return',
  OPENING_BALANCE: 'opening_balance',
  // Milling
  PRODUCTION_ISSUE: 'production_issue',
  PRODUCTION_OUTPUT: 'production_output',
  BYPRODUCT_OUTPUT: 'byproduct_output',
  // Transfers
  TRANSFER_OUT: 'transfer_out',
  TRANSFER_IN: 'transfer_in',
  // Sales & dispatch
  EXPORT_DISPATCH: 'export_dispatch',
  LOCAL_SALE: 'local_sale',
  // Reservations (no qty change, reservation_effect only)
  RESERVATION_HOLD: 'reservation_hold',
  RESERVATION_RELEASE: 'reservation_release',
  // Adjustments
  ADJUSTMENT_PLUS: 'adjustment_plus',
  ADJUSTMENT_MINUS: 'adjustment_minus',
  DAMAGE_WRITEOFF: 'damage_writeoff',
  SHORTAGE_WRITEOFF: 'shortage_writeoff',
};

// Movement types that reduce stock
const OUTBOUND_TYPES = new Set([
  MOVEMENT_TYPES.PRODUCTION_ISSUE,
  MOVEMENT_TYPES.TRANSFER_OUT,
  MOVEMENT_TYPES.EXPORT_DISPATCH,
  MOVEMENT_TYPES.LOCAL_SALE,
  MOVEMENT_TYPES.ADJUSTMENT_MINUS,
  MOVEMENT_TYPES.DAMAGE_WRITEOFF,
  MOVEMENT_TYPES.SHORTAGE_WRITEOFF,
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
  MOVEMENT_TYPES.OPENING_BALANCE,
]);

// Reservation types — no qty change, only reservation_effect
const RESERVATION_TYPES = new Set([
  MOVEMENT_TYPES.RESERVATION_HOLD,
  MOVEMENT_TYPES.RESERVATION_RELEASE,
]);

// Canonical mapping: internal movement code → stored lot_transactions.transaction_type
const LOT_TRANSACTION_TYPE_MAP = {
  [MOVEMENT_TYPES.PURCHASE_RECEIPT]: 'purchase_in',
  [MOVEMENT_TYPES.INTERNAL_RECEIPT]: 'warehouse_transfer_in',
  [MOVEMENT_TYPES.PRODUCTION_ISSUE]: 'milling_issue',
  [MOVEMENT_TYPES.PRODUCTION_OUTPUT]: 'milling_receipt',
  [MOVEMENT_TYPES.BYPRODUCT_OUTPUT]: 'byproduct_receipt',
  [MOVEMENT_TYPES.TRANSFER_OUT]: 'warehouse_transfer_out',
  [MOVEMENT_TYPES.TRANSFER_IN]: 'warehouse_transfer_in',
  [MOVEMENT_TYPES.EXPORT_DISPATCH]: 'export_dispatch_out',
  [MOVEMENT_TYPES.LOCAL_SALE]: 'local_sale_out',
  [MOVEMENT_TYPES.RESERVATION_HOLD]: 'export_allocation',
  [MOVEMENT_TYPES.RESERVATION_RELEASE]: 'export_release',
  [MOVEMENT_TYPES.ADJUSTMENT_PLUS]: 'stock_adjustment_plus',
  [MOVEMENT_TYPES.ADJUSTMENT_MINUS]: 'stock_adjustment_minus',
  [MOVEMENT_TYPES.DAMAGE_WRITEOFF]: 'damage_out',
  [MOVEMENT_TYPES.SHORTAGE_WRITEOFF]: 'shortage_out',
  [MOVEMENT_TYPES.RETURN]: 'return_in',
  [MOVEMENT_TYPES.OPENING_BALANCE]: 'opening_balance',
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
    } else if (RESERVATION_TYPES.has(movementType)) {
      newQty = currentQty; // no qty change for reservations
    } else {
      throw new Error(`Unknown movement type: ${movementType}`);
    }

    // HARD ENFORCEMENT: no negative stock
    if (newQty < -0.001) {
      throw new Error(`Movement would result in negative stock on lot ${lot.lot_no}: current ${currentQty}, change ${-parsedQty}`);
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

    // Flag zero-cost lots on inbound movements
    if (INBOUND_TYPES.has(movementType) && parsedCost === 0) {
      await trx('inventory_lots').where('id', lotId).update({ cost_incomplete: true });
    }

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
      // Phase 1 new columns
      unit_cost: parsedCost > 0 ? parsedCost / 1000 : null,
      total_cost: totalCost || null,
      entity_from: sourceEntity || lot.entity || null,
      entity_to: destEntity || lot.entity || null,
      performed_by: userId || null,
      performed_at: new Date(),
      reservation_effect: null,
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
    byproductCosts, // { broken: costPerKg, bran: costPerKg, husk: costPerKg }
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

    // --- By-products: broken, bran, husk — with ALLOCATED costs ---
    const bpCosts = byproductCosts || {};
    const byproducts = [
      { name: 'Broken Rice', key: 'broken', qty: parseFloat(brokenMT) || 0 },
      { name: 'Rice Bran', key: 'bran', qty: parseFloat(branMT) || 0 },
      { name: 'Rice Husk', key: 'husk', qty: parseFloat(huskMT) || 0 },
    ];

    for (const bp of byproducts) {
      if (bp.qty <= 0) continue;

      const bpCostPerKg = parseFloat(bpCosts[bp.key]) || 0;
      const bpCostPerMT = bpCostPerKg * 1000;

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
          cost_per_unit: bpCostPerMT,
          cost_currency: 'PKR',
          total_value: 0,
          reserved_qty: 0,
          available_qty: 0,
          net_weight_kg: 0,
          gross_weight_kg: 0,
          rate_per_kg: bpCostPerKg,
          landed_cost_per_kg: bpCostPerKg,
          raw_cost_component: bpCostPerKg,
          cost_incomplete: bpCostPerKg === 0,
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
        costPerUnit: bpCostPerMT,
        currency: 'PKR',
        batchId,
        userId,
      });

      const updatedLot = await trx('inventory_lots').where('id', lot.id).first();
      results.lots.push(updatedLot);
      results.movements.push(movement);
    }

    // 9. Create lot lineage: raw lots → output lots
    const rawLots = await trx('inventory_lots')
      .where({ batch_ref: `batch-${batchId}`, type: 'raw' });

    for (const rawLot of rawLots) {
      for (const outputLot of results.lots) {
        const outputQtyKg = (parseFloat(outputLot.qty) || 0) * 1000;
        const rawQtyKg = (parseFloat(rawLot.qty) || 0) * 1000;
        const costShare = outputQtyKg > 0 ? (parseFloat(outputLot.rate_per_kg) || 0) * outputQtyKg : 0;

        await trx('lot_source_mapping').insert({
          parent_lot_id: rawLot.id,
          child_lot_id: outputLot.id,
          source_batch_id: batchId,
          quantity_kg: outputQtyKg,
          cost_share_amount: costShare,
          mapping_type: 'milling_input_to_output',
        });
      }
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

    // HARD ENFORCEMENT: no over-reservation
    const newReserved = parseFloat(lot.reserved_qty) + parsedQty;
    if (newReserved > parseFloat(lot.qty)) {
      throw new Error(`Cannot reserve ${parsedQty} MT — would exceed total qty ${lot.qty} on lot ${lot.lot_no}`);
    }
    const newAvailable = parseFloat(lot.qty) - newReserved;

    await trx('inventory_lots').where('id', lotId).update({
      reserved_qty: newReserved,
      available_qty: newAvailable,
      reserved_against: `order-${orderId}`,
      updated_at: trx.fn.now(),
    });

    // Write reservation ledger entry
    const txnNo = await generateLotTxnNo(trx);
    await trx('lot_transactions').insert({
      transaction_no: txnNo,
      transaction_date: new Date().toISOString().slice(0, 10),
      lot_id: lotId,
      transaction_type: LOT_TRANSACTION_TYPE_MAP[MOVEMENT_TYPES.RESERVATION_HOLD],
      reference_module: 'export_order',
      reference_id: orderId,
      quantity_kg: 0, // no physical movement
      reservation_effect: parsedQty * 1000,
      remarks: `Reserved ${parsedQty} MT for order ${orderId}`,
      performed_by: userId || null,
      performed_at: new Date(),
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

  // =========================================================================
  // PHASE 4: LOT LINEAGE & TRACEABILITY QUERIES
  // =========================================================================

  /**
   * Get full ancestry of a lot (parent lots, source batches)
   */
  async getLotAncestry(lotId) {
    const mappings = await db('lot_source_mapping as lsm')
      .leftJoin('inventory_lots as parent', 'lsm.parent_lot_id', 'parent.id')
      .leftJoin('milling_batches as mb', 'lsm.source_batch_id', 'mb.id')
      .select(
        'lsm.*',
        'parent.lot_no as parent_lot_no', 'parent.item_name as parent_item',
        'parent.type as parent_type', 'parent.rate_per_kg as parent_rate',
        'mb.batch_no', 'mb.raw_qty_mt', 'mb.actual_finished_mt', 'mb.yield_pct'
      )
      .where('lsm.child_lot_id', lotId)
      .orderBy('lsm.created_at');
    return mappings;
  },

  /**
   * Get all descendants of a lot (output lots from milling, transfer children)
   */
  async getLotDescendants(lotId) {
    const mappings = await db('lot_source_mapping as lsm')
      .leftJoin('inventory_lots as child', 'lsm.child_lot_id', 'child.id')
      .select(
        'lsm.*',
        'child.lot_no as child_lot_no', 'child.item_name as child_item',
        'child.type as child_type', 'child.qty', 'child.rate_per_kg as child_rate',
        'child.entity', 'child.status'
      )
      .where('lsm.parent_lot_id', lotId)
      .orderBy('lsm.created_at');
    return mappings;
  },

  /**
   * Trace all source lots for a milling batch
   */
  async getBatchSourceTrace(batchId) {
    const rawLots = await db('inventory_lots')
      .where({ batch_ref: `batch-${batchId}`, type: 'raw' })
      .select('*');
    const outputLots = await db('inventory_lots')
      .where({ batch_ref: `batch-${batchId}` })
      .whereIn('type', ['finished', 'byproduct'])
      .select('*');
    const lineage = await db('lot_source_mapping')
      .where({ source_batch_id: batchId })
      .select('*');
    const prices = await db('milling_output_market_prices')
      .where({ batch_id: batchId })
      .first();
    return { rawLots, outputLots, lineage, marketPrices: prices };
  },

  /**
   * Trace all lots involved in an export order (reserved, transferred, dispatched)
   */
  async getOrderLotTrace(orderId) {
    const reservations = await db('inventory_reservations as ir')
      .leftJoin('inventory_lots as l', 'ir.lot_id', 'l.id')
      .select('ir.*', 'l.lot_no', 'l.item_name', 'l.type', 'l.rate_per_kg', 'l.landed_cost_per_kg', 'l.entity')
      .where('ir.order_id', orderId);

    const transactions = await db('lot_transactions as lt')
      .leftJoin('inventory_lots as l', 'lt.lot_id', 'l.id')
      .select('lt.*', 'l.lot_no', 'l.item_name', 'l.type', 'l.rate_per_kg')
      .where('lt.reference_module', 'export_order')
      .where(function () { this.where('lt.reference_id', orderId); });

    const transfers = await db('internal_transfers')
      .where('export_order_id', orderId)
      .select('*');

    return { reservations, transactions, transfers };
  },

  /**
   * Trace source lots for a local sale
   */
  async getSaleLotTrace(saleId) {
    const sale = await db('local_sales').where('id', saleId).first();
    if (!sale || !sale.lot_id) return { sale, lot: null, ancestry: [] };

    const lot = await db('inventory_lots').where('id', sale.lot_id).first();
    const ancestry = lot ? await inventoryService.getLotAncestry(lot.id) : [];
    return { sale, lot, ancestry };
  },

  // =========================================================================
  // PHASE 5: COGS CALCULATION
  // =========================================================================

  /**
   * Calculate COGS for an export order from dispatched/allocated lots
   */
  async calculateOrderCOGS(trx, orderId) {
    const conn = trx || db;

    // Get all lots allocated/reserved for this order
    const reservations = await conn('inventory_reservations')
      .where({ order_id: orderId, status: 'Active' })
      .select('lot_id', 'reserved_qty');

    let totalCOGS = 0;
    let totalQtyKg = 0;

    for (const r of reservations) {
      const lot = await conn('inventory_lots').where('id', r.lot_id).first();
      if (!lot) continue;

      const costPerKg = parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0;
      const qtyKg = parseFloat(r.reserved_qty) * 1000;
      totalCOGS += costPerKg * qtyKg;
      totalQtyKg += qtyKg;
    }

    // Also check internal transfers for this order
    const transfers = await conn('internal_transfers')
      .where('export_order_id', orderId)
      .select('qty_mt', 'transfer_price_pkr');

    for (const t of transfers) {
      const tQtyKg = parseFloat(t.qty_mt) * 1000;
      const tCostTotal = parseFloat(t.transfer_price_pkr) * parseFloat(t.qty_mt);
      // Only add if not already counted via reservation
      if (totalQtyKg === 0) {
        totalCOGS += tCostTotal;
        totalQtyKg += tQtyKg;
      }
    }

    const cogsPerKg = totalQtyKg > 0 ? totalCOGS / totalQtyKg : 0;
    const cogsPerMT = cogsPerKg * 1000;

    return { totalCOGS, totalQtyKg, cogsPerKg, cogsPerMT };
  },

  /**
   * Calculate COGS for a local sale from the source lot
   */
  async calculateSaleCOGS(trx, saleId) {
    const conn = trx || db;
    const sale = await conn('local_sales').where('id', saleId).first();
    if (!sale || !sale.lot_id) return { totalCOGS: 0, cogsPerKg: 0 };

    const lot = await conn('inventory_lots').where('id', sale.lot_id).first();
    if (!lot) return { totalCOGS: 0, cogsPerKg: 0 };

    const costPerKg = parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0;
    const saleQtyKg = parseFloat(sale.quantity_kg) || 0;
    const totalCOGS = costPerKg * saleQtyKg;
    const revenue = parseFloat(sale.total_amount) || 0;
    const grossProfit = revenue - totalCOGS;

    return { totalCOGS, cogsPerKg: costPerKg, grossProfit };
  },

  /**
   * Lock COGS on an export order (called at dispatch)
   */
  async lockOrderCOGS(trx, orderId, pkrRate) {
    const cogs = await inventoryService.calculateOrderCOGS(trx, orderId);
    const order = await trx('export_orders').where('id', orderId).first();
    if (!order) return;

    const contractValuePKR = parseFloat(order.contract_value) * (pkrRate || 280);
    const grossProfitPKR = contractValuePKR - cogs.totalCOGS;
    const grossProfitUSD = grossProfitPKR / (pkrRate || 280);

    await trx('export_orders').where('id', orderId).update({
      inventory_cogs_total_pkr: cogs.totalCOGS,
      inventory_cogs_per_mt_pkr: cogs.cogsPerMT,
      gross_profit_pkr: grossProfitPKR,
      gross_profit_usd: grossProfitUSD,
      cost_locked_at_dispatch: true,
    });

    return { ...cogs, grossProfitPKR, grossProfitUSD };
  },

  /**
   * Lock COGS on a local sale
   */
  // =========================================================================
  // PHASE 6: STOCK ADJUSTMENTS
  // =========================================================================

  /**
   * Create a stock adjustment request (draft → pending_approval)
   */
  async createStockAdjustment(trx, { lotId, adjustmentType, quantityKg, reason, referenceNote, userId }) {
    const conn = trx || db;
    const lot = await conn('inventory_lots').where('id', lotId).first();
    if (!lot) throw new Error(`Lot ${lotId} not found`);

    const validTypes = ['excess_found', 'shortage_found', 'damaged', 'spoiled', 'moisture_loss', 'bag_loss', 'manual_correction'];
    if (!validTypes.includes(adjustmentType)) throw new Error(`Invalid adjustment type: ${adjustmentType}`);

    const unitCost = parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0;
    const totalCostImpact = unitCost * Math.abs(parseFloat(quantityKg));

    const [adj] = await conn('stock_adjustments').insert({
      lot_id: lotId,
      adjustment_type: adjustmentType,
      quantity_kg: parseFloat(quantityKg),
      reason: reason || null,
      unit_cost: unitCost,
      total_cost_impact: totalCostImpact,
      approval_status: 'pending_approval',
      requested_by: userId || null,
      reference_note: referenceNote || null,
    }).returning('*');

    return adj;
  },

  /**
   * Approve a stock adjustment — posts to ledger
   */
  async approveStockAdjustment(trx, { adjustmentId, approverId }) {
    if (!trx) throw new Error('approveStockAdjustment requires a transaction');

    const adj = await trx('stock_adjustments').where('id', adjustmentId).first();
    if (!adj) throw new Error('Adjustment not found');
    if (adj.approval_status !== 'pending_approval') throw new Error(`Cannot approve adjustment in status: ${adj.approval_status}`);

    const lot = await trx('inventory_lots').where('id', adj.lot_id).first();
    if (!lot) throw new Error('Lot not found');

    const qtyKg = parseFloat(adj.quantity_kg);
    const isIncrease = ['excess_found', 'manual_correction'].includes(adj.adjustment_type) && qtyKg > 0;
    const movementType = isIncrease ? MOVEMENT_TYPES.ADJUSTMENT_PLUS
      : ['damaged', 'spoiled'].includes(adj.adjustment_type) ? MOVEMENT_TYPES.DAMAGE_WRITEOFF
      : ['shortage_found', 'bag_loss'].includes(adj.adjustment_type) ? MOVEMENT_TYPES.SHORTAGE_WRITEOFF
      : MOVEMENT_TYPES.ADJUSTMENT_MINUS;

    const qtyMT = Math.abs(qtyKg) / 1000;

    // Post movement through ledger
    await inventoryService.postMovement(trx, {
      movementType,
      lotId: adj.lot_id,
      qty: qtyMT,
      sourceEntity: lot.entity,
      linkedRef: `adjustment-${adjustmentId}`,
      notes: `${adj.adjustment_type}: ${adj.reason || 'No reason'}`,
      costPerUnit: parseFloat(adj.unit_cost) * 1000 || 0, // per MT
      currency: 'PKR',
      userId: approverId,
    });

    // Update damaged_weight_kg if applicable
    if (['damaged', 'spoiled'].includes(adj.adjustment_type)) {
      await trx('inventory_lots').where('id', adj.lot_id).update({
        damaged_weight_kg: (parseFloat(lot.damaged_weight_kg) || 0) + Math.abs(qtyKg),
      });
    }

    // Mark adjustment as approved
    await trx('stock_adjustments').where('id', adjustmentId).update({
      approval_status: 'approved',
      approved_by: approverId,
      approved_at: trx.fn.now(),
    });

    return trx('stock_adjustments').where('id', adjustmentId).first();
  },

  /**
   * Reject a stock adjustment
   */
  async rejectStockAdjustment(trx, { adjustmentId, approverId, reason }) {
    const conn = trx || db;
    await conn('stock_adjustments').where('id', adjustmentId).update({
      approval_status: 'rejected',
      approved_by: approverId,
      approved_at: conn.fn ? conn.fn.now() : new Date(),
      reason: reason || undefined,
    });
    return conn('stock_adjustments').where('id', adjustmentId).first();
  },

  /**
   * Reconcile lot balance — compare physical count vs system
   */
  async reconcileLotBalance(lotId) {
    const lot = await db('inventory_lots').where('id', lotId).first();
    if (!lot) throw new Error('Lot not found');

    // Sum all transactions to compute expected balance
    const txnSum = await db('lot_transactions')
      .where('lot_id', lotId)
      .sum('quantity_kg as total_kg')
      .first();

    const ledgerBalanceKg = parseFloat(txnSum?.total_kg) || 0;
    const systemBalanceKg = (parseFloat(lot.qty) || 0) * 1000;
    const discrepancyKg = systemBalanceKg - ledgerBalanceKg;

    return {
      lotId,
      lotNo: lot.lot_no,
      systemQtyMT: parseFloat(lot.qty),
      systemQtyKg: systemBalanceKg,
      ledgerQtyKg: ledgerBalanceKg,
      discrepancyKg,
      discrepancyMT: discrepancyKg / 1000,
      isReconciled: Math.abs(discrepancyKg) < 1, // within 1 KG tolerance
    };
  },

  /**
   * Reconcile all lots — returns discrepancy report
   */
  async reconcileAllLots() {
    const lots = await db('inventory_lots').where('qty', '>', 0).select('id');
    const results = [];
    for (const lot of lots) {
      const r = await inventoryService.reconcileLotBalance(lot.id);
      results.push(r);
    }
    return {
      total: results.length,
      reconciled: results.filter(r => r.isReconciled).length,
      discrepancies: results.filter(r => !r.isReconciled),
    };
  },

  // =========================================================================
  // PHASE 7: VALUATION SNAPSHOTS & REPAIR TOOLS
  // =========================================================================

  /**
   * Take a valuation snapshot — captures current inventory value by entity/type
   */
  async takeValuationSnapshot() {
    const lots = await db('inventory_lots').where('available_qty', '>', 0).select('type', 'entity', 'available_qty', 'rate_per_kg', 'landed_cost_per_kg', 'net_weight_kg');

    const groups = {};
    for (const lot of lots) {
      const key = `${lot.entity || 'unknown'}|${lot.type || 'unknown'}`;
      if (!groups[key]) groups[key] = { entity: lot.entity, type: lot.type, totalKg: 0, totalValue: 0 };
      const costKg = parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0;
      const qtyKg = parseFloat(lot.available_qty) * 1000;
      groups[key].totalKg += qtyKg;
      groups[key].totalValue += costKg * qtyKg;
    }

    const today = new Date().toISOString().split('T')[0];
    const rows = Object.values(groups).map(g => ({
      snapshot_date: today,
      entity: g.entity,
      lot_type: g.type,
      total_qty_kg: g.totalKg,
      total_value: g.totalValue,
      avg_value_per_kg: g.totalKg > 0 ? g.totalValue / g.totalKg : 0,
      generated_at: new Date(),
    }));

    if (rows.length > 0) {
      await db('inventory_valuation_snapshots').insert(rows);
    }

    return { date: today, groups: Object.values(groups), totalValue: Object.values(groups).reduce((s, g) => s + g.totalValue, 0) };
  },

  /**
   * Find lots with data problems
   */
  async findProblematicLots() {
    const zeroCost = await db('inventory_lots').where(function () { this.where('rate_per_kg', 0).orWhereNull('rate_per_kg'); }).where('qty', '>', 0).select('id', 'lot_no', 'type', 'qty');
    const incomplete = await db('inventory_lots').where('cost_incomplete', true).select('id', 'lot_no', 'type', 'qty');
    const noLineage = await db.raw("SELECT l.id, l.lot_no, l.type, l.qty FROM inventory_lots l WHERE l.type IN ('finished','byproduct') AND l.id NOT IN (SELECT child_lot_id FROM lot_source_mapping) AND l.qty > 0");
    const missingCOGSOrders = await db('export_orders').where('status', 'Shipped').where(function () { this.whereNull('inventory_cogs_total_pkr').orWhere('inventory_cogs_total_pkr', 0); }).select('id', 'order_no', 'contract_value');

    return {
      zeroCostLots: zeroCost,
      incompleteLots: incomplete,
      noLineageLots: noLineage.rows,
      missingCOGSOrders: missingCOGSOrders,
      summary: {
        zeroCost: zeroCost.length,
        incomplete: incomplete.length,
        noLineage: noLineage.rows.length,
        missingCOGS: missingCOGSOrders.length,
      },
    };
  },

  /**
   * Repair a lot's cost from its batch data
   */
  async repairLotCost(trx, { lotId, userId, reason }) {
    const conn = trx || db;
    const lot = await conn('inventory_lots').where('id', lotId).first();
    if (!lot) throw new Error('Lot not found');

    const oldValues = { rate_per_kg: lot.rate_per_kg, landed_cost_per_kg: lot.landed_cost_per_kg, cost_incomplete: lot.cost_incomplete };

    let newCostPerKg = 0;

    if (lot.batch_ref) {
      const batchId = lot.batch_ref.replace('batch-', '');
      const batch = await conn('milling_batches').where('id', parseInt(batchId)).first();
      if (batch) {
        const costs = await conn('milling_costs').where('batch_id', batch.id);
        const totalCost = costs.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
        const finishedKg = (parseFloat(batch.actual_finished_mt) || 0) * 1000;

        if (lot.type === 'finished' && finishedKg > 0) {
          newCostPerKg = totalCost / finishedKg;
        } else if (lot.type === 'byproduct') {
          const prices = await conn('milling_output_market_prices').where('batch_id', batch.id).first();
          const fp = parseFloat(prices?.finished_price_per_mt || batch.finished_price_per_mt) || 72800;
          const bp = parseFloat(prices?.broken_price_per_mt || batch.broken_price_per_mt) || 38000;
          const np = parseFloat(prices?.bran_price_per_mt || batch.bran_price_per_mt) || 28000;
          const hp = parseFloat(prices?.husk_price_per_mt || batch.husk_price_per_mt) || 8400;
          const name = (lot.item_name || '').toLowerCase();
          const myPrice = name.includes('broken') ? bp : name.includes('bran') ? np : hp;
          const myQty = parseFloat(lot.qty) || 0;
          const totalMV = (parseFloat(batch.actual_finished_mt) || 0) * fp + (parseFloat(batch.broken_mt) || 0) * bp + (parseFloat(batch.bran_mt) || 0) * np + (parseFloat(batch.husk_mt) || 0) * hp;
          if (totalMV > 0 && myQty > 0) {
            newCostPerKg = totalCost * (myQty * myPrice / totalMV) / (myQty * 1000);
          }
        }
      }
    }

    if (newCostPerKg > 0) {
      const qtyKg = (parseFloat(lot.qty) || 0) * 1000;
      await conn('inventory_lots').where('id', lotId).update({
        rate_per_kg: newCostPerKg,
        landed_cost_per_kg: newCostPerKg,
        landed_cost_total: newCostPerKg * qtyKg,
        cost_per_unit: newCostPerKg * 1000,
        total_value: newCostPerKg * qtyKg,
        cost_incomplete: false,
      });

      await conn('historical_cost_repair_log').insert({
        lot_id: lotId,
        batch_id: lot.batch_ref ? parseInt(lot.batch_ref.replace('batch-', '')) : null,
        issue_type: reason || 'manual_cost_repair',
        old_value_json: JSON.stringify(oldValues),
        new_value_json: JSON.stringify({ rate_per_kg: newCostPerKg }),
        repaired_by: userId || null,
        repaired_at: new Date(),
      });
    }

    return { lotId, oldCost: parseFloat(oldValues.rate_per_kg), newCost: newCostPerKg, repaired: newCostPerKg > 0 };
  },

  async lockSaleCOGS(trx, saleId) {
    const cogs = await inventoryService.calculateSaleCOGS(trx, saleId);

    await trx('local_sales').where('id', saleId).update({
      cogs_total_pkr: cogs.totalCOGS,
      cogs_per_kg: cogs.cogsPerKg,
      gross_profit_pkr: cogs.grossProfit,
      cost_locked_at_dispatch: true,
    });

    return cogs;
  },
};

module.exports = inventoryService;
