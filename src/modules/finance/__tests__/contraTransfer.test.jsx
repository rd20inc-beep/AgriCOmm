import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  convertAmount, rateFromConverted, classifyTransfer, isCrossCurrency, validateContra,
  transferRowLabel, transferStatusLabel, foreignCurrency,
} from '../utils/contraTransfer';

/**
 * Contra Transfer drawer (owner decision 2026-10-08): money between the
 * company's own accounts. The drawer only reveals the exchange fields when the
 * two accounts hold different currencies; converted amount and rate drive each
 * other; the same account on both sides is blocked; the summary says the net
 * movement is zero (or names the PKR equivalent and the unbooked FX); a history
 * row reads "CONTRA · From → To".
 */
const ACCOUNTS = [
  { id: 1, name: 'HO Cash', type: 'cash', entity: 'general', currency: 'PKR', currentBalance: 1000000, isActive: true },
  { id: 2, name: 'HO Bank', type: 'bank', entity: 'general', currency: 'PKR', currentBalance: 0, isActive: true },
  { id: 3, name: 'USD Bank', type: 'bank', entity: 'general', currency: 'USD', currentBalance: 50000, isActive: true },
  { id: 4, name: 'Mill Cash', type: 'cash', entity: 'mill', currency: 'PKR', currentBalance: 9000, isActive: true },
  { id: 5, name: 'EUR Bank', type: 'bank', entity: 'general', currency: 'EUR', currentBalance: 100, isActive: true },
];
const byId = (id) => ACCOUNTS.find((a) => a.id === id);

vi.mock('../../../api/queries', () => ({
  useBankAccounts: () => ({ data: ACCOUNTS }),
  useCreateContraTransfer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReplaceFundTransfer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useContraRate: () => ({ data: { rate: 280, source: 'fx_rates' } }),
  useFundTransfer: () => ({ data: mockTransfer, isLoading: false }),
  useReverseFundTransfer: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
let mockTransfer = null;
vi.mock('../../../hooks/useConfirm', () => ({ default: () => [vi.fn(), null] }));
vi.mock('../../../api/client', () => ({ default: { upload: vi.fn() } }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: vi.fn() }) }));
vi.mock('../../../components/SlideDrawer', () => ({
  default: ({ children, footer, title }) => <div><h1>{title}</h1>{children}{footer}</div>,
}));

const { default: ContraTransferDrawer, ContraSummary } = await import('../components/ContraTransferDrawer');

const drawer = (editing) => renderToStaticMarkup(<ContraTransferDrawer open editing={editing} onClose={() => {}} />);
const editingOf = (from, to, extra = {}) => ({ id: 9, transferNo: 'FT-0009', fromAccountId: from, toAccountId: to, amount: 100, reference: 'R', ...extra });

describe('drawer — FX fields only when currencies differ', () => {
  it('a new transfer has no exchange fields and a read-only currency', () => {
    const html = drawer(null);
    expect(html).toContain('Contra Transfer');
    expect(html).not.toContain('data-testid="fx-fields"');
    expect(html).toMatch(/aria-label="Currency \(from the source account\)"[^>]*readonly|readonly[^>]*aria-label="Currency/i);
  });
  it('PKR → PKR: no exchange fields', () => {
    expect(drawer(editingOf(1, 2))).not.toContain('data-testid="fx-fields"');
  });
  it('USD → PKR: exchange rate + converted amount appear, with the not-booked note', () => {
    const html = drawer(editingOf(3, 1, { fxRate: 280, toAmount: 28000 }));
    expect(html).toContain('data-testid="fx-fields"');
    expect(html).toContain('Exchange rate (PKR per 1 USD)');
    expect(html).toContain('Converted amount (PKR)');
    expect(html).toContain('The FX difference is not booked');
  });
  it('the same account on both sides is flagged', () => {
    expect(drawer(editingOf(1, 1))).toContain('data-testid="same-account"');
  });
  it('Head Office → Mill explains it becomes a transfer awaiting acceptance', () => {
    const html = drawer(editingOf(1, 4));
    expect(html).toContain('data-testid="cross-entity-note"');
    expect(html).toContain('accepts');
  });
  it('accounts are grouped by entity and currency', () => {
    const html = drawer(null);
    expect(html).toContain('label="Head Office · PKR"');
    expect(html).toContain('label="Head Office · USD"');
    expect(html).toContain('label="Mill · PKR"');
  });
  it('editing asks for a reason', () => {
    const html = drawer(editingOf(1, 2));
    expect(html).toContain('Edit FT-0009');
    expect(html).toContain('Reason for the change');
  });
});

describe('converted amount ↔ rate', () => {
  it('foreign → PKR multiplies; PKR → foreign divides', () => {
    expect(convertAmount(10000, 280, 'USD', 'PKR')).toBe(2800000);
    expect(convertAmount(2800000, 280, 'PKR', 'USD')).toBe(10000);
    expect(convertAmount(500, '', 'PKR', 'PKR')).toBe(500);
    expect(Number.isNaN(convertAmount(10, '', 'USD', 'PKR'))).toBe(true);
  });
  it('typing the converted amount back-computes the rate (and round-trips)', () => {
    const r = rateFromConverted(10000, 2801234.56, 'USD', 'PKR');
    expect(r).toBe(280.123456);
    expect(convertAmount(10000, r, 'USD', 'PKR')).toBe(2801234.56);
    expect(rateFromConverted(2800000, 10000, 'PKR', 'USD')).toBe(280);
  });
  it('the rate is quoted for the foreign side', () => {
    expect(foreignCurrency('USD', 'PKR')).toBe('USD');
    expect(foreignCurrency('PKR', 'USD')).toBe('USD');
    expect(foreignCurrency('PKR', 'PKR')).toBe(null);
  });
});

describe('validation before submit', () => {
  const base = { amount: 100, reference: 'R1' };
  it('blocks the same account, missing fields and over-balance amounts', () => {
    expect(classifyTransfer(byId(1), byId(1))).toBe('same');
    expect(validateContra({ ...base, fromAcct: byId(1), toAcct: byId(1) }).to).toMatch(/different accounts/);
    expect(validateContra({ fromAcct: byId(1), toAcct: byId(2), amount: 0, reference: '' })).toMatchObject({
      amount: expect.any(String), reference: expect.any(String),
    });
    expect(validateContra({ ...base, fromAcct: byId(2), toAcct: byId(1) }).amount).toMatch(/available/);
    // On an edit the original comes back first.
    expect(validateContra({ ...base, fromAcct: byId(2), toAcct: byId(1), returning: 100 }).amount).toBeUndefined();
  });
  it('needs a rate across currencies; refuses two foreign currencies and FX across entities', () => {
    expect(isCrossCurrency(byId(3), byId(1))).toBe(true);
    expect(validateContra({ ...base, fromAcct: byId(3), toAcct: byId(1) }).rate).toBeTruthy();
    expect(validateContra({ ...base, fromAcct: byId(3), toAcct: byId(1), rate: 280, converted: 28000 })).toEqual({});
    expect(validateContra({ ...base, fromAcct: byId(3), toAcct: byId(5), rate: 1 }).to).toMatch(/isn't supported/);
    expect(validateContra({ ...base, fromAcct: byId(3), toAcct: byId(4), rate: 280, converted: 1 }).to).toMatch(/PKR only/);
  });
});

describe('pre-confirm summary', () => {
  it('same currency: net internal movement is zero', () => {
    const html = renderToStaticMarkup(<ContraSummary fromAcct={byId(1)} toAcct={byId(2)} amount={500000} converted={500000} charges={0} kind="internal" fx={false} />);
    expect(html).toContain('Net internal movement');
    expect(html).toContain('PKR 0');
    expect(html).toContain('HO Cash');
    expect(html).toContain('HO Bank');
    expect(html).toContain('Rs 500,000.00');
  });
  it('FX: names the PKR equivalent and the unbooked difference; shows the charges as an expense', () => {
    const html = renderToStaticMarkup(<ContraSummary fromAcct={byId(3)} toAcct={byId(1)} amount={10000} converted={2800000} charges={5} rate={280} kind="internal" fx pkrEquivalent={2800000} />);
    expect(html).toContain('PKR equivalent moves between your accounts');
    expect(html).toContain('FX difference not booked — review');
    expect(html).toContain('Rs 2,800,000.00');
    expect(html).toMatch(/\$5\.00.*expense \(6200\)/);
    expect(html).not.toContain('Net internal movement');
  });
  it('Head Office → Mill says it waits for acceptance', () => {
    const html = renderToStaticMarkup(<ContraSummary fromAcct={byId(1)} toAcct={byId(4)} amount={10} converted={10} charges={0} kind="cross_entity" fx={false} />);
    expect(html).toContain('waits for the Mill to accept it');
  });
});

describe('transfer detail drawer', () => {
  const base = {
    id: 12, transferNo: 'FT-0012', direction: 'internal', status: 'completed', fromEntity: 'general', toEntity: 'general',
    fromAccountName: 'USD Bank', toAccountName: 'HO Cash', amount: '10000.00', currency: 'USD', toAmount: '2800000.00', toCurrency: 'PKR',
    fxRate: '280.000000', rateBasis: 'USD→PKR @ 280 on 2026-10-08 (manual)', amountPkr: '2800000.00', fxUnbooked: true,
    bankCharges: '5.00', reference: 'TT-77', createdByName: 'Asma', createdAt: '2026-10-08T07:00:00Z', replacesId: 11, replacesTransferNo: 'FT-0011',
    bankTransactions: [
      { id: 1, transactionNo: 'BT-0001', accountName: 'USD Bank', type: 'debit', amount: '10000', currency: 'USD', category: 'Contra Transfer' },
      { id: 2, transactionNo: 'BT-0002', accountName: 'HO Cash', type: 'credit', amount: '2800000', currency: 'PKR', category: 'Contra Transfer' },
    ],
    journals: [],
  };
  const render = async (t, canManage) => {
    mockTransfer = t;
    const { default: Detail } = await import('../components/FundTransferDetailDrawer');
    return renderToStaticMarkup(<Detail open transferId={t.id} canManage={canManage} onClose={() => {}} />);
  };
  it('shows both sides, the rate basis, the FX flag, charges and the replaced link; Edit/Reverse for managers', async () => {
    const html = await render(base, true);
    expect(html).toContain('FT-0012 · Contra');
    expect(html).toContain('−$10,000.00');
    expect(html).toContain('+Rs 2,800,000.00');
    expect(html).toContain('USD→PKR @ 280 on 2026-10-08');
    expect(html).toContain('FX difference not booked — review');
    expect(html).toContain('bank charges $5.00');
    expect(html).toContain('FT-0011');
    expect(html).toContain('BT-0002');
    expect(html).toContain('an internal transfer posts no journal');
    expect(html).toContain(' Edit</button>');
    expect(html).toContain(' Reverse</button>');
  });
  it('a reversed transfer shows who reversed it and why, with no actions', async () => {
    const html = await render({ ...base, status: 'reversed', reversedByName: 'Owner A', reversedAt: '2026-10-08T09:00:00Z', reversalReason: 'wrong bank', replacedById: 13, replacedByTransferNo: 'FT-0013' }, true);
    expect(html).toContain('Owner A');
    expect(html).toContain('wrong bank');
    expect(html).toContain('FT-0013');
    expect(html).not.toContain(' Edit</button>');
    expect(html).not.toContain(' Reverse</button>');
  });
});

describe('history row label', () => {
  it('contra rows read CONTRA · From → To', () => {
    expect(transferRowLabel({ ftDirection: 'internal', ftFromAccountName: 'HO Cash', ftToAccountName: 'HO Bank', category: 'Contra Transfer' }))
      .toBe('CONTRA · HO Cash → HO Bank');
    expect(transferRowLabel({ ftDirection: 'internal', ftFromAccountName: 'A', ftToAccountName: 'B', category: 'Bank Charges' }))
      .toBe('CONTRA · A → B · bank charges');
    expect(transferRowLabel({ ftDirection: 'ho_to_mill', ftFromAccountName: 'HO Bank', ftToAccountName: 'Mill Cash', category: 'Fund Transfer Reversal' }))
      .toBe('HO → MILL · HO Bank → Mill Cash · reversal');
    expect(transferRowLabel({ category: 'expense' })).toBe(null);
  });
  it('status labels', () => {
    expect(transferStatusLabel({ status: 'completed', direction: 'internal' })).toBe('Completed');
    expect(transferStatusLabel({ status: 'completed', direction: 'ho_to_mill' })).toBe('Received');
    expect(transferStatusLabel({ status: 'reversed', direction: 'internal' })).toBe('Reversed');
  });
});
