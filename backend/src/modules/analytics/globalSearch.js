/**
 * Global search (P5-03, W11/W12) — the ONE cross-record lookup behind both the
 * header search box (GET /api/search) and the Reports hero search
 * (GET /api/reporting/search). Finds export orders, milling batches (number,
 * name, custom tags), lots, customers, suppliers, transporters, local sales,
 * receivables, payables, payments, bank transactions, expenses, documents and
 * shipment containers by number / name / reference.
 *
 * Every record type is filtered by the caller's permission — the same gate the
 * page it links to sits behind — so a result never names a record its role
 * cannot open:
 *
 *   export orders, containers  export_orders.view
 *   milling batches            milling.view (service batches: service_milling.view)
 *   lots                       inventory.view, inside the user's warehouse scope
 *   local sales                inventory.view OR finance.view
 *   receivables / payables /   finance.view (they open the Finance drawers)
 *   payments / bank / expenses
 *   customers                  finance.view → the party statement (W11)
 *   suppliers                  finance.view → the party statement (W12);
 *                              else reports.view → the supplier ledger
 *   transporters               admin.view → the transporter ledger
 *   documents                  documents.view (+ the linked record's gate)
 *
 * A module-scoped user (user_scopes 'module') only gets types whose module is
 * in the allow-list. A party-masked role (partyMask.js) gets no party matches
 * and no party names, and cannot find a record BY a party name either.
 * Amounts appear only on finance-gated results (finance.view), so the QC
 * Analyst / Mill Operator / Inventory Officer see references, never money.
 *
 * Ranking: an exact number match first, then a prefix match, then the rest
 * newest-first; groups are ordered by their best match. Each type is capped.
 * Read-only.
 */
const db = require('../../config/database');
const { userHasPermission } = require('../../middleware/rbac');
const { isPartyMasked } = require('../../shared/partyMask');
const { resolveWarehouseScope, applyWarehouseScope } = require('../../utils/warehouseScope');

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 6;
const NOT_MONEY = ['Pending Finance Confirmation', 'Rejected', 'Superseded'];
const num = (v) => (v == null ? null : parseFloat(v) || 0);

// Escape LIKE wildcards so a user typing "50%" or "A_1" matches literally.
const escapeLike = (s) => s.replace(/[%_\\]/g, (c) => `\\${c}`);

function parseCustomTags(v) {
  if (v == null) return [];
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v : [];
}

/**
 * The caller's permission check for this request: the rbac permission (Owner /
 * Super Admin bypass) AND, for a module-scoped user, the module allow-list —
 * the same two checks authorize() makes.
 */
async function permissionChecker(req) {
  let roleName = req.user && req.user._roleName;
  if (!roleName && req.user && req.user.role_id) {
    const r = await db('roles').where({ id: req.user.role_id }).first('name');
    roleName = r && r.name;
  }
  const bypass = roleName === 'Super Admin' || roleName === 'Owner';
  let scopes = null;
  if (!bypass) {
    const rows = await db('user_scopes').where({ user_id: req.user.id, scope_type: 'module' }).pluck('scope_value');
    if (rows.length) scopes = new Set(rows);
  }
  const cache = new Map();
  return async (module, action) => {
    const key = `${module}.${action}`;
    if (!cache.has(key)) {
      const ok = (await userHasPermission(req, module, action)) && (bypass || !scopes || scopes.has(module));
      cache.set(key, ok);
    }
    return cache.get(key);
  };
}

/**
 * rank: 0 = a reference column equals the term (case-insensitive), 1 = starts
 * with it, 2 = contains it somewhere else.
 */
function rankSql(cols, term, prefix) {
  const eq = cols.map((c) => `lower(COALESCE(${c}::text, '')) = lower(?)`).join(' OR ');
  const pre = cols.map((c) => `${c}::text ILIKE ?`).join(' OR ');
  return db.raw(`CASE WHEN ${eq} THEN 0 WHEN ${pre} THEN 1 ELSE 2 END AS rank`, [
    ...cols.map(() => term), ...cols.map(() => prefix),
  ]);
}

function whereAnyLike(q, cols, like) {
  return q.where(function () {
    cols.forEach((c, i) => {
      if (i === 0) this.whereRaw(`${c}::text ILIKE ?`, [like]);
      else this.orWhereRaw(`${c}::text ILIKE ?`, [like]);
    });
  });
}

const statementHref = (type, id, local) =>
  `/finance/accounting/statements?type=${type}&id=${id}${local ? '&scope=local' : ''}`;

function documentHref(d, can) {
  if (d.linked_id) {
    if (d.linked_type === 'export_order' && can.exportView) return `/export/${d.linked_id}`;
    if (d.linked_type === 'milling_batch' && can.millingView) return `/milling/${d.linked_id}`;
    if (d.linked_type === 'local_sale' && can.salesView) return `/local-sales/${d.linked_id}`;
  }
  return '/documents';
}

/**
 * @param {object} req      the authenticated request (permissions are read from it)
 * @param {object} opts     { q, limit, entity } — entity 'mill' keeps the legacy
 *                          Reports-hero behaviour of hiding export orders.
 * @returns {Promise<{query: string, groups: Array}>}
 */
async function globalSearch(req, { q, limit, entity } = {}) {
  const term = String(q || '').trim().slice(0, 100);
  if (term.length < 2) return { query: term, groups: [] };
  const esc = escapeLike(term);
  const like = `%${esc}%`;
  const prefix = `${esc}%`;
  const cap = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const isMill = entity === 'mill';

  const has = await permissionChecker(req);
  const [exportView, millingView, serviceView, inventoryView, financeView, reportsView, adminView, documentsView, masked] =
    await Promise.all([
      has('export_orders', 'view'), has('milling', 'view'), has('service_milling', 'view'),
      has('inventory', 'view'), has('finance', 'view'), has('reports', 'view'),
      has('admin', 'view'), has('documents', 'view'), isPartyMasked(req),
    ]);
  const can = {
    exportView: exportView && !isMill,
    millingView,
    serviceView,
    lotsView: inventoryView,
    salesView: inventoryView || financeView,
    financeView,
    customers: financeView && !masked,
    suppliers: (financeView || reportsView) && !masked,
    transporters: adminView && !masked,
    documentsView,
  };
  const money = financeView; // amounts only where the record is finance-gated
  const none = Promise.resolve([]);
  const scope = can.lotsView ? await resolveWarehouseScope(req) : null;

  const [orders, containers, batches, lots, sales, customers, suppliers, haulers,
    receivables, payables, payments, bankTx, expenses, documents] = await Promise.all([
    // Export orders by number / booking / product — and by buyer for an unmasked role.
    can.exportView ? whereAnyLike(
      db('export_orders as eo').leftJoin('customers as c', 'eo.customer_id', 'c.id'),
      ['eo.order_no', 'eo.booking_no', 'eo.product_name', ...(masked ? [] : ['c.name'])], like,
    ).select('eo.id', 'eo.order_no', 'eo.product_name', 'eo.status', 'c.name as customer',
      rankSql(['eo.order_no', 'eo.booking_no'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'eo.id', order: 'desc' }]).limit(cap) : none,
    can.exportView ? db('shipment_containers as sc')
      .leftJoin('export_orders as eo', 'sc.order_id', 'eo.id')
      .where('sc.container_no', 'ilike', like)
      .select('sc.id', 'sc.container_no', 'sc.order_id', 'eo.order_no', rankSql(['sc.container_no'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'sc.id', order: 'desc' }]).limit(cap) : none,
    // Milling batches: number, name, custom tags. Service batches only for
    // service_milling.view, regular ones only for milling.view.
    (can.millingView || can.serviceView) ? whereAnyLike(
      db('milling_batches as mb').leftJoin('export_orders as eo', 'mb.linked_export_order_id', 'eo.id'),
      ['mb.batch_no', 'mb.batch_name', 'mb.custom_tags'], like,
    ).where(function () {
      if (!can.millingView) this.where('mb.is_service_milling', true);
      else if (!can.serviceView) this.where((w) => w.where('mb.is_service_milling', false).orWhereNull('mb.is_service_milling'));
    }).select('mb.id', 'mb.batch_no', 'mb.batch_name', 'mb.custom_tags', 'mb.status', 'mb.is_service_milling',
      'eo.product_name', rankSql(['mb.batch_no', 'mb.batch_name'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'mb.id', order: 'desc' }]).limit(cap) : none,
    // Lots inside the caller's warehouse scope.
    can.lotsView ? applyWarehouseScope(whereAnyLike(
      db('inventory_lots as l').leftJoin('suppliers as s', 'l.supplier_id', 's.id'),
      ['l.lot_no', 'l.item_name', 'l.batch_ref', 'l.blend_batch_no'], like,
    ), scope, 'l.warehouse_id')
      .select('l.id', 'l.lot_no', 'l.item_name', 'l.type', 'l.status', 's.name as supplier',
        rankSql(['l.lot_no'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'l.id', order: 'desc' }]).limit(cap) : none,
    // Local sales / invoices, one row per invoice (sale group).
    can.salesView ? whereAnyLike(
      db('local_sales as ls'),
      ['ls.sale_no', 'ls.sale_group_no', 'ls.gate_pass_no', 'ls.item_name', ...(masked ? [] : ['ls.buyer_name'])], like,
    ).groupByRaw('COALESCE(ls.sale_group_no, ls.sale_no)')
      .select(
        db.raw('MIN(ls.id) AS id'), db.raw('COALESCE(ls.sale_group_no, ls.sale_no) AS ref'),
        db.raw('MIN(ls.buyer_name) AS buyer_name'), db.raw('MIN(ls.item_name) AS item_name'),
        db.raw('MIN(ls.status) AS status'), db.raw('SUM(ls.total_amount) AS total'), db.raw('SUM(ls.due_amount) AS due'),
        db.raw(`MIN(CASE WHEN lower(COALESCE(ls.sale_no,'')) = lower(?) OR lower(COALESCE(ls.sale_group_no,'')) = lower(?) THEN 0
                         WHEN ls.sale_no ILIKE ? OR ls.sale_group_no ILIKE ? THEN 1 ELSE 2 END) AS rank`, [term, term, prefix, prefix]),
      )
      .orderBy([{ column: 'rank' }, { column: 'id', order: 'desc' }]).limit(cap) : none,
    can.customers ? db('customers').where('name', 'ilike', like)
      .select('id', 'name', 'customer_type', 'country', rankSql(['name'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'name' }]).limit(cap) : none,
    can.suppliers ? whereAnyLike(db('suppliers'), ['name', 'supplier_code'], like)
      .select('id', 'name', 'supplier_code', rankSql(['name', 'supplier_code'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'name' }]).limit(cap) : none,
    can.transporters ? db('haulers').where('name', 'ilike', like)
      .select('id', 'name', rankSql(['name'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'name' }]).limit(cap) : none,
    // Finance documents and transactions (finance.view) — same filters as the
    // Finance header search (transactionDetail.search).
    can.financeView ? db('receivables as r')
      .leftJoin('export_orders as o', 'o.id', 'r.order_id')
      .whereNull('r.local_sale_id')
      .where((w) => w.where('r.recv_no', 'ilike', like).orWhere('o.order_no', 'ilike', like))
      .select('r.id', 'r.recv_no', 'r.type', 'r.currency', 'r.outstanding', 'r.status', 'o.order_no',
        rankSql(['r.recv_no'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'r.id', order: 'desc' }]).limit(cap) : none,
    can.financeView ? db('payables')
      .whereNot('status', 'Reversed')
      .where((w) => w.where('pay_no', 'ilike', like).orWhere('linked_ref', 'ilike', like))
      .select('id', 'pay_no', 'linked_ref', 'currency', 'outstanding', 'status', rankSql(['pay_no', 'linked_ref'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'id', order: 'desc' }]).limit(cap) : none,
    can.financeView ? db('payments')
      .whereNotIn('status', NOT_MONEY)
      .where((w) => w.where('payment_no', 'ilike', like).orWhere('bank_reference', 'ilike', like))
      .select('id', 'payment_no', 'bank_reference', 'type', 'amount', 'currency', 'payment_date', 'status',
        rankSql(['payment_no', 'bank_reference'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'id', order: 'desc' }]).limit(cap) : none,
    can.financeView ? db('bank_transactions')
      .where((w) => w.where('transaction_no', 'ilike', like).orWhere('reference', 'ilike', like))
      .select('id', 'transaction_no', 'reference', 'type', 'amount', 'currency', 'transaction_date',
        rankSql(['transaction_no', 'reference'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'id', order: 'desc' }]).limit(cap) : none,
    can.financeView ? db('business_expenses')
      .where((w) => w.where('expense_no', 'ilike', like).orWhere('invoice_reference', 'ilike', like))
      .select('id', 'expense_no', 'amount_pkr', 'paid_amount', 'payment_status', rankSql(['expense_no', 'invoice_reference'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'id', order: 'desc' }]).limit(cap) : none,
    // Documents (latest version only).
    can.documentsView ? whereAnyLike(db('document_store as ds').where('ds.is_latest', true),
      ['ds.doc_uid', 'ds.title', 'ds.file_name'], like)
      .select('ds.id', 'ds.doc_uid', 'ds.title', 'ds.doc_type', 'ds.status', 'ds.linked_type', 'ds.linked_id',
        rankSql(['ds.doc_uid', 'ds.title'], term, prefix))
      .orderBy([{ column: 'rank' }, { column: 'ds.id', order: 'desc' }]).limit(cap) : none,
  ]);

  const amount = (v) => (money ? num(v) : undefined);
  const r = (row) => Number(row.rank);
  const groups = [
    { key: 'orders', label: 'Export orders', items: orders.map((o) => ({
      id: o.id, title: o.order_no || `Order #${o.id}`, rank: r(o),
      subtitle: [o.product_name, masked ? null : o.customer, o.status].filter(Boolean).join(' · '),
      href: `/export/${o.id}` })) },
    { key: 'containers', label: 'Containers', items: containers.map((c) => ({
      id: c.id, title: c.container_no, rank: r(c),
      subtitle: `Export order ${c.order_no || `#${c.order_id}`}`, href: `/export/${c.order_id}` })) },
    { key: 'batches', label: 'Milling batches', items: batches.map((b) => ({
      id: b.id, title: b.batch_no, rank: r(b), batchName: b.batch_name || null, customTags: parseCustomTags(b.custom_tags),
      subtitle: [b.batch_name, b.is_service_milling ? 'Service milling' : (b.product_name || 'Batch'), b.status].filter(Boolean).join(' · '),
      href: b.is_service_milling ? `/service-milling/${b.id}` : `/milling/${b.id}` })) },
    { key: 'lots', label: 'Lots', items: lots.map((l) => ({
      id: l.id, title: l.lot_no, rank: r(l),
      subtitle: [l.item_name || '—', masked ? null : l.supplier, l.status].filter(Boolean).join(' · '),
      href: `/lot-inventory/${l.id}` })) },
    { key: 'sales', label: 'Local sales', items: sales.map((s) => ({
      id: Number(s.id), title: s.ref || `Sale #${s.id}`, rank: r(s),
      subtitle: [s.item_name, masked ? null : s.buyer_name, s.status].filter(Boolean).join(' · '),
      amount: amount(s.total), outstanding: amount(s.due), currency: money ? 'PKR' : undefined,
      href: `/local-sales/${s.id}` })) },
    { key: 'customers', label: 'Customers', items: customers.map((c) => ({
      id: c.id, title: c.name, rank: r(c), party: 'customer',
      subtitle: `Customer statement${c.customer_type === 'local' ? ' · local' : (c.country ? ` · ${c.country}` : '')}`,
      href: statementHref('customer', c.id, c.customer_type === 'local') })) },
    { key: 'suppliers', label: 'Suppliers', items: suppliers.map((s) => ({
      id: s.id, title: s.name, rank: r(s), party: 'supplier',
      subtitle: can.financeView ? 'Supplier statement' : 'Supplier ledger',
      href: can.financeView ? statementHref('supplier', s.id) : `/reports/supplier-ledger/${s.id}` })) },
    { key: 'transporters', label: 'Transporters', items: haulers.map((h) => ({
      id: h.id, title: h.name, rank: r(h), party: 'transporter',
      subtitle: 'Transporter ledger', href: `/admin?tab=haulers&hauler=${h.id}` })) },
    { key: 'receivables', label: 'Receivables', items: receivables.map((x) => ({
      id: x.id, title: x.recv_no || `Receivable #${x.id}`, rank: r(x),
      subtitle: [x.order_no || x.type, x.status].filter(Boolean).join(' · '),
      outstanding: amount(x.outstanding), currency: x.currency || 'USD',
      href: `/finance/money-in?open=receivable:${x.id}` })) },
    { key: 'payables', label: 'Payables', items: payables.map((x) => ({
      id: x.id, title: x.pay_no || `Payable #${x.id}`, rank: r(x),
      subtitle: [x.linked_ref, x.status].filter(Boolean).join(' · '),
      outstanding: amount(x.outstanding), currency: x.currency || 'PKR',
      href: `/finance/money-out?open=payable:${x.id}` })) },
    { key: 'payments', label: 'Payments', items: payments.map((p) => ({
      id: p.id, title: p.payment_no || `Payment #${p.id}`, rank: r(p),
      subtitle: [p.type === 'receipt' ? 'Received' : 'Paid', p.bank_reference, p.status].filter(Boolean).join(' · '),
      amount: amount(p.amount), currency: p.currency,
      href: `/finance/${p.type === 'receipt' ? 'money-in' : 'money-out'}?open=payment:${p.id}` })) },
    { key: 'bank', label: 'Bank transactions', items: bankTx.map((b) => ({
      id: b.id, title: b.transaction_no || b.reference || `Bank #${b.id}`, rank: r(b),
      subtitle: [b.type === 'credit' ? 'In' : 'Out', b.reference].filter(Boolean).join(' · '),
      amount: amount(b.amount), currency: b.currency,
      href: `/finance/accounts?open=bank:${b.id}` })) },
    { key: 'expenses', label: 'Expenses', items: expenses.map((e) => ({
      id: e.id, title: e.expense_no || `Expense #${e.id}`, rank: r(e),
      subtitle: e.payment_status || 'Expense',
      outstanding: money ? Math.max(0, num(e.amount_pkr) - num(e.paid_amount)) : undefined, currency: 'PKR',
      href: `/finance/money-out/expenses?open=expense:${e.id}` })) },
    { key: 'documents', label: 'Documents', items: documents.map((d) => ({
      id: d.id, title: d.doc_uid || d.title, rank: r(d),
      subtitle: [d.title !== d.doc_uid ? d.title : null, d.status].filter(Boolean).join(' · '),
      href: documentHref(d, can) })) },
  ].filter((g) => g.items.length);

  // Stable: groups keep their declared order unless one has a better match.
  const best = (g) => Math.min(...g.items.map((i) => i.rank));
  groups.forEach((g, i) => { g.order = i; g.bestRank = best(g); });
  groups.sort((a, b) => a.bestRank - b.bestRank || a.order - b.order);
  for (const g of groups) {
    delete g.order;
    for (const it of g.items) {
      for (const k of ['amount', 'outstanding', 'currency']) if (it[k] === undefined) delete it[k];
    }
  }
  return { query: term, groups };
}

/** GET handler shared by /api/search and /api/reporting/search. */
async function searchHandler(req, res) {
  try {
    const { q, limit, entity } = req.query;
    const data = await globalSearch(req, { q, limit, entity });
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('Global search error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

module.exports = { globalSearch, searchHandler, escapeLike };
