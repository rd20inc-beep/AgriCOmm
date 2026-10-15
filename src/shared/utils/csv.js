// The ONE CSV exporter for the browser (P4-14, RPT-22). The server's twin is
// backend/src/utils/csv.js — same rules, keep them in step:
//
//   - UTF-8 byte-order mark, so Excel reads Urdu / accented names
//   - CRLF line ends, RFC 4180 quoting (comma, quote, CR/LF, edge spaces)
//   - formula-injection guard: a TEXT cell starting with = + - @ (or a tab /
//     CR) is prefixed with ' so the spreadsheet never evaluates it; a real
//     number — negative included — stays a number
//   - numbers are RAW: never Math.round-ed to the rupee, never grouped, so the
//     paisa survive. Pass the figure, not a formatted string
//   - null / undefined / NaN → blank. A redacted figure stays blank; it never
//     turns into 0
//   - no rows still downloads the header row (never a silent no-op)
//
// Seven separate CSV writers used to exist (csvExport.downloadCSV,
// FinanceTable, Rice Purchases, Audit Log, Local Sales Finance, Purchases, the
// Report Builder); they all come here now.
//
// When a screen shows one page of a longer list, export from the server
// (format=csv, see downloadServerCsv) — never just the rows on screen.
import api from '../../api/client';

export const BOM = '﻿';
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell, escaped. */
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (FORMULA_START.test(s) && !NUMERIC_TEXT.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * A money / quantity figure for a CSV column: the raw number, or null (blank)
 * when it is missing or redacted. Use instead of Math.round(parseFloat(x) || 0).
 */
export function csvNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function columnsOf(rows, columns) {
  if (Array.isArray(columns) && columns.length) return columns;
  const first = (rows || [])[0] || {};
  return Object.keys(first).map((k) => ({ key: k, label: k }));
}

function cellOf(col, row) {
  if (typeof col.accessor === 'function') return col.accessor(row);
  if (typeof col.value === 'function') return col.value(row);
  return row == null ? null : row[col.key];
}

/**
 * CSV text (with BOM) — pure, for tests and for callers that need the string.
 * columns: [{ label, key?, accessor?(row) }]; omitted → the first row's keys.
 */
export function toCsv(rows, columns) {
  const cols = columnsOf(rows, columns);
  const lines = [cols.map((c) => csvCell(c.label != null ? c.label : c.key)).join(',')];
  for (const row of rows || []) lines.push(cols.map((c) => csvCell(cellOf(c, row))).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

function withCsvExt(name) {
  const n = String(name || 'export').trim() || 'export';
  return n.toLowerCase().endsWith('.csv') ? n : `${n}.csv`;
}

function saveText(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = withCsvExt(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download CSV text already built by toCsv (e.g. a multi-section report). */
export function downloadCsvText(text, filename) {
  saveText(text, filename);
}

/** Download rows as CSV. Returns the number of data rows written. */
export function downloadCsv({ filename = 'export.csv', columns, rows }) {
  const list = Array.isArray(rows) ? rows : [];
  saveText(toCsv(list, columns), filename);
  return list.length;
}

function queryString(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    u.append(k, v);
  }
  return u.toString();
}

/**
 * The FULL filtered result from a report endpoint that supports format=csv
 * (authenticated download). Use whenever the screen holds only one page.
 */
export function downloadServerCsv(endpoint, params, filename) {
  const qs = queryString({ ...(params || {}), format: 'csv' });
  return api.download(`${endpoint}?${qs}`, withCsvExt(filename));
}
