// Offline Stage 16 — pure reconciliation policy for the site-sync worker.
// Kept dependency-free and unit-tested so the merge rules are auditable.

// Should a row PULLED from the cloud overwrite the site's local copy?
//
// The cloud is globally authoritative for the master/reference domains the site
// pulls (customers, suppliers, products, warehouses, bank_accounts). We still guard
// against clobbering a row the site edited more recently than the cloud snapshot we
// received — that edit is already queued in site_outbox to go UP, so we keep the
// local version until the cloud reflects it. Comparison is by record_version when
// present, else by updated_at timestamp.
function shouldApplyPulledRow(localRow, incomingRow) {
  if (!incomingRow) return false;
  if (!localRow) return true; // new to the site → insert

  const lv = Number(localRow.record_version);
  const iv = Number(incomingRow.record_version);
  if (Number.isFinite(lv) && Number.isFinite(iv)) {
    return iv >= lv; // cloud is at least as new → apply; local strictly newer → keep
  }

  const lt = localRow.updated_at ? new Date(localRow.updated_at).getTime() : 0;
  const it = incomingRow.updated_at ? new Date(incomingRow.updated_at).getTime() : 0;
  if (Number.isFinite(lt) && Number.isFinite(it) && lt && it) {
    return it >= lt;
  }
  return true; // no version info → trust the cloud
}

// Conflict codes the cloud may return when it REFUSES a replayed site write. Mirrors
// the client-side classifier (Stage 8) so the tray language is consistent.
const CONFLICT_CODES = ['insufficient_stock', 'duplicate', 'version_conflict', 'not_permitted', 'invalid', 'rejected'];

// Classify the cloud's response to a site_outbox replay.
//   synced   — the cloud accepted it (2xx). Remove from the outbox.
//   conflict — the cloud rejected it on business grounds (4xx). Park it for a human.
//   retry    — transient (network / 5xx / auth expiry). Leave pending, try again later.
function classifyPushResult(status, body) {
  if (status >= 200 && status < 300) return { outcome: 'synced' };
  if (status === 401 || status === 403 || status === 429) return { outcome: 'retry', code: 'auth_or_throttle' };
  if (status >= 500) return { outcome: 'retry', code: 'server_error' };
  if (status >= 400) {
    const code = (body && (body.code || body.conflict_code)) || 'rejected';
    return { outcome: 'conflict', code: CONFLICT_CODES.includes(code) ? code : 'rejected' };
  }
  // 0 / undefined → never reached the cloud.
  return { outcome: 'retry', code: 'unreachable' };
}

module.exports = { shouldApplyPulledRow, classifyPushResult, CONFLICT_CODES };
