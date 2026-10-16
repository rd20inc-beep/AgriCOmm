import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * P2-31: the statement Pay drawer settles a party's invoices with ONE request
 * to POST /finance/settle (one server transaction — all or nothing), not one
 * request per invoice; the Mill → Head Office drawer uses the contra endpoint
 * because the legacy POST /finance/fund-transfers is retired.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const post = vi.fn(async () => ({}));
vi.mock('../../../api/client', () => ({ default: { post, get: vi.fn() } }));
const { financeApi } = await import('../api/services');

describe('one settle request', () => {
  it('posts the whole allocation to /api/finance/settle', async () => {
    const body = { type: 'payment', allocations: [{ payable_id: 1, amount: 5 }, { payable_id: 2, amount: 7 }] };
    await financeApi.settleAcross(body);
    expect(post).toHaveBeenCalledWith('/api/finance/settle', body);
  });

  it('the statement drawer makes a single settle call and no per-invoice loop', () => {
    const src = readFileSync(resolve(HERE, '../components/StatementPayDrawer.jsx'), 'utf8');
    expect(src.match(/settleMut\.mutateAsync\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/recordPaymentMut|acceptLocalSaleMut/);
    expect(src).not.toMatch(/for \(const \{ item, chunk \} of allocation\)/);
    expect(src).toMatch(/sale_group_no: item\.saleGroupNo/);
  });

  it('the legacy fund-transfer create is gone from the client', () => {
    expect(financeApi.createFundTransfer).toBeUndefined();
    // W08–W10: TransferFundsDrawer is the one transfer flow (ContraTransferDrawer, locked direction).
    const wrapper = readFileSync(resolve(HERE, '../components/TransferFundsDrawer.jsx'), 'utf8');
    expect(wrapper).toMatch(/<ContraTransferDrawer/);
    const drawer = readFileSync(resolve(HERE, '../components/ContraTransferDrawer.jsx'), 'utf8');
    expect(drawer).toMatch(/useCreateContraTransfer/);
  });
});
