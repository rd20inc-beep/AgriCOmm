/**
 * Seed: Document Management — Templates, Documents, Checklists, Approvals, Dispatch Logs
 */

exports.seed = async function (knex) {
  // Clear in reverse-dependency order
  await knex('document_dispatch_log').del();
  await knex('document_approvals').del();
  await knex('document_checklists').where('linked_id', '>', 0).del();
  await knex('document_store').del();
  await knex('document_templates').del();

  // ============================================================
  // 1. Document Templates (5)
  // ============================================================
  const templates = [
    {
      name: 'Proforma Invoice Template',
      doc_type: 'proforma_invoice',
      entity: 'export',
      template_content: `<html><body>
<h1>PROFORMA INVOICE</h1>
<p>Invoice No: {{invoice_no}}</p>
<p>Date: {{date}}</p>
<p>Customer: {{customer_name}}</p>
<p>Product: {{product_name}}</p>
<p>Quantity: {{qty_mt}} MT</p>
<p>Price/MT: {{currency}} {{price_per_mt}}</p>
<p>Total: {{currency}} {{total_value}}</p>
<p>Incoterm: {{incoterm}}</p>
<p>Destination: {{destination_port}}</p>
</body></html>`,
      variables: JSON.stringify([
        'invoice_no', 'date', 'customer_name', 'product_name',
        'qty_mt', 'currency', 'price_per_mt', 'total_value',
        'incoterm', 'destination_port',
      ]),
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Commercial Invoice Template',
      doc_type: 'commercial_invoice',
      entity: 'export',
      template_content: `<html><body>
<h1>COMMERCIAL INVOICE</h1>
<p>Invoice No: {{invoice_no}}</p>
<p>Date: {{date}}</p>
<p>Buyer: {{customer_name}}</p>
<p>Country: {{country}}</p>
<p>Product: {{product_name}}</p>
<p>Quantity: {{qty_mt}} MT</p>
<p>Unit Price: {{currency}} {{price_per_mt}}</p>
<p>Total Value: {{currency}} {{total_value}}</p>
<p>Incoterm: {{incoterm}}</p>
<p>Port of Loading: Karachi, Pakistan</p>
<p>Port of Discharge: {{destination_port}}</p>
<p>Vessel: {{vessel_name}}</p>
</body></html>`,
      variables: JSON.stringify([
        'invoice_no', 'date', 'customer_name', 'country', 'product_name',
        'qty_mt', 'currency', 'price_per_mt', 'total_value',
        'incoterm', 'destination_port', 'vessel_name',
      ]),
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Packing List Template',
      doc_type: 'packing_list',
      entity: 'export',
      template_content: `<html><body>
<h1>PACKING LIST</h1>
<p>Order: {{order_no}}</p>
<p>Customer: {{customer_name}}</p>
<p>Product: {{product_name}}</p>
<p>Net Weight: {{qty_mt}} MT</p>
<p>No. of Bags: {{num_bags}}</p>
<p>Bag Type: {{bag_type}}</p>
<p>Container: {{container_no}}</p>
<p>Vessel: {{vessel_name}}</p>
<p>Booking: {{booking_no}}</p>
</body></html>`,
      variables: JSON.stringify([
        'order_no', 'customer_name', 'product_name', 'qty_mt',
        'num_bags', 'bag_type', 'container_no', 'vessel_name', 'booking_no',
      ]),
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Bill of Lading Template',
      doc_type: 'bl_draft',
      entity: 'export',
      template_content: `<html><body>
<h1>BILL OF LADING (DRAFT)</h1>
<p>BL No: {{bl_no}}</p>
<p>Shipper: RiceFlow Exports</p>
<p>Consignee: {{customer_name}}</p>
<p>Vessel: {{vessel_name}}</p>
<p>Port of Loading: Karachi</p>
<p>Port of Discharge: {{destination_port}}</p>
<p>Description: {{product_name}}</p>
<p>Weight: {{qty_mt}} MT</p>
<p>Number of Packages: {{num_bags}}</p>
</body></html>`,
      variables: JSON.stringify([
        'bl_no', 'customer_name', 'vessel_name', 'destination_port',
        'product_name', 'qty_mt', 'num_bags',
      ]),
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Certificate of Origin Template',
      doc_type: 'coo',
      entity: 'export',
      template_content: `<html><body>
<h1>CERTIFICATE OF ORIGIN</h1>
<p>Certificate No: {{cert_no}}</p>
<p>Exporter: RiceFlow Exports, Pakistan</p>
<p>Consignee: {{customer_name}}</p>
<p>Country of Origin: Pakistan</p>
<p>Country of Destination: {{country}}</p>
<p>Description of Goods: {{product_name}}</p>
<p>Quantity: {{qty_mt}} MT</p>
<p>Invoice No: {{invoice_no}}</p>
</body></html>`,
      variables: JSON.stringify([
        'cert_no', 'customer_name', 'country', 'product_name',
        'qty_mt', 'invoice_no',
      ]),
      is_active: true,
      created_by: 1,
    },
  ];

  await knex('document_templates').insert(templates);

  // ============================================================
  // 2. Fetch export order IDs for EX-101 through EX-103
  // ============================================================
  const order101 = await knex('export_orders').where({ order_no: 'EX-101' }).select('id').first();
  const order102 = await knex('export_orders').where({ order_no: 'EX-102' }).select('id').first();
  const order103 = await knex('export_orders').where({ order_no: 'EX-103' }).select('id').first();

  const orderId101 = order101 ? order101.id : 1;
  const orderId102 = order102 ? order102.id : 2;
  const orderId103 = order103 ? order103.id : 3;

  // ============================================================
  // 3. Sample Documents (10)
  // ============================================================
  const documents = [
    // EX-101 docs (Shipped order — all approved/final)
    {
      doc_uid: 'DOC-20260218-0001',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: orderId101,
      doc_type: 'phyto',
      title: 'Phytosanitary Certificate - EX-101',
      description: 'Phyto cert for UAE shipment',
      file_name: 'phyto-ex101.pdf',
      file_path: null,
      file_size: 245000,
      mime_type: 'application/pdf',
      version: 1,
      is_latest: true,
      previous_version_id: null,
      status: 'Final',
      uploaded_by: 1,
      created_at: '2026-02-18',
    },
    {
      doc_uid: 'DOC-20260220-0002',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: orderId101,
      doc_type: 'commercial_invoice',
      title: 'Commercial Invoice - EX-101',
      description: 'Commercial invoice for UAE shipment',
      file_name: 'invoice-ex101.pdf',
      file_path: null,
      file_size: 180000,
      mime_type: 'application/pdf',
      version: 1,
      is_latest: true,
      previous_version_id: null,
      status: 'Final',
      uploaded_by: 1,
      created_at: '2026-02-20',
    },
    {
      doc_uid: 'DOC-20260222-0003',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: orderId101,
      doc_type: 'packing_list',
      title: 'Packing List - EX-101',
      description: 'Packing list for UAE shipment',
      file_name: 'packing-ex101.pdf',
      file_path: null,
      file_size: 150000,
      mime_type: 'application/pdf',
      version: 1,
      is_latest: true,
      previous_version_id: null,
      status: 'Approved',
      uploaded_by: 1,
      created_at: '2026-02-22',
    },
    {
      doc_uid: 'DOC-20260226-0004',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: orderId101,
      doc_type: 'bl_final',
      title: 'Bill of Lading (Final) - EX-101',
      description: 'Final BL for UAE shipment',
      file_name: 'bl-final-ex101.pdf',
      file_path: null,
      file_size: 320000,
      mime_type: 'application/pdf',
      version: 1,
      is_latest: true,
      previous_version_id: null,
      status: 'Final',
      uploaded_by: 1,
      created_at: '2026-02-26',
    },
    // EX-102 docs (mix of statuses)
    {
      doc_uid: 'DOC-20260301-0005',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: orderId102,
      doc_type: 'phyto',
      title: 'Phytosanitary Certificate - EX-102',
      description: 'Phyto cert for Saudi Arabia shipment',
      file_name: 'phyto-ex102.pdf',
      file_path: null,
      file_size: 230000,
      mime_type: 'application/pdf',
      version: 1,
      is_latest: true,
      previous_version_id: null,
      status: 'Approved',
      uploaded_by: 1,
      created_at: '2026-03-01',
    },
    {
      doc_uid: 'DOC-20260305-0006',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: orderId102,
      doc_type: 'bl_draft',
      title: 'Bill of Lading (Draft) - EX-102',
      description: 'Draft BL for Saudi Arabia shipment',
      file_name: 'bl-draft-ex102.pdf',
      file_path: null,
      file_size: 290000,
      mime_type: 'application/pdf',
      version: 1,
      is_latest: true,
      previous_version_id: null,
      status: 'Pending Review',
      uploaded_by: 1,
      created_at: '2026-03-05',
    },
    {
      doc_uid: 'DOC-20260310-0007',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: orderId102,
      doc_type: 'commercial_invoice',
      title: 'Commercial Invoice - EX-102',
      description: 'Invoice for Saudi Arabia shipment',
      file_name: 'invoice-ex102.pdf',
      file_path: null,
      file_size: 175000,
      mime_type: 'application/pdf',
      version: 1,
      is_latest: true,
      previous_version_id: null,
      status: 'Draft',
      uploaded_by: 1,
      created_at: '2026-03-10',
    },
    // EX-103 docs (Arrived — all approved/final)
    {
      doc_uid: 'DOC-20260220-0008',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: orderId103,
      doc_type: 'phyto',
      title: 'Phytosanitary Certificate - EX-103',
      description: 'Phyto cert for Nigeria shipment',
      file_name: 'phyto-ex103.pdf',
      file_path: null,
      file_size: 255000,
      mime_type: 'application/pdf',
      version: 1,
      is_latest: true,
      previous_version_id: null,
      status: 'Approved',
      uploaded_by: 1,
      created_at: '2026-02-20',
    },
    {
      doc_uid: 'DOC-20260224-0009',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: orderId103,
      doc_type: 'commercial_invoice',
      title: 'Commercial Invoice - EX-103',
      description: 'Invoice for Nigeria shipment',
      file_name: 'invoice-ex103.pdf',
      file_path: null,
      file_size: 195000,
      mime_type: 'application/pdf',
      version: 1,
      is_latest: true,
      previous_version_id: null,
      status: 'Final',
      uploaded_by: 1,
      created_at: '2026-02-24',
    },
    {
      doc_uid: 'DOC-20260301-0010',
      entity: 'export',
      linked_type: 'export_order',
      linked_id: orderId103,
      doc_type: 'bl_final',
      title: 'Bill of Lading (Final) - EX-103',
      description: 'Final BL for Nigeria shipment',
      file_name: 'bl-final-ex103.pdf',
      file_path: null,
      file_size: 340000,
      mime_type: 'application/pdf',
      version: 1,
      is_latest: true,
      previous_version_id: null,
      status: 'Final',
      uploaded_by: 1,
      created_at: '2026-03-01',
    },
  ];

  const insertedDocs = await knex('document_store').insert(documents).returning('*');

  // Build a map for easy lookup: key = doc_uid
  const docMap = {};
  for (const doc of insertedDocs) {
    docMap[doc.doc_uid] = doc;
  }

  // ============================================================
  // 4. Document Checklists for 3 orders
  // ============================================================
  const exportDocTypes = ['phyto', 'bl_draft', 'bl_final', 'commercial_invoice', 'packing_list', 'coo', 'fumigation'];

  const buildChecklist = (orderId, docMap, uidPrefix) => {
    return exportDocTypes.map((docType) => {
      // Find matching document for this order and type
      const matchingDoc = insertedDocs.find(
        (d) => d.linked_id === orderId && d.doc_type === docType && d.is_latest
      );
      return {
        linked_type: 'export_order',
        linked_id: orderId,
        doc_type: docType,
        is_required: true,
        is_fulfilled: matchingDoc ? true : false,
        document_id: matchingDoc ? matchingDoc.id : null,
        due_date: null,
        notes: null,
      };
    });
  };

  const checklists = [
    ...buildChecklist(orderId101, docMap, 'DOC-20260218'),
    ...buildChecklist(orderId102, docMap, 'DOC-20260301'),
    ...buildChecklist(orderId103, docMap, 'DOC-20260220'),
  ];

  await knex('document_checklists').insert(checklists);

  // ============================================================
  // 5. Approval Records (3)
  // ============================================================
  const doc1 = docMap['DOC-20260218-0001']; // phyto EX-101 Final
  const doc5 = docMap['DOC-20260301-0005']; // phyto EX-102 Approved
  const doc8 = docMap['DOC-20260220-0008']; // phyto EX-103 Approved

  const approvals = [
    {
      document_id: doc1.id,
      approver_id: 1,
      action: 'approve',
      comments: 'Phyto certificate verified and approved for EX-101',
      created_at: '2026-02-19T10:00:00Z',
    },
    {
      document_id: doc5.id,
      approver_id: 1,
      action: 'approve',
      comments: 'Phyto certificate approved for EX-102 Saudi Arabia shipment',
      created_at: '2026-03-02T14:30:00Z',
    },
    {
      document_id: doc8.id,
      approver_id: 1,
      action: 'approve',
      comments: 'Phyto certificate approved for EX-103 Nigeria shipment',
      created_at: '2026-02-21T09:15:00Z',
    },
  ];

  await knex('document_approvals').insert(approvals);

  // ============================================================
  // 6. Dispatch Log Entries (2)
  // ============================================================
  const doc4 = docMap['DOC-20260226-0004']; // BL Final EX-101
  const doc10 = docMap['DOC-20260301-0010']; // BL Final EX-103

  const dispatchLogs = [
    {
      document_id: doc4.id,
      dispatched_to: 'buyer@uaeimports.com',
      dispatch_method: 'email',
      dispatch_date: '2026-02-27T08:00:00Z',
      tracking_ref: null,
      status: 'Delivered',
      notes: 'Final BL sent to UAE buyer via email',
      dispatched_by: 1,
    },
    {
      document_id: doc10.id,
      dispatched_to: 'Lagos Import Agency',
      dispatch_method: 'courier',
      dispatch_date: '2026-03-02T10:30:00Z',
      tracking_ref: 'DHL-NG-20260302-4821',
      status: 'Delivered',
      notes: 'Original BL sent via DHL courier to Lagos agent',
      dispatched_by: 1,
    },
  ];

  await knex('document_dispatch_log').insert(dispatchLogs);
};
