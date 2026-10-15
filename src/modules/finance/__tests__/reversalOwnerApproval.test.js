import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * P2-19 / owner decision D-3: a payment reversal carries its reason and the
 * authorizing Owner. The Owner's password rides as X-Owner-Credential
 * (OwnerAuthContext → withOwnerCredential), never in the body.
 */
const post = vi.fn(async () => ({}));
vi.mock('../../../api/client', () => ({ default: { post, get: vi.fn() } }));

const { financeApi } = await import('../api/services');

describe('payment reversal needs the Owner (D-3)', () => {
  it('sends the reason and the authorizing owner id', async () => {
    await financeApi.reversePayment(5, 'duplicate', 9);
    expect(post).toHaveBeenCalledWith('/api/finance/payments/5/reverse', { reason: 'duplicate', authorized_by_owner_id: 9 });
  });

  it('the Transaction drawer reverses only through requestOwnerApproval, with a required reason', () => {
    const src = readFileSync(resolve(HERE, '../drawers/TransactionDrawer.jsx'), 'utf8');
    expect(src).toMatch(/requestOwnerApproval\(\(ownerId\) => reverseMut\.mutateAsync\(\{ id: p\.id, reason: ok\.reason \|\| null, ownerId \}\)\)/);
    expect(src).toMatch(/reason: 'required'/);
  });
});
