import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VARIANTS, paymentRequest, contextForDocument, variantForDocument, isSettleable, canRecordVariant, variantConfig,
} from '../paymentVariants';
import { blankPaymentForm } from '../paymentPayload';

/**
 * The Payment form's variants: each sends the body its endpoint reads, to
 * that endpoint, and is offered only to a role its route guard admits.
 */
const allow = (...perms) => (m, a) => perms.includes(`${m}.${a}`);
const FM = allow('finance.view', 'finance.confirm_payment', 'finance.allocate_cost');
const AUDITOR = allow('finance.view');
const MILL_OP = allow('milling.view', 'milling.edit');
const EXPORT_MGR = allow('finance.view', 'export_orders.confirm_advance', 'finance.confirm_payment');
const INV_OFFICER = allow('inventory.create');

const form = (over = {}) => ({ ...blankPaymentForm({ amount: '100', method: 'bank_transfer', date: '2026-10-09' }), bankAccountId: '7', ...over });

describe('variant per document', () => {
  it('picks the path the backend settles each document by', () => {
    expect(variantForDocument({ docKind: 'receivable', row: { id: 1, orderId: 5 } })).toBe('receive_export');
    expect(variantForDocument({ docKind: 'receivable', row: { id: 1 } })).toBe('receive_receivable');
    expect(variantForDocument({ docKind: 'receivable', row: { id: 1, kind: 'local_sale' } })).toBe('receive_local_sale');
    expect(variantForDocument({ docKind: 'local_sale', row: { id: 1 } })).toBe('receive_local_sale');
    expect(variantForDocument({ docKind: 'payable', row: { id: 1, supplierName: 'A' } })).toBe('pay_payable');
    expect(variantForDocument({ docKind: 'payable', row: { id: 1, haulerName: 'T' } })).toBe('pay_transporter');
    expect(variantForDocument({ docKind: 'expense', row: { id: 1 } })).toBe('pay_expense');
    expect(variantForDocument({ docKind: 'purchase', row: { refId: 1 } })).toBe('pay_purchase');
  });
});

describe('endpoints and bodies', () => {
  it('receive a receivable → POST /finance/payments, type receipt, in the row\'s currency', () => {
    const ctx = contextForDocument({ docKind: 'receivable', row: { id: 12, recvNo: 'RCV-1', currency: 'PKR', outstanding: 500, customerId: 3, customerName: 'Buyer' } });
    expect(ctx).toMatchObject({ variant: 'receive_receivable', receivableId: 12, currency: 'PKR', outstanding: 500, party: { type: 'customer', id: 3, name: 'Buyer' } });
    const r = paymentRequest(ctx.variant, ctx, form({ reference: 'TT-9' }));
    expect(r.method).toBe('post');
    expect(r.url).toBe('/api/finance/payments');
    expect(r.body).toMatchObject({ type: 'receipt', amount: 100, currency: 'PKR', linked_receivable_id: 12, bank_account_id: 7, bank_reference: 'TT-9', payment_method: 'bank_transfer', payment_date: '2026-10-09' });
  });

  it('an export advance → the order\'s record-receipt (pending Finance confirmation), with the bank reference and rate estimate', () => {
    const ctx = contextForDocument({ docKind: 'receivable', row: { id: 4, orderId: 77, type: 'Advance', currency: 'USD', outstanding: 2000, recvNo: 'RCV-ADV-1' } });
    expect(ctx).toMatchObject({ variant: 'receive_export', orderId: 77, kind: 'advance', currency: 'USD', outstanding: 2000 });
    const r = paymentRequest('receive_export', ctx, form({ fxRate: '281.5', reference: 'SWIFT1' }));
    expect(r).toEqual({
      method: 'post', url: '/api/export-orders/77/record-receipt',
      body: { kind: 'advance', amount: 100, fx_rate: 281.5, payment_date: '2026-10-09', payment_method: 'bank_transfer', bank_account_id: 7, bank_reference: 'SWIFT1', notes: null },
    });
    expect(paymentRequest('receive_export', { ...ctx, kind: 'balance' }, form()).body.kind).toBe('balance');
  });

  it('an export receipt is confirmed once the money is in the bank — no cheque offered', () => {
    expect(VARIANTS.receive_export.methods.map((m) => m.value)).not.toContain('cheque');
    expect(VARIANTS.receive_export.pending).toBe(true);
  });

  it('a local sale → the group endpoint; cash goes by collection point, not an account', () => {
    const ctx = contextForDocument({ docKind: 'local_sale', row: { id: 9, kind: 'local_sale', saleGroupNo: 'LS-0007', outstanding: 3000, collectionLocation: 'Head Office' } });
    expect(ctx).toMatchObject({ variant: 'receive_local_sale', groupNo: 'LS-0007', currency: 'PKR', collectionLocation: 'Head Office' });
    const cash = paymentRequest('receive_local_sale', ctx, form({ method: 'cash', collectionLocation: 'Head Office' }));
    expect(cash.url).toBe('/api/local-sales/group/LS-0007/payments');
    expect(cash.body).toMatchObject({ payment_method: 'cash', bank_account_id: null, collection_location: 'Head Office', amount: 100 });
    const bank = paymentRequest('receive_local_sale', ctx, form());
    expect(bank.body).toMatchObject({ bank_account_id: 7, collection_location: null });
    expect(variantConfig('receive_local_sale').accountRequired({ method: 'cash' })).toBe(false);
    expect(variantConfig('receive_local_sale').accountRequired({ method: 'bank_transfer' })).toBe(true);
  });

  it('one sale line → POST /local-sales/:id/payments', () => {
    expect(paymentRequest('receive_local_sale_line', { saleId: 33 }, form()).url).toBe('/api/local-sales/33/payments');
  });

  it('a service invoice → POST /service-milling/invoices/:id/payments with reference / due date', () => {
    const r = paymentRequest('receive_service', { invoiceId: 5 }, form({ method: 'cheque', reference: 'CHQ-1', dueDate: '2026-10-20' }));
    expect(r.url).toBe('/api/service-milling/invoices/5/payments');
    expect(r.body).toMatchObject({ payment_method: 'cheque', reference: 'CHQ-1', due_date: '2026-10-20' });
  });

  it('pay a payable → POST /finance/payments with WHT / discount / document on a PKR payable', () => {
    const ctx = contextForDocument({ docKind: 'payable', row: { id: 40, payNo: 'PAY-9', currency: 'PKR', outstanding: 1000, supplierId: 2, supplierName: 'S' } });
    const r = paymentRequest(ctx.variant, ctx, form({ whtRate: '2', whtAmount: '2', discountAmount: '1', attachmentUrl: 'f.pdf', attachmentName: 'cert.pdf' }));
    expect(r.url).toBe('/api/finance/payments');
    expect(r.body).toMatchObject({ type: 'payment', linked_payable_id: 40, wht_amount: 2, wht_rate: 2, discount_amount: 1, attachment_url: 'f.pdf' });
  });

  it('WHT is a PKR obligation: never sent on a foreign payable', () => {
    const ctx = contextForDocument({ docKind: 'payable', row: { id: 41, currency: 'USD', outstanding: 10, supplierName: 'S' } });
    const r = paymentRequest(ctx.variant, ctx, form({ whtAmount: '2', discountAmount: '1', whtRate: '2' }));
    expect(r.body).toMatchObject({ currency: 'USD', wht_amount: 0, discount_amount: 0, wht_rate: null });
  });

  it('a transporter payable is the same endpoint, inherited hauler as payee', () => {
    const ctx = contextForDocument({ docKind: 'payable', row: { id: 42, currency: 'PKR', outstanding: 10, haulerId: 6, haulerName: 'Truck Co' } });
    expect(ctx).toMatchObject({ variant: 'pay_transporter', party: { type: 'hauler', id: 6, name: 'Truck Co' } });
    expect(paymentRequest(ctx.variant, ctx, form()).body.linked_payable_id).toBe(42);
  });

  it('an expense → PUT /expenses/:id/pay with its own field names', () => {
    const ctx = contextForDocument({ docKind: 'expense', row: { id: 8, expense_no: 'EXP-1', amount_pkr: 300.5, outstanding_pkr: 300.5 } });
    expect(ctx).toMatchObject({ variant: 'pay_expense', expenseId: 8, currency: 'PKR', outstanding: 300.5 });
    const r = paymentRequest('pay_expense', ctx, form({ reference: 'R1' }));
    expect(r).toEqual({ method: 'put', url: '/api/expenses/8/pay', body: {
      amount: 100, payment_method: 'bank_transfer', bank_account_id: 7, payment_reference: 'R1', paid_date: '2026-10-09', due_date: null, notes: 'Payment for EXP-1',
    } });
  });

  it('a purchase → POST /finance/purchases/pay (source + id), outstanding = total − paid', () => {
    const ctx = contextForDocument({ docKind: 'purchase', row: { refId: 3, source: 'lot', amountPkr: 1000, paidAmount: 250, supplierId: 1, supplierName: 'S', ref: 'LOT-1' } });
    expect(ctx).toMatchObject({ variant: 'pay_purchase', outstanding: 750, source: 'lot', sourceId: 3 });
    const r = paymentRequest('pay_purchase', ctx, form());
    expect(r.url).toBe('/api/finance/purchases/pay');
    expect(r.body).toMatchObject({ source: 'lot', source_id: 3, amount: 100, payment_method: 'bank_transfer' });
  });
});

describe('what can be settled, and by whom', () => {
  it('paid, reversed, nothing owed, and cost-derived rows are not settleable', () => {
    expect(isSettleable({ docKind: 'payable', row: { id: 1, outstanding: 5, status: 'Paid' } })).toBe(false);
    expect(isSettleable({ docKind: 'payable', row: { id: 1, outstanding: 0 } })).toBe(false);
    expect(isSettleable({ docKind: 'payable', row: { id: 'MC-4', outstanding: 5 } })).toBe(false);
    expect(isSettleable({ docKind: 'payable', row: { id: 7, outstanding: 5, supplierName: 'S' } })).toBe(true);
  });

  it('mirrors each route guard', () => {
    expect(canRecordVariant('receive_receivable', FM)).toBe(true);
    expect(canRecordVariant('receive_receivable', AUDITOR)).toBe(false);
    expect(canRecordVariant('pay_payable', MILL_OP)).toBe(true); // milling.edit (the server restricts to mill rows)
    expect(canRecordVariant('pay_expense', MILL_OP)).toBe(false); // PUT /expenses/:id/pay is finance.confirm_payment
    expect(canRecordVariant('receive_export', EXPORT_MGR)).toBe(true);
    expect(canRecordVariant('receive_export', MILL_OP)).toBe(false);
    expect(canRecordVariant('receive_local_sale', INV_OFFICER)).toBe(true);
    expect(canRecordVariant('receive_service', FM)).toBe(false); // service_milling.record_payment
    expect(canRecordVariant('receive_service', allow('service_milling.record_payment'))).toBe(true);
    for (const v of Object.keys(VARIANTS)) expect([v, canRecordVariant(v, AUDITOR)]).toEqual([v, false]);
  });
});

describe('the variants match the backend guards in the route files', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const B = path.resolve(HERE, '../../../../backend/src/modules');
  const read = (f) => fs.readFileSync(path.join(B, f), 'utf8');
  it('record-receipt, local-sale, service and expense-pay guards are what the variants say', () => {
    expect(read('exportOrders/exportOrders.routes.js')).toMatch(/'\/:id\/record-receipt',\s*authorizeAny\(\['export_orders', 'confirm_advance'\], \['finance', 'confirm_payment'\]\)/);
    expect(read('localSales/localSales.routes.js')).toMatch(/'\/group\/:groupNo\/payments',\s*authorizeAny\(\['inventory', 'create'\], \['finance', 'confirm_payment'\], \['milling', 'edit'\]\)/);
    expect(read('serviceMilling/serviceMilling.routes.js')).toMatch(/'\/invoices\/:id\/payments',\s*authorize\('service_milling', 'record_payment'\)/);
    expect(read('expenses/expenses.routes.js')).toMatch(/'\/:id\/pay',\s*authorize\('finance', 'confirm_payment'\)/);
    expect(read('finance/finance.routes.js')).toMatch(/const canPayFinanceOrMill = authorizeAny\(\['finance', 'confirm_payment'\], \['milling', 'edit'\]\)/);
  });
});
