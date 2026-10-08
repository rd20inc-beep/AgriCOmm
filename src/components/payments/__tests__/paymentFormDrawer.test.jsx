import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { blankPaymentForm } from '../paymentPayload';

/**
 * PaymentFormDrawer: what the context knows is pre-filled and shown, the
 * variant decides the endpoint and the body, a role the route would refuse
 * gets an explanation instead of a form, and a successful payment refreshes
 * every list it moved.
 */
const calls = { post: [], put: [] };
vi.mock('../../../api/client', () => ({
  default: {
    post: vi.fn(async (url, body) => { calls.post.push({ url, body }); return { success: true, data: {} }; }),
    put: vi.fn(async (url, body) => { calls.put.push({ url, body }); return { success: true, data: {} }; }),
  },
}));
let mockPerms = () => true;
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: (m, a) => mockPerms(m, a) }) }));
const toasts = [];
vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: (m, t) => toasts.push([m, t]) }) }));
const invalidated = [];
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: ({ queryKey }) => invalidated.push(queryKey.join('/')) }) }));
let mockAccounts = [];
const accountsArgs = [];
vi.mock('../../../api/queries', () => ({ useBankAccounts: (opts) => { accountsArgs.push(opts); return { data: mockAccounts }; } }));
// Capture what the form hands the shared PaymentDrawer (render + submit wiring).
let drawerProps = null;
vi.mock('../PaymentDrawer', () => ({
  default: (props) => { drawerProps = props; return <div data-testid="payment-drawer" data-title={props.title}>{props.summary.map(([k, v]) => <span key={k}>{k}: {v}</span>)}{props.banner}</div>; },
}));

const { default: PaymentFormDrawer } = await import('../PaymentFormDrawer');
const allow = (...p) => (m, a) => p.includes(`${m}.${a}`);
const render = (el) => renderToStaticMarkup(el);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

beforeEach(() => {
  calls.post.length = 0; calls.put.length = 0; toasts.length = 0; invalidated.length = 0; accountsArgs.length = 0;
  drawerProps = null; mockPerms = allow('finance.view', 'finance.confirm_payment'); mockAccounts = [];
});

async function submit(over = {}) {
  const form = { ...blankPaymentForm({ amount: '150', method: 'bank_transfer', date: '2026-10-09', ...drawerProps.initial }), bankAccountId: '3', ...over };
  const body = drawerProps.buildBody(form);
  await drawerProps.onSubmit(body, form);
  drawerProps.onDone(form);
  return body;
}

describe('pre-fill from context', () => {
  it('a payable: party, document, currency and outstanding shown; amount capped at the outstanding', () => {
    const html = render(<PaymentFormDrawer doc={{ docKind: 'payable', row: { id: 40, payNo: 'PAY-9', currency: 'PKR', outstanding: 1200, supplierId: 2, supplierName: 'Rice Co' } }} onClose={() => {}} />);
    const t = text(html);
    expect(t).toContain('Payee: Rice Co');
    expect(t).toContain('Document: PAY-9');
    expect(t).toContain('Currency: PKR');
    expect(t).toMatch(/Outstanding: Rs 1,200\.00/);
    expect(drawerProps).toMatchObject({ type: 'payment', currency: 'PKR', outstanding: 1200, taxes: true, attach: true, title: 'Pay supplier' });
  });

  it('an export receipt inherits the order\'s bank account and booked rate, and says it waits for Finance', () => {
    const html = render(<PaymentFormDrawer variant="receive_export" ctx={{ orderId: 77, kind: 'advance', currency: 'USD', outstanding: 2000, bankAccountId: 9, fxRate: 280, ref: 'EX-1 · Advance' }} onClose={() => {}} />);
    expect(html).toContain('data-testid="pending-note"');
    expect(drawerProps.initial).toMatchObject({ bankAccountId: '9', fxRate: '280' });
    expect(drawerProps.methods.map((m) => m.value)).not.toContain('cheque');
    expect(drawerProps.renderExtra).toBeTypeOf('function'); // the rate estimate field
  });

  it('a mill-only payer defaults to cash and is offered only mill accounts', () => {
    mockPerms = allow('milling.view', 'milling.edit');
    mockAccounts = [{ id: 1, entity: 'mill', type: 'cash' }, { id: 2, entity: 'general', type: 'bank' }];
    render(<PaymentFormDrawer doc={{ docKind: 'payable', row: { id: 5, outstanding: 10, supplierName: 'S' } }} onClose={() => {}} />);
    expect(drawerProps.defaultMethod).toBe('cash');
    expect(drawerProps.accounts.map((a) => a.id)).toEqual([1]);
    expect(accountsArgs[0]).toEqual({ millOnly: true });
    // The document upload is its own finance.confirm_payment route.
    expect(drawerProps.attach).toBe(false);
  });
});

describe('submits to the variant\'s endpoint', () => {
  it('receivable → POST /finance/payments', async () => {
    render(<PaymentFormDrawer doc={{ docKind: 'receivable', row: { id: 12, recvNo: 'RCV-1', currency: 'PKR', outstanding: 500 } }} onClose={() => {}} />);
    await submit();
    expect(calls.post).toEqual([{ url: '/api/finance/payments', body: expect.objectContaining({ type: 'receipt', amount: 150, linked_receivable_id: 12, currency: 'PKR', bank_account_id: 3 }) }]);
    expect(invalidated).toEqual(expect.arrayContaining(['receivables', 'payables', 'bank-accounts', 'finance-transaction']));
    expect(toasts[0][1]).toBe('success');
  });

  it('export advance → POST /export-orders/:id/record-receipt; toast says it waits for confirmation', async () => {
    mockPerms = allow('export_orders.confirm_advance');
    render(<PaymentFormDrawer variant="receive_export" ctx={{ orderId: 77, kind: 'advance', currency: 'USD', outstanding: 2000 }} onClose={() => {}} />);
    await submit({ fxRate: '281' });
    expect(calls.post).toEqual([{ url: '/api/export-orders/77/record-receipt', body: expect.objectContaining({ kind: 'advance', amount: 150, fx_rate: 281 }) }]);
    expect(toasts[0][0]).toMatch(/waiting for Finance to confirm/);
  });

  it('expense → PUT /expenses/:id/pay', async () => {
    render(<PaymentFormDrawer doc={{ docKind: 'expense', row: { id: 8, expense_no: 'EXP-1', outstanding_pkr: 300 } }} onClose={() => {}} />);
    await submit({ reference: 'R1' });
    expect(calls.put).toEqual([{ url: '/api/expenses/8/pay', body: expect.objectContaining({ amount: 150, payment_reference: 'R1', paid_date: '2026-10-09' }) }]);
  });

  it('local sale (whole sale) → the group endpoint', async () => {
    mockPerms = allow('inventory.create');
    render(<PaymentFormDrawer doc={{ docKind: 'local_sale', row: { id: 9, kind: 'local_sale', saleGroupNo: 'LS-7', outstanding: 900 } }} onClose={() => {}} />);
    await submit({ method: 'cash', collectionLocation: 'Mill' });
    expect(calls.post[0]).toEqual({ url: '/api/local-sales/group/LS-7/payments', body: expect.objectContaining({ payment_method: 'cash', collection_location: 'Mill', bank_account_id: null }) });
  });

  it('purchase → POST /finance/purchases/pay', async () => {
    render(<PaymentFormDrawer doc={{ docKind: 'purchase', row: { refId: 3, source: 'mill_store', amountPkr: 500, paidAmount: 0 } }} onClose={() => {}} />);
    await submit();
    expect(calls.post[0]).toEqual({ url: '/api/finance/purchases/pay', body: expect.objectContaining({ source: 'mill_store', source_id: 3, amount: 150 }) });
  });
});

describe('the route guard, mirrored', () => {
  it('a read-only role gets an explanation, not a form', () => {
    mockPerms = allow('finance.view');
    const html = render(<PaymentFormDrawer doc={{ docKind: 'payable', row: { id: 40, outstanding: 10, supplierName: 'S' } }} onClose={() => {}} />);
    expect(html).toContain('data-testid="payment-not-allowed"');
    expect(drawerProps).toBeNull();
  });
});
