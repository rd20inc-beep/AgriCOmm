import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { overdraftWarning, serverOverdraft } from '../../../shared/utils/overdraft';

/**
 * B2 — overdraft is allowed with a warning: the shared Payment form says
 * "This will overdraw <account> by X" before submit and still lets it through.
 */
vi.mock('../../SlideDrawer', () => ({ default: ({ children, footer }) => <div>{children}{footer}</div> }));
vi.mock('../PaymentFields', () => ({ default: () => null }));
vi.mock('../PaymentHistory', () => ({ default: () => null }));
const { default: PaymentDrawer } = await import('../PaymentDrawer');

const ACCOUNTS = [
  { id: 3, name: 'Meezan', currency: 'PKR', currentBalance: 1000, type: 'bank' },
  { id: 4, name: 'USD Bank', currency: 'USD', currentBalance: 10, type: 'bank' },
  { id: 5, name: 'HO Bank (hidden)', currency: 'PKR', currentBalance: null, type: 'bank' },
];
const render = (props) => renderToStaticMarkup(
  <PaymentDrawer title="Pay" accounts={ACCOUNTS} onClose={() => {}} onSubmit={async () => {}} {...props} />,
);

describe('overdraftWarning', () => {
  it('warns only below zero, in the account\'s own currency', () => {
    expect(overdraftWarning({ account: ACCOUNTS[0], amount: 1000 })).toBeNull();
    expect(overdraftWarning({ account: ACCOUNTS[0], amount: 1500.5 })).toMatchObject({ overdrawnBy: 500.5, balanceAfter: -500.5, currency: 'PKR' });
    expect(overdraftWarning({ account: ACCOUNTS[0], amount: 1500.5 }).message).toBe('This will overdraw Meezan by Rs 500.50.');
    expect(overdraftWarning({ account: ACCOUNTS[1], amount: 12 }).message).toBe('This will overdraw USD Bank by $2.00.');
    // A PKR figure is never compared with a USD balance.
    expect(overdraftWarning({ account: ACCOUNTS[1], amount: 12, currency: 'PKR' })).toBeNull();
    // A balance this role may not see: no warning.
    expect(overdraftWarning({ account: ACCOUNTS[2], amount: 1e9 })).toBeNull();
    expect(overdraftWarning({ account: null, amount: 5 })).toBeNull();
    expect(overdraftWarning({ account: ACCOUNTS[0], amount: 0 })).toBeNull();
  });
});

describe('<PaymentDrawer /> overdraft warning', () => {
  it('shows before submit when the net leaving the account is more than it holds; the submit stays enabled', () => {
    const html = render({ initial: { bankAccountId: '3' }, defaultAmount: '1500' });
    expect(html).toContain('data-testid="overdraft-warning"');
    expect(html).toContain('This will overdraw Meezan by Rs 500.00.');
    expect(html).not.toMatch(/type="submit"[^>]*disabled=""/);
  });

  it('within the balance, for a receipt, or for a cheque (moves nothing until it clears): no warning', () => {
    expect(render({ initial: { bankAccountId: '3' }, defaultAmount: '900' })).not.toContain('overdraft-warning');
    expect(render({ type: 'receipt', initial: { bankAccountId: '3' }, defaultAmount: '5000' })).not.toContain('overdraft-warning');
    expect(render({ initial: { bankAccountId: '3' }, defaultAmount: '5000', defaultMethod: 'cheque' })).not.toContain('overdraft-warning');
  });

  it('only the net after WHT and discount leaves the bank', () => {
    expect(render({ initial: { bankAccountId: '3', whtAmount: '400', discountAmount: '100' }, defaultAmount: '1500' })).not.toContain('overdraft-warning');
  });

  it('a fixed account is checked too', () => {
    expect(render({ fixedAccountId: 3, defaultAmount: '1200' })).toContain('This will overdraw Meezan by Rs 200.00.');
  });
});

// P2-31: every money route returns the overdraft warning; the drawer shows it.
describe('serverOverdraft', () => {
  it('reads the warning from any money response shape', () => {
    const w = { message: 'This overdraws Meezan by PKR 700.00.' };
    expect(serverOverdraft({ success: true, data: { payment: {}, warning: w } })).toBe(w.message);
    expect(serverOverdraft({ data: { transfer: {}, warning: w } })).toBe(w.message);
    expect(serverOverdraft({ data: { payments: [], overdraft: w } })).toBe(w.message);
    expect(serverOverdraft({ success: true, data: { payment: {} } })).toBeNull();
    expect(serverOverdraft(undefined)).toBeNull();
  });
});
