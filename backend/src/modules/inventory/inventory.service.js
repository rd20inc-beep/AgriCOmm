const db = require('../../config/database');
const uc = require('../../services/unitConversion');

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
  // Service milling: hand client-owned finished/by-product stock back to the
  // client. Outbound, but NOT a sale — no revenue, no COGS, no GL (the client
  // already owns the rice; the mill only charges a separate service fee).
  SERVICE_DISPATCH: 'service_dispatch',
  // Reverse of a service dispatch (deleting a recorded handover) — adds the
  // client-owned stock back. Inbound, no GL.
  SERVICE_DISPATCH_REVERSE: 'service_dispatch_reverse',
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
  MOVEMENT_TYPES.SERVICE_DISPATCH,
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
  MOVEMENT_TYPES.SERVICE_DISPATCH_REVERSE,
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
  [MOVEMENT_TYPES.SERVICE_DISPATCH]: 'service_dispatch_out',
  [MOVEMENT_TYPES.SERVICE_DISPATCH_REVERSE]: 'service_dispatch_in',
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
  // Next number = max existing suffix for today + 1, NOT a row count. A count
  // collides with surviving higher-numbered rows after any delete (re-recording
  // a yield deletes & recreates output lots; count-based numbering then reused
  // an in-use TXN-… and tripped the unique constraint).
  const row = await trx('lot_transactions')
    .whereRaw('transaction_no LIKE ?', [`TXN-${today}-%`])
    .select(trx.raw("MAX(CAST(split_part(transaction_no, '-', 3) AS INTEGER)) as m"))
    .first();
  const next = (parseInt(row && row.m, 10) || 0) + 1;
  return `TXN-${today}-${String(next).padStart(4, '0')}`;
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
      powder:   'POWDER',
      sweeping: 'SWEEP',
      choba:    'CHOBA',
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

    // Units (Phase 5c): qty is now KG and costPerUnit is per-KG — so qty/cost
    // columns are stored natively in KG. totalCost = cost × qty is invariant
    // (the old MT×perMT gave the same PKR). net_weight_kg tracks qty 1:1.
    const parsedQty = parseFloat(qty);
    const parsedCost = parseFloat(costPerUnit) || 0;
    const totalCost = parsedCost * parsedQty;
    const movementQtyKg = parsedQty;
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

    // 3. Movement record shape. The canonical ledger row is lot_transactions
    //    (written in step 7); inventory_movements was a redundant KG mirror,
    //    retired in P6c-B. Return the same shape callers expect — it is opaque
    //    to them (no field is read off it, it is only bubbled up in responses).
    const movement = {
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
    };

    // 4. Update lot qty
    const currentQty = parseFloat(lot.qty) || 0;
    const currentReserved = parseFloat(lot.reserved_qty) || 0;
    const currentMillingReserved = parseFloat(lot.milling_reserved_qty) || 0; // P6a
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

    // 5. available_qty = qty - reserved_qty (export) - milling_reserved_qty (P6a)
    const newAvailable = newQty - currentReserved - currentMillingReserved;
    const currentNetWeightKg = parseFloat(lot.net_weight_kg) || currentQty;
    const newNetWeightKg = currentNetWeightKg + (direction * movementQtyKg);
    const newGrossWeightKg = newNetWeightKg;

    // 6. Recalculate total_value
    const newCostPerUnit = parsedCost > 0 ? parsedCost : parseFloat(lot.cost_per_unit) || 0;
    const newTotalValue = newCostPerUnit * newQty;

    const lotUpdate = {
      qty: newQty,
      available_qty: newAvailable,
      cost_per_unit: newCostPerUnit,
      total_value: newTotalValue,
      net_weight_kg: newNetWeightKg,
      gross_weight_kg: newGrossWeightKg,
      updated_at: trx.fn.now(),
    };
    // received_net_weight_kg = immutable original intake: grows on inbound
    // (purchase receipt / production output), never shrinks on consumption — so a
    // lot remembers how much it started with even after milling/sales draw it down.
    if (INBOUND_TYPES.has(movementType)) {
      lotUpdate.received_net_weight_kg = trx.raw('COALESCE(received_net_weight_kg, 0) + ?', [movementQtyKg]);
    }
    await trx('inventory_lots').where('id', lotId).update(lotUpdate);

    // Flag zero-cost lots on inbound movements — EXCEPT client-owned
    // (service-milling) lots, which are correctly zero-cost (the client owns the
    // rice; the mill only earns a service fee) and must not be flagged incomplete.
    if (INBOUND_TYPES.has(movementType) && parsedCost === 0 && lot.ownership !== 'client') {
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
      input_unit: 'KG',
      input_qty: parsedQty,
      quantity_kg: direction * movementQtyKg,
      quantity_bags: direction * Math.round(movementQtyKg / (parseFloat(lot.bag_weight_kg) || 50)),
      rate_input_unit: 'KG',
      rate_input_value: parsedCost || null,
      rate_per_kg: parsedCost > 0 ? parsedCost : null,
      cost_impact: totalCost,
      currency: currency || 'PKR',
      balance_kg: newNetWeightKg,
      balance_bags: Math.round(newNetWeightKg / (parseFloat(lot.bag_weight_kg) || 50)),
      remarks: notes || null,
      created_by: userId || null,
      // Phase 1 new columns
      unit_cost: parsedCost > 0 ? parsedCost : null,
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
        unit: unit || 'KG',
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
    weightKg,
    costPerKg,
    currency,
    supplierId,
    productId,
    vehicleNo,
    userId,
  }) {
    if (!trx) throw new Error('receiveRice requires a transaction');

    const parsedWeight = parseFloat(weightKg);
    const parsedCost = parseFloat(costPerKg) || 0;

    // Service-milling intake belongs to the CLIENT — stamp the raw lot
    // client-owned so it never counts as company stock/valuation. Empty object
    // for a normal batch → the owned-stock insert is byte-for-byte unchanged.
    const svcBatch = await trx('milling_batches').where({ id: batchId }).first('is_service_milling', 'client_customer_id');
    const svcOwnership = svcBatch?.is_service_milling
      ? { ownership: 'client', owner_customer_id: svcBatch.client_customer_id || null, service_batch_id: batchId }
      : {};

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
          unit: 'KG',
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
          ...svcOwnership,
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

    // Sync the per-kg cost / landed value fields from what postMovement set
    // (cost_per_unit is per MT, total_value = cost_per_unit × qty). receiveRice
    // creates the lot with these at 0 and postMovement only updates
    // cost_per_unit / total_value — so without this a raw rice lot showed
    // "Lot Value", rate/kg and landed cost all as 0 despite a real cost.
    if (lot) {
      const cpu = parseFloat(lot.cost_per_unit) || 0; // per KG (Phase 5c)
      const tv = parseFloat(lot.total_value) || 0;
      await trx('inventory_lots').where('id', lot.id).update({
        rate_per_kg: cpu,
        landed_cost_per_kg: cpu,
        landed_cost_total: tv,
        purchase_amount: tv,
        updated_at: trx.fn.now(),
      });
      lot = await trx('inventory_lots').where('id', lot.id).first();
    }

    return { lot, movement };
  },

  // =========================================================================
  // Consume raw material for milling
  // =========================================================================
  async consumeForMilling(trx, { batchId, qtyKg, userId }) {
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
        const want = parseFloat(s.qty_kg) || 0;
        // P6a: release THIS batch's milling hold first so the committed qty is
        // consumable. Availability subtracts milling_reserved_qty, so without
        // releasing, a fully-reserved lot would read available 0 and consume
        // nothing. Consume against physical-minus-export (qty − reserved_qty).
        const heldNow = parseFloat(lot.milling_reserved_qty) || 0;
        const heldAfter = Math.max(0, heldNow - want);
        if (heldNow !== heldAfter) {
          await trx('inventory_lots').where({ id: lot.id }).update({
            milling_reserved_qty: heldAfter,
            available_qty: (parseFloat(lot.qty) || 0) - (parseFloat(lot.reserved_qty) || 0) - heldAfter,
            updated_at: trx.fn.now(),
          });
        }
        const avail = (parseFloat(lot.qty) || 0) - (parseFloat(lot.reserved_qty) || 0) - heldAfter;
        const consume = Math.min(want, avail);
        if (consume <= 0) continue;
        const m = await inventoryService.postMovement(trx, {
          movementType: MOVEMENT_TYPES.PRODUCTION_ISSUE,
          lotId: lot.id,
          qty: consume,
          fromWarehouseId: lot.warehouse_id,
          sourceEntity: 'mill',
          linkedRef: `batch-${batchId}`,
          notes: `${lot.type === 'finished' ? 'Finished rice re-milled' : 'Rice consumed'} for milling batch ${batchId} (lot ${lot.lot_no || lot.id})`,
          // postMovement expects costPerUnit PER KG (Phase 5c) — landed_cost_per_kg
          // is already per KG, so pass it directly.
          costPerUnit: (parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0),
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
    const parsedQty = parseFloat(qtyKg);

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
      // costPerUnit is per KG (Phase 5c); landed_cost_per_kg is already per KG.
      costPerUnit: (parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0),
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
    finishedKg,
    brokenKg,
    branKg,
    huskKg,
    sortexKg,
    powderKg,
    sweepingKg,
    chobaKg,
    productName,
    costPerKg,
    rawCostComponent,
    millingCostComponent,
    byproductCosts, // { broken, bran, husk, sortex, powder, sweeping, choba } cost per kg
    // Optional per-grade split of brokenKg. When supplied, recordMillingOutput
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
    // Service-milling output belongs to the CLIENT: every output lot is stamped
    // client-owned (tracked physically, excluded from company stock/valuation/
    // availability) and correctly zero-cost (cost_incomplete=false so it is not
    // flagged by findProblematicLots). For a normal batch this object is empty,
    // so the owned-stock path is byte-for-byte unchanged.
    const svcOwnership = batchRow?.is_service_milling
      ? { ownership: 'client', owner_customer_id: batchRow.client_customer_id || null, service_batch_id: batchId, cost_incomplete: false }
      : {};
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
      // Grade-named lots (B1/B2/B3/CSR/Short Grain) still link to the Broken Rice
      // product for grouping, even though their item_name is just the grade.
      const GRADE_LABELS = ['B1', 'B2', 'B3', 'CSR', 'Short Grain'];
      const baseName = (itemName.startsWith('Broken Rice') || GRADE_LABELS.includes(itemName))
        ? 'Broken Rice' : itemName;
      const byCode = {
        'Broken Rice':    ['PROD-BROKEN-RICE',    'BROKEN-RICE'],
        'Rice Bran':      ['PROD-RICE-BRAN',      'RICE-BRAN'],
        'Rice Husk':      ['PROD-RICE-HUSK',      'RICE-HUSK'],
        // 'Sortex' is the display name; it still resolves to the seeded
        // Sortex Rejects product so no duplicate product is created.
        'Sortex':         ['PROD-SORTEX-REJECTS', 'SORTEX-REJECTS'],
        'Sortex Rejects': ['PROD-SORTEX-REJECTS', 'SORTEX-REJECTS'],
        'Powder':         ['PROD-POWDER',         'POWDER'],
        'Sweeping':       ['PROD-SWEEPING',       'SWEEPING'],
        'Choba':          ['PROD-CHOBA',          'CHOBA'],
      }[baseName] || [];
      for (const code of byCode) {
        const p = await trx('products').where({ code }).first('id');
        if (p) return p.id;
      }
      const named = await trx('products').whereILike('name', baseName).first('id');
      if (named) return named.id;
      // inventory_lots.product_id is NOT NULL, so a byproduct with no seeded
      // product (e.g. Powder/Sweeping) must get one. Auto-create an approved
      // byproduct product, idempotently keyed on a stable code.
      const code = (byCode[0]) || `PROD-${baseName.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      const existing = await trx('products').where({ code }).first('id');
      if (existing) return existing.id;
      const [created] = await trx('products').insert({
        code, name: baseName, is_byproduct: true, is_active: true, approval_status: 'approved',
      }).returning('id');
      return created.id || created;
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

    const parsedCost = parseFloat(costPerKg) || 0; // per KG (Phase 5c)

    // --- Finished rice ---
    const finishedQty = parseFloat(finishedKg) || 0;
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
          unit: 'KG',
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
          variety: isBlend ? `Blend ${blendNo}` : (qualityInfo?.variety || productName || null),
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
          ...svcOwnership,
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
            // Grades are first-class — the lot is named by its grade (B1, B2,
            // CSR, …), not a generic "Broken Rice" tag. Grade is also stamped on
            // inventory_lots.grade; product link stays via byproductProductLookup.
            name: g.label,
            // Prefer the per-grade cost if the caller provided one;
            // fall back to the aggregate "broken" cost otherwise.
            key: bpCosts[COST_KEY_BY_GRADE[g.key]] != null ? COST_KEY_BY_GRADE[g.key] : 'broken',
            grade: g.label,
            qty: parseFloat(grades[g.key]) || 0,
          }))
          .filter(x => x.qty > 0)
      : ((parseFloat(brokenKg) || 0) > 0
          ? [{ name: 'Broken Rice', key: 'broken', grade: null, qty: parseFloat(brokenKg) }]
          : []);

    const byproducts = [
      ...brokenItems,
      { name: 'Rice Bran',      key: 'bran',   grade: null, qty: parseFloat(branKg) || 0 },
      { name: 'Rice Husk',      key: 'husk',   grade: null, qty: parseFloat(huskKg) || 0 },
      { name: 'Sortex', key: 'sortex', grade: null, qty: parseFloat(sortexKg) || 0 },
      { name: 'Powder',         key: 'powder', grade: null, qty: parseFloat(powderKg) || 0 },
      { name: 'Sweeping',       key: 'sweeping', grade: null, qty: parseFloat(sweepingKg) || 0 },
      { name: 'Choba',          key: 'choba', grade: null, qty: parseFloat(chobaKg) || 0 },
    ];

    for (const bp of byproducts) {
      if (bp.qty <= 0) continue;

      const bpCostPerKg = parseFloat(bpCosts[bp.key]) || 0;

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
          unit: 'KG',
          batch_ref: `batch-${batchId}`,
          processing_type: isBlend ? 'blended' : 'single_variety',
          blend_batch_no: blendNo,
          cost_per_unit: bpCostPerKg,
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
          // By-products are identified by their grade/category (B1, B2, CSR, …)
          // in item_name + grade (→ the "Subtype" column) — never tagged "Broken".
          // variety carries the SOURCE RICE TYPE NAME so the "Item / Variety"
          // column shows the rice it came from (the blend marker for blends).
          variety: isBlend ? `Blend ${blendNo}` : (qualityInfo?.variety || productName || null),
          status: 'Available',
          created_by: userId || null,
          ...svcOwnership,
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
        costPerUnit: bpCostPerKg,
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
        const outputQtyKg = parseFloat(outputLot.qty) || 0;
        const rawQtyKg = parseFloat(rawLot.qty) || 0;
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
  async transferToExport(trx, { transferId, lotId, qtyKg, productName, orderId, transferPricePerMT, totalValuePkr, userId }) {
    if (!trx) throw new Error('transferToExport requires a transaction');

    // qtyKg is KG (engine). transferPricePerMT is the transfer DOC price (PKR/MT),
    // so convert to per-KG at this boundary (ratePerKg).
    const parsedQty = parseFloat(qtyKg);
    const pricePerMT = parseFloat(transferPricePerMT) || 0;
    const ratePerKg = pricePerMT / 1000;
    const totalValue = parseFloat(totalValuePkr) || (ratePerKg * parsedQty);
    const netKg = parsedQty;

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

    const [exportLot] = await trx('inventory_lots')
      .insert({
        lot_no: lotNo,
        item_name: productName || sourceLot.item_name,
        type: 'finished',
        entity: 'export',
        warehouse_id: exportWarehouse.id,
        product_id: sourceLot.product_id || null,
        qty: 0,
        unit: sourceLot.unit || 'KG',
        batch_ref: sourceLot.batch_ref || null,
        cost_per_unit: ratePerKg,
        cost_currency: sourceLot.cost_currency || 'PKR',
        total_value: totalValue,
        reserved_qty: 0,
        available_qty: 0,
        status: 'Available',
        // Stock physically moved into the export entity IS ready to allocate —
        // so it surfaces in the export order's "Reserve Finished Stock" picker.
        export_ready: true,
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
      // Value the dest lot's movement at the TRANSFER price (ratePerKg) — the same
      // basis its cost_per_unit / landed_cost_* were inserted with. Passing the
      // source cost here made postMovement overwrite cost_per_unit/total_value with
      // source cost while landed_cost_* kept the transfer price → two per-KG costs.
      costPerUnit: ratePerKg,
      currency: sourceLot.cost_currency || 'PKR',
      orderId: orderId || null,
      transferId: transferId || null,
      userId,
    });

    // Auto-reserve the freshly-transferred stock against the order it was moved
    // for, so the export lot can't be double-allocated and is dispatched at
    // Shipped (the dispatch loop runs off inventory_reservations). No order ⇒
    // the lot stays available in the export pool (speculative transfer), as
    // before. reserveStock reads available_qty (just set by the TRANSFER_IN),
    // enforces the over-reserve cap, writes the reservation row + ledger entry,
    // and sets reserved_against — all inside this same transaction.
    let reservation = null;
    if (orderId) {
      reservation = await inventoryService.reserveStock(trx, {
        lotId: exportLot.id,
        orderId,
        qtyKg: parsedQty,
        userId,
      });
    }

    const updatedExportLot = await trx('inventory_lots').where('id', exportLot.id).first();
    return { outMovement, inMovement, exportLot: updatedExportLot, reservation };
  },

  // =========================================================================
  // Transfer stock back from export to mill (mirror of transferToExport)
  // =========================================================================
  async transferToMill(trx, { transferId, lotId, qtyKg, productName, transferPricePerMT, totalValuePkr, userId }) {
    if (!trx) throw new Error('transferToMill requires a transaction');

    const parsedQty = parseFloat(qtyKg); // KG (engine)
    const sourceLot = await trx('inventory_lots').where('id', lotId).first();
    if (!sourceLot) throw new Error(`Source lot ${lotId} not found`);

    // transferPricePerMT is the transfer DOC price (PKR/MT) → per-KG; else fall
    // back to the source lot's cost_per_unit, which is already per-KG (Phase 5c).
    const ratePerKg = (transferPricePerMT != null && transferPricePerMT !== '')
      ? parseFloat(transferPricePerMT) / 1000
      : (parseFloat(sourceLot.cost_per_unit) || 0);
    const totalValue = parseFloat(totalValuePkr) || (ratePerKg * parsedQty);

    // Post transfer_out (reduces export lot)
    const outMovement = await inventoryService.postMovement(trx, {
      movementType: MOVEMENT_TYPES.TRANSFER_OUT,
      lotId: sourceLot.id,
      qty: parsedQty,
      fromWarehouseId: sourceLot.warehouse_id,
      sourceEntity: 'export',
      destEntity: 'mill',
      linkedRef: transferId ? `transfer-${transferId}` : null,
      notes: 'Transfer back to mill',
      costPerUnit: parseFloat(sourceLot.cost_per_unit) || 0,
      currency: sourceLot.cost_currency || 'PKR',
      transferId: transferId || null,
      userId,
    });

    // Find or create a mill finished-goods warehouse for the destination.
    let millWarehouse = await trx('warehouses')
      .where({ entity: 'mill' })
      .whereIn('type', ['finished'])
      .first();
    if (!millWarehouse) {
      millWarehouse = await trx('warehouses').where({ entity: 'mill' }).first();
    }
    if (!millWarehouse) {
      [millWarehouse] = await trx('warehouses')
        .insert({ name: 'Mill Finished Goods', entity: 'mill', type: 'finished' })
        .returning('*');
    }

    // Create a new mill-entity lot to hold the returned stock.
    const lotNo = await inventoryService.generateLotNo(trx);
    const [millLot] = await trx('inventory_lots')
      .insert({
        lot_no: lotNo,
        item_name: productName || sourceLot.item_name,
        type: sourceLot.type || 'finished',
        entity: 'mill',
        warehouse_id: millWarehouse.id,
        product_id: sourceLot.product_id || null,
        qty: 0,
        unit: sourceLot.unit || 'KG',
        batch_ref: sourceLot.batch_ref || null,
        cost_per_unit: ratePerKg,
        cost_currency: sourceLot.cost_currency || 'PKR',
        total_value: totalValue,
        reserved_qty: 0,
        available_qty: 0,
        status: 'Available',
        created_by: userId || null,
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

    // Post transfer_in (increases mill lot)
    const inMovement = await inventoryService.postMovement(trx, {
      movementType: MOVEMENT_TYPES.TRANSFER_IN,
      lotId: millLot.id,
      qty: parsedQty,
      toWarehouseId: millWarehouse.id,
      sourceEntity: 'export',
      destEntity: 'mill',
      linkedRef: transferId ? `transfer-${transferId}` : null,
      notes: 'Received back from export',
      // Value the dest lot's movement at the transfer price (ratePerKg), same as
      // its inserted cost fields — otherwise cost_per_unit/total_value diverge from
      // landed_cost_* (see transferToExport).
      costPerUnit: ratePerKg,
      currency: sourceLot.cost_currency || 'PKR',
      transferId: transferId || null,
      userId,
    });

    const updatedMillLot = await trx('inventory_lots').where('id', millLot.id).first();
    return { outMovement, inMovement, millLot: updatedMillLot };
  },

  // =========================================================================
  // Dispatch for export shipment
  // =========================================================================
  async dispatchForShipment(trx, { orderId, lotId, qtyKg, userId }) {
    if (!trx) throw new Error('dispatchForShipment requires a transaction');

    const parsedQty = parseFloat(qtyKg);

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
  async reserveStock(trx, { lotId, orderId, qtyKg, itemId = null, userId }) {
    if (!trx) throw new Error('reserveStock requires a transaction');

    const parsedQty = parseFloat(qtyKg);

    const lot = await trx('inventory_lots').where('id', lotId).first();
    if (!lot) throw new Error(`Lot ${lotId} not found`);
    // Client-owned (service-milling) stock can only be dispatched back to its
    // client — it can never be reserved/sold as company stock (export or local).
    if (lot.ownership === 'client') {
      throw new Error(`Lot ${lot.lot_no} is client-owned (service milling) and cannot be reserved or sold as company stock.`);
    }

    const availableQty = parseFloat(lot.available_qty) || 0;
    if (availableQty < parsedQty) {
      throw new Error(
        `Insufficient available stock in lot ${lot.lot_no}: available ${availableQty} ${lot.unit}, required ${parsedQty}`
      );
    }

    // Insert reservation. item_id ties it to a specific export_order_items line
    // when supplied; null = order-wide (legacy / single-line orders).
    const [reservation] = await trx('inventory_reservations')
      .insert({
        lot_id: lotId,
        order_id: orderId,
        item_id: itemId || null,
        reserved_qty: parsedQty,
        status: 'Active',
        created_by: userId || null,
      })
      .returning('*');

    // HARD ENFORCEMENT: no over-reservation (account for milling holds too, P6a)
    const millingReserved = parseFloat(lot.milling_reserved_qty) || 0;
    const newReserved = parseFloat(lot.reserved_qty) + parsedQty;
    if (newReserved + millingReserved > parseFloat(lot.qty) + 1e-6) {
      throw new Error(`Cannot reserve ${parsedQty} kg — would exceed available on lot ${lot.lot_no} (qty ${lot.qty}, already reserved ${lot.reserved_qty} + ${millingReserved} in milling)`);
    }
    const newAvailable = parseFloat(lot.qty) - newReserved - millingReserved;

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
      reservation_effect: parsedQty,
      remarks: `Reserved ${parsedQty} KG for order ${orderId}`,
      created_by: userId || null, // NOT NULL since migration 066 — must be set
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
    const millingReserved = parseFloat(lot.milling_reserved_qty) || 0; // P6a
    const newAvailable = parseFloat(lot.qty) - newReserved - millingReserved;

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

  // Reads the canonical lot_transactions (KG), aliased to the legacy movement
  // shape callers/FE expect (movement_type, qty, created_at…). qty is the
  // absolute KG magnitude; the ledger's signed quantity_kg encodes direction.
  async getMovementsByLot(lotId) {
    return db('lot_transactions')
      .where('lot_id', lotId)
      .select(
        'id',
        'lot_id',
        'transaction_type as movement_type',
        db.raw('ABS(quantity_kg) as qty'),
        'reference_no as linked_ref',
        'warehouse_from_id as from_warehouse_id',
        'warehouse_to_id as to_warehouse_id',
        'entity_from as source_entity',
        'entity_to as dest_entity',
        'unit_cost as cost_per_unit',
        'total_cost',
        'currency',
        'remarks as notes',
        'reference_id',
        db.raw('COALESCE(performed_at, created_at) as created_at')
      )
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
        'mb.batch_no', 'mb.raw_qty_kg', 'mb.actual_finished_kg', 'mb.yield_pct'
      )
      .where('lsm.child_lot_id', lotId)
      .orderBy('lsm.created_at');

    // Fallback: milling/blend outputs record their inputs in batch_source_lots
    // (not lot_source_mapping), so surface those source lots as parents too —
    // otherwise a blended/re-milled output shows no lineage at all.
    const lot = await db('inventory_lots').where({ id: lotId }).select('batch_ref').first();
    const batchId = lot && lot.batch_ref && (/^batch-(\d+)$/.exec(lot.batch_ref) || [])[1];
    if (batchId) {
      const seen = new Set(mappings.map((m) => m.parent_lot_id));
      const sources = await db('batch_source_lots as bsl')
        .leftJoin('inventory_lots as src', 'bsl.lot_id', 'src.id')
        .leftJoin('milling_batches as mb', 'bsl.batch_id', 'mb.id')
        .where('bsl.batch_id', batchId)
        .select(
          'bsl.lot_id as parent_lot_id', 'bsl.qty_kg', 'bsl.cost_total_pkr',
          'src.lot_no as parent_lot_no', 'src.item_name as parent_item', 'src.type as parent_type',
          'mb.batch_no'
        );
      for (const s of sources) {
        if (seen.has(s.parent_lot_id)) continue;
        mappings.push({
          parent_lot_id: s.parent_lot_id,
          parent_lot_no: s.parent_lot_no,
          parent_item: s.parent_item,
          parent_type: s.parent_type,
          batch_no: s.batch_no,
          quantity_kg: parseFloat(s.qty_kg) || 0,
          cost_share_amount: parseFloat(s.cost_total_pkr) || 0,
          via_blend: true,
        });
      }
    }
    return mappings;
  },

  /**
   * Where this lot was CONSUMED as a source into a (re-mill / blend) batch.
   * Blends record inputs in batch_source_lots, not lot_source_mapping, so this
   * is how "where did this lot go" is answered for milled/blended stock.
   */
  async getLotConsumption(lotId) {
    const rows = await db('batch_source_lots as bsl')
      .join('milling_batches as mb', 'bsl.batch_id', 'mb.id')
      .where('bsl.lot_id', lotId)
      .select(
        'bsl.batch_id', 'bsl.qty_kg', 'bsl.ratio_pct', 'bsl.notes', 'bsl.created_at',
        'mb.batch_no', 'mb.status', 'mb.raw_qty_kg', 'mb.actual_finished_kg'
      )
      .orderBy('bsl.created_at');
    for (const r of rows) {
      r.outputs = await db('inventory_lots')
        .where({ batch_ref: `batch-${r.batch_id}` })
        .whereIn('type', ['finished', 'byproduct'])
        .select('lot_no', 'item_name', 'type', 'qty')
        .orderByRaw("CASE WHEN type='finished' THEN 0 ELSE 1 END");
    }
    return rows;
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
      const qtyKg = parseFloat(r.reserved_qty); // KG (Phase 5c)
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
      .select('qty_kg', 'transfer_price_pkr');

    for (const t of transfers) {
      // transfer_price_pkr is PKR/MT (doc); qty_kg is KG → ÷1000 to combine.
      totalCOGS += parseFloat(t.transfer_price_pkr) * parseFloat(t.qty_kg) / 1000;
      totalQtyKg += parseFloat(t.qty_kg);
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
        const batchFinishedKg = parseFloat(batch.actual_finished_kg) || 0; // KG
        // export_orders.qty_mt stays MT (doc) → ×1000 to KG to combine.
        const orderQtyKg = (parseFloat(order.qty_mt) || 0) * 1000;
        if (batchCostsTotal > 0 && batchFinishedKg > 0 && orderQtyKg > 0) {
          // Pro-rate batch cost by the share of finished weight this order took.
          // For seed data where order_qty == batch_finished, this is just
          // the full batch cost; for partial allocations it scales down.
          const ratio = Math.min(orderQtyKg / batchFinishedKg, 1);
          const proratedCogs = batchCostsTotal * ratio;
          const totalQtyKgFromBatch = orderQtyKg;
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

    // Value the contract in PKR at the order's BOOKED rate (fall back to the caller
    // rate, then 280) and prefer the already-locked PKR figure so COGS/profit use
    // the SAME PKR revenue basis as revenue recognition — not a flat 280.
    const rate = pkrRate || parseFloat(order.booked_fx_rate) || 280;
    const contractValuePKR = parseFloat(order.contract_value_pkr_locked)
      || (parseFloat(order.contract_value) || 0) * rate;
    const grossProfitPKR = contractValuePKR - cogs.totalCOGS;
    const grossProfitUSD = rate > 0 ? grossProfitPKR / rate : 0;
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

    // Validate a decrease against on-hand up front (same direction logic as
    // approveStockAdjustment) so the operator learns at ENTRY, not only at
    // approval, that the adjustment exceeds available stock. The authoritative
    // guard still runs in postMovement at approval.
    const qk = parseFloat(quantityKg);
    const isIncrease = ['excess_found', 'manual_correction'].includes(adjustmentType) && qk > 0;
    if (!isIncrease) {
      const available = parseFloat(lot.available_qty) || 0;
      if (Math.abs(qk) > available + 0.0001) {
        throw new Error(`Adjustment of ${Math.abs(qk)} kg exceeds available stock (${available} kg) in lot ${lot.lot_no}.`);
      }
    }

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

    // Post movement through ledger (qty + cost are per KG — Phase 5c).
    await inventoryService.postMovement(trx, {
      movementType,
      lotId: adj.lot_id,
      qty: Math.abs(qtyKg),
      sourceEntity: lot.entity,
      linkedRef: `adjustment-${adjustmentId}`,
      notes: `${adj.adjustment_type}: ${adj.reason || 'No reason'}`,
      costPerUnit: parseFloat(adj.unit_cost) || 0, // per KG
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
    const systemBalanceKg = parseFloat(lot.qty) || 0; // qty is KG (Phase 5c)
    const discrepancyKg = systemBalanceKg - ledgerBalanceKg;

    return {
      lotId,
      lotNo: lot.lot_no,
      systemQtyMT: systemBalanceKg / 1000,
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
    // Company-owned only — client-owned (service-milling) stock must never
    // inflate company inventory valuation or average cost.
    const lots = await db('inventory_lots').where('available_qty', '>', 0).where('ownership', 'company').select('type', 'entity', 'available_qty', 'rate_per_kg', 'landed_cost_per_kg', 'net_weight_kg');

    const groups = {};
    for (const lot of lots) {
      const key = `${lot.entity || 'unknown'}|${lot.type || 'unknown'}`;
      if (!groups[key]) groups[key] = { entity: lot.entity, type: lot.type, totalKg: 0, totalValue: 0 };
      const costKg = parseFloat(lot.landed_cost_per_kg) || parseFloat(lot.rate_per_kg) || 0;
      const qtyKg = parseFloat(lot.available_qty); // KG (Phase 5c)
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
    // Client-owned (service-milling) lots are INTENTIONALLY zero-cost and have no
    // company lineage — exclude them from all data-quality alerts below.
    const zeroCost = await db('inventory_lots').where(function () { this.where('rate_per_kg', 0).orWhereNull('rate_per_kg'); }).where('qty', '>', 0).where('ownership', 'company').select('id', 'lot_no', 'type', 'qty');
    const incomplete = await db('inventory_lots').where('cost_incomplete', true).where('ownership', 'company').select('id', 'lot_no', 'type', 'qty');
    const noLineage = await db.raw("SELECT l.id, l.lot_no, l.type, l.qty FROM inventory_lots l WHERE l.type IN ('finished','byproduct') AND l.ownership = 'company' AND l.id NOT IN (SELECT child_lot_id FROM lot_source_mapping) AND l.qty > 0");
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

    // Repair via the canonical RESIDUAL-COSTING model, not the old market-value
    // joint-cost split. reallocateBatchCosts recomputes ALL the batch's output
    // lots through computeResidualAllocation (finished = Net Purchase − by-product
    // sale value ÷ finished; by-products at NRV) — the same basis used everywhere
    // else. The previous market-value math inflated finished cost (no by-product
    // credit), double-counted across outputs, and posted no offsetting GL.
    let newCostPerKg = 0;
    if (lot.batch_ref) {
      const batchId = parseInt(lot.batch_ref.replace('batch-', ''), 10);
      if (batchId) {
        await inventoryService.reallocateBatchCosts(conn, batchId);
        // Re-read the repaired lot for the log (reallocate rewrote its cost).
        const fresh = await conn('inventory_lots').where('id', lotId).first();
        newCostPerKg = parseFloat(fresh?.landed_cost_per_kg) || 0;
        if (newCostPerKg > 0 && lot.cost_incomplete) {
          await conn('inventory_lots').where('id', lotId).update({ cost_incomplete: false });
        }
      }
    }

    if (newCostPerKg > 0) {
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
  // ── Residual (by-product-credit) cost model ──
  // Finished rice absorbs whatever is left after crediting by-products at their
  // SALE value:  finished = max(0, NetPurchase − Σ byproduct sale value).
  //   NetPurchase = rawCostTotal + millingCost + otherExpenses
  //   millingCost  = batch.manual_milling_cost_pkr  ?? (fee/kg × raw kg)   [fallback]
  //   otherExpenses= batch.manual_other_expenses_pkr ?? recorded processing costs
  // By-products are costed at price/1000 (NRV → zero gain on sale). Pure function
  // of the batch row + the two cost sums, so recordYield and the price-confirm
  // reallocation produce identical numbers.
  computeResidualAllocation(batch, rawCostTotal, processingCosts, packingCost = 0) {
    const p = (v) => parseFloat(v) || 0;
    // Milling Cost is operator-entered; until they enter it, it's 0 (the milling
    // fee is NOT auto-added). Other Expenses falls back to recorded processing
    // costs (consumption etc.) so those real costs still count. Packing (bag) cost
    // is a SEPARATE always-added term — it stands even when a manual Other figure
    // overrides the auto processing costs, so bagging always loads the finished cost.
    const millingCost = batch.manual_milling_cost_pkr != null ? p(batch.manual_milling_cost_pkr) : 0;
    const otherExpenses = batch.manual_other_expenses_pkr != null ? p(batch.manual_other_expenses_pkr) : processingCosts;
    const packing = p(packingCost);
    const netPurchase = rawCostTotal + millingCost + otherExpenses + packing;

    // Units (Phase 5c): yield quantities are KG, prices are per-KG. byproductValue
    // = qty(KG) × price(/KG) = PKR (was MT × /MT — same PKR). finishedKg is the
    // finished qty directly (already KG); by-product cost/kg is just the price.
    const finished = p(batch.actual_finished_kg);
    const broken = p(batch.broken_kg), bran = p(batch.bran_kg), husk = p(batch.husk_kg), sortex = p(batch.sortex_rejects_kg);
    const b1 = p(batch.b1_kg), b2 = p(batch.b2_kg), b3 = p(batch.b3_kg), csr = p(batch.csr_kg), shortGrain = p(batch.short_grain_kg);
    const powder = p(batch.powder_kg), sweeping = p(batch.sweeping_kg), choba = p(batch.choba_kg);
    const brokenPrice = p(batch.broken_price_per_kg);
    const price = {
      b1: p(batch.b1_price_per_kg) || brokenPrice, b2: p(batch.b2_price_per_kg) || brokenPrice,
      b3: p(batch.b3_price_per_kg) || brokenPrice, csr: p(batch.csr_price_per_kg) || brokenPrice,
      short_grain: p(batch.short_grain_price_per_kg) || brokenPrice, broken: brokenPrice,
      bran: p(batch.bran_price_per_kg), husk: p(batch.husk_price_per_kg), sortex: p(batch.sortex_rejects_price_per_kg),
      powder: p(batch.powder_price_per_kg), sweeping: p(batch.sweeping_price_per_kg), choba: p(batch.choba_price_per_kg),
    };
    const hasPerGradeBroken = (b1 + b2 + b3 + csr + shortGrain) > 0;
    // O.V (ov_kg) and Stone (stone_kg) are record-only residue — like wastage,
    // they carry no sale value and are NOT credited here, so their weight is
    // absorbed into the finished cost.
    const byQty = hasPerGradeBroken
      ? { b1, b2, b3, csr, short_grain: shortGrain, bran, husk, sortex, powder, sweeping, choba }
      : { broken, bran, husk, sortex, powder, sweeping, choba };

    let byproductValue = 0;
    const byCostPerKg = {};
    for (const [k, qty] of Object.entries(byQty)) {
      byproductValue += qty * price[k];
      byCostPerKg[k] = price[k]; // by-product valued at sale price (already per-KG)
    }
    const residual = netPurchase - byproductValue;
    const clamped = residual < 0;
    const finishedTotal = Math.max(0, residual);
    const finishedKg = finished;
    const finishedCostPerKg = finishedKg > 0 ? finishedTotal / finishedKg : 0;
    const rawFrac = netPurchase > 0 ? rawCostTotal / netPurchase : 0;
    const millFrac = netPurchase > 0 ? (millingCost + otherExpenses + packing) / netPurchase : 0;
    // Aggregate broken-tier rate for a generic "Broken Rice" lot when the batch
    // recorded per-grade quantities (qty-weighted average sale price).
    const gradeQty = b1 + b2 + b3 + csr + shortGrain;
    const brokenTierCostPerKg = gradeQty > 0
      ? (b1 * price.b1 + b2 * price.b2 + b3 * price.b3 + csr * price.csr + shortGrain * price.short_grain) / gradeQty
      : brokenPrice;
    return { netPurchase, millingCost, otherExpenses, packing, byproductValue, finishedTotal,
      finishedCostPerKg, byCostPerKg, brokenTierCostPerKg, hasPerGradeBroken, rawFrac, millFrac, clamped, finished };
  },

  // Ensure a batch has its raw-rice cost. Batches started from a lot
  // (startMillingForLot) only get batch_source_lots — no raw_rice milling_cost —
  // so without this the residual Net Purchase has no raw component. Derive it
  // from each source lot's landed cost × qty consumed (and backfill the source-
  // lot cost columns). No-op if a raw_rice cost already exists (blends/createBatch
  // set it) or there are no priced source lots.
  async ensureRawCostFromSourceLots(trx, batchId) {
    const existing = parseFloat(
      (await trx('milling_costs').where({ batch_id: batchId }).where('category', 'raw_rice').sum('amount as t').first())?.t
    ) || 0;
    if (existing > 0) return existing;

    const srcLots = await trx('batch_source_lots as bsl')
      .leftJoin('inventory_lots as il', 'bsl.lot_id', 'il.id')
      .where('bsl.batch_id', batchId)
      .select('bsl.id', 'bsl.qty_kg', 'il.lot_no', 'il.landed_cost_per_kg', 'il.rate_per_kg');
    if (!srcLots.length) return 0;

    let rawTotal = 0;
    const labels = [];
    for (const s of srcLots) {
      const costKg = parseFloat(s.landed_cost_per_kg) || parseFloat(s.rate_per_kg) || 0;
      const qtyKg = parseFloat(s.qty_kg) || 0;
      const costTotal = Math.round(costKg * qtyKg * 100) / 100;
      rawTotal += costTotal;
      await trx('batch_source_lots').where('id', s.id).update({ unit_cost_pkr: costKg, cost_total_pkr: costTotal });
      labels.push(`${s.lot_no || s.id}×${parseFloat(s.qty_kg) || 0}KG`);
    }
    if (rawTotal > 0) {
      await trx('milling_costs').insert({
        batch_id: batchId, category: 'raw_rice', amount: Math.round(rawTotal * 100) / 100,
        currency: 'PKR', notes: `Raw rice from source lot(s): ${labels.join(', ')}`,
      });
    }
    return rawTotal;
  },

  // Recompute a batch's raw_rice milling_cost from its vehicle arrivals:
  // Σ(weight_mt × the per-truck price in quality_json.price_per_mt). Trucks
  // without a price use the weighted-average price of the priced trucks. No-op
  // when NO truck carries a price (so it never zeroes a cost set another way,
  // e.g. a blend costed from source lots, or a lot costed from its landed rate).
  // Cascades into already-yielded output lots so their costing stays correct.
  // Shared by the batch add/remove-vehicle handlers and start-milling so an
  // intake-captured per-truck price flows into the batch raw cost on milling.
  async recomputeRawRiceCostFromVehicles(trx, batchId, userId) {
    const vrows = await trx('milling_vehicle_arrivals').where({ batch_id: batchId });
    if (!vrows.length) return;
    let pricedW = 0, pricedCost = 0, totalW = 0;
    for (const v of vrows) {
      const w = parseFloat(v.weight_kg) || 0; // KG (Phase 5c)
      totalW += w;
      const qj = v.quality_json || {};
      // quality_json.price_per_mt is the per-truck DOC price (PKR/MT) → per-KG.
      const p = qj.price_per_mt != null ? parseFloat(qj.price_per_mt) / 1000 : null;
      if (p != null && !Number.isNaN(p) && p > 0) { pricedW += w; pricedCost += w * p; }
    }
    if (totalW > 0) {
      const b = await trx('milling_batches').where({ id: batchId }).first('actual_finished_kg');
      const fin = parseFloat(b?.actual_finished_kg) || 0;
      if (fin > 0) {
        await trx('milling_batches').where({ id: batchId })
          .update({ yield_pct: Math.round((fin / totalW) * 1000) / 10, updated_at: trx.fn.now() });
      }
    }
    if (pricedW <= 0) return; // no per-truck price anywhere — leave any existing cost alone
    const avg = pricedCost / pricedW; // per KG
    const rawRiceCost = Math.round((pricedCost + Math.max(0, totalW - pricedW) * avg) * 100) / 100;
    const notes = `Auto from ${vrows.length} vehicle(s): ${Math.round(totalW * 100) / 100} KG @ ~Rs ${Math.round(avg).toLocaleString()}/KG`;
    const existing = await trx('milling_costs').where({ batch_id: batchId, category: 'raw_rice' }).first();
    if (existing) {
      await trx('milling_costs').where({ id: existing.id }).update({ amount: rawRiceCost, notes, updated_at: trx.fn.now() });
    } else {
      await trx('milling_costs').insert({ batch_id: batchId, category: 'raw_rice', amount: rawRiceCost, notes, created_by: userId || null });
    }
    const yielded = await trx('inventory_lots')
      .where({ batch_ref: `batch-${batchId}` }).whereIn('type', ['finished', 'byproduct']).first('id');
    if (yielded) await inventoryService.recomputeBatchOutputsAfterPriceChange(trx, batchId, { userId });
  },

  async reallocateBatchCosts(trx, batchId) {
    const batch = await trx('milling_batches').where({ id: batchId }).first();
    if (!batch) return null;
    const finished = parseFloat(batch.actual_finished_kg) || 0;
    if (finished <= 0) return { skipped: 'no-yield' };

    await inventoryService.ensureRawCostFromSourceLots(trx, batchId);
    const rawCostTotal = parseFloat(
      (await trx('milling_costs').where({ batch_id: batchId }).where('category', 'raw_rice').sum('amount as t').first())?.t
    ) || 0;
    const processingCosts = parseFloat(
      (await trx('milling_costs').where({ batch_id: batchId }).whereNotIn('category', ['raw_rice', 'packaging']).sum('amount as t').first())?.t
    ) || 0;
    const packingCost = parseFloat(
      (await trx('milling_costs').where({ batch_id: batchId, category: 'packaging' }).sum('amount as t').first())?.t
    ) || 0;

    const a = inventoryService.computeResidualAllocation(batch, rawCostTotal, processingCosts, packingCost);
    const alloc = { finished: { qty: finished, costPerKg: a.finishedCostPerKg } };
    for (const [k, perKg] of Object.entries(a.byCostPerKg)) alloc[k] = { qty: 1, costPerKg: perKg };
    const brokenTierCostPerKg = a.brokenTierCostPerKg;

    const finishedKg = finished;
    await trx('milling_batches').where({ id: batchId }).update({
      raw_cost_total: rawCostTotal,
      raw_cost_per_kg_finished: a.finishedCostPerKg * a.rawFrac,
      milling_cost_per_kg_finished: a.finishedCostPerKg * a.millFrac,
      total_cost_per_kg_finished: a.finishedCostPerKg,
    });

    // Update output lots. Finished takes the residual cost; each by-product is
    // valued at its own sale price (NRV). Per-kg cost is split raw/milling in the
    // Net Purchase ratio, matching recordMillingOutput's breakdown.
    const rawFrac = a.rawFrac;
    const millFrac = a.millFrac;
    const outLots = await trx('inventory_lots')
      .where({ batch_ref: `batch-${batchId}` })
      .whereIn('type', ['finished', 'byproduct'])
      .whereNot('status', 'Closed'); // voided/closed duplicates don't get re-costed
    const keyForByproduct = (lot) => {
      const n = (lot.item_name || '').toLowerCase();
      const g = (lot.grade || '').toLowerCase();
      if (n.includes('bran')) return 'bran';
      if (n.includes('husk')) return 'husk';
      if (n.includes('sortex')) return 'sortex';
      if (n.includes('powder')) return 'powder';
      if (n.includes('sweeping')) return 'sweeping';
      if (n.includes('choba')) return 'choba';
      // Grade can live in the grade column OR the lot_no / item_name (e.g.
      // "M-002-B1-01", "Blend M-002 — B1"). Output lots created at yield left the
      // grade column blank, which collapsed every broken grade onto the tier
      // average instead of its own sale price — so also parse the identifiers.
      const s = `${lot.lot_no || ''} ${lot.item_name || ''} ${g}`.toLowerCase();
      if (g === 'b1' || /\bb1\b/.test(s)) return 'b1';
      if (g === 'b2' || /\bb2\b/.test(s)) return 'b2';
      if (g === 'b3' || /\bb3\b/.test(s)) return 'b3';
      if (g === 'csr' || /\bcsr\b/.test(s)) return 'csr';
      if (g.includes('short') || /short[\s-]?grain/.test(s)) return 'short_grain';
      return 'broken';
    };
    // Broken-tier keys — a generic "Broken Rice" lot (no exact grade key) gets
    // the qty-weighted tier rate computed in computeResidualAllocation.
    const BROKEN_KEYS = ['broken', 'b1', 'b2', 'b3', 'csr', 'short_grain'];
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
      const qtyKg = parseFloat(lot.qty) || 0;
      await trx('inventory_lots').where({ id: lot.id }).update({
        landed_cost_per_kg: costKg,
        landed_cost_total: costKg * qtyKg,
        cost_per_unit: costKg,
        total_value: costKg * qtyKg,
        rate_per_kg: costKg,
        raw_cost_component: costKg * rawFrac,
        milling_cost_component: costKg * millFrac,
        cost_incomplete: costKg === 0,
        updated_at: trx.fn.now(),
      });
      updatedLots += 1;
    }
    return {
      batchId, netPurchase: a.netPurchase, byproductValue: a.byproductValue,
      finishedCostPerKg: a.finishedCostPerKg, clamped: a.clamped,
      updatedLots, outputLotIds: outLots.map((l) => l.id),
    };
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
          const costTotal = Math.round(newCostKg * (parseFloat(r.qty_kg) || 0) * 100) / 100;
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
        newRawPool = Math.round(newCostKg * (parseFloat(batch.raw_qty_kg) || 0) * 100) / 100;
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
    const summary = {
      reallocated: !!(realloc && !realloc.skipped), cogsUpdated: 0, cogsLockedSkipped: 0,
      finishedCostPerKg: realloc?.finishedCostPerKg, netPurchase: realloc?.netPurchase,
      byproductValue: realloc?.byproductValue, clamped: realloc?.clamped,
    };
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

  /**
   * Katta (bag) accounting for a milled batch — PER SIZE. The raw arrives in
   * katta of a given bag size; milling FREES those empty bags into packaging
   * stock (one mill_item per size, code `KATTA-<kg>`), and the outputs are PACKED
   * into katta of the batch's PREDOMINANT raw size, consuming them back. Freed
   * bags are grouped by each vehicle's bag_size_kg (fallback = its kg ÷ bags).
   * Idempotent: reverses ALL of the batch's prior katta movements (across any
   * size item) first, so re-recording reconciles cleanly. No-op for batches with
   * no vehicle-bag intake (blends / lot-started).
   */
  async reconcileBatchKatta(trx, batchId, userId) {
    const num = (v) => parseFloat(v) || 0;
    const vehs = await trx('milling_vehicle_arrivals').where('batch_id', batchId)
      .select('total_bags', 'bag_size_kg', 'weight_kg');

    // Freed katta grouped by bag size.
    const bySize = new Map(); // sizeKg → bags
    for (const v of vehs) {
      const bags = Math.round(num(v.total_bags));
      if (bags <= 0) continue;
      const wKg = num(v.weight_kg);
      // Snap to the nearest standard sack size — the nominal bag_size_kg if set,
      // else derived from weight ÷ bags — so shrinkage noise (49.3) settles on
      // the real size (50) instead of spawning an off-size KATTA-49.
      const size = uc.snapBagSizeKg(num(v.bag_size_kg) || (bags > 0 ? wKg / bags : 0));
      if (size <= 0) continue;
      bySize.set(size, (bySize.get(size) || 0) + bags);
    }

    // Fallback: batches built from pre-existing raw lots — blends, or lots
    // entered via New Purchase Lot rather than the vehicle-arrival flow — have
    // no batch-scoped truck records, so the loop above finds nothing. Derive the
    // freed katta from each source lot's own bag count, proportioned to how much
    // of that lot this batch actually consumed (a blend may take only part of a
    // lot; the rest stays bagged in stock).
    if (bySize.size === 0) {
      const srcLots = await trx('batch_source_lots as bsl')
        .leftJoin('inventory_lots as il', 'il.id', 'bsl.lot_id')
        .where('bsl.batch_id', batchId)
        .andWhere('il.type', 'raw')
        .select('bsl.qty_kg', 'il.total_bags', 'il.bag_size_kg', 'il.received_net_weight_kg');
      for (const r of srcLots) {
        const totalBags = Math.round(num(r.total_bags));
        if (totalBags <= 0) continue;
        // Bag size: the nominal bag_size_kg if set, else received intake weight ÷
        // bag count — snapped to the nearest standard sack size so shrinkage
        // noise (49.3) settles on the real size (50), not an off-size KATTA-49.
        const received = num(r.received_net_weight_kg);
        const size = uc.snapBagSizeKg(num(r.bag_size_kg) || (received > 0 ? received / totalBags : 0));
        if (size <= 0) continue;
        // Bags freed = the lot's actual bag count scaled by the weight-fraction
        // this batch consumed (a blend may take only part of a lot). Using the
        // real total_bags — not consumed÷nominalSize — means a FULLY-milled lot
        // frees ALL its physical sacks even though nominal 50 > the ~49 avg.
        // Fall back to consumed÷size only when the received weight is unknown.
        const consumed = num(r.qty_kg);
        let bags;
        if (consumed <= 0) bags = totalBags;
        else if (received > 0) bags = Math.min(totalBags, Math.round(totalBags * consumed / received));
        else bags = Math.min(totalBags, Math.round(consumed / size));
        if (bags <= 0) continue;
        bySize.set(size, (bySize.get(size) || 0) + bags);
      }
    }

    let freed = 0; bySize.forEach((b) => { freed += b; });
    if (freed <= 0) return null; // no katta intake

    // Predominant size (most bags) — what the outputs are packed in.
    let predSize = 0, predBags = -1;
    for (const [s, b] of bySize) if (b > predBags) { predBags = b; predSize = s; }

    // Export-aware packing: a batch linked to an export order packs its FINISHED
    // rice into the customer's spec instead of the predominant raw katta —
    // retail → the order's bag_size_kg, jumbo → 1,200kg FIBC, container → bulk
    // (no bags). Byproducts + non-export batches keep the predominant-size logic.
    let exportPack = null; // { packSize:number|null }
    const batchRow = await trx('milling_batches').where('id', batchId).first('linked_export_order_id');
    if (batchRow && batchRow.linked_export_order_id) {
      const eo = await trx('export_orders').where('id', batchRow.linked_export_order_id).first('packing_type', 'bag_size_kg', 'order_no');
      if (eo) {
        const pt = eo.packing_type || 'retail';
        const packSize = pt === 'container' ? null : (pt === 'jumbo' ? 1200 : (num(eo.bag_size_kg) || null));
        // Only override when we actually have a distinct target size (or container bulk).
        if (pt === 'container' || packSize) exportPack = { packSize, orderNo: eo.order_no, packingType: pt };
      }
    }

    // find/create a Katta packaging item + stock row for a given size.
    const itemForSize = async (size) => {
      const code = `KATTA-${size}`;
      let it = await trx('mill_items').where('code', code).first();
      if (!it) {
        [it] = await trx('mill_items').insert({
          code, name: `Katta ${size}kg`, category: 'packaging', unit: 'pcs',
          capacity_kg: size, reorder_level: 0, is_active: true,
          notes: 'Auto-managed: empty bags freed from milled raw, consumed to pack output.',
          created_by: userId || null,
        }).returning('*');
      }
      let st = await trx('mill_stock').where({ item_id: it.id, warehouse_id: null }).first();
      if (!st) [st] = await trx('mill_stock').insert({ item_id: it.id, warehouse_id: null, quantity_available: 0, quantity_reserved: 0 }).returning('*');
      return { it, st };
    };

    // Reverse the batch's prior katta movements on whatever item(s) they hit.
    const prior = await trx('mill_stock_movements').where({ reference_type: 'batch_katta', reference_id: batchId }).select('item_id', 'quantity');
    const reverseByItem = new Map();
    for (const m of prior) reverseByItem.set(m.item_id, (reverseByItem.get(m.item_id) || 0) + num(m.quantity));
    for (const [itemId, q] of reverseByItem) {
      await trx('mill_stock').where({ item_id: itemId, warehouse_id: null }).update({ quantity_available: trx.raw('quantity_available - ?', [q]), updated_at: trx.fn.now() });
    }
    await trx('mill_stock_movements').where({ reference_type: 'batch_katta', reference_id: batchId }).del();

    const outLots = await trx('inventory_lots').where({ batch_ref: `batch-${batchId}` }).whereIn('type', ['finished', 'byproduct']);

    if (!exportPack) {
      // ── Standard path (unchanged): pack all outputs into the predominant size. ──
      // Output katta = Σ ceil(output kg ÷ predominant size); stamp count + size on lots.
      let packed = 0;
      for (const l of outLots) {
        const kg = num(l.net_weight_kg) > 0 ? num(l.net_weight_kg) : num(l.qty);
        const bags = Math.ceil(kg / predSize);
        packed += bags;
        await trx('inventory_lots').where('id', l.id).update({ total_bags: bags, bag_size_kg: predSize, updated_at: trx.fn.now() });
      }

      // Apply per size: +freed (return); the predominant size also -packed (consumption).
      const movements = [];
      for (const [size, bags] of bySize) {
        const { it, st } = await itemForSize(size);
        const consume = size === predSize ? packed : 0;
        // Clamp at 0: on a mixed-size intake the predominant size can pack MORE
        // output bags than it freed (bags − consume < 0), which would drive its
        // stock negative. Never let mill_stock go below zero.
        await trx('mill_stock').where({ id: st.id }).update({ quantity_available: trx.raw('GREATEST(quantity_available + ?, 0)', [bags - consume]), updated_at: trx.fn.now() });
        movements.push({ item_id: it.id, warehouse_id: null, movement_type: 'return', quantity: bags, reference_type: 'batch_katta', reference_id: batchId, reason: `Empty ${size}kg katta freed from milled raw (batch ${batchId})`, performed_by: userId || null });
        if (consume > 0) movements.push({ item_id: it.id, warehouse_id: null, movement_type: 'consumption', quantity: -consume, reference_type: 'batch_katta', reference_id: batchId, reason: `${size}kg katta used to pack outputs (batch ${batchId})`, performed_by: userId || null });
      }
      await trx('mill_stock_movements').insert(movements);

      return { capacityKg: predSize, rawBags: freed, freed, outputBags: packed, packed, net: freed - packed, sizes: [...bySize.keys()], shortages: [] };
    }

    // ── Export path: FINISHED rice packs into the customer's spec; byproducts keep
    //    the predominant raw size. Freed raw katta returns to its own size (below);
    //    the export packing consumes a possibly-different item, so it can run short
    //    (the mill must purchase those bags) — pack anyway + flag + notify.
    const consumeBySize = new Map(); // pack size → bags needed
    let packed = 0;
    for (const l of outLots) {
      const kg = num(l.net_weight_kg) > 0 ? num(l.net_weight_kg) : num(l.qty);
      if (l.type === 'finished' && exportPack.packSize == null) {
        // Container / bulk — finished rice ships loose, no bagging.
        await trx('inventory_lots').where('id', l.id).update({ total_bags: 0, bag_size_kg: null, updated_at: trx.fn.now() });
        continue;
      }
      const size = l.type === 'finished' ? exportPack.packSize : predSize;
      const bags = Math.ceil(kg / size);
      packed += bags;
      consumeBySize.set(size, (consumeBySize.get(size) || 0) + bags);
      await trx('inventory_lots').where('id', l.id).update({ total_bags: bags, bag_size_kg: size, updated_at: trx.fn.now() });
    }

    const movements = [];
    // 1) Return freed raw katta to its own size's stock.
    for (const [size, bags] of bySize) {
      const { it, st } = await itemForSize(size);
      await trx('mill_stock').where({ id: st.id }).update({ quantity_available: trx.raw('quantity_available + ?', [bags]), updated_at: trx.fn.now() });
      movements.push({ item_id: it.id, warehouse_id: null, movement_type: 'return', quantity: bags, reference_type: 'batch_katta', reference_id: batchId, reason: `Empty ${size}kg katta freed from milled raw (batch ${batchId})`, performed_by: userId || null });
    }
    // 2) Consume the packing item for each output size; short-tolerant + flag.
    const shortages = [];
    for (const [size, need] of consumeBySize) {
      const { it, st } = await itemForSize(size);
      const cur = await trx('mill_stock').where({ id: st.id }).first('quantity_available');
      const avail = num(cur && cur.quantity_available);
      const consumed = Math.min(need, avail);
      if (consumed > 0) {
        await trx('mill_stock').where({ id: st.id }).update({ quantity_available: trx.raw('GREATEST(quantity_available - ?, 0)', [consumed]), updated_at: trx.fn.now() });
        movements.push({ item_id: it.id, warehouse_id: null, movement_type: 'consumption', quantity: -consumed, reference_type: 'batch_katta', reference_id: batchId, reason: `${size}kg bags used to pack export outputs (batch ${batchId})`, performed_by: userId || null });
      }
      const short = Math.max(0, need - avail);
      if (short > 0) shortages.push({ size, item: it.name, needed: need, available: avail, short });
    }
    await trx('mill_stock_movements').insert(movements);

    return { capacityKg: exportPack.packSize || predSize, rawBags: freed, freed, outputBags: packed, packed, net: freed - packed, sizes: [...bySize.keys()], shortages, exportPacked: true, orderNo: exportPack.orderNo };
  },

  /**
   * Re-sync a yielded batch's OUTPUT lots to its current quantity fields.
   * Editing yield on an already-completed batch updates the batch `_mt` summary
   * columns but historically left the output lots untouched, so they drifted
   * (e.g. batch says 67 MT finished while the lot still holds 32). This deletes
   * the existing output lots and recreates them from the batch's (just-updated)
   * quantities via the SAME recordMillingOutput used at first yield — so lots,
   * grades and residual costs all match. It touches ONLY the output side: raw
   * consumption and accounting journals already happened and are left alone.
   *
   * Refuses (409) if any output lot has been reserved, sold or re-milled — you
   * can't silently resize stock that has already moved.
   */
  async resyncBatchOutputsFromBatch(trx, batchId, { userId } = {}) {
    const p = (v) => parseFloat(v) || 0;
    const batch = await trx('milling_batches').where({ id: batchId }).first();
    if (!batch) { const e = new Error('Milling batch not found.'); e.status = 404; throw e; }

    const finished = p(batch.actual_finished_kg);
    const b1 = p(batch.b1_kg), b2 = p(batch.b2_kg), b3 = p(batch.b3_kg), csr = p(batch.csr_kg), shortGrain = p(batch.short_grain_kg);
    const broken = (b1 + b2 + b3 + csr + shortGrain) || p(batch.broken_kg);
    const bran = p(batch.bran_kg), husk = p(batch.husk_kg), sortex = p(batch.sortex_rejects_kg);
    const powder = p(batch.powder_kg), sweeping = p(batch.sweeping_kg), choba = p(batch.choba_kg);

    // 1. Existing output lots + safety: must be untouched (not reserved/sold/consumed).
    const outLots = await trx('inventory_lots')
      .where({ batch_ref: `batch-${batchId}` }).whereIn('type', ['finished', 'byproduct'])
      .select('id', 'reserved_qty', 'sold_weight_kg');
    const outIds = outLots.map((l) => l.id);
    if (outIds.length) {
      const cnt = async (t) => parseInt((await trx(t).whereIn('lot_id', outIds).count('id as c').first()).c, 10) || 0;
      const touched = outLots.some((l) => p(l.reserved_qty) > 0 || p(l.sold_weight_kg) > 0);
      const refd = (await cnt('inventory_reservations')) + (await cnt('local_sales')) + (await cnt('batch_source_lots'));
      if (touched || refd > 0) {
        const e = new Error('This batch\'s output has already been reserved, sold or re-milled, so its yield can\'t be re-recorded. Reverse those movements first, or use a stock adjustment.');
        e.status = 409; throw e;
      }
      // 2. Delete output lots + their ledger/lineage (raw lots stay consumed).
      await trx('lot_source_mapping').where((q) => q.whereIn('parent_lot_id', outIds).orWhereIn('child_lot_id', outIds)).del();
      await trx('lot_transactions').whereIn('lot_id', outIds).del();
      await trx('stock_adjustments').whereIn('lot_id', outIds).del();
      await trx('stock_count_items').whereIn('lot_id', outIds).del();
      await trx('inventory_lots').whereIn('id', outIds).del();
    }

    // 3. Residual allocation from the batch's current state (same as fresh yield).
    await inventoryService.ensureRawCostFromSourceLots(trx, batchId);
    const rawCostTotal = p((await trx('milling_costs').where({ batch_id: batchId }).where('category', 'raw_rice').sum('amount as t').first())?.t);
    const processingCosts = p((await trx('milling_costs').where({ batch_id: batchId }).whereNotIn('category', ['raw_rice', 'packaging']).sum('amount as t').first())?.t);
    const packingCost = p((await trx('milling_costs').where({ batch_id: batchId, category: 'packaging' }).sum('amount as t').first())?.t);
    const a = inventoryService.computeResidualAllocation(batch, rawCostTotal, processingCosts, packingCost);
    const alloc = {};
    for (const [k, perKg] of Object.entries(a.byCostPerKg)) alloc[k] = perKg;

    await trx('milling_batches').where({ id: batchId }).update({
      raw_cost_total: rawCostTotal,
      raw_cost_per_kg_finished: a.finishedCostPerKg * a.rawFrac,
      milling_cost_per_kg_finished: a.finishedCostPerKg * a.millFrac,
      total_cost_per_kg_finished: a.finishedCostPerKg,
      finished_price_per_kg: a.finishedCostPerKg,
    });

    // 4. Recreate output lots (finished + by-products) with the allocated costs.
    const batchProduct = batch.product_id
      ? await trx('products').where('id', batch.product_id).select('name').first() : null;
    const riceTypeName = batchProduct?.name || null;
    const arrivalQuality = await trx('milling_quality_samples').where({ batch_id: batchId, analysis_type: 'arrival' }).first();
    await inventoryService.recordMillingOutput(trx, {
      batchId, finishedKg: finished, brokenKg: broken, branKg: bran, huskKg: husk,
      sortexKg: sortex, powderKg: powder, sweepingKg: sweeping, chobaKg: choba,
      productName: riceTypeName || 'Finished Rice', costPerKg: a.finishedCostPerKg,
      rawCostComponent: a.finishedCostPerKg * a.rawFrac, millingCostComponent: a.finishedCostPerKg * a.millFrac,
      byproductCosts: {
        broken: alloc.broken || 0, b1: alloc.b1 || 0, b2: alloc.b2 || 0, b3: alloc.b3 || 0,
        csr: alloc.csr || 0, short_grain: alloc.short_grain || 0, bran: alloc.bran || 0,
        husk: alloc.husk || 0, sortex: alloc.sortex || 0, powder: alloc.powder || 0, sweeping: alloc.sweeping || 0,
        choba: alloc.choba || 0,
      },
      brokenGrades: { b1, b2, b3, csr, shortGrain },
      userId, supplierInfo: { supplierId: batch.supplier_id },
      qualityInfo: arrivalQuality ? {
        variety: riceTypeName, grade: batch.post_milling_grade || null,
        moisture: arrivalQuality.moisture ? parseFloat(arrivalQuality.moisture) : null,
        broken: arrivalQuality.broken ? parseFloat(arrivalQuality.broken) : null,
      } : null,
    });

    // Re-account katta (freed from raw / consumed packing the new outputs).
    const katta = await inventoryService.reconcileBatchKatta(trx, batchId, userId);

    return { resynced: true, recreatedFrom: outIds.length, finishedCostPerKg: a.finishedCostPerKg, netPurchase: a.netPurchase, byproductValue: a.byproductValue, katta };
  },
};

module.exports = inventoryService;
