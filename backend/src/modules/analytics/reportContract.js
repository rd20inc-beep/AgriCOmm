/**
 * The report-endpoint contract (P4-05 / P4-12) — ONE way to ask a report for a
 * period, a page and an export, and one shape for what comes back.
 *
 * Query (validated with Joi on every /api/reporting/* request):
 *
 *   from_date, to_date   the period. 'YYYY-MM-DD' is a whole calendar day, both
 *                        ends INCLUSIVE; a full ISO timestamp is an exact
 *                        instant (Print Reports sends local midnight / 23:59:59).
 *                        A payroll month 'YYYY-MM' passes through unchanged.
 *   entity               'mill' | 'export' | 'all' (blank = all)
 *   page, limit          paging for list reports (limit capped per report)
 *   format               'json' (default) | 'csv' — a CSV is the FULL filtered
 *                        result, never one page
 *
 * Before this contract the hub sent from_date/to_date while five controllers
 * read dateFrom/dateTo, so Orders, Customers, Countries, the Quality ranking
 * and the Booked-Profit tile silently showed all-time figures (RPT-02). The
 * older names (dateFrom/dateTo, from/to, periodStart/periodEnd,
 * startDate/endDate) are still ACCEPTED as aliases, and the middleware writes
 * the one validated period back under every name, so a service that still
 * destructures an old name reads the same period as one that reads the new.
 *
 * An inclusive day end: `created_at <= '2026-10-31'` stops at midnight and
 * drops the last day. A date-only to_date is therefore widened to
 * 'YYYY-MM-DDT23:59:59.999' — Postgres reads that as the end of the day for a
 * timestamp column and as the same day for a DATE column.
 *
 * Response metadata for list reports (pageMeta): { page, limit, total,
 * totalPages, returned, truncated } — `truncated` is true whenever the rows
 * returned are fewer than the rows that match, so no screen can present a
 * partial list as the whole. Totals are always aggregated over the full
 * filter, never over the returned page.
 */
const Joi = require('joi');

// Every name a period bound has been sent under, canonical first.
const FROM_ALIASES = ['from_date', 'dateFrom', 'from', 'periodStart', 'startDate'];
const TO_ALIASES = ['to_date', 'dateTo', 'to', 'periodEnd', 'endDate'];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
// ISO-8601 date-time ('2026-10-01T19:00:00.000Z', '2026-10-31T23:59:59', '2026-10-31 10:00').
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/;

const boundSchema = Joi.string().trim().allow('').custom((v, helpers) => {
  if (v === '') return v;
  if (DAY_RE.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return helpers.error('date.invalidDay');
    return v;
  }
  if (MONTH_RE.test(v)) return v;
  if (INSTANT_RE.test(v) && !Number.isNaN(new Date(v.replace(' ', 'T')).getTime())) return v;
  return helpers.error('date.invalidBound');
}, 'report date bound').messages({
  'date.invalidDay': '{{#label}} is not a real calendar day (expected YYYY-MM-DD).',
  'date.invalidBound': '{{#label}} must be a date (YYYY-MM-DD), a month (YYYY-MM) or an ISO timestamp.',
});

const aliasKeys = Object.fromEntries([...FROM_ALIASES, ...TO_ALIASES].map((k) => [k, boundSchema]));

// Unknown keys are kept (each report has its own filters: q, status, type …);
// only the shared parameters are validated here.
const reportQuerySchema = Joi.object({
  ...aliasKeys,
  entity: Joi.string().trim().lowercase().valid('mill', 'export', 'all', '').optional(),
  page: Joi.number().integer().min(1).max(100000).optional(),
  limit: Joi.number().integer().min(1).max(100000).optional(),
  format: Joi.string().trim().lowercase().valid('json', 'csv').optional(),
}).unknown(true);

// The first non-blank value among the aliases, and every distinct value given.
function pick(query, names) {
  const given = names.map((n) => query[n]).filter((v) => v != null && String(v).trim() !== '').map((v) => String(v).trim());
  return { value: given[0] || null, distinct: [...new Set(given)] };
}

/** A date-only upper bound widened to the end of that day; anything else as is. */
function inclusiveEnd(to) {
  if (to && DAY_RE.test(to)) return `${to}T23:59:59.999`;
  return to;
}

/** 'YYYY-MM-DD' of a bound (date, month start, or instant's date part), else null. */
function dayOf(v) {
  if (!v) return null;
  const s = String(v);
  if (MONTH_RE.test(s)) return `${s}-01`;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Validate + normalise a report query. Pure.
 * @returns {{ error: null|{field,message}[], query: object, range: {from,to,fromDay,toDay} }}
 */
function normalizeReportQuery(rawQuery = {}) {
  const { error, value } = reportQuerySchema.validate(rawQuery || {}, { abortEarly: false, convert: true });
  if (error) {
    return { error: error.details.map((d) => ({ field: d.path.join('.'), message: d.message })), query: rawQuery, range: null };
  }
  const from = pick(value, FROM_ALIASES);
  const to = pick(value, TO_ALIASES);
  const errors = [];
  if (from.distinct.length > 1) errors.push({ field: 'from_date', message: `Conflicting start dates sent (${from.distinct.join(' vs ')}). Send from_date only.` });
  if (to.distinct.length > 1) errors.push({ field: 'to_date', message: `Conflicting end dates sent (${to.distinct.join(' vs ')}). Send to_date only.` });
  const fromDay = dayOf(from.value);
  const toDay = dayOf(to.value);
  if (fromDay && toDay && fromDay > toDay) errors.push({ field: 'from_date', message: `from_date (${fromDay}) is after to_date (${toDay}).` });
  if (errors.length) return { error: errors, query: rawQuery, range: null };

  // Months stay months (payroll periods compare 'YYYY-MM' strings).
  const fromOut = from.value;
  const toOut = to.value && MONTH_RE.test(to.value) ? to.value : inclusiveEnd(to.value);
  const query = { ...value };
  for (const k of FROM_ALIASES) { if (fromOut) query[k] = fromOut; else delete query[k]; }
  for (const k of TO_ALIASES) { if (toOut) query[k] = toOut; else delete query[k]; }
  if (query.entity === '' || query.entity === 'all') delete query.entity;
  return { error: null, query, range: { from: fromOut, to: toOut, fromDay, toDay } };
}

/**
 * Express middleware. Express 5's req.query is a getter that re-parses the URL
 * on every read, so the normalised object is pinned with defineProperty.
 */
function reportQuery(req, res, next) {
  const { error, query, range } = normalizeReportQuery(req.query);
  if (error) {
    return res.status(400).json({ success: false, message: 'Invalid report parameters.', errors: error });
  }
  Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
  req.reportRange = range;
  return next();
}

/**
 * Paging for a list report. `maxLimit` is the most one page may hold; a CSV
 * export (format=csv) asks for everything up to `exportCap`.
 */
function pageParams(query = {}, { defaultLimit = 100, maxLimit = 500, exportCap = 100000 } = {}) {
  if (String(query.format || '').toLowerCase() === 'csv') {
    return { page: 1, limit: exportCap, offset: 0, exporting: true };
  }
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, Math.min(maxLimit, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit, exporting: false };
}

/** Page metadata; `truncated` = more rows match than were returned. */
function pageMeta(total, { page = 1, limit }, returned) {
  const t = Math.max(0, parseInt(total, 10) || 0);
  const r = Math.max(0, parseInt(returned, 10) || 0);
  return {
    page,
    limit,
    total: t,
    totalPages: limit ? Math.max(1, Math.ceil(t / limit)) : 1,
    returned: r,
    truncated: r < t,
  };
}

/**
 * What every report states about itself: the period it covers, when it was
 * produced, the unit and the currency of its figures.
 */
function reportMeta(range, { unit = null, currency = null, basis = null } = {}) {
  return {
    from: range && range.fromDay ? range.fromDay : null,
    to: range && range.toDay ? range.toDay : null,
    allTime: !(range && (range.fromDay || range.toDay)),
    asOf: new Date().toISOString(),
    unit,
    currency,
    ...(basis ? { basis } : {}),
  };
}

/**
 * Most rows one export may return (W19). A screen shows a capped page; its CSV
 * asks the SAME endpoint for everything (`export=1` or `format=csv`) up to this
 * cap, and the response's `truncated` flag tells the browser to warn the user
 * when even the export was cut short.
 */
const EXPORT_ROW_CAP = 50000;

/** True when the caller wants the full filtered result for an export. */
function isExportRequest(query = {}) {
  const q = query || {};
  if (String(q.format || '').toLowerCase() === 'csv') return true;
  const e = String(q.export == null ? '' : q.export).toLowerCase();
  return e === '1' || e === 'true';
}

/** Row cap for a list report: the screen cap, or EXPORT_ROW_CAP for an export. */
function listCap(query = {}, { defaultLimit, maxLimit }) {
  if (isExportRequest(query)) return EXPORT_ROW_CAP;
  return Math.min(parseInt(query.limit, 10) || defaultLimit, maxLimit);
}

module.exports = {
  EXPORT_ROW_CAP,
  isExportRequest,
  listCap,
  FROM_ALIASES,
  TO_ALIASES,
  reportQuerySchema,
  normalizeReportQuery,
  reportQuery,
  inclusiveEnd,
  dayOf,
  pageParams,
  pageMeta,
  reportMeta,
};
