/**
 * RiceFlow ERP — Data Transformers
 * Convert between backend snake_case and frontend camelCase.
 * Also maps backend field names to frontend expected names.
 */

// Generic snake_case to camelCase
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function transformKeys(obj) {
  if (Array.isArray(obj)) return obj.map(transformKeys);
  if (obj === null || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[snakeToCamel(key)] = transformKeys(value);
  }
  return result;
}

// Generic camelCase to snake_case (for sending to API)
function camelToSnake(str) {
  return str.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase());
}

export function toSnakeCase(obj) {
  if (Array.isArray(obj)) return obj.map(toSnakeCase);
  if (obj === null || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[camelToSnake(key)] = toSnakeCase(value);
  }
  return result;
}

// Map doc_type labels from DB to frontend keys
const docTypeKeyMap = {
  'Phytosanitary Certificate': 'phyto',
  'phyto': 'phyto',
  'BL Draft': 'blDraft',
  'bl_draft': 'blDraft',
  'BL Final': 'blFinal',
  'bl_final': 'blFinal',
  'Commercial Invoice': 'invoice',
  'commercial_invoice': 'invoice',
  'Packing List': 'packingList',
  'packing_list': 'packingList',
  'Certificate of Origin': 'coo',
  'coo': 'coo',
  'Fumigation Certificate': 'fumigation',
  'fumigation': 'fumigation',
};

/** Convert costs from API array format to frontend keyed object format */
function transformCosts(costs) {
  if (!costs) return {};
  if (!Array.isArray(costs)) return costs;
  const result = {};
  costs.forEach(c => {
    const key = c.category || c.cost_category || '';
    if (key) result[key] = parseFloat(c.amount) || 0;
  });
  return result;
}

/** Convert documents from API array format to frontend keyed object format */
function transformDocuments(docs) {
  if (!docs) return {};
  // Already an object (mock format) — return as-is
  if (!Array.isArray(docs)) return docs;
  // Empty array — return default pending docs
  if (docs.length === 0) return {};
  // Convert array to keyed object
  const result = {};
  docs.forEach(doc => {
    const key = docTypeKeyMap[doc.doc_type] || docTypeKeyMap[doc.docType] || (doc.doc_type || '').toLowerCase().replace(/\s+/g, '');
    if (key) {
      result[key] = {
        status: doc.status || 'Pending',
        uploadedBy: doc.uploaded_by || doc.uploadedBy || null,
        date: doc.upload_date || doc.date || null,
        version: doc.version || null,
        filePath: doc.file_path || null,
        notes: doc.notes || null,
      };
    }
  });
  return result;
}

// === Export Order transform ===
export function transformOrder(dbOrder) {
  if (!dbOrder) return null;
  return {
    id: dbOrder.order_no || dbOrder.id,
    dbId: dbOrder.id,
    customerId: dbOrder.customer_id,
    customerName: dbOrder.customer_name || '',
    country: dbOrder.customer_country || dbOrder.country || '',
    productId: dbOrder.product_id,
    productName: dbOrder.product_name || '',
    qtyMT: parseFloat(dbOrder.qty_mt) || 0,
    pricePerMT: parseFloat(dbOrder.price_per_mt) || 0,
    currency: dbOrder.currency || 'USD',
    contractValue: parseFloat(dbOrder.contract_value) || 0,
    incoterm: dbOrder.incoterm || '',
    advancePct: parseFloat(dbOrder.advance_pct) || 20,
    advanceExpected: parseFloat(dbOrder.advance_expected) || 0,
    advanceReceived: parseFloat(dbOrder.advance_received) || 0,
    advanceDate: dbOrder.advance_date,
    balanceExpected: parseFloat(dbOrder.balance_expected) || 0,
    balanceReceived: parseFloat(dbOrder.balance_received) || 0,
    balanceDate: dbOrder.balance_date,
    status: dbOrder.status || 'Draft',
    currentStep: dbOrder.current_step || 1,
    shipmentETA: dbOrder.shipment_eta,
    millingOrderId: dbOrder.milling_order_id,
    source: dbOrder.source || 'Internal Mill',
    vesselName: dbOrder.vessel_name,
    bookingNo: dbOrder.booking_no,
    containerNo: dbOrder.container_no || '',
    blNumber: dbOrder.bl_number || '',
    shippingLine: dbOrder.shipping_line || '',
    etd: dbOrder.etd,
    atd: dbOrder.atd,
    eta: dbOrder.eta,
    ata: dbOrder.ata,
    destinationPort: dbOrder.destination_port || '',
    createdAt: dbOrder.created_at,
    notes: dbOrder.notes,
    // Bag specification
    bagType: dbOrder.bag_type || '',
    bagQuality: dbOrder.bag_quality || '',
    bagSizeKg: dbOrder.bag_size_kg ? parseFloat(dbOrder.bag_size_kg) : null,
    bagWeightGm: dbOrder.bag_weight_gm ? parseFloat(dbOrder.bag_weight_gm) : null,
    bagPrinting: dbOrder.bag_printing || '',
    bagColor: dbOrder.bag_color || '',
    bagBrand: dbOrder.bag_brand || '',
    unitsPerBag: dbOrder.units_per_bag ? parseInt(dbOrder.units_per_bag) : null,
    bagNotes: dbOrder.bag_notes || '',
    // Packing / receiving mode
    receivingMode: dbOrder.receiving_mode || '',
    quantityUnit: dbOrder.quantity_unit || '',
    quantityInputValue: dbOrder.quantity_input_value ? parseFloat(dbOrder.quantity_input_value) : null,
    totalBags: dbOrder.total_bags ? parseInt(dbOrder.total_bags) : null,
    totalLooseWeightKg: dbOrder.total_loose_weight_kg ? parseFloat(dbOrder.total_loose_weight_kg) : null,
    packingNotes: dbOrder.packing_notes || '',
    packingLines: dbOrder.packingLines || dbOrder.packing_lines || [],
    // Purchase lots allocated to this order
    purchaseLots: dbOrder.purchaseLots || [],
    // Costs — convert array to keyed object if needed
    costs: transformCosts(dbOrder.costs),
    // Documents — convert array to keyed object if needed
    documents: transformDocuments(dbOrder.documents),
    // Activity log
    activityLog: dbOrder.activityLog || dbOrder.status_history || [],
  };
}

export function transformOrders(dbOrders) {
  return (dbOrders || []).map(transformOrder);
}

// === Milling Batch transform ===
export function transformBatch(dbBatch) {
  if (!dbBatch) return null;
  return {
    id: dbBatch.batch_no || dbBatch.id,
    dbId: dbBatch.id,
    linkedExportOrder: dbBatch.linked_export_order_id,
    status: dbBatch.status || 'Queued',
    rawQtyMT: parseFloat(dbBatch.raw_qty_mt) || 0,
    plannedFinishedMT: parseFloat(dbBatch.planned_finished_mt) || 0,
    actualFinishedMT: parseFloat(dbBatch.actual_finished_mt) || 0,
    brokenMT: parseFloat(dbBatch.broken_mt) || 0,
    branMT: parseFloat(dbBatch.bran_mt) || 0,
    huskMT: parseFloat(dbBatch.husk_mt) || 0,
    wastageMT: parseFloat(dbBatch.wastage_mt) || 0,
    yieldPct: parseFloat(dbBatch.yield_pct) || 0,
    supplierId: dbBatch.supplier_id,
    supplierName: dbBatch.supplier_name || '',
    createdAt: dbBatch.created_at,
    completedAt: dbBatch.completed_at,
    costs: dbBatch.costs || {},
    sampleAnalysis: dbBatch.sampleAnalysis || null,
    arrivalAnalysis: dbBatch.arrivalAnalysis || null,
    variancePct: dbBatch.variance_pct != null ? parseFloat(dbBatch.variance_pct) : null,
    varianceStatus: dbBatch.variance_status || null,
    vehicleArrivals: dbBatch.vehicleArrivals || [],
    millId: dbBatch.mill_id,
    machineLine: dbBatch.machine_line,
    shift: dbBatch.shift,
  };
}

export function transformBatches(dbBatches) {
  return (dbBatches || []).map(transformBatch);
}

// === Customer transform ===
export function transformCustomer(db) {
  return {
    id: db.id,
    name: db.name,
    contact: db.contact_person || '',
    email: db.email || '',
    phone: db.phone || '',
    country: db.country || '',
    address: db.address || '',
  };
}

// === Supplier transform ===
export function transformSupplier(db) {
  return {
    id: db.id,
    name: db.name,
    contact: db.contact_person || '',
    email: db.email || '',
    phone: db.phone || '',
    country: db.country || '',
    address: db.address || '',
    type: db.type || 'Paddy Supplier',
    location: db.address || db.country || '',
  };
}

// === Product transform ===
export function transformProduct(db) {
  return {
    id: db.id,
    name: db.name,
    code: db.code || '',
    grade: db.grade || '',
    category: db.category || 'Rice',
    description: db.description || '',
    isByproduct: db.is_byproduct || false,
  };
}

// === Bank Account transform ===
export function transformBankAccount(db) {
  return {
    id: db.id,
    uid: db.uid || '',
    name: db.name,
    type: db.type || 'bank',
    accountNumber: db.account_number || '',
    bankName: db.bank_name || '',
    branch: db.branch || '',
    currency: db.currency || 'PKR',
    currentBalance: parseFloat(db.current_balance) || 0,
  };
}

export default {
  transformOrder, transformOrders,
  transformBatch, transformBatches,
  transformCustomer, transformSupplier, transformProduct, transformBankAccount,
  transformKeys, toSnakeCase,
};
