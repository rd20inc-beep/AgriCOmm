// Offline Stage 16 — decide which requests the site backend should capture for
// replay UP to the cloud. Pure + unit-tested, so the rule is auditable in one place.
//
// We only replay BUSINESS mutations. Auth/sync/streams are per-instance and must not
// be replayed; reads change nothing; and file uploads / AI / search / exports are
// either not durable state or not something the cloud needs re-run.
const crypto = require('crypto');

const RECORDABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Path prefixes (after /api) that must NEVER be replayed to the cloud.
const EXCLUDED_PREFIXES = [
  '/api/auth',      // login/refresh — the worker has its own cloud credential
  '/api/portal',    // employee self-service — portal-scoped tokens
  '/api/streams',   // SSE (per-instance)
  '/api/sync',      // sync plumbing itself (would loop)
  '/api/ai',        // NL→SQL analysis — read-only, not durable state
  '/api/smart',
  '/api/intelligence',
  '/api/reporting', // report generation — read-only
];

// Substrings that mark a non-durable / read-only action even under a business route.
const EXCLUDED_SUBSTRINGS = ['/search', '/preview', '/export', '/download', '/print', '/upload'];

function stripQuery(path) {
  const q = path.indexOf('?');
  return q === -1 ? path : path.slice(0, q);
}

function isRecordableRequest(method, rawPath) {
  if (!method || !rawPath) return false;
  if (!RECORDABLE_METHODS.has(String(method).toUpperCase())) return false;
  const path = stripQuery(String(rawPath));
  if (!path.startsWith('/api/')) return false;
  if (EXCLUDED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return false;
  if (EXCLUDED_SUBSTRINGS.some((s) => path.includes(s))) return false;
  return true;
}

// Build the row we persist for a recordable request. Reuse an inbound Idempotency-Key
// when present (a device-outbox replay that reached the site) so device→site→cloud
// dedupes to ONE cloud write; otherwise mint one. Returns null when not recordable.
function buildOutboxEntry(req) {
  const method = req.method;
  const path = req.originalUrl || req.url;
  if (!isRecordableRequest(method, path)) return null;
  const headerKey = req.headers && (req.headers['idempotency-key'] || req.headers['Idempotency-Key']);
  const idempotency_key = headerKey || crypto.randomUUID();
  return {
    idempotency_key,
    method: String(method).toUpperCase(),
    path,
    body: req.body && Object.keys(req.body).length ? req.body : null,
    user_id: req.user ? req.user.id : null,
  };
}

module.exports = { isRecordableRequest, buildOutboxEntry, RECORDABLE_METHODS };
