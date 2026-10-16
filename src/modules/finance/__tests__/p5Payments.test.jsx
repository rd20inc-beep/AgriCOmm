import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { docForOpenItem, settleActionForOpenItem } from '../utils/openItemSettle';

/**
 * Phase 5 payments: Pay / Receive on a statement's open items (W02/W03), the
 * reconciliation review before clearing (W18), and the export order header's
 * receipt wording + outstanding (W06/W07).
 */
const allow = (...p) => (m, a) => p.includes(`${m}.${a}`);

describe('W02/W03 — statement open item → the Payment form', () => {
  const receivables = [
    { id: 1, dbId: 1, recvNo: 'RCV-1', customerId: 3, customerName: 'Buyer', currency: 'USD', outstanding: 500, status: 'Partial', orderId: null },
    { id: 2, dbId: 2, recvNo: 'RCV-2', customerId: 3, currency: 'USD', outstanding: 0, status: 'Paid' },
    { id: 3, dbId: 3, recvNo: 'RCV-3', customerId: 9, currency: 'USD', outstanding: 10, status: 'Pending' },
  ];
  const payables = [
    { id: 10, dbId: 10, payNo: 'PAY-10', linkedRef: 'LOT-7', supplierId: 4, supplierName: 'Rice Co', currency: 'PKR', outstanding: 900, status: 'Pending' },
    { id: 11, dbId: 11, payNo: 'PAY-11', linkedRef: 'LOT-8', supplierId: 4, supplierName: 'Rice Co', currency: 'PKR', outstanding: 100, status: 'Pending' },
    { id: 12, dbId: 12, payNo: 'PAY-12', linkedRef: 'LOT-8', supplierId: 4, supplierName: 'Rice Co', currency: 'PKR', outstanding: 50, status: 'Pending' },
    { id: 'MC-5', payNo: 'MC-5', supplierId: 4, supplierName: 'Rice Co', currency: 'PKR', outstanding: 70, status: 'Pending' },
  ];

  it('a customer open item resolves to its receivable, with the outstanding to pre-fill', () => {
    const doc = docForOpenItem({ ref: 'RCV-1' }, { mode: 'customer', receivables, partyId: 3 });
    expect(doc).toEqual({ docKind: 'receivable', row: receivables[0] });
  });

  it('a paid item, another party\'s item, or an unknown ref gets no button', () => {
    expect(docForOpenItem({ ref: 'RCV-2' }, { mode: 'customer', receivables, partyId: 3 })).toBeNull();
    expect(docForOpenItem({ ref: 'RCV-3' }, { mode: 'customer', receivables, partyId: 3 })).toBeNull();
    expect(docForOpenItem({ ref: 'NOPE' }, { mode: 'customer', receivables, partyId: 3 })).toBeNull();
  });

  it('a supplier item resolves by its lot reference or bill no — but never guesses between two bills', () => {
    expect(docForOpenItem({ ref: 'LOT-7' }, { mode: 'supplier', payables, partyId: 4 })?.row.id).toBe(10);
    expect(docForOpenItem({ ref: 'PAY-11' }, { mode: 'supplier', payables, partyId: 4 })?.row.id).toBe(11);
    expect(docForOpenItem({ ref: 'LOT-8' }, { mode: 'supplier', payables, partyId: 4 })).toBeNull();
    // A cost-derived payable has no stored row to settle.
    expect(docForOpenItem({ ref: 'MC-5' }, { mode: 'supplier', payables, partyId: 4 })).toBeNull();
  });

  it('only for a role the payment route admits', () => {
    const opts = { mode: 'supplier', payables, partyId: 4 };
    expect(settleActionForOpenItem({ ref: 'LOT-7' }, opts, allow('finance.confirm_payment'))).not.toBeNull();
    expect(settleActionForOpenItem({ ref: 'LOT-7' }, opts, allow('milling.edit'))).not.toBeNull();
    expect(settleActionForOpenItem({ ref: 'LOT-7' }, opts, allow('finance.view'))).toBeNull();
  });
});

describe('the open-items panel shows the action only when the host provides one', async () => {
  const { default: OpenItemsPanel } = await import('../../milling/components/OpenItemsPanel');
  const items = [{ ref: 'RCV-1', label: 'advance', outstanding: 500, currency: 'USD' }, { ref: 'RCV-9', label: 'balance', outstanding: 5, currency: 'USD' }];
  it('Receive on the settleable row only; no column without a host action', () => {
    const html = renderToStaticMarkup(<OpenItemsPanel items={items} partyType="customer"
      actionFor={(i) => (i.ref === 'RCV-1' ? { label: 'Receive', onClick: () => {} } : null)} />);
    expect(html.match(/data-action="open-item-settle"/g)).toHaveLength(1);
    expect(html).toContain('>Receive</button>');
    expect(renderToStaticMarkup(<OpenItemsPanel items={items} partyType="customer" />)).not.toContain('open-item-settle');
  });
});

describe('W18 — the reconciliation review before clearing', async () => {
  vi.mock('../../../api/queries', () => ({ useBankAccounts: () => ({ data: [], isLoading: false }) }));
  vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: () => {} }) }));
  // OrderHeader gates each action on the backend's permission (P5-05).
  vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
  const { CompleteReview } = await import('../pages/BankReconciliation');
  const money = (v) => `Rs ${Number(v).toFixed(2)}`;
  const fig = { count: 3, tickedIn: 25000, tickedOut: 3000, cleared: 22000, difference: 0, balanced: true };

  it('lists what is about to be cleared and asks for an explicit confirm', () => {
    const html = renderToStaticMarkup(<CompleteReview account={{ name: 'HO Bank' }} statementDate="2026-10-15" fig={fig}
      statementBalance={22000} money={money} unsaved busy={false} onBack={() => {}} onConfirm={() => {}} />);
    expect(html).toContain('data-testid="recon-complete-review"');
    expect(html).toContain('Transactions to clear');
    expect(html).toContain('>3<');
    expect(html).toContain('Rs 22000.00');
    expect(html).toContain('unsaved ticks are saved first');
    expect(html).toContain('data-action="confirm-complete-reconciliation"');
    expect(html).toContain('data-action="review-back"');
  });

  it('cannot be confirmed unless the difference is 0', () => {
    const html = renderToStaticMarkup(<CompleteReview account={{ name: 'HO Bank' }} statementDate="2026-10-15" fig={{ ...fig, difference: 5, balanced: false }}
      statementBalance={22005} money={money} unsaved={false} busy={false} onBack={() => {}} onConfirm={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-action="confirm-complete-reconciliation"/);
  });
});

describe('W06/W07 — export order header', async () => {
  const { default: OrderHeader } = await import('../../exportOrders/components/OrderHeader');
  const { orderOutstanding } = await import('../../exportOrders/utils/orderOutstanding');
  const order = {
    id: 'EX-9', status: 'Awaiting Advance', customerName: 'Buyer', qtyMT: 20, country: 'UAE', contractValue: 10000,
    advanceExpected: 3000, advanceReceived: 1000, balanceExpected: 7000, balanceReceived: 0,
  };

  it('outstanding = (advance + balance) expected − received; none for a draft or cancelled order', () => {
    expect(orderOutstanding(order)).toBe(9000);
    expect(orderOutstanding({ ...order, advanceReceived: 3500 })).toBe(7000); // an over-received leg never offsets the other
    expect(orderOutstanding({ ...order, status: 'Draft' })).toBeNull();
    expect(orderOutstanding({ ...order, status: 'Cancelled' })).toBeNull();
  });

  it('shows the outstanding on the header and says "Record … Receipt" for the form it opens', () => {
    const html = renderToStaticMarkup(
      <OrderHeader order={order} formatCurrency={(v) => `$${v}`} showActions setShowActions={() => {}}
        canConfirmAdvance canRequestBalance />,
    );
    expect(html).toContain('data-testid="order-outstanding"');
    expect(html).toContain('Outstanding: $9000');
    expect(html).toContain('Record Advance Receipt');
    expect(html).toContain('Record Balance Receipt');
    expect(html).not.toMatch(/Confirm Advance/);
  });
});
