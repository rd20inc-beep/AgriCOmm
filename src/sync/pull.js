// Sync PULL (Stage 6a) — pull incremental deltas for a domain from the server and
// write them into the LocalDB `records` store (id namespaced `${domain}:${rowId}`),
// advancing the per-domain watermark stored in LocalDB meta. Nothing auto-runs yet;
// the background scheduler wires these in a later stage.
import { getLocalDb } from '../data/localdb';
import { getDeviceId, syncPost } from './device';

const wmKey = (domain) => `sync_wm:${domain}`;

// Pull ONE page. Returns { count, hasMore, watermark }.
export async function pullDomainPage(domain) {
  const db = await getLocalDb();
  const device_uuid = getDeviceId();
  const since = await db.getMeta(wmKey(domain));

  const { rows = [], watermark, hasMore } = await syncPost('/pull', { device_uuid, domain, since });

  if (rows.length) {
    await db.bulkPut('records', rows.map((r) => ({
      id: `${domain}:${r.id}`, collection: domain, data: r, updatedAt: new Date().toISOString(),
    })));
  }
  if (watermark) await db.setMeta(wmKey(domain), watermark);

  return { count: rows.length, hasMore: !!hasMore, watermark };
}

// Pull all pages for a domain until caught up (bounded to avoid runaway loops).
export async function pullDomain(domain, maxPages = 50) {
  let total = 0;
  let pages = 0;
  let hasMore = true;
  while (hasMore && pages < maxPages) {
    const r = await pullDomainPage(domain);
    total += r.count;
    hasMore = r.hasMore;
    pages += 1;
    if (r.count === 0) break;
  }
  return { domain, total, pages };
}

// Read a pulled domain's rows back out of the local replica.
export async function localRecords(domain) {
  const db = await getLocalDb();
  const all = await db.list('records');
  return all.filter((x) => x.collection === domain).map((x) => x.data);
}
