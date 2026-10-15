import { describe, it, expect, vi } from 'vitest';
import { fetchAllPages, fetchPageOrAll } from '../fetchAllPages';

// A fake paged endpoint over `rows`, clamping a page to 200 like pagination.js,
// ordered favorites-first then by name (the master-data contract).
function pagedApi(rows, key = 'customers') {
  const sorted = [...rows].sort((a, b) => (b.is_favorite - a.is_favorite) || a.name.localeCompare(b.name) || a.id - b.id);
  return vi.fn(async ({ page = 1, limit = 50 } = {}) => {
    const lim = Math.min(200, limit);
    const start = (page - 1) * lim;
    return { success: true, data: { [key]: sorted.slice(start, start + lim), pagination: { page, limit: lim, total: sorted.length } } };
  });
}

const parties = Array.from({ length: 450 }, (_, i) => ({
  id: i + 1, name: `Party ${String(i + 1).padStart(4, '0')}`, is_favorite: i === 449 ? 1 : 0,
}));

describe('fetchAllPages (P4-11)', () => {
  it('returns every row past the 200 cap, with the server total', async () => {
    const api = pagedApi(parties);
    const all = await fetchAllPages(api, { type: 'local' }, 'customers');
    expect(all).toHaveLength(450);
    expect(all.listTotal).toBe(450);
    expect(new Set(all.map((r) => r.id)).size).toBe(450);
    expect(api).toHaveBeenCalledTimes(3);
    expect(api.mock.calls[0][0]).toMatchObject({ type: 'local', page: 1, limit: 200 });
  });

  it('keeps favorites first across pages — the starred 450th party leads', async () => {
    const all = await fetchAllPages(pagedApi(parties), {}, 'customers');
    expect(all[0].id).toBe(450);
    expect(all.find((r) => r.name === 'Party 0001')).toBeTruthy(); // the oldest is findable
  });

  it('an unpaged endpoint (no total) is read once', async () => {
    const api = vi.fn(async () => ({ data: { product_categories: Array.from({ length: 200 }, (_, i) => ({ id: i })) } }));
    const all = await fetchAllPages(api, {}, 'product_categories');
    expect(all).toHaveLength(200);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('fetchPageOrAll reads one page when a page or limit is asked for', async () => {
    const api = pagedApi(parties);
    const page = await fetchPageOrAll(api, { limit: 50 }, 'customers');
    expect(page).toHaveLength(50);
    expect(page.listTotal).toBe(450);
    const all = await fetchPageOrAll(api, {}, 'customers');
    expect(all).toHaveLength(450);
  });
});
