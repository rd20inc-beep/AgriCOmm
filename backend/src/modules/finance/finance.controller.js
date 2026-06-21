const db = require('../../config/database');
const inventoryService = require('../../services/inventoryService');
const accountingService = require('../../services/accountingService');

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

async function generateTransferNo(trx) {
  const last = await (trx || db)('internal_transfers')
    .select('transfer_no')
    .orderBy('created_at', 'desc')
    .first();

  if (!last || !last.transfer_no) {
    return 'IT-001';
  }

  const num = parseInt(last.transfer_no.replace('IT-', ''), 10) || 0;
  return `IT-${String(num + 1).padStart(3, '0')}`;
}

async function generatePaymentNo(trx) {
  // Scope the lookup to the PAY-NNN namespace only. Other payment_no
  // shapes can exist alongside (e.g. PAY-MS001, PAY-EOC0001) and
  // sorting by created_at picked them up — parseInt returned NaN and
  // the generator fell back to PAY-001, which already exists. Regex-
  // scope so we only see this generator's own sequence.
  const last = await (trx || db)('payments')
    .whereRaw("payment_no ~ '^PAY-[0-9]+$'")
    .orderByRaw("CAST(REPLACE(payment_no, 'PAY-', '') AS INTEGER) DESC")
    .first('payment_no');

  const num = last?.payment_no
    ? (parseInt(last.payment_no.replace('PAY-', ''), 10) || 0)
    : 0;
  return `PAY-${String(num + 1).padStart(3, '0')}`;
}

const financeController = {
  async getReceivables(req, res) {
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
          'r.created_at',
          'c.name as customer_name'
        );
      if (status)        exportQ = exportQ.where('r.status', status);
      if (customer_id)   exportQ = exportQ.where('r.customer_id', customer_id);
      if (overdue === 'true') exportQ = exportQ.where('r.due_date', '<', db.fn.now()).where('r.status', '!=', 'Paid');
      if (from_date)     exportQ = exportQ.where('r.created_at', '>=', from_date);
      if (to_date)       exportQ = exportQ.where('r.created_at', '<=', to_date);

      // ── Local sales with outstanding balance (UNIONed in) ─────────
      // Surfaces credit / partial / pending local sales in Money In so
      // the user's true AR includes domestic sales, not just export
      // advances + balances.
      let localQ = db('local_sales as ls')
        .leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .whereIn('ls.payment_status', ['Pending', 'Partial', 'Credit'])
        .where('ls.due_amount', '>', 0)
        .select(
          'ls.id',
          'ls.sale_no as recv_no',
          db.raw(`'Local Sale'::text as type`),
          'ls.total_amount as expected_amount',
          'ls.paid_amount as received_amount',
          'ls.due_amount as outstanding',
          db.raw(`'PKR'::text as currency`),
          db.raw(`1::numeric as fx_rate`),
          'ls.total_amount as base_amount_pkr',
          db.raw(`ls.sale_date::timestamptz as due_date`),
          'ls.payment_status as status',
          db.raw(`GREATEST(0, EXTRACT(DAY FROM (NOW() - ls.sale_date::timestamptz)))::int as aging`),
          db.raw(`NULL::int as order_id`),
          'ls.customer_id',
          db.raw(`ls.sale_date::timestamptz as created_at`),
          db.raw(`COALESCE(c.name, ls.buyer_name, 'Walk-in') as customer_name`)
        );
      if (status)       localQ = localQ.where('ls.payment_status', status);
      if (customer_id)  localQ = localQ.where('ls.customer_id', customer_id);
      if (from_date)    localQ = localQ.where('ls.sale_date', '>=', from_date);
      if (to_date)      localQ = localQ.where('ls.sale_date', '<=', to_date);

      // Knex UNION with ORDER BY + LIMIT works by wrapping the union
      // as a derived table.
      const [exportRows, localRows] = await Promise.all([exportQ, localQ]);
      const combined = [...exportRows, ...localRows]
        .sort((a, b) => (a.due_date ? new Date(a.due_date).getTime() : 0) - (b.due_date ? new Date(b.due_date).getTime() : 0));

      const total = combined.length;
      const sliced = combined.slice(offset, offset + parseInt(limit));

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
  },

  // Receipt history for one Money-In row — shows WHERE/HOW each partial was
  // received (amount, date, method, the bank/cash account it landed in, cheque/
  // reference). Export rows link via payments.linked_receivable_id; local-sale
  // rows via payments.local_sale_id (plus the sale's collection location).
  async getReceivableReceipts(req, res) {
    try {
      const { id } = req.params;
      const source = req.query.source === 'local_sale' ? 'local_sale' : 'export';

      const base = () => db('payments as p')
        .leftJoin('bank_accounts as ba', 'ba.id', 'p.bank_account_id')
        .select(
          'p.id', 'p.payment_no', 'p.amount', 'p.currency', 'p.payment_method',
          'p.payment_date', 'p.bank_reference', 'p.notes', 'p.bank_account_id', 'p.type',
          'ba.name as account_name', 'ba.bank_name as bank_name', 'ba.type as account_type'
        )
        .orderBy('p.payment_date', 'desc')
        .orderBy('p.id', 'desc');

      let payments = [];
      let collectionLocation = null;

      if (source === 'local_sale') {
        const sale = await db('local_sales').where({ id }).first();
        if (sale) {
          collectionLocation = sale.collection_location || null;
          payments = await base().where('p.local_sale_id', id);
          if (payments.length === 0) {
            payments = await base().where('p.notes', 'ilike', `%${sale.sale_no}%`);
          }
        }
      } else {
        payments = await base().where('p.linked_receivable_id', id);
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

      const payments = await db('payments as p')
        .leftJoin('bank_accounts as ba', 'ba.id', 'p.bank_account_id')
        .where('p.linked_payable_id', id)
        .select(
          'p.id', 'p.payment_no', 'p.amount', 'p.currency', 'p.payment_method',
          'p.payment_date', 'p.bank_reference', 'p.notes', 'p.bank_account_id', 'p.type',
          'ba.name as account_name', 'ba.bank_name as bank_name', 'ba.type as account_type'
        )
        .orderBy('p.payment_date', 'desc')
        .orderBy('p.id', 'desc');

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
        .where('p.payment_method', 'cheque').whereNotNull('p.due_date')
        .select('p.type', 'p.amount', 'p.due_date', 'p.bank_reference',
          db.raw("COALESCE(c.name, s.name, ls.buyer_name, 'Counterparty') as party"));

      const recv = await db('receivables as r').leftJoin('customers as c', 'c.id', 'r.customer_id')
        .whereNot('r.status', 'Paid').whereNotNull('r.due_date').where('r.outstanding', '>', 0)
        .select('r.outstanding as amount', 'r.due_date', db.raw("COALESCE(c.name, 'Customer') as party"), 'r.recv_no as ref');
      const lsCredit = await db('local_sales as ls').leftJoin('customers as c', 'c.id', 'ls.customer_id')
        .where('ls.due_amount', '>', 0).whereNotNull('ls.due_date')
        .select('ls.due_amount as amount', 'ls.due_date', 'ls.sale_no as ref', db.raw("COALESCE(c.name, ls.buyer_name, 'Walk-in') as party"));
      const pay = await db('payables as pa').leftJoin('suppliers as s', 's.id', 'pa.supplier_id')
        .whereNot('pa.status', 'Paid').whereNotNull('pa.due_date').where('pa.outstanding', '>', 0)
        .select('pa.outstanding as amount', 'pa.due_date', 'pa.linked_ref as ref', db.raw("COALESCE(s.name, 'Supplier') as party"));

      const chq = (t) => cheques.filter((x) => x.type === t).map((x) => ({ kind: 'cheque', label: 'Cheque', dueDate: x.due_date, amount: parseFloat(x.amount) || 0, party: x.party, reference: x.bank_reference }));
      const receiving = [
        ...chq('receipt'),
        ...recv.map((x) => ({ kind: 'credit', label: 'Receivable', dueDate: x.due_date, amount: parseFloat(x.amount) || 0, party: x.party, reference: x.ref })),
        ...lsCredit.map((x) => ({ kind: 'credit', label: 'Local sale (credit)', dueDate: x.due_date, amount: parseFloat(x.amount) || 0, party: x.party, reference: x.ref })),
      ].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
      const giving = [
        ...chq('payment'),
        ...pay.map((x) => ({ kind: 'credit', label: 'Payable', dueDate: x.due_date, amount: parseFloat(x.amount) || 0, party: x.party, reference: x.ref })),
      ].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

      return res.json({ success: true, data: {
        receiving, giving,
        totalReceiving: receiving.reduce((s, x) => s + x.amount, 0),
        totalGiving: giving.reduce((s, x) => s + x.amount, 0),
      } });
    } catch (err) {
      console.error('getUpcoming error:', err);
      return res.status(500).json({ success: false, message: err.message });
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
        const k = `${Math.round(x.amount)}|${x.date ? String(x.date).slice(0, 10) : ''}|${x.account_name || ''}`;
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
        .leftJoin('suppliers as tv', 'l.transport_vendor_id', 'tv.id')
        .where(function () {
          this.where('l.transport_cost', '>', 0).orWhere('l.labor_cost', '>', 0)
            .orWhere('l.unloading_cost', '>', 0).orWhere('l.packing_cost', '>', 0)
            .orWhere('l.total_bag_cost', '>', 0).orWhere('l.other_cost', '>', 0);
        })
        .select('l.id', 'l.lot_no', 'l.transport_cost', 'l.labor_cost', 'l.unloading_cost',
          'l.packing_cost', 'l.total_bag_cost', 'l.other_cost', 'l.transport_vendor_id', 'tv.name as hauler_name')
        .orderBy('l.lot_no', 'asc');

      // Stored transport payables (one per lot) for paid/outstanding on the hauler line.
      const tps = await db('payables').where({ source_table: 'lot_transport' })
        .select('source_id', 'paid_amount', 'outstanding', 'supplier_id', 'status');
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
      const { page = 1, limit = 200, status, supplier_id, overdue, from_date, to_date } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      // Stored payables (real rows that CAN be paid — they have a numeric id).
      // We MERGE these with the cost-derived ones below rather than either/or, so
      // a materialized payable (e.g. a mill raw-rice purchase, which recordPayment
      // needs a real row to settle) and the still-derived costs (export/expenses)
      // both show. Derived rows whose source is already stored are skipped to
      // avoid double-counting.
      const storedRows = await db('payables as p')
        .leftJoin('suppliers as s', 'p.supplier_id', 's.id')
        .select('p.*', 's.name as supplier_name')
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
          'eoc.id', 'eoc.order_id', 'eoc.category', 'eoc.amount',
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
        });
      });

      exportCosts.forEach(ec => {
        derived.push({
          id: `EC-${ec.id}`,
          pay_no: `EC-${ec.id}`,
          entity: 'export',
          category: categoryLabel(ec.category),
          supplier_name: ec.customer_name || null,
          linked_ref: ec.order_no,
          original_amount: parseFloat(ec.amount),
          paid_amount: 0,
          outstanding: parseFloat(ec.amount),
          due_date: ec.created_at,
          status: 'Pending',
          currency: 'USD',
          aging: 0,
          notes: `${categoryLabel(ec.category)} cost for order ${ec.order_no}`,
          created_at: ec.created_at,
          source: 'export_order_costs',
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
      if (to_date) filtered = filtered.filter(p => p.created_at && new Date(p.created_at) <= new Date(to_date));

      // Newest first; tie-break on id (stored numeric > synthetic string sort).
      filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      const total = filtered.length;
      const paged = filtered.slice(offset, offset + parseInt(limit));

      return res.json({
        success: true,
        data: {
          payables: paged,
          pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
          source: 'merged',
        },
      });
    } catch (err) {
      console.error('Get payables error:', err);
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

      const [overdueReceivables, overduePayables, pendingOrders] = await Promise.all([
        db('receivables')
          .where('due_date', '<', today)
          .whereNot('status', 'Paid')
          .count('id as count')
          .sum('outstanding as total')
          .first(),
        db('payables')
          .where('due_date', '<', today)
          .whereNot('status', 'Paid')
          .count('id as count')
          .sum('outstanding as total')
          .first(),
        db('export_orders')
          .whereIn('status', ['Draft', 'Awaiting Advance'])
          .count('id as count')
          .first(),
      ]);

      return res.json({
        success: true,
        data: {
          alerts: [
            {
              type: 'overdue_receivables',
              count: parseInt(overdueReceivables.count) || 0,
              total: parseFloat(overdueReceivables.total) || 0,
              severity: parseInt(overdueReceivables.count) > 0 ? 'warning' : 'info',
            },
            {
              type: 'overdue_payables',
              count: parseInt(overduePayables.count) || 0,
              total: parseFloat(overduePayables.total) || 0,
              severity: parseInt(overduePayables.count) > 0 ? 'danger' : 'info',
            },
            {
              type: 'pending_orders',
              count: parseInt(pendingOrders.count) || 0,
              severity: 'info',
            },
          ],
        },
      });
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
      const { type, from_date, to_date, entity, limit = 500 } = req.query;
      let q = db('payments as p')
        .leftJoin('receivables as r', 'p.linked_receivable_id', 'r.id')
        .leftJoin('payables as pa',   'p.linked_payable_id',    'pa.id')
        .leftJoin('customers as c',   'r.customer_id',          'c.id')
        .leftJoin('suppliers as s',   'pa.supplier_id',         's.id')
        .leftJoin('local_sales as ls','p.local_sale_id',        'ls.id')
        .leftJoin('bank_accounts as ba','p.bank_account_id',    'ba.id')
        .select(
          'p.id', 'p.payment_no', 'p.type', 'p.amount', 'p.currency',
          'p.fx_rate', 'p.base_amount_pkr', 'p.payment_method',
          'p.payment_date', 'p.bank_reference', 'p.notes', 'p.created_at',
          'p.linked_receivable_id', 'p.linked_payable_id', 'p.local_sale_id',
          'r.recv_no as recv_no', 'r.entity as recv_entity', 'r.type as recv_type',
          'pa.pay_no as pay_no', 'pa.entity as pay_entity', 'pa.payable_type', 'pa.linked_ref as pay_linked_ref',
          'c.name as customer_name',
          's.name as supplier_name',
          'ls.sale_no as sale_no', 'ls.buyer_name as sale_buyer',
          'ba.name as bank_name', 'ba.currency as bank_currency'
        );
      if (type) q = q.where('p.type', type);
      if (from_date) q = q.where('p.payment_date', '>=', from_date);
      if (to_date)   q = q.where('p.payment_date', '<=', to_date);
      // Entity scope (e.g. a Mill role must not see export-order payments): keep
      // only rows whose receivable / payable / local-sale belongs to that entity.
      if (entity) {
        q = q.where(function () {
          this.where('r.entity', entity)
            .orWhere('pa.entity', entity)
            .orWhere('ls.entity', entity);
        });
      }
      const rows = await q
        .orderBy('p.payment_date', 'desc')
        .orderBy('p.created_at', 'desc')
        .orderBy('p.id', 'desc')
        .limit(parseInt(limit));

      // Compose a single counterparty + source label per row so the FE
      // doesn't have to do the joining gymnastics.
      const enriched = rows.map(r => {
        let counterparty = '—';
        let sourceRef = null;
        let sourceHref = null;
        if (r.type === 'receipt') {
          counterparty = r.customer_name || r.sale_buyer || 'Walk-in customer';
          sourceRef = r.recv_no || r.sale_no || null;
          // Link to the local-sales screen for any sale-linked receipt — both
          // the RCV-LS receivables and the party-ledger receipts that carry a
          // local_sale_id (their recv_no is null, so the prefix check missed them).
          if ((r.recv_no && r.recv_no.startsWith('RCV-LS')) || r.local_sale_id) sourceHref = '/local-sales';
        } else {
          counterparty = r.supplier_name || r.pay_linked_ref || 'Vendor';
          sourceRef = r.pay_no || null;
        }
        return { ...r, counterparty, sourceRef, sourceHref };
      });

      // PKR totals across the filtered set. Resolve order:
      //   1. base_amount_pkr if present (post round-094/095 entries)
      //   2. amount × fx_rate if fx_rate > 1
      //   3. for non-PKR currency with no rate, fall back to 280 (the
      //      historical default) so legacy rows don't silently render
      //      as 1× the foreign amount in the PKR total
      //   4. amount as-is for PKR rows
      const totalPkr = enriched.reduce((s, r) => s + paymentToPkr(r), 0);
      // Re-stamp each row with a normalized basePkr field so the FE
      // doesn't have to repeat this fallback chain.
      for (const r of enriched) {
        r.base_amount_pkr_normalized = paymentToPkr(r);
      }

      return res.json({
        success: true,
        data: { payments: enriched, totalPkr: Number(totalPkr.toFixed(2)), count: enriched.length },
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
      } = req.body;

      const entity_type = type === 'receipt' ? 'receivable' : 'payable';
      const entity_id = linked_receivable_id || linked_payable_id;

      if (!type || !entity_id || !amount || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'type, linked_receivable_id or linked_payable_id, and a positive amount are required.',
        });
      }

      const result = await db.transaction(async (trx) => {
        const paymentNo = await generatePaymentNo(trx);

        // Resolve fx_rate + base_amount_pkr at write time so the
        // payment row carries its own PKR equivalent forever, no
        // matter what the linked source rates do later.
        const amtNum = parseFloat(amount);
        const cur = (currency || 'PKR').toUpperCase();
        let stampedFxRate = 1;
        if (cur !== 'PKR') {
          // Pull the linked order's booked rate when available so the
          // ledger inherits the same rate as the order it pays against.
          let orderRate = null;
          if (linked_receivable_id) {
            const r = await trx('receivables').where({ id: linked_receivable_id }).first();
            if (r?.order_id) {
              const eo = await trx('export_orders').where({ id: r.order_id }).first();
              orderRate = parseFloat(eo?.advance_fx_rate) || parseFloat(eo?.booked_fx_rate) || null;
            }
          }
          stampedFxRate = orderRate || 280;
        }
        const stampedPkr = cur === 'PKR' ? amtNum : amtNum * stampedFxRate;

        // Create payment record
        const [payment] = await trx('payments')
          .insert({
            payment_no: paymentNo,
            type,
            linked_receivable_id: linked_receivable_id || null,
            linked_payable_id: linked_payable_id || null,
            amount: amtNum,
            currency: cur,
            fx_rate: stampedFxRate,
            base_amount_pkr: Number(stampedPkr.toFixed(2)),
            payment_method: payment_method || null,
            bank_account_id: bank_account_id || null,
            bank_reference: bank_reference || null,
            due_date: due_date || null,
            payment_date: payment_date || trx.fn.now(),
            notes: notes || null,
            created_by: req.user.id,
          })
          .returning('*');

        // Update receivable or payable
        if (type === 'receipt' && linked_receivable_id) {
          const receivable = await trx('receivables').where({ id: linked_receivable_id }).first();
          if (receivable) {
            const newPaid = parseFloat(receivable.received_amount || 0) + parseFloat(amount);
            const newOutstanding = parseFloat(receivable.expected_amount) - newPaid;
            const fullyPaid = newOutstanding <= 0;
            await trx('receivables').where({ id: linked_receivable_id }).update({
              received_amount: newPaid,
              outstanding: Math.max(0, newOutstanding),
              // CHECK constraints on receivables.status / payables.status
              // require capitalised values { Pending, Partial, Paid,
              // Overdue, Written Off }. Lowercase silently 23514s.
              status: fullyPaid ? 'Paid' : 'Partial',
              updated_at: trx.fn.now(),
            });
          }
          if (bank_account_id) {
            await trx('bank_accounts')
              .where({ id: bank_account_id })
              .increment('current_balance', parseFloat(amount));
            // Audit-trail row in the Cash & Bank sub-ledger so the Cash
            // tab can attribute the inflow. Pattern mirrors payPurchase.
            const tableExists = await trx.schema.hasTable('bank_transactions');
            if (tableExists) {
              const lastBt = await trx('bank_transactions')
                .where('transaction_no', 'like', 'BT-%')
                .orderBy('id', 'desc').first('transaction_no');
              const seq = lastBt
                ? (parseInt(String(lastBt.transaction_no).replace(/^BT-/, ''), 10) || 0) + 1
                : 1;
              await trx('bank_transactions').insert({
                transaction_no: `BT-${String(seq).padStart(4, '0')}`,
                bank_account_id,
                type: 'credit',
                amount: stampedPkr,
                transaction_date: payment_date || new Date(),
                reference: bank_reference || paymentNo,
                counterparty: null,
                notes: `Receipt ${paymentNo} for receivable #${entity_id}`,
                source: 'record_payment',
                created_by: req.user?.id || null,
              });
            }
          }
        } else if (type === 'payment' && linked_payable_id) {
          const payable = await trx('payables').where({ id: linked_payable_id }).first();
          if (payable) {
            const newPaid = parseFloat(payable.paid_amount || 0) + parseFloat(amount);
            const newOutstanding = parseFloat(payable.original_amount) - newPaid;
            const fullyPaid = newOutstanding <= 0;
            await trx('payables').where({ id: linked_payable_id }).update({
              paid_amount: newPaid,
              outstanding: Math.max(0, newOutstanding),
              // CHECK constraints on receivables.status / payables.status
              // require capitalised values { Pending, Partial, Paid,
              // Overdue, Written Off }. Lowercase silently 23514s.
              status: fullyPaid ? 'Paid' : 'Partial',
              updated_at: trx.fn.now(),
            });

            // Mirror the status back to the source row so the Expenses
            // / Mill Purchases tabs reflect the same payment state
            // instead of forever showing Unpaid.
            if (payable.source_table === 'business_expenses' && payable.source_id) {
              await trx('business_expenses')
                .where({ id: payable.source_id })
                .update({
                  payment_status: fullyPaid ? 'Paid' : 'Partial',
                  paid_date: fullyPaid ? new Date() : null,
                  bank_account_id: bank_account_id || null,
                  payment_method: payment_method || null,
                  payment_reference: bank_reference || null,
                  updated_at: trx.fn.now(),
                });
            } else if (payable.source_table === 'mill_purchases' && payable.source_id) {
              await trx('mill_purchases')
                .where({ id: payable.source_id })
                .update({
                  payment_status: fullyPaid ? 'Paid' : 'Partial',
                  updated_at: trx.fn.now(),
                });
            }
          }
          if (bank_account_id) {
            await trx('bank_accounts')
              .where({ id: bank_account_id })
              .increment('current_balance', parseFloat(amount) * -1);
            const tableExists = await trx.schema.hasTable('bank_transactions');
            if (tableExists) {
              const lastBt = await trx('bank_transactions')
                .where('transaction_no', 'like', 'BT-%')
                .orderBy('id', 'desc').first('transaction_no');
              const seq = lastBt
                ? (parseInt(String(lastBt.transaction_no).replace(/^BT-/, ''), 10) || 0) + 1
                : 1;
              await trx('bank_transactions').insert({
                transaction_no: `BT-${String(seq).padStart(4, '0')}`,
                bank_account_id,
                type: 'debit',
                amount: stampedPkr,
                transaction_date: payment_date || new Date(),
                reference: bank_reference || paymentNo,
                counterparty: null,
                notes: `Payment ${paymentNo} for payable #${entity_id}`,
                source: 'record_payment',
                created_by: req.user?.id || null,
              });
            }
          }
        }

        // ── Journal entry — direct post, not autoPost. ─────────────
        // autoPost looks up posting_rules where trigger_event matches
        // 'payment_receipt' / 'payment_made'; those rows don't exist,
        // so every payment since day one quietly skipped the ledger.
        // Mirror the pattern used by payPurchase: build the balanced
        // entry inline using chart_of_accounts codes (1000 Cash & Bank,
        // 1100 A/R, 2000 A/P). Bank-level detail still lives in
        // bank_transactions, which is the sub-ledger for Cash & Bank.
        try {
          const isReceivable = type === 'receipt';
          const stampedAmtPkr = Number(stampedPkr.toFixed(2));
          const cashAndBank = await trx('chart_of_accounts').where({ code: '1000' }).first();

          // Determine the correct counter account based on the source row.
          //   AR accounts in use (per posting_rules):
          //     1110 Export AR (USD)        ← export sales, balance receipts
          //     1120 Local AR (PKR)         ← local sales
          //     1310 Customer Advances      ← advance receipts
          //   AP accounts in use:
          //     2010 Supplier Payable       ← all expense_recorded /
          //         purchase_invoice / store_purchase rules
          // Previously the code used 1100 / 2000, which no posting rule
          // touches, so the original liability/receivable never cleared.
          let counterCode = isReceivable ? '1100' : '2010';
          let counterEntity = 'export';
          // Stamp the party so this settlement lands in the right ledger.
          let partyType = null, partyId = null;
          if (isReceivable && linked_receivable_id) {
            const r = await trx('receivables').where({ id: linked_receivable_id }).first();
            if (r) {
              if (r.local_sale_id) { counterCode = '1120'; counterEntity = 'mill'; }
              else if (String(r.type || '').toLowerCase() === 'advance') { counterCode = '1310'; counterEntity = 'export'; }
              else counterCode = '1110'; // Export balance
              if (r.customer_id) { partyType = 'customer'; partyId = r.customer_id; }
            }
          } else if (!isReceivable && linked_payable_id) {
            const pa = await trx('payables').where({ id: linked_payable_id }).first();
            if (pa?.supplier_id) { partyType = 'supplier'; partyId = pa.supplier_id; }
          }
          const counterAcc = await trx('chart_of_accounts').where({ code: counterCode }).first();
          if (cashAndBank && counterAcc) {
            const debitAcc  = isReceivable ? cashAndBank : counterAcc;
            const creditAcc = isReceivable ? counterAcc : cashAndBank;
            // The journal is always posted in PKR (the company's base
            // currency). Line amounts above are already PKR-equivalents,
            // so currency='PKR' / fxRate=1 keeps the FE conversion math
            // a no-op. The original foreign amount is captured in the
            // description for traceability.
            const noteOriginal = cur !== 'PKR' ? ` (orig ${cur} ${amtNum.toLocaleString()} @ ${stampedFxRate})` : '';
            const journal = await accountingService.createJournal(trx, {
              date: (payment_date ? new Date(payment_date) : new Date()).toISOString().slice(0, 10),
              entity: isReceivable ? counterEntity : 'mill',
              refType: 'Payment',
              refNo: paymentNo,
              description: `Payment ${paymentNo} for ${entity_type} #${entity_id}${noteOriginal}`,
              currency: 'PKR',
              fxRate: 1,
              isAuto: true,
              userId: req.user.id,
              partyType,
              partyId,
              lines: [
                { account_id: debitAcc.id,  account: debitAcc.name,  debit: stampedAmtPkr, credit: 0,              narration: `DR ${debitAcc.code} ${debitAcc.name} — ${paymentNo}` },
                { account_id: creditAcc.id, account: creditAcc.name, debit: 0,             credit: stampedAmtPkr,  narration: `CR ${creditAcc.code} ${creditAcc.name} — ${paymentNo}` },
              ],
            });
            if (journal?.id) await accountingService.postJournal(trx, journal.id);
          } else {
            console.warn(`recordPayment: chart_of_accounts missing codes 1000/${counterCode} — journal skipped for ${paymentNo}`);
          }
        } catch (jeErr) {
          console.error('recordPayment journal error (payment still recorded):', jeErr.message);
        }

        return payment;
      });

      return res.status(201).json({
        success: true,
        data: { payment: result },
      });
    } catch (err) {
      console.error('Record payment error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getBankAccounts(req, res) {
    try {
      const accounts = await db('bank_accounts').orderBy('name', 'asc');
      return res.json({
        success: true,
        data: { accounts },
      });
    } catch (err) {
      console.error('Get bank accounts error:', err);
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

      let query = db('bank_transactions as bt')
        .leftJoin('bank_accounts as ba', 'bt.bank_account_id', 'ba.id')
        .select('bt.*', 'ba.name as account_name');

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

      const transfer = await db.transaction(async (trx) => {
        const transferNo = await generateTransferNo(trx);

        const [t] = await trx('internal_transfers')
          .insert({
            transfer_no: transferNo,
            batch_id,
            export_order_id,
            product_name: product_name || null,
            qty_mt: parseFloat(qty_mt),
            transfer_price_pkr: transfer_price_pkr ? parseFloat(transfer_price_pkr) : null,
            total_value_pkr: total_value_pkr ? parseFloat(total_value_pkr) : null,
            usd_equivalent: usd_equivalent ? parseFloat(usd_equivalent) : null,
            pkr_rate: pkr_rate ? parseFloat(pkr_rate) : 280,
            dispatch_date: dispatch_date || null,
            status: status || 'Pending',
            created_by: req.user.id,
          })
          .returning('*');

        // Post inventory movements. Use available_qty (not qty) so a lot
        // that has already been partially transferred or reserved isn't
        // double-counted. Pick the smallest lot that can satisfy the
        // requested MT to keep stock fragmented as little as possible.
        const millingLot = await trx('inventory_lots')
          .where({ entity: 'mill', type: 'finished' })
          .where('available_qty', '>=', t.qty_mt)
          .orderBy('available_qty', 'asc')
          .first();

        if (millingLot) {
          await inventoryService.transferToExport(trx, {
            transferId: t.id,
            lotId: millingLot.id,
            qtyMT: t.qty_mt,
            productName: t.product_name,
            orderId: t.export_order_id,
            transferPricePerMT: parseFloat(t.transfer_price_pkr) || 0,
            totalValuePkr: parseFloat(t.total_value_pkr) || 0,
            userId: req.user?.id,
          });
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
    const { from_date, to_date, source, limit = 500 } = req.query;
    const dateFilter = (q, col) => {
      if (from_date) q = q.where(col, '>=', from_date);
      if (to_date) q = q.where(col, '<=', to_date);
      return q;
    };

    const wantSource = source && source !== 'all' ? source : null;
    const all = [];

    // ── Inventory lot purchases (raw / finished / byproduct) ──
    if (!wantSource || wantSource === 'lot') {
      let q = db('inventory_lots as il')
        .leftJoin('suppliers as s', 'il.supplier_id', 's.id')
        .leftJoin('users as creator', 'il.created_by', 'creator.id')
        .where('il.landed_cost_total', '>', 0)
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
    if (!wantSource || wantSource === 'export_cost') {
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
        .leftJoin('users as approver', 'be.approved_by', 'approver.id')
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
    const sliced = all.slice(0, parseInt(limit, 10));

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

// ─── Unified "Mark Purchase Paid" ──────────────────────────────────────
// /finance/purchases aggregates four source tables (inventory_lots,
// mill_purchases, export_order_costs, business_expenses). Each has its
// own payment columns; this endpoint exposes a single way to settle
// any one of them from the dashboard. Optionally records which bank
// account the money came out of, decrementing its balance.
financeController.payPurchase = async (req, res) => {
  try {
    const { source, source_id, amount, bank_account_id, payment_method, payment_date, payment_reference, due_date, notes } = req.body;
    if (!source || !source_id) {
      return res.status(400).json({ success: false, message: 'source and source_id are required.' });
    }
    const id = parseInt(source_id, 10);
    if (!id) return res.status(400).json({ success: false, message: 'source_id must be numeric.' });

    const result = await db.transaction(async (trx) => {
      let row;
      let outstanding;
      let amountPkr;

      if (source === 'lot') {
        row = await trx('inventory_lots').where({ id }).first();
        if (!row) throw new Error('Inventory lot not found.');
        const total = parseFloat(row.landed_cost_total) || 0;
        const alreadyPaid = parseFloat(row.paid_amount) || 0;
        outstanding = Math.max(0, total - alreadyPaid);
      } else if (source === 'mill_store') {
        row = await trx('mill_purchases').where({ id }).first();
        if (!row) throw new Error('Mill store purchase not found.');
        const total = parseFloat(row.total_amount) || 0;
        const alreadyPaid = parseFloat(row.paid_amount) || 0;
        outstanding = Math.max(0, total - alreadyPaid);
      } else if (source === 'export_cost') {
        row = await trx('export_order_costs').where({ id }).first();
        if (!row) throw new Error('Export-order cost not found.');
        const total = parseFloat(row.base_amount_pkr) || (parseFloat(row.amount) || 0) * (parseFloat(row.fx_rate) || 1);
        const alreadyPaid = parseFloat(row.paid_amount) || 0;
        outstanding = Math.max(0, total - alreadyPaid);
      } else if (source === 'expense') {
        row = await trx('business_expenses').where({ id }).first();
        if (!row) throw new Error('Business expense not found.');
        const total = parseFloat(row.amount_pkr) || 0;
        const alreadyPaid = parseFloat(row.paid_amount) || 0;
        outstanding = Math.max(0, total - alreadyPaid);
      } else {
        throw new Error(`Unknown source "${source}". Use lot | mill_store | export_cost | expense.`);
      }

      // Default to settling the whole outstanding amount when the caller
      // didn't specify; clamp to outstanding so the column never goes
      // negative (an "over-payment" would mean refund territory, not pay).
      const payNum = amount == null ? outstanding : parseFloat(amount);
      if (!payNum || payNum <= 0) throw new Error('Amount must be greater than zero.');
      amountPkr = Math.min(payNum, outstanding);
      const newPaid = (parseFloat(row.paid_amount) || 0) + amountPkr;
      const fullyPaid = outstanding - amountPkr <= 0.01;
      const paidAt = payment_date ? new Date(payment_date) : new Date();
      const status = fullyPaid ? 'Paid' : 'Partial';

      const commonUpdate = {
        payment_status: status,
        paid_amount: newPaid,
        updated_at: trx.fn.now(),
      };

      if (source === 'lot') {
        const total = parseFloat(row.landed_cost_total) || 0;
        await trx('inventory_lots').where({ id }).update({
          ...commonUpdate,
          due_amount: Math.max(0, total - newPaid),
        });
      } else if (source === 'mill_store') {
        await trx('mill_purchases').where({ id }).update(commonUpdate);
      } else if (source === 'export_cost') {
        await trx('export_order_costs').where({ id }).update({
          ...commonUpdate,
          paid_at: fullyPaid ? paidAt : null,
          bank_account_id: bank_account_id || null,
          payment_method: payment_method || null,
          payment_reference: payment_reference || null,
        });
      } else if (source === 'expense') {
        await trx('business_expenses').where({ id }).update({
          ...commonUpdate,
          paid_date: fullyPaid ? paidAt : null,
          bank_account_id: bank_account_id || null,
          payment_method: payment_method || null,
          payment_reference: payment_reference || null,
        });
      }

      // Mirror payment state to the linked payables row so /finance/money-out
      // reflects the same paid_amount / outstanding / status. Pairs are keyed
      // by (source_table, source_id) — see the addCost / createPurchaseLot
      // controllers that create them. Resolved per source because the table
      // names map differently (lots / mill_purchases / export_order_costs /
      // business_expenses).
      const sourceTable =
        source === 'lot'         ? 'inventory_lots' :
        source === 'mill_store'  ? 'mill_purchases' :
        source === 'export_cost' ? 'export_order_costs' :
                                   'business_expenses';
      const linkedPayable = await trx('payables')
        .where({ source_table: sourceTable, source_id: id })
        .first();
      if (linkedPayable) {
        const newPayablePaid = (parseFloat(linkedPayable.paid_amount) || 0) + amountPkr;
        const original = parseFloat(linkedPayable.original_amount) || 0;
        await trx('payables').where({ id: linkedPayable.id }).update({
          paid_amount: newPayablePaid,
          outstanding: Math.max(0, original - newPayablePaid),
          status: newPayablePaid >= original - 0.01 ? 'Paid' : 'Partial',
          updated_at: trx.fn.now(),
        });
        // Canonical payment row (so the payment-trail + dashboard cheque view
        // see it uniformly). Deduped against the bank_transaction by the trail.
        const payCount = await trx('payments').count('id as c').first();
        await trx('payments').insert({
          payment_no: `PP-${(parseInt(payCount?.c) || 0) + 1}`,
          type: 'payment', amount: amountPkr, currency: 'PKR', fx_rate: 1, base_amount_pkr: amountPkr,
          payment_method: payment_method || null, bank_account_id: bank_account_id || null,
          bank_reference: payment_reference || null, due_date: due_date || null,
          linked_payable_id: linkedPayable.id, payment_date: paidAt,
          notes: `Payment for ${source} ${row.lot_no || row.purchase_no || row.expense_no || `#${id}`}`,
          created_by: req.user?.id || null,
        });
      }

      // Decrement the bank account when the user specified one.
      if (bank_account_id) {
        await trx('bank_accounts').where({ id: bank_account_id }).decrement('current_balance', amountPkr);
        const tableExists = await trx.schema.hasTable('bank_transactions');
        if (tableExists) {
          // transaction_no is NOT NULL + unique. Generate as BT-NNNN.
          const lastBt = await trx('bank_transactions')
            .where('transaction_no', 'like', 'BT-%')
            .orderBy('id', 'desc').first('transaction_no');
          const seq = lastBt
            ? (parseInt(String(lastBt.transaction_no).replace(/^BT-/, ''), 10) || 0) + 1
            : 1;
          const txnNo = `BT-${String(seq).padStart(4, '0')}`;
          await trx('bank_transactions').insert({
            transaction_no: txnNo,
            bank_account_id,
            type: 'debit',
            amount: amountPkr,
            transaction_date: paidAt,
            reference: payment_reference || null,
            counterparty: row.supplier_id ? null : (row.vendor_name || null),
            notes: `Payment for ${source} ${row.lot_no || row.purchase_no || row.expense_no || row.category || `#${id}`}${notes ? ' — ' + notes : ''}`,
            source: 'pay_purchase',
            created_by: req.user?.id || null,
          });
        }
      }

      // ─── Journal entry — DR payable / expense, CR Cash & Bank ──────
      // Match the convention used by recordPayment for Money In/Out so
      // the Accounting page shows every settlement, not just the ones
      // booked through Money Out's drawer. Skip silently if the GL
      // accounts aren't seeded yet — the payment itself already
      // succeeded and we don't want to roll it back over a bookkeeping
      // miss.
      try {
        const refLabel = row.lot_no || row.purchase_no || row.expense_no
          || (source === 'export_cost' ? `EXP-COST #${id}` : `#${id}`);
        const refType =
          source === 'lot'         ? 'Purchase Lot'
          : source === 'mill_store' ? 'Mill Purchase'
          : source === 'export_cost'? 'Export Order Cost'
          :                           'Business Expense';
        const entity = source === 'export_cost' ? 'export' : 'mill';

        // Debit side: clear the same payable that was credited at expense /
        // purchase recording. The `expense_recorded` posting rule credits
        // 2010 Supplier Payable (verified on prod), and lot/mill/export
        // cost flows do the same, so DR 2010 for every source — otherwise
        // 2010 keeps a phantom credit balance and 2110 grows a phantom
        // debit balance, which is what the earlier `source==='expense'`
        // branch produced before this fix.
        // Credit side: Cash & Bank umbrella (1000) — bank-level detail
        // already lives in bank_transactions written above.
        const supplierPayable = await trx('chart_of_accounts').where({ code: '2010' }).first();
        const cashAndBank     = await trx('chart_of_accounts').where({ code: '1000' }).first();

        const debitAcc = supplierPayable;
        // Stamp the supplier (from the source row or its mirrored payable) so
        // this settlement appears on the supplier's ledger even when refLabel
        // is a lot/purchase/expense label that doesn't match payables.linked_ref.
        const paySupplierId = row.supplier_id || linkedPayable?.supplier_id || null;
        if (debitAcc && cashAndBank) {
          await accountingService.createJournal(trx, {
            date: paidAt.toISOString().slice(0, 10),
            entity,
            refType,
            refNo: refLabel,
            description: `Payment of Rs ${Math.round(amountPkr).toLocaleString()} for ${refType.toLowerCase()} ${refLabel}${notes ? ` — ${notes}` : ''}`,
            currency: 'PKR',
            fxRate: 1,
            isAuto: true,
            userId: req.user?.id || null,
            partyType: paySupplierId ? 'supplier' : null,
            partyId: paySupplierId,
            lines: [
              { account_id: debitAcc.id,    account: debitAcc.name,    debit: amountPkr, credit: 0,         narration: `DR ${debitAcc.code} ${debitAcc.name} — settled ${refLabel}` },
              { account_id: cashAndBank.id, account: cashAndBank.name, debit: 0,         credit: amountPkr, narration: `CR ${cashAndBank.code} ${cashAndBank.name} — paid ${refLabel}` },
            ],
          }).then(async (journal) => {
            if (journal?.id) await accountingService.postJournal(trx, journal.id);
          });
        } else {
          console.warn(`Pay purchase: chart_of_accounts missing required codes (1000/2010/2110) — journal skipped for ${refType} ${refLabel}`);
        }
      } catch (jeErr) {
        console.error('Pay purchase journal error (payment still recorded):', jeErr.message);
      }

      return { source, source_id: id, amount_paid_pkr: amountPkr, status, fully_paid: fullyPaid };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('Pay purchase error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Failed to record purchase payment.' });
  }
};

module.exports = financeController;
