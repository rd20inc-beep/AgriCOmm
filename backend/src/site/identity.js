// Offline Stage 16b — pure identity extraction for site↔cloud reconciliation.
//
// A transaction created on the site box gets a LOCAL id + provisional doc number.
// When the worker replays it, the cloud assigns the FINAL id + official doc number and
// returns the created row in its response. These helpers pull those identifiers out of
// a controller response (works for both the site's own response — to learn the local
// ref — and the cloud's replay response — to learn the final ref), so the worker can
// record a local→cloud mapping. Pure + unit-tested; no row mutation happens here.

// Known doc-number columns across the transactional controllers. First match wins.
const DOC_NO_KEYS = [
  'sale_no', 'sale_group_no', 'invoice_no', 'batch_no', 'order_no', 'grn_no',
  'dispatch_no', 'payment_no', 'receipt_no', 'voucher_no', 'quotation_no', 'doc_no',
];

// The logical entity for a mapping = the first path segment after /api. e.g.
// '/api/local-sales/5/pay?x=1' → 'local-sales'. Returns null when not an /api path.
function deriveEntity(path) {
  if (!path) return null;
  const clean = String(path).split('?')[0];
  const m = clean.match(/^\/api\/([^/]+)/);
  return m ? m[1] : null;
}

// Pull the created row out of a { success, data } (or bare row) response body.
function pickRow(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) return body.data;
  return body;
}

// The numeric/primary id of the created row, if present.
function extractRef(body) {
  const row = pickRow(body);
  if (!row) return null;
  const id = row.id;
  return id === undefined || id === null ? null : id;
}

// The official doc number of the created row, if any known key is present.
function extractDocNo(body) {
  const row = pickRow(body);
  if (!row) return null;
  for (const k of DOC_NO_KEYS) {
    if (row[k]) return String(row[k]);
  }
  return null;
}

module.exports = { deriveEntity, extractRef, extractDocNo, DOC_NO_KEYS };
