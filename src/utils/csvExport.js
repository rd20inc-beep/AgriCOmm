/**
 * Back-compat entry point — the app's one CSV exporter is
 * shared/utils/csv.js (BOM, escaping incl. formula injection, raw numbers,
 * null → blank). Usage:
 *   downloadCSV(rows, columns, filename)
 *   downloadCSV(rows, filename)          // columns = the rows' own keys
 * (The two-argument form used to throw — columns.map on a string — so the
 * Finance ▸ Local Sales and Purchases CSV buttons did nothing.)
 */
import { downloadCsv } from '../shared/utils/csv';

export function downloadCSV(data, columns, filename = 'export.csv') {
  if (typeof columns === 'string') return downloadCsv({ rows: data, filename: columns });
  return downloadCsv({ rows: data, columns, filename });
}
