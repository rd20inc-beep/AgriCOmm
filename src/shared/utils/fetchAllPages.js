// Lists the server pages (customers, suppliers, products, orders, batches,
// mill-store items…). A single page used to be read as "the whole list", so the
// 201st customer or the oldest order silently dropped out of every picker
// (P4-11). This walks every page the server reports, keeping the server's
// order — favorites-first for parties, so a starred row is never lost to the
// LIMIT and client sorting never has to recover it.

export const ALL_PAGE_SIZE = 200; // the server's per-page clamp (pagination.js)
const PARALLEL = 4;

const dataOf = (res) => res?.data?.data || res?.data || res || {};

/** Attach the server's match count to an array without changing its shape. */
export function attachListTotal(arr, total) {
  const t = Number(total);
  if (Array.isArray(arr) && Number.isFinite(t)) {
    Object.defineProperty(arr, 'listTotal', { value: t, enumerable: false, configurable: true });
  }
  return arr;
}

/** True when the caller asked for one specific page rather than everything. */
export const wantsOnePage = (params = {}) => params.page != null || params.limit != null;

/**
 * Every row matching `params`, page by page.
 *   list(params) → the API response; key = the array's key in data.
 * The returned array carries `listTotal` (the server's count). An endpoint
 * that reports no total is unpaged: its one response is the whole list.
 */
export async function fetchAllPages(list, params = {}, key, { pageSize = ALL_PAGE_SIZE } = {}) {
  const read = (res) => {
    const d = dataOf(res);
    const rows = Array.isArray(d?.[key]) ? d[key] : [];
    const total = parseInt(d?.pagination?.total, 10);
    return { rows, total: Number.isFinite(total) ? total : null };
  };
  const first = read(await list({ ...params, page: 1, limit: pageSize }));
  const all = [...first.rows];
  if (first.total != null) {
    const pages = Math.ceil(first.total / pageSize);
    for (let p = 2; p <= pages; p += PARALLEL) {
      const batch = [];
      for (let q = p; q < p + PARALLEL && q <= pages; q += 1) batch.push(list({ ...params, page: q, limit: pageSize }));
      (await Promise.all(batch)).forEach((res) => all.push(...read(res).rows));
    }
    return attachListTotal(all, first.total);
  }
  // No total reported: the endpoint is not paged (it ignores page/limit and
  // returns everything), so walking on would only repeat the same rows.
  return attachListTotal(all, all.length);
}

/** One page (with listTotal) when the caller asked for one, else every page. */
export async function fetchPageOrAll(list, params = {}, key, opts) {
  if (!wantsOnePage(params)) return fetchAllPages(list, params, key, opts);
  const res = await list(params);
  const d = dataOf(res);
  return attachListTotal(Array.isArray(d?.[key]) ? d[key] : [], d?.pagination?.total);
}
