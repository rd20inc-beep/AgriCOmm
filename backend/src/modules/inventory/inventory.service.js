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

// Pull the first run of [A-Z0-9] from a string, uppercased. e.g.
// "Ahmed Traders Ltd." -> "AHMEDTRADERSLTD". Caller slices to length.
function alnumUpper(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Build a 3-4 char code from a supplier name, growing to 6 chars on
// collision with another supplier that shares the same prefix.
async function deriveSupplierCode(q, table, id, fallback) {
  if (!id) return fallback;
  const row = await q(table).where({ id }).first('name');
  const base = alnumUpper(row && row.name);
  if (!base) return fallback;
  // Start at 3 chars, grow if another supplier with a different id maps
  // to the same prefix.
  for (let len = 3; len <= 6; len++) {
    const candidate = base.slice(0, len);
    const dup = await q(table)
      .whereRaw('UPPER(REGEXP_REPLACE(name, ?, ?, ?)) LIKE ?', ['[^A-Za-z0-9]', '', 'g', `${candidate}%`])
      .andWhereNot({ id })
      .first('id');
    if (!dup) return candidate;
  }
  return base.slice(0, 6);
}

// Variety code for a lot number. Tries hard to pick something a human
// can read in the lot number:
//   1. product.code, IF it's short + not an auto-generated PRD-… SKU.
//   2. Otherwise the first 3-8 alnum chars of product.name (e.g.
//      "D-98 Basmati" → "D98BAS").
// The auto-generated check matters because the catalog is full of codes
// like "PRD-20251230-180141-b0b75d59" which would otherwise produce
// lot numbers like AHM-PRD20251-260524-01 (illegible).
function isAutoGeneratedSku(code) {
  if (!code) return false;
  const s = String(code).toUpperCase();
  // PRD-yyyymmdd-... or anything with a date-shaped run of 8 digits.
  if (/^PRD[-_]\d{6,}/.test(s)) return true;
  if (/\d{8,}/.test(s)) return true;
  if (s.length > 12) return true;
  return false;
}
async function deriveProductCode(q, productId) {
  if (!productId) return 'RAW';
  const p = await q('products').where({ id: productId }).first('code', 'name');
  if (p && p.code && !isAutoGeneratedSku(p.code)) {
    const c = alnumUpper(p.code);
    if (c) return c.slice(0, 8);
  }
  const fromName = alnumUpper(p && p.name);
  if (fromName) return fromName.slice(0, 8);
  // Fall back to a shortened code if we have nothing better.
  if (p && p.code) {
    const c = alnumUpper(p.code);
    if (c) return c.slice(0, 8);
  }
  return 'RAW';
}

const inventoryService = {
  MOVEMENT_TYPES,

  /**
   * Generate a unique lot number: LOT-YYYYMMDD-XXXX
   * Legacy format — used for non-rice lots (finished output, byproducts, etc.).
   * Rice purchase lots use generateRiceLotNo() instead.
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

  /**
   * Generate a rice purchase lot number: SUP-VARIETY-YYMMDD-SEQ
   * e.g. AHM-D98-260524-01
   *
   * The mill receives already-milled (finished) rice and treats it as
   * raw material for its own processing/grading. The lot number is
   * keyed on supplier + variety + date so multiple trucks of the same
   * rice on the same day share one lot.
   *
   * SUP     = first 3-4 alphanumeric chars of supplier name, uppercased.
   *           If two suppliers collapse to the same code, the longer prefix
   *           is used (up to 6 chars) to disambiguate.
   * VARIETY = product.code if present, else first 3-6 alphanumeric chars
   *           of product.name, uppercased.
   * YYMMDD  = date (today).
   * SEQ     = 2-digit sequence per (supplier+variety+date), starts at 01.
   */
  /**
   * Generate a milling-output lot number: {BATCH_NO}-{TYPE}-{SEQ}
   * e.g. M-027-FIN-01, M-027-B1-01, M-027-SORTEX-01.
   *
   * The lot number itself tells the operator which batch produced the
   * lot and what kind of output it is — replaces the opaque
   * LOT-YYYYMMDD-XXXX format that used to be applied to every output.
   *
   * `type` examples: 'finished', 'broken', 'sortex', 'bran', 'husk'.
   * `grade` (optional) is the broken sub-grade label: 'B1', 'B2',
   * 'B3', 'CSR', 'Short Grain'. When provided, replaces type as the
   * middle token so each broken-grade lot is identifiable at a glance.
   */
  async generateOutputLotNo(trx, { batchNo, type, grade }) {
    const q = trx || db;
    const TYPE_CODES = {
      finished: 'FIN',
      broken:   'BRK',
      sortex:   'SORTEX',
      bran:     'BRAN',
      husk:     'HUSK',
    };
    const GRADE_CODES = {
      'B1': 'B1', 'B2': 'B2', 'B3': 'B3', 'CSR': 'CSR', 'Short Grain': 'SG',
    };
    const middle = grade && GRADE_CODES[grade]
      ? GRADE_CODES[grade]
      : (TYPE_CODES[type] || (type ? type.toUpperCase().slice(0, 6) : 'OUT'));
    // Use the batch number as-is (e.g. "M-027"). Fall back to OUT-YYMMDD
    // when no batch context — shouldn't happen in practice.
    const base = batchNo
      ? `${String(batchNo).toUpperCase()}-${middle}`
      : `OUT-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${middle}`;
    // Find the next sequence within this prefix
    const last = await q('inventory_lots')
      .where('lot_no', 'like', `${base}-%`)
      .orderBy('lot_no', 'desc')
      .first('lot_no');
    let seq = 1;
    if (last && last.lot_no) {
      const tail = last.lot_no.slice(base.length + 1);
      const n = parseInt(tail, 10);
      if (!Number.isNaN(n)) seq = n + 1;
    }
    return `${base}-${String(seq).padStart(2, '0')}`;
  },

  async generateRiceLotNo(trx, { supplierId, productId, date }) {
    const q = trx || db;
    const today = date ? new Date(date) : new Date();
    const yy = String(today.getFullYear()).slice(-2);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yy}${mm}${dd}`;

    const supCode = await deriveSupplierCode(q, 'suppliers', supplierId, 'SUP');
    const varCode = await deriveProductCode(q, productId);

    const prefix = `${supCode}-${varCode}-${dateStr}-`;

    const last = await q('inventory_lots')
      .where('lot_no', 'like', `${prefix}%`)
      .orderBy('lot_no', 'desc')
      .select('lot_no')
      .first();

    let seq = 1;
    if (last && last.lot_no) {
      const tail = last.lot_no.slice(prefix.length);
      const n = parseInt(tail, 10);
      if (!Number.isNaN(n)) seq = n + 1;
    }

    return `${prefix}${String(seq).padStart(2, '0')}`;
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
  // Receive rice (from vehicle arrival / purchase)
  //
  // The mill buys already-milled finished rice from upstream suppliers
  // and treats it as raw material for its own processing/grading. The
  // lot type stays 'raw' (raw from the MILL's perspective) but the
  // item is rice, not paddy.
  // =========================================================================
  async receiveRice(trx, {
    batchId,
    weightMT,
    costPerMT,
    currency,
    supplierId,
    productId,
    vehicleNo,
    userId,
  }) {
    if (!trx) throw new Error('receiveRice requires a transaction');

    const parsedWeight = parseFloat(weightMT);
    const parsedCost = parseFloat(costPerMT) || 0;

    // Look for an existing rice lot for this batch in Mill Raw Stock.
    // Vehicles auto-attach to today's open batch (see receiveRice controller),
    // so one batch_ref naturally collects all trucks for the same
    // supplier+variety+date.
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
        notes: `Rice receipt for batch ${batchId}${vehicleNo ? `, vehicle ${vehicleNo}` : ''}`,
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

      // Resolve product_id for rice lots. inventory_lots.product_id is
      // NOT NULL since migration 067 — every lot must point at a real
      // product. Prefer the variety the batch was created with; only
      // fall back to the generic RAW-RICE product if none was specified.
      // (RAW-PADDY / "paddy" fallbacks kept for legacy installs only.)
      let resolvedProductId = productId || null;
      let resolvedProductRow = null;
      if (resolvedProductId) {
        resolvedProductRow = await trx('products').where({ id: resolvedProductId }).first('id', 'code', 'name', 'grade');
      }
      if (!resolvedProductRow) {
        resolvedProductRow = await trx('products').where({ code: 'RAW-RICE' }).first('id', 'code', 'name', 'grade');
        if (!resolvedProductRow) resolvedProductRow = await trx('products').whereILike('name', 'raw rice').first('id', 'code', 'name', 'grade');
        // Legacy fallbacks for old installs that still have a Paddy product:
        if (!resolvedProductRow) resolvedProductRow = await trx('products').where({ code: 'RAW-PADDY' }).first('id', 'code', 'name', 'grade');
        if (!resolvedProductRow) resolvedProductRow = await trx('products').whereILike('name', '%paddy%').first('id', 'code', 'name', 'grade');
        if (resolvedProductRow) resolvedProductId = resolvedProductRow.id;
      }
      const riceProductId = resolvedProductId;
      // Stamp the variety (and grade) directly on the lot row so the Lot
      // Inventory list shows the rice type (D98, Basmati 386, …) without
      // having to expand the row or re-join products downstream.
      const lotVariety = resolvedProductRow
        ? (resolvedProductRow.name || resolvedProductRow.code || null)
        : null;
      const lotGrade = resolvedProductRow && resolvedProductRow.grade
        ? resolvedProductRow.grade : null;
      // Use the product name as the item name when available so the row
      // says e.g. "D98 Rice" instead of the generic "Rice" — keeps the
      // table scannable.
      const lotItemName = resolvedProductRow && resolvedProductRow.name
        ? resolvedProductRow.name : 'Rice';

      const lotNo = await inventoryService.generateRiceLotNo(trx, {
        supplierId,
        productId: resolvedProductId,
      });

      [lot] = await trx('inventory_lots')
        .insert({
          lot_no: lotNo,
          item_name: lotItemName,
          type: 'raw',
          entity: 'mill',
          warehouse_id: warehouse.id,
          product_id: riceProductId,
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
          variety: lotVariety,
          grade: lotGrade,
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
        notes: `Rice receipt for batch ${batchId}${vehicleNo ? `, vehicle ${vehicleNo}` : ''}`,
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

    // Blended batch: draw down the committed partial qty from EACH source lot
    // (raw paddy and/or re-milled finished rice). One movement per lot so each
    // lot's stock and cost are tracked separately. Idempotent — a fully
    // consumed source lot is skipped.
    const sources = await trx('batch_source_lots').where({ batch_id: batchId });
    if (sources.length > 0) {
      const movements = [];
      for (const s of sources) {
        const lot = await trx('inventory_lots').where({ id: s.lot_id }).first();
        if (!lot) continue;
        const avail = parseFloat(lot.available_qty) || 0;
        const consume = Math.min(parseFloat(s.qty_mt) || 0, avail);
        if (consume <= 0) continue;
        const m = await inventoryService.postMovement(trx, {
          movementType: MOVEMENT_TYPES.PRODUCTION_ISSUE,
          lotId: lot.id,
          qty: consume,
          fromWarehouseId: lot.warehouse_id,
          sourceEntity: 'mill',
          linkedRef: `batch-${batchId}`,
          notes: `${lot.type === 'finished' ? 'Finished rice re-milled' : 'Rice consumed'} for milling batch ${batchId} (lot ${lot.lot_no || lot.id})`,
          costPerUnit: parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.cost_per_unit) || 0,
          currency: lot.cost_currency || 'PKR',
          batchId,
          userId,
        });
        movements.push(m);
        const remaining = avail - consume;
        await trx('inventory_lots').where({ id: lot.id }).update({
          milling_status: remaining <= 1e-6 ? 'Consumed' : 'In Milling',
          updated_at: trx.fn.now(),
        });
      }
      return movements;
    }

    // ── Legacy single-lot path (procurement/GRN-fed batches) ──
    const parsedQty = parseFloat(qtyMT);

    // Find rice lot for this batch
    const lot = await trx('inventory_lots')
      .where({ batch_ref: `batch-${batchId}`, type: 'raw', entity: 'mill' })
      .first();

    if (!lot) {
      throw new Error(`No rice lot found for batch ${batchId}`);
    }

    // Consume available qty — may be less than declared raw_qty_mt if
    // actual received weight (via vehicle arrivals) differs from estimate.
    // If stock is already fully consumed (from a prior yield attempt), skip silently.
    const availableQty = parseFloat(lot.available_qty) || 0;
    const consumeQty = Math.min(parsedQty, availableQty);

    if (consumeQty <= 0) {
      // Already consumed — idempotent, don't fail
      return null;
    }

    const movement = await inventoryService.postMovement(trx, {
      movementType: MOVEMENT_TYPES.PRODUCTION_ISSUE,
      lotId: lot.id,
      qty: consumeQty,
      fromWarehouseId: lot.warehouse_id,
      sourceEntity: 'mill',
      linkedRef: `batch-${batchId}`,
      notes: `Rice consumed for milling batch ${batchId}`,
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
    sortexMT,
    productName,
    costPerMT,
    rawCostComponent,
    millingCostComponent,
    byproductCosts, // { broken, bran, husk, sortex } cost per kg
    // Optional per-grade split of brokenMT. When supplied, recordMillingOutput
    // creates one byproduct lot per non-zero grade (B1, B2, B3, CSR, Short
    // Grain) instead of collapsing them into a single "Broken Rice" lot.
    // Each lot is stamped with the grade on inventory_lots.grade + variety
    // for downstream traceability.
    brokenGrades,
    userId,
    // Optional enrichment from batch/quality
    supplierInfo,
    qualityInfo,
  }) {
    if (!trx) throw new Error('recordMillingOutput requires a transaction');

    const results = { lots: [], movements: [] };

    // Resolve product_id for each lot type. inventory_lots.product_id is
    // NOT NULL since migration 067 — every lot must reference a real product.
    // Resolution chain: batch.product_id → linked export order's product_id
    // → product matching productName → seeded FINISHED-RICE fallback
    // → any non-byproduct rice product → first product as last resort.
    const batchRow = await trx('milling_batches').where({ id: batchId }).first();
    // Blended-milling output is isolated PER RECIPE: each blend batch's saleable
    // rice (finished + broken grades) gets a batch-scoped identity (grade
    // 'M-033-B1', name 'Blend M-033 — …') so it never pools with pure B1/B2 or
    // with another blend. Every blended output — finished, broken grades AND
    // bran/husk/sortex — is isolated per batch (broken via the batch-scoped
    // grade 'M-033-B1', the rest via 'Blend M-033 — …' + blend_batch_no), and
    // all carry processing_type for rollups that group by product.
    const isBlend = batchRow?.processing_type === 'blended';
    const blendNo = isBlend ? (batchRow.batch_no || `batch-${batchId}`) : null;
    let finishedProductId = batchRow && batchRow.product_id ? batchRow.product_id : null;
    if (!finishedProductId && batchRow && batchRow.linked_export_order_id) {
      const linked = await trx('export_orders').where({ id: batchRow.linked_export_order_id }).first('product_id');
      if (linked && linked.product_id) finishedProductId = linked.product_id;
    }
    if (!finishedProductId && productName) {
      const named = await trx('products').whereILike('name', productName).first('id');
      if (named) finishedProductId = named.id;
    }
    if (!finishedProductId) {
      // Seeded generic product (migration 114). Stable code = won't shift on rebuilds.
      const fallback = await trx('products').where({ code: 'FINISHED-RICE' }).first('id');
      if (fallback) finishedProductId = fallback.id;
    }
    if (!finishedProductId) {
      // Last-resort fallback: any non-byproduct, non-raw-input product.
      // Better to record the lot under a defaulted product_id than to 500 the
      // entire yield transaction. Excludes RAW-RICE and the legacy
      // RAW-PADDY code so we don't accidentally tag output as input.
      const any = await trx('products')
        .where({ is_byproduct: false })
        .whereNotIn('code', ['RAW-RICE', 'RAW-PADDY'])
        .first('id');
      if (any) finishedProductId = any.id;
    }
    if (!finishedProductId) {
      throw new Error(
        'Cannot resolve product_id for finished rice lot. Seed at least one finished-rice product (e.g. via migration 114) or set product_id on the milling batch / linked export order.'
      );
    }
    // Resolve byproduct products by item_name — these are seeded with stable
    // PROD-* codes (round 075). Code-first lookup, then name fallback.
    // For graded broken-rice lots ("Broken Rice - B1", "Broken Rice - CSR")
    // we still want the parent "Broken Rice" product since the catalog
    // doesn't carry a separate product per grade — the grade is stamped
    // on the inventory_lots row instead.
    const byproductProductLookup = async (itemName) => {
      const baseName = itemName.startsWith('Broken Rice') ? 'Broken Rice' : itemName;
      const byCode = {
        'Broken Rice':    ['PROD-BROKEN-RICE',    'BROKEN-RICE'],
        'Rice Bran':      ['PROD-RICE-BRAN',      'RICE-BRAN'],
        'Rice Husk':      ['PROD-RICE-HUSK',      'RICE-HUSK'],
        'Sortex Rejects': ['PROD-SORTEX-REJECTS', 'SORTEX-REJECTS'],
      }[baseName] || [];
      for (const code of byCode) {
        const p = await trx('products').where({ code }).first('id');
        if (p) return p.id;
      }
      const named = await trx('products').whereILike('name', baseName).first('id');
      return named ? named.id : null;
    };

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
      const lotNo = await inventoryService.generateOutputLotNo(trx, {
        batchNo: batchRow && batchRow.batch_no,
        type: 'finished',
      });
      const [lot] = await trx('inventory_lots')
        .insert({
          lot_no: lotNo,
          item_name: isBlend ? `Blend ${blendNo} — Finished Rice` : (productName || 'Finished Rice'),
          type: 'finished',
          entity: 'mill',
          warehouse_id: fgWarehouse.id,
          product_id: finishedProductId,
          qty: 0,
          unit: 'MT',
          batch_ref: `batch-${batchId}`,
          processing_type: isBlend ? 'blended' : 'single_variety',
          blend_batch_no: blendNo,
          cost_per_unit: 0,
          cost_currency: 'PKR',
          total_value: 0,
          reserved_qty: 0,
          available_qty: 0,
          status: 'Available',
          created_by: userId || null,
          // Enrichment from batch/quality data
          supplier_id: supplierInfo?.supplierId || null,
          variety: isBlend ? `Blend ${blendNo}` : (qualityInfo?.variety || null),
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

    // --- By-products: broken (per grade), bran, husk — with ALLOCATED costs ---
    // brokenGrades, when present, splits broken into B1/B2/B3/CSR/Short
    // Grain — each becomes its own lot stamped with the grade so the
    // user can sell each tier at its own rate from inventory views.
    const bpCosts = byproductCosts || {};
    const grades = brokenGrades || {};
    const gradeNames = [
      { key: 'b1',         label: 'B1' },
      { key: 'b2',         label: 'B2' },
      { key: 'b3',         label: 'B3' },
      { key: 'csr',        label: 'CSR' },
      { key: 'shortGrain', label: 'Short Grain' },
    ];
    const hasAnyGrade = gradeNames.some(g => (parseFloat(grades[g.key]) || 0) > 0);
    // Map UI-side camelCase grade keys (shortGrain) to the snake_case
    // keys used in the byproductCosts payload (short_grain). When a
    // per-grade cost is available (the new pricing flow), each broken
    // lot uses its own cost instead of the aggregate broken cost.
    const COST_KEY_BY_GRADE = {
      b1: 'b1', b2: 'b2', b3: 'b3', csr: 'csr', shortGrain: 'short_grain',
    };
    const brokenItems = hasAnyGrade
      ? gradeNames
          .map(g => ({
            name: `Broken Rice - ${g.label}`,
            // Prefer the per-grade cost if the caller provided one;
            // fall back to the aggregate "broken" cost otherwise.
            key: bpCosts[COST_KEY_BY_GRADE[g.key]] != null ? COST_KEY_BY_GRADE[g.key] : 'broken',
            grade: g.label,
            qty: parseFloat(grades[g.key]) || 0,
          }))
          .filter(x => x.qty > 0)
      : ((parseFloat(brokenMT) || 0) > 0
          ? [{ name: 'Broken Rice', key: 'broken', grade: null, qty: parseFloat(brokenMT) }]
          : []);

    const byproducts = [
      ...brokenItems,
      { name: 'Rice Bran',      key: 'bran',   grade: null, qty: parseFloat(branMT) || 0 },
      { name: 'Rice Husk',      key: 'husk',   grade: null, qty: parseFloat(huskMT) || 0 },
      { name: 'Sortex Rejects', key: 'sortex', grade: null, qty: parseFloat(sortexMT) || 0 },
    ];

    for (const bp of byproducts) {
      if (bp.qty <= 0) continue;

      const bpCostPerKg = parseFloat(bpCosts[bp.key]) || 0;
      const bpCostPerMT = bpCostPerKg * 1000;

      // Output lot number is keyed on batch + type/grade so the lot
      // ID itself tells the operator what it is.
      // Examples: M-027-B1-01, M-027-SORTEX-01, M-027-BRAN-01.
      const lotNo = await inventoryService.generateOutputLotNo(trx, {
        batchNo: batchRow && batchRow.batch_no,
        type: bp.key === 'b1' || bp.key === 'b2' || bp.key === 'b3'
              || bp.key === 'csr' || bp.key === 'short_grain'
              || bp.key === 'broken' ? 'broken'
              : bp.key, // sortex/bran/husk
        grade: bp.grade, // B1/B2/B3/CSR/Short Grain — null for sortex/bran/husk
      });
      const bpProductId = await byproductProductLookup(bp.name);
      const [lot] = await trx('inventory_lots')
        .insert({
          lot_no: lotNo,
          // Every blended byproduct is per-batch: broken via grade (M-033-B1),
          // bran/husk/sortex via the name + blend_batch_no.
          item_name: isBlend ? `Blend ${blendNo} — ${bp.name}` : bp.name,
          type: 'byproduct',
          entity: 'mill',
          warehouse_id: bpWarehouse.id,
          product_id: bpProductId,
          qty: 0,
          unit: 'MT',
          batch_ref: `batch-${batchId}`,
          processing_type: isBlend ? 'blended' : 'single_variety',
          blend_batch_no: blendNo,
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
          grade: (isBlend && bp.grade) ? `${blendNo}-${bp.grade}` : (bp.grade || null),
          variety: (isBlend && bp.grade) ? `Blend ${blendNo} — Broken ${bp.grade}` : (bp.grade ? `Broken ${bp.grade}` : null),
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
  async transferToExport(trx, { transferId, lotId, qtyMT, productName, orderId, transferPricePerMT, totalValuePkr, userId }) {
    if (!trx) throw new Error('transferToExport requires a transaction');

    const parsedQty = parseFloat(qtyMT);
    const pricePerMT = parseFloat(transferPricePerMT) || 0;
    const totalValue = parseFloat(totalValuePkr) || (pricePerMT * parsedQty);
    const ratePerKg = pricePerMT / 1000;
    const netKg = parsedQty * 1000;

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

    // Find or create Export Dispatch warehouse. The warehouses.type
    // CHECK only allows raw/finished/byproduct/wip/transit — "dispatch"
    // wasn't valid (caused a 23514 here on the first transfer attempt).
    // Use 'transit' since stock is moving from mill to its export
    // counterpart and not yet shipped. Fall back to either dispatch
    // (legacy rows) or transit lookups to handle pre-existing setups.
    let exportWarehouse = await trx('warehouses')
      .where({ entity: 'export' })
      .whereIn('type', ['transit', 'dispatch'])
      .first();
    if (!exportWarehouse) {
      [exportWarehouse] = await trx('warehouses')
        .insert({ name: 'Export Dispatch', entity: 'export', type: 'transit' })
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
        product_id: sourceLot.product_id || null,
        qty: 0,
        unit: sourceLot.unit || 'MT',
        batch_ref: sourceLot.batch_ref || null,
        cost_per_unit: pricePerMT,
        cost_currency: sourceLot.cost_currency || 'PKR',
        total_value: totalValue,
        reserved_qty: 0,
        available_qty: 0,
        status: 'Available',
        created_by: userId || null,
        // Enrichment carried over from source mill lot so the export-side
        // grid shows supplier / variety / quality instead of blanks.
        supplier_id: sourceLot.supplier_id || null,
        variety: sourceLot.variety || null,
        grade: sourceLot.grade || null,
        moisture_pct: sourceLot.moisture_pct || null,
        broken_pct: sourceLot.broken_pct || null,
        net_weight_kg: 0,
        gross_weight_kg: 0,
        rate_per_kg: ratePerKg,
        purchase_amount: 0,
        landed_cost_total: totalValue,
        landed_cost_per_kg: ratePerKg,
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
   * Calculate COGS for an export order from dispatched/allocated lots.
   *
   * Source-of-truth precedence (first non-zero result wins):
   *   1. inventory_reservations → exact lot-level cost
   *   2. internal_transfers     → mill→export transfer price
   *   3. linked milling batch   → sum of milling_costs for that batch,
   *                                pro-rated by qty_mt vs batch finished_mt
   *      (Estimated — used when seed/historical orders bypassed the
   *       reservation flow but a linked batch with real costs exists.)
   *
   * Returns `source` so the caller can mark `cost_locked_at_dispatch` only
   * when the precise paths produce a result, and use 'estimated' status
   * otherwise.
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

    if (totalCOGS > 0) {
      const cogsPerKg = totalQtyKg > 0 ? totalCOGS / totalQtyKg : 0;
      return { totalCOGS, totalQtyKg, cogsPerKg, cogsPerMT: cogsPerKg * 1000, source: 'reservations' };
    }

    // Path 2: internal transfers
    const transfers = await conn('internal_transfers')
      .where('export_order_id', orderId)
      .select('qty_mt', 'transfer_price_pkr');

    for (const t of transfers) {
      totalCOGS += parseFloat(t.transfer_price_pkr) * parseFloat(t.qty_mt);
      totalQtyKg += parseFloat(t.qty_mt) * 1000;
    }

    if (totalCOGS > 0) {
      const cogsPerKg = totalQtyKg > 0 ? totalCOGS / totalQtyKg : 0;
      return { totalCOGS, totalQtyKg, cogsPerKg, cogsPerMT: cogsPerKg * 1000, source: 'internal_transfers' };
    }

    // Path 3: linked milling batch costs (estimated). Used when historical
    // or seed orders bypassed the reservation/transfer flow.
    const order = await conn('export_orders').where('id', orderId).first();
    if (order) {
      const batch = await conn('milling_batches').where('linked_export_order_id', orderId).first();
      if (batch) {
        const batchCostsRows = await conn('milling_costs').where('batch_id', batch.id).select('amount');
        const batchCostsTotal = batchCostsRows.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
        const batchFinishedMt = parseFloat(batch.actual_finished_mt) || 0;
        const orderQtyMt = parseFloat(order.qty_mt) || 0;
        if (batchCostsTotal > 0 && batchFinishedMt > 0 && orderQtyMt > 0) {
          // Pro-rate batch cost by the share of finished MT this order took.
          // For seed data where order_qty == batch_finished, this is just
          // the full batch cost; for partial allocations it scales down.
          const ratio = Math.min(orderQtyMt / batchFinishedMt, 1);
          const proratedCogs = batchCostsTotal * ratio;
          const totalQtyKgFromBatch = orderQtyMt * 1000;
          const cogsPerKg = totalQtyKgFromBatch > 0 ? proratedCogs / totalQtyKgFromBatch : 0;
          return {
            totalCOGS: proratedCogs,
            totalQtyKg: totalQtyKgFromBatch,
            cogsPerKg,
            cogsPerMT: cogsPerKg * 1000,
            source: 'linked_batch_estimate',
          };
        }
      }
    }

    return { totalCOGS: 0, totalQtyKg: 0, cogsPerKg: 0, cogsPerMT: 0, source: 'none' };
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
   * Lock COGS on an export order (called at dispatch).
   *
   * Sets `cost_locked_at_dispatch` only when COGS came from the precise
   * paths (reservations or internal_transfers). Linked-batch estimates
   * still get persisted into inventory_cogs_total_pkr so the dashboard
   * shows a real number, but the lock flag stays false so a future
   * reservation/transfer can override the estimate.
   */
  async lockOrderCOGS(trx, orderId, pkrRate) {
    const cogs = await inventoryService.calculateOrderCOGS(trx, orderId);
    const order = await trx('export_orders').where('id', orderId).first();
    if (!order) return;

    const contractValuePKR = parseFloat(order.contract_value) * (pkrRate || 280);
    const grossProfitPKR = contractValuePKR - cogs.totalCOGS;
    const grossProfitUSD = grossProfitPKR / (pkrRate || 280);
    const isExact = cogs.source === 'reservations' || cogs.source === 'internal_transfers';

    await trx('export_orders').where('id', orderId).update({
      inventory_cogs_total_pkr: cogs.totalCOGS,
      inventory_cogs_per_mt_pkr: cogs.cogsPerMT,
      gross_profit_pkr: grossProfitPKR,
      gross_profit_usd: grossProfitUSD,
      cost_locked_at_dispatch: isExact,
    });

    if (cogs.totalCOGS === 0) {
      console.warn(`[lockOrderCOGS] Order ${orderId} has no COGS source — neither reservations, transfers, nor a linked batch with costs. Profit will show full revenue.`);
    }

    return { ...cogs, grossProfitPKR, grossProfitUSD, isExact };
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

  // ───────────────────────────────────────────────────────────────────────
  // Re-derive a milling batch's output costs from its CURRENT cost pool.
  //
  // Mirrors recordYield's market-value joint-cost allocation so a re-run
  // produces the same numbers the original yield did — used when an upstream
  // raw-lot cost is corrected after milling. Updates the batch's cost-per-kg
  // fields and every output lot (finished + byproducts). No-op if the batch
  // hasn't produced finished goods yet (its allocation will run fresh at yield).
  //
  // Cost model (kept identical to recordYield/recordMillingOutput):
  //   finished lot  = (raw + processing + millingFee) / finishedKg   [full pool]
  //   byproduct lot = market-value share of the pool / its kg
  // ───────────────────────────────────────────────────────────────────────
  async reallocateBatchCosts(trx, batchId) {
    const batch = await trx('milling_batches').where({ id: batchId }).first();
    if (!batch) return null;
    const finished = parseFloat(batch.actual_finished_mt) || 0;
    if (finished <= 0) return { skipped: 'no-yield' };

    const rawCostTotal = parseFloat(
      (await trx('milling_costs').where({ batch_id: batchId }).where('category', 'raw_rice').sum('amount as t').first())?.t
    ) || 0;
    const processingCosts = parseFloat(
      (await trx('milling_costs').where({ batch_id: batchId }).whereNot('category', 'raw_rice').sum('amount as t').first())?.t
    ) || 0;
    const millingFeeTotal = (parseFloat(batch.milling_fee_per_kg) || 0) * (parseFloat(batch.raw_qty_mt) || 0) * 1000;
    const totalBatchCostPool = rawCostTotal + processingCosts + millingFeeTotal;

    const p = (v) => parseFloat(v) || 0;
    const broken = p(batch.broken_mt), bran = p(batch.bran_mt), husk = p(batch.husk_mt), sortex = p(batch.sortex_rejects_mt);
    const b1 = p(batch.b1_mt), b2 = p(batch.b2_mt), b3 = p(batch.b3_mt), csr = p(batch.csr_mt), shortGrain = p(batch.short_grain_mt);
    const brokenPrice = p(batch.broken_price_per_mt);
    const prices = {
      finished: p(batch.finished_price_per_mt),
      b1: p(batch.b1_price_per_mt) || brokenPrice, b2: p(batch.b2_price_per_mt) || brokenPrice,
      b3: p(batch.b3_price_per_mt) || brokenPrice, csr: p(batch.csr_price_per_mt) || brokenPrice,
      short_grain: p(batch.short_grain_price_per_mt) || brokenPrice,
      broken: brokenPrice, bran: p(batch.bran_price_per_mt), husk: p(batch.husk_price_per_mt),
      sortex: p(batch.sortex_rejects_price_per_mt),
    };
    const hasPerGradeBroken = (b1 + b2 + b3 + csr + shortGrain) > 0;
    const outputs = {
      finished: { qty: finished, price: prices.finished },
      ...(hasPerGradeBroken
        ? { b1: { qty: b1, price: prices.b1 }, b2: { qty: b2, price: prices.b2 }, b3: { qty: b3, price: prices.b3 },
            csr: { qty: csr, price: prices.csr }, short_grain: { qty: shortGrain, price: prices.short_grain } }
        : { broken: { qty: broken, price: prices.broken } }),
      bran: { qty: bran, price: prices.bran }, husk: { qty: husk, price: prices.husk }, sortex: { qty: sortex, price: prices.sortex },
    };
    let totalMV = 0;
    for (const o of Object.values(outputs)) { o.marketValue = o.qty * o.price; totalMV += o.marketValue; }
    const alloc = {};
    for (const [name, o] of Object.entries(outputs)) {
      const share = (o.qty > 0 && totalMV > 0) ? o.marketValue / totalMV : 0;
      const allocatedCost = totalBatchCostPool * share;
      alloc[name] = { qty: o.qty, costPerKg: o.qty > 0 ? allocatedCost / (o.qty * 1000) : 0 };
    }

    const finishedKg = finished * 1000;
    await trx('milling_batches').where({ id: batchId }).update({
      raw_cost_total: rawCostTotal,
      raw_cost_per_kg_finished: finishedKg > 0 ? rawCostTotal / finishedKg : 0,
      milling_cost_per_kg_finished: finishedKg > 0 ? (processingCosts + millingFeeTotal) / finishedKg : 0,
      total_cost_per_kg_finished: alloc.finished.costPerKg,
    });

    // Update output lots. EVERY output — finished included — takes its
    // market-value-allocated cost (alloc[*].costPerKg), so Σ(outputs) = the pool
    // and priced by-products no longer leave finished with the whole pool. The
    // per-kg cost is split into raw vs milling in the pool's own ratio, matching
    // recordMillingOutput so the costing sheet shows the same breakdown.
    const rawFrac = totalBatchCostPool > 0 ? rawCostTotal / totalBatchCostPool : 0;
    const millFrac = totalBatchCostPool > 0 ? (processingCosts + millingFeeTotal) / totalBatchCostPool : 0;
    const outLots = await trx('inventory_lots')
      .where({ batch_ref: `batch-${batchId}` })
      .whereIn('type', ['finished', 'byproduct']);
    const keyForByproduct = (lot) => {
      const n = (lot.item_name || '').toLowerCase();
      const g = (lot.grade || '').toLowerCase();
      if (n.includes('bran')) return 'bran';
      if (n.includes('husk')) return 'husk';
      if (n.includes('sortex')) return 'sortex';
      if (g === 'b1') return 'b1'; if (g === 'b2') return 'b2'; if (g === 'b3') return 'b3';
      if (g === 'csr') return 'csr'; if (g.includes('short')) return 'short_grain';
      return 'broken';
    };
    // Broken-tier fallback: a batch can record per-grade quantities (b1_mt…)
    // while its output lot is a single generic "Broken Rice" (or vice-versa).
    // The grade key then has no matching alloc/lot and cost is lost. Pool the
    // whole broken tier into one per-kg rate and apply it to any broken-tier lot
    // that has no exact-key allocation, so the tier's cost lands somewhere.
    const BROKEN_KEYS = ['broken', 'b1', 'b2', 'b3', 'csr', 'short_grain'];
    let btAllocated = 0, btQtyKg = 0;
    for (const k of BROKEN_KEYS) {
      const a = alloc[k];
      if (a && a.qty > 0) { btAllocated += a.costPerKg * a.qty * 1000; btQtyKg += a.qty * 1000; }
    }
    const brokenTierCostPerKg = btQtyKg > 0 ? btAllocated / btQtyKg : 0;
    let updatedLots = 0;
    for (const lot of outLots) {
      let costKg;
      if (lot.type === 'finished') {
        costKg = alloc.finished?.costPerKg ?? 0;
      } else {
        const key = keyForByproduct(lot);
        if (alloc[key] && alloc[key].qty > 0) costKg = alloc[key].costPerKg;
        else if (BROKEN_KEYS.includes(key)) costKg = brokenTierCostPerKg;
        else costKg = 0;
      }
      const qtyKg = (parseFloat(lot.qty) || 0) * 1000;
      await trx('inventory_lots').where({ id: lot.id }).update({
        landed_cost_per_kg: costKg,
        landed_cost_total: costKg * qtyKg,
        cost_per_unit: costKg * 1000,
        total_value: costKg * qtyKg,
        rate_per_kg: costKg,
        raw_cost_component: costKg * rawFrac,
        milling_cost_component: costKg * millFrac,
        cost_incomplete: costKg === 0,
        updated_at: trx.fn.now(),
      });
      updatedLots += 1;
    }
    return { batchId, totalBatchCostPool, finishedCostPerKg: alloc.finished.costPerKg, updatedLots, outputLotIds: outLots.map((l) => l.id) };
  },

  // Cascade a corrected raw-lot cost into every batch that consumed it:
  // refresh batch_source_lots + the raw_rice cost pool, re-derive output costs
  // for already-yielded batches, and recompute COGS for any linked order/sale
  // that ISN'T locked at dispatch (locked figures are left intact, only logged).
  async propagateLotCostToBatches(trx, lotId, { userId } = {}) {
    const lot = await trx('inventory_lots').where({ id: lotId }).first();
    if (!lot) return { affectedBatches: 0 };
    const newCostKg = parseFloat(lot.landed_cost_per_kg) || 0;

    const sourceRows = await trx('batch_source_lots').where({ lot_id: lotId });
    // Legacy single-lot linkage: a raw lot points at its batch via
    // inventory_lots.batch_ref (no batch_source_lots row). Cover those too.
    let refBatchId = null;
    if (lot.batch_ref && /^batch-\d+$/.test(lot.batch_ref)) {
      refBatchId = parseInt(lot.batch_ref.replace('batch-', ''), 10);
    }
    const batchIds = [...new Set([...sourceRows.map((r) => r.batch_id), ...(refBatchId != null ? [refBatchId] : [])])];
    if (batchIds.length === 0) return { affectedBatches: 0 };

    const summary = { affectedBatches: 0, reallocated: 0, cogsUpdated: 0, cogsLockedSkipped: 0 };

    for (const batchId of batchIds) {
      const batch = await trx('milling_batches').where({ id: batchId }).first();
      if (!batch) continue;

      // 1+2. Recompute the batch's raw_rice cost pool.
      const myRows = sourceRows.filter((s) => s.batch_id === batchId);
      let newRawPool;
      if (myRows.length > 0) {
        // Blend / source-lots flow: each source lot carries its own cost_total.
        for (const r of myRows) {
          const costTotal = Math.round(newCostKg * (parseFloat(r.qty_mt) || 0) * 1000 * 100) / 100;
          await trx('batch_source_lots').where({ id: r.id }).update({ unit_cost_pkr: newCostKg, cost_total_pkr: costTotal });
        }
        const poolRow = await trx('batch_source_lots').where({ batch_id: batchId }).sum('cost_total_pkr as t').first();
        newRawPool = Math.round((parseFloat(poolRow?.t) || 0) * 100) / 100;
      } else {
        // Legacy batch_ref flow: this lot IS the batch's raw source. Only cascade
        // when it is genuinely the SOLE raw lot for the batch, so the quantity is
        // unambiguous — price the batch's authoritative raw_qty_mt at the lot cost.
        const rawCount = await trx('inventory_lots').where({ batch_ref: `batch-${batchId}`, type: 'raw' }).count('id as c').first();
        if (parseInt(rawCount.c, 10) !== 1) continue;
        newRawPool = Math.round(newCostKg * (parseFloat(batch.raw_qty_mt) || 0) * 1000 * 100) / 100;
      }
      const existingRaw = await trx('milling_costs').where({ batch_id: batchId, category: 'raw_rice' }).first();
      if (existingRaw) {
        await trx('milling_costs').where({ id: existingRaw.id }).update({ amount: newRawPool });
      } else {
        await trx('milling_costs').insert({ batch_id: batchId, category: 'raw_rice', amount: newRawPool, notes: 'Raw rice cost (recomputed from source lot)' });
      }
      // 3. Re-derive output costs if the batch has already yielded.
      const realloc = await inventoryService.reallocateBatchCosts(trx, batchId);
      if (realloc && !realloc.skipped) summary.reallocated += 1;

      // 4. Recompute COGS for non-locked orders/sales linked to this batch's outputs.
      const outLotIds = (realloc && realloc.outputLotIds) || [];
      if (outLotIds.length) {
        const orderIds = [...new Set((await trx('inventory_reservations').whereIn('lot_id', outLotIds).select('order_id')).map((x) => x.order_id).filter(Boolean))];
        for (const orderId of orderIds) {
          const order = await trx('export_orders').where({ id: orderId }).first();
          if (!order) continue;
          if (order.cost_locked_at_dispatch) { summary.cogsLockedSkipped += 1; continue; }
          const cogs = await inventoryService.calculateOrderCOGS(trx, orderId);
          await trx('export_orders').where({ id: orderId }).update({
            inventory_cogs_total_pkr: cogs.totalCOGS,
            inventory_cogs_per_mt_pkr: cogs.cogsPerMT,
          });
          summary.cogsUpdated += 1;
        }
        const saleIds = [...new Set((await trx('local_sales').whereIn('lot_id', outLotIds).select('id')).map((x) => x.id))];
        for (const saleId of saleIds) {
          const sale = await trx('local_sales').where({ id: saleId }).first();
          if (!sale) continue;
          if (sale.cost_locked_at_dispatch) { summary.cogsLockedSkipped += 1; continue; }
          const cogs = await inventoryService.calculateSaleCOGS(trx, saleId);
          await trx('local_sales').where({ id: saleId }).update({
            cogs_total_pkr: cogs.totalCOGS, cogs_per_kg: cogs.cogsPerKg, gross_profit_pkr: cogs.grossProfit,
          });
          summary.cogsUpdated += 1;
        }
      }

      // 5. Audit trail.
      await trx('historical_cost_repair_log').insert({
        lot_id: lotId,
        batch_id: batchId,
        issue_type: 'lot_cost_edit_propagated',
        old_value_json: JSON.stringify({ note: 'raw lot cost edited' }),
        new_value_json: JSON.stringify({ landed_cost_per_kg: newCostKg, rawPool: newRawPool, reallocated: !!(realloc && !realloc.skipped) }),
        repaired_by: userId || null,
        repaired_at: new Date(),
      });
      summary.affectedBatches += 1;
    }
    return summary;
  },

  // Re-run the market-value cost allocation across a batch's output lots after
  // its output prices change (price confirmation), then recompute COGS for any
  // non-locked order/sale drawing on those lots. This is what makes a by-product
  // priced AFTER yield finally receive its share of the batch cost (instead of
  // the finished lot keeping the whole pool). Locked-at-dispatch figures are
  // left intact and only logged. Call inside a transaction.
  async recomputeBatchOutputsAfterPriceChange(trx, batchId, { userId } = {}) {
    const realloc = await inventoryService.reallocateBatchCosts(trx, batchId);
    const summary = { reallocated: !!(realloc && !realloc.skipped), cogsUpdated: 0, cogsLockedSkipped: 0 };
    if (!realloc || realloc.skipped) return summary;

    const outLotIds = realloc.outputLotIds || [];
    if (outLotIds.length) {
      const orderIds = [...new Set((await trx('inventory_reservations').whereIn('lot_id', outLotIds).select('order_id')).map((x) => x.order_id).filter(Boolean))];
      for (const orderId of orderIds) {
        const order = await trx('export_orders').where({ id: orderId }).first();
        if (!order) continue;
        if (order.cost_locked_at_dispatch) { summary.cogsLockedSkipped += 1; continue; }
        const cogs = await inventoryService.calculateOrderCOGS(trx, orderId);
        await trx('export_orders').where({ id: orderId }).update({
          inventory_cogs_total_pkr: cogs.totalCOGS,
          inventory_cogs_per_mt_pkr: cogs.cogsPerMT,
        });
        summary.cogsUpdated += 1;
      }
      const saleIds = [...new Set((await trx('local_sales').whereIn('lot_id', outLotIds).select('id')).map((x) => x.id))];
      for (const saleId of saleIds) {
        const sale = await trx('local_sales').where({ id: saleId }).first();
        if (!sale) continue;
        if (sale.cost_locked_at_dispatch) { summary.cogsLockedSkipped += 1; continue; }
        const cogs = await inventoryService.calculateSaleCOGS(trx, saleId);
        await trx('local_sales').where({ id: saleId }).update({
          cogs_total_pkr: cogs.totalCOGS, cogs_per_kg: cogs.cogsPerKg, gross_profit_pkr: cogs.grossProfit,
        });
        summary.cogsUpdated += 1;
      }
    }

    await trx('historical_cost_repair_log').insert({
      lot_id: null,
      batch_id: batchId,
      issue_type: 'price_confirm_reallocated',
      old_value_json: JSON.stringify({ note: 'output prices confirmed/updated' }),
      new_value_json: JSON.stringify({ reallocated: summary.reallocated, updatedLots: realloc.updatedLots, cogsUpdated: summary.cogsUpdated }),
      repaired_by: userId || null,
      repaired_at: new Date(),
    });
    return summary;
  },
};

module.exports = inventoryService;
