const db = require('../../config/database');
const emailService = require('../communications/email.service');
const expensesService = require('../expenses/expenses.service');

// Recurring-expense date helpers (mirror milling.routes so cadence math matches).
const _isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
function _addInterval(dateStr, recurrence) {
  const dt = new Date(`${_isoDate(dateStr)}T00:00:00Z`);
  if (recurrence === 'weekly') dt.setUTCDate(dt.getUTCDate() + 7);
  else if (recurrence === 'quarterly') dt.setUTCMonth(dt.getUTCMonth() + 3);
  else if (recurrence === 'yearly') dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  else dt.setUTCMonth(dt.getUTCMonth() + 1); // monthly (default)
  return dt.toISOString().slice(0, 10);
}

const automationService = {
  // ============================================================
  // Scheduled Task Runner
  // ============================================================
  async runTask(taskId) {
    const task = await db('scheduled_tasks').where({ id: taskId }).first();
    if (!task) throw new Error(`Task ${taskId} not found`);

    // Mark as running
    await db('scheduled_tasks').where({ id: taskId }).update({
      last_status: 'Running',
      last_run: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const logEntry = {
      task_id: taskId,
      started_at: new Date().toISOString(),
      status: 'Success',
      items_processed: 0,
      details: null,
      error: null,
    };

    try {
      let result = { processed: 0, details: {} };

      switch (task.task_type) {
        case 'overdue_scan':
          if (task.name.toLowerCase().includes('advance')) {
            result = await this.scanOverdueAdvances();
          } else if (task.name.toLowerCase().includes('balance')) {
            result = await this.scanOverdueBalances();
          } else {
            result = await this.scanOverdueReceivables();
          }
          break;
        case 'alert_check':
          if (task.name.toLowerCase().includes('doc')) {
            result = await this.scanMissingDocuments();
          } else if (task.name.toLowerCase().includes('shipment') || task.name.toLowerCase().includes('eta')) {
            result = await this.scanShipmentDelays();
          } else {
            result = await this.scanLowMarginOrders();
          }
          break;
        case 'report_generation':
          // Placeholder for report generation
          result = { processed: 0, details: { message: 'Report generation placeholder' } };
          break;
        case 'email_reminder':
          result = await this.scanOverdueReceivables();
          break;
        case 'recurring_expense':
          result = await this.materializeDueRecurringExpenses();
          break;
        case 'payroll_prepare':
          result = await this.runScheduledPayrollPrepare(task);
          break;
        case 'report_email':
          result = await this.runReportEmail(task);
          break;
        default:
          result = { processed: 0, details: { message: `Unknown task type: ${task.task_type}` } };
      }

      logEntry.items_processed = result.processed || 0;
      logEntry.details = JSON.stringify(result.details || {});
      logEntry.completed_at = new Date().toISOString();

      await db('scheduled_tasks').where({ id: taskId }).update({
        last_status: 'Success',
        updated_at: db.fn.now(),
      });
    } catch (err) {
      logEntry.status = 'Failed';
      logEntry.error = err.message;
      logEntry.completed_at = new Date().toISOString();

      await db('scheduled_tasks').where({ id: taskId }).update({
        last_status: 'Failed',
        updated_at: db.fn.now(),
      });
    }

    await db('task_execution_log').insert(logEntry);
    return logEntry;
  },

  // ============================================================
  // Scheduled report email — generate a report and email it to recipients.
  // Config: { reportType, recipients[], frequency, filters }.
  // ============================================================
  async runReportEmail(task) {
    const reportingService = require('../analytics/reporting.service');
    let cfg = {}; try { cfg = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {}); } catch (e) { cfg = {}; }
    const recipients = (cfg.recipients || []).filter(Boolean);
    if (!recipients.length) return { processed: 0, details: { message: 'No recipients configured' } };

    const report = await reportingService.buildScheduledReport(cfg.reportType, cfg.filters || {});
    if (!report) return { processed: 0, details: { message: `Unknown report type: ${cfg.reportType}` } };

    let companyName = 'AGRI COMMODITIES';
    try {
      const cp = await db('company_profile').first();
      if (cp) companyName = cp.legal_name || cp.name || companyName;
    } catch (e) { /* table may not exist — use default */ }

    const periodLabel = cfg.frequency ? `${cfg.frequency.charAt(0).toUpperCase()}${cfg.frequency.slice(1)} report` : null;
    const html = reportingService.renderReportEmailHtml(report, { companyName, periodLabel });
    const subject = `${report.title} — ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;

    let sent = 0;
    for (const to of recipients) {
      try { await emailService.sendEmail({ to, subject, body: html }); sent += 1; }
      catch (e) { console.error('Scheduled report email failed for', to, e.message); }
    }
    return { processed: sent, details: { reportType: cfg.reportType, recipients: recipients.length, sent, rows: (report.rows || []).length } };
  },

  // ============================================================
  // Automation Rules — Scans
  // ============================================================
  async scanOverdueAdvances() {
    const thresholdDays = 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - thresholdDays);

    const overdueOrders = await db('export_orders')
      .where('status', 'Awaiting Advance')
      .where('created_at', '<', cutoff.toISOString())
      .select('*');

    let processed = 0;
    for (const order of overdueOrders) {
      // Check if alert already exists
      const existingAlert = await db('alerts')
        .where({ linked_ref: order.order_no, title: 'Overdue Advance Payment' })
        .where('status', 'Open')
        .first();

      if (!existingAlert) {
        const daysSince = Math.floor((Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60 * 24));
        await db('alerts').insert({
          severity: daysSince > 14 ? 'high' : 'medium',
          entity: 'export',
          linked_ref: order.order_no,
          title: 'Overdue Advance Payment',
          summary: `Order ${order.order_no} has been awaiting advance for ${daysSince} days. Expected: ${order.advance_expected}`,
          amount_at_risk: order.advance_expected,
          age_days: daysSince,
          recommended_action: 'Follow up with customer for advance payment',
          status: 'Open',
        });

        // Send overdue email
        try {
          await emailService.sendAdvanceRequest({ orderId: order.id, userId: null });
        } catch (e) {
          console.error('Failed to send advance reminder:', e.message);
        }
      }

      processed++;
    }

    return { processed, details: { overdue_count: overdueOrders.length } };
  },

  async scanOverdueBalances() {
    const thresholdDays = 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - thresholdDays);

    const overdueOrders = await db('export_orders')
      .where('status', 'Awaiting Balance')
      .where('updated_at', '<', cutoff.toISOString())
      .select('*');

    let processed = 0;
    for (const order of overdueOrders) {
      const existingAlert = await db('alerts')
        .where({ linked_ref: order.order_no, title: 'Overdue Balance Payment' })
        .where('status', 'Open')
        .first();

      if (!existingAlert) {
        const balanceDue = parseFloat(order.balance_expected || 0) - parseFloat(order.balance_received || 0);
        await db('alerts').insert({
          severity: 'high',
          entity: 'export',
          linked_ref: order.order_no,
          title: 'Overdue Balance Payment',
          summary: `Order ${order.order_no} has outstanding balance of ${balanceDue}`,
          amount_at_risk: balanceDue,
          age_days: Math.floor((Date.now() - new Date(order.updated_at).getTime()) / (1000 * 60 * 60 * 24)),
          recommended_action: 'Follow up with customer for balance payment',
          status: 'Open',
        });

        try {
          await emailService.sendBalanceReminder({ orderId: order.id, userId: null });
        } catch (e) {
          console.error('Failed to send balance reminder:', e.message);
        }
      }

      processed++;
    }

    return { processed, details: { overdue_count: overdueOrders.length } };
  },

  async scanMissingDocuments() {
    // Find orders with shipment likely approaching (status in certain states)
    const orders = await db('export_orders')
      .whereIn('status', ['Docs In Preparation', 'In Milling'])
      .select('*');

    let processed = 0;
    for (const order of orders) {
      const missingDocs = await db('document_checklists')
        .where({ linked_type: 'export_order', linked_id: order.id, is_required: true, is_fulfilled: false })
        .select('doc_type');

      if (missingDocs.length > 0) {
        const existingAlert = await db('alerts')
          .where({ linked_ref: order.order_no, title: 'Missing Export Documents' })
          .where('status', 'Open')
          .first();

        if (!existingAlert) {
          const docTypes = missingDocs.map((d) => d.doc_type).join(', ');
          await db('alerts').insert({
            severity: 'medium',
            entity: 'export',
            linked_ref: order.order_no,
            title: 'Missing Export Documents',
            summary: `Order ${order.order_no} is missing ${missingDocs.length} required documents: ${docTypes}`,
            amount_at_risk: 0,
            age_days: 0,
            recommended_action: 'Upload and approve missing documents before shipment',
            status: 'Open',
          });
        }

        processed++;
      }
    }

    return { processed, details: { orders_checked: orders.length } };
  },

  async scanOverdueReceivables() {
    const today = new Date().toISOString().split('T')[0];

    const overdue = await db('receivables')
      .where('due_date', '<', today)
      .whereNot('status', 'Received')
      .select('*');

    let processed = 0;
    for (const rec of overdue) {
      const ageDays = Math.floor((Date.now() - new Date(rec.due_date).getTime()) / (1000 * 60 * 60 * 24));

      await db('receivables').where({ id: rec.id }).update({
        aging_days: ageDays,
        updated_at: db.fn.now(),
      });

      if (ageDays > 30) {
        const existingAlert = await db('alerts')
          .where({ linked_ref: rec.ref_no || `RCV-${rec.id}`, title: 'Significantly Overdue Receivable' })
          .where('status', 'Open')
          .first();

        if (!existingAlert) {
          await db('alerts').insert({
            severity: 'high',
            entity: 'export',
            linked_ref: rec.ref_no || `RCV-${rec.id}`,
            title: 'Significantly Overdue Receivable',
            summary: `Receivable of ${rec.amount} is ${ageDays} days past due`,
            amount_at_risk: rec.amount,
            age_days: ageDays,
            recommended_action: 'Escalate collection efforts',
            status: 'Open',
          });
        }
      }

      processed++;
    }

    return { processed, details: { overdue_count: overdue.length } };
  },

  async scanOverduePayables() {
    const today = new Date().toISOString().split('T')[0];

    const overdue = await db('payables')
      .where('due_date', '<', today)
      .whereNot('status', 'Paid')
      .select('*');

    let processed = 0;
    for (const pay of overdue) {
      const ageDays = Math.floor((Date.now() - new Date(pay.due_date).getTime()) / (1000 * 60 * 60 * 24));

      await db('payables').where({ id: pay.id }).update({
        aging_days: ageDays,
        updated_at: db.fn.now(),
      });

      if (ageDays > 30) {
        const existingAlert = await db('alerts')
          .where({ linked_ref: pay.ref_no || `PAY-${pay.id}`, title: 'Overdue Payable' })
          .where('status', 'Open')
          .first();

        if (!existingAlert) {
          await db('alerts').insert({
            severity: 'medium',
            entity: 'mill',
            linked_ref: pay.ref_no || `PAY-${pay.id}`,
            title: 'Overdue Payable',
            summary: `Payable of ${pay.amount} is ${ageDays} days past due`,
            amount_at_risk: pay.amount,
            age_days: ageDays,
            recommended_action: 'Arrange payment to supplier',
            status: 'Open',
          });
        }
      }

      processed++;
    }

    return { processed, details: { overdue_count: overdue.length } };
  },

  async scanShipmentDelays() {
    const today = new Date().toISOString().split('T')[0];

    const delayed = await db('export_orders')
      .where('status', 'Shipped')
      .whereNotNull('eta')
      .where('eta', '<', today)
      .select('*');

    let processed = 0;
    for (const order of delayed) {
      const existingAlert = await db('alerts')
        .where({ linked_ref: order.order_no, title: 'Shipment Delay' })
        .where('status', 'Open')
        .first();

      if (!existingAlert) {
        const daysLate = Math.floor((Date.now() - new Date(order.eta).getTime()) / (1000 * 60 * 60 * 24));
        await db('alerts').insert({
          severity: daysLate > 7 ? 'high' : 'medium',
          entity: 'export',
          linked_ref: order.order_no,
          title: 'Shipment Delay',
          summary: `Order ${order.order_no} ETA was ${order.eta}, now ${daysLate} days late`,
          amount_at_risk: order.total_value,
          age_days: daysLate,
          recommended_action: 'Contact shipping line for status update',
          status: 'Open',
        });
      }

      processed++;
    }

    return { processed, details: { delayed_count: delayed.length } };
  },

  async scanLowMarginOrders() {
    // Get margin threshold from settings or default to 5%
    const setting = await db('system_settings').where({ key: 'min_margin_pct' }).first();
    const minMargin = setting ? parseFloat(setting.value) : 5;

    const activeOrders = await db('export_orders')
      .whereNotIn('status', ['Closed', 'Cancelled', 'Draft'])
      .select('*');

    let processed = 0;
    for (const order of activeOrders) {
      // Sum all costs for this order
      const costResult = await db('export_order_costs')
        .where({ export_order_id: order.id })
        .sum('amount as total_cost')
        .first();

      const totalCost = parseFloat(costResult?.total_cost || 0);
      const totalValue = parseFloat(order.total_value || 0);
      const margin = totalValue > 0 ? ((totalValue - totalCost) / totalValue) * 100 : 0;

      if (margin < minMargin && totalCost > 0) {
        const existingAlert = await db('alerts')
          .where({ linked_ref: order.order_no, title: 'Low Margin Order' })
          .where('status', 'Open')
          .first();

        if (!existingAlert) {
          await db('alerts').insert({
            severity: margin < 0 ? 'critical' : 'medium',
            entity: 'export',
            linked_ref: order.order_no,
            title: 'Low Margin Order',
            summary: `Order ${order.order_no} margin is ${margin.toFixed(1)}% (threshold: ${minMargin}%)`,
            amount_at_risk: totalValue - totalCost,
            age_days: 0,
            recommended_action: 'Review order costs and pricing',
            status: 'Open',
          });
        }

        processed++;
      }
    }

    return { processed, details: { orders_checked: activeOrders.length } };
  },

  async scanQualityVariance() {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    // Find batches with arrival quality that have variance and unresolved
    const batches = await db('milling_batches')
      .where('status', 'Pending')
      .where('created_at', '<', threeDaysAgo.toISOString())
      .select('*');

    let processed = 0;
    for (const batch of batches) {
      const existingAlert = await db('alerts')
        .where({ linked_ref: batch.batch_no, title: 'Unresolved Quality Variance' })
        .where('status', 'Open')
        .first();

      if (!existingAlert) {
        await db('alerts').insert({
          severity: 'medium',
          entity: 'mill',
          linked_ref: batch.batch_no,
          title: 'Unresolved Quality Variance',
          summary: `Milling batch ${batch.batch_no} has been pending for over 3 days`,
          amount_at_risk: 0,
          age_days: Math.floor((Date.now() - new Date(batch.created_at).getTime()) / (1000 * 60 * 60 * 24)),
          recommended_action: 'Review quality variance and approve/reject batch',
          status: 'Open',
        });
      }

      processed++;
    }

    return { processed, details: { batches_checked: batches.length } };
  },

  async scanStockShortages() {
    const reservedLots = await db('inventory_lots')
      .where('status', 'Reserved')
      .whereNotNull('reserved_against')
      .select('*');

    let processed = 0;
    for (const lot of reservedLots) {
      if (parseFloat(lot.available_qty || 0) < parseFloat(lot.reserved_qty || 0)) {
        const existingAlert = await db('alerts')
          .where({ linked_ref: lot.reserved_against, title: 'Stock Shortage' })
          .where('status', 'Open')
          .first();

        if (!existingAlert) {
          await db('alerts').insert({
            severity: 'high',
            entity: 'export',
            linked_ref: lot.reserved_against,
            title: 'Stock Shortage',
            summary: `Reservation for ${lot.reserved_against} cannot be fulfilled. Available: ${lot.available_qty} MT, Reserved: ${lot.reserved_qty} MT`,
            amount_at_risk: 0,
            age_days: 0,
            recommended_action: 'Arrange additional stock or revise order quantity',
            status: 'Open',
          });
        }

        processed++;
      }
    }

    return { processed, details: { lots_checked: reservedLots.length } };
  },

  async scanUnallocatedCosts() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const unallocated = await db('cost_allocations')
      .where('status', 'Unallocated')
      .where('created_at', '<', sevenDaysAgo.toISOString())
      .select('*');

    let processed = 0;
    for (const cost of unallocated) {
      const existingAlert = await db('alerts')
        .where({ linked_ref: `COST-${cost.id}`, title: 'Unallocated Cost' })
        .where('status', 'Open')
        .first();

      if (!existingAlert) {
        await db('alerts').insert({
          severity: 'low',
          entity: cost.entity || 'export',
          linked_ref: `COST-${cost.id}`,
          title: 'Unallocated Cost',
          summary: `Cost allocation #${cost.id} of ${cost.amount} has been unallocated for over 7 days`,
          amount_at_risk: cost.amount || 0,
          age_days: Math.floor((Date.now() - new Date(cost.created_at).getTime()) / (1000 * 60 * 60 * 24)),
          recommended_action: 'Allocate cost to appropriate order or expense category',
          status: 'Open',
        });
      }

      processed++;
    }

    return { processed, details: { unallocated_count: unallocated.length } };
  },

  // ============================================================
  // Event-Driven Automations (called inline from controllers)
  // ============================================================
  async onAdvanceConfirmed(trx, { orderId, amount, userId }) {
    const order = await trx('export_orders').where({ id: orderId }).first();
    if (!order) return;

    // Send payment confirmation email (non-blocking)
    emailService.sendPaymentConfirmation({
      orderId,
      amount,
      currency: 'USD',
      userId,
    }).catch((err) => console.error('Advance confirmation email failed:', err.message));

    // Create notification for export manager (role_id = 2)
    const exportManagers = await trx('users').where({ role_id: 2, is_active: true });
    for (const manager of exportManagers) {
      await trx('notifications').insert({
        user_id: manager.id,
        title: 'Advance Payment Confirmed',
        message: `Advance of ${amount} received for order ${order.order_no}`,
        type: 'payment',
        linked_ref: order.order_no,
      });
    }

    // If milling order exists, notify mill manager
    const millingBatch = await trx('milling_batches').where({ linked_export_order_id: orderId }).first();
    if (millingBatch) {
      const millManagers = await trx('users').where({ role_id: 4, is_active: true });
      for (const manager of millManagers) {
        await trx('notifications').insert({
          user_id: manager.id,
          title: 'Advance Confirmed — Milling Can Proceed',
          message: `Advance received for ${order.order_no}. Milling batch ${millingBatch.batch_no} can proceed.`,
          type: 'payment',
          linked_ref: millingBatch.batch_no,
        });
      }
    }
  },

  async onBalanceConfirmed(trx, { orderId, amount, userId }) {
    const order = await trx('export_orders').where({ id: orderId }).first();
    if (!order) return;

    // Send confirmation email (non-blocking)
    emailService.sendPaymentConfirmation({
      orderId,
      amount,
      currency: 'USD',
      userId,
    }).catch((err) => console.error('Balance confirmation email failed:', err.message));

    // Notification: "Ready to ship"
    const exportManagers = await trx('users').where({ role_id: 2, is_active: true });
    for (const manager of exportManagers) {
      await trx('notifications').insert({
        user_id: manager.id,
        title: 'Balance Received — Ready to Ship',
        message: `Full balance received for ${order.order_no}. Order is ready for shipment.`,
        type: 'payment',
        linked_ref: order.order_no,
      });
    }

    // Create task: "Prepare final documents"
    const taskNo = `TSK-${Date.now().toString(36).toUpperCase()}`;
    const docOfficers = await trx('users').where({ role_id: 7, is_active: true }).first();
    await trx('tasks_assignments').insert({
      task_no: taskNo,
      title: `Prepare final documents for ${order.order_no}`,
      description: `Balance payment confirmed. Prepare all final shipping documents for order ${order.order_no}.`,
      linked_type: 'export_order',
      linked_id: orderId,
      assigned_to: docOfficers ? docOfficers.id : null,
      assigned_by: userId || null,
      priority: 'High',
      due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'Open',
    });
  },

  async onBLDraftApproved(trx, { orderId, userId }) {
    const order = await trx('export_orders').where({ id: orderId }).first();
    if (!order) return;

    // Send balance reminder email (non-blocking)
    emailService.sendBalanceReminder({ orderId, userId })
      .catch((err) => console.error('BL draft approved email failed:', err.message));

    // Create task for finance: follow up balance collection
    const financeManagers = await trx('users').where({ role_id: 3, is_active: true }).first();
    const taskNo = `TSK-${Date.now().toString(36).toUpperCase()}`;
    await trx('tasks_assignments').insert({
      task_no: taskNo,
      title: `Follow up balance collection for ${order.order_no}`,
      description: `BL draft has been approved for ${order.order_no}. Follow up with customer for balance payment.`,
      linked_type: 'export_order',
      linked_id: orderId,
      assigned_to: financeManagers ? financeManagers.id : null,
      assigned_by: userId || null,
      priority: 'High',
      due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'Open',
    });
  },

  async onBatchCompleted(trx, { batchId, userId }) {
    const batch = await trx('milling_batches').where({ id: batchId }).first();
    if (!batch) return;

    // Notify export manager if linked order
    if (batch.linked_export_order_id) {
      const order = await trx('export_orders').where({ id: batch.linked_export_order_id }).first();
      const exportManagers = await trx('users').where({ role_id: 2, is_active: true });
      for (const manager of exportManagers) {
        await trx('notifications').insert({
          user_id: manager.id,
          title: 'Milling Batch Completed',
          message: `Batch ${batch.batch_no} completed. ${batch.finished_qty_mt} MT finished rice produced${order ? ` for order ${order.order_no}` : ''}.`,
          type: 'milling',
          linked_ref: batch.batch_no,
        });
      }

      // Create task: arrange internal transfer
      const invOfficers = await trx('users').where({ role_id: 6, is_active: true }).first();
      const taskNo = `TSK-${Date.now().toString(36).toUpperCase()}`;
      await trx('tasks_assignments').insert({
        task_no: taskNo,
        title: `Arrange internal transfer for ${batch.batch_no}`,
        description: `Milling batch ${batch.batch_no} completed. Transfer finished goods to export warehouse${order ? ` for order ${order.order_no}` : ''}.`,
        linked_type: 'milling_batch',
        linked_id: batchId,
        assigned_to: invOfficers ? invOfficers.id : null,
        assigned_by: userId || null,
        priority: 'Normal',
        due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: 'Open',
      });
    }
  },

  async onDocumentApproved(trx, { documentId, userId }) {
    const doc = await trx('document_store').where({ id: documentId }).first();
    if (!doc || doc.linked_type !== 'export_order' || !doc.linked_id) return;

    // Send email notification (non-blocking)
    emailService.sendDocumentApprovalNotification({ documentId, userId })
      .catch((err) => console.error('Doc approval email failed:', err.message));

    // Check if all docs are now complete
    const missingDocs = await trx('document_checklists')
      .where({ linked_type: 'export_order', linked_id: doc.linked_id, is_required: true, is_fulfilled: false })
      .count('id as count')
      .first();

    if (parseInt(missingDocs.count) === 0) {
      const order = await trx('export_orders').where({ id: doc.linked_id }).first();
      const exportManagers = await trx('users').where({ role_id: 2, is_active: true });
      for (const manager of exportManagers) {
        await trx('notifications').insert({
          user_id: manager.id,
          title: 'All Documents Complete',
          message: `All required documents for order ${order ? order.order_no : doc.linked_id} are now approved. Order is ready for shipment.`,
          type: 'document',
          linked_ref: order ? order.order_no : `ORD-${doc.linked_id}`,
        });
      }
    }
  },

  async onShipmentDeparted(trx, { orderId, userId }) {
    const order = await trx('export_orders').where({ id: orderId }).first();
    if (!order) return;

    // Send shipment notification to customer (non-blocking)
    emailService.sendShipmentNotification({ orderId, userId })
      .catch((err) => console.error('Shipment notification email failed:', err.message));

    // Create notification for finance: "Balance collection pending"
    const financeManagers = await trx('users').where({ role_id: 3, is_active: true });
    for (const manager of financeManagers) {
      await trx('notifications').insert({
        user_id: manager.id,
        title: 'Shipment Departed — Balance Collection Pending',
        message: `Order ${order.order_no} has been shipped. Balance payment collection is now pending.`,
        type: 'shipment',
        linked_ref: order.order_no,
      });
    }
  },

  // ============================================================
  // Task Scheduler (simplified — checks DB, not real cron)
  // ============================================================
  // Auto-post recurring mill expenses whose next occurrence is due. Each recurring
  // business_expense series (category + payee + cadence) has a latest occurrence;
  // we walk forward from it, creating any missed occurrences up to today. New
  // occurrences are ACCRUED (pay_now=false) — never auto-paid from a bank account —
  // so a human still confirms the payment. Idempotent: skips a period that already
  // has an occurrence, so re-runs (or a manual materialize) never double-post.
  async materializeDueRecurringExpenses() {
    const rows = await db('business_expenses')
      .where('expense_type', 'mill').where('is_recurring', true)
      .select('id', 'expense_no', 'category', 'subcategory', 'vendor_name', 'supplier_id',
        'employee_id', 'recurrence', 'description', db.raw('amount_pkr as amount'), 'expense_date')
      .orderBy('expense_date', 'desc');

    const latest = {};
    for (const e of rows) {
      const k = `${e.category}|${e.employee_id || e.vendor_name || ''}|${e.recurrence || 'monthly'}`;
      if (!latest[k]) latest[k] = e; // rows are date-desc → first seen is newest
    }

    const today = new Date().toISOString().slice(0, 10);
    let created = 0; const items = [];
    for (const e of Object.values(latest)) {
      let cursor = _isoDate(e.expense_date);
      let guard = 0;
      while (guard++ < 240) { // cap catch-up at ~20 yrs monthly to avoid runaway
        const nextDue = _addInterval(cursor, e.recurrence);
        if (nextDue > today) break;
        // Idempotency: does this period already exist for the series?
        const dupQ = db('business_expenses')
          .where('expense_type', 'mill').where('category', e.category)
          .where('recurrence', e.recurrence).whereRaw('DATE(expense_date) = ?', [nextDue]);
        if (e.employee_id) dupQ.where('employee_id', e.employee_id);
        else if (e.vendor_name) dupQ.where('vendor_name', e.vendor_name);
        else dupQ.whereNull('employee_id').whereNull('vendor_name');
        if (await dupQ.first()) { cursor = nextDue; continue; }

        const expense = await expensesService.create({
          expense_type: 'mill', category: e.category, subcategory: e.subcategory,
          amount: parseFloat(e.amount), currency: 'PKR', expense_date: nextDue,
          description: e.description || null, vendor_name: e.vendor_name || null,
          supplier_id: e.supplier_id || null, employee_id: e.employee_id || null,
          is_recurring: true, recurrence: e.recurrence, pay_now: false,
          notes: `Auto-posted recurring (${e.recurrence}) from ${e.expense_no}`,
        }, 1);
        created++;
        items.push({ expense_no: expense?.expense_no || null, category: e.category, date: nextDue, amount: parseFloat(e.amount) });
        cursor = nextDue;
      }
    }
    return { processed: created, details: { created, items } };
  },

  // Auto-PREPARE the current month's payroll for every not-yet-committed active
  // employee. Lands in the approval queue as a 'prepared' run — NEVER auto-
  // approved or auto-paid (cash/GL + advance recovery still need a human Pay).
  // Idempotent: re-running in the same month prepares nobody new (everyone is
  // already committed), so it returns processed:0 rather than erroring.
  async runScheduledPayrollPrepare(task) {
    const payroll = require('../milling/payroll.service');
    let cfg = {}; try { cfg = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {}); } catch (e) { cfg = {}; }
    const period = new Date().toISOString().slice(0, 7); // current month
    try {
      const run = await payroll.preparePayrollRun({ month: period, pay_method: cfg.pay_method || 'cash', notes: `Auto-prepared monthly payroll ${period}` }, cfg.created_by || 1);
      return { processed: run.employee_count || 0, details: { runId: run.id, period, employees: run.employee_count, net: run.net_total } };
    } catch (e) {
      if (e.code === 'NONE') return { processed: 0, details: { period, message: 'All active employees already in a run for this period.' } };
      throw e;
    }
  },

  async runDueScheduledTasks() {
    const now = new Date().toISOString();

    const dueTasks = await db('scheduled_tasks')
      .where('is_active', true)
      .where(function () {
        this.where('next_run', '<=', now).orWhereNull('next_run');
      })
      .select('*');

    const results = [];
    for (const task of dueTasks) {
      try {
        const result = await this.runTask(task.id);
        results.push({ taskId: task.id, name: task.name, status: result.status });
      } catch (err) {
        results.push({ taskId: task.id, name: task.name, status: 'Failed', error: err.message });
      }

      // Update next_run. Report-email tasks store an explicit cadence in
      // cron_expression ('daily'|'weekly'|'monthly'); fall back to the legacy
      // heuristic for older task rows.
      let nextRun = new Date();
      const cadence = task.cron_expression;
      if (cadence === 'monthly') {
        nextRun.setMonth(nextRun.getMonth() + 1);
      } else if (cadence === 'weekly') {
        nextRun.setDate(nextRun.getDate() + 7);
      } else if (cadence === 'daily') {
        nextRun.setDate(nextRun.getDate() + 1);
      } else if (cadence && cadence.includes('1')) {
        nextRun.setDate(nextRun.getDate() + 7);
      } else {
        nextRun.setDate(nextRun.getDate() + 1);
      }

      await db('scheduled_tasks').where({ id: task.id }).update({
        next_run: nextRun.toISOString(),
        updated_at: db.fn.now(),
      });
    }

    return results;
  },
};

module.exports = automationService;
