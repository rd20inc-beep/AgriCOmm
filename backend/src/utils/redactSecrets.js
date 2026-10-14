// Recursive secret redaction for anything we persist or echo back that may carry
// a request body: audit_logs.details (the auditAction middleware stores the raw
// req.body), settings reads, integration rows.
//
// Deny-by-key: a property whose NAME looks like a credential keeps its key but
// its value becomes "[REDACTED]". Everything else is copied through unchanged so
// the audit trail still says who changed what. Matching is case-insensitive and
// camelCase / kebab-case are folded to snake_case first (newPassword,
// x-api-key, apiKey all hit).

const REDACTED = '[REDACTED]';

// Exact names (after normalisation) that are always secret.
const SECRET_EXACT = new Set([
  'pin', 'portal_pin', 'new_pin', 'old_pin', 'current_pin', 'confirm_pin', 'pin_hash',
  'secret', 'token', 'otp', 'cookie', 'cookies', 'authorization', 'credential', 'credentials',
  'apikey', 'api_key', 'smtp_pass', 'smtp_password', 'passwd', 'pwd', 'passphrase',
  'private_key', 'jwt', 'session_id', 'set_cookie',
]);

// Names that match a secret pattern below but are plainly not secrets. Keeping
// them readable keeps the audit trail useful (e.g. product_categories.group_key,
// a forced-password-change flag, the device's PUBLIC key).
const NOT_SECRET = new Set([
  'group_key', 'idempotency_key', 'public_key', 'token_version', 'sort_key', 'module_key',
  'force_password_change', 'password_changed_at', 'must_change_password', 'auth_type',
  'auth_method', 'pin_set', 'pin_is_set', 'has_pin', 'has_password', 'token_type',
  'token_expires_at',
]);

function normaliseKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s.]+/g, '_')
    .toLowerCase();
}

function isSecretKey(key) {
  if (key == null) return false;
  const k = normaliseKey(key);
  if (NOT_SECRET.has(k)) return false;
  if (SECRET_EXACT.has(k)) return true;
  if (k.includes('password')) return true;                          // new_password, password_hash, ...
  if (/(^|_)(secret|token|otp|credentials?|cookie|authorization|passphrase)$/.test(k)) return true;
  if (/(^|_)(secret|token|credentials?)_/.test(k)) return true;     // secret_value, token_hash, credentials_json
  if (/_key$/.test(k)) return true;                                  // whatsapp_api_key, secret_key, ...
  if (/(^|_)pin(_hash|_code)?$/.test(k)) return true;                // portal_pin, pin_hash
  if (/^auth_/.test(k)) return true;                                 // auth_credentials, auth_header
  return false;
}

/**
 * Deep copy of `value` with every secret-named property replaced by "[REDACTED]".
 * Arrays and plain objects are walked; other values (Date, Buffer, primitives)
 * are returned as-is. Cycles and absurd depth are cut, never thrown on.
 */
function redactSecrets(value, _seen = new WeakSet(), _depth = 0) {
  if (value == null || typeof value !== 'object') return value;
  if (_depth > 25) return '[TRUNCATED]';
  if (_seen.has(value)) return '[CIRCULAR]';
  if (Array.isArray(value)) {
    _seen.add(value);
    const out = value.map((v) => redactSecrets(v, _seen, _depth + 1));
    _seen.delete(value);
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    // Date, Buffer, class instances — let JSON.stringify do what it always did.
    if (typeof value.toJSON === 'function' || Buffer.isBuffer(value)) return value;
  }
  _seen.add(value);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (isSecretKey(k)) {
      out[k] = (v == null || v === '') ? v : REDACTED;
    } else {
      out[k] = redactSecrets(v, _seen, _depth + 1);
    }
  }
  _seen.delete(value);
  return out;
}

/**
 * Redact a details value as stored in audit_logs (jsonb → object, but legacy
 * rows/drivers may hand back a JSON string). Returns the same shape it got.
 */
function redactDetails(details) {
  if (details == null) return details;
  if (typeof details === 'string') {
    let parsed;
    try { parsed = JSON.parse(details); } catch { return details; }
    return JSON.stringify(redactSecrets(parsed));
  }
  return redactSecrets(details);
}

module.exports = { REDACTED, isSecretKey, redactSecrets, redactDetails, normaliseKey };
