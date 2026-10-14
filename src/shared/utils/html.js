// HTML escaping for the print templates that are built as strings and written
// into a new window (payslips, vouchers, certificates). Any text that came
// from a user — a worker's name, a bank name, company address, notes — must go
// through here before it is interpolated, or it is live HTML (P1-09 / PAY-28).

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape one value for HTML text or a quoted attribute. null/undefined → ''. */
export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/**
 * Deep copy with every string value HTML-escaped (numbers, booleans, dates
 * untouched), so a template can keep `${line.workerName}` and still be safe.
 * Keys ending in "json" (e.g. statutoryJson) are left exactly as they are —
 * a JSON string must stay parseable; escape what you read out of it.
 */
export function escapeFields(value) {
  if (value == null) return value;
  if (typeof value === 'string') return escapeHtml(value);
  if (Array.isArray(value)) return value.map(escapeFields);
  if (typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = /json$/i.test(k) ? v : escapeFields(v);
    return out;
  }
  return value;
}
