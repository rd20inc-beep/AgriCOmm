/**
 * Seed: Procurement & Purchase Management
 * Sample data for purchase requisitions, POs, GRNs, invoices.
 * Uses realistic Pakistani rice procurement figures.
 */

exports.seed = async function (knex) {
  // Clear in reverse-dependency order
  await knex('purchase_returns').del();
  await knex('supplier_invoices').del();
  await knex('goods_receipt_notes').del();
  await knex('purchase_orders').del();
  await knex('purchase_requisitions').del();

  // Look up referenced entities
  const suppliers = await knex('suppliers').select('id', 'name').limit(5);
  const products = await knex('products').select('id', 'name').limit(5);
  const batches = await knex('milling_batches').select('id', 'batch_no').limit(5);
  const exportOrders = await knex('export_orders').select('id', 'order_no').limit(3);
  const users = await knex('users').select('id', 'full_name').limit(3);
  const warehouses = await knex('warehouses').select('id', 'name').where({ entity: 'mill' }).limit(1);

  const supplierId1 = suppliers[0] ? suppliers[0].id : 1;
  const supplierId2 = suppliers[1] ? suppliers[1].id : 2;
  const supplierId3 = suppliers[2] ? suppliers[2].id : 3;
  const productId1 = products[0] ? products[0].id : 1;
  const productId2 = products[1] ? products[1].id : 2;
  const batchId1 = batches[0] ? batches[0].id : null;
  const batchId2 = batches[1] ? batches[1].id : null;
  const batchId3 = batches[2] ? batches[2].id : null;
  const exportOrderId1 = exportOrders[0] ? exportOrders[0].id : null;
  const userId1 = users[0] ? users[0].id : 1;
  const userId2 = users[1] ? users[1].id : userId1;
  const warehouseId = warehouses[0] ? warehouses[0].id : null;

  // =========================================================================
  // Purchase Requisitions
  // =========================================================================

  const [req1] = await knex('purchase_requisitions')
    .insert({
      req_no: 'PR-001',
      entity: 'mill',
      requested_by: userId1,
      product_id: productId1,
      product_name: products[0] ? products[0].name : 'IRRI-6 Long Grain White Rice',
      qty_mt: 65,
      required_by_date: '2026-02-15',
      linked_export_order_id: exportOrderId1,
      linked_batch_id: batchId1,
      priority: 'Urgent',
      status: 'Approved',
      notes: 'Urgent requirement for EX-101 shipment. Need premium quality paddy.',
      approved_by: userId2,
      approved_at: '2026-01-20 10:30:00',
      created_at: '2026-01-18',
      updated_at: '2026-01-20',
    })
    .returning('id');
  const reqId1 = typeof req1 === 'object' ? req1.id : req1;

  const [req2] = await knex('purchase_requisitions')
    .insert({
      req_no: 'PR-002',
      entity: 'mill',
      requested_by: userId1,
      product_id: productId2,
      product_name: products[1] ? products[1].name : 'Super Basmati Rice',
      qty_mt: 130,
      required_by_date: '2026-03-01',
      linked_export_order_id: null,
      linked_batch_id: batchId2,
      priority: 'Normal',
      status: 'Submitted',
      notes: 'Regular procurement for Basmati milling batch M-202.',
      created_at: '2026-02-05',
      updated_at: '2026-02-05',
    })
    .returning('id');
  const reqId2 = typeof req2 === 'object' ? req2.id : req2;

  await knex('purchase_requisitions').insert({
    req_no: 'PR-003',
    entity: 'mill',
    requested_by: userId1,
    product_id: productId1,
    product_name: products[0] ? products[0].name : 'IRRI-6 Long Grain White Rice',
    qty_mt: 45,
    required_by_date: '2026-04-01',
    linked_export_order_id: null,
    linked_batch_id: null,
    priority: 'Low',
    status: 'Draft',
    notes: 'Tentative procurement for next quarter stock build.',
    created_at: '2026-03-10',
    updated_at: '2026-03-10',
  });

  // =========================================================================
  // Purchase Orders
  // =========================================================================

  const [po1] = await knex('purchase_orders')
    .insert({
      po_no: 'PO-001',
      requisition_id: reqId1,
      supplier_id: supplierId1,
      entity: 'mill',
      product_id: productId1,
      product_name: products[0] ? products[0].name : 'IRRI-6 Long Grain White Rice',
      qty_mt: 65,
      price_per_mt: 78000,
      currency: 'PKR',
      total_amount: 5070000,
      transport_terms: 'Delivered',
      delivery_date: '2026-02-10',
      payment_terms: 'Net 30',
      moisture_expected: 13.0,
      broken_expected: 4.0,
      status: 'Fully Received',
      linked_batch_id: batchId1,
      notes: 'Premium IRRI-6 paddy from Larkana. Delivered to mill gate.',
      created_by: userId1,
      created_at: '2026-01-22',
      updated_at: '2026-02-12',
    })
    .returning('id');
  const poId1 = typeof po1 === 'object' ? po1.id : po1;

  const [po2] = await knex('purchase_orders')
    .insert({
      po_no: 'PO-002',
      requisition_id: null,
      supplier_id: supplierId2,
      entity: 'mill',
      product_id: productId2,
      product_name: products[1] ? products[1].name : 'Super Basmati Rice',
      qty_mt: 130,
      price_per_mt: 88000,
      currency: 'PKR',
      total_amount: 11440000,
      transport_terms: 'Ex-Mill',
      delivery_date: '2026-02-28',
      payment_terms: 'Advance',
      moisture_expected: 12.5,
      broken_expected: 5.0,
      status: 'Partially Received',
      linked_batch_id: batchId2,
      notes: 'Super Basmati paddy from Gujranwala. Supplier arranges transport to Karachi mill.',
      created_by: userId1,
      created_at: '2026-02-01',
      updated_at: '2026-02-25',
    })
    .returning('id');
  const poId2 = typeof po2 === 'object' ? po2.id : po2;

  const [po3] = await knex('purchase_orders')
    .insert({
      po_no: 'PO-003',
      requisition_id: null,
      supplier_id: supplierId3,
      entity: 'mill',
      product_id: productId1,
      product_name: products[0] ? products[0].name : 'IRRI-6 Long Grain White Rice',
      qty_mt: 98,
      price_per_mt: 72000,
      currency: 'PKR',
      total_amount: 7056000,
      transport_terms: 'FOB',
      delivery_date: '2026-03-15',
      payment_terms: 'On Delivery',
      moisture_expected: 13.5,
      broken_expected: 6.0,
      status: 'Draft',
      linked_batch_id: batchId3,
      notes: 'Draft PO pending supplier confirmation. Sindh region paddy.',
      created_by: userId1,
      created_at: '2026-03-05',
      updated_at: '2026-03-05',
    })
    .returning('id');
  const poId3 = typeof po3 === 'object' ? po3.id : po3;

  // =========================================================================
  // Goods Receipt Notes — 4 GRNs
  // =========================================================================

  // GRN-001 & GRN-002: linked to PO-001 (Fully Received)
  await knex('goods_receipt_notes').insert({
    grn_no: 'GRN-001',
    po_id: poId1,
    supplier_id: supplierId1,
    batch_id: batchId1,
    warehouse_id: warehouseId,
    receipt_date: '2026-02-05',
    vehicle_no: 'SND-4521',
    driver_name: 'Muhammad Aslam',
    driver_phone: '0300-1234567',
    gross_weight_mt: 38.50,
    tare_weight_mt: 5.20,
    net_weight_mt: 33.30,
    accepted_qty_mt: 33.00,
    rejected_qty_mt: 0.30,
    rejection_reason: 'Minor foreign matter; 0.3 MT deducted',
    quality_status: 'Approved',
    moisture_actual: 13.2,
    broken_actual: 4.1,
    price_per_mt: 78000,
    total_value: 2574000,
    currency: 'PKR',
    status: 'Posted',
    received_by: userId1,
    inspected_by: userId2,
    created_at: '2026-02-05',
    updated_at: '2026-02-05',
  });

  await knex('goods_receipt_notes').insert({
    grn_no: 'GRN-002',
    po_id: poId1,
    supplier_id: supplierId1,
    batch_id: batchId1,
    warehouse_id: warehouseId,
    receipt_date: '2026-02-10',
    vehicle_no: 'SND-7843',
    driver_name: 'Ghulam Hussain',
    driver_phone: '0301-9876543',
    gross_weight_mt: 37.80,
    tare_weight_mt: 5.80,
    net_weight_mt: 32.00,
    accepted_qty_mt: 32.00,
    rejected_qty_mt: 0,
    quality_status: 'Approved',
    moisture_actual: 12.9,
    broken_actual: 3.8,
    price_per_mt: 78000,
    total_value: 2496000,
    currency: 'PKR',
    status: 'Posted',
    received_by: userId1,
    inspected_by: userId2,
    created_at: '2026-02-10',
    updated_at: '2026-02-10',
  });

  // GRN-003: linked to PO-002 (Partially Received — 80 of 130 MT)
  const [grn3] = await knex('goods_receipt_notes')
    .insert({
      grn_no: 'GRN-003',
      po_id: poId2,
      supplier_id: supplierId2,
      batch_id: batchId2,
      warehouse_id: warehouseId,
      receipt_date: '2026-02-20',
      vehicle_no: 'PBN-2290',
      driver_name: 'Rashid Ahmed',
      driver_phone: '0321-5556789',
      gross_weight_mt: 86.20,
      tare_weight_mt: 6.20,
      net_weight_mt: 80.00,
      accepted_qty_mt: 79.50,
      rejected_qty_mt: 0.50,
      rejection_reason: 'Excess moisture in 0.5 MT portion',
      quality_status: 'Conditional',
      moisture_actual: 13.1,
      broken_actual: 5.3,
      price_per_mt: 88000,
      total_value: 6996000,
      currency: 'PKR',
      status: 'Posted',
      received_by: userId1,
      inspected_by: userId2,
      created_at: '2026-02-20',
      updated_at: '2026-02-20',
    })
    .returning('id');
  const grnId3 = typeof grn3 === 'object' ? grn3.id : grn3;

  // GRN-004: linked to PO-002 (second delivery, still pending quality)
  await knex('goods_receipt_notes').insert({
    grn_no: 'GRN-004',
    po_id: poId2,
    supplier_id: supplierId2,
    batch_id: batchId2,
    warehouse_id: warehouseId,
    receipt_date: '2026-03-01',
    vehicle_no: 'PBN-3351',
    driver_name: 'Zahid Mehmood',
    driver_phone: '0333-4445566',
    gross_weight_mt: 32.50,
    tare_weight_mt: 5.50,
    net_weight_mt: 27.00,
    accepted_qty_mt: 27.00,
    rejected_qty_mt: 0,
    quality_status: 'Pending',
    moisture_actual: 12.8,
    broken_actual: 4.9,
    price_per_mt: 88000,
    total_value: 2376000,
    currency: 'PKR',
    status: 'Posted',
    received_by: userId1,
    created_at: '2026-03-01',
    updated_at: '2026-03-01',
  });

  // =========================================================================
  // Supplier Invoices — 2 invoices
  // =========================================================================

  // Invoice 1: Paid — for PO-001 full delivery
  await knex('supplier_invoices').insert({
    invoice_no: 'SI-2026-0041',
    supplier_id: supplierId1,
    po_id: poId1,
    grn_id: null,
    invoice_date: '2026-02-12',
    due_date: '2026-03-14',
    gross_amount: 5070000,
    deductions: 23400,
    net_amount: 5046600,
    currency: 'PKR',
    status: 'Paid',
    approved_by: userId2,
    notes: 'Full payment against PO-001. Deduction of Rs 23,400 for 0.3 MT rejection at GRN-001.',
    created_by: userId1,
    created_at: '2026-02-12',
    updated_at: '2026-03-10',
  });

  // Invoice 2: Pending — for PO-002 partial delivery (GRN-003)
  await knex('supplier_invoices').insert({
    invoice_no: 'SI-2026-0058',
    supplier_id: supplierId2,
    po_id: poId2,
    grn_id: grnId3,
    invoice_date: '2026-02-25',
    due_date: '2026-03-27',
    gross_amount: 6996000,
    deductions: 44000,
    net_amount: 6952000,
    currency: 'PKR',
    status: 'Pending',
    notes: 'Partial invoice for 79.5 MT received via GRN-003. Deduction Rs 44,000 for moisture excess.',
    created_by: userId1,
    created_at: '2026-02-25',
    updated_at: '2026-02-25',
  });
};
