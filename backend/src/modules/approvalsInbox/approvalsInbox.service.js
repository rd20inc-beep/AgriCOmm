/**
 * ONE approvals inbox (P5-02, owner decision D-20 (a)).
 *
 * Every approval queue in the system, listed for the signed-in user and
 * filtered per type by the SAME guard the type's approve route checks — so the
 * badge counts exactly what this user can act on, and nothing they would be
 * refused. Approving / rejecting still goes through each type's own endpoint
 * (with its Owner-authorisation modal, maker-checker and audit trail); the
 * inbox only lists and links. No approval path is created here.
 *
 * Each source:
 *   type, label     the filter chip
 *   gate            the `authz` tag of the approve route's guard (rbac.js) —
 *                   approvalsInboxGates.test.js pins it to the real route
 *   route           [method, path] of that approve route (under /api)
 *   selfExempt      maker-checker: the person who made the item cannot approve
 *                   it unless their role is listed here (null = no rule)
 *   list(conn)      the pending rows → items { id, ref, title, summary,
 *                   amount, currency, requestedBy, requestedById, requestedAt,
 *                   link, action }
 *
 * Queues deliberately NOT listed (no approve step, or no screen to act on):
 *   - procurement requisitions / supplier invoices: creation retired (410);
 *     no screen approves them
 *   - internal transfers confirm-export: creation retired; Mill → Export moves
 *     are now immediate lot transfers
 *   - quality variance (milling_batches.variance_status): a QC decision on the
 *     batch, not a request waiting for an approver
 *   - suspense review, sync conflicts, exceptions: work queues, not approvals
 *   - Owner authorisations (ownerApproval middleware): an inline password step
 *     on the action itself, never a queue
 */
const db = require('../../config/database');
const { loadAccess, passesGuard, can } = require('../../services/accessContext');
const { safeLink } = require('../../services/routeAccess');
const { ACCEPT_PERMISSION } = require('../finance/transferAcceptPermission');

const LIMIT = 200;
const num = (v) => (v == null ? null : parseFloat(v));
const g = (kind, perms) => ({ kind, perms });
const roles = (...names) => ({ kind: 'authorizeRole', roles: names });

const SOURCES = [
  {
    type: 'master_data',
    label: 'Master data',
    gate: g('authorize', [['master_data', 'approve']]),
    route: ['post', '/admin/approvals/:type/:id/approve'],
    async list(conn) {
      const pick = (table) => conn(`${table} as t`)
        .leftJoin('users as s', 't.submitted_by', 's.id')
        .select('t.id', 't.name', 't.approval_status', 't.submitted_at', 't.submitted_by', 's.full_name as submitted_by_name')
        .orderBy('t.submitted_at', 'desc').limit(LIMIT);
      const [products, suppliers, customers] = await Promise.all([
        pick('products').where('t.approval_status', 'pending'),
        pick('suppliers').where('t.approval_status', 'pending'),
        pick('customers').select('t.pending_edit_at', 't.pending_edit_by')
          .where((w) => w.where('t.approval_status', 'pending').orWhereNotNull('t.pending_edit')),
      ]);
      const out = [];
      const add = (rows, kind, label) => rows.forEach((r) => {
        const isEdit = kind === 'customer' && r.approval_status !== 'pending';
        out.push({
          id: `${kind}:${r.id}`,
          ref: r.name,
          title: isEdit ? `Customer edit · ${r.name}` : `New ${label} · ${r.name}`,
          summary: isEdit ? 'Proposed change to an approved customer' : `Quick-added ${label} awaiting review`,
          requestedById: isEdit ? r.pending_edit_by : r.submitted_by,
          requestedBy: isEdit ? null : r.submitted_by_name,
          requestedAt: isEdit ? (r.pending_edit_at || r.submitted_at) : r.submitted_at,
          link: '/admin',
        });
      });
      add(products, 'product', 'product');
      add(suppliers, 'supplier', 'supplier');
      add(customers, 'customer', 'customer');
      return out;
    },
  },
  {
    type: 'document',
    label: 'Uploaded documents',
    gate: g('authorize', [['documents', 'approve']]),
    route: ['put', '/documents/:id/approve'],
    selfExempt: ['Owner'],
    async list(conn) {
      const rows = await conn('document_store as ds')
        .leftJoin('users as u', 'ds.uploaded_by', 'u.id')
        .leftJoin('users as p', 'ds.pending_by', 'p.id')
        .where((q) => q.where('ds.status', 'Pending Review').orWhere('ds.pending_action', 'delete'))
        .select('ds.id', 'ds.title', 'ds.file_name', 'ds.version', 'ds.status', 'ds.pending_action',
          'ds.linked_type', 'ds.linked_id', 'ds.created_at', 'ds.pending_at', 'ds.uploaded_by', 'ds.pending_by',
          'u.full_name as uploaded_by_name', 'p.full_name as pending_by_name')
        .orderBy('ds.created_at', 'desc').limit(LIMIT);
      return rows.map((r) => {
        const isDelete = r.pending_action === 'delete';
        return {
          id: r.id,
          ref: r.title || r.file_name,
          title: `${isDelete ? 'Delete' : 'Approve'} · ${r.title || r.file_name}`,
          summary: isDelete ? 'Deletion requested' : `New version${r.version ? ` v${r.version}` : ''}`,
          // Maker-checker applies to approving an upload, not to a deletion request.
          requestedById: isDelete ? null : r.uploaded_by,
          requestedBy: isDelete ? r.pending_by_name : r.uploaded_by_name,
          requestedAt: isDelete ? (r.pending_at || r.created_at) : r.created_at,
          link: r.linked_type === 'export_order' && r.linked_id ? `/export/${r.linked_id}` : '/documents',
          action: { kind: 'document', documentId: r.id, isDelete, fileName: r.file_name || r.title },
        };
      });
    },
  },
  {
    type: 'generated_document',
    label: 'Export documents',
    gate: g('authorize', [['documents', 'approve']]),
    route: ['put', '/export-orders/documents/:genId/approve'],
    selfExempt: ['Owner'],
    async list(conn) {
      const rows = await conn('generated_documents as gd')
        .leftJoin('users as u', 'gd.generated_by', 'u.id')
        .where('gd.status', 'Under Review')
        .where('gd.is_latest', true)
        .select('gd.id', 'gd.doc_no', 'gd.doc_type', 'gd.version', 'gd.order_id', 'gd.generated_by',
          'gd.generated_at', 'gd.created_at', 'u.full_name as generated_by_name')
        .orderBy('gd.created_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.doc_no,
        title: `${String(r.doc_type || 'Document').replace(/_/g, ' ')} · ${r.doc_no || ''}`.trim(),
        summary: `Version ${r.version || 1} under review`,
        requestedById: r.generated_by,
        requestedBy: r.generated_by_name,
        requestedAt: r.generated_at || r.created_at,
        link: r.order_id ? `/export/${r.order_id}` : null,
      }));
    },
  },
  {
    type: 'stock_adjustment',
    label: 'Stock adjustments',
    gate: g('authorize', [['inventory', 'approve_write_off']]),
    route: ['put', '/lot-inventory/adjustments/:id/approve'],
    async list(conn) {
      const rows = await conn('stock_adjustments as sa')
        .leftJoin('inventory_lots as l', 'sa.lot_id', 'l.id')
        .leftJoin('users as u', 'sa.requested_by', 'u.id')
        .where('sa.approval_status', 'pending_approval')
        .select('sa.id', 'sa.adjustment_type', 'sa.quantity_kg', 'sa.reason', 'sa.created_at', 'sa.requested_by',
          'l.lot_no', 'u.full_name as requested_by_name')
        .orderBy('sa.created_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.lot_no,
        title: `${String(r.adjustment_type || 'Adjustment').replace(/_/g, ' ')} · ${r.lot_no || `#${r.id}`}`,
        summary: [`${num(r.quantity_kg)} kg`, r.reason].filter(Boolean).join(' — '),
        requestedById: r.requested_by,
        requestedBy: r.requested_by_name,
        requestedAt: r.created_at,
        link: '/stock-adjustments',
      }));
    },
  },
  {
    type: 'store_adjustment',
    label: 'Store adjustments',
    gate: g('authorize', [['mill_store', 'approve_adjustment']]),
    route: ['put', '/mill-store/adjustments/:id/approve'],
    async list(conn) {
      const rows = await conn('mill_stock_adjustments as a')
        .leftJoin('mill_items as i', 'a.item_id', 'i.id')
        .leftJoin('users as u', 'a.requested_by', 'u.id')
        .where('a.status', 'Pending')
        .select('a.id', 'a.adjustment_type', 'a.quantity_delta', 'a.reason', 'a.created_at', 'a.requested_by',
          'i.name as item_name', 'i.unit', 'u.full_name as requested_by_name')
        .orderBy('a.created_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.item_name,
        title: `Store ${r.adjustment_type || 'adjustment'} · ${r.item_name || `item #${r.id}`}`,
        summary: [`${num(r.quantity_delta) > 0 ? '+' : ''}${num(r.quantity_delta)} ${r.unit || ''}`.trim(), r.reason].filter(Boolean).join(' — '),
        requestedById: r.requested_by,
        requestedBy: r.requested_by_name,
        requestedAt: r.created_at,
        link: '/mill-store/adjustments',
      }));
    },
  },
  {
    type: 'stock_count',
    label: 'Stock counts',
    gate: g('authorize', [['inventory', 'approve_write_off']]),
    route: ['put', '/control/stock-counts/:id/approve'],
    async list(conn) {
      // Ready to approve: in progress, every line counted (the approve step
      // refuses a count with uncounted lines).
      const rows = await conn('stock_counts as sc')
        .leftJoin('users as u', 'sc.created_by', 'u.id')
        .where('sc.status', 'In Progress')
        .whereExists(function hasItems() { this.select(conn.raw('1')).from('stock_count_items as i').whereRaw('i.stock_count_id = sc.id'); })
        .whereNotExists(function uncounted() {
          this.select(conn.raw('1')).from('stock_count_items as i').whereRaw('i.stock_count_id = sc.id').where('i.status', 'Pending');
        })
        .select('sc.id', 'sc.count_no', 'sc.count_type', 'sc.created_at', 'sc.updated_at', 'sc.created_by', 'u.full_name as created_by_name')
        .orderBy('sc.updated_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.count_no,
        title: `Stock count · ${r.count_no}`,
        summary: 'All lines counted — ready to approve',
        requestedById: r.created_by,
        requestedBy: r.created_by_name,
        requestedAt: r.updated_at || r.created_at,
        link: '/stock-count',
      }));
    },
  },
  {
    type: 'milling_batch',
    label: 'Milling batches',
    gate: roles('Owner', 'Super Admin'),
    route: ['put', '/milling/batches/:id/approve'],
    async list(conn) {
      const rows = await conn('milling_batches as b')
        .leftJoin('users as u', 'b.created_by', 'u.id')
        .where('b.status', 'Pending Approval')
        .select('b.id', 'b.batch_no', 'b.batch_name', 'b.created_by', 'b.updated_at', 'b.created_at', 'u.full_name as created_by_name')
        .orderBy('b.updated_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.batch_no,
        title: `Batch · ${r.batch_no}${r.batch_name ? ` (${r.batch_name})` : ''}`,
        summary: 'Yield recorded — awaiting approval',
        requestedById: r.created_by,
        requestedBy: r.created_by_name,
        requestedAt: r.updated_at || r.created_at,
        link: `/milling/${r.id}`,
      }));
    },
  },
  {
    type: 'export_receipt',
    label: 'Receipts to confirm',
    gate: g('authorize', [['finance', 'confirm_payment']]),
    route: ['post', '/export-orders/receipts/:paymentId/confirm'],
    selfExempt: ['Owner', 'Super Admin'],
    async list(conn) {
      // No customer and no order context: the Finance Manager confirms these
      // and must not see the export side (Phase 4 domain separation).
      const rows = await conn('payments as p')
        .join('receivables as r', 'p.linked_receivable_id', 'r.id')
        .join('export_orders as eo', 'r.order_id', 'eo.id')
        .leftJoin('users as u', 'p.created_by', 'u.id')
        .where('p.status', 'Pending Finance Confirmation')
        .select('p.id', 'p.payment_no', 'p.amount', 'p.currency', 'p.created_at', 'p.created_by',
          'r.type as receipt_type', 'u.full_name as recorded_by_name')
        .orderBy('p.created_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.payment_no,
        title: `${r.receipt_type ? `${String(r.receipt_type).charAt(0).toUpperCase()}${String(r.receipt_type).slice(1)} receipt` : 'Receipt'} · ${r.payment_no || `#${r.id}`}`,
        summary: 'Recorded — awaiting Finance confirmation',
        amount: num(r.amount),
        currency: (r.currency || 'USD').toUpperCase(),
        requestedById: r.created_by,
        requestedBy: r.recorded_by_name,
        requestedAt: r.created_at,
        link: '/finance/money-in/to-confirm',
      }));
    },
  },
  {
    type: 'fund_transfer',
    label: 'Funds to accept',
    // The accept route's guard resolves the permission from the transfer's
    // receiving side (transferAcceptPermission.js) — checked per row below.
    gateFor: (row) => (ACCEPT_PERMISSION[row.to_entity] ? g('authorize', [ACCEPT_PERMISSION[row.to_entity]]) : null),
    route: ['post', '/finance/fund-transfers/:id/accept'],
    async list(conn) {
      const rows = await conn('fund_transfers as ft')
        .leftJoin('users as u', 'ft.created_by', 'u.id')
        .where('ft.status', 'pending')
        .whereIn('ft.to_entity', Object.keys(ACCEPT_PERMISSION))
        .select('ft.id', 'ft.transfer_no', 'ft.amount', 'ft.currency', 'ft.from_entity', 'ft.to_entity',
          'ft.transfer_date', 'ft.created_at', 'ft.created_by', 'u.full_name as created_by_name')
        .orderBy('ft.transfer_date', 'desc').limit(LIMIT);
      const side = (e) => (e === 'general' ? 'Head Office' : 'Mill');
      return rows.map((r) => ({
        id: r.id,
        ref: r.transfer_no,
        title: `Accept funds · ${r.transfer_no}`,
        summary: `From ${side(r.from_entity)} to ${side(r.to_entity)}`,
        amount: num(r.amount),
        currency: (r.currency || 'PKR').toUpperCase(),
        requestedById: r.created_by,
        requestedBy: r.created_by_name,
        requestedAt: r.created_at || r.transfer_date,
        link: r.to_entity === 'mill' ? '/milling/finance' : '/finance',
        action: { kind: 'accept_transfer', transferId: r.id },
        _row: r,
      }));
    },
  },
  {
    type: 'payroll_run',
    label: 'Payroll runs',
    gate: g('authorize', [['payroll', 'approve']]),
    route: ['post', '/milling/payroll/runs/:id/approve'],
    selfExempt: ['Owner'],
    async list(conn) {
      const rows = await conn('mill_payroll_runs as r')
        .leftJoin('users as u', 'r.created_by', 'u.id')
        .where('r.status', 'prepared')
        .select('r.id', 'r.period', 'r.net_total', 'r.employee_count', 'r.created_at', 'r.created_by', 'u.full_name as created_by_name')
        .orderBy('r.created_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.period,
        title: `Payroll run · ${r.period}`,
        summary: `${r.employee_count || 0} employee(s) — prepared, awaiting approval`,
        amount: num(r.net_total),
        currency: 'PKR',
        requestedById: r.created_by,
        requestedBy: r.created_by_name,
        requestedAt: r.created_at,
        link: '/finance/payroll',
      }));
    },
  },
  {
    type: 'salary_advance',
    label: 'Salary advances',
    gate: g('authorize', [['payroll', 'approve']]),
    route: ['post', '/milling/advances/:id/approve'],
    async list(conn) {
      const rows = await conn('mill_worker_advances as a')
        .leftJoin('mill_workers as w', 'a.worker_id', 'w.id')
        .leftJoin('users as u', 'a.created_by', 'u.id')
        .where('a.approval_status', 'pending')
        .whereNull('a.voided_at')
        .select('a.id', 'a.amount', 'a.advance_date', 'a.created_at', 'a.created_by', 'w.name as worker_name', 'u.full_name as created_by_name')
        .orderBy('a.created_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.worker_name,
        title: `Salary advance · ${r.worker_name || `#${r.id}`}`,
        summary: 'Awaiting approval (Owner authorisation)',
        amount: num(r.amount),
        currency: 'PKR',
        requestedById: r.created_by,
        requestedBy: r.created_by_name,
        requestedAt: r.created_at || r.advance_date,
        link: '/finance/payroll',
      }));
    },
  },
  {
    type: 'leave_request',
    label: 'Leave requests',
    gate: g('authorize', [['payroll', 'approve']]),
    route: ['post', '/milling/payroll/leave-requests/:id/approve'],
    async list(conn) {
      const rows = await conn('mill_leave_requests as l')
        .leftJoin('mill_workers as w', 'l.worker_id', 'w.id')
        .where('l.status', 'pending')
        .select('l.id', 'l.from_date', 'l.to_date', 'l.days', 'l.created_at', 'w.name as worker_name')
        .orderBy('l.created_at', 'desc').limit(LIMIT);
      const d = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));
      return rows.map((r) => ({
        id: r.id,
        ref: r.worker_name,
        title: `Leave · ${r.worker_name || `#${r.id}`}`,
        summary: `${num(r.days)} day(s), ${d(r.from_date)} → ${d(r.to_date)}`,
        requestedAt: r.created_at,
        link: '/finance/payroll',
      }));
    },
  },
  {
    type: 'worker_request',
    label: 'Worker requests',
    gate: g('authorize', [['payroll', 'edit']]),
    route: ['post', '/milling/worker-requests/:id/resolve'],
    async list(conn) {
      const rows = await conn('mill_worker_requests as q')
        .leftJoin('mill_workers as w', 'q.worker_id', 'w.id')
        .where('q.status', 'pending')
        .select('q.id', 'q.type', 'q.subject', 'q.created_at', 'w.name as worker_name')
        .orderBy('q.created_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.worker_name,
        title: `${String(r.type || 'Request').replace(/_/g, ' ')} · ${r.worker_name || `#${r.id}`}`,
        summary: r.subject || 'Employee portal request',
        requestedAt: r.created_at,
        link: '/finance/payroll',
      }));
    },
  },
  {
    type: 'purchase_requirement',
    label: 'Purchase requests',
    gate: roles('Super Admin', 'Owner', 'Mill Manager'),
    route: ['post', '/purchase-requirements/:id/approve'],
    async list(conn) {
      const rows = await conn('purchase_requirements as pr')
        .leftJoin('users as u', 'pr.raised_by', 'u.id')
        .where('pr.status', 'pending')
        .select('pr.id', 'pr.pr_no', 'pr.item_name', 'pr.shortage_qty', 'pr.unit', 'pr.est_amount', 'pr.currency',
          'pr.created_at', 'pr.raised_by', 'u.full_name as raised_by_name')
        .orderBy('pr.created_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.pr_no,
        title: `${r.pr_no} · ${r.item_name || ''}`.trim(),
        summary: `Short ${num(r.shortage_qty) || 0} ${r.unit || ''}`.trim(),
        amount: num(r.est_amount),
        currency: (r.currency || 'PKR').toUpperCase(),
        requestedById: r.raised_by,
        requestedBy: r.raised_by_name,
        requestedAt: r.created_at,
        link: '/purchase-requirements',
      }));
    },
  },
  {
    type: 'packing_variance',
    label: 'Packing variances',
    gate: g('authorize', [['export_orders', 'edit']]),
    route: ['post', '/export-orders/:id/packing-weight/resolve'],
    async list(conn) {
      const rows = await conn('export_packing_weights as w')
        .join('export_orders as eo', 'w.order_id', 'eo.id')
        .leftJoin('users as u', 'w.recorded_by', 'u.id')
        .where('w.approval_status', 'pending')
        .select('w.id', 'w.order_id', 'w.variance_status', 'w.variance_pct', 'w.variance_kg', 'w.updated_at', 'w.created_at',
          'w.recorded_by', 'eo.order_no', 'u.full_name as recorded_by_name')
        .orderBy('w.updated_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.order_no,
        title: `Packing ${r.variance_status || 'variance'} · ${r.order_no}`,
        summary: `${num(r.variance_kg)} kg (${num(r.variance_pct)}%) outside tolerance — resolve with Owner authorisation`,
        requestedById: r.recorded_by,
        requestedBy: r.recorded_by_name,
        requestedAt: r.updated_at || r.created_at,
        link: `/export/${r.order_id}`,
      }));
    },
  },
  {
    type: 'local_sale',
    label: 'Local sales to confirm',
    gate: roles('Super Admin', 'Owner', 'Mill Manager'),
    route: ['post', '/local-sales/:id/confirm'],
    async list(conn) {
      // A multi-line sale is confirmed as one group (sale_group_no).
      const rows = await conn('local_sales as s')
        .leftJoin('users as u', 's.created_by', 'u.id')
        .where('s.status', 'Pending')
        .groupByRaw('COALESCE(s.sale_group_no, s.sale_no)')
        .select(conn.raw('COALESCE(s.sale_group_no, s.sale_no) as group_no'),
          conn.raw('MIN(s.id) as id'), conn.raw('SUM(s.total_amount) as total'),
          conn.raw('MIN(s.currency) as currency'), conn.raw('COUNT(*) as lines'),
          conn.raw('MIN(s.created_at) as created_at'), conn.raw('MIN(s.created_by) as created_by'),
          conn.raw('MIN(u.full_name) as created_by_name'))
        .orderByRaw('MIN(s.created_at) desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.group_no,
        title: `Local sale · ${r.group_no}`,
        summary: `${r.lines} line(s) awaiting confirmation`,
        amount: num(r.total),
        currency: (r.currency || 'PKR').toUpperCase(),
        requestedById: r.created_by,
        requestedBy: r.created_by_name,
        requestedAt: r.created_at,
        link: `/local-sales/${r.id}`,
      }));
    },
  },
  {
    type: 'approval_queue',
    label: 'Other requests',
    gate: g('authorize', [['admin', 'manage_settings']]),
    route: ['put', '/control/approvals/:id/approve'],
    async list(conn) {
      // The retired generic maker-checker queue: nothing new arrives, but any
      // request still pending is decided here (its own approve / reject routes).
      const rows = await conn('approval_queue as q')
        .leftJoin('users as u', 'q.requested_by', 'u.id')
        .where('q.status', 'Pending')
        .select('q.id', 'q.approval_type', 'q.entity_ref', 'q.entity_type', 'q.entity_id', 'q.amount', 'q.currency',
          'q.notes', 'q.requested_at', 'q.created_at', 'q.requested_by', 'u.full_name as requested_by_name')
        .orderBy('q.created_at', 'desc').limit(LIMIT);
      return rows.map((r) => ({
        id: r.id,
        ref: r.entity_ref,
        title: `${String(r.approval_type || 'Request').replace(/_/g, ' ')} · ${r.entity_ref || `${r.entity_type} #${r.entity_id}`}`,
        summary: r.notes || null,
        amount: num(r.amount),
        currency: r.amount != null ? (r.currency || 'PKR').toUpperCase() : null,
        requestedById: r.requested_by,
        requestedBy: r.requested_by_name,
        requestedAt: r.requested_at || r.created_at,
        link: null,
        action: { kind: 'approval_queue', approvalId: r.id },
      }));
    },
  },
];

const TYPES = SOURCES.map(({ type, label }) => ({ type, label }));

// Sources this user could act on at all (cheap — no queries for the rest).
function sourcesFor(access) {
  return SOURCES.filter((s) => (s.gateFor
    ? Object.values(ACCEPT_PERMISSION).some(([m, a]) => can(access, m, a))
    : passesGuard(access, s.gate)));
}

function blockedBySelf(source, item, access) {
  if (!source.selfExempt || item.requestedById == null) return false;
  if (source.selfExempt.includes(access.roleName)) return false;
  return Number(item.requestedById) === Number(access.id);
}

/**
 * The inbox for one user: { items, types: [{type,label,count}], count }.
 * `userOrAccess` is a user id / req.user, or an access object from accessContext.
 */
async function getInbox(userOrAccess, { conn = db } = {}) {
  const access = userOrAccess && userOrAccess.permissions instanceof Set
    ? userOrAccess
    : await loadAccess(userOrAccess, conn);
  if (!access) return { items: [], types: [], count: 0 };

  const sources = sourcesFor(access);
  const lists = await Promise.all(sources.map(async (s) => {
    try {
      return [s, await s.list(conn)];
    } catch (err) {
      // One broken queue must not blank the whole inbox.
      console.error(`approvals inbox: ${s.type} failed:`, err.message);
      return [s, []];
    }
  }));

  const items = [];
  for (const [s, rows] of lists) {
    for (const it of rows) {
      if (s.gateFor) {
        const gate = s.gateFor(it._row);
        if (!gate || !passesGuard(access, gate)) continue;
      }
      if (blockedBySelf(s, it, access)) continue;
      const { _row, ...item } = it;
      items.push({
        ...item,
        key: `${s.type}:${item.id}`,
        type: s.type,
        typeLabel: s.label,
        amount: item.amount ?? null,
        currency: item.currency ?? null,
        requestedBy: item.requestedBy ?? null,
        summary: item.summary ?? null,
        action: item.action || null,
        link: safeLink(access, item.link),
      });
    }
  }
  const t = (v) => (v ? new Date(v).getTime() : 0);
  items.sort((a, b) => t(b.requestedAt) - t(a.requestedAt));

  const counts = new Map();
  for (const it of items) counts.set(it.type, (counts.get(it.type) || 0) + 1);
  const types = TYPES.filter((x) => counts.has(x.type)).map((x) => ({ ...x, count: counts.get(x.type) }));
  return { items, types, count: items.length };
}

module.exports = { SOURCES, TYPES, getInbox, sourcesFor };
