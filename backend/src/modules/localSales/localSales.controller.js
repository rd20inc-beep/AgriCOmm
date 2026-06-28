/**
 * Local Sales Controller — Sell inventory in the domestic market (PKR).
 */

const db = require('../../config/database');
const uc = require('../../services/unitConversion');
const inventoryService = require('../../services/inventoryService');
const accountingService = require('../accounting/accounting.service');
const { resolveCashAccountId } = require('../../shared/cashAccounts');

async function generateSaleNo(trx) {
  const count = await (trx || db)('local_sales').count('id as c').first();
  return `LS-${String((parseInt(count?.c) || 0) + 1).padStart(4, '0')}`;
}

// Which account a receipt lands in: cash → the cash-type account; bank transfer
// → the chosen bank account; cheque (uncleared) / credit (unpaid) → none.
async function resolveReceiptAccountId(trx, { paymentMode, bankAccountId, amount, collectionLocation }) {
  if (!(amount > 0)) return null;
  if (paymentMode === 'bank_transfer') return bankAccountId || null;
  if (paymentMode === 'cash') {
    // Local sales are mill sales — cash collected lands in the Mill's cash float
    // (Mill Cash) unless it was explicitly collected at Head Office.
    return resolveCashAccountId(trx, { entity: 'mill', collectionLocation: collectionLocation || null });
  }
  return null;
}

// Move a receiving account's balance by the amount received and drop a Cash &
// Bank sub-ledger row (linked to the payment so a delete can reverse it).
async function postReceiptToAccount(trx, { accountId, amount, paymentId, reference, notes, date, userId }) {
  if (!accountId || !(amount > 0)) return;
  await trx('bank_accounts').where({ id: accountId }).increment('current_balance', amount);
  const lastBt = await trx('bank_transactions').where('transaction_no', 'like', 'BT-%').orderBy('id', 'desc').first('transaction_no');
  const seq = lastBt ? (parseInt(String(lastBt.transaction_no).replace(/^BT-/, ''), 10) || 0) + 1 : 1;
  await trx('bank_transactions').insert({
    transaction_no: `BT-${String(seq).padStart(4, '0')}`, bank_account_id: accountId,
    type: 'credit', amount, currency: 'PKR', status: 'posted',
    transaction_date: date || new Date(), reference: reference || null,
    notes: notes || null, source: 'local_sale', linked_payment_id: paymentId, created_by: userId || null,
  });
}

// Assemble the Invoice 360 payload for one local sale (the sale row IS the
// invoice). `includeAdmin` adds internal financials (COGS/margin/remaining
// stock) + linked records — callers MUST gate that on role. Returns null if
// the sale is not found. Read-only; no create/stock/payment side effects.
async function assembleInvoice(id, includeAdmin = false) {
  const num = (v) => parseFloat(v) || 0;
  const isNumeric = /^\d+$/.test(String(id));

  const base = await db('local_sales as ls')
    .leftJoin('customers as c', 'ls.customer_id', 'c.id')
    .leftJoin('users as u', 'u.id', 'ls.created_by')
    .where(isNumeric ? { 'ls.id': parseInt(id, 10) } : { 'ls.sale_no': id })
    .select('ls.*', 'c.name as customer_name', 'c.phone as customer_phone',
      'c.address as customer_address', 'c.contact_person as customer_contact', 'c.email as customer_email',
      'u.full_name as created_by_name')
    .first();
  if (!base) return null;

  const itemQuery = db('local_sales as ls')
    .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
    .leftJoin('warehouses as w', 'il.warehouse_id', 'w.id');
  if (base.sale_group_no) itemQuery.where('ls.sale_group_no', base.sale_group_no);
  else itemQuery.where('ls.id', base.id);
  const rows = await itemQuery.select(
    'ls.id', 'ls.sale_no', 'ls.item_name', 'ls.item_type', 'ls.quantity_kg', 'ls.quantity_bags',
    'ls.bag_weight_kg', 'ls.rate_per_kg', 'ls.rate_input', 'ls.rate_unit', 'ls.quantity_unit',
    'ls.total_amount', 'ls.lot_id', 'ls.lot_no',
    // admin-only financial columns (selected always, exposed only when includeAdmin)
    'ls.cost_per_kg', 'ls.landed_cost_total', 'ls.cogs_total_pkr', 'ls.gross_profit', 'ls.margin_pct',
    'il.lot_no as lot_ref', 'il.type as lot_type', 'il.variety as lot_variety',
    'il.grade as lot_grade', 'il.item_name as lot_item_name', 'il.warehouse_id', 'il.batch_ref',
    'il.processing_type', 'il.available_qty as lot_available_qty', 'il.net_weight_kg as lot_net_weight_kg',
    'w.name as warehouse_name',
  ).orderBy('ls.id', 'asc');

  // Resolve source batches + their source purchased rice lots for milled output.
  const batchIds = [...new Set(rows
    .map(r => (r.batch_ref ? parseInt(String(r.batch_ref).replace(/^batch-/, ''), 10) : null))
    .filter(Boolean))];
  const batchById = {}; const srcByBatch = {};
  if (batchIds.length) {
    const batches = await db('milling_batches').whereIn('id', batchIds).select('id', 'batch_no');
    for (const b of batches) batchById[b.id] = b;
    const srcs = await db('batch_source_lots as bsl')
      .leftJoin('inventory_lots as src', 'bsl.lot_id', 'src.id')
      .leftJoin('suppliers as s', 'src.supplier_id', 's.id')
      .whereIn('bsl.batch_id', batchIds)
      .select('bsl.batch_id', 'bsl.qty_mt', 'src.id as lot_id', 'src.lot_no',
        db.raw("COALESCE(s.name, '—') as supplier"));
    for (const s of srcs) (srcByBatch[s.batch_id] = srcByBatch[s.batch_id] || []).push({
      lotId: s.lot_id, lotNo: s.lot_no, supplier: s.supplier, qtyMt: num(s.qty_mt),
      href: s.lot_id ? `/lot-inventory/${s.lot_id}` : null,
    });
  }

  const items = rows.map(r => {
    const batchId = r.batch_ref ? parseInt(String(r.batch_ref).replace(/^batch-/, ''), 10) : null;
    const b = batchId ? batchById[batchId] : null;
    const item = {
      id: r.id, saleNo: r.sale_no,
      riceType: r.lot_variety || r.lot_item_name || r.item_name || '—',
      gradeProduct: r.item_name || r.lot_grade || '—',
      itemType: r.item_type || null,
      quantityKg: num(r.quantity_kg), quantityMt: num(r.quantity_kg) / 1000,
      unit: r.quantity_unit || 'kg', bags: r.quantity_bags != null ? Number(r.quantity_bags) : null,
      bagWeightKg: num(r.bag_weight_kg) || null,
      ratePerKg: num(r.rate_per_kg), rateInput: num(r.rate_input), rateUnit: r.rate_unit || 'kg',
      amount: num(r.total_amount),
      lotId: r.lot_id, lotNo: r.lot_no || r.lot_ref || null,
      lotType: r.lot_type || null, warehouse: r.warehouse_name || null,
      isBlend: r.processing_type === 'blended',
      batchId: b ? b.id : null, batchNo: b ? b.batch_no : null,
      batchHref: b ? `/milling/${b.id}` : null,
      finishedGoodsHref: r.lot_id ? `/lot-inventory/${r.lot_id}` : null,
      sourceLots: batchId ? (srcByBatch[batchId] || []) : [],
    };
    if (includeAdmin) {
      const cogs = num(r.cogs_total_pkr) || num(r.landed_cost_total) || num(r.cost_per_kg) * num(r.quantity_kg);
      item.costPerKg = num(r.cost_per_kg);
      item.cogs = cogs;
      item.grossMargin = num(r.total_amount) - cogs;
      item.marginPct = num(r.total_amount) > 0 ? ((num(r.total_amount) - cogs) / num(r.total_amount)) * 100 : 0;
      item.remainingStockKg = num(r.lot_net_weight_kg) || num(r.lot_available_qty) * 1000;
    }
    return item;
  });

  // Intake (purchase) vehicles — the trucks each item's source rice lot(s)
  // arrived on (milling_vehicle_arrivals, scoped by lot or batch). Surfaced for
  // traceability alongside the outbound sale/dispatch vehicle.
  const arrLotIds = new Set(); const arrBatchIds = new Set();
  for (const it of items) {
    if (it.lotId) arrLotIds.add(it.lotId);
    if (it.batchId) arrBatchIds.add(it.batchId);
    for (const sl of (it.sourceLots || [])) if (sl.lotId) arrLotIds.add(sl.lotId);
  }
  let arrivals = [];
  if (arrLotIds.size || arrBatchIds.size) {
    arrivals = await db('milling_vehicle_arrivals')
      .where(function () {
        if (arrLotIds.size) this.whereIn('lot_id', [...arrLotIds]);
        if (arrBatchIds.size) this.orWhereIn('batch_id', [...arrBatchIds]);
      })
      .select('id', 'lot_id', 'batch_id', 'vehicle_no', 'driver_name', 'driver_phone', 'weight_mt', 'total_bags', 'arrival_date');
  }
  const fmtVeh = (a) => ({ vehicleNo: a.vehicle_no, driverName: a.driver_name || null, driverPhone: a.driver_phone || null, weightMt: num(a.weight_mt), totalBags: a.total_bags || null, arrivalDate: a.arrival_date || null });
  for (const it of items) {
    const srcIds = new Set((it.sourceLots || []).map(s => s.lotId).filter(Boolean));
    if (it.lotId) srcIds.add(it.lotId);
    const seen = new Set();
    it.intakeVehicles = arrivals
      .filter(a => (a.lot_id && srcIds.has(a.lot_id)) || (it.batchId && a.batch_id === it.batchId))
      .filter(a => { const k = a.vehicle_no || a.id; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(fmtVeh);
  }
  const aggSeen = new Set(); const intakeVehicles = [];
  for (const it of items) for (const v of it.intakeVehicles) { if (v.vehicleNo && !aggSeen.has(v.vehicleNo)) { aggSeen.add(v.vehicleNo); intakeVehicles.push(v); } }

  // Payment timeline with running balance.
  const itemIds = rows.map(r => r.id);
  let pays = await db('payments').whereIn('local_sale_id', itemIds.length ? itemIds : [base.id])
    .select('id', 'payment_no', 'payment_date', 'payment_method', 'amount', 'bank_reference', 'cleared', 'notes')
    .orderBy('payment_date', 'asc').orderBy('id', 'asc');
  if (pays.length === 0 && base.sale_no) {
    pays = await db('payments').where('notes', 'ilike', `%${base.sale_no}%`)
      .select('id', 'payment_no', 'payment_date', 'payment_method', 'amount', 'bank_reference', 'cleared', 'notes')
      .orderBy('payment_date', 'asc').orderBy('id', 'asc');
  }

  const grandTotal = items.reduce((s, i) => s + i.amount, 0);
  const timeline = [{ kind: 'created', date: base.sale_date || base.created_at, label: 'Invoice created', amount: grandTotal, balance: grandTotal }];
  let bal = grandTotal;
  for (const p of pays) {
    bal = Math.max(0, bal - num(p.amount));
    timeline.push({
      kind: 'payment', date: p.payment_date, paymentNo: p.payment_no,
      mode: p.payment_method, reference: p.bank_reference || null,
      cleared: p.cleared !== false, amount: num(p.amount), balance: bal,
    });
  }

  const outstanding = num(base.due_amount);
  const today = new Date().toISOString().slice(0, 10);
  const dueIso = base.due_date ? new Date(base.due_date).toISOString().slice(0, 10) : null;
  const overdue = outstanding > 0.01 && !!dueIso && dueIso < today;

  const data = {
    sale: {
      id: base.id, invoiceNo: base.sale_no, saleGroupNo: base.sale_group_no,
      customerId: base.customer_id || null,
      customer: base.customer_name || base.buyer_name || 'Walk-in customer',
      customerPhone: base.customer_phone || base.buyer_phone || null,
      customerEmail: base.customer_email || null,
      customerAddress: base.customer_address || base.buyer_address || null,
      customerContact: base.customer_contact || null,
      date: base.sale_date || base.created_at,
      paymentStatus: base.payment_status, paymentMode: base.payment_mode,
      total: grandTotal, received: num(base.paid_amount), outstanding,
      dueDate: base.due_date || null, overdue,
      createdByName: base.created_by_name || null, notes: base.notes || null,
    },
    items,
    payments: timeline,
    dispatch: {
      dispatched: !!base.dispatched,
      deliveryStatus: base.dispatched ? 'Dispatched' : 'Not dispatched',
      dispatchDate: base.dispatch_date || null,
      vehicleNo: base.vehicle_no || null, driverName: base.driver_name || null,
      collectionLocation: base.collection_location || null,
      intakeVehicles, // trucks the source rice lot(s) were purchased/received on
    },
    totals: {
      quantityKg: items.reduce((s, i) => s + i.quantityKg, 0),
      bags: items.reduce((s, i) => s + (i.bags || 0), 0),
      total: grandTotal, received: num(base.paid_amount), outstanding,
    },
  };

  if (includeAdmin) {
    const saleNos = [...new Set(rows.map(r => r.sale_no).filter(Boolean))];
    const cogsTotal = items.reduce((s, i) => s + (i.cogs || 0), 0);
    const [receivables, movements, lotTxns] = await Promise.all([
      db('receivables').whereIn('local_sale_id', itemIds.length ? itemIds : [base.id])
        .select('recv_no', 'type', 'expected_amount', 'received_amount', 'outstanding', 'status', 'due_date'),
      saleNos.length ? db('inventory_movements').whereIn('linked_ref', saleNos)
        .select('id', 'movement_type', 'qty', 'total_cost', 'lot_id', 'created_at')
        .orderBy('created_at', 'asc') : [],
      saleNos.length ? db('lot_transactions').whereIn('reference_no', saleNos)
        .select('transaction_no', 'transaction_type', 'quantity_kg', 'balance_kg', 'transaction_date')
        .orderBy('transaction_date', 'asc') : [],
    ]);
    data.financials = {
      salesAmount: grandTotal, cogsTotal,
      grossMargin: grandTotal - cogsTotal,
      marginPct: grandTotal > 0 ? ((grandTotal - cogsTotal) / grandTotal) * 100 : 0,
    };
    data.linked = {
      receivables: receivables.map(r => ({ recvNo: r.recv_no, type: r.type, expected: num(r.expected_amount), received: num(r.received_amount), outstanding: num(r.outstanding), status: r.status, dueDate: r.due_date })),
      inventoryMovements: movements.map(m => ({ id: m.id, type: m.movement_type, qtyKg: num(m.qty) * 1000, costPkr: num(m.total_cost), lotId: m.lot_id, date: m.created_at })),
      lotTransactions: lotTxns.map(t => ({ txnNo: t.transaction_no, type: t.transaction_type, qtyKg: num(t.quantity_kg), balanceKg: num(t.balance_kg), date: t.transaction_date })),
    };
  }

  return data;
}

// Server-side customer-invoice HTML for emailing (inline styles, email-safe).
// Mirrors the on-screen customer invoice; NO cost/margin.
function renderInvoiceEmailHtml(data, company = {}) {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pkr = (v) => `Rs ${Math.round(parseFloat(v) || 0).toLocaleString()}`;
  const d = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const { sale, items = [], dispatch = {}, totals = {} } = data;
  const coName = company.legal_name || company.name || 'AGRI COMMODITIES';
  const coBits = [company.address, company.phone, company.email].filter(Boolean).map(esc).join(' &middot; ');
  const rows = items.map((it) => `<tr>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${esc(it.riceType)}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${esc(it.gradeProduct)}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${Math.round(it.quantityKg).toLocaleString()} kg</td>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${it.bags != null ? it.bags : '—'}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${it.ratePerKg > 0 ? pkr(it.ratePerKg) : '—'}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${pkr(it.amount)}</td>
  </tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#111827;max-width:720px">
    <div style="border-bottom:2px solid #111827;padding-bottom:8px;display:flex;justify-content:space-between">
      <div><div style="font-size:18px;font-weight:800">${esc(coName)}</div>${coBits ? `<div style="font-size:11px;color:#6b7280">${coBits}</div>` : ''}${company.ntn ? `<div style="font-size:11px;color:#6b7280">NTN ${esc(company.ntn)}</div>` : ''}</div>
      <div style="text-align:right"><div style="font-size:15px;font-weight:800">SALES INVOICE</div><div style="font-size:12px;color:#374151">${esc(sale.invoiceNo)}</div><div style="font-size:11px;color:#6b7280">${d(sale.date)}</div></div>
    </div>
    <p style="font-size:13px;margin:10px 0 4px">Dear ${esc(sale.customer)},</p>
    <p style="font-size:12px;color:#374151;margin:0 0 10px">Please find your invoice below. Payment status: <b>${esc(sale.paymentStatus)}</b>${sale.dueDate ? ` &middot; Due ${d(sale.dueDate)}` : ''}.</p>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f3f4f6">
        <th style="text-align:left;padding:6px 8px">Rice Type</th><th style="text-align:left;padding:6px 8px">Grade / Product</th>
        <th style="text-align:right;padding:6px 8px">Qty</th><th style="text-align:right;padding:6px 8px">Bags</th>
        <th style="text-align:right;padding:6px 8px">Rate</th><th style="text-align:right;padding:6px 8px">Amount</th>
      </tr></thead><tbody>${rows}</tbody></table>
    <table style="margin-left:auto;margin-top:8px;font-size:12px">
      <tr><td style="padding:2px 8px">Total</td><td style="padding:2px 8px;text-align:right;font-weight:700">${pkr(totals.total)}</td></tr>
      <tr><td style="padding:2px 8px">Received</td><td style="padding:2px 8px;text-align:right">${pkr(totals.received)}</td></tr>
      <tr><td style="padding:2px 8px;border-top:1px solid #d1d5db">Outstanding</td><td style="padding:2px 8px;text-align:right;border-top:1px solid #d1d5db;font-weight:700">${pkr(totals.outstanding)}</td></tr>
    </table>
    ${(dispatch.vehicleNo || dispatch.driverName || dispatch.dispatchDate || items[0]?.warehouse) ? `<div style="margin-top:12px;font-size:11px;color:#6b7280"><b>Dispatch:</b> ${[items[0]?.warehouse, dispatch.deliveryStatus, dispatch.vehicleNo ? 'Truck ' + esc(dispatch.vehicleNo) : '', dispatch.driverName, dispatch.dispatchDate ? d(dispatch.dispatchDate) : ''].filter(Boolean).map(esc).join(' &middot; ')}</div>` : ''}
    <p style="font-size:11px;color:#9ca3af;margin-top:14px">Computer-generated sales invoice from ${esc(coName)}.</p>
  </div>`;
}

module.exports = {

  // List all local sales
  async list(req, res) {
    try {
      const { page = 1, limit = 50, status, lot_id, customer_id, from_date, to_date, search } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('local_sales as ls')
        .leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
        .leftJoin('users as u', 'u.id', 'ls.created_by')
        .select(
          'ls.*', 'c.name as customer_name', 'il.lot_no as lot_ref',
          'il.landed_cost_per_kg as lot_cost_per_kg', 'il.landed_cost_total as lot_landed_total',
          'il.item_name as lot_item_name', 'il.variety as lot_variety', 'il.grade as lot_grade',
          'u.full_name as created_by_name'
        );

      if (status && status !== 'all') query = query.where('ls.status', status);
      if (lot_id) query = query.where('ls.lot_id', lot_id);
      if (customer_id) query = query.where('ls.customer_id', customer_id);
      if (from_date) query = query.where('ls.sale_date', '>=', from_date);
      if (to_date) query = query.where('ls.sale_date', '<=', to_date);
      if (search) {
        query = query.where(function () {
          this.where('ls.sale_no', 'ilike', `%${search}%`)
            .orWhere('ls.item_name', 'ilike', `%${search}%`)
            .orWhere('ls.buyer_name', 'ilike', `%${search}%`)
            .orWhere('c.name', 'ilike', `%${search}%`);
        });
      }

      const [{ count: total }] = await query.clone().clearSelect().count('ls.id as count');
      const sales = await query.orderBy('ls.sale_date', 'desc').limit(limit).offset(offset);

      return res.json({ success: true, data: { sales, pagination: { page: +page, limit: +limit, total: +total } } });
    } catch (err) {
      console.error('Local sales list error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Get single sale
  async getById(req, res) {
    try {
      const { id } = req.params;
      const isNumeric = /^\d+$/.test(id);
      const where = isNumeric ? { 'ls.id': parseInt(id) } : { 'ls.sale_no': id };

      const sale = await db('local_sales as ls')
        .leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
        .leftJoin('users as u', 'u.id', 'ls.created_by')
        .select(
          'ls.*', 'c.name as customer_name', 'il.lot_no as lot_ref',
          'il.landed_cost_per_kg as lot_cost_per_kg', 'il.landed_cost_total as lot_landed_total',
          'il.item_name as lot_item_name', 'il.variety as lot_variety', 'il.grade as lot_grade',
          'il.supplier_id as lot_supplier_id', 'u.full_name as created_by_name'
        )
        .where(where).first();

      if (!sale) return res.status(404).json({ success: false, message: 'Sale not found.' });
      return res.json({ success: true, data: { sale } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Create local sale — deducts from inventory lot
  async create(req, res) {
    try {
      const {
        sale_date, customer_id, buyer_name, buyer_phone, buyer_address,
        payment_mode = 'cash', paid_amount, payment_reference,
        collection_location, bank_account_id, due_date,
        vehicle_no, driver_name, dispatched = true, notes,
      } = req.body;

      // One sale can carry several inventory items (multi-item). Accept items[]
      // or fall back to the legacy single top-level item fields (backward compat).
      const rawItems = (Array.isArray(req.body.items) && req.body.items.length)
        ? req.body.items
        : [{
            lot_id: req.body.lot_id, item_name: req.body.item_name, item_type: req.body.item_type,
            quantity_input: req.body.quantity_input, quantity_unit: req.body.quantity_unit,
            bag_weight_kg: req.body.bag_weight_kg, rate_input: req.body.rate_input, rate_unit: req.body.rate_unit,
          }];

      // Validate + price every line up front.
      const lines = rawItems.map((it, i) => {
        if (!it.item_name || !it.quantity_input || !it.rate_input) {
          const e = new Error(`Item ${i + 1}: item_name, quantity and rate are required.`); e.status = 400; throw e;
        }
        // A mill-store packaging line (e.g. empty katta) is COUNT-based: pieces ×
        // rate, deducting mill_stock — no weight/unit conversion.
        if (it.mill_item_id) {
          const count = parseFloat(it.quantity_input) || 0;
          const rate = parseFloat(it.rate_input) || 0;
          return {
            isMillItem: true, mill_item_id: it.mill_item_id, lot_id: null,
            item_name: it.item_name, item_type: 'packaging', count,
            quantity_input: count, quantity_unit: 'pcs', rate_input: rate, rate_unit: 'pcs',
            bagWt: 0, qtyKg: count, ratePerKg: rate, total: uc.round2(count * rate),
          };
        }
        const bagWt = parseFloat(it.bag_weight_kg) || 50;
        const qtyKg = uc.toKg(it.quantity_input, it.quantity_unit || 'kg', bagWt);
        const ratePerKg = uc.rateToPerKg(it.rate_input, it.rate_unit || 'kg', bagWt);
        return {
          lot_id: it.lot_id || null, item_name: it.item_name, item_type: it.item_type || null,
          quantity_input: parseFloat(it.quantity_input), quantity_unit: it.quantity_unit || 'kg',
          rate_input: parseFloat(it.rate_input), rate_unit: it.rate_unit || 'kg',
          bagWt, qtyKg, ratePerKg, total: uc.round2(qtyKg * ratePerKg),
        };
      });

      const grandTotal = uc.round2(lines.reduce((s, l) => s + l.total, 0));
      // Explicit amount wins; otherwise credit mode defaults to UNPAID (the whole
      // amount is owed), every other mode defaults to fully paid.
      const totalPaid = (paid_amount != null && paid_amount !== '')
        ? (parseFloat(paid_amount) || 0)
        : (payment_mode === 'credit' ? 0 : grandTotal);
      // Allocate the single tendered amount across lines proportionally; the last
      // line absorbs the rounding remainder so Σ(line paid) === totalPaid exactly.
      let allocated = 0;
      lines.forEach((l, i) => {
        if (i === lines.length - 1) l.paid = uc.round2(Math.max(0, totalPaid - allocated));
        else { l.paid = grandTotal > 0 ? uc.round2(totalPaid * (l.total / grandTotal)) : 0; allocated += l.paid; }
      });
      // A credit / partial sale leaves a balance owed → a receivable, which needs
      // a customer to chase. (receivables.customer_id is NOT NULL.)
      const hasDue = totalPaid < grandTotal - 0.01;

      const result = await db.transaction(async (trx) => {
        // Resolve the customer for any owed balance: use the selected one, else
        // auto-register the walk-in buyer (dedupe by name) so credit sales work
        // without a manual registration step. A fully-paid walk-in stays anonymous.
        let resolvedCustomerId = customer_id || null;
        if (hasDue && !resolvedCustomerId) {
          const nm = (buyer_name || '').trim();
          if (!nm) { const e = new Error('A credit or partial sale needs a buyer name (or a registered customer) so the balance can be tracked.'); e.status = 400; throw e; }
          let cust = await trx('customers').whereRaw('LOWER(name) = LOWER(?)', [nm]).first();
          if (!cust) {
            [cust] = await trx('customers').insert({
              name: nm, phone: buyer_phone || null, payment_terms: 'Credit', currency: 'PKR',
              customer_type: 'local', is_active: true, approval_status: 'pending',
              submitted_by: req.user?.id || null, submitted_at: trx.fn.now(),
            }).returning('*');
          }
          resolvedCustomerId = cust.id;
        }

        // Cash / bank receipts move the receiving account's balance with the money.
        const receiptAccountId = await resolveReceiptAccountId(trx, { paymentMode: payment_mode, bankAccountId: bank_account_id, amount: totalPaid, collectionLocation: collection_location });

        let groupNo = null;
        const created = [];

        for (const l of lines) {
          const saleNo = await generateSaleNo(trx);
          if (!groupNo) groupNo = saleNo; // first line's number identifies the group

          let costPerKg = 0, landedCostTotal = 0, lotNo = null;
          if (l.isMillItem) {
            // Sell a mill-store packaging item (empty katta) — deduct mill_stock.
            const mi = await trx('mill_items').where({ id: l.mill_item_id }).first();
            if (!mi) throw new Error('Packaging item not found');
            const ms = await trx('mill_stock').where({ item_id: l.mill_item_id, warehouse_id: null }).first();
            const avail = parseFloat(ms && ms.quantity_available) || 0;
            if (l.count > avail + 0.01) {
              const e = new Error(`Insufficient ${mi.name}: ${Math.round(avail)} in stock, ${l.count} needed.`); e.status = 400; throw e;
            }
            await trx('mill_stock').where({ id: ms.id }).update({
              quantity_available: trx.raw('GREATEST(quantity_available - ?, 0)', [l.count]), updated_at: trx.fn.now(),
            });
            await trx('mill_stock_movements').insert({
              item_id: l.mill_item_id, warehouse_id: null, movement_type: 'consumption', quantity: -l.count,
              reference_type: 'local_sale', reference_id: null, reason: `Sold ${l.count} ${mi.unit || 'pcs'} — ${saleNo}`, performed_by: req.user?.id || null,
            });
            costPerKg = parseFloat(mi.avg_cost_per_unit) || 0; // per piece
            landedCostTotal = uc.round2(l.count * costPerKg);
          } else if (l.lot_id) {
            const lot = await trx('inventory_lots').where({ id: l.lot_id }).first();
            if (!lot) throw new Error('Inventory lot not found');
            const availKg = (parseFloat(lot.available_qty) || 0) * 1000;
            if (l.qtyKg > availKg + 0.01) {
              const e = new Error(`Insufficient stock: ${l.item_name} needs ${Math.round(l.qtyKg)} kg but only ${availKg.toFixed(0)} kg available in ${lot.lot_no}`);
              e.status = 400; throw e;
            }
            // Atomic outbound movement — draws the lot down + writes the ledger;
            // no try/catch so a failed deduction rolls the whole sale back.
            await inventoryService.postMovement(trx, {
              movementType: 'local_sale', lotId: lot.id, qty: l.qtyKg / 1000,
              fromWarehouseId: lot.warehouse_id, sourceEntity: lot.entity, linkedRef: saleNo,
              notes: `Local sale ${saleNo} to ${buyer_name || 'customer'}`,
              costPerUnit: parseFloat(lot.cost_per_unit) || 0, currency: 'PKR', userId: req.user?.id,
            });
            await trx('inventory_lots').where({ id: l.lot_id }).update({
              sold_weight_kg: (parseFloat(lot.sold_weight_kg) || 0) + l.qtyKg,
            });
            costPerKg = parseFloat(lot.landed_cost_per_kg) || (parseFloat(lot.cost_per_unit) || 0) / 1000 || (parseFloat(lot.rate_per_kg) || 0);
            landedCostTotal = uc.round2(l.qtyKg * costPerKg);
            lotNo = lot.lot_no;
          }

          const dueAmt = Math.max(0, uc.round2(l.total - l.paid));
          const paymentStatus = dueAmt <= 0 ? 'Paid' : l.paid > 0 ? 'Partial' : (payment_mode === 'credit' ? 'Credit' : 'Unpaid');
          const grossProfit = uc.round2(l.total - landedCostTotal);

          const [sale] = await trx('local_sales').insert({
            sale_no: saleNo, sale_group_no: groupNo,
            sale_date: sale_date || new Date().toISOString().split('T')[0],
            entity: 'mill', customer_id: resolvedCustomerId,
            buyer_name: buyer_name || null, buyer_phone: buyer_phone || null, buyer_address: buyer_address || null,
            lot_id: l.lot_id, lot_no: lotNo, mill_item_id: l.mill_item_id || null,
            item_name: l.item_name, item_type: l.item_type,
            quantity_unit: l.quantity_unit, quantity_input: l.quantity_input, quantity_kg: l.qtyKg,
            quantity_bags: l.isMillItem ? l.count : (l.bagWt > 0 ? Math.round(l.qtyKg / l.bagWt) : 0), bag_weight_kg: l.isMillItem ? null : l.bagWt,
            rate_unit: l.rate_unit, rate_input: l.rate_input, rate_per_kg: l.ratePerKg,
            total_amount: l.total, currency: 'PKR',
            payment_mode: payment_mode || 'cash', payment_status: paymentStatus,
            paid_amount: l.paid, due_amount: dueAmt, payment_reference: payment_reference || null,
            collection_location: collection_location || null, due_date: due_date || null,
            vehicle_no: vehicle_no || null, driver_name: driver_name || null,
            dispatched: !!dispatched, dispatch_date: dispatched ? (sale_date || new Date().toISOString().split('T')[0]) : null,
            notes: notes || null, status: 'Completed', created_by: req.user?.id || null,
            cost_per_kg: costPerKg, landed_cost_total: landedCostTotal, gross_profit: grossProfit,
            profit_per_kg: l.qtyKg > 0 ? uc.round4(grossProfit / l.qtyKg) : 0,
            margin_pct: l.total > 0 ? uc.round2((grossProfit / l.total) * 100) : 0,
          }).returning('*');

          if (l.paid > 0) {
            const payCount = await trx('payments').count('id as c').first();
            // 'credit' is a sale MODE, not a tender method — an actual receipt
            // (partial payment on a credit sale) is recorded as cash so it passes
            // the payments.payment_method check constraint.
            const payMethod = (payment_mode && payment_mode !== 'credit') ? payment_mode : 'cash';
            const [payRow] = await trx('payments').insert({
              payment_no: `PL-${(parseInt(payCount?.c) || 0) + 1}`, type: 'receipt',
              amount: l.paid, currency: 'PKR', fx_rate: 1, base_amount_pkr: l.paid,
              payment_method: payMethod, bank_reference: payment_reference || null,
              bank_account_id: receiptAccountId || bank_account_id || null, due_date: due_date || null,
              payment_date: sale_date || trx.fn.now(), notes: `Local sale ${saleNo} — ${l.item_name}`,
              local_sale_id: sale.id, created_by: req.user?.id || null,
            }).returning('id');

            await postReceiptToAccount(trx, {
              accountId: receiptAccountId, amount: l.paid, paymentId: payRow.id,
              reference: payment_reference || saleNo, notes: `Local sale ${saleNo} receipt — ${l.item_name}`,
              date: sale_date, userId: req.user?.id,
            });
          }

          if (dueAmt > 0) {
            const rcvCount = await trx('receivables').count('id as c').first();
            await trx('receivables').insert({
              recv_no: `RCV-LS-${(parseInt(rcvCount?.c) || 0) + 1}`, entity: 'mill',
              customer_id: resolvedCustomerId, local_sale_id: sale.id, type: 'Local Sale',
              expected_amount: l.total, received_amount: l.paid, outstanding: dueAmt,
              due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              status: l.paid > 0 ? 'Partial' : 'Pending', currency: 'PKR', aging: 0,
              notes: `Local sale ${saleNo} — ${buyer_name || 'walk-in'} — ${l.item_name}`,
            });
          }

          if (sale.id && l.lot_id) await inventoryService.lockSaleCOGS(trx, sale.id);

          try {
            await accountingService.autoPost(trx, {
              triggerEvent: 'local_sale_recorded', entity: 'mill', amount: l.total, currency: 'PKR',
              refType: 'Local Sale', refNo: saleNo,
              description: `Local sale ${saleNo} — ${buyer_name || 'walk-in'} — ${l.item_name}`.slice(0, 240),
              userId: req.user?.id,
            });
          } catch (e) { console.warn('Local sale journal post failed:', e.message); }

          created.push(sale);
        }

        return { groupNo, sales: created };
      });

      return res.status(201).json({
        success: true,
        data: { sale: result.sales[0], sales: result.sales, group_no: result.groupNo, item_count: result.sales.length },
      });
    } catch (err) {
      console.error('Local sale create error:', err);
      const status = err.status || (String(err.message).includes('Insufficient') ? 400 : 500);
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // Accept payment against a local sale
  async acceptPayment(req, res) {
    try {
      const { id } = req.params;
      const { amount, payment_method = 'cash', payment_date, reference, notes, bank_account_id, due_date, collection_location } = req.body;

      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ success: false, message: 'A positive amount is required.' });
      }

      const sale = await db('local_sales').where({ id }).first();
      if (!sale) return res.status(404).json({ success: false, message: 'Sale not found.' });

      const payAmount = parseFloat(amount);
      const currentDue = parseFloat(sale.due_amount) || 0;

      if (payAmount > currentDue + 0.01) {
        return res.status(400).json({ success: false, message: `Cannot pay Rs ${payAmount} — only Rs ${currentDue.toFixed(2)} remaining.` });
      }

      // A post-dated cheque (cheque with a future due_date) is recorded but does
      // NOT settle the sale until it clears — the sale stays Partial/Unpaid.
      const today = new Date(new Date().toDateString());
      const isPostDated = payment_method === 'cheque' && due_date && new Date(due_date) > today;

      const newPaid = (parseFloat(sale.paid_amount) || 0) + payAmount;
      const newDue = Math.max(0, (parseFloat(sale.total_amount) || 0) - newPaid);
      const newStatus = newDue <= 0 ? 'Paid' : 'Partial';

      await db.transaction(async (trx) => {
        if (!isPostDated) {
          await trx('local_sales').where({ id }).update({
            paid_amount: uc.round2(newPaid),
            due_amount: uc.round2(newDue),
            payment_status: newStatus,
            // Record WHERE this cash/udhaar was collected (Mill / Head Office).
            ...(collection_location ? { collection_location } : {}),
            updated_at: trx.fn.now(),
          });
        }

        // Create payment record (cleared=false for an uncleared post-dated cheque).
        const receiptAccountId = isPostDated ? null : await resolveReceiptAccountId(trx, { paymentMode: payment_method, bankAccountId: bank_account_id, amount: payAmount, collectionLocation: collection_location });
        const payCount = await trx('payments').count('id as c').first();
        const [payRow] = await trx('payments').insert({
          payment_no: `PL-${(parseInt(payCount?.c) || 0) + 1}`,
          type: 'receipt',
          amount: payAmount,
          currency: 'PKR',
          fx_rate: 1,
          base_amount_pkr: payAmount,
          payment_method: payment_method,
          due_date: due_date || null,
          cleared: !isPostDated,
          bank_reference: reference || null,
          bank_account_id: receiptAccountId || bank_account_id || null,
          payment_date: payment_date || trx.fn.now(),
          notes: notes || `Payment for local sale ${sale.sale_no}${collection_location && payment_method === 'cash' ? ` (collected at ${collection_location})` : ''}`,
          local_sale_id: parseInt(id),
          created_by: req.user?.id || null,
        }).returning('id');

        if (!isPostDated) {
          // Cash / bank receipt → move the receiving account's balance.
          await postReceiptToAccount(trx, {
            accountId: receiptAccountId, amount: payAmount, paymentId: payRow.id,
            reference: reference || sale.sale_no, notes: `Payment for local sale ${sale.sale_no}`,
            date: payment_date, userId: req.user?.id,
          });

          // Update linked receivable — prefer FK, fall back to notes search
          const receivable = await trx('receivables')
            .where('local_sale_id', id)
            .first()
            || await trx('receivables')
              .where('notes', 'ilike', `%${sale.sale_no}%`)
              .first();
          if (receivable) {
            const rcvNewReceived = (parseFloat(receivable.received_amount) || 0) + payAmount;
            const rcvNewOutstanding = Math.max(0, (parseFloat(receivable.expected_amount) || 0) - rcvNewReceived);
            await trx('receivables').where({ id: receivable.id }).update({
              received_amount: uc.round2(rcvNewReceived),
              outstanding: uc.round2(rcvNewOutstanding),
              status: rcvNewOutstanding <= 0 ? 'Paid' : 'Partial',
              updated_at: trx.fn.now(),
            });
          }
        }
      });

      const updated = await db('local_sales').where({ id }).first();
      return res.json({ success: true, data: { sale: updated } });
    } catch (err) {
      console.error('Accept payment error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Get payment history for a sale
  async getPayments(req, res) {
    try {
      const { id } = req.params;
      const sale = await db('local_sales').where({ id }).first();
      if (!sale) return res.status(404).json({ success: false, message: 'Sale not found.' });

      // Prefer FK, fall back to notes search for legacy records
      let payments = await db('payments')
        .where('local_sale_id', id)
        .orderBy('payment_date', 'desc');
      if (payments.length === 0) {
        payments = await db('payments')
          .where('notes', 'ilike', `%${sale.sale_no}%`)
          .orderBy('payment_date', 'desc');
      }

      return res.json({ success: true, data: { payments, sale } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Invoice 360 (customer-safe) — header, line items, stock traceability,
  // payment timeline, dispatch. EXCLUDES COGS/margin. Read-only.
  async getInvoice(req, res) {
    try {
      const data = await assembleInvoice(req.params.id, false);
      if (!data) return res.status(404).json({ success: false, message: 'Sale not found.' });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Admin invoice copy — everything in getInvoice PLUS internal financials
  // (cost/kg · COGS · gross margin · margin % · remaining stock) and linked
  // records (receivables · inventory movements · lot transactions). Route is
  // role-gated (Owner / Super Admin / Finance Manager / Mill Manager) so this
  // is never exposed to Mill Operator, customers or unauthorized users.
  async getInvoiceAdmin(req, res) {
    try {
      const data = await assembleInvoice(req.params.id, true);
      if (!data) return res.status(404).json({ success: false, message: 'Sale not found.' });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Email the customer invoice (Phase 5). Sends the customer-safe HTML (no
  // cost/margin) to the customer's email via the existing mailer. Read-only on
  // sales data; only sends an email + writes an email_logs row.
  async emailInvoice(req, res) {
    try {
      const data = await assembleInvoice(req.params.id, false);
      if (!data) return res.status(404).json({ success: false, message: 'Sale not found.' });
      let to = (req.body && req.body.to ? String(req.body.to).trim() : '') || data.sale.customerEmail || '';
      if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        return res.status(400).json({ success: false, message: 'A valid recipient email is required (the customer has no email on file).' });
      }
      let company = {};
      try { const cp = await db('company_profile').first(); if (cp) company = cp; } catch (e) { /* default */ }
      const coName = company.legal_name || company.name || 'AGRI COMMODITIES';
      const html = renderInvoiceEmailHtml(data, company);
      const emailService = require('../communications/email.service');
      const log = await emailService.sendEmail({
        to, subject: `Invoice ${data.sale.invoiceNo} — ${coName}`, body: html,
        linkedType: 'local_sale', linkedId: data.sale.id, userId: req.user?.id || null,
      });
      return res.json({ success: true, to, status: (log && log.status) || 'Sent' });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message || 'Failed to send invoice email.' });
    }
  },

  // Summary stats
  async summary(req, res) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

      const [todayStats, monthStats, totalStats, profitStats] = await Promise.all([
        db('local_sales').where('sale_date', today).where('status', 'Completed')
          .select(db.raw('COUNT(*) as count, COALESCE(SUM(total_amount),0) as total, COALESCE(SUM(quantity_kg),0) as qty_kg')).first(),
        db('local_sales').where('sale_date', '>=', monthStart).where('status', 'Completed')
          .select(db.raw('COUNT(*) as count, COALESCE(SUM(total_amount),0) as total, COALESCE(SUM(quantity_kg),0) as qty_kg')).first(),
        db('local_sales').where('status', 'Completed')
          .select(db.raw('COUNT(*) as count, COALESCE(SUM(total_amount),0) as total, COALESCE(SUM(due_amount),0) as due')).first(),
        db('local_sales').where('status', 'Completed')
          .select(db.raw('COALESCE(SUM(total_amount),0) as revenue, COALESCE(SUM(landed_cost_total),0) as cost, COALESCE(SUM(gross_profit),0) as profit, COALESCE(SUM(paid_amount),0) as collected')).first(),
      ]);

      return res.json({
        success: true,
        data: {
          today: { count: parseInt(todayStats.count), total: parseFloat(todayStats.total), qtyKg: parseFloat(todayStats.qty_kg) },
          month: { count: parseInt(monthStats.count), total: parseFloat(monthStats.total), qtyKg: parseFloat(monthStats.qty_kg) },
          all: { count: parseInt(totalStats.count), total: parseFloat(totalStats.total), due: parseFloat(totalStats.due) },
          profit: { revenue: parseFloat(profitStats.revenue), cost: parseFloat(profitStats.cost), grossProfit: parseFloat(profitStats.profit), collected: parseFloat(profitStats.collected) },
        },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};
