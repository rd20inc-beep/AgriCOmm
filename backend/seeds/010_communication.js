/**
 * Seed: Communication — Email Templates, Scheduled Tasks, Email Logs, Comments, Task Assignments, Follow-ups, Notifications
 */

exports.seed = async function (knex) {
  // Clear in reverse-dependency order
  await knex('follow_ups').del();
  await knex('tasks_assignments').del();
  await knex('comments').del();
  await knex('task_execution_log').del();
  await knex('scheduled_tasks').del();
  await knex('email_logs').del();
  await knex('email_templates').del();

  // ============================================================
  // 1. Email Templates (8)
  // ============================================================
  const templates = [
    {
      name: 'Advance Payment Request',
      slug: 'advance_request',
      subject_template: 'Advance Payment Required — Order {{orderNo}}',
      body_template: `<html><body>
<h2>Advance Payment Request</h2>
<p>Dear {{customerName}},</p>
<p>We are writing to request the advance payment for your order <strong>{{orderNo}}</strong>.</p>
<p><strong>Order Details:</strong></p>
<ul>
  <li>Total Value: {{currency}} {{totalValue}}</li>
  <li>Advance Required ({{advancePct}}%): {{currency}} {{amount}}</li>
</ul>
<p>Please arrange the advance payment at your earliest convenience so we can proceed with processing your order.</p>
<p>Best regards,<br/>AGRI COMMODITIES</p>
</body></html>`,
      available_variables: JSON.stringify(['orderNo', 'customerName', 'amount', 'currency', 'totalValue', 'advancePct']),
      entity: 'export',
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Balance Payment Reminder',
      slug: 'balance_reminder',
      subject_template: 'Balance Payment Due — Order {{orderNo}}',
      body_template: `<html><body>
<h2>Balance Payment Reminder</h2>
<p>Dear {{customerName}},</p>
<p>This is a reminder that the balance payment for order <strong>{{orderNo}}</strong> is now due.</p>
<p><strong>Outstanding Balance:</strong> {{currency}} {{amount}}</p>
<p>The Bill of Lading has been approved and shipment documentation is ready. Please arrange payment promptly to avoid any delays.</p>
<p>Best regards,<br/>AGRI COMMODITIES</p>
</body></html>`,
      available_variables: JSON.stringify(['orderNo', 'customerName', 'amount', 'currency', 'totalValue']),
      entity: 'export',
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Proforma Invoice',
      slug: 'proforma_invoice',
      subject_template: 'Proforma Invoice {{piNumber}} — {{customerName}}',
      body_template: `<html><body>
<h2>Proforma Invoice</h2>
<p>Dear {{customerName}},</p>
<p>Please find attached the Proforma Invoice <strong>{{piNumber}}</strong> for your order <strong>{{orderNo}}</strong>.</p>
<p><strong>Details:</strong></p>
<ul>
  <li>Product: {{productName}}</li>
  <li>Quantity: {{qtyMT}} MT</li>
  <li>Price/MT: {{currency}} {{pricePerMT}}</li>
  <li>Total Value: {{currency}} {{totalValue}}</li>
</ul>
<p>Please review and confirm at your earliest convenience.</p>
<p>Best regards,<br/>AGRI COMMODITIES</p>
</body></html>`,
      available_variables: JSON.stringify(['piNumber', 'customerName', 'orderNo', 'productName', 'qtyMT', 'currency', 'pricePerMT', 'totalValue']),
      entity: 'export',
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Shipment Notification',
      slug: 'shipment_notification',
      subject_template: 'Shipment Update — Order {{orderNo}}',
      body_template: `<html><body>
<h2>Shipment Notification</h2>
<p>Dear {{customerName}},</p>
<p>We are pleased to inform you that your order <strong>{{orderNo}}</strong> has been shipped.</p>
<p><strong>Shipment Details:</strong></p>
<ul>
  <li>Vessel: {{vesselName}}</li>
  <li>ETA: {{eta}}</li>
  <li>Destination: {{destinationPort}}</li>
</ul>
<p>We will keep you updated on the shipment progress.</p>
<p>Best regards,<br/>AGRI COMMODITIES</p>
</body></html>`,
      available_variables: JSON.stringify(['orderNo', 'customerName', 'vesselName', 'eta', 'destinationPort']),
      entity: 'export',
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Quality Variance Alert',
      slug: 'quality_alert',
      subject_template: 'Quality Variance Alert — Batch {{batchNo}}',
      body_template: `<html><body>
<h2>Quality Variance Alert</h2>
<p>A quality variance has been detected for milling batch <strong>{{batchNo}}</strong>.</p>
<p><strong>Supplier:</strong> {{supplierName}}</p>
<p><strong>Raw Quantity:</strong> {{rawQty}} MT</p>
<p>Please review the arrival quality analysis against the sample and take appropriate action.</p>
<p>Best regards,<br/>AGRI COMMODITIES QC Team</p>
</body></html>`,
      available_variables: JSON.stringify(['batchNo', 'supplierName', 'rawQty']),
      entity: 'mill',
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Payment Confirmation',
      slug: 'payment_confirmation',
      subject_template: 'Payment Confirmed — {{amount}} {{currency}}',
      body_template: `<html><body>
<h2>Payment Confirmation</h2>
<p>Dear {{customerName}},</p>
<p>We confirm receipt of your payment of <strong>{{currency}} {{amount}}</strong> for order <strong>{{orderNo}}</strong>.</p>
<p>Thank you for your prompt payment.</p>
<p>Best regards,<br/>AGRI COMMODITIES</p>
</body></html>`,
      available_variables: JSON.stringify(['orderNo', 'customerName', 'amount', 'currency']),
      entity: 'export',
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Document Approval Notification',
      slug: 'document_approval',
      subject_template: 'Document Approved — {{docType}} for {{orderNo}}',
      body_template: `<html><body>
<h2>Document Approved</h2>
<p>The following document has been approved:</p>
<ul>
  <li>Document Type: {{docType}}</li>
  <li>Title: {{title}}</li>
  <li>Order: {{orderNo}}</li>
</ul>
<p>No further action is required for this document.</p>
<p>Best regards,<br/>AGRI COMMODITIES</p>
</body></html>`,
      available_variables: JSON.stringify(['docType', 'orderNo', 'title']),
      entity: 'export',
      is_active: true,
      created_by: 1,
    },
    {
      name: 'Overdue Payment Notice',
      slug: 'overdue_notice',
      subject_template: 'Overdue Payment Notice — {{amount}} Outstanding',
      body_template: `<html><body>
<h2>Overdue Payment Notice</h2>
<p>Dear {{customerName}},</p>
<p>This is a formal notice that a payment of <strong>{{currency}} {{amount}}</strong> is overdue.</p>
<p><strong>Details:</strong></p>
<ul>
  <li>Reference: {{refNo}}</li>
  <li>Due Date: {{dueDate}}</li>
  <li>Amount: {{currency}} {{amount}}</li>
</ul>
<p>Please arrange immediate payment to avoid any disruption to future orders.</p>
<p>Best regards,<br/>AGRI COMMODITIES</p>
</body></html>`,
      available_variables: JSON.stringify(['customerName', 'amount', 'currency', 'dueDate', 'refNo']),
      entity: 'export',
      is_active: true,
      created_by: 1,
    },
  ];

  await knex('email_templates').insert(templates);

  // ============================================================
  // 2. Scheduled Tasks (6)
  // ============================================================
  const now = new Date();
  const tomorrow9am = new Date(now);
  tomorrow9am.setDate(tomorrow9am.getDate() + 1);
  tomorrow9am.setHours(9, 0, 0, 0);

  const tomorrow10am = new Date(tomorrow9am);
  tomorrow10am.setHours(10, 0, 0, 0);

  const tomorrow8am = new Date(tomorrow9am);
  tomorrow8am.setHours(8, 0, 0, 0);

  // Next Monday 8am
  const nextMonday = new Date(now);
  nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
  nextMonday.setHours(8, 0, 0, 0);

  // Next Friday 5pm
  const nextFriday = new Date(now);
  nextFriday.setDate(nextFriday.getDate() + ((12 - nextFriday.getDay()) % 7 || 7));
  nextFriday.setHours(17, 0, 0, 0);

  const scheduledTasks = [
    {
      task_type: 'overdue_scan',
      name: 'Daily Overdue Advance Scan',
      cron_expression: '0 9 * * *',
      next_run: tomorrow9am.toISOString(),
      last_run: null,
      last_status: null,
      is_active: true,
      config: JSON.stringify({ threshold_days: 7, entity: 'export' }),
    },
    {
      task_type: 'overdue_scan',
      name: 'Daily Overdue Balance Scan',
      cron_expression: '0 9 * * *',
      next_run: tomorrow9am.toISOString(),
      last_run: null,
      last_status: null,
      is_active: true,
      config: JSON.stringify({ threshold_days: 7, entity: 'export' }),
    },
    {
      task_type: 'alert_check',
      name: 'Daily Missing Documents Alert',
      cron_expression: '0 10 * * *',
      next_run: tomorrow10am.toISOString(),
      last_run: null,
      last_status: null,
      is_active: true,
      config: JSON.stringify({ check_type: 'missing_docs', eta_threshold_days: 14 }),
    },
    {
      task_type: 'report_generation',
      name: 'Weekly Receivable Aging Report',
      cron_expression: '0 8 * * 1',
      next_run: nextMonday.toISOString(),
      last_run: null,
      last_status: null,
      is_active: true,
      config: JSON.stringify({ report_type: 'receivable_aging', recipients: ['finance@agririce.com'] }),
    },
    {
      task_type: 'alert_check',
      name: 'Daily Shipment ETA Check',
      cron_expression: '0 8 * * *',
      next_run: tomorrow8am.toISOString(),
      last_run: null,
      last_status: null,
      is_active: true,
      config: JSON.stringify({ check_type: 'shipment_eta' }),
    },
    {
      task_type: 'report_generation',
      name: 'Weekly Supplier Performance Summary',
      cron_expression: '0 17 * * 5',
      next_run: nextFriday.toISOString(),
      last_run: null,
      last_status: null,
      is_active: true,
      config: JSON.stringify({ report_type: 'supplier_performance', recipients: ['admin@riceflow.com'] }),
    },
  ];

  await knex('scheduled_tasks').insert(scheduledTasks);

  // ============================================================
  // 3. Fetch export order IDs
  // ============================================================
  const order101 = await knex('export_orders').where({ order_no: 'EX-101' }).select('id', 'order_no').first();
  const order102 = await knex('export_orders').where({ order_no: 'EX-102' }).select('id', 'order_no').first();
  const orderId101 = order101 ? order101.id : 1;
  const orderId102 = order102 ? order102.id : 2;

  const batch201 = await knex('milling_batches').where({ batch_no: 'M-201' }).select('id').first();
  const batchId201 = batch201 ? batch201.id : 1;

  // ============================================================
  // 4. Sample Email Logs (5)
  // ============================================================
  const emailLogs = [
    {
      from_email: 'info@agririce.com',
      to_email: 'buyer@uaeimports.com',
      subject: 'Advance Payment Required — Order EX-101',
      body: '<p>Advance payment request for EX-101</p>',
      template_used: 'advance_request',
      linked_type: 'export_order',
      linked_id: orderId101,
      status: 'Sent',
      error_message: null,
      sent_by: 1,
      sent_at: '2026-02-15T09:00:00Z',
    },
    {
      from_email: 'info@agririce.com',
      to_email: 'buyer@saudifood.com',
      subject: 'Advance Payment Required — Order EX-102',
      body: '<p>Advance payment request for EX-102</p>',
      template_used: 'advance_request',
      linked_type: 'export_order',
      linked_id: orderId102,
      status: 'Sent',
      error_message: null,
      sent_by: 1,
      sent_at: '2026-03-01T10:30:00Z',
    },
    {
      from_email: 'info@agririce.com',
      to_email: 'buyer@uaeimports.com',
      subject: 'Proforma Invoice EX-101 — UAE Imports LLC',
      body: '<p>Proforma Invoice for order EX-101</p>',
      template_used: 'proforma_invoice',
      linked_type: 'export_order',
      linked_id: orderId101,
      status: 'Sent',
      error_message: null,
      sent_by: 1,
      sent_at: '2026-02-10T08:15:00Z',
    },
    {
      from_email: 'info@agririce.com',
      to_email: 'buyer@uaeimports.com',
      subject: 'Shipment Update — Order EX-101',
      body: '<p>Your order EX-101 has been shipped</p>',
      template_used: 'shipment_notification',
      linked_type: 'export_order',
      linked_id: orderId101,
      status: 'Sent',
      error_message: null,
      sent_by: 2,
      sent_at: '2026-02-28T14:00:00Z',
    },
    {
      from_email: 'info@agririce.com',
      to_email: 'buyer@saudifood.com',
      subject: 'Balance Payment Due — Order EX-102',
      body: '<p>Balance reminder for EX-102</p>',
      template_used: 'balance_reminder',
      linked_type: 'export_order',
      linked_id: orderId102,
      status: 'Failed',
      error_message: 'SMTP connection timeout: unable to reach smtp.gmail.com',
      sent_by: 1,
      sent_at: '2026-03-10T09:00:00Z',
    },
  ];

  await knex('email_logs').insert(emailLogs);

  // ============================================================
  // 5. Comments (8)
  // ============================================================
  const comments = [
    // 3 on EX-101
    {
      linked_type: 'export_order',
      linked_id: orderId101,
      user_id: 2,
      comment: 'Customer confirmed advance payment will be sent by Feb 16. Wire transfer from Dubai.',
      is_internal: true,
      mentioned_users: null,
      created_at: '2026-02-14T10:00:00Z',
    },
    {
      linked_type: 'export_order',
      linked_id: orderId101,
      user_id: 1,
      comment: 'Advance received and confirmed. Moving to milling stage.',
      is_internal: true,
      mentioned_users: JSON.stringify([2, 4]),
      created_at: '2026-02-17T11:30:00Z',
    },
    {
      linked_type: 'export_order',
      linked_id: orderId101,
      user_id: 2,
      comment: 'All documents approved. Shipment departed on schedule.',
      is_internal: true,
      mentioned_users: null,
      created_at: '2026-02-27T16:00:00Z',
    },
    // 2 on EX-102
    {
      linked_type: 'export_order',
      linked_id: orderId102,
      user_id: 2,
      comment: 'Saudi buyer requesting 5% discount on price. Discussed with management — declined.',
      is_internal: true,
      mentioned_users: JSON.stringify([1]),
      created_at: '2026-03-02T09:00:00Z',
    },
    {
      linked_type: 'export_order',
      linked_id: orderId102,
      user_id: 3,
      comment: 'Advance received via LC. Finance has confirmed and posted the entry.',
      is_internal: true,
      mentioned_users: null,
      created_at: '2026-03-05T14:00:00Z',
    },
    // 2 on M-201
    {
      linked_type: 'milling_batch',
      linked_id: batchId201,
      user_id: 4,
      comment: 'Quality variance on moisture detected (12.5% vs 11.8% sample). Within tolerance, proceeding.',
      is_internal: true,
      mentioned_users: null,
      created_at: '2026-02-20T08:00:00Z',
    },
    {
      linked_type: 'milling_batch',
      linked_id: batchId201,
      user_id: 4,
      comment: 'Milling completed. Yield at 62% — slightly below target but acceptable.',
      is_internal: true,
      mentioned_users: JSON.stringify([2]),
      created_at: '2026-02-25T17:00:00Z',
    },
    // 1 on receivable
    {
      linked_type: 'receivable',
      linked_id: 1,
      user_id: 3,
      comment: 'Customer promised payment by end of month. Setting follow-up.',
      is_internal: true,
      mentioned_users: null,
      created_at: '2026-03-12T11:00:00Z',
    },
  ];

  await knex('comments').insert(comments);

  // ============================================================
  // 6. Task Assignments (4)
  // ============================================================
  const taskAssignments = [
    {
      task_no: 'TSK-001',
      title: 'Follow up balance payment for EX-102',
      description: 'BL draft approved. Contact Saudi buyer for balance payment arrangement.',
      linked_type: 'export_order',
      linked_id: orderId102,
      assigned_to: 3,
      assigned_by: 2,
      priority: 'High',
      due_date: '2026-03-20',
      status: 'Open',
      completed_at: null,
    },
    {
      task_no: 'TSK-002',
      title: 'Prepare fumigation certificate for EX-102',
      description: 'Arrange fumigation and obtain certificate before shipment.',
      linked_type: 'export_order',
      linked_id: orderId102,
      assigned_to: 2,
      assigned_by: 1,
      priority: 'Normal',
      due_date: '2026-03-25',
      status: 'Open',
      completed_at: null,
    },
    {
      task_no: 'TSK-003',
      title: 'Review supplier contract renewal',
      description: 'Annual contract with Sindh Rice Mills is due for renewal. Review terms and pricing.',
      linked_type: null,
      linked_id: null,
      assigned_to: 1,
      assigned_by: 1,
      priority: 'Normal',
      due_date: '2026-03-30',
      status: 'In Progress',
      completed_at: null,
    },
    {
      task_no: 'TSK-004',
      title: 'Verify shipment documents for EX-101',
      description: 'Ensure all documents are filed and archived for completed order EX-101.',
      linked_type: 'export_order',
      linked_id: orderId101,
      assigned_to: 2,
      assigned_by: 1,
      priority: 'Low',
      due_date: '2026-03-15',
      status: 'Completed',
      completed_at: '2026-03-14T16:00:00Z',
    },
  ];

  await knex('tasks_assignments').insert(taskAssignments);

  // ============================================================
  // 7. Follow-ups (3)
  // ============================================================
  const followUps = [
    {
      linked_type: 'export_order',
      linked_id: orderId102,
      user_id: 3,
      follow_up_date: '2026-03-22',
      note: 'Check if Saudi buyer has arranged balance payment',
      status: 'Pending',
      created_at: '2026-03-12T10:00:00Z',
    },
    {
      linked_type: 'receivable',
      linked_id: 1,
      user_id: 3,
      follow_up_date: '2026-03-31',
      note: 'Customer promised payment by end of March — verify receipt',
      status: 'Pending',
      created_at: '2026-03-12T11:30:00Z',
    },
    {
      linked_type: 'export_order',
      linked_id: orderId101,
      user_id: 2,
      follow_up_date: '2026-03-05',
      note: 'Confirm arrival at UAE port and customer acknowledgment',
      status: 'Done',
      created_at: '2026-02-28T09:00:00Z',
    },
  ];

  await knex('follow_ups').insert(followUps);

  // ============================================================
  // 8. Notifications (5)
  // ============================================================
  const notifications = [
    {
      user_id: 2,
      title: 'Advance Payment Confirmed',
      message: 'Advance of 42,000 USD received for order EX-101',
      type: 'payment',
      linked_ref: 'EX-101',
      is_read: true,
      created_at: '2026-02-17T11:00:00Z',
    },
    {
      user_id: 3,
      title: 'Shipment Departed — Balance Collection Pending',
      message: 'Order EX-101 has been shipped. Balance payment collection is now pending.',
      type: 'shipment',
      linked_ref: 'EX-101',
      is_read: true,
      created_at: '2026-02-28T14:30:00Z',
    },
    {
      user_id: 2,
      title: 'New Task Assigned',
      message: 'You have been assigned task TSK-002: Prepare fumigation certificate for EX-102',
      type: 'task',
      linked_ref: 'TSK-002',
      is_read: false,
      created_at: '2026-03-10T09:00:00Z',
    },
    {
      user_id: 3,
      title: 'New Task Assigned',
      message: 'You have been assigned task TSK-001: Follow up balance payment for EX-102',
      type: 'task',
      linked_ref: 'TSK-001',
      is_read: false,
      created_at: '2026-03-10T09:05:00Z',
    },
    {
      user_id: 4,
      title: 'Milling Batch Completed',
      message: 'Batch M-201 completed. 31 MT finished rice produced for order EX-101.',
      type: 'milling',
      linked_ref: 'M-201',
      is_read: false,
      created_at: '2026-02-25T17:30:00Z',
    },
  ];

  await knex('notifications').insert(notifications);
};
