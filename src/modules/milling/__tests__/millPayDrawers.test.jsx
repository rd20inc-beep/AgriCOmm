import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * P5-11 — Mill Suppliers › Pay and Mill Customers › Receive open the one
 * Payment form under their invoice picker: the oldest open invoice is chosen,
 * its outstanding pre-filled (editable), the endpoint and body are the shared
 * variant's (the same endpoint each drawer always called), and nothing is
 * posted on open.
 */
let formProps = null;
vi.mock('../../../components/payments/PaymentFormDrawer', () => ({
  default: (props) => { formProps = props; return <div data-testid="payment-form">{props.banner}</div>; },
}));
vi.mock('../../../components/SlideDrawer', () => ({
  default: ({ children, title }) => <div data-title={title}>{children}</div>,
}));
const posted = [];
vi.mock('../../../api/client', () => ({ default: { post: vi.fn(async (u, b) => { posted.push([u, b]); return {}; }) } }));
let mockPayables = [];
let mockSales = [];
vi.mock('../../../api/queries', () => ({
  usePayables: () => ({ data: mockPayables }),
  useMillPayables: () => ({ data: mockPayables }),
  useLocalSales: () => ({ data: mockSales }),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock('../../../context/AppContext', () => ({
  useApp: () => ({ bankAccountsList: [
    { id: 1, name: 'HO Bank', type: 'bank', entity: 'general' },
    { id: 7, name: 'Mill Cash', type: 'cash', entity: 'mill' },
  ] }),
}));

const { default: MillSupplierPayDrawer } = await import('../components/MillSupplierPayDrawer');
const { default: MillCustomerPayDrawer } = await import('../components/MillCustomerPayDrawer');

beforeEach(() => { formProps = null; posted.length = 0; mockPayables = []; mockSales = []; });

describe('Mill Suppliers › Pay', () => {
  it('opens the shared form on the oldest open bill, paid from Mill Cash, nothing posted', () => {
    mockPayables = [
      { id: 12, dbId: 12, payNo: 'PAY-12', supplierId: 4, outstanding: 800, currency: 'PKR', dueDate: '2026-10-20', status: 'Pending' },
      { id: 10, dbId: 10, payNo: 'PAY-10', supplierId: 4, outstanding: 300, currency: 'PKR', dueDate: '2026-10-01', status: 'Partial' },
      { id: 11, dbId: 11, payNo: 'PAY-11', supplierId: 4, outstanding: 0, currency: 'PKR', status: 'Paid' },
      { id: 13, dbId: 13, payNo: 'PAY-13', supplierId: 5, outstanding: 50, currency: 'PKR', status: 'Pending' },
    ];
    const html = renderToStaticMarkup(<MillSupplierPayDrawer supplier={{ id: 4, name: 'Rice Co' }} onClose={() => {}} />);
    expect(formProps.variant).toBe('pay_payable');
    expect(formProps.ctx).toMatchObject({
      payableId: 10, outstanding: 300, currency: 'PKR', ref: 'PAY-10',
      party: { type: 'supplier', name: 'Rice Co' },
      entity: 'mill', methods: ['cash'], defaultMethod: 'cash', fixedAccountId: 7,
    });
    // The picker lists only this supplier's open bills.
    expect(html).toContain('PAY-10');
    expect(html).toContain('PAY-12');
    expect(html).not.toContain('PAY-11');
    expect(html).not.toContain('PAY-13');
    expect(html).toContain('Mill Cash');
    expect(posted).toEqual([]);
  });

  it('nothing open → says so, no form', () => {
    const html = renderToStaticMarkup(<MillSupplierPayDrawer supplier={{ id: 4, name: 'Rice Co' }} onClose={() => {}} />);
    expect(html).toContain('data-testid="no-open-invoices"');
    expect(formProps).toBeNull();
  });
});

describe('Mill Customers › Receive', () => {
  it('opens the shared local-sale form on the oldest open invoice, collected at the Mill by default', () => {
    mockSales = [
      { id: 21, saleNo: 'LS-21', dueAmount: 900, saleDate: '2026-10-05' },
      { id: 20, saleNo: 'LS-20', dueAmount: 250, saleDate: '2026-09-30' },
      { id: 22, saleNo: 'LS-22', dueAmount: 0, saleDate: '2026-09-01' },
    ];
    const html = renderToStaticMarkup(<MillCustomerPayDrawer customer={{ id: 3, name: 'Shop A' }} onClose={() => {}} />);
    expect(formProps.variant).toBe('receive_local_sale_line');
    expect(formProps.ctx).toMatchObject({
      saleId: 20, outstanding: 250, currency: 'PKR', ref: 'LS-20',
      party: { type: 'customer', id: 3, name: 'Shop A' },
      entity: 'mill', defaultMethod: 'cash', collectionLocation: 'Mill',
    });
    expect(html).toContain('LS-21');
    expect(html).not.toContain('LS-22');
    expect(posted).toEqual([]);
  });
});
