/**
 * The Payment form's contextual variants — one per money path the backend
 * already has. Each says which endpoint records it, what body that endpoint
 * reads (its Joi schema / handler, field for field), which permission the
 * route guard asks for, and what the form offers (methods, tax block, cash
 * collection point). Pure, so the payloads are what the tests assert.
 *
 *   variant              endpoint                                         guard (backend)
 *   receive_receivable   POST /api/finance/payments            type=receipt  any(finance.confirm_payment, milling.edit)
 *   receive_export       POST /api/export-orders/:id/record-receipt          any(export_orders.confirm_advance, finance.confirm_payment)
 *                        → a PENDING receipt Finance confirms (maker ≠ checker)
 *   receive_local_sale   POST /api/local-sales/group/:groupNo/payments       any(inventory.create, finance.confirm_payment, milling.edit)
 *   receive_local_sale_line POST /api/local-sales/:id/payments (one line)   (same guard)
 *   receive_service      POST /api/service-milling/invoices/:id/payments     service_milling.record_payment
 *   pay_payable          POST /api/finance/payments            type=payment  any(finance.confirm_payment, milling.edit)
 *   pay_transporter      (same as pay_payable — a hauler's payable)
 *   pay_expense          PUT  /api/expenses/:id/pay                          finance.confirm_payment
 *   pay_purchase         POST /api/finance/purchases/pay                     any(finance.confirm_payment, milling.edit)
 *
 * A document row (Money In / Money Out / Purchases / Expenses / Needs
 * Attention) picks its variant with variantForDocument().
 */
import { paymentPayload, purchasePayPayload, PAYMENT_METHODS } from './paymentPayload';
import { isDerivedPayable } from '../../shared/utils/derivedPayables';

const num = (v) => parseFloat(v) || 0;
const PAYS = [['finance', 'confirm_payment'], ['milling', 'edit']];

const M = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m]));
const LC = { value: 'lc', label: 'Letter of Credit' };
const STANDARD = [M.bank_transfer, M.cash, M.cheque, M.online];
// An export receipt is confirmed once the money is in the bank; the confirm
// step refuses a cheque (exportReceipts.postExportReceipt), so none is offered.
const EXPORT_METHODS = [M.bank_transfer, LC, M.online, M.cash];
const RECEIVE_METHODS = [M.bank_transfer, LC, M.cheque, M.cash, M.online];

export const VARIANTS = {
  receive_receivable: {
    side: 'receipt', title: 'Receive payment', submit: 'Record receipt', anyOf: PAYS,
    methods: RECEIVE_METHODS, taxes: false, attach: true,
  },
  receive_export: {
    side: 'receipt', title: 'Receive export payment', submit: 'Submit for confirmation',
    anyOf: [['export_orders', 'confirm_advance'], ['finance', 'confirm_payment']],
    methods: EXPORT_METHODS, taxes: false, attach: false, fxEstimate: true, pending: true,
  },
  receive_local_sale: {
    side: 'receipt', title: 'Receive local-sale payment', submit: 'Record receipt',
    anyOf: [['inventory', 'create'], ['finance', 'confirm_payment'], ['milling', 'edit']],
    methods: STANDARD, taxes: false, attach: false, cashLocation: true,
  },
  receive_local_sale_line: {
    side: 'receipt', title: 'Receive local-sale payment', submit: 'Record receipt',
    anyOf: [['inventory', 'create'], ['finance', 'confirm_payment'], ['milling', 'edit']],
    methods: STANDARD, taxes: false, attach: false, cashLocation: true,
  },
  receive_service: {
    side: 'receipt', title: 'Receive service-invoice payment', submit: 'Record receipt',
    anyOf: [['service_milling', 'record_payment']],
    methods: STANDARD, taxes: false, attach: false, cashLocation: true,
  },
  pay_payable: {
    side: 'payment', title: 'Pay supplier', submit: 'Record payment', anyOf: PAYS,
    methods: STANDARD, taxes: 'pkr', attach: true,
  },
  pay_transporter: {
    side: 'payment', title: 'Pay transporter', submit: 'Record payment', anyOf: PAYS,
    methods: STANDARD, taxes: 'pkr', attach: true,
  },
  pay_expense: {
    side: 'payment', title: 'Pay expense', submit: 'Record payment',
    anyOf: [['finance', 'confirm_payment']],
    methods: STANDARD, taxes: false, attach: false,
  },
  pay_purchase: {
    side: 'payment', title: 'Pay purchase', submit: 'Record payment', anyOf: PAYS,
    methods: [M.bank_transfer, M.cash, M.cheque], taxes: false, attach: false,
  },
};

/** Whether this user may record this variant — the route guard, mirrored. */
export function canRecordVariant(variant, hasPermission) {
  const v = VARIANTS[variant];
  if (!v || typeof hasPermission !== 'function') return false;
  return v.anyOf.some(([m, a]) => hasPermission(m, a));
}

/**
 * The variant for a document as the finance lists carry it:
 *   { docKind: 'receivable' | 'local_sale' | 'payable' | 'expense' | 'purchase', row }
 * A receivable raised for an export order is a pending export receipt; one
 * raised for a service invoice is still a receivable (the engine stamps the
 * invoice). A payable owed to a transporter is the transporter variant.
 */
export function variantForDocument(doc) {
  const r = doc?.row || {};
  switch (doc?.docKind) {
    case 'local_sale': return 'receive_local_sale';
    case 'receivable': return (r.kind === 'local_sale') ? 'receive_local_sale'
      : (r.orderId ? 'receive_export' : 'receive_receivable');
    case 'service_invoice': return 'receive_service';
    case 'expense': return 'pay_expense';
    case 'purchase': return 'pay_purchase';
    case 'payable': return (!r.supplierName && r.haulerName) ? 'pay_transporter' : 'pay_payable';
    default: return null;
  }
}

/** Methods offered, the tax block, and whether an account must be picked. */
export function variantConfig(variant) {
  const v = VARIANTS[variant];
  if (!v) return null;
  return {
    ...v,
    // Cash on a local sale or service invoice is routed by where it was
    // collected (Mill Cash / Office Petty Cash), not by an account pick.
    accountRequired: (form) => !(v.cashLocation && form.method === 'cash') && form.method !== 'cheque',
  };
}

/**
 * The request a variant sends: { method, url, body }. `ctx` is what the form
 * inherited (ids, currency, notes); `form` is what the user confirmed.
 */
export function paymentRequest(variant, ctx = {}, form) {
  switch (variant) {
    case 'receive_receivable':
      return {
        method: 'post', url: '/api/finance/payments',
        body: paymentPayload(form, { type: VARIANTS[variant].side, currency: ctx.currency || 'PKR', receivableId: ctx.receivableId, notes: ctx.notes || '' }),
      };
    case 'pay_payable':
    case 'pay_transporter': {
      const body = paymentPayload(form, { type: VARIANTS[variant].side, currency: ctx.currency || 'PKR', payableId: ctx.payableId, notes: ctx.notes || '' });
      // WHT is a PKR obligation (the server's WHT arithmetic is in PKR): on a
      // foreign payable the tax block is not offered and nothing is sent.
      if ((ctx.currency || 'PKR') !== 'PKR') Object.assign(body, { wht_amount: 0, wht_rate: null, discount_amount: 0 });
      return { method: 'post', url: '/api/finance/payments', body };
    }
    case 'receive_export':
      return {
        method: 'post', url: `/api/export-orders/${ctx.orderId}/record-receipt`,
        body: {
          kind: ctx.kind === 'balance' ? 'balance' : 'advance',
          amount: num(form.amount),
          // An estimate; Finance sets the rate the bank applied when confirming.
          fx_rate: num(form.fxRate) > 0 ? num(form.fxRate) : null,
          payment_date: form.date,
          payment_method: form.method,
          bank_account_id: form.bankAccountId ? parseInt(form.bankAccountId, 10) : null,
          bank_reference: form.reference || null,
          notes: form.notes || ctx.notes || null,
        },
      };
    case 'receive_local_sale':
    case 'receive_local_sale_line': {
      const cash = form.method === 'cash';
      return {
        method: 'post',
        url: variant === 'receive_local_sale_line'
          ? `/api/local-sales/${ctx.saleId}/payments`
          : `/api/local-sales/group/${encodeURIComponent(ctx.groupNo)}/payments`,
        body: {
          amount: num(form.amount),
          payment_method: form.method,
          payment_date: form.date,
          bank_account_id: cash ? null : (form.bankAccountId ? parseInt(form.bankAccountId, 10) : null),
          collection_location: cash ? (form.collectionLocation || 'Mill') : null,
          reference: form.reference || null,
          due_date: form.dueDate || null,
          notes: form.notes || ctx.notes || null,
        },
      };
    }
    case 'receive_service': {
      const cash = form.method === 'cash';
      return {
        method: 'post', url: `/api/service-milling/invoices/${ctx.invoiceId}/payments`,
        body: {
          amount: num(form.amount),
          payment_method: form.method,
          payment_date: form.date,
          bank_account_id: cash ? null : (form.bankAccountId ? parseInt(form.bankAccountId, 10) : null),
          collection_location: cash ? (form.collectionLocation || 'Mill') : null,
          reference: form.reference || null,
          due_date: form.dueDate || null,
        },
      };
    }
    case 'pay_expense':
      return {
        method: 'put', url: `/api/expenses/${ctx.expenseId}/pay`,
        body: {
          amount: num(form.amount),
          payment_method: form.method,
          bank_account_id: form.bankAccountId ? parseInt(form.bankAccountId, 10) : null,
          payment_reference: form.reference || null,
          paid_date: form.date,
          due_date: form.dueDate || null,
          notes: form.notes || ctx.notes || null,
        },
      };
    case 'pay_purchase':
      return {
        method: 'post', url: '/api/finance/purchases/pay',
        body: purchasePayPayload(form, { source: ctx.source, sourceId: ctx.sourceId }),
      };
    default:
      throw new Error(`Unknown payment variant "${variant}"`);
  }
}

/**
 * What a document row hands the form: the ids the endpoint needs, the
 * currency it settles in, the outstanding to cap at, and the inherited values
 * shown at the top of the form (party, document, currency, outstanding).
 */
export function contextForDocument(doc) {
  const r = doc?.row || {};
  const variant = variantForDocument(doc);
  const outstanding = r.outstanding != null ? num(r.outstanding) : null;
  switch (variant) {
    case 'receive_receivable':
      return { variant, receivableId: r.dbId || r.id, currency: r.currency || 'USD', outstanding,
        party: { type: 'customer', id: r.customerId, name: r.customerName }, ref: r.recvNo, notes: `Payment for ${r.recvNo || ''}`.trim() };
    case 'receive_export':
      return { variant, orderId: r.orderId, receivableId: r.dbId || r.id, kind: String(r.type || '').toLowerCase() === 'balance' ? 'balance' : 'advance',
        currency: r.currency || 'USD', outstanding, party: { type: 'customer', id: r.customerId, name: r.customerName }, ref: r.recvNo,
        bankAccountId: r.bankAccountId || null, fxRate: r.fxRate || null };
    case 'receive_local_sale':
      return { variant, groupNo: r.saleGroupNo || r.recvNo, currency: 'PKR', outstanding,
        party: { type: 'customer', id: r.customerId, name: r.customerName }, ref: r.saleGroupNo || r.recvNo,
        collectionLocation: r.collectionLocation || 'Mill' };
    case 'receive_service':
      return { variant, invoiceId: r.id, currency: 'PKR', outstanding,
        party: { type: 'customer', id: r.clientCustomerId || r.customerId, name: r.clientName || r.customerName }, ref: r.invoiceNo };
    case 'pay_payable':
    case 'pay_transporter':
      return { variant, payableId: r.dbId || r.id, currency: r.currency || 'PKR', outstanding,
        party: r.supplierName ? { type: 'supplier', id: r.supplierId, name: r.supplierName } : { type: 'hauler', id: r.haulerId, name: r.haulerName },
        ref: r.payNo, notes: `Payment for ${r.payNo || ''} - ${r.supplierName || r.haulerName || r.category || ''}`.trim() };
    case 'pay_expense': {
      const remaining = Math.round(((r.outstanding_pkr ?? r.outstandingPkr ?? r.amount_pkr ?? r.amountPkr ?? r.amount) || 0) * 100) / 100;
      return { variant, expenseId: r.id, currency: 'PKR', outstanding: num(remaining),
        party: r.supplier_id || r.supplierId ? { type: 'supplier', id: r.supplier_id || r.supplierId, name: r.supplier_name_joined || r.vendor_name } : { type: 'vendor', id: null, name: r.vendor_name || r.vendorName || null },
        ref: r.expense_no || r.expenseNo, notes: `Payment for ${r.expense_no || r.expenseNo || ''}`.trim() };
    }
    case 'pay_purchase': {
      const total = num(r.amountPkr);
      return { variant, source: r.source, sourceId: r.refId, currency: 'PKR',
        outstanding: Math.max(0, Math.round((total - num(r.paidAmount)) * 100) / 100),
        party: { type: 'supplier', id: r.supplierId, name: r.supplierName }, ref: r.ref };
    }
    default: return null;
  }
}

/** A document is settleable from a form only when it has something owed and a real row behind it. */
export function isSettleable(doc) {
  const r = doc?.row || {};
  const st = String(r.status || r.paymentStatus || r.payment_status || '').toLowerCase();
  if (st === 'paid' || st === 'reversed') return false;
  const ctx = contextForDocument(doc);
  if (!ctx) return false;
  if (ctx.outstanding != null && !(ctx.outstanding > 0)) return false;
  // Cost-derived payables (MC- / EC- / ME-) have no stored row to settle.
  if ((ctx.variant === 'pay_payable' || ctx.variant === 'pay_transporter')
    && (isDerivedPayable(doc.row) || !/^\d+$/.test(String(ctx.payableId)))) return false;
  return true;
}
