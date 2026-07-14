// Resolve a scanned/entered code to an in-app navigation target (Stage 14).
// Pure + testable. The QR codes we generate encode an app path or an
// `agrice://<kind>/<id>` deep link, so scans resolve directly; navigating to the
// target renders from the local replica, so it works offline.
const DEEP_LINK_MAP = {
  lot: '/lot-inventory',
  batch: '/milling',
  'service-milling': '/service-milling',
  order: '/export',
  sale: '/local-sales',
};

export function resolveScan(raw) {
  if (!raw) return { ok: false, error: 'Empty code' };
  let s = String(raw).trim();

  // A full URL to our app → use its path.
  if (/^https?:\/\//i.test(s)) {
    try { const u = new URL(s); s = u.pathname + (u.search || ''); } catch { /* not a URL */ }
  }

  // App deep link: agrice://<kind>/<id>
  const deep = s.match(/^agrice:\/\/([\w-]+)\/(.+)$/i);
  if (deep) {
    const base = DEEP_LINK_MAP[deep[1].toLowerCase()];
    if (base) return { ok: true, path: `${base}/${encodeURIComponent(deep[2])}`, label: `${deep[1]} ${deep[2]}` };
    return { ok: false, error: `Unknown link type: ${deep[1]}` };
  }

  // Already an app path.
  if (s.startsWith('/')) return { ok: true, path: s, label: s };

  // Bare milling batch number (the /milling route accepts a batch_no).
  if (/^M-\d+/i.test(s)) return { ok: true, path: `/milling/${s.toUpperCase()}`, label: `Batch ${s.toUpperCase()}` };

  return { ok: false, error: `Unrecognized code: ${s}` };
}

// Build a deep link for a record (used when rendering a scannable QR on a label).
export function deepLink(kind, id) {
  return `agrice://${kind}/${id}`;
}
