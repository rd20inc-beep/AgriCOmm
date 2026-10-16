// W19 — Audit Trail CSV export: every row matching the filters, not just
// the newest page on screen. Kept out of the page so it stays a component-only
// module (react-refresh) and the test can run it.
import { todayLocalISO } from '../../../shared/utils/format';
import { downloadCsv } from '../../../shared/utils/csv';
import { fetchAllPagesCapped } from '../../../shared/utils/fetchAllPages';
import { auditApi } from '../../../api/services';
import { transformKeys } from '../../../api/transforms';

export const AUDIT_CSV_COLUMNS = [
  { label: 'Timestamp', accessor: (l) => (l.createdAt ? new Date(l.createdAt).toISOString() : null) },
  { label: 'User', accessor: (l) => l.userName || l.userEmail || 'System' },
  { label: 'Email', key: 'userEmail' },
  { label: 'Action', key: 'action' },
  { label: 'Entity Type', key: 'entityType' },
  { label: 'Entity ID', key: 'entityId' },
  { label: 'IP Address', key: 'ipAddress' },
  { label: 'Details', accessor: (l) => (l.details ? JSON.stringify(l.details) : null) },
];
// Most audit rows one CSV may pull (W19) — beyond it the user is told to narrow.
export const AUDIT_EXPORT_MAX = 20000;

/** The search box's match, shared by the screen and the CSV. */
export function auditMatches(l, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  return (l.action || '').toLowerCase().includes(t)
    || (l.entityType || '').toLowerCase().includes(t)
    || (l.entityId || '').toString().includes(t)
    || (l.userName || l.userEmail || '').toLowerCase().includes(t)
    || JSON.stringify(l.details || {}).toLowerCase().includes(t);
}

/**
 * W19 — the CSV is every audit row matching the filters, fetched page by page
 * from the server (the screen holds only the newest 100), then the search box
 * applied. Returns { written, total, truncated }.
 */
export async function exportAuditCsvAll({ params, searchTerm, list = auditApi.list, onWarn }) {
  const { rows, total, truncated } = await fetchAllPagesCapped(list, params, 'logs', { maxRows: AUDIT_EXPORT_MAX });
  const logs = transformKeys(rows).filter((l) => auditMatches(l, searchTerm));
  downloadCsv({ filename: `audit-trail-${todayLocalISO()}.csv`, rows: logs, columns: AUDIT_CSV_COLUMNS });
  if (truncated && onWarn) {
    onWarn(`CSV holds the newest ${rows.length.toLocaleString('en-US')} of ${Number(total).toLocaleString('en-US')} audit entries (export limit). Narrow the dates to export the rest.`);
  }
  return { written: logs.length, total, truncated };
}

