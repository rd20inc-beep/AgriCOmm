import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { STORAGE_KEY, rememberAccount, readRememberedAccount } from '../../../shared/hooks/useDefaultAccount';
import { entityForPayment } from '../paymentVariants';
import { millStorePurchaseCtx, printedBagOrderCtx } from '../purchasePayContext';

/**
 * P5-11 / W02–W03 — every payment entry point opens the one Payment form with
 * the right defaults: party, document, outstanding (editable), the account the
 * user last used for that currency + entity (visible, editable), and nothing
 * is sent until the user submits.
 */

// ── the shared drawer itself (real PaymentDrawer, fields captured) ─────────
const posted = [];
vi.mock('../../../api/client', () => ({
  default: {
    post: vi.fn(async (url, body) => { posted.push({ url, body }); return { success: true, data: {} }; }),
    put: vi.fn(async (url, body) => { posted.push({ url, body }); return { success: true, data: {} }; }),
  },
}));
let fieldProps = null;
vi.mock('../PaymentFields', () => ({
  default: (props) => { fieldProps = props; return <div data-testid="fields" />; },
}));
let slide = null;
vi.mock('../../SlideDrawer', () => ({
  default: (props) => { slide = props; return <div data-title={props.title}>{props.children}</div>; },
}));

const { default: PaymentDrawer } = await import('../PaymentDrawer');

const ACCOUNTS = [
  { id: 1, name: 'HO Bank', type: 'bank', entity: 'general', currency: 'PKR', isActive: true },
  { id: 2, name: 'USD Bank', type: 'bank', entity: 'export', currency: 'USD', isActive: true },
  { id: 3, name: 'Mill Cash', type: 'cash', entity: 'mill', currency: 'PKR', isActive: true },
  { id: 4, name: 'Closed Bank', type: 'bank', entity: 'general', currency: 'PKR', isActive: false },
];

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.setItem('riceflow_user', JSON.stringify({ id: 11 }));
  posted.length = 0; fieldProps = null; slide = null;
});

const formEl = () => slide.children; // <form onSubmit={submit}>

describe('PaymentDrawer — remembered account', () => {
  it('offers the account last used for this currency + entity, and posts nothing on open', () => {
    rememberAccount({ currency: 'PKR', entity: 'general', accountId: 1 });
    const onSubmit = vi.fn();
    renderToStaticMarkup(<PaymentDrawer title="Pay" accounts={ACCOUNTS} currency="PKR" outstanding={500} rememberAs={{ entity: 'general' }} onSubmit={onSubmit} />);
    expect(fieldProps.preferredAccountId).toBe('1');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it('an account switched off since is not offered (falls back to the form rule)', () => {
    rememberAccount({ currency: 'PKR', entity: 'general', accountId: 4 });
    renderToStaticMarkup(<PaymentDrawer title="Pay" accounts={ACCOUNTS} currency="PKR" rememberAs={{ entity: 'general' }} onSubmit={vi.fn()} />);
    expect(fieldProps.preferredAccountId).toBe('');
  });

  it('a USD receipt is never defaulted onto a PKR-only choice made for another currency', () => {
    rememberAccount({ currency: 'PKR', entity: 'export', accountId: 1 });
    renderToStaticMarkup(<PaymentDrawer title="Receive" type="receipt" accounts={ACCOUNTS} currency="USD" rememberAs={{ entity: 'export' }} onSubmit={vi.fn()} />);
    expect(fieldProps.preferredAccountId).toBe('');
  });

  it('a fixed account (Mill Cash) needs no default and remembers nothing', async () => {
    rememberAccount({ currency: 'PKR', entity: 'mill', accountId: 3 });
    const onSubmit = vi.fn(async () => ({}));
    renderToStaticMarkup(<PaymentDrawer title="Pay" accounts={ACCOUNTS} currency="PKR" fixedAccountId={3} rememberAs={{ entity: 'mill' }}
      initial={{ amount: '10' }} onSubmit={onSubmit} />);
    expect(fieldProps.preferredAccountId).toBe('');
    expect(fieldProps.hideAccount).toBe(true);
  });

  it('remembers the account only after the submit succeeded', async () => {
    const ok = vi.fn(async () => ({ success: true }));
    renderToStaticMarkup(<PaymentDrawer title="Pay" accounts={ACCOUNTS} currency="PKR" rememberAs={{ entity: 'general' }}
      initial={{ bankAccountId: '1' }} defaultAmount="100" onSubmit={ok} />);
    await formEl().props.onSubmit({ preventDefault() {} });
    expect(ok).toHaveBeenCalledTimes(1);
    expect(readRememberedAccount({ currency: 'PKR', entity: 'general' })).toBe('1');

    localStorage.removeItem(STORAGE_KEY);
    const fail = vi.fn(async () => { throw new Error('refused'); });
    renderToStaticMarkup(<PaymentDrawer title="Pay" accounts={ACCOUNTS} currency="PKR" rememberAs={{ entity: 'general' }}
      initial={{ bankAccountId: '1' }} defaultAmount="100" onSubmit={fail} addToast={vi.fn()} />);
    await formEl().props.onSubmit({ preventDefault() {} });
    expect(readRememberedAccount({ currency: 'PKR', entity: 'general' })).toBe('');
  });

  it('cash routed by collection point uses no account, so none is remembered', async () => {
    const ok = vi.fn(async () => ({}));
    renderToStaticMarkup(<PaymentDrawer title="Receive" type="receipt" accounts={ACCOUNTS} currency="PKR" cashLocation rememberAs={{ entity: 'mill' }}
      requireAccountFor={() => false} initial={{ bankAccountId: '3', method: 'cash' }} defaultMethod="cash" defaultAmount="100" onSubmit={ok} />);
    await formEl().props.onSubmit({ preventDefault() {} });
    expect(ok).toHaveBeenCalledTimes(1);
    expect(readRememberedAccount({ currency: 'PKR', entity: 'mill' })).toBe('');
  });
});

describe('whose account default a payment uses (entity)', () => {
  it('follows the variant, the host, and the role', () => {
    expect(entityForPayment('receive_export', {})).toBe('export');
    expect(entityForPayment('receive_local_sale_line', {})).toBe('mill');
    expect(entityForPayment('receive_service', {})).toBe('mill');
    expect(entityForPayment('pay_payable', {})).toBe('general');
    expect(entityForPayment('pay_purchase', { entity: 'Export' })).toBe('export');
    expect(entityForPayment('pay_payable', { entity: 'general' }, { millOnly: true })).toBe('mill');
  });
});

describe('purchase entry points pre-fill the document', () => {
  it('Mill Store › Unpaid Purchases: due, purchase no., supplier, mill + cash from a cash account', () => {
    expect(millStorePurchaseCtx({ id: 8, purchase_no: 'MSP-8', total_amount: '1500.50', paid_amount: '500', supplier_name: 'Bag Co', supplier_id: 4 }))
      .toEqual({
        source: 'mill_store', sourceId: 8, currency: 'PKR', outstanding: 1000.5, ref: 'MSP-8',
        party: { type: 'supplier', id: 4, name: 'Bag Co' },
        entity: 'mill', defaultMethod: 'cash', filterAccountsByMethod: true,
      });
    expect(millStorePurchaseCtx({ id: 9, total_amount: 100, paid_amount: 150 }).outstanding).toBe(0);
  });
  it('Export order › Printed bags: outstanding (2 dp), PBO no., vendor, export + cash', () => {
    expect(printedBagOrderCtx({ id: 3, pbo_no: 'PBO-3', outstanding: '2499.999', vendor_name: 'Print Co', vendor_id: 6 }))
      .toEqual({
        source: 'printed_bag', sourceId: 3, currency: 'PKR', outstanding: 2500, ref: 'PBO-3',
        party: { type: 'supplier', id: 6, name: 'Print Co' }, entity: 'export', defaultMethod: 'cash',
      });
  });
});
