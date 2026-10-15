/**
 * The ONE CSV writer for server-side exports (P4-14, RPT-22). The browser's
 * twin is src/shared/utils/csv.js — same rules, keep them in step:
 *
 *   - UTF-8 with a byte-order mark, so Excel reads Urdu / accented names
 *   - CRLF line ends, RFC 4180 quoting (comma, quote, CR/LF, edge spaces)
 *   - formula-injection guard: a TEXT cell starting with = + - @ (or a tab /
 *     CR) is prefixed with ' so a spreadsheet never evaluates it; a real
 *     number (including a negative one) is written as a number
 *   - numbers are RAW — never rounded to the rupee, never thousands-grouped
 *   - null / undefined / NaN → blank. A redacted figure stays blank; it never
 *     becomes 0
 *   - an empty result still writes the header row
 *
 * columns: [{ label, key?, value?(row) }] — `value` wins over `key`.
 */
const BOM = '﻿';
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (FORMULA_START.test(s) && !NUMERIC_TEXT.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function columnsOf(rows, columns) {
  if (Array.isArray(columns) && columns.length) return columns;
  const first = (rows || [])[0] || {};
  return Object.keys(first).map((k) => ({ key: k, label: k }));
}

function cellOf(col, row) {
  if (typeof col.value === 'function') return col.value(row);
  if (typeof col.accessor === 'function') return col.accessor(row);
  return row == null ? null : row[col.key];
}

/** CSV text (with BOM) for rows + columns. Pure. */
function toCsv(rows, columns) {
  const cols = columnsOf(rows, columns);
  const lines = [cols.map((c) => csvCell(c.label != null ? c.label : c.key)).join(',')];
  for (const row of rows || []) lines.push(cols.map((c) => csvCell(cellOf(c, row))).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

function safeFilename(name) {
  const base = String(name || 'export').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
  return base.toLowerCase().endsWith('.csv') ? base : `${base}.csv`;
}

/**
 * Send a CSV download. Header X-Row-Count carries the number of data rows so a
 * caller (or a test) can check the export is the whole filtered result.
 */
function sendCsv(res, { filename, columns, rows }) {
  const body = toCsv(rows || [], columns);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}"`);
  res.setHeader('X-Row-Count', String((rows || []).length));
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Row-Count');
  return res.status(200).send(body);
}

const wantsCsv = (req) => String((req && req.query && req.query.format) || '').toLowerCase() === 'csv';

module.exports = { BOM, csvCell, toCsv, sendCsv, safeFilename, wantsCsv };
