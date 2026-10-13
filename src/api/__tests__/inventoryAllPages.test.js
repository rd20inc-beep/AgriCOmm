import { describe, test, expect, vi } from 'vitest';
import { fetchAllInventory } from '../queries';

// A fake /api/inventory: `total` lots, newest first, paged by limit/page.
const fakeList = (total) => vi.fn(async ({ limit, page = 1 }) => {
  const start = (page - 1) * limit;
  const lots = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => ({ id: total - start - i, lot_no: `L${total - start - i}` }));
  return { data: { lots, pagination: { total, page, limit } } };
});

describe('useInventory reads every lot, not the newest page', () => {
  test('2,350 lots come back in full, oldest included', async () => {
    const list = fakeList(2350);
    const lots = await fetchAllInventory({ entity: 'mill' }, list);
    expect(lots).toHaveLength(2350);
    expect(lots.at(-1)).toMatchObject({ id: 1, lotNo: 'L1' });
    expect(list).toHaveBeenCalledTimes(3);
    expect(list.mock.calls[0][0]).toMatchObject({ entity: 'mill', page: 1 });
  });

  test('a short list is one request', async () => {
    const list = fakeList(40);
    expect(await fetchAllInventory({}, list)).toHaveLength(40);
    expect(list).toHaveBeenCalledTimes(1);
  });

  test('an explicit limit reads just that page', async () => {
    const list = fakeList(2350);
    expect(await fetchAllInventory({ limit: 5000, in_stock: 1 }, list)).toHaveLength(2350);
    expect(list).toHaveBeenCalledTimes(1);
  });

  test('exactly one full page stops on the total', async () => {
    const list = fakeList(1000);
    expect(await fetchAllInventory({}, list)).toHaveLength(1000);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
