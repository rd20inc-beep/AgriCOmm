import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { permsFor } from '../../../test/fixtures/rolePermissions';

/**
 * P5-05 — UI follows the backend gates: PartyLink is plain text without the
 * statement permission; export-order header / financials / debit-note actions
 * show only to those who may run them. P5-13 — print header company profile.
 */

let mockRole = 'Owner';
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (m, a) => permsFor(mockRole)(m, a), isAuthenticated: true }),
}));
vi.mock('../../../context/OwnerAuthContext', () => ({ useOwnerAuth: () => ({ requestOwnerApproval: vi.fn() }) }));
vi.mock('../../../api/queries', () => ({
  useDebitNotes: () => ({ data: [], isLoading: false }),
  useIssueDebitNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelDebitNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../../modules/finance/drawers/OrderReceipts', () => ({ default: () => null }));
vi.mock('../../../modules/exportOrders/components/ShortBalanceWriteOff', () => ({ default: () => null }));

const { default: PartyLink } = await import('../PartyLink');
const { default: OrderHeader } = await import('../../../modules/exportOrders/components/OrderHeader');
const { default: FinancialsTab } = await import('../../../modules/exportOrders/components/FinancialsTab');
const { mergeCompanyProfile } = await import('../../hooks/useMasterData');

const as = (role, el) => { mockRole = role; return renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>); };
const actions = (html) => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);

describe('PartyLink', () => {
  const link = <PartyLink type="customer" id={3} name="Acme Foods" />;
  it('links for finance.view holders', () => {
    expect(as('Finance Manager', link)).toMatch(/<a [^>]*href="\/finance\/accounting\/statements\?type=customer&amp;id=3"/);
  });
  it('is plain text for a role without finance.view (no Access Denied bounce)', () => {
    const html = as('Documentation Officer', link);
    expect(html).toContain('Acme Foods');
    expect(html).not.toMatch(/<a |<button/);
  });
});

const order = {
  id: 'EX-1', dbId: 1, status: 'Shipped', customerName: 'Acme', customerId: 3, currency: 'USD',
  advanceExpected: 100, advanceReceived: 0, balanceExpected: 900, balanceReceived: 0,
};

describe('OrderHeader actions', () => {
  const header = (
    <OrderHeader order={order} formatCurrency={(n) => String(n)} showActions setShowActions={() => {}}
      onNavigateBack={() => {}} canConfirmAdvance canStartDocs canRequestBalance canCreateMilling
      canUpdateShipment canCloseOrder canCancel />
  );
  it('Owner sees every action', () => {
    expect(actions(as('Owner', header))).toEqual(['send-email', 'advance', 'start-docs', 'balance', 'milling', 'shipment', 'close', 'cancel', 'duplicate']);
  });
  it('Documentation Officer (view only) sees no order actions', () => {
    expect(actions(as('Documentation Officer', header))).toEqual([]);
    expect(as('Documentation Officer', header)).not.toContain('Quick Actions');
  });
  it('Finance Manager sees only the money actions', () => {
    expect(actions(as('Finance Manager', header))).toEqual(['advance', 'balance']);
  });
});

describe('FinancialsTab buttons', () => {
  const tab = (
    <FinancialsTab order={order} formatCurrency={(n) => String(n)} totalCosts={0} grossProfit={0} marginPct={0}
      onConfirmAdvance={() => {}} onRequestBalance={() => {}} onAddExpense={() => {}} canConfirmAdvance canRequestBalance
      exportCostCategories={[]} addToast={() => {}} />
  );
  it('Add Expense needs export_orders.edit; debit notes need confirm_balance/confirm_payment', () => {
    expect(actions(as('Export Manager', tab))).toEqual(expect.arrayContaining(['advance', 'balance', 'add-expense']));
    const fm = actions(as('Finance Manager', tab));
    expect(fm).toEqual(expect.arrayContaining(['advance', 'balance']));
    expect(fm).not.toContain('add-expense');
    const ro = as('Read-Only Auditor', tab);
    expect(actions(ro)).toEqual([]);
    expect(ro).not.toContain('Raise');
  });
});

describe('company profile for print headers', () => {
  it('saved letterhead fields override the defaults; missing ones keep them', () => {
    const p = mergeCompanyProfile({ name: 'Configured Co', phone: null });
    expect(p.name).toBe('Configured Co');
    expect(p.phone).toBeTruthy();
    expect(mergeCompanyProfile(undefined).name).toBeTruthy();
  });
});
