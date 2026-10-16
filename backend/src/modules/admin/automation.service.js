const db = require('../../config/database');
const { BALANCE_COLLECTION_STATUSES, BALANCE_OUTSTANDING_SQL } = require('../exportOrders/balanceCollection');
const emailService = require('../communications/email.service');
// Automatic customer emails are opt-in per event and post-commit (P5-12).
const customerEmail = require('../communications/customerEmailPolicy');
const expensesService = require('../expenses/expenses.service');
const { nextSlot } = require('./schedulerSlots');

// A failing task is retried on the next scheduler ticks (hourly) up to this
// many attempts at the same slot; then it is reported and moves to its next slot.
const MAX_TASK_ATTEMPTS = 3;
// A claim older than this is a crashed runner: the task may be claimed again.
const CLAIM_STALE_MS = 2 * 3600 * 1000;
const { marginFinding, orderMarginRows, orderValuePkr } = require('../analytics/orderMargins');
const {
  RECEIVABLE_CLOSED, PAYABLE_CLOSED, receivablePkrAtBooked, nativeMoneyText,
} = require('../finance/currencyFigures');

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

// A recurring series = category + payee + cadence (shared with milling.routes).
const recurringSeriesKey = (e) => `${e.category}|${e.employee_id || e.vendor_name || ''}|${e.recurrence || 'monthly'}`;
// Salaries are paid only through Payroll (P2-25) — a recurring salary series
// from before that rule is never materialized again.
const PAYROLL_ONLY_HEADS = ['salaries', 'staff_advance'];

function httpError(message, status) {
  const e = new Error(message);
  e.statusCode = status;
  return e;
}

// The rows of a recurring series, newest first.
function seriesRows(conn, e) {
  const q = conn('business_expenses')
    .where('expense_type', 'mill').where('is_recurring', true)
    .where('category', e.category).where('recurrence', e.recurrence || 'monthly');
  if (e.employee_id) q.where('employee_id', e.employee_id);
  else if (e.vendor_name) q.whereNull('employee_id').where('vendor_name', e.vendor_name);
  else q.whereNull('employee_id').whereNull('vendor_name');
  return q.orderBy('expense_date', 'desc').orderBy('id', 'desc');
}

/**
 * Post ONE occurrence of a recurring series dated `due`, inside `trx` and under
 * the series' advisory lock — the single guard shared by the scheduler's
 * catch-up, "Run due" and "Post now". Refuses (409) a date already posted, a
 * date past the series' end, or a date not yet due. Returns the expense.
 */
async function postSeriesOccurrence(trx, latest, due, { payNow = false, bankAccountId = null, paymentMethod = null, reference = null, userId = null, millOnly = false, note = null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  if (due > today) throw httpError(`The next occurrence is not due until ${due}.`, 409);
  const end = latest.recurrence_end_date ? _isoDate(latest.recurrence_end_date) : null;
  if (end && due > end) throw httpError(`This recurring series ended on ${end}.`, 409);
  const dup = await seriesRows(trx, latest).where('expense_date', due).first('expense_no');
  if (dup) throw httpError(`The ${due} occurrence is already posted (${dup.expense_no}).`, 409);
  const expense = await expensesService.create({
    expense_type: 'mill', category: latest.category, subcategory: latest.subcategory,
    amount: parseFloat(latest.amount), currency: 'PKR', expense_date: due,
    description: latest.description || null, vendor_name: latest.vendor_name || null,
    supplier_id: latest.supplier_id || null, employee_id: latest.employee_id || null,
    is_recurring: true, recurrence: latest.recurrence,
    notes: note || `Recurring (${latest.recurrence}) from ${latest.expense_no}`,
    pay_now: !!payNow, bank_account_id: bankAccountId, payment_method: paymentMethod, payment_reference: reference,
  }, userId, trx, { millOnly });
  if (end) await trx('business_expenses').where('id', expense.id).update({ recurrence_end_date: end });
  return expense;
}

const lockSeries = (trx, e) => trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`recurring_expense:${recurringSeriesKey(e)}`]);
const SERIES_COLS = ['id', 'expense_no', 'category', 'subcategory', 'vendor_name', 'supplier_id',
  'employee_id', 'recurrence', 'description', 'amount_pkr as amount', 'expense_date', 'recurrence_end_date'];

// ── Scan alerts → the bell (P5-01 / PLT-02) ──────────────────────────────
// The `alerts` table stays the scans' de-duplication ledger (one Open row per
// finding); nothing ever displayed it. Each NEW finding is now also delivered
// as a notification to the people who act on it, resolved by role NAME:
//   money findings (overdue receivable / payable, unallocated cost)
//                       → Owner (with the reference) + Finance Manager (masked,
//                         no reference — the Phase 4 domain-separation rule)
//   mill findings       → Owner + Mill Manager
//   export findings     → Owner + Export Manager
const FINANCE_ALERTS = new Set(['Significantly Overdue Receivable', 'Overdue Payable', 'Unallocated Cost']);

function alertRecipients(alert) {
  if (FINANCE_ALERTS.has(alert.title)) return { roles: ['Owner'], finance: true };
  if (alert.entity === 'mill') return { roles: ['Owner', 'Mill Manager'], finance: false };
  return { roles: ['Owner', 'Export Manager'], finance: false };
}

async function raiseAlert(alert, conn = db) {
  const [row] = await conn('alerts').insert(alert).returning('*');
  const notificationService = require('../../services/notificationService');
  const { roles, finance } = alertRecipients(alert);
  try {
    await notificationService.createForRole(conn, {
      roleNames: roles, title: alert.title, message: alert.summary, type: 'alert', linkedRef: alert.linked_ref || null,
    });
    if (finance) {
      await notificationService.createForRole(conn, {
        roleName: 'Finance Manager', title: alert.title, message: alert.summary, type: 'alert', linkedRef: null,
      });
    }
  } catch (err) {
    // The finding is recorded; a failed delivery must not stop the scan.
    console.error('Alert notification failed:', err.message);
  }
  return row;
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
          // Not implemented — reported as Skipped, never as a Success.
          result = { skipped: true, processed: 0, details: { message: 'Report generation is not implemented; nothing was generated.' } };
          break;
        case 'email_reminder':
          result = await this.scanOverdueReceivables();
          break;
        case 'recurring_expense':
          // Recurring expenses are ledger postings: they are posted by a person
          // ("Run due" / "Post now"), never unattended (P2-27).
          result = { skipped: true, processed: 0, details: { message: 'Recurring expenses are posted from Mill Finance → Recurring ("Run due"), not by the scheduler.' } };
          break;
        case 'payroll_prepare':
          result = await this.runScheduledPayrollPrepare(task);
          break;
        case 'report_email':
          result = await this.runReportEmail(task);
          break;
        default:
          result = { skipped: true, processed: 0, details: { message: `Unknown task type: ${task.task_type}` } };
      }

      logEntry.status = result.skipped ? 'Skipped' : 'Success';
      logEntry.items_processed = result.processed || 0;
      logEntry.details = JSON.stringify(result.details || {});
      logEntry.completed_at = new Date().toISOString();

      await db('scheduled_tasks').where({ id: taskId }).update({
        last_status: logEntry.status,
        failure_count: 0,
        last_error: null,
        updated_at: db.fn.now(),
      });
    } catch (err) {
      logEntry.status = 'Failed';
      logEntry.error = err.message;
      logEntry.completed_at = new Date().toISOString();

      await db('scheduled_tasks').where({ id: taskId }).update({
        last_status: 'Failed',
        failure_count: db.raw('failure_count + 1'),
        last_error: String(err.message || err).slice(0, 2000),
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
    const policy = require('../analytics/reportEmailPolicy');
    const configured = (cfg.recipients || []).filter(Boolean);
    if (!configured.length) return { processed: 0, details: { message: 'No recipients configured' } };
    // Re-checked at send time (P1-11): a schedule created before the internal-
    // domain rule, or a domain since removed from the allowlist, never mails out.
    const { allowed: recipients, external, invalid } = policy.partitionRecipients(configured, await policy.allowedDomains(db));
    const skipped = [...external, ...invalid];
    if (skipped.length) console.warn(`Scheduled report ${task.id}: skipped ${skipped.length} recipient(s) outside the internal-domain allowlist`);
    if (!recipients.length) return { processed: 0, details: { message: 'No internal recipients', skipped: skipped.length } };

    const report = await reportingService.buildScheduledReport(cfg.reportType, cfg.filters || {});
    if (!report) return { processed: 0, details: { message: `Unknown report type: ${cfg.reportType}` } };

    let companyName = 'AGRI COMMODITIES';
    try {
      const cp = await db('company_profile').first();
      if (cp) companyName = cp.legal_name || cp.name || companyName;
    } catch (e) { /* table may not exist — use default */ }

    const periodLabel = cfg.frequency ? `${cfg.frequency.charAt(0).toUpperCase()}${cfg.frequency.slice(1)} report` : null;
    const subject = `${report.title} — ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;

    let sent = 0;
    for (const to of recipients) {
      try {
        // Each recipient gets the report redacted for their own role: cost /
        // profit columns only for a user who may see them on screen.
        const visible = policy.redactReportColumns(report, await policy.recipientVisibility(db, to));
        const html = reportingService.renderReportEmailHtml(visible, { companyName, periodLabel });
        await emailService.sendEmail({ to, subject, body: html }); sent += 1;
      } catch (e) { console.error('Scheduled report email failed for a recipient:', e.message); }
    }
    return { processed: sent, details: { reportType: cfg.reportType, recipients: recipients.length, sent, skipped: skipped.length, rows: (report.rows || []).length } };
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
        await raiseAlert({
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

        // Customer reminder — only when the owner switched it on (P5-12).
        const out = await customerEmail.sendCustomerEmail(db, 'overdue_advance',
          () => emailService.sendAdvanceRequest({ orderId: order.id, userId: null }));
        await out.done;
      }

      processed++;
    }

    return { processed, details: { overdue_count: overdueOrders.length } };
  },

  async scanOverdueBalances() {
    const thresholdDays = 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - thresholdDays);

    // Ship on the advance: the balance is chased after sailing too.
    const overdueOrders = await db('export_orders')
      .whereIn('status', BALANCE_COLLECTION_STATUSES)
      .whereRaw(BALANCE_OUTSTANDING_SQL)
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
        await raiseAlert({
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

        // Customer reminder — only when the owner switched it on (P5-12).
        const out = await customerEmail.sendCustomerEmail(db, 'overdue_balance',
          () => emailService.sendBalanceReminder({ orderId: order.id, userId: null }));
        await out.done;
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
          await raiseAlert({
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

  // Alerts carry ONE amount and no currency, so amount_at_risk is always PKR —
  // a foreign figure at its own booked rate, or null when it has none (never a
  // dollar amount stored as if it were rupees). The native amount is in the
  // summary text.
  async scanOverdueReceivables() {
    const today = new Date().toISOString().split('T')[0];

    const overdue = await db('receivables')
      .where('due_date', '<', today)
      .whereNotIn('status', RECEIVABLE_CLOSED)
      .where('outstanding', '>', 0)
      .select('*');

    let processed = 0;
    for (const rec of overdue) {
      const ageDays = Math.floor((Date.now() - new Date(rec.due_date).getTime()) / (1000 * 60 * 60 * 24));

      await db('receivables').where({ id: rec.id }).update({
        aging: ageDays,
        updated_at: db.fn.now(),
      });

      if (ageDays > 30) {
        const ref = rec.recv_no || `RCV-${rec.id}`;
        const existingAlert = await db('alerts')
          .where({ linked_ref: ref, title: 'Significantly Overdue Receivable' })
          .where('status', 'Open')
          .first();

        if (!existingAlert) {
          const pkr = receivablePkrAtBooked(rec);
          await raiseAlert({
            severity: 'high',
            entity: rec.entity || 'export',
            linked_ref: ref,
            title: 'Significantly Overdue Receivable',
            summary: `Receivable of ${nativeMoneyText(rec.outstanding, rec.currency)} is ${ageDays} days past due`,
            amount_at_risk: pkr == null ? null : Math.round(pkr * 100) / 100,
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
      .whereNotIn('status', PAYABLE_CLOSED)
      .where('outstanding', '>', 0)
      .select('*');

    let processed = 0;
    for (const pay of overdue) {
      const ageDays = Math.floor((Date.now() - new Date(pay.due_date).getTime()) / (1000 * 60 * 60 * 24));

      await db('payables').where({ id: pay.id }).update({
        aging: ageDays,
        updated_at: db.fn.now(),
      });

      if (ageDays > 30) {
        const ref = pay.pay_no || `PAY-${pay.id}`;
        const existingAlert = await db('alerts')
          .where({ linked_ref: ref, title: 'Overdue Payable' })
          .where('status', 'Open')
          .first();

        if (!existingAlert) {
          // A payable keeps no booked rate: PKR as is, a foreign one unpriced.
          const isPkr = String(pay.currency || 'PKR').toUpperCase() === 'PKR';
          await raiseAlert({
            severity: 'medium',
            entity: pay.entity || 'mill',
            linked_ref: ref,
            title: 'Overdue Payable',
            summary: `Payable of ${nativeMoneyText(pay.outstanding, pay.currency)} is ${ageDays} days past due`,
            amount_at_risk: isPkr ? parseFloat(pay.outstanding) || 0 : null,
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
        await raiseAlert({
          severity: daysLate > 7 ? 'high' : 'medium',
          entity: 'export',
          linked_ref: order.order_no,
          title: 'Shipment Delay',
          summary: `Order ${order.order_no} (${nativeMoneyText(order.contract_value, order.currency)}) ETA was ${order.eta}, now ${daysLate} days late`,
          // export_orders has no total_value: the contract value, in PKR at
          // the order's locked / booked rate.
          amount_at_risk: orderValuePkr(order),
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

    // Booked margin per open order, all in PKR (analytics/orderMargins.js):
    // revenue at the order's locked / booked rate less its costs in PKR. Was
    // order.total_value (no such column) less SUM(export_order_costs) looked up
    // by export_order_id (the column is order_id) — rupee costs off a dollar
    // contract. Orders with no booked rate or no rice cost are skipped.
    const activeOrders = await orderMarginRows(db, { excludeStatuses: ['Closed'] });

    let processed = 0;
    for (const order of activeOrders) {
      const f = marginFinding(order, { lowPct: minMargin });
      if (!f) continue;

      const existingAlert = await db('alerts')
        .where({ linked_ref: order.orderNo, title: 'Low Margin Order' })
        .where('status', 'Open')
        .first();

      if (!existingAlert) {
        await raiseAlert({
          severity: f.negative ? 'critical' : 'medium',
          entity: 'export',
          linked_ref: order.orderNo,
          title: 'Low Margin Order',
          summary: `Order ${order.orderNo} margin is ${f.marginPct.toFixed(1)}% (threshold: ${minMargin}%). ${f.description}`,
          amount_at_risk: f.atRiskPkr,
          age_days: 0,
          recommended_action: 'Review order costs and pricing',
          status: 'Open',
        });
      }

      processed++;
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
        await raiseAlert({
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
    // A lot whose physical stock no longer covers what is held on it (export
    // reservations + milling holds). Read from inventory_reservations — the
    // reserved_against string on the lot was dropped (migration 389) — so each
    // order holding the lot gets its own alert.
    const held = await db('inventory_reservations as r')
      .join('inventory_lots as l', 'l.id', 'r.lot_id')
      .join('export_orders as o', 'o.id', 'r.order_id')
      .where('r.status', 'Active')
      .whereRaw('COALESCE(l.qty, 0) + 0.000001 < COALESCE(l.reserved_qty, 0) + COALESCE(l.milling_reserved_qty, 0)')
      .select('l.id', 'l.lot_no', 'l.qty', 'l.reserved_qty', 'o.order_no');

    let processed = 0;
    for (const lot of held) {
      const existingAlert = await db('alerts')
        .where({ linked_ref: lot.order_no, title: 'Stock Shortage' })
        .where('status', 'Open')
        .first();

      if (!existingAlert) {
        await raiseAlert({
          severity: 'high',
          entity: 'export',
          linked_ref: lot.order_no,
          title: 'Stock Shortage',
          summary: `Reservation for ${lot.order_no} on lot ${lot.lot_no} cannot be fulfilled. On hand: ${lot.qty} kg, reserved: ${lot.reserved_qty} kg`,
          amount_at_risk: 0,
          age_days: 0,
          recommended_action: 'Arrange additional stock or revise order quantity',
          status: 'Open',
        });
      }

      processed++;
    }

    return { processed, details: { lots_checked: held.length } };
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
        await raiseAlert({
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
  async onAdvanceConfirmed(trx, { orderId, amount, currency, userId }) {
    const order = await trx('export_orders').where({ id: orderId }).first();
    if (!order) return;

    // Payment confirmation to the buyer: opt-in, after commit, in the
    // receipt's / order's own currency (it was hard-coded USD — PLT-14).
    await customerEmail.sendCustomerEmail(trx, 'advance_confirmed', () => emailService.sendPaymentConfirmation({
      orderId,
      amount,
      currency: currency || order.currency || 'USD',
      userId,
    }));

    // Recipients by role NAME (role ids differ between installs — PLT-15).
    const notificationService = require('../../services/notificationService');
    await notificationService.createForRole(trx, {
      roleName: 'Export Manager',
      title: 'Advance Payment Confirmed',
      message: `Advance of ${amount} received for order ${order.order_no}`,
      type: 'payment',
      linkedRef: order.order_no,
    });

    // If milling order exists, notify mill manager
    const millingBatch = await trx('milling_batches').where({ linked_export_order_id: orderId }).first();
    if (millingBatch) {
      await notificationService.createForRole(trx, {
        roleName: 'Mill Manager',
        title: 'Advance Confirmed — Milling Can Proceed',
        message: `Advance received for ${order.order_no}. Milling batch ${millingBatch.batch_no} can proceed.`,
        type: 'payment',
        linkedRef: millingBatch.batch_no,
      });
    }
  },

  async onBalanceConfirmed(trx, { orderId, amount, currency, userId }) {
    const order = await trx('export_orders').where({ id: orderId }).first();
    if (!order) return;

    // Payment confirmation to the buyer: opt-in, after commit, in the
    // receipt's / order's own currency (P5-12).
    await customerEmail.sendCustomerEmail(trx, 'balance_confirmed', () => emailService.sendPaymentConfirmation({
      orderId,
      amount,
      currency: currency || order.currency || 'USD',
      userId,
    }));

    // Notification: "Ready to ship" — recipients by role NAME (PLT-15).
    const notificationService = require('../../services/notificationService');
    await notificationService.createForRole(trx, {
      roleName: 'Export Manager',
      title: 'Balance Received — Ready to Ship',
      message: `Full balance received for ${order.order_no}. Order is ready for shipment.`,
      type: 'payment',
      linkedRef: order.order_no,
    });

    // Create task: "Prepare final documents"
    const taskNo = `TSK-${Date.now().toString(36).toUpperCase()}`;
    const [docOfficers] = await notificationService.usersInRoles(trx, 'Documentation Officer');
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

    // Balance reminder to the buyer: opt-in, after commit (P5-12).
    await customerEmail.sendCustomerEmail(trx, 'bl_draft_approved',
      () => emailService.sendBalanceReminder({ orderId, userId }));

    // Create task for finance: follow up balance collection
    const notificationService = require('../../services/notificationService');
    const [financeManagers] = await notificationService.usersInRoles(trx, 'Finance Manager');
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
      // Recipients by role NAME — role ids differ between installs (e.g. Owner
      // is 9 on prod, 10 locally), so hard-coded ids reach the wrong people.
      const notificationService = require('../../services/notificationService');
      const finishedKg = parseFloat(batch.actual_finished_kg) || 0;
      await notificationService.createForRole(trx, {
        roleName: 'Export Manager',
        title: 'Milling Batch Completed',
        message: `Batch ${batch.batch_no} completed. ${finishedKg.toLocaleString('en-US', { maximumFractionDigits: 2 })} kg finished rice produced${order ? ` for order ${order.order_no}` : ''}.`,
        type: 'milling',
        linkedRef: batch.batch_no,
      });

      // Create task: arrange internal transfer
      const [invOfficers] = await notificationService.usersInRoles(trx, 'Inventory Officer');
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

    // Tells the (internal) uploader their file was approved — not a customer
    // email, so not opt-in; but sent only once the approval has committed.
    customerEmail.afterCommit(trx,
      () => emailService.sendDocumentApprovalNotification({ documentId, userId }),
      'Doc approval email');

    // Check if all docs are now complete
    const missingDocs = await trx('document_checklists')
      .where({ linked_type: 'export_order', linked_id: doc.linked_id, is_required: true, is_fulfilled: false })
      .count('id as count')
      .first();

    if (parseInt(missingDocs.count) === 0) {
      const order = await trx('export_orders').where({ id: doc.linked_id }).first();
      const notificationService = require('../../services/notificationService');
      await notificationService.createForRole(trx, {
        roleName: 'Export Manager',
        title: 'All Documents Complete',
        message: `All required documents for order ${order ? order.order_no : doc.linked_id} are now approved. Order is ready for shipment.`,
        type: 'document',
        linkedRef: order ? order.order_no : `ORD-${doc.linked_id}`,
      });
    }
  },

  async onShipmentDeparted(trx, { orderId, userId }) {
    const order = await trx('export_orders').where({ id: orderId }).first();
    if (!order) return;

    // Shipment notice to the buyer: opt-in, and only once the shipment's
    // transaction has COMMITTED — it used to fire before, so a rolled-back
    // departure could still tell the buyer the goods had sailed (PLT-14).
    await customerEmail.sendCustomerEmail(trx, 'shipment_departed',
      () => emailService.sendShipmentNotification({ orderId, userId }));

    // Domain separation (Phase 4): the actionable "chase the customer for the
    // balance" task belongs to the Export desk (it has the order/customer context).
    // Finance only gets a MASKED heads-up that an export balance is due for
    // confirmation — no order number or customer.
    const notificationService = require('../../services/notificationService');
    await notificationService.createForRole(trx, {
      roleName: 'Export Manager',
      title: 'Shipment departed — collect the balance',
      message: `Order ${order.order_no} has shipped. Collect the outstanding balance from the customer.`,
      type: 'shipment',
      linkedRef: order.order_no,
    });
    await notificationService.notifyFinance(trx, {
      title: 'Export balance pending confirmation',
      message: 'An export shipment has departed — a balance payment is now due for confirmation.',
      linkedRef: null,
    });
  },

  // ============================================================
  // Recurring mill expenses
  // ============================================================
  // Post every due occurrence of every recurring mill-expense series (the
  // "Run due" button). Each recurring business_expense series (category +
  // payee + cadence) has a latest occurrence; walk forward from it, creating
  // any missed occurrences up to today and not past the series' end date.
  // New occurrences are ACCRUED (pay_now=false) — never auto-paid. Each series
  // posts under its advisory lock with the duplicate-date guard, so a re-run,
  // a concurrent run or a "Post now" never double-posts.
  // NOTE (P2-27): no scheduled task runs this — a recurring expense is a
  // ledger posting, and the system does not post one unattended. It runs when
  // someone presses "Run due".
  async materializeDueRecurringExpenses({ userId = null } = {}) {
    const rows = await db('business_expenses')
      .where('expense_type', 'mill').where('is_recurring', true)
      .whereNotIn('category', PAYROLL_ONLY_HEADS)
      .select(SERIES_COLS)
      .orderBy('expense_date', 'desc').orderBy('id', 'desc');

    const latest = {};
    for (const e of rows) {
      const k = recurringSeriesKey(e);
      if (!latest[k]) latest[k] = e; // rows are date-desc → first seen is newest
    }

    const today = new Date().toISOString().slice(0, 10);
    let created = 0; const items = [];
    for (const e of Object.values(latest)) {
      await db.transaction(async (trx) => {
        await lockSeries(trx, e);
        // Re-read the series' newest row under the lock (another run may have
        // posted since the list above was read).
        const cur = await seriesRows(trx, e).first(SERIES_COLS);
        if (!cur) return;
        const end = cur.recurrence_end_date ? _isoDate(cur.recurrence_end_date) : null;
        let cursor = _isoDate(cur.expense_date);
        let guard = 0;
        while (guard++ < 240) { // cap catch-up at ~20 yrs monthly to avoid runaway
          const nextDue = _addInterval(cursor, cur.recurrence);
          if (nextDue > today || (end && nextDue > end)) break;
          const dup = await seriesRows(trx, cur).where('expense_date', nextDue).first('id');
          if (!dup) {
            const expense = await postSeriesOccurrence(trx, cur, nextDue, {
              userId, note: `Posted recurring (${cur.recurrence}) from ${cur.expense_no}`,
            });
            created++;
            items.push({ expense_no: expense?.expense_no || null, category: cur.category, date: nextDue, amount: parseFloat(cur.amount) });
          }
          cursor = nextDue;
        }
      });
    }
    return { processed: created, details: { created, items } };
  },

  // "Post now" on one series (`expenseId` = any row of it): posts the NEXT
  // occurrence through the same guard as "Run due" — only when it is due, not
  // past the end date, and not already posted.
  async materializeRecurringExpense(expenseId, { payNow = false, bankAccountId = null, paymentMethod = null, reference = null, userId = null, millOnly = false } = {}) {
    return db.transaction(async (trx) => {
      const tmpl = await trx('business_expenses').where('id', expenseId).where('expense_type', 'mill').first();
      if (!tmpl) throw httpError('Recurring expense not found.', 404);
      if (!tmpl.is_recurring) throw httpError('That expense is not recurring.', 400);
      if (PAYROLL_ONLY_HEADS.includes(String(tmpl.category || '').toLowerCase())) {
        throw httpError('Salaries are paid through Payroll — this recurring salary series can no longer be posted.', 400);
      }
      await lockSeries(trx, tmpl);
      const latest = await seriesRows(trx, tmpl).first(SERIES_COLS);
      const nextDue = _addInterval(latest.expense_date, latest.recurrence);
      const expense = await postSeriesOccurrence(trx, latest, nextDue, { payNow, bankAccountId, paymentMethod, reference, userId, millOnly });
      return { expense, next_due: nextDue };
    });
  },

  // Stop a recurring series: no occurrence after `endDate` (default today) is
  // ever posted. Already-posted occurrences are untouched.
  async stopRecurringSeries(expenseId, { endDate = null } = {}) {
    const tmpl = await db('business_expenses').where('id', expenseId).where('expense_type', 'mill').first();
    if (!tmpl) throw httpError('Recurring expense not found.', 404);
    if (!tmpl.is_recurring) throw httpError('That expense is not recurring.', 400);
    const end = endDate ? String(endDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || Number.isNaN(Date.parse(end))) throw httpError('A valid end date is required.', 400);
    const n = await seriesRows(db, tmpl).clearOrder().update({ recurrence_end_date: end, updated_at: db.fn.now() });
    return { series: recurringSeriesKey(tmpl), end_date: end, rows: n };
  },

  // Auto-PREPARE payroll for the schedule's entity (Mill or Head Office): the
  // month just closed for daily-wage staff, the current month for salaried
  // staff (payroll.service prepareScheduledPayroll). Runs land in the approval
  // queue as 'prepared' — NEVER auto-approved or auto-paid. Prepared by the
  // system (no user), so any approver may approve them. Idempotent: everyone
  // already in a run is skipped.
  async runScheduledPayrollPrepare(task) {
    const payroll = require('../milling/payroll.service');
    let cfg = {}; try { cfg = typeof task.config === 'string' ? JSON.parse(task.config) : (task.config || {}); } catch (e) { cfg = {}; }
    const results = await payroll.prepareScheduledPayroll({ entity: cfg.entity || 'mill', pay_method: cfg.pay_method || 'cash', userId: null });
    const runs = results.filter((r) => r.run);
    return {
      processed: runs.reduce((s, r) => s + (r.run.employee_count || 0), 0),
      details: {
        entity: cfg.entity || 'mill',
        runs: results.map((r) => ({ month: r.month, payType: r.payType, runId: r.run ? r.run.id : null, employees: r.run ? r.run.employee_count : 0, message: r.message || null })),
      },
    };
  },

  // Claim one due task for this runner. Two backend processes (or a restart
  // mid-run) must not both run it: the claim is an atomic conditional UPDATE
  // taken under a transaction-scoped advisory lock — the loser sees no row.
  async claimTask(task, now = new Date()) {
    return db.transaction(async (trx) => {
      const got = await trx.raw('SELECT pg_try_advisory_xact_lock(hashtext(?)) AS ok', [`scheduled_task:${task.id}`]);
      if (!got.rows[0].ok) return null;
      const stale = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
      const [row] = await trx('scheduled_tasks').where({ id: task.id, is_active: true })
        .where(function () { this.where('next_run', '<=', now.toISOString()).orWhereNull('next_run'); })
        .where(function () { this.whereNot('last_status', 'Running').orWhereNull('last_status').orWhere('updated_at', '<', stale); })
        .update({ last_status: 'Running', last_run: now.toISOString(), updated_at: trx.fn.now() })
        .returning('*');
      return row || null;
    });
  },

  async runDueScheduledTasks(now = new Date()) {
    const dueTasks = await db('scheduled_tasks')
      .where('is_active', true)
      .where(function () {
        this.where('next_run', '<=', now.toISOString()).orWhereNull('next_run');
      })
      .select('*');

    const results = [];
    for (const due of dueTasks) {
      const task = await this.claimTask(due, now);
      if (!task) continue; // another runner has it
      let status = 'Failed'; let error = null;
      try {
        const result = await this.runTask(task.id);
        status = result.status; error = result.error || null;
      } catch (err) {
        error = err.message;
      }
      results.push({ taskId: task.id, name: task.name, status, error });

      // Next run: a failure is retried on the next tick until MAX_TASK_ATTEMPTS,
      // then reported and moved on; anything else goes to its next calendar slot.
      const fresh = await db('scheduled_tasks').where({ id: task.id }).first();
      const attempts = (fresh && fresh.failure_count) || 0;
      const slot = nextSlot(due, now);
      let nextRun = slot.at;
      if (status === 'Failed' && attempts < MAX_TASK_ATTEMPTS) {
        nextRun = new Date(now.getTime() + 60 * 1000); // the next hourly tick
      } else if (status === 'Failed') {
        await this.reportTaskFailure(fresh || task, error, attempts);
        await db('scheduled_tasks').where({ id: task.id }).update({ failure_count: 0 });
      }
      if (!slot.known) await this.reportTaskFailure(fresh || task, `Unrecognised schedule "${task.cron_expression}" — running daily until it is corrected.`, 0);
      await db('scheduled_tasks').where({ id: task.id }).update({
        next_run: nextRun.toISOString(),
        updated_at: db.fn.now(),
      });
    }

    return results;
  },

  // Tell the admins a scheduled task gave up (it used to fail silently).
  async reportTaskFailure(task, error, attempts) {
    try {
      const notificationService = require('../../services/notificationService');
      for (const roleName of ['Super Admin', 'Owner']) {
        await notificationService.createForRole(null, {
          roleName,
          title: `Scheduled task failed: ${task.name}`,
          message: `${task.name} failed${attempts ? ` ${attempts} time(s)` : ''}: ${String(error || 'unknown error').slice(0, 300)}`,
          type: 'task',
          linkedRef: `TASK-${task.id}`,
        });
      }
    } catch (e) {
      console.error(`[scheduler] could not report failure of task ${task.id}:`, e.message);
    }
  },
};

module.exports = automationService;
