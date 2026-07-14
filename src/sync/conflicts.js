// Sync conflict typing + reporting (Stage 8). When the server refuses a replayed
// offline write (4xx), we classify it into a type (for a friendlier tray + a
// central audit) and record it server-side. The write is never silently applied —
// it stays in the outbox for the user to retry/dismiss.
import { syncPost, getDeviceId } from './device';

// Prefer a server-provided `code`; otherwise infer from the message/status.
export function classifyConflict(status, body) {
  if (body && body.code) return body.code;
  const msg = (body?.message || '').toLowerCase();
  if (/insufficient|not enough|oversold|out of stock|available (qty|stock)/.test(msg)) return 'insufficient_stock';
  if (/duplicate|already (exists|invoiced|recorded|paid)|unique constraint/.test(msg)) return 'duplicate';
  if (/version|out of date|modified by|stale|changed on the server/.test(msg)) return 'version_conflict';
  if (/permission|forbidden|not allowed|owner approval|unauthor/.test(msg)) return 'not_permitted';
  if (status === 422) return 'invalid';
  return 'rejected';
}

// Friendly labels for the Pending Sync tray.
export const CONFLICT_LABELS = {
  insufficient_stock: 'Not enough stock',
  duplicate: 'Already recorded',
  version_conflict: 'Changed on the server',
  not_permitted: 'Not permitted',
  invalid: 'Needs a fix',
  device_revoked: 'Device revoked',
  rejected: 'Rejected by server',
};

// Record a conflict centrally (best-effort — the local outbox already holds it).
export async function reportConflict(item, verdict, code) {
  return syncPost('/conflicts', {
    device_uuid: getDeviceId(),
    item_uuid: item.id,
    endpoint: item.endpoint,
    method: item.method,
    conflict_code: code,
    status_code: verdict.status,
    message: verdict.body?.message || null,
    label: item.label,
  });
}
