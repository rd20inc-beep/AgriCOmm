// Print Reports ▸ CSV (P4-14, RPT-23). Print Reports could only print, so an
// accountant re-keyed the figures. This flattens a printable report's payload
// — exactly what the page rendered, from the server — into one CSV: every
// list of records in it becomes a block of rows tagged with its section, and
// the scalar figures (totals, summary) a "Summary" block. Values stay RAW
// (numbers unformatted, paisa kept); a redacted figure is blank.
import { toCsv } from '../../../shared/utils/csv';

const isPlain = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const isRecordList = (v) => Array.isArray(v) && v.length > 0 && v.every(isPlain);
const isScalar = (v) => v == null || ['string', 'number', 'boolean'].includes(typeof v) || v instanceof Date;

// One level of nesting folded into "parent.child" columns; deeper → JSON.
function flatRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (isScalar(v)) out[k] = v;
    else if (isPlain(v)) {
      for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = isScalar(v2) ? v2 : JSON.stringify(v2);
    } else out[k] = JSON.stringify(v);
  }
  return out;
}

/** Pure: { section, rows }[] for every record list (depth ≤ 3) + the scalar summary. */
export function printableSections(data) {
  const sections = [];
  const summary = {};
  const walk = (node, path, depth) => {
    if (!isPlain(node) || depth > 3) return;
    for (const [k, v] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      if (isRecordList(v)) sections.push({ section: p, rows: v.map(flatRow) });
      else if (isPlain(v)) walk(v, p, depth + 1);
      else if (isScalar(v) && v !== '' && v != null) summary[p] = v;
    }
  };
  walk(data, '', 0);
  const out = [];
  if (Object.keys(summary).length) out.push({ section: 'Summary', rows: Object.entries(summary).map(([field, value]) => ({ field, value })) });
  return out.concat(sections);
}

/** Pure: one CSV with a leading Section column; columns = union of keys in order seen. */
export function printableCsv(data) {
  const sections = printableSections(data);
  const keys = [];
  const rows = [];
  for (const s of sections) {
    for (const r of s.rows) {
      for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
      rows.push({ Section: s.section, ...r });
    }
  }
  return toCsv(rows, [{ label: 'Section', key: 'Section' }, ...keys.map((k) => ({ label: k, key: k }))]);
}

/**
 * W19 — the sections the server cut short. A printable report caps its detail
 * lists (e.g. the 200 largest lines) and flags it (`truncated: true`,
 * `detailTruncated: { export: true }`). Pure: the dotted paths of every true
 * flag, so the CSV button can warn that those blocks are not complete.
 */
export function printableTruncations(data) {
  const out = [];
  const walk = (node, path, depth) => {
    if (!isPlain(node) || depth > 4) return;
    for (const [k, v] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      if (v === true && (/truncated$/i.test(k) || /truncated/i.test(path))) out.push(p);
      else if (isPlain(v)) walk(v, p, depth + 1);
    }
  };
  walk(data, '', 0);
  return out;
}
