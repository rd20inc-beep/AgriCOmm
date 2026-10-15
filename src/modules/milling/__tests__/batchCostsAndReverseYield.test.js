import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * P3-07 / MIL-35: the Costs drawer saves in ONE request (one server
 * transaction). P3-03 / MIL-20: a yield is reversed only through the Owner
 * modal, with a reason. MIL-11: the drawer's raw-rice key is the canonical one.
 */
const post = vi.fn(async () => ({}));
vi.mock('../../../api/client', () => ({ default: { post, get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const { millingApi } = await import('../api/services');

describe('milling batch cost + yield-reversal API', () => {
  it('saves the whole cost sheet to the bulk endpoint', async () => {
    await millingApi.saveCosts(7, { costs: [{ category: 'raw_rice', amount: 10 }] });
    expect(post).toHaveBeenCalledWith('/api/milling/batches/7/costs/bulk', { costs: [{ category: 'raw_rice', amount: 10 }] });
  });

  it('reverses a yield with the reason and the authorizing owner', async () => {
    await millingApi.reverseYield(7, { reason: 'scale error', authorized_by_owner_id: 9 });
    expect(post).toHaveBeenCalledWith('/api/milling/batches/7/reverse-yield', { reason: 'scale error', authorized_by_owner_id: 9 });
  });

  it('the batch page saves costs in one call and reverses only through requestOwnerApproval', () => {
    const src = readFileSync(resolve(HERE, '../pages/MillingBatchDetail.jsx'), 'utf8');
    expect(src).toMatch(/saveCostsMut\.mutateAsync\(\{ id: batchId, data: \{ costs \} \}\)/);
    expect(src).not.toMatch(/addCostMut\.mutateAsync/);
    expect(src).toMatch(/requestOwnerApproval\(\(ownerId\) => reverseYieldMut\.mutateAsync/);
    expect(src).toMatch(/reason: 'required'/);
  });

  it('the raw-rice cost key is the canonical raw_rice', () => {
    const src = readFileSync(resolve(HERE, '../../../context/AppContext.jsx'), 'utf8');
    expect(src).toMatch(/\{ key: 'raw_rice', label: 'Raw Rice Purchase'/);
    expect(src).not.toMatch(/key: 'rawRice'/);
  });
});
