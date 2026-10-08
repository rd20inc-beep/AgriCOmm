const db = require('../../config/database');
const inventoryService = require('../../services/inventoryService');
const accountingService = require('../../services/accountingService');
const fxRateService = require('./fxRate.service');
const { nextDocNo } = require('../../utils/docNumber');
const { postLocalReceiptJournal } = require('../localSales/receiptJournal');
const { buildLocalReceivablesQuery } = require('./localReceivablesQuery');
const { feedBase, feedTotals } = require('./paymentsFeedTotals');

// Finance-dashboard confidentiality: every role EXCEPT Super Admin / Owner sees
// reference NUMBERS (export order, mill batch, lot) but NOT the trading-party
// NAMES (customers + suppliers). Transporters (haulers) stay visible — they're
// operational. Resolve the caller's role name (cached on req.user._roleName when
// available, else looked up by role_id) and return true when names must be hidden.
// This used to be a second copy of the rule, with its own PARTY_VISIBLE_ROLES
// list. Two copies meant the shared helper could be changed while the one that
// actually masks payables carried on with the old list — so the policy now has a
// single home in shared/partyMask.js.
const { isPartyMasked } = require('../../shared/partyMask');
const { isMillOnlyPayer, assertMillEntity } = require('../../shared/millPayer');
const { canSeeCost } = require('../../utils/costVisibility');
const { assertAccountCurrency } = require('../../shared/accountCurrency');
const { normalizePaymentMethod } = require('../../shared/constants/paymentMethods');
const { ledgerFailure, missingAccounts } = require('../../shared/ledgerFailure');
const {
  applyReceivableDelta, pendingChequeTotal, nextBtNo, postDeltaOf, round2,
  isCheque, hasPaymentJournal, postPaymentJournal, settleDocuments, SOURCES, LOT_SUPPLIER_LINES,
} = require('./paymentSettlement');
const { recordMoneyMovement } = require('./paymentEngine');
const { recordPendingExportReceipt } = require('../exportOrders/exportReceipts');

// Resolve a payment row to its PKR equivalent using the strongest
// signal we have: stored base_amount_pkr first, then amount × fx_rate
// when the rate is real (>1), then amount × 280 as a final fallback
// for legacy non-PKR rows missing a rate. PKR rows pass through.
function paymentToPkr(p) {
  const base = parseFloat(p.base_amount_pkr);
  if (base && base > 0) return base;
  const amount = parseFloat(p.amount) || 0;
  const cur = (p.currency || 'PKR').toUpperCase();
  if (cur === 'PKR') return amount;
  const rate = parseFloat(p.fx_rate);
  if (rate && rate > 1) return amount * rate;
  return amount * 280;
}

// IT-NNN. MAX(suffix)+1, not "the newest row + 1": the newest row is not the
// highest number once rows are deleted or two transfers race, and the next
// insert then collides on the unique transfer_no.
function generateTransferNo(trx) {
  return nextDocNo(trx || db, { table: 'internal_transfers', column: 'transfer_no', prefix: 'IT-', pad: 3 });
}

/**
 * The merged payables feed — stored payables + cost-derived rows — filtered by
 * the list query (status / supplier / overdue / dates) and sorted newest first.
 * Shared by GET /finance/payables (every entity, finance.view) and
 * GET /milling/payables (entity 'mill' only, for mill roles without finance).
 */
async function loadPayablesFeed(query = {}) {
  const { status, supplier_id, overdue, from_date, to_date } = query;
  // Stored payables (real rows that CAN be paid — they have a numeric id).
  // We MERGE these with the cost-derived ones below rather than either/or, so
  // a materialized payable (e.g. a mill raw-rice purchase, which recordPayment
  // needs a real row to settle) and the still-derived costs (export/expenses)
  // both show. Derived rows whose source is already stored are skipped to
  // avoid double-counting.
  const storedRows = await db('payables as p')
    .leftJoin('suppliers as s', 'p.supplier_id', 's.id')
    .leftJoin('haulers as h', 'p.hauler_id', 'h.id')  // #14 transporter payables
    .select('p.*', 's.name as supplier_name', db.raw('h.name as hauler_name'))
    // A Reversed payable (its expense was undone) is owed by no one.
    .whereNot('p.status', 'Reversed')
    .where(function() {
      this.whereIn('p.payable_type', ['vendor', 'expense', 'purchase'])
          .orWhereNull('p.payable_type');
    });
  // Source keys already materialized — suppress their derived duplicates.
  // Mill raw-rice payables are keyed by batch (source_table 'milling_raw_rice').
  const storedRawRiceBatchIds = new Set(
    storedRows.filter((r) => r.source_table === 'milling_raw_rice' && r.source_id != null)
      .map((r) => r.source_id),
  );
  // #14 — batch transport now materialises a real transporter payable
  // (source_table 'batch_transport'); suppress its derived milling_costs
  // transport duplicate so it isn't counted twice.
  const storedBatchTransportBatchIds = new Set(
    storedRows.filter((r) => r.source_table === 'batch_transport' && r.source_id != null)
      .map((r) => r.source_id),
  );
  // Export costs mirror into a real payable (PAY-EOC…, source_table
  // 'export_order_costs') when they are recorded — that row is the one to pay,
  // so its derived EC- twin is not listed again.
  const storedExportCostIds = new Set(
    storedRows.filter((r) => r.source_table === 'export_order_costs' && r.source_id != null)
      .map((r) => String(r.source_id)),
  );
  // A batch fed by source LOTS (lot-started or blend) gets its raw cost from
  // those lots — whose own purchase payables already capture the supplier debt.
  // Deriving a raw_rice payable for such a batch would double-count, so skip it.
  const batchesFromSourceLots = new Set(
    (await db('batch_source_lots').distinct('batch_id').select('batch_id')).map((r) => r.batch_id),
  );

  // Derive payables from cost tables. Resolve the supplier from the batch's
  // supplier_id (the denormalized supplier_name is sometimes null) and carry
  // processing_type so a blend's internal raw cost can be excluded below.
  const millingCosts = await db('milling_costs as mc')
    .join('milling_batches as mb', 'mc.batch_id', 'mb.id')
    .leftJoin('suppliers as s', 's.id', 'mb.supplier_id')
    .select(
      'mc.id', 'mc.batch_id', 'mc.category', 'mc.amount', 'mc.currency',
      'mc.created_at', 'mb.batch_no', 'mb.processing_type', 'mb.supplier_id',
      db.raw('COALESCE(s.name, mb.supplier_name) as supplier_name'),
    )
    .where('mc.amount', '>', 0)
    .orderBy('mc.created_at', 'desc');

  const exportCosts = await db('export_order_costs as eoc')
    .join('export_orders as eo', 'eoc.order_id', 'eo.id')
    .leftJoin('customers as c', 'eo.customer_id', 'c.id')
    .select(
      'eoc.id', 'eoc.order_id', 'eoc.category', 'eoc.amount', 'eoc.currency', 'eoc.fx_rate',
      'eoc.base_amount_pkr', 'eoc.paid_amount', 'eoc.payment_status',
      'eoc.created_at', 'eo.order_no', 'c.name as customer_name',
    )
    .where('eoc.amount', '>', 0)
    .orderBy('eoc.created_at', 'desc');

  const millExpenses = await db('mill_expenses')
    .where('amount', '>', 0)
    .select('*')
    .orderBy('expense_date', 'desc');

  // Map to payable-shaped rows
  const derived = [];

  const categoryLabel = (cat) => {
    const map = { raw_rice: 'Raw Rice', transport: 'Transport', electricity: 'Electricity', rent: 'Rent', labor: 'Labor', maintenance: 'Maintenance' };
    return map[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
  };

  // A derived row is a cost allocation, not a bill: no payment endpoint can
  // settle it (there is no payable id), so it carries where it IS settled.
  const DERIVED_HINT = {
    milling_costs: 'Cost from the batch cost sheet — there is no bill to pay against here. Settle it with the supplier or transporter (Mill Finance ▸ Suppliers, or their statement).',
    export_order_costs: 'Export cost with no bill yet — pay it from Finance ▸ Purchases (Export cost).',
    mill_expenses: 'Legacy mill expense with no payable — record it as an expense to pay it.',
  };

  millingCosts.forEach(mc => {
    // A blend's raw_rice cost is the internal value of already-owned finished
    // stock it re-mills — NOT a new supplier purchase. The amount owed to those
    // suppliers is already recognized on the source batches (M-001/M-002), so
    // counting it here would double-count what we owe (and disagree with the GL
    // supplier statement, which has no AP journal for blends). Skip it.
    if (mc.category === 'raw_rice' && mc.processing_type === 'blended') return;
    // Materialized as a real stored payable already (so it can be paid) —
    // skip the derived duplicate.
    if (mc.category === 'raw_rice' && storedRawRiceBatchIds.has(mc.batch_id)) return;
    // Batch fed by source lots → its raw cost is already owed via those lots'
    // purchase payables; deriving it again would double-count the supplier.
    if (mc.category === 'raw_rice' && batchesFromSourceLots.has(mc.batch_id)) return;
    // #14 — transport for this batch is a real (payable) transporter payable.
    if (mc.category === 'transport' && storedBatchTransportBatchIds.has(mc.batch_id)) return;
    derived.push({
      id: `MC-${mc.id}`,
      pay_no: `MC-${mc.id}`,
      entity: 'mill',
      category: categoryLabel(mc.category),
      supplier_id: mc.supplier_id || null,
      supplier_name: mc.supplier_name || null,
      linked_ref: mc.batch_no,
      original_amount: parseFloat(mc.amount),
      paid_amount: 0,
      outstanding: parseFloat(mc.amount),
      due_date: mc.created_at,
      status: 'Pending',
      currency: mc.currency || 'PKR',
      aging: 0,
      notes: `${categoryLabel(mc.category)} cost for batch ${mc.batch_no}`,
      created_at: mc.created_at,
      source: 'milling_costs',
      derived: true,
      settle_hint: DERIVED_HINT.milling_costs,
    });
  });

  // Domain separation: the Finance Manager settles export costs and needs the
  // export ORDER NUMBER to identify what a payment is for, but restricted roles
  // must NOT see the export CUSTOMER — party names are masked uniformly after
  // paging (see below); here we carry the real values.
  exportCosts.forEach(ec => {
    if (storedExportCostIds.has(String(ec.id))) return; // its real payable is listed
    // export_order_costs are stored in PKR (migration 079): the amount is the
    // PKR figure, never USD. What has been paid comes from the row itself
    // (Purchases ▸ Export cost settles it there).
    const total = parseFloat(ec.base_amount_pkr) || (parseFloat(ec.amount) || 0) * (parseFloat(ec.fx_rate) || 1);
    const paid = parseFloat(ec.paid_amount) || 0;
    derived.push({
      id: `EC-${ec.id}`,
      pay_no: `EC-${ec.id}`,
      entity: 'export',
      category: categoryLabel(ec.category),
      supplier_name: ec.customer_name || null, // the export customer
      linked_ref: ec.order_no,
      original_amount: total,
      paid_amount: paid,
      outstanding: Math.max(0, round2(total - paid)),
      due_date: ec.created_at,
      status: paid <= 0.01 ? 'Pending' : (total - paid <= 0.01 ? 'Paid' : 'Partial'),
      currency: 'PKR',
      aging: 0,
      notes: `${categoryLabel(ec.category)} cost for order ${ec.order_no}`,
      created_at: ec.created_at,
      source: 'export_order_costs',
      derived: true,
      settle_hint: DERIVED_HINT.export_order_costs,
    });
  });

  millExpenses.forEach(me => {
    derived.push({
      id: `ME-${me.id}`,
      pay_no: `ME-${me.id}`,
      entity: 'mill',
      category: categoryLabel(me.category || 'overhead'),
      supplier_name: null,
      linked_ref: null,
      original_amount: parseFloat(me.amount),
      paid_amount: 0,
      outstanding: parseFloat(me.amount),
      due_date: me.expense_date || me.created_at,
      status: 'Pending',
      currency: 'PKR',
      aging: 0,
      notes: me.description || `Mill expense: ${me.category}`,
      created_at: me.created_at,
      source: 'mill_expenses',
      derived: true,
      settle_hint: DERIVED_HINT.mill_expenses,
    });
  });

  // Merge stored (real, payable) + derived (synthetic) into one feed.
  const all = [...storedRows, ...derived];

  // Apply filters uniformly across the merged set.
  let filtered = all;
  if (status) filtered = filtered.filter(p => p.status === status);
  if (supplier_id) filtered = filtered.filter(p => String(p.supplier_id) === String(supplier_id));
  if (overdue === 'true') filtered = filtered.filter(p => p.due_date && new Date(p.due_date) < new Date() && p.status !== 'Paid');
  if (from_date) filtered = filtered.filter(p => p.created_at && new Date(p.created_at) >= new Date(from_date));
  // Exclusive next-day bound: created_at carries a time, so comparing against
  // midnight of to_date would drop payables created later that day.
  if (to_date) {
    const toBound = new Date(to_date); toBound.setDate(toBound.getDate() + 1);
    filtered = filtered.filter(p => p.created_at && new Date(p.created_at) < toBound);
  }

  // Newest first; tie-break on id (stored numeric > synthetic string sort).
  filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return filtered;
}

/** Page + party-mask one payables feed into the response body both endpoints return. */
async function respondPayables(req, res, rows) {
  const { page = 1, limit = 200 } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
  const total = rows.length;
  let paged = rows.slice(offset, offset + parseInt(limit));

  // Confidentiality: restricted roles (everyone except Super Admin / Owner)
  // see the reference (order / batch / lot) but NOT the trading-party name.
  // Mask the supplier/customer name to a generic label and drop the party
  // link; transporter (hauler) names stay visible (operational).
  if (await isPartyMasked(req)) {
    paged = paged.map((r) => {
      if (r.hauler_name && !r.supplier_name) return r; // transporter payable — keep
      if (!r.supplier_name) return r; // no party name to hide (e.g. mill expense)
      return { ...r, supplier_name: r.entity === 'export' ? 'Customer' : 'Supplier', supplier_id: null };
    });
  }

  return res.json({
    success: true,
    data: {
      payables: paged,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
      source: 'merged',
    },
  });
}

/**
 * The receivables list both endpoints return. `entity` restricts it to one
 * side of the business ('mill' for GET /milling/receivables); without it every
 * receivable shows (GET /finance/receivables).
 */
async function receivablesResponse(req, res, { entity } = {}) {
  try {
    const { page = 1, limit = 200, status, customer_id, overdue, from_date, to_date } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    // ── Export-side receivables (existing) ────────────────────────
    let exportQ = db('receivables as r')
      .leftJoin('customers as c', 'r.customer_id', 'c.id')
      .select(
        'r.id', 'r.recv_no', 'r.type', 'r.expected_amount', 'r.received_amount',
        'r.outstanding', 'r.currency', 'r.fx_rate', 'r.base_amount_pkr',
        'r.due_date', 'r.status', 'r.aging', 'r.order_id', 'r.customer_id',
        'r.created_at', 'r.entity',
        db.raw(`'receivable'::text as kind`),
        'c.name as customer_name'
      )
      // Local-sale receivables (RCV-LS-, carry local_sale_id) are ALSO surfaced
      // from local_sales below — excluding them here prevents the same balance
      // being counted twice in the Money-In list, its total, and pagination.
      .whereNull('r.local_sale_id');
    if (entity)        exportQ = exportQ.where('r.entity', entity);
    if (status)        exportQ = exportQ.where('r.status', status);
    if (customer_id)   exportQ = exportQ.where('r.customer_id', customer_id);
    if (overdue === 'true') exportQ = exportQ.where('r.due_date', '<', db.fn.now()).where('r.status', '!=', 'Paid');
    if (from_date)     exportQ = exportQ.where('r.created_at', '>=', from_date);
    // Exclusive next-day bound: r.created_at is timestamptz, so `<= to_date`
    // (midnight) would drop receivables created later on the to_date day.
    if (to_date)       exportQ = exportQ.where('r.created_at', '<', db.raw("(?::date + interval '1 day')", [to_date]));

    // ── Local sales with outstanding balance (merged in) ──────────
    // One row per sale (sale_group_no), selected by what is still owed on a
    // confirmed sale, due = COALESCE(due_date, sale_date) for the Due column,
    // aging and the overdue filter alike. See localReceivablesQuery.js.
    const localQ = buildLocalReceivablesQuery(db, { status, customer_id, from_date, to_date, overdue, entity });

    // Knex UNION with ORDER BY + LIMIT works by wrapping the union
    // as a derived table.
    const [exportRows, localRows] = await Promise.all([exportQ, localQ]);
    // The SQL already filters by entity; checking the rows too means a query
    // change can never quietly hand an export receivable to a mill-only caller.
    const ofEntity = (row) => !entity || String(row.entity || '').toLowerCase() === entity;
    const combined = [...exportRows, ...localRows]
      .filter(ofEntity)
      .sort((a, b) => (a.due_date ? new Date(a.due_date).getTime() : 0) - (b.due_date ? new Date(b.due_date).getTime() : 0));

    const total = combined.length;
    let sliced = combined.slice(offset, offset + parseInt(limit));

    // Confidentiality: every role except Super Admin / Owner sees the reference
    // (recv_no / sale_no) but NOT the trading-party name. Mask the CUSTOMER on
    // both export receivables and local sales, drop the customer link, and null
    // the export order link (opening it would reveal the customer). Reference
    // numbers stay so the payment can still be identified.
    if (await isPartyMasked(req)) {
      sliced = sliced.map((r) => ({
        ...r,
        customer_name: r.kind === 'receivable' ? 'Export customer' : 'Customer',
        customer_id: null,
        order_id: null,
      }));
    }

    return res.json({
      success: true,
      data: {
        receivables: sliced,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    console.error('Get receivables error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}

const financeController = {
  async getReceivables(req, res) {
    return receivablesResponse(req, res, {});
  },

  // Mill Finance ▸ Customers for mill roles without finance.view (the Mill
  // Operator — owner decision 2026-10-05): receivables the MILL is owed only —
  // rows on the receivables table with entity 'mill' (opening balances, service
  // milling invoices) and mill local sales still owing. Export receivables
  // never leave. Same response shape as GET /finance/receivables.
  async getMillReceivables(req, res) {
    return receivablesResponse(req, res, { entity: 'mill' });
  },

  // Receipt history for one Money-In row — shows WHERE/HOW each partial was
  // received (amount, date, method, the bank/cash account it landed in, cheque/
  // reference). Export rows link via payments.linked_receivable_id; local-sale
  // rows via payments.local_sale_id (plus the sale's collection location).
  async getReceivableReceipts(req, res) {
    try {
      const { id } = req.params;
      const source = ['local_sale', 'local_sale_group'].includes(req.query.source) ? req.query.source : 'export';

      const base = () => db('payments as p')
        .leftJoin('bank_accounts as ba', 'ba.id', 'p.bank_account_id')
        // Exclude pending/rejected export receipts — not banked money yet (item 14).
        .whereNotIn('p.status', ['Pending Finance Confirmation', 'Rejected'])
        .select(
          'p.id', 'p.payment_no', 'p.amount', 'p.currency', 'p.payment_method',
          'p.payment_date', 'p.bank_reference', 'p.notes', 'p.bank_account_id', 'p.type',
          'ba.name as account_name', 'ba.bank_name as bank_name', 'ba.type as account_type'
        )
        .orderBy('p.payment_date', 'desc')
        .orderBy('p.id', 'desc');

      let payments = [];
      let collectionLocation = null;

      if (source === 'local_sale_group') {
        // A Money-In row is a whole sale (sale_group_no): its receipts are
        // every payment against any of its lines.
        const sale = await db('local_sales').where({ id }).first();
        if (sale) {
          collectionLocation = sale.collection_location || null;
          const lineIds = sale.sale_group_no
            ? (await db('local_sales').where({ sale_group_no: sale.sale_group_no }).select('id')).map((r) => r.id)
            : [sale.id];
          payments = await base().whereIn('p.local_sale_id', lineIds);
        }
      } else if (source === 'local_sale') {
        const sale = await db('local_sales').where({ id }).first();
        if (sale) {
          collectionLocation = sale.collection_location || null;
          payments = await base().where('p.local_sale_id', id);
          if (payments.length === 0) {
            payments = await base().where('p.notes', 'ilike', `%${sale.sale_no}%`);
          }
        }
      } else {
        // A receivable derived from a local sale carries local_sale_id — its
        // receipts are linked via payments.local_sale_id, not linked_receivable_id.
        const recv = await db('receivables').where({ id }).first();
        if (recv && recv.local_sale_id) {
          payments = await base().where(function () {
            this.where('p.linked_receivable_id', id).orWhere('p.local_sale_id', recv.local_sale_id);
          });
          const sale = await db('local_sales').where({ id: recv.local_sale_id }).first();
          collectionLocation = sale?.collection_location || null;
        } else {
          payments = await base().where('p.linked_receivable_id', id);
        }
      }

      return res.json({ success: true, data: { payments, collectionLocation } });
    } catch (err) {
      console.error('getReceivableReceipts error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Payment history for one Money-Out row — shows WHERE/HOW each partial was paid
  // (amount, date, method, the bank/cash account it left, cheque/reference).
  // Only STORED payables (numeric id) carry payments via payments.linked_payable_id;
  // cost-derived rows (id like MC-/EC-/ME-) are unpaid by definition → empty.
  async getPayablePayments(req, res) {
    try {
      const { id } = req.params;
      if (!/^\d+$/.test(String(id))) return res.json({ success: true, data: { payments: [] } });
      const payable = await db('payables').where({ id }).first();

      // (1) payments linked to this payable
      const viaPayments = await db('payments as p')
        .leftJoin('bank_accounts as ba', 'ba.id', 'p.bank_account_id')
        .where('p.linked_payable_id', id)
        .select('p.id', 'p.status', 'p.payment_no', 'p.amount', 'p.payment_method', 'p.payment_date', 'p.bank_reference',
          'ba.name as account_name', 'ba.bank_name', 'ba.type as account_type');

      // (2) bank_transactions from the Purchases-tab payPurchase flow (no
      // payments row), matched by the payable's linked_ref.
      let viaBank = [];
      if (payable && payable.linked_ref) {
        viaBank = await db('bank_transactions as bt')
          .leftJoin('bank_accounts as ba', 'ba.id', 'bt.bank_account_id')
          .where({ 'bt.source': 'pay_purchase', 'bt.type': 'debit' })
          .where('bt.notes', 'ilike', `%${payable.linked_ref}%`)
          .select('bt.amount', 'bt.transaction_date', 'bt.reference',
            'ba.name as account_name', 'ba.bank_name', 'ba.type as account_type');
      }

      const norm = [];
      for (const p of viaPayments) norm.push({
        id: p.id, status: p.status, payment_no: p.payment_no,
        amount: parseFloat(p.amount) || 0, payment_method: p.payment_method, payment_date: p.payment_date,
        bank_reference: p.bank_reference, account_name: p.account_name, bank_name: p.bank_name, account_type: p.account_type,
      });
      for (const b of viaBank) norm.push({
        amount: parseFloat(b.amount) || 0, payment_method: b.account_type === 'cash' ? 'cash' : 'bank_transfer',
        payment_date: b.transaction_date, bank_reference: b.reference,
        account_name: b.account_name, bank_name: b.bank_name, account_type: b.account_type,
      });
      const seen = new Set();
      let payments = norm.filter((x) => {
        // Include the reference so two GENUINE same-amount/day/account partials
        // aren't collapsed into one — while a payment and its own bank_transaction
        // (which share the reference) still dedup to a single line.
        const k = `${Math.round(x.amount)}|${x.payment_date ? String(x.payment_date).slice(0, 10) : ''}|${x.account_name || ''}|${x.bank_reference || ''}`;
        if (seen.has(k)) return false; seen.add(k); return true;
      });

      // (3) fallback — payable shows paid but nothing itemisable → one synth line
      const paid = parseFloat(payable?.paid_amount) || 0;
      if (payments.length === 0 && paid > 0) {
        payments.push({ amount: paid, payment_method: null, payment_date: payable.updated_at, bank_reference: null, account_name: null, bank_name: null, account_type: null, synthesized: true });
      }
      payments.sort((a, b) => new Date(b.payment_date || 0) - new Date(a.payment_date || 0));

      return res.json({ success: true, data: { payments } });
    } catch (err) {
      console.error('getPayablePayments error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Upcoming money: post-dated cheques (payments.due_date) + credit dues
  // (unpaid receivables/payables/local-sale-credit with a due_date), split into
  // RECEIVING (money expected in) vs GIVING (money due out), sorted by date —
  // so the dashboard shows when each payment is expected/due.
  async getUpcoming(req, res) {
    try {
      const cheques = await db('payments as p')
        .leftJoin('receivables as r', 'r.id', 'p.linked_receivable_id')
        .leftJoin('payables as pa', 'pa.id', 'p.linked_payable_id')
        .leftJoin('local_sales as ls', 'ls.id', 'p.local_sale_id')
        .leftJoin('customers as c', 'c.id', 'r.customer_id')
        .leftJoin('suppliers as s', 's.id', 'pa.supplier_id')
        // Every uncleared cheque — one with no clearing date is due the day it
        // was recorded (it still has to be cleared here before it counts).
        .where('p.payment_method', 'cheque').where('p.cleared', false)
        // A reversed (or rejected) cheque is not coming — don't count it down.
        .whereNotIn('p.status', ['Reversed', 'Rejected'])
        .select('p.id', 'p.type', 'p.amount', 'p.currency', 'p.fx_rate', 'p.base_amount_pkr', 'p.due_date', 'p.payment_date', 'p.payment_no', 'p.bank_account_id', 'p.bank_reference',
          'p.local_sale_id', 'r.local_sale_id as recv_local_sale_id',
          'r.customer_id as recv_customer_id', 'pa.supplier_id as pay_supplier_id', 'ls.customer_id as ls_customer_id',
          db.raw("COALESCE(c.name, s.name, ls.buyer_name, 'Counterparty') as party"));

      // A local sale is listed ONCE. It used to surface up to three times: its
      // pending cheque, the receivable raised for it, and its own credit row.
      // Now a sale's receivable never lists here (the sale stands for it); a
      // sale with a cheque pending lists as that cheque (with its clearing
      // date); any other confirmed sale still owing lists as one credit row
      // per sale group — as Money In groups them — dated COALESCE(due_date,
      // sale_date).
      const recv = await db('receivables as r').leftJoin('customers as c', 'c.id', 'r.customer_id')
        .whereNot('r.status', 'Paid').whereNotNull('r.due_date').where('r.outstanding', '>', 0)
        .whereNull('r.local_sale_id')
        .select('r.outstanding as amount', 'r.currency', 'r.fx_rate', 'r.due_date', 'r.customer_id', db.raw("COALESCE(c.name, 'Customer') as party"), 'r.recv_no as ref');
      const salesWithCheque = new Set(cheques
        .map((x) => x.local_sale_id || x.recv_local_sale_id)
        .filter(Boolean).map(String));
      // Confirmed sales only — not Pending (unconfirmed), Cancelled, Reversed
      // or Rejected — matching Money In.
      const lsRows = await db('local_sales as ls').leftJoin('customers as c', 'c.id', 'ls.customer_id')
        .where('ls.status', 'Completed').where('ls.due_amount', '>', 0)
        .select('ls.id', 'ls.sale_group_no', 'ls.sale_no', 'ls.due_amount', 'ls.due_date', 'ls.sale_date', 'ls.customer_id',
          db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as party"));
      const lsGroups = new Map();
      for (const x of lsRows) {
        if (salesWithCheque.has(String(x.id))) continue;
        const key = x.sale_group_no || x.sale_no || `#${x.id}`;
        const due = x.due_date || x.sale_date || null;
        const g = lsGroups.get(key);
        if (!g) {
          lsGroups.set(key, { amount: parseFloat(x.due_amount) || 0, due_date: due, customer_id: x.customer_id || null, ref: key, party: x.party });
        } else {
          g.amount += parseFloat(x.due_amount) || 0;
          if (due && (!g.due_date || new Date(due) < new Date(g.due_date))) g.due_date = due;
          g.customer_id = g.customer_id || x.customer_id || null;
        }
      }
      const lsCredit = [...lsGroups.values()].map((g) => ({ ...g, amount: round2(g.amount) }));
      const pay = await db('payables as pa').leftJoin('suppliers as s', 's.id', 'pa.supplier_id')
        .whereNot('pa.status', 'Paid').whereNotNull('pa.due_date').where('pa.outstanding', '>', 0)
        .select('pa.outstanding as amount', 'pa.currency', 'pa.due_date', 'pa.supplier_id', 'pa.linked_ref as ref', db.raw("COALESCE(s.name, 'Supplier') as party"));

      // Each row carries its native currency + a PKR equivalent (for totals).
      // Payables have no stored fx_rate column, so a foreign payable converts at
      // the LIVE USD rate (not a stale flat 280) — receivables/cheques still use
      // their own stored rate.
      const liveUsd = (await fxRateService.getLatestRate('USD')).rate || 280;
      const toPkr = (amt, cur, fx) => ((cur || 'PKR').toUpperCase() === 'PKR' ? amt : amt * (parseFloat(fx) || liveUsd));

      // A cheque receipt is against a customer, a cheque payment against a supplier.
      const chq = (t) => cheques.filter((x) => x.type === t).map((x) => {
        const amount = parseFloat(x.amount) || 0;
        const currency = (x.currency || 'PKR').toUpperCase();
        return {
          kind: 'cheque', label: 'Cheque (pending)', dueDate: x.due_date || x.payment_date, amount, currency,
          amountPkr: parseFloat(x.base_amount_pkr) || toPkr(amount, currency, x.fx_rate),
          party: x.party, reference: x.bank_reference, paymentId: x.id,
          paymentNo: x.payment_no, bankAccountId: x.bank_account_id || null,
          partyType: t === 'receipt' ? 'customer' : 'supplier',
          partyId: t === 'receipt' ? (x.recv_customer_id || x.ls_customer_id || null) : (x.pay_supplier_id || null),
        };
      });
      const receiving = [
        ...chq('receipt'),
        ...recv.map((x) => { const amount = parseFloat(x.amount) || 0; const currency = (x.currency || 'PKR').toUpperCase(); return { kind: 'credit', label: 'Receivable', dueDate: x.due_date, amount, currency, amountPkr: toPkr(amount, currency, x.fx_rate), party: x.party, reference: x.ref, partyType: 'customer', partyId: x.customer_id || null }; }),
        ...lsCredit.map((x) => ({ kind: 'credit', label: 'Local sale (credit)', dueDate: x.due_date, amount: parseFloat(x.amount) || 0, currency: 'PKR', amountPkr: parseFloat(x.amount) || 0, party: x.party, reference: x.ref, partyType: 'customer', partyId: x.customer_id || null })),
      ].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
      const giving = [
        ...chq('payment'),
        ...pay.map((x) => { const amount = parseFloat(x.amount) || 0; const currency = (x.currency || 'PKR').toUpperCase(); return { kind: 'credit', label: 'Payable', dueDate: x.due_date, amount, currency, amountPkr: toPkr(amount, currency, liveUsd), party: x.party, reference: x.ref, partyType: 'supplier', partyId: x.supplier_id || null }; }),
      ].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

      return res.json({ success: true, data: {
        receiving, giving,
        // Totals are PKR-equivalent (the lists can mix PKR + USD rows).
        totalReceiving: receiving.reduce((s, x) => s + (x.amountPkr || 0), 0),
        totalGiving: giving.reduce((s, x) => s + (x.amountPkr || 0), 0),
      } });
    } catch (err) {
      console.error('getUpcoming error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Clear a cheque. A cheque is not money in the bank until this runs (owner
  // decision 2026-10-07, same-day cheques included), so clearing does all of
  // it: settles the linked sale / receivable / payable and its source row,
  // moves the bank account it cleared through (required — picked here, else the
  // one named at recording) by the net, and posts the settlement journal under
  // the payment number. Idempotent: a cleared cheque is a no-op, and a cheque
  // that already has a journal (recorded under the old post-dated rules) gets no
  // second one. A reversed cheque is refused.
  async clearCheque(req, res) {
    try {
      const { id } = req.params;
      const { bank_account_id } = req.body || {};
      const fail = (msg, status) => { const e = new Error(msg); e.status = status; return e; };
      const result = await db.transaction(async (trx) => {
        // Locked so a clear cannot race a reversal of the same cheque.
        const p = await trx('payments').where({ id }).forUpdate().first();
        if (!p) throw fail('Payment not found.', 404);
        if (p.status === 'Reversed' || p.status === 'Rejected') {
          throw fail(`Cheque ${p.payment_no} was ${String(p.status).toLowerCase()} — it cannot be cleared.`, 400);
        }
        if (p.cleared) return { alreadyCleared: true };
        const amount = parseFloat(p.amount) || 0;
        const amountPkr = paymentToPkr(p);
        // The money moves today, so it has to move through an account: the one
        // picked in Due Dates, else the one named when the cheque was recorded.
        const acctId = bank_account_id || p.bank_account_id || null;
        if (!acctId) throw fail('Choose the bank account this cheque cleared through.', 400);
        const acctRow = await trx('bank_accounts').where({ id: acctId }).first();
        if (!acctRow) throw fail('Bank account not found.', 400);
        assertAccountCurrency(acctRow, p.currency);
        await trx('payments').where({ id }).update({ cleared: true, bank_account_id: acctId, updated_at: trx.fn.now() });
        const clearedPayment = { ...p, cleared: true, bank_account_id: acctId };

        if (p.local_sale_id) {
          const s = await trx('local_sales').where({ id: p.local_sale_id }).forUpdate().first();
          if (s) {
            const np = (parseFloat(s.paid_amount) || 0) + amount;
            const nd = Math.max(0, (parseFloat(s.total_amount) || 0) - np);
            await trx('local_sales').where({ id: s.id }).update({ paid_amount: np, due_amount: nd, payment_status: nd <= 0 ? 'Paid' : 'Partial', updated_at: trx.fn.now() });
            const r = await trx('receivables').where('local_sale_id', s.id).forUpdate().first();
            if (r) await applyReceivableDelta(trx, r, amount);
            // The cheque settles the sale today, so it reaches the GL today:
            // Dr 1000 / Cr 1120. Idempotent — a receipt already journaled when it
            // was recorded (the Finance path) is left alone.
            if (p.type === 'receipt') {
              await postLocalReceiptJournal(trx, { paymentNo: p.payment_no, amount, sale: s, date: new Date(), userId: req.user?.id });
            }
          }
        } else if (p.linked_receivable_id || p.service_invoice_id) {
          // The receivable and the service-milling invoice behind it — the
          // same helper recording and reversing use.
          const r = p.linked_receivable_id ? await trx('receivables').where({ id: p.linked_receivable_id }).forUpdate().first() : null;
          await settleDocuments(trx, { payment: clearedPayment, receivable: r, delta: amount, deltaPkr: amountPkr });
        } else if (p.linked_payable_id || (p.source_table && p.source_id)) {
          // Settle the payable (and its transport_costs record), then the
          // source row (Purchases / Mill Store / Expenses / export cost /
          // printed bags / lot) — the same helper recording and reversing use.
          const pa = p.linked_payable_id ? await trx('payables').where({ id: p.linked_payable_id }).forUpdate().first() : null;
          await settleDocuments(trx, {
            payment: clearedPayment, payable: pa, delta: amount, deltaPkr: amountPkr,
            stamp: { bank_account_id: acctId, payment_method: 'cheque', payment_reference: p.bank_reference || null },
          });
        }

        // The GL: the settlement journal recordPayment would have posted, under
        // the payment's own number, dated the day it cleared. Idempotent — a
        // cheque recorded under the old rules (a post-dated one journalled when
        // it was recorded) already has its journal and gets no second one.
        // Local-sale receipts journalled above (Dr 1000 / Cr 1120).
        if (!p.local_sale_id && (p.linked_receivable_id || p.linked_payable_id || p.service_invoice_id || (p.source_table && p.source_id))
          && !(await hasPaymentJournal(trx, p.payment_no))) {
          await postPaymentJournal(trx, { payment: clearedPayment, userId: req.user?.id, date: new Date() });
        }

        {
          // Exactly what recordPayment moves for a cleared payment: the amount
          // in the account's own currency (native when it matches the cheque,
          // else the PKR equivalent), less any WHT and discount — those never
          // leave the bank. This used to move the gross and stamp it PKR even
          // for a USD cheque into a USD account.
          const acct = acctRow;
          const wht = p.type === 'payment' ? (parseFloat(p.wht_amount) || 0) : 0;
          const disc = p.type === 'payment' ? (parseFloat(p.discount_amount) || 0) : 0;
          const bankMove = round2((acct && acct.currency === (p.currency || 'PKR') ? amount : amountPkr) - wht - disc);
          const dir = p.type === 'receipt' ? 'increment' : 'decrement';
          await trx('bank_accounts').where({ id: acctId })[dir]('current_balance', bankMove);
          await trx('bank_transactions').insert({
            transaction_no: await nextBtNo(trx), bank_account_id: acctId,
            type: p.type === 'receipt' ? 'credit' : 'debit', amount: bankMove, currency: acct?.currency || 'PKR', status: 'posted',
            transaction_date: new Date(), reference: p.bank_reference || null,
            notes: `Cheque cleared (${p.payment_no})`, source: 'cheque_clear', linked_payment_id: p.id, created_by: req.user?.id || null,
          });
        }
        return { cleared: true };
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      const s = err.status || err.statusCode || 500;
      if (s === 500) console.error('clearCheque error:', err);
      return res.status(s).json({ success: false, message: err.message });
    }
  },

  // Payment trail for one Money-Out PURCHASE row (Finance → Purchases). The data
  // is fragmented across flows, so we merge two disjoint settlement ledgers:
  //  (1) `payments` linked to the row's payable (Money-Out / statement flow), and
  //  (2) `bank_transactions` with source='pay_purchase' (the Purchases-tab flow;
  //      method inferred from the account type since it isn't stored on the txn).
  // Deduped by amount+date+account. Falls back to one synthesized line from the
  // source row's own payment fields when paid>0 but nothing is itemisable.
  async getPurchasePayments(req, res) {
    try {
      const { source, sourceId } = req.params;
      const id = parseInt(sourceId, 10);
      if (!id) return res.status(400).json({ success: false, message: 'sourceId must be numeric.' });

      const MAP = {
        lot:         { table: 'inventory_lots',    totalCol: 'landed_cost_total', refCol: 'lot_no' },
        mill_store:  { table: 'mill_purchases',    totalCol: 'total_amount',      refCol: 'purchase_no' },
        export_cost: { table: 'export_order_costs', totalCol: null,               refCol: null },
        expense:     { table: 'business_expenses', totalCol: 'amount_pkr',        refCol: 'expense_no' },
        printed_bag: { table: 'printed_bag_orders', totalCol: 'total_amount',     refCol: 'pbo_no' },
      };
      const cfg = MAP[source];
      if (!cfg) return res.status(400).json({ success: false, message: `Unknown source "${source}".` });
      const row = await db(cfg.table).where({ id }).first();
      if (!row) return res.status(404).json({ success: false, message: 'Purchase not found.' });

      const total = cfg.totalCol ? (parseFloat(row[cfg.totalCol]) || 0)
        : (parseFloat(row.base_amount_pkr) || (parseFloat(row.amount) || 0) * (parseFloat(row.fx_rate) || 1));
      const paid = parseFloat(row.paid_amount) || 0;
      const outstanding = Math.max(0, total - paid);
      const refToken = cfg.refCol ? row[cfg.refCol] : null;

      // (1) payments via the linked payable(s). Match BOTH keying schemes:
      // source_table+source_id (payPurchase) AND linked_ref=token (a lot's Raw
      // Material payable is keyed by lot_no), excluding the separate transport
      // payable.
      const payableIds = (await db('payables').where(function () {
        this.where({ source_table: cfg.table, source_id: id });
        if (refToken) this.orWhere(function () {
          this.where('linked_ref', refToken)
            .andWhere(function () { this.whereNull('source_table').orWhereNot('source_table', 'lot_transport'); });
        });
      }).select('id')).map((r) => r.id);
      let viaPayments = [];
      if (payableIds.length) {
        viaPayments = await db('payments as p')
          .leftJoin('bank_accounts as ba', 'ba.id', 'p.bank_account_id')
          .whereIn('p.linked_payable_id', payableIds)
          .select('p.amount', 'p.payment_method', 'p.payment_date', 'p.bank_reference',
            'ba.name as account_name', 'ba.bank_name', 'ba.type as account_type');
      }

      // (2) bank_transactions from the Purchases-tab payPurchase flow
      let viaBank = [];
      if (refToken) {
        viaBank = await db('bank_transactions as bt')
          .leftJoin('bank_accounts as ba', 'ba.id', 'bt.bank_account_id')
          .where({ 'bt.source': 'pay_purchase', 'bt.type': 'debit' })
          .where('bt.notes', 'ilike', `%${refToken}%`)
          .select('bt.amount', 'bt.transaction_date', 'bt.reference',
            'ba.name as account_name', 'ba.bank_name', 'ba.type as account_type');
      }

      const norm = [];
      for (const p of viaPayments) norm.push({
        amount: parseFloat(p.amount) || 0, date: p.payment_date, method: p.payment_method,
        account_name: p.account_name, bank_name: p.bank_name, account_type: p.account_type, reference: p.bank_reference,
      });
      for (const b of viaBank) norm.push({
        amount: parseFloat(b.amount) || 0, date: b.transaction_date,
        method: b.account_type === 'cash' ? 'cash' : 'bank_transfer',
        account_name: b.account_name, bank_name: b.bank_name, account_type: b.account_type, reference: b.reference,
      });

      const seen = new Set();
      let payments = norm.filter((x) => {
        // Include the reference so genuine distinct partials aren't merged (a
        // payment and its own bank_transaction share the reference → still dedup).
        const k = `${Math.round(x.amount)}|${x.date ? String(x.date).slice(0, 10) : ''}|${x.account_name || ''}|${x.reference || ''}`;
        if (seen.has(k)) return false; seen.add(k); return true;
      });

      // (3) fallback — settled but nothing itemisable → one synthesized line.
      // Gate on paid_amount>0 OR payment_status='Paid' (some rows mark Paid
      // without ever setting paid_amount), using total when paid is 0.
      const isPaidStatus = String(row.payment_status || '').toLowerCase() === 'paid';
      if (payments.length === 0 && (paid > 0 || isPaidStatus)) {
        const acct = row.bank_account_id ? await db('bank_accounts').where({ id: row.bank_account_id }).first() : null;
        payments.push({
          amount: paid > 0 ? paid : total, date: row.paid_date || row.paid_at || row.updated_at,
          method: row.payment_method || (acct?.type === 'cash' ? 'cash' : null),
          account_name: acct?.name || null, bank_name: acct?.bank_name || null,
          account_type: acct?.type || null, reference: row.payment_reference || null, synthesized: true,
        });
      }

      payments.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      return res.json({ success: true, data: { payments, paidAmount: paid, outstanding, total } });
    } catch (err) {
      console.error('getPurchasePayments error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Traceability breakdown of lot additional costs (transport / labor / unloading /
  // packing / bag / other) for Mill Finance — itemised by category, each carrying
  // the source lots so the figure can be traced back to where it was incurred.
  // Transport also carries the hauler + its payable paid/outstanding.
  async getMillLotCosts(req, res) {
    try {
      const lots = await db('inventory_lots as l')
        // Transport is owed to a hauler (item #5). New lots carry hauler_id;
        // legacy lots may still carry the supplier-based transport_vendor_id.
        .leftJoin('haulers as h', 'l.hauler_id', 'h.id')
        .leftJoin('suppliers as tv', 'l.transport_vendor_id', 'tv.id')
        .where(function () {
          this.where('l.transport_cost', '>', 0).orWhere('l.labor_cost', '>', 0)
            .orWhere('l.unloading_cost', '>', 0).orWhere('l.packing_cost', '>', 0)
            .orWhere('l.total_bag_cost', '>', 0).orWhere('l.other_cost', '>', 0);
        })
        .select('l.id', 'l.lot_no', 'l.transport_cost', 'l.labor_cost', 'l.unloading_cost',
          'l.packing_cost', 'l.total_bag_cost', 'l.other_cost',
          db.raw('COALESCE(l.hauler_id, l.transport_vendor_id) as transport_vendor_id'),
          db.raw('COALESCE(h.name, tv.name) as hauler_name'))
        .orderBy('l.lot_no', 'asc');

      // Stored transport payables (one per lot) for paid/outstanding on the hauler line.
      const tps = await db('payables').where({ source_table: 'lot_transport' })
        .select('id', 'source_id', 'paid_amount', 'outstanding', 'supplier_id', 'status');
      const tpByLot = {};
      for (const p of tps) tpByLot[p.source_id] = p;

      const CATS = [
        { key: 'transport', label: 'Transport', field: 'transport_cost' },
        { key: 'labor', label: 'Labor', field: 'labor_cost' },
        { key: 'unloading', label: 'Unloading', field: 'unloading_cost' },
        { key: 'packing', label: 'Packing', field: 'packing_cost' },
        { key: 'bag', label: 'Bag Cost', field: 'total_bag_cost' },
        { key: 'other', label: 'Other', field: 'other_cost' },
      ];

      const categories = CATS.map((c) => {
        const rows = lots
          .filter((l) => (parseFloat(l[c.field]) || 0) > 0)
          .map((l) => {
            const amount = parseFloat(l[c.field]) || 0;
            const base = { lotId: l.id, lotNo: l.lot_no, amount };
            if (c.key === 'transport') {
              const p = tpByLot[l.id];
              base.haulerId = l.transport_vendor_id || null;
              base.haulerName = l.hauler_name || null;
              base.payableId = p ? p.id : null; // #14 — target for the Pay Transporter slider
              base.paid = p ? parseFloat(p.paid_amount) || 0 : 0;
              base.outstanding = p ? parseFloat(p.outstanding) || 0 : (l.transport_vendor_id ? amount : 0);
              base.unassigned = !l.transport_vendor_id; // recorded but no hauler/payable yet
            }
            return base;
          });
        const total = rows.reduce((s, x) => s + x.amount, 0);
        return { key: c.key, label: c.label, total, count: rows.length, inCogs: c.key !== 'transport', lots: rows };
      }).filter((c) => c.total > 0);

      const grandTotal = categories.reduce((s, c) => s + c.total, 0);
      return res.json({ success: true, data: { categories, grandTotal } });
    } catch (err) {
      console.error('getMillLotCosts error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getPayables(req, res) {
    try {
      return await respondPayables(req, res, await loadPayablesFeed(req.query));
    } catch (err) {
      console.error('Get payables error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Mill Finance ▸ Suppliers for mill roles without finance.view (the Mill
  // Operator — owner decision 2026-10-05). The same feed, entity 'mill' only:
  // lot / rice purchases, mill transport + brokers, mill expenses, mill-store
  // purchases and the derived mill batch costs. Export payables never leave.
  async getMillPayables(req, res) {
    try {
      const rows = (await loadPayablesFeed(req.query)).filter((p) => String(p.entity || '').toLowerCase() === 'mill');
      return await respondPayables(req, res, rows);
    } catch (err) {
      console.error('Get mill payables error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getJournalEntries(req, res) {
    try {
      const { page = 1, limit = 20, entity_type, entity_id, from_date, to_date } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('journal_entries');

      if (entity_type) {
        query = query.where('entity', entity_type);
      }
      if (entity_id) {
        query = query.where('ref_no', entity_id);
      }
      if (from_date) {
        query = query.where('date', '>=', from_date);
      }
      if (to_date) {
        query = query.where('date', '<=', to_date);
      }

      const countQuery = query.clone().clearSelect().clearOrder().count('id as total').first();

      const [entries, countResult] = await Promise.all([
        query.orderBy('date', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      // Attach the underlying journal_lines so the FE can show the
      // DR/CR account split per entry without a per-row query.
      const entryIds = entries.map(e => e.id);
      const lines = entryIds.length
        ? await db('journal_lines').whereIn('journal_id', entryIds).orderBy(['journal_id', 'id'])
        : [];
      const linesByJournal = lines.reduce((acc, l) => {
        (acc[l.journal_id] = acc[l.journal_id] || []).push(l);
        return acc;
      }, {});
      const entriesWithLines = entries.map(e => ({
        ...e,
        lines: linesByJournal[e.id] || [],
      }));

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          entries: entriesWithLines,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Get journal entries error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getAlerts(req, res) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const num = (v) => parseFloat(v) || 0;
      const rs = (v) => 'Rs ' + Math.round(num(v)).toLocaleString();
      const safe = async (fn, dflt) => { try { return await fn(); } catch { return dflt; } };
      const alerts = [];

      // Overdue receivables (money owed to us, past due).
      const orr = await safe(() => db('receivables').where('due_date', '<', today).whereNot('status', 'Paid').count('id as c').sum('outstanding as t').first(), { c: 0, t: 0 });
      if (parseInt(orr.c, 10) > 0) alerts.push({ id: 'overdue_receivables', type: 'receivable', severity: 'warning', title: 'Overdue receivables', message: `${orr.c} receivable(s) past due — ${rs(orr.t)} still to collect.`, count: parseInt(orr.c, 10), total: num(orr.t), link: '/finance/money-in' });

      // Overdue payables (we owe, past due).
      const orp = await safe(() => db('payables').where('due_date', '<', today).whereNot('status', 'Paid').where('outstanding', '>', 0).count('id as c').sum('outstanding as t').first(), { c: 0, t: 0 });
      if (parseInt(orp.c, 10) > 0) alerts.push({ id: 'overdue_payables', type: 'payable', severity: 'danger', title: 'Overdue payables', message: `${orp.c} bill(s) past due — ${rs(orp.t)} owed.`, count: parseInt(orp.c, 10), total: num(orp.t), link: '/finance/money-out' });

      // Overdrawn bank/cash accounts.
      const negBanks = await safe(() => db('bank_accounts').where('current_balance', '<', 0).where('is_active', true).select('name', 'current_balance', 'currency'), []);
      for (const b of negBanks) {
        const pfx = (b.currency === 'USD') ? '$' : 'Rs ';
        alerts.push({ id: `neg_bank_${b.name}`, type: 'bank', severity: 'danger', title: 'Account overdrawn', message: `${b.name} balance is negative: ${pfx}${Math.round(num(b.current_balance)).toLocaleString()}.`, link: '/finance/cash' });
      }

      // Cheques past their clearing date but not yet cleared.
      const oc = await safe(() => db('payments').where('payment_method', 'cheque').where('cleared', false).whereNotNull('due_date').where('due_date', '<', today).count('id as c').sum('amount as t').first(), { c: 0, t: 0 });
      if (parseInt(oc.c, 10) > 0) alerts.push({ id: 'overdue_cheques', type: 'cheque', severity: 'warning', title: 'Cheques awaiting clearance', message: `${oc.c} cheque(s) are past their clearing date — ${rs(oc.t)}.`, count: parseInt(oc.c, 10), total: num(oc.t), link: '/finance/due-dates' });

      // Due within the next 7 days (heads-up, info).
      const dueRecv = await safe(() => db('receivables').whereBetween('due_date', [today, in7]).whereNot('status', 'Paid').count('id as c').sum('outstanding as t').first(), { c: 0, t: 0 });
      if (parseInt(dueRecv.c, 10) > 0) alerts.push({ id: 'due_recv', type: 'receivable', severity: 'info', title: 'Receivables due this week', message: `${dueRecv.c} receivable(s) due within 7 days — ${rs(dueRecv.t)}.`, count: parseInt(dueRecv.c, 10), total: num(dueRecv.t), link: '/finance/due-dates' });
      const duePay = await safe(() => db('payables').whereBetween('due_date', [today, in7]).whereNot('status', 'Paid').where('outstanding', '>', 0).count('id as c').sum('outstanding as t').first(), { c: 0, t: 0 });
      if (parseInt(duePay.c, 10) > 0) alerts.push({ id: 'due_pay', type: 'payable', severity: 'info', title: 'Payables due this week', message: `${duePay.c} bill(s) due within 7 days — ${rs(duePay.t)}.`, count: parseInt(duePay.c, 10), total: num(duePay.t), link: '/finance/due-dates' });

      // Export orders awaiting action.
      const po = await safe(() => db('export_orders').whereIn('status', ['Draft', 'Awaiting Advance']).count('id as c').first(), { c: 0 });
      if (parseInt(po.c, 10) > 0) alerts.push({ id: 'pending_orders', type: 'order', severity: 'info', title: 'Orders awaiting action', message: `${po.c} export order(s) in Draft / Awaiting Advance.`, count: parseInt(po.c, 10) });

      return res.json({ success: true, data: { alerts } });
    } catch (err) {
      console.error('Get alerts error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getOverview(req, res) {
    try {
      const [
        totalOrders,
        activeOrders,
        totalRevenue,
        totalReceivables,
        totalPayables,
        millingBatches,
      ] = await Promise.all([
        db('export_orders').count('id as count').first(),
        db('export_orders')
          .whereNotIn('status', ['Closed', 'Cancelled'])
          .count('id as count')
          .first(),
        db('export_orders')
          .where('status', 'Closed')
          .sum('contract_value as total')
          .first(),
        db('receivables')
          .whereNot('status', 'Paid')
          .sum('outstanding as total')
          .first(),
        db('payables')
          .whereNot('status', 'Paid')
          .sum('outstanding as total')
          .first(),
        db('milling_batches')
          .whereNotIn('status', ['Completed', 'Cancelled'])
          .count('id as count')
          .first(),
      ]);

      return res.json({
        success: true,
        data: {
          overview: {
            total_orders: parseInt(totalOrders.count) || 0,
            active_orders: parseInt(activeOrders.count) || 0,
            total_revenue: parseFloat(totalRevenue.total) || 0,
            outstanding_receivables: parseFloat(totalReceivables.total) || 0,
            outstanding_payables: parseFloat(totalPayables.total) || 0,
            active_milling_batches: parseInt(millingBatches.count) || 0,
          },
        },
      });
    } catch (err) {
      console.error('Get overview error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Unified payments feed — every receipt and payment from the
  // payments table, joined with receivables/payables/local_sales for
  // human-friendly counterparty + source labels. Powers the Money In
  // and Money Out tabs on the Reports hub.
  async listPayments(req, res) {
    try {
      const { type, from_date, to_date, entity } = req.query;
      // The list is a page (newest first); the totals below cover the WHOLE
      // filtered set, so the cap never silently shrinks a total.
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 5000);
      const filters = { type, from_date, to_date, entity };
      // Pending/Rejected export receipts (item 14) aren't banked money yet —
      // excluded from Money-In/Out until Finance confirms (then a real
      // confirmed row exists). See paymentsFeedTotals.feedBase.
      const q = feedBase(db, filters)
        .leftJoin('customers as c',   'r.customer_id',          'c.id')
        .leftJoin('suppliers as s',   'pa.supplier_id',         's.id')
        .leftJoin('bank_accounts as ba','p.bank_account_id',    'ba.id')
        .select(
          'p.id', 'p.payment_no', 'p.type', 'p.amount', 'p.currency',
          'p.fx_rate', 'p.base_amount_pkr', 'p.payment_method',
          'p.payment_date', 'p.bank_reference', 'p.notes', 'p.created_at',
          'p.status', 'p.cleared',
          'p.linked_receivable_id', 'p.linked_payable_id', 'p.local_sale_id',
          'r.recv_no as recv_no', 'r.entity as recv_entity', 'r.type as recv_type', 'r.customer_id as recv_customer_id',
          'pa.pay_no as pay_no', 'pa.entity as pay_entity', 'pa.payable_type', 'pa.linked_ref as pay_linked_ref', 'pa.supplier_id as pay_supplier_id',
          'c.name as customer_name',
          's.name as supplier_name',
          'ls.sale_no as sale_no', 'ls.buyer_name as sale_buyer', 'ls.customer_id as sale_customer_id',
          'ba.name as bank_name', 'ba.currency as bank_currency'
        );
      const [rows, agg] = await Promise.all([
        q.orderBy('p.payment_date', 'desc')
          .orderBy('p.created_at', 'desc')
          .orderBy('p.id', 'desc')
          .limit(limit),
        feedTotals(db, filters),
      ]);

      // Confidentiality: restricted roles (everyone except Super Admin / Owner)
      // see the reference (recv_no / sale_no / pay_no) but NOT the trading-party
      // name — both customers and suppliers are masked to a generic label with no
      // link. Transporter references (pay_linked_ref on freight payments) are not
      // party names, so they stay.
      const masked = await isPartyMasked(req);

      // Compose a single counterparty + source label per row so the FE
      // doesn't have to do the joining gymnastics.
      const enriched = rows.map(r => {
        let counterparty = '—';
        let sourceRef = null;
        let sourceHref = null;
        // Party identity so the FE can link the counterparty to its statement.
        let counterparty_type = null;
        let counterparty_id = null;
        if (r.type === 'receipt') {
          const isLocalSale = (r.recv_no && r.recv_no.startsWith('RCV-LS')) || !!r.local_sale_id;
          if (masked) {
            counterparty = isLocalSale ? 'Customer' : 'Export customer';
            counterparty_id = null;
          } else {
            counterparty = r.customer_name || r.sale_buyer || 'Walk-in customer';
            counterparty_id = r.recv_customer_id || r.sale_customer_id || null;
          }
          sourceRef = r.recv_no || r.sale_no || null;
          counterparty_type = 'customer';
          // Link to the local-sales screen for any sale-linked receipt — both
          // the RCV-LS receivables and the party-ledger receipts that carry a
          // local_sale_id (their recv_no is null, so the prefix check missed them).
          if (isLocalSale) sourceHref = '/local-sales';
        } else if (masked) {
          // Restricted roles: never expose a party name here. Do NOT fall back to
          // pay_linked_ref — it can hold a name (e.g. a payroll worker), not just a
          // reference. The payment is still identified by sourceRef (pay_no).
          counterparty = r.supplier_name ? 'Supplier' : 'Vendor';
          counterparty_id = null;
          sourceRef = r.pay_no || null;
          counterparty_type = 'supplier';
        } else {
          counterparty = r.supplier_name || r.pay_linked_ref || 'Vendor';
          sourceRef = r.pay_no || null;
          counterparty_type = 'supplier';
          counterparty_id = r.pay_supplier_id || null;
        }
        return { ...r, counterparty, sourceRef, sourceHref, counterparty_type, counterparty_id };
      });

      // Each row keeps a PKR-equivalent for its own display (base_amount_pkr →
      // amount × fx_rate → 280 fallback; see paymentToPkr). It is NOT summed:
      // the totals are per currency, from SQL over the whole filtered set.
      for (const r of enriched) {
        r.base_amount_pkr_normalized = paymentToPkr(r);
        // Not money in/out: reversed, or a cheque that has not cleared.
        r.counts_in_total = r.status !== 'Reversed' && r.cleared !== false;
      }

      return res.json({
        success: true,
        data: {
          payments: enriched,
          // Rows returned (this page) vs rows matching the filters.
          count: enriched.length,
          total_count: agg.totalCount,
          limit,
          truncated: agg.totalCount > enriched.length,
          // { PKR: { amount, count }, USD: { amount, count } } — settled money
          // only (no Reversed, no uncleared cheques); never added across currencies.
          totals: agg.totals,
          pending_cheques: agg.pendingCheques,
          reversed_count: agg.reversedCount,
          by_source: agg.bySource,
        },
      });
    } catch (err) {
      console.error('List payments error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async recordPayment(req, res) {
    try {
      const {
        type,
        linked_receivable_id,
        linked_payable_id,
        amount,
        currency,
        payment_date,
        payment_method,
        bank_account_id,
        bank_reference,
        due_date,
        notes,
        wht_amount,
        wht_rate,
        discount_amount,
        attachment_url,
        attachment_name,
      } = req.body;

      const entity_id = linked_receivable_id || linked_payable_id;
      if (!type || !entity_id || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'type, linked_receivable_id or linked_payable_id, and a positive amount are required.',
        });
      }
      // Without finance.confirm_payment (the Mill Operator, via milling.edit)
      // only mill payables / receivables, through a mill account.
      const millOnly = await isMillOnlyPayer(req);
      const isReceipt = type === 'receipt';

      const result = await db.transaction(async (trx) => {
        // The document, read UNDER A LOCK; the engine checks it against the
        // outstanding (net of uncleared cheques) and settles it.
        const linkedRow = await trx(isReceipt ? 'receivables' : 'payables').where({ id: entity_id }).forUpdate().first();
        if (!linkedRow) {
          const e = new Error(`${isReceipt ? 'Receivable' : 'Payable'} not found.`); e.statusCode = 404; throw e;
        }

        // An export order's advance / balance receivable is settled by the
        // order's own maker-checker flow: Money In records it as 'Pending
        // Finance Confirmation' exactly like the order's Financials tab, and
        // Finance ▸ Confirmations posts it (order advance/balance, workflow,
        // 1310 / 1110). Settling only the receivable left the order showing
        // money still owed and 1310 never reclassified at shipment.
        if (isReceipt && linkedRow.order_id) {
          if (millOnly) assertMillEntity(linkedRow.entity, 'receivables');
          const order = await trx('export_orders').where({ id: linkedRow.order_id }).first();
          if (!order) { const e = new Error('Export order not found for this receivable.'); e.statusCode = 404; throw e; }
          const pending = await recordPendingExportReceipt(trx, {
            order,
            kind: String(linkedRow.type || '').toLowerCase() === 'balance' ? 'balance' : 'advance',
            amount,
            bankAccountId: bank_account_id || null,
            fxRate: null,
            paymentDate: payment_date || null,
            paymentMethod: payment_method || null,
            bankReference: bank_reference || null,
            notes: notes || null,
            userId: req.user.id,
          });
          return { payment: pending, pendingConfirmation: true };
        }

        // A foreign amount converts at today's rate for its currency (the
        // engine's default; export-order receipts never reach here).
        const cur = (currency || 'PKR').toUpperCase();

        const { payment } = await recordMoneyMovement(trx, {
          type,
          payable: isReceipt ? null : linkedRow,
          receivable: isReceipt ? linkedRow : null,
          amount,
          currency: cur,
          method: payment_method || null,
          bankAccountId: bank_account_id || null,
          paymentDate: payment_date || null,
          dueDate: due_date || null,
          bankReference: bank_reference || null,
          notes: notes || null,
          wht: wht_amount,
          whtRate: wht_rate,
          discount: discount_amount,
          attachmentUrl: attachment_url || null,
          attachmentName: attachment_name || null,
          userId: req.user.id,
          millOnly,
          bt: { notes: `${isReceipt ? 'Receipt' : 'Payment'} for ${isReceipt ? 'receivable' : 'payable'} ${linkedRow.recv_no || linkedRow.pay_no || `#${entity_id}`}` },
        });
        return { payment, pendingConfirmation: false };
      });

      return res.status(201).json({
        success: true,
        data: { payment: result.payment, pending_confirmation: result.pendingConfirmation },
        ...(result.pendingConfirmation ? { message: 'Recorded — pending Finance confirmation.' } : {}),
      });
    } catch (err) {
      const code = err.statusCode || err.status || 500;
      if (code === 500) console.error('Record payment error:', err);
      return res.status(code).json({ success: false, message: code === 500 ? 'Internal server error.' : err.message });
    }
  },

  // Reverse an incorrect payment or receipt. Each step undoes only what the
  // original actually did:
  //  - the payable / receivable / local sale / source row are restored only
  //    when the money moved (a post-dated cheque that never cleared never
  //    touched them, so subtracting it would under-state what is owed);
  //  - the bank is restored by the NET that moved, in the account's currency;
  //  - the GL gets the signed delta of the journal the payment posted (found
  //    by ref_no = payment_no), as a fresh Posted journal — never reverseJournal,
  //    so the Posted-only trial balance nets to zero. A Purchases-tab payment
  //    journals under its lot / purchase label instead, so for a cleared one
  //    with no payment_no journal the inverse is built from the payment.
  // The payment is stamped 'Reversed' and kept for audit. Export receipts
  // confirmed on the order (confirmAdvance / confirmExportReceipt) also moved
  // the order's advance/balance and journal under the order number, so they
  // are refused here and undone from the order.
  async reversePayment(req, res) {
    try {
      const paymentId = parseInt(req.params.id, 10);
      const reason = (req.body && req.body.reason) || null;
      if (!paymentId) return res.status(400).json({ success: false, message: 'Invalid payment id.' });
      const fail = (msg, code = 400) => { const e = new Error(msg); e.statusCode = code; return e; };

      const out = await db.transaction(async (trx) => {
        // Locked: two reversals of the same payment must not both pass the
        // 'Reversed' check and both restore the money.
        const pay = await trx('payments').where({ id: paymentId }).forUpdate().first();
        if (!pay) throw fail('Payment not found.', 404);
        if (pay.status === 'Reversed') throw fail('This payment has already been reversed.');
        if (pay.status === 'Rejected' || pay.status === 'Pending Finance Confirmation') {
          throw fail('Only a confirmed payment can be reversed — this one never moved any money.');
        }
        const isPayment = pay.type === 'payment' && (pay.linked_payable_id || (pay.source_table && pay.source_id));
        const isReceipt = pay.type === 'receipt' && (pay.linked_receivable_id || pay.local_sale_id || pay.service_invoice_id);
        if (pay.type === 'receipt' && pay.source_table === 'export_orders') {
          throw fail('This receipt was confirmed on its export order, which also recorded it against the order\'s advance/balance. Reverse it from the export order instead.');
        }
        if (!isPayment && !isReceipt) {
          throw fail('Only a payment against a payable, or a receipt against a receivable or local sale, can be reversed here.');
        }
        if (isReceipt && pay.service_invoice_id && !(await hasPaymentJournal(trx, pay.payment_no))) {
          // An older service-milling receipt posted no journal: voiding the
          // invoice is what undoes it.
          throw fail('This service-milling receipt is undone by voiding its invoice.');
        }

        const amt = parseFloat(pay.amount) || 0;
        const amtPkr = parseFloat(pay.base_amount_pkr) || amt;
        const whtR = parseFloat(pay.wht_amount) || 0;
        const discR = parseFloat(pay.discount_amount) || 0;
        const wasCleared = pay.cleared !== false; // an uncleared post-dated cheque never moved money
        const today = new Date().toISOString().slice(0, 10);
        const label = `Reversal of ${pay.type === 'receipt' ? 'receipt' : 'payment'} ${pay.payment_no}${reason ? ` — ${reason}` : ''}`;
        // The journal(s) this payment posted under its own number: recordPayment
        // and expense payments ('Payment'), local-sale receipts ('Local Sale Receipt').
        const ownJournalTypes = isReceipt ? ['Payment', 'Local Sale Receipt'] : ['Payment'];

        let receivable = null;
        if (isReceipt) {
          if (pay.linked_receivable_id) receivable = await trx('receivables').where({ id: pay.linked_receivable_id }).forUpdate().first();
          else if (pay.local_sale_id) receivable = await trx('receivables').where({ local_sale_id: pay.local_sale_id }).forUpdate().first();
          else if (pay.service_invoice_id) receivable = await trx('receivables').where({ service_invoice_id: pay.service_invoice_id }).forUpdate().first();
          if (receivable?.order_id) {
            const own = await trx('journal_entries')
              .where({ ref_no: pay.payment_no, ref_type: 'Payment', status: 'Posted' }).first('id');
            if (!own) {
              throw fail('This receipt was confirmed on its export order, which also recorded it against the order\'s advance/balance. Reverse it from the export order instead.');
            }
          }
        }

        // 1) Restore what the payment settled (only if it moved money).
        let payable = null;
        if (isPayment) {
          payable = pay.linked_payable_id
            ? await trx('payables').where({ id: pay.linked_payable_id }).forUpdate().first()
            : null;
          if (wasCleared) await settleDocuments(trx, { payment: pay, payable, delta: -amt, deltaPkr: -amtPkr });
        } else if (wasCleared) {
          // The receivable, the local sale and the service invoice behind it.
          await settleDocuments(trx, { payment: pay, receivable, delta: -amt, deltaPkr: -amtPkr });
        }

        // 2) Restore the bank by the NET that moved, plus a reversing sub-ledger row.
        if (wasCleared && pay.bank_account_id) {
          const acct = await trx('bank_accounts').where({ id: pay.bank_account_id }).first();
          const bankMove = round2((acct && acct.currency === pay.currency ? amt : amtPkr) - whtR - discR);
          await trx('bank_accounts').where({ id: pay.bank_account_id })
            .increment('current_balance', isReceipt ? -bankMove : bankMove);
          if (await trx.schema.hasTable('bank_transactions')) {
            await trx('bank_transactions').insert({
              transaction_no: await nextBtNo(trx),
              bank_account_id: pay.bank_account_id, type: isReceipt ? 'debit' : 'credit', amount: bankMove,
              currency: acct?.currency || 'PKR', status: 'posted', transaction_date: new Date(),
              reference: pay.payment_no, counterparty: null,
              notes: label, source: 'payment_reversal',
              linked_payment_id: pay.id, created_by: req.user?.id || null,
            });
          }
        }

        // 3) The GL: the signed delta of whatever this payment posted. An
        //    uncleared cheque posts nothing until it clears, so there is
        //    nothing to mirror and it is simply marked Reversed — except one
        //    recorded under the old rules (post-dated cheques used to journal
        //    at recording), whose journal is found here and undone.
        try {
          const mirrored = await postDeltaOf(trx, {
            refNo: pay.payment_no, refTypes: ownJournalTypes,
            refType: 'Payment Reversal', description: label, userId: req.user?.id, date: today,
          });
          if (!mirrored && wasCleared && isPayment) {
            // A Purchases-tab payment (journalled under the lot / purchase
            // label): Dr net Cash (+ Dr WHT + Dr Discount) / Cr Payable (gross).
            const cashAndBank = await trx('chart_of_accounts').where({ code: '1000' }).first();
            const counterAcc = await trx('chart_of_accounts').where({ code: '2010' }).first();
            if (!cashAndBank || !counterAcc) throw missingAccounts(['1000', '2010'], 'The reversal');
            let partyType = null, partyId = null;
            if (payable?.supplier_id) { partyType = 'supplier'; partyId = payable.supplier_id; }
            else if (payable?.hauler_id) { partyType = 'hauler'; partyId = payable.hauler_id; }
            const netCashPkr = Number((amtPkr - whtR - discR).toFixed(2));
            const revLines = [
              { account_id: cashAndBank.id, account: cashAndBank.name, debit: netCashPkr, credit: 0, narration: `DR ${cashAndBank.code} ${cashAndBank.name} — reversal ${pay.payment_no}` },
            ];
            if (whtR > 0) {
              const whtAcc = await trx('chart_of_accounts').where({ code: '2060' }).first();
              if (whtAcc) revLines.push({ account_id: whtAcc.id, account: whtAcc.name, debit: Number(whtR.toFixed(2)), credit: 0, narration: `DR ${whtAcc.code} ${whtAcc.name} — WHT reversal ${pay.payment_no}` });
            }
            if (discR > 0) {
              const discAcc = await trx('chart_of_accounts').where({ code: '4060' }).first();
              if (discAcc) revLines.push({ account_id: discAcc.id, account: discAcc.name, debit: Number(discR.toFixed(2)), credit: 0, narration: `DR ${discAcc.code} ${discAcc.name} — discount reversal ${pay.payment_no}` });
            }
            revLines.push({ account_id: counterAcc.id, account: counterAcc.name, debit: 0, credit: amtPkr, narration: `CR ${counterAcc.code} ${counterAcc.name} — reversal ${pay.payment_no}` });
            const j = await accountingService.createJournal(trx, {
              date: today, entity: 'mill',
              refType: 'Payment Reversal', refNo: pay.payment_no,
              description: label,
              currency: 'PKR', fxRate: 1, isAuto: true, userId: req.user?.id, partyType, partyId,
              lines: revLines,
            });
            if (j?.id) await accountingService.postJournal(trx, j.id);
          }
        } catch (jeErr) {
          // A reversal without its inverse journal leaves the GL showing a
          // payment the books no longer have — roll the whole reversal back.
          throw ledgerFailure(jeErr, 'The reversal');
        }

        // 4) Stamp the payment Reversed (kept for audit).
        const [updated] = await trx('payments').where({ id: paymentId }).update({
          status: 'Reversed', reversed_at: trx.fn.now(), reversed_by: req.user?.id || null,
          reversal_reason: reason, updated_at: trx.fn.now(),
        }).returning('*');
        return updated;
      });

      return res.json({ success: true, data: { payment: out } });
    } catch (err) {
      const code = err.statusCode || 500;
      if (code === 500) console.error('reversePayment error:', err);
      return res.status(code).json({ success: false, message: code === 500 ? 'Internal server error.' : err.message });
    }
  },

  async getBankAccounts(req, res) {
    try {
      // Starred accounts first (mig 293), then alphabetical — this one list
      // feeds every payment dropdown in the app, so the ordering is set here.
      const accounts = await db('bank_accounts')
        .orderBy('is_favorite', 'desc')
        .orderBy('name', 'asc');

      // The Mill role transacts only through its own Mill Cash account and must
      // NOT see Head Office bank balances. For that role, blank out the balance
      // on every non-mill account (names/type/entity are kept so transfer
      // destinations and account-name lookups still resolve). Resolve the role
      // by NAME — role_id differs across environments.
      let roleName = null;
      if (req.user?.role_id) {
        const r = await db('roles').where({ id: req.user.role_id }).first('name');
        roleName = r?.name || null;
      }
      const scoped = roleName === 'Mill Manager'
        ? accounts.map((a) => ((a.entity || 'general') === 'mill'
          ? a
          : { ...a, current_balance: null }))
        : accounts;

      return res.json({
        success: true,
        data: { accounts: scoped },
      });
    } catch (err) {
      console.error('Get bank accounts error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // The mill's own accounts for the payment pickers of mill roles without
  // finance.view (the Mill Operator). A mill-only payer may move money only
  // through these (see shared/millPayer). Identity fields only; the balance
  // rides along for holders of reports.view_cost.
  async getMillBankAccounts(req, res) {
    try {
      const rows = await db('bank_accounts')
        .where({ entity: 'mill', is_active: true })
        .orderBy('is_favorite', 'desc')
        .orderBy('name', 'asc');
      const showBalance = await canSeeCost(req);
      const accounts = rows
        .filter((a) => String(a.entity || '').toLowerCase() === 'mill' && a.is_active !== false)
        .map((a) => ({
          id: a.id, name: a.name, type: a.type, currency: a.currency, bank_name: a.bank_name || null,
          entity: a.entity, is_active: a.is_active, is_favorite: !!a.is_favorite,
          current_balance: showBalance ? a.current_balance : null,
        }));
      return res.json({ success: true, data: { accounts } });
    } catch (err) {
      console.error('Get mill bank accounts error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getBankTransactions(req, res) {
    try {
      // Check if table exists (it may not have been created yet)
      const tableExists = await db.schema.hasTable('bank_transactions');
      if (!tableExists) {
        return res.json({ success: true, data: { transactions: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } });
      }

      const { page = 1, limit = 20, bank_account_id, from_date, to_date } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      // Rows written by a fund / contra transfer carry fund_transfer_id (mig
      // 319): bring the transfer's direction and both account names along so
      // the Cash page can label them "CONTRA · From → To" and open the transfer.
      let query = db('bank_transactions as bt')
        .leftJoin('bank_accounts as ba', 'bt.bank_account_id', 'ba.id')
        .leftJoin('fund_transfers as ft', 'ft.id', 'bt.fund_transfer_id')
        .leftJoin('bank_accounts as fta', 'fta.id', 'ft.from_account_id')
        .leftJoin('bank_accounts as ftb', 'ftb.id', 'ft.to_account_id')
        .select('bt.*', 'ba.name as account_name',
          'ft.transfer_no as ft_transfer_no', 'ft.direction as ft_direction', 'ft.status as ft_status',
          'fta.name as ft_from_account_name', 'ftb.name as ft_to_account_name');

      if (bank_account_id) {
        query = query.where('bt.bank_account_id', bank_account_id);
      }
      if (from_date) {
        query = query.where('bt.transaction_date', '>=', from_date);
      }
      if (to_date) {
        query = query.where('bt.transaction_date', '<=', to_date);
      }

      const countQuery = query.clone().clearSelect().clearOrder().count('bt.id as total').first();

      const [transactions, countResult] = await Promise.all([
        query
          .orderBy('bt.transaction_date', 'desc')
          .orderBy('bt.created_at', 'desc')
          .orderBy('bt.id', 'desc')
          .limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          transactions,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Get bank transactions error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getInternalTransfers(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('internal_transfers as it')
        .leftJoin('milling_batches as mb', 'it.batch_id', 'mb.id')
        .leftJoin('export_orders as eo', 'it.export_order_id', 'eo.id')
        .select(
          'it.*',
          'mb.batch_no',
          'eo.order_no as export_order_no'
        );

      const countQuery = query.clone().clearSelect().clearOrder().count('it.id as total').first();

      const [transfers, countResult] = await Promise.all([
        query.orderBy('it.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          transfers,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Get internal transfers error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createInternalTransfer(req, res) {
    try {
      const {
        batch_id,
        export_order_id,
        product_name,
        qty_mt,
        transfer_price_pkr,
        total_value_pkr,
        usd_equivalent,
        pkr_rate,
        dispatch_date,
        status,
      } = req.body;

      if (!batch_id || !export_order_id || !qty_mt || parseFloat(qty_mt) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'batch_id, export_order_id, and a positive qty_mt are required.',
        });
      }

      // Service Milling stock is CLIENT-owned — it must never enter the company
      // export/sale pipeline. Reject up front if the source batch is a service
      // (toll/job-work) batch; the client's rice leaves only via a Service
      // Milling dispatch, not an internal transfer to an export order.
      const srcBatch = await db('milling_batches')
        .where('id', batch_id)
        .select('is_service_milling')
        .first();
      if (srcBatch && srcBatch.is_service_milling) {
        return res.status(422).json({
          success: false,
          message: 'This is a Service Milling (client-owned) batch. Its rice cannot be transferred to export — hand it to the client via a Service Milling dispatch instead.',
        });
      }

      const transfer = await db.transaction(async (trx) => {
        // Per-batch cap: everything transferred from this batch (non-cancelled)
        // may not exceed the batch's finished output. The FIFO draw below only
        // checks TOTAL mill stock, so without this a batch could be transferred
        // twice (once from its own lots, again from other batches' stock). Lock
        // the batch row so two concurrent transfers can't both pass the check.
        const capBatch = await trx('milling_batches')
          .where('id', batch_id)
          .select('id', 'batch_no', 'actual_finished_kg')
          .forUpdate()
          .first();
        if (!capBatch) {
          const err = new Error('Milling batch not found.');
          err.status = 404;
          throw err;
        }
        const requestedKg = parseFloat(qty_mt) * 1000;
        const finishedKg = parseFloat(capBatch.actual_finished_kg) || 0;
        const prior = await trx('internal_transfers')
          .where('batch_id', batch_id)
          .where(function () { this.whereNot('status', 'Cancelled').orWhereNull('status'); })
          .sum('qty_kg as kg')
          .first();
        const alreadyKg = parseFloat(prior?.kg) || 0;
        const remainingBatchKg = Math.max(0, finishedKg - alreadyKg);
        if (requestedKg > remainingBatchKg + 1e-3) {
          const err = new Error(
            `Batch ${capBatch.batch_no || batch_id} has only ${Math.round(remainingBatchKg).toLocaleString()} kg of finished output `
            + `left to transfer (finished ${Math.round(finishedKg).toLocaleString()} kg, already transferred `
            + `${Math.round(alreadyKg).toLocaleString()} kg); requested ${Math.round(requestedKg).toLocaleString()} kg.`
          );
          err.status = 422;
          throw err;
        }

        const transferNo = await generateTransferNo(trx);

        const [t] = await trx('internal_transfers')
          .insert({
            transfer_no: transferNo,
            batch_id,
            export_order_id,
            product_name: product_name || null,
            qty_kg: parseFloat(qty_mt) * 1000, // FE sends MT; internal_transfers stores KG (Phase 5c)
            transfer_price_pkr: transfer_price_pkr ? parseFloat(transfer_price_pkr) : null,
            total_value_pkr: total_value_pkr ? parseFloat(total_value_pkr) : null,
            usd_equivalent: usd_equivalent ? parseFloat(usd_equivalent) : null,
            pkr_rate: pkr_rate ? parseFloat(pkr_rate) : 280,
            dispatch_date: dispatch_date || null,
            status: status || 'Pending',
            created_by: req.user.id,
          })
          .returning('*');

        // Move the stock, drawing from one OR MORE mill finished lots (FIFO by
        // oldest) so fragmented stock still transfers. Use available_qty (not qty)
        // so already-transferred/reserved stock isn't double-counted. Fail LOUDLY
        // if total on-hand is short — we must never post the GL journals / raw_rice
        // cost below without a matching inventory movement (that would decouple the
        // books from physical stock, the exact invariant the 5c harness protects).
        // Prefer this transfer's OWN batch output lots (batch_ref = 'batch-<id>'),
        // then fall back to other mill finished stock oldest-first.
        // NEVER draw client-owned Service Milling stock (ownership='client') into
        // a company export transfer — that inventory belongs to the client and is
        // ring-fenced from the export/sale pipeline. Company stock is ownership
        // 'company' or NULL (legacy rows), so exclude only 'client'.
        const candidateLots = await trx('inventory_lots')
          .where({ entity: 'mill', type: 'finished' })
          .where('available_qty', '>', 0)
          .where(function () { this.whereNot('ownership', 'client').orWhereNull('ownership'); })
          .orderByRaw('(batch_ref = ?) DESC, created_at ASC', [`batch-${batch_id}`]);

        const totalAvailableKg = candidateLots.reduce((s, l) => s + (parseFloat(l.available_qty) || 0), 0);
        if (totalAvailableKg + 1e-6 < t.qty_kg) {
          const err = new Error(
            `Insufficient mill finished stock to transfer: need ${Math.round(t.qty_kg).toLocaleString()} kg, `
            + `only ${Math.round(totalAvailableKg).toLocaleString()} kg available across ${candidateLots.length} lot(s).`
          );
          err.status = 422;
          throw err;
        }

        let remainingKg = t.qty_kg;
        for (const lot of candidateLots) {
          if (remainingKg <= 1e-6) break;
          const takeKg = Math.min(parseFloat(lot.available_qty) || 0, remainingKg);
          if (takeKg <= 0) continue;
          await inventoryService.transferToExport(trx, {
            transferId: t.id,
            lotId: lot.id,
            qtyKg: takeKg,
            productName: t.product_name,
            orderId: t.export_order_id,
            transferPricePerMT: parseFloat(t.transfer_price_pkr) || 0,
            // Split the transfer value proportionally across the source lots.
            totalValuePkr: (parseFloat(t.total_value_pkr) || 0) * (takeKg / t.qty_kg),
            userId: req.user?.id,
          });
          remainingKg -= takeKg;
        }

        // Auto-post accounting journals for both entities
        const transferAmount = parseFloat(t.total_value_pkr || 0);
        if (transferAmount > 0) {
          await accountingService.autoPost(trx, {
            triggerEvent: 'internal_transfer_mill',
            entity: 'mill',
            amount: transferAmount,
            currency: 'PKR',
            refType: 'Internal Transfer',
            refNo: t.transfer_no || `IT-${t.id}`,
            description: `Internal transfer (mill side) — ${t.product_name || 'rice'}`,
            userId: req.user?.id,
          });

          await accountingService.autoPost(trx, {
            triggerEvent: 'internal_transfer_export',
            entity: 'export',
            amount: parseFloat(t.usd_equivalent || transferAmount),
            currency: 'USD',
            refType: 'Internal Transfer',
            refNo: t.transfer_no || `IT-${t.id}`,
            description: `Internal transfer (export side) — ${t.product_name || 'rice'}`,
            userId: req.user?.id,
          });
        }

        if (t.export_order_id) {
          // Transfer value is in PKR — convert to order currency using order's locked FX rate
          const linkedOrder = await trx('export_orders').where('id', t.export_order_id).first();
          const orderFxRate = parseFloat(linkedOrder?.booked_fx_rate) || parseFloat(t.pkr_rate) || 280;
          const valuePkr = parseFloat(t.total_value_pkr) || 0;
          const valueInOrderCurrency = valuePkr / orderFxRate;

          if (valueInOrderCurrency > 0) {
            const existingCost = await trx('export_order_costs')
              .where({ order_id: t.export_order_id, category: 'raw_rice' })
              .first();

            if (existingCost) {
              await trx('export_order_costs')
                .where({ id: existingCost.id })
                .update({
                  amount: parseFloat(existingCost.amount || 0) + valueInOrderCurrency,
                  currency: linkedOrder?.currency || 'USD',
                  base_amount_pkr: (parseFloat(existingCost.amount || 0) + valueInOrderCurrency) * orderFxRate,
                  fx_rate: orderFxRate,
                  notes: `Updated from transfer ${t.transfer_no} (PKR ${Math.round(valuePkr).toLocaleString()} ÷ ${orderFxRate})`,
                  updated_at: trx.fn.now(),
                });
            } else {
              await trx('export_order_costs').insert({
                order_id: t.export_order_id,
                category: 'raw_rice',
                amount: valueInOrderCurrency,
                currency: linkedOrder?.currency || 'USD',
                base_amount_pkr: valuePkr,
                fx_rate: orderFxRate,
                notes: `From transfer ${t.transfer_no} (PKR ${Math.round(valuePkr).toLocaleString()} ÷ ${orderFxRate})`,
              });
            }
          }
        }

        return t;
      });

      return res.status(201).json({
        success: true,
        data: { transfer },
      });
    } catch (err) {
      console.error('Create internal transfer error:', err);
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        message: status === 500 ? 'Internal server error.' : err.message,
      });
    }
  },

  // Full detail for one transfer + the stock movements it produced + a lifecycle
  // timeline — backs the transfer-detail drawer (#3).
  async getInternalTransferDetail(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const t = await db('internal_transfers as it')
        .leftJoin('milling_batches as mb', 'it.batch_id', 'mb.id')
        .leftJoin('export_orders as eo', 'it.export_order_id', 'eo.id')
        .leftJoin('customers as cust', 'eo.customer_id', 'cust.id')
        .leftJoin('users as cb', 'it.created_by', 'cb.id')
        .leftJoin('users as fb', 'it.confirmed_by', 'fb.id')
        .where('it.id', id)
        .select(
          'it.*',
          'mb.batch_no',
          'eo.order_no as export_order_no',
          'cust.name as export_customer_name',
          'cb.full_name as created_by_name',
          'fb.full_name as confirmed_by_name'
        )
        .first();
      if (!t) return res.status(404).json({ success: false, message: 'Transfer not found.' });

      // Stock movements this transfer produced (TRANSFER_OUT from mill, TRANSFER_IN
      // to export) — the canonical lot_transactions ledger, keyed by
      // reference_no 'transfer-<id>' (qty is absolute KG; sign is in quantity_kg).
      const movements = await db('lot_transactions as lt')
        .leftJoin('inventory_lots as l', 'lt.lot_id', 'l.id')
        .where('lt.reference_no', `transfer-${id}`)
        .select('lt.id', 'lt.transaction_type as movement_type', db.raw('ABS(lt.quantity_kg) as qty'),
          'lt.entity_from as source_entity', 'lt.entity_to as dest_entity',
          db.raw('COALESCE(lt.performed_at, lt.created_at) as created_at'), 'l.lot_no', 'l.entity as lot_entity')
        .orderBy('lt.id', 'asc');

      // Lifecycle timeline.
      const timeline = [
        { key: 'created', label: 'Transfer created & stock dispatched', at: t.created_at, by: t.created_by_name, done: true },
        { key: 'in_transit', label: 'In transit to export', at: t.created_at, done: true },
      ];
      const confirmed = String(t.status) === 'Received' || !!t.confirmed_at;
      timeline.push({
        key: 'exported',
        label: 'Confirmed exported',
        at: t.confirmed_at || null,
        by: t.confirmed_by_name || null,
        done: confirmed,
      });

      return res.json({ success: true, data: { transfer: t, movements, timeline } });
    } catch (err) {
      console.error('Get internal transfer detail error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Confirm an in-transit transfer as Exported. STATUS TRANSITION ONLY — stock
  // was already deducted and journals posted at creation, so this must NOT move
  // stock or post journals again (double-count guard, see GL reversal rules).
  async confirmInternalTransferExport(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const t = await db('internal_transfers').where({ id }).first();
      if (!t) return res.status(404).json({ success: false, message: 'Transfer not found.' });
      if (String(t.status) === 'Received' || t.confirmed_at) {
        return res.status(400).json({ success: false, message: 'This transfer is already confirmed exported.' });
      }
      if (String(t.status) === 'Cancelled') {
        return res.status(400).json({ success: false, message: 'A cancelled transfer cannot be confirmed.' });
      }

      // 'Received' = the export entity has received the dispatched goods (an
      // existing allowed status). Stock + journals already happened at creation.
      const [updated] = await db('internal_transfers')
        .where({ id })
        .update({ status: 'Received', confirmed_at: db.fn.now(), confirmed_by: req.user.id, updated_at: db.fn.now() })
        .returning('*');

      return res.json({ success: true, data: { transfer: updated }, message: 'Transfer confirmed exported.' });
    } catch (err) {
      console.error('Confirm internal transfer export error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

// ===================== COST ALLOCATIONS =====================

async function generateCostNo(trx) {
  const last = await (trx || db)('cost_allocations')
    .select('cost_no')
    .orderBy('id', 'desc')
    .first();
  if (!last || !last.cost_no) return 'COST-001';
  const num = parseInt(last.cost_no.replace('COST-', '')) + 1;
  return 'COST-' + String(num).padStart(3, '0');
}

financeController.listCostAllocations = async function (req, res) {
  try {
    const { limit = 200 } = req.query;
    const allocations = await db('cost_allocations')
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit));

    const allocationIds = allocations.map(a => a.id);
    const lines = allocationIds.length > 0
      ? await db('cost_allocation_lines').whereIn('allocation_id', allocationIds)
      : [];

    const result = allocations.map(a => ({
      ...a,
      lines: lines.filter(l => l.allocation_id === a.id),
    }));

    return res.json({ success: true, data: { allocations: result } });
  } catch (err) {
    console.error('List cost allocations error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

financeController.createCostAllocation = async function (req, res) {
  try {
    const { entity, category, vendor, gross_amount, currency, date } = req.body;
    if (!category || !gross_amount) {
      return res.status(400).json({ success: false, message: 'Category and gross_amount are required.' });
    }
    const costNo = await generateCostNo();
    const [id] = await db('cost_allocations').insert({
      cost_no: costNo,
      entity: entity || 'export',
      category,
      vendor: vendor || null,
      gross_amount: parseFloat(gross_amount),
      currency: currency || 'USD',
      date: date || new Date().toISOString().split('T')[0],
      status: 'Unallocated',
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('id');

    const allocation = await db('cost_allocations').where({ id: id.id || id }).first();
    return res.json({ success: true, data: { allocation } });
  } catch (err) {
    console.error('Create cost allocation error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

financeController.addAllocationLine = async function (req, res) {
  try {
    const { id } = req.params;
    const { target_type, target_id, amount, pct } = req.body;

    const allocation = await db('cost_allocations').where({ id }).first();
    if (!allocation) {
      return res.status(404).json({ success: false, message: 'Cost allocation not found.' });
    }

    await db('cost_allocation_lines').insert({
      allocation_id: parseInt(id),
      target_type: target_type || 'export_order',
      target_id: target_id || '',
      amount: parseFloat(amount) || 0,
      pct: parseFloat(pct) || 0,
    });

    // Recalculate status
    const lines = await db('cost_allocation_lines').where({ allocation_id: id });
    const totalAllocated = lines.reduce((s, l) => s + parseFloat(l.amount), 0);
    const newStatus = totalAllocated >= parseFloat(allocation.gross_amount) ? 'Allocated' : totalAllocated > 0 ? 'Partial' : 'Unallocated';
    await db('cost_allocations').where({ id }).update({ status: newStatus, updated_at: new Date() });

    const updated = await db('cost_allocations').where({ id }).first();
    updated.lines = lines;
    return res.json({ success: true, data: { allocation: updated } });
  } catch (err) {
    console.error('Add allocation line error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

financeController.removeAllocationLine = async function (req, res) {
  try {
    const { allocationId, lineId } = req.params;

    await db('cost_allocation_lines').where({ id: lineId, allocation_id: allocationId }).del();

    const lines = await db('cost_allocation_lines').where({ allocation_id: allocationId });
    const allocation = await db('cost_allocations').where({ id: allocationId }).first();
    const totalAllocated = lines.reduce((s, l) => s + parseFloat(l.amount), 0);
    const newStatus = totalAllocated >= parseFloat(allocation.gross_amount) ? 'Allocated' : totalAllocated > 0 ? 'Partial' : 'Unallocated';
    await db('cost_allocations').where({ id: allocationId }).update({ status: newStatus, updated_at: new Date() });

    return res.json({ success: true, data: { message: 'Allocation line removed.' } });
  } catch (err) {
    console.error('Remove allocation line error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// Unified purchases feed — every spend the company recorded, regardless
// of which module created it. Inventory lots (raw paddy / finished /
// byproducts), mill-store consumable purchases, export-order operational
// costs, and business expenses are merged into a single sortable list
// with supplier, category, PKR amount, payment status, who created it,
// and (for expenses) who approved it.
//
// FE filters by source / date range; the dashboard's Purchases tab
// uses this to show approver-tagged company spend at a glance.
financeController.listPurchases = async (req, res) => {
  try {
    const { from_date, to_date, source, entity, limit = 500 } = req.query;
    const dateFilter = (q, col) => {
      if (from_date) q = q.where(col, '>=', from_date);
      // Exclusive upper bound at the NEXT day so a timestamptz column (e.g.
      // eoc.created_at) still includes rows recorded later on the to_date day —
      // `<= to_date` truncates to midnight and drops them. Works for DATE cols too.
      if (to_date) q = q.where(col, '<', db.raw("(?::date + interval '1 day')", [to_date]));
      return q;
    };

    const wantSource = source && source !== 'all' ? source : null;
    // A Mill role's purchases are mill-only: raw-rice lots (entity=mill),
    // mill-store consumables, and mill business expenses — never export costs.
    const millOnly = entity === 'mill';
    const all = [];

    // ── Inventory lot purchases (rice bought from a supplier) ──
    if (!wantSource || wantSource === 'lot') {
      let q = db('inventory_lots as il')
        .leftJoin('suppliers as s', 'il.supplier_id', 's.id')
        .leftJoin('users as creator', 'il.created_by', 'creator.id')
        // A "purchase" is a lot ACQUIRED from a supplier — not a milling output.
        // Exclude finished / by-product lots produced by a batch (they carry a
        // batch_ref); keep raw purchases (even unpriced, so the buyer can spot a
        // missing price) plus any directly-bought lot that already has a cost.
        .whereRaw("NOT (il.type IN ('finished','byproduct') AND il.batch_ref IS NOT NULL)")
        .where(function () {
          this.where('il.landed_cost_total', '>', 0).orWhere('il.type', 'raw');
        });
      if (millOnly) q = q.where('il.entity', 'mill');
      q = q
        .select(
          db.raw("'lot' AS source"),
          'il.id as ref_id',
          'il.lot_no as ref',
          'il.purchase_date as date',
          'il.landed_cost_total as amount_pkr',
          'il.landed_cost_total as amount',
          'il.cost_currency as currency',
          'il.supplier_id',
          's.name as supplier_name',
          db.raw("INITCAP(il.type) || ' ' || COALESCE(il.item_name, '') as category"),
          'il.payment_status',
          db.raw('COALESCE(il.paid_amount, 0) as paid_amount'),
          // Per-lot detail for the expandable row (qty, per-kg, katta/bags).
          'il.received_net_weight_kg as qty_kg',
          'il.landed_cost_per_kg as rate_per_kg',
          'il.total_bags as bags',
          'il.bag_weight_kg as bag_weight_kg',
          'il.type as lot_type',
          'creator.full_name as created_by_name',
          db.raw('NULL::text as approved_by_name'),
          db.raw('NULL::text as approved_at'),
          'il.created_at',
        );
      q = dateFilter(q, 'il.purchase_date');
      all.push(...await q);
    }

    // ── Mill-store consumable purchases ──
    if (!wantSource || wantSource === 'mill_store') {
      let q = db('mill_purchases as mp')
        .leftJoin('suppliers as s', 'mp.supplier_id', 's.id')
        .leftJoin('users as creator', 'mp.created_by', 'creator.id')
        .select(
          db.raw("'mill_store' AS source"),
          'mp.id as ref_id',
          'mp.purchase_no as ref',
          'mp.purchase_date as date',
          // mill_purchases.total_amount is already PKR (domestic vendor)
          'mp.total_amount as amount_pkr',
          'mp.total_amount as amount',
          'mp.currency',
          'mp.supplier_id',
          's.name as supplier_name',
          db.raw("'Mill Store' as category"),
          'mp.payment_status',
          db.raw('COALESCE(mp.paid_amount, 0) as paid_amount'),
          'creator.full_name as created_by_name',
          db.raw('NULL::text as approved_by_name'),
          db.raw('NULL::text as approved_at'),
          'mp.created_at',
        );
      q = dateFilter(q, 'mp.purchase_date');
      all.push(...await q);
    }

    // ── Export-order operational costs (transport / loading / etc.) ──
    // Filter amount > 0 so the placeholder rows seeded on order creation
    // (every category pre-inserted at 0) don't clutter the list. Fall
    // back to amount*fx_rate when base_amount_pkr is 0/NULL — older rows
    // (and the addCost shortcut) leave base_amount_pkr unpopulated.
    if (!millOnly && (!wantSource || wantSource === 'export_cost')) {
      let q = db('export_order_costs as eoc')
        .leftJoin('export_orders as eo', 'eoc.order_id', 'eo.id')
        .leftJoin('users as creator', 'eoc.created_by', 'creator.id')
        .where('eoc.amount', '>', 0)
        .select(
          db.raw("'export_cost' AS source"),
          'eoc.id as ref_id',
          'eo.order_no as ref',
          db.raw('eoc.created_at::date as date'),
          db.raw('CASE WHEN COALESCE(eoc.base_amount_pkr, 0) > 0 THEN eoc.base_amount_pkr ELSE COALESCE(eoc.amount, 0) * COALESCE(eoc.fx_rate, 1) END as amount_pkr'),
          'eoc.amount',
          'eoc.currency',
          db.raw('NULL::int as supplier_id'),
          db.raw('NULL::text as supplier_name'),
          'eoc.category',
          db.raw("COALESCE(eoc.payment_status, 'Pending') as payment_status"),
          db.raw('COALESCE(eoc.paid_amount, 0) as paid_amount'),
          'creator.full_name as created_by_name',
          db.raw('NULL::text as approved_by_name'),
          db.raw('NULL::text as approved_at'),
          'eoc.created_at',
        );
      q = dateFilter(q, 'eoc.created_at');
      all.push(...await q);
    }

    // ── Business expenses (utilities / salaries / misc) — has approver! ──
    if (!wantSource || wantSource === 'expense') {
      let q = db('business_expenses as be')
        .leftJoin('suppliers as s', 'be.supplier_id', 's.id')
        .leftJoin('users as creator', 'be.created_by', 'creator.id')
        .leftJoin('users as approver', 'be.approved_by', 'approver.id');
      if (millOnly) q = q.where('be.expense_type', 'mill');
      q = q.whereNot('be.payment_status', 'Reversed'); // undone payroll / advances
      q = q
        .select(
          db.raw("'expense' AS source"),
          'be.id as ref_id',
          'be.expense_no as ref',
          'be.expense_date as date',
          'be.amount_pkr',
          'be.amount',
          'be.currency',
          'be.supplier_id',
          db.raw("COALESCE(s.name, be.vendor_name) as supplier_name"),
          'be.category',
          'be.payment_status',
          db.raw('COALESCE(be.paid_amount, 0) as paid_amount'),
          'creator.full_name as created_by_name',
          'approver.full_name as approved_by_name',
          db.raw('be.paid_date as approved_at'),
          'be.created_at',
        );
      q = dateFilter(q, 'be.expense_date');
      all.push(...await q);
    }

    // Sort newest-first by created_at (timestamp) so same-date rows
    // appear in actual insertion order. Fall back to `date` (which may
    // be a DATE-only column on some sources) and finally to ref desc.
    all.sort((a, b) => {
      const ta = new Date(a.created_at || a.date).getTime();
      const tb = new Date(b.created_at || b.date).getTime();
      if (ta !== tb) return tb - ta;
      const da = new Date(a.date || a.created_at).getTime();
      const dbt = new Date(b.date || b.created_at).getTime();
      if (da !== dbt) return dbt - da;
      return String(b.ref || '').localeCompare(String(a.ref || ''));
    });
    let sliced = all.slice(0, parseInt(limit, 10));

    // Confidentiality: restricted roles (everyone except Super Admin / Owner) see
    // the reference (lot / batch / order / expense no) but NOT the supplier name.
    if (await isPartyMasked(req)) {
      sliced = sliced.map((r) => (r.supplier_name
        ? { ...r, supplier_name: 'Supplier', supplier_id: null }
        : r));
    }

    // Aggregate totals across the FILTERED set so the FE can show
    // top-line spend without a second round-trip.
    const totals = sliced.reduce((acc, r) => {
      const pkr = parseFloat(r.amount_pkr) || 0;
      acc.total_pkr += pkr;
      acc.by_source[r.source] = (acc.by_source[r.source] || 0) + pkr;
      const k = String(r.payment_status || 'Pending').toLowerCase();
      acc.by_status[k] = (acc.by_status[k] || 0) + pkr;
      return acc;
    }, { total_pkr: 0, count: sliced.length, by_source: {}, by_status: {} });

    return res.json({ success: true, data: { purchases: sliced, totals } });
  } catch (err) {
    console.error('Finance listPurchases error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// Batch / order reference lists for the Expenses "link to batch/order" pickers.
// A payments-only role (Finance Manager) can't load /milling/batches or
// /export-orders (403), so those pickers were empty. This finance-view endpoint
// returns just the REFERENCE (batch/order no + qty + status), NO party names, so
// Finance can link an expense to the right batch/order. Shape matches the FE
// pickers (id = display no, dbId = numeric id). Confidential fields are omitted.
financeController.getExpenseLinkOptions = async (req, res) => {
  try {
    const [batchRows, orderRows] = await Promise.all([
      db('milling_batches')
        .whereNotIn('status', ['Closed', 'Cancelled', 'Rejected'])
        .orderBy('id', 'desc').limit(500)
        .select('id', 'batch_no', 'raw_qty_kg', 'status'),
      db('export_orders')
        .whereNotIn('status', ['Closed', 'Cancelled'])
        .orderBy('id', 'desc').limit(500)
        .select('id', 'order_no', 'qty_mt', 'country', 'status'),
    ]);
    const batches = batchRows.map((b) => ({
      id: b.batch_no || b.id, dbId: b.id,
      rawQtyMT: (parseFloat(b.raw_qty_kg) || 0) / 1000, status: b.status || 'Queued',
    }));
    const orders = orderRows.map((o) => ({
      id: o.order_no || o.id, dbId: o.id,
      qtyMT: parseFloat(o.qty_mt) || 0, country: o.country || '',
      status: o.status || 'Draft',
    }));
    return res.json({ success: true, data: { batches, orders } });
  } catch (err) {
    console.error('Finance getExpenseLinkOptions error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// ─── Unified "Mark Purchase Paid" ──────────────────────────────────────
// /finance/purchases aggregates five source tables (inventory_lots,
// mill_purchases, export_order_costs, business_expenses, printed_bag_orders).
// Paying one here is the same event as paying its payable on Money Out, so it
// goes through the same engine: the payable the source raised is resolved and
// settled (a lot's rice + itemised supplier lines, FIFO), each settlement is a
// PAY- payment row stamped with the source (so it can be reversed), the bank
// moves with a bank_transactions row, and the journal Dr 2010 (2040 for a
// salaries expense) / Cr 1000 posts in the same transaction. A source with no
// payable at all (a legacy row) is paid against the source row itself.
const PURCHASE_SOURCES = {
  lot: { table: 'inventory_lots', notFound: 'Inventory lot not found.', label: (r) => r.lot_no },
  mill_store: { table: 'mill_purchases', notFound: 'Mill store purchase not found.', label: (r) => r.purchase_no },
  export_cost: { table: 'export_order_costs', notFound: 'Export-order cost not found.', label: (r) => `EXP-COST #${r.id}` },
  expense: { table: 'business_expenses', notFound: 'Business expense not found.', label: (r) => r.expense_no },
  printed_bag: { table: 'printed_bag_orders', notFound: 'Printed bag order not found.', label: (r) => r.pbo_no },
};

/**
 * The open payables a purchase-tab payment settles, oldest obligation first,
 * read under lock. A lot's are the ones owed to its supplier: the rice line
 * ('Raw Material', keyed by source_id or — legacy — by lot number) and the
 * itemised lot_* supplier lines. Its transport (hauler) and commission (broker)
 * are other parties' bills, paid from Money Out. Every other source has one
 * payable keyed (source_table, source_id).
 */
async function purchasePayables(trx, source, row) {
  const { table } = PURCHASE_SOURCES[source];
  if (source !== 'lot') {
    const p = await trx('payables').where({ source_table: table, source_id: row.id }).forUpdate().first();
    return p ? [p] : [];
  }
  const byLot = await trx('payables').where({ source_id: row.id }).forUpdate().select('*');
  const byLotNo = row.lot_no
    ? await trx('payables').where({ linked_ref: row.lot_no, category: 'Raw Material' }).forUpdate().select('*')
    : [];
  const isRice = (p) => !p.source_table && p.category === 'Raw Material';
  const seen = new Set();
  const rows = [
    ...(Array.isArray(byLot) ? byLot : []).filter((p) => isRice(p) || p.source_table === 'inventory_lots' || LOT_SUPPLIER_LINES.includes(p.source_table)),
    ...(Array.isArray(byLotNo) ? byLotNo : []).filter(isRice),
  ].filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
  const list = (Array.isArray(rows) ? rows : [])
    .filter((p) => !row.supplier_id || !p.supplier_id || String(p.supplier_id) === String(row.supplier_id))
    .filter((p) => !p.hauler_id);
  // The rice line first, then the itemised lines in the order they were raised.
  return list.sort((a, b) => (a.category === 'Raw Material' ? 0 : 1) - (b.category === 'Raw Material' ? 0 : 1) || a.id - b.id);
}

financeController.payPurchase = async (req, res) => {
  try {
    const { source, source_id, amount, bank_account_id, payment_method, payment_date, payment_reference, due_date, notes } = req.body;
    if (!source || !source_id) {
      return res.status(400).json({ success: false, message: 'source and source_id are required.' });
    }
    const id = parseInt(source_id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'source_id must be numeric.' });
    const spec = PURCHASE_SOURCES[source];
    if (!spec) return res.status(400).json({ success: false, message: `Unknown source "${source}". Use lot | mill_store | export_cost | expense | printed_bag.` });
    // payments.payment_method is CHECK-constrained to the canonical set; the
    // Purchases drawer used to send 'bank'. Throws on an unknown value (→ 400).
    const payMethod = normalizePaymentMethod(payment_method);
    // Without finance.confirm_payment (the Mill Operator, via milling.edit)
    // only mill purchases, through a mill account.
    const millOnly = await isMillOnlyPayer(req);
    const fail = (msg) => { const e = new Error(msg); e.statusCode = 400; return e; };

    const result = await db.transaction(async (trx) => {
      const row = await trx(spec.table).where({ id }).forUpdate().first();
      if (!row) { const e = new Error(spec.notFound); e.statusCode = 404; throw e; }
      const payables = await purchasePayables(trx, source, row);
      // The paying side of the business: the payable's when there is one, else
      // the source's own (a lot carries its entity, a mill-store purchase is
      // the mill's, an expense its expense_type; export costs / bags never are).
      const ownEntity = source === 'lot' ? (row.entity || 'mill')
        : source === 'mill_store' ? 'mill'
        : source === 'expense' ? (row.expense_type || 'general')
        : 'export';
      if (millOnly) assertMillEntity(payables[0]?.entity || ownEntity, 'purchases');

      // What is still owed: the payables when there are any (net of uncleared
      // cheques), else the source row's own figure.
      const open = [];
      for (const p of payables) {
        const pending = await pendingChequeTotal(trx, { payableId: p.id });
        const owed = Math.max(0, round2((parseFloat(p.original_amount) || 0) - (parseFloat(p.paid_amount) || 0) - pending));
        if (owed > 0.01) open.push({ payable: p, owed });
      }
      let outstanding;
      if (payables.length) {
        outstanding = round2(open.reduce((s, o) => s + o.owed, 0));
      } else {
        const total = SOURCES[spec.table].total(row);
        const pending = await pendingChequeTotal(trx, { sourceTable: spec.table, sourceId: id });
        outstanding = Math.max(0, round2(total - (parseFloat(row.paid_amount) || 0) - pending));
      }
      // Default: settle the whole outstanding. An amount over it is refused,
      // not clamped.
      const payNum = amount == null || amount === '' ? outstanding : parseFloat(amount);
      if (!payNum || payNum <= 0) throw fail('Amount must be greater than zero.');
      if (outstanding <= 0.01) throw fail('This purchase is already fully paid.');
      if (payNum - outstanding > 0.01) {
        const whose = source === 'lot' && payables.length ? ' owed to the supplier on this lot (transport and commission are paid to the transporter / broker from Money Out)' : '';
        throw fail(`Amount ${payNum.toFixed(2)} exceeds the outstanding balance${whose} of ${outstanding.toFixed(2)}.`);
      }

      const label = spec.label(row) || `#${id}`;
      const common = {
        type: 'payment',
        source: { table: spec.table, id },
        currency: 'PKR', // purchases are paid in PKR
        method: payMethod,
        bankAccountId: bank_account_id || null,
        accountEntity: ownEntity,
        paymentDate: payment_date || null,
        dueDate: due_date || null,
        bankReference: payment_reference || null,
        userId: req.user?.id || null,
        millOnly,
        bt: {
          counterparty: row.supplier_id ? null : (row.vendor_name || null),
          notes: `Payment for ${source} ${label}${notes ? ` — ${notes}` : ''}`,
        },
      };
      const payments = [];
      if (!payables.length) {
        const { payment } = await recordMoneyMovement(trx, {
          ...common, amount: payNum, notes: notes || `Payment for ${source} ${label}`,
        });
        payments.push(payment);
      } else {
        // FIFO across the open payables, one payment row per payable.
        let left = round2(payNum);
        for (const o of open) {
          if (left <= 0.01) break;
          const part = round2(Math.min(left, o.owed));
          const { payment } = await recordMoneyMovement(trx, {
            ...common, payable: o.payable, amount: part, checkOutstanding: false,
            notes: notes || `Payment for ${source} ${label}${o.payable.category && source === 'lot' ? ` — ${o.payable.category}` : ''}`,
          });
          payments.push(payment);
          left = round2(left - part);
        }
      }

      const after = await trx(spec.table).where({ id }).first();
      const fullyPaid = round2(outstanding - payNum) <= 0.01;
      const uncleared = isCheque(payMethod);
      return {
        source,
        source_id: id,
        amount_paid_pkr: round2(payNum),
        status: uncleared ? (after?.payment_status || null) : (fullyPaid ? 'Paid' : 'Partial'),
        fully_paid: !uncleared && fullyPaid,
        uncleared,
        postDated: uncleared,
        payments: payments.map((p) => ({ id: p.id, payment_no: p.payment_no, amount: parseFloat(p.amount) || 0, payable_id: p.linked_payable_id || null })),
      };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    const code = err.statusCode || err.status;
    if (!code) console.error('Pay purchase error:', err);
    return res.status(code || 400).json({ success: false, message: err.message || 'Failed to record purchase payment.' });
  }
};

module.exports = financeController;
