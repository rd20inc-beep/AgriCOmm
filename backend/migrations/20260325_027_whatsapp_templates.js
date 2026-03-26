/**
 * Migration: WhatsApp Templates & Message Logs
 */

exports.up = async function (knex) {
  // 1. WhatsApp Templates
  await knex.schema.createTable('whatsapp_templates', (t) => {
    t.increments('id').primary();
    t.string('name', 100).notNullable();
    t.string('slug', 100).unique().notNullable();
    t.text('body_template').notNullable();
    t.jsonb('available_variables');
    t.string('entity', 50); // 'export', 'milling', 'local_sale', 'finance'
    t.string('trigger_event', 100); // 'order_created', 'payment_received', etc.
    t.boolean('is_active').defaultTo(true);
    t.boolean('auto_send').defaultTo(false);
    t.string('recipient_type', 50).defaultTo('customer'); // customer, supplier, internal
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // 2. WhatsApp Logs
  await knex.schema.createTable('whatsapp_logs', (t) => {
    t.increments('id').primary();
    t.string('to_phone', 20).notNullable();
    t.string('to_name', 255);
    t.string('template_used', 100);
    t.text('body').notNullable();
    t.string('linked_type', 50); // 'export_order', 'milling_batch', 'local_sale', etc.
    t.integer('linked_id');
    t.string('status', 20).defaultTo('Pending'); // Pending, Sent, Failed, Delivered, Read
    t.text('error_message');
    t.integer('sent_by').unsigned().references('id').inTable('users');
    t.timestamp('sent_at');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 3. Seed default WhatsApp templates
  await knex('whatsapp_templates').insert([
    {
      name: 'Order Confirmation',
      slug: 'order_confirmation',
      body_template: 'Dear {{customerName}},\n\nYour export order *{{orderNo}}* has been confirmed.\n\nProduct: {{productName}}\nQuantity: {{quantity}} MT\nPrice: {{currency}} {{price}}/MT\n\nThank you for your business.\n\n_AGRI COMMODITIES_',
      available_variables: JSON.stringify(['customerName', 'orderNo', 'productName', 'quantity', 'currency', 'price']),
      entity: 'export',
      trigger_event: 'order_confirmed',
      auto_send: false,
      recipient_type: 'customer',
    },
    {
      name: 'Advance Payment Request',
      slug: 'advance_payment_request',
      body_template: 'Dear {{customerName}},\n\nKindly arrange the advance payment for order *{{orderNo}}*.\n\nAdvance Amount: {{currency}} {{advanceAmount}}\nBank: {{bankName}}\nAccount: {{accountNumber}}\nSWIFT: {{swiftCode}}\n\nPlease share the payment receipt.\n\n_AGRI COMMODITIES_',
      available_variables: JSON.stringify(['customerName', 'orderNo', 'currency', 'advanceAmount', 'bankName', 'accountNumber', 'swiftCode']),
      entity: 'export',
      trigger_event: 'advance_requested',
      auto_send: false,
      recipient_type: 'customer',
    },
    {
      name: 'Balance Payment Reminder',
      slug: 'balance_payment_reminder',
      body_template: 'Dear {{customerName}},\n\nThis is a reminder for the balance payment on order *{{orderNo}}*.\n\nBalance Due: {{currency}} {{balanceAmount}}\nDue Date: {{dueDate}}\n\nPlease arrange payment at your earliest convenience.\n\n_AGRI COMMODITIES_',
      available_variables: JSON.stringify(['customerName', 'orderNo', 'currency', 'balanceAmount', 'dueDate']),
      entity: 'export',
      trigger_event: 'balance_reminder',
      auto_send: false,
      recipient_type: 'customer',
    },
    {
      name: 'Shipment Notification',
      slug: 'shipment_notification',
      body_template: 'Dear {{customerName}},\n\nYour shipment for order *{{orderNo}}* has been dispatched.\n\n\u{1F6A2} Vessel: {{vesselName}}\n\u{1F4C5} ETD: {{etd}}\n\u{1F4C5} ETA: {{eta}}\n\u{1F3ED} Port: {{destinationPort}}\n\u{1F4E6} Containers: {{containerCount}}\n\nDocuments will be shared shortly.\n\n_AGRI COMMODITIES_',
      available_variables: JSON.stringify(['customerName', 'orderNo', 'vesselName', 'etd', 'eta', 'destinationPort', 'containerCount']),
      entity: 'export',
      trigger_event: 'shipment_dispatched',
      auto_send: false,
      recipient_type: 'customer',
    },
    {
      name: 'Payment Received',
      slug: 'payment_received',
      body_template: 'Dear {{customerName}},\n\nWe have received your payment of *{{currency}} {{amount}}* for order *{{orderNo}}*.\n\nPayment Reference: {{paymentRef}}\nDate: {{paymentDate}}\n\nThank you.\n\n_AGRI COMMODITIES_',
      available_variables: JSON.stringify(['customerName', 'orderNo', 'currency', 'amount', 'paymentRef', 'paymentDate']),
      entity: 'export',
      trigger_event: 'payment_received',
      auto_send: false,
      recipient_type: 'customer',
    },
    {
      name: 'Milling Update',
      slug: 'milling_update',
      body_template: 'Dear {{supplierName}},\n\nMilling batch *{{batchNo}}* update:\n\nStatus: {{status}}\nInput: {{inputQty}} MT\nOutput: {{outputQty}} MT\nYield: {{yieldPct}}%\n\n_AGRI COMMODITIES_',
      available_variables: JSON.stringify(['supplierName', 'batchNo', 'status', 'inputQty', 'outputQty', 'yieldPct']),
      entity: 'milling',
      trigger_event: 'milling_completed',
      auto_send: false,
      recipient_type: 'supplier',
    },
    {
      name: 'Local Sale Confirmation',
      slug: 'local_sale_confirmation',
      body_template: 'Dear {{buyerName}},\n\nYour local sale order *{{saleNo}}* is confirmed.\n\nProduct: {{productName}}\nQuantity: {{quantity}} {{unit}}\nRate: PKR {{rate}}/{{unit}}\nTotal: PKR {{totalAmount}}\n\nDelivery: {{deliveryDate}}\n\n_AGRI COMMODITIES_',
      available_variables: JSON.stringify(['buyerName', 'saleNo', 'productName', 'quantity', 'unit', 'rate', 'totalAmount', 'deliveryDate']),
      entity: 'local_sale',
      trigger_event: 'local_sale_created',
      auto_send: false,
      recipient_type: 'customer',
    },
    {
      name: 'Quality Report',
      slug: 'quality_report',
      body_template: 'Dear {{recipientName}},\n\nQuality report for {{entityType}} *{{entityNo}}*:\n\nBroken: {{brokenPct}}%\nMoisture: {{moisturePct}}%\nForeign Matter: {{foreignMatterPct}}%\nGrade: {{grade}}\n\nRemarks: {{remarks}}\n\n_AGRI COMMODITIES_',
      available_variables: JSON.stringify(['recipientName', 'entityType', 'entityNo', 'brokenPct', 'moisturePct', 'foreignMatterPct', 'grade', 'remarks']),
      entity: 'milling',
      trigger_event: 'quality_checked',
      auto_send: false,
      recipient_type: 'customer',
    },
  ]);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('whatsapp_logs');
  await knex.schema.dropTableIfExists('whatsapp_templates');
};
