/**
 * The one place numbers, money and dates are turned into text.
 *
 * Rules every helper here follows:
 *   - A fixed 'en-PK' locale, never the browser's. `toLocaleString()` with no
 *     locale prints "1.234.567" on a German laptop and "12,34,567" on an Indian
 *     one; the mill's screens must read the same on every device.
 *   - EXACT figures. No "Cr" / "L" / "M" abbreviation — reports and ledgers are
 *     reconciled line by line and a rounded "1.2 Cr" can't be ticked off.
 *   - Missing / unparseable input (null, undefined, '', NaN, Infinity, junk
 *     strings) prints "—" so a blank cell never reads as a real zero.
 *   - Numeric strings are accepted (Postgres NUMERIC arrives as "1234.50").
 *
 * Dates:
 *   - One house format: "05 Oct 2026" (en-GB day-2-digit / short month /
 *     numeric year — what most of the app already printed).
 *   - A bare 'YYYY-MM-DD' is a calendar date, not an instant: it is shown as
 *     that day, never shifted by the time zone.
 *   - todayLocalISO() is the default for every date input. NEVER default a date
 *     with `new Date().toISOString().slice(0, 10)` — that is the UTC date, which
 *     in Pakistan (UTC+5) is still YESTERDAY until 05:00, i.e. the whole night
 *     shift at the mill.
 */

export const LOCALE = 'en-PK';
export const EMPTY = '—';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Number | numeric string → finite number, else null. */
export function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim().replace(/,/g, '');
    if (s === '') return null;
    v = Number(s);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

const nfCache = new Map();
function nf(min, max) {
  const key = `${min}:${max}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max });
    nfCache.set(key, f);
  }
  return f;
}

// Group the absolute value and put the sign in front ourselves, so "-0" never
// prints and a negative currency reads "-Rs 1,234" rather than "Rs -1,234".
function grouped(abs, min, max) {
  return nf(min, max).format(abs);
}
function signed(n, body) {
  // A value that rounds to zero is zero — no "-0" or "-Rs 0".
  return n < 0 && /[1-9]/.test(body) ? `-${body}` : body;
}

/**
 * Plain number with thousands separators.
 *   fmtNum(1234567)        → "1,234,567"
 *   fmtNum(1234.5)         → "1,234.5"   (up to 2 decimals when not specified)
 *   fmtNum(1234.5, 2)      → "1,234.50"  (exactly `decimals` when specified)
 */
export function fmtNum(v, decimals) {
  const n = toNumber(v);
  if (n === null) return EMPTY;
  const body = decimals === undefined
    ? grouped(Math.abs(n), 0, 2)
    : grouped(Math.abs(n), decimals, decimals);
  return signed(n, body);
}

/** Pakistani rupees, exact. fmtPKR(1234567) → "Rs 1,234,567"; { decimals: 2 } → "Rs 1,234,567.00". */
export function fmtPKR(v, { decimals = 0 } = {}) {
  const n = toNumber(v);
  if (n === null) return EMPTY;
  return signed(n, `Rs ${grouped(Math.abs(n), decimals, decimals)}`);
}

/** US dollars. fmtUSD(12345.67) → "$12,345.67". */
export function fmtUSD(v, { decimals = 2 } = {}) {
  const n = toNumber(v);
  if (n === null) return EMPTY;
  return signed(n, `$${grouped(Math.abs(n), decimals, decimals)}`);
}

/**
 * Money in a given currency. PKR → fmtPKR, USD → fmtUSD, anything else →
 * "AED 1,234.50" (code + amount, 2 decimals unless told otherwise).
 */
export function fmtMoney(v, currency = 'PKR', opts = {}) {
  const code = String(currency || 'PKR').toUpperCase();
  if (code === 'PKR') return fmtPKR(v, opts);
  if (code === 'USD') return fmtUSD(v, opts);
  const n = toNumber(v);
  if (n === null) return EMPTY;
  const d = opts.decimals ?? 2;
  return signed(n, `${code} ${grouped(Math.abs(n), d, d)}`);
}

/** Kilograms — the storage unit. fmtKg(12082) → "12,082 kg". */
export function fmtKg(v, { decimals = 0 } = {}) {
  const n = toNumber(v);
  if (n === null) return EMPTY;
  return signed(n, `${grouped(Math.abs(n), decimals, decimals)} kg`);
}

/**
 * Metric tonnes. Only where MT is genuinely the unit (export contracts,
 * shipping docs) — stock and milling screens show kg. fmtMT(12.0825) → "12.083 MT".
 */
export function fmtMT(v, { decimals = 3 } = {}) {
  const n = toNumber(v);
  if (n === null) return EMPTY;
  return signed(n, `${grouped(Math.abs(n), decimals, decimals)} MT`);
}

/**
 * A value that is ALREADY a percentage (12.5 means 12.5%, not 1250%).
 * fmtPct(12.345) → "12.3%"; { decimals: 2 } → "12.35%".
 */
export function fmtPct(v, { decimals = 1 } = {}) {
  const n = toNumber(v);
  if (n === null) return EMPTY;
  return signed(n, `${grouped(Math.abs(n), decimals, decimals)}%`);
}

/**
 * Anything date-ish → a local Date, or null.
 * 'YYYY-MM-DD' is read as that calendar day at local midnight (not UTC).
 */
export function toDate(d) {
  if (d === null || d === undefined || d === '') return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d;
  if (typeof d === 'string') {
    const m = DATE_ONLY.exec(d.trim());
    if (m) {
      const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return dt.getMonth() === Number(m[2]) - 1 ? dt : null; // rejects 2026-02-30
    }
  }
  if (typeof d !== 'string' && typeof d !== 'number') return null;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

const pad2 = (x) => String(x).padStart(2, '0');

/** House date format: "05 Oct 2026". */
export function fmtDate(d) {
  const dt = toDate(d);
  if (!dt) return EMPTY;
  return `${pad2(dt.getDate())} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

/** Date + local time, 12-hour: "05 Oct 2026, 03:07 PM". */
export function fmtDateTime(d) {
  const dt = toDate(d);
  if (!dt) return EMPTY;
  const h = dt.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${fmtDate(dt)}, ${pad2(h12)}:${pad2(dt.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * A Date (or date-ish value) → 'YYYY-MM-DD' in LOCAL time, for <input type="date">
 * and API payloads. Invalid / missing → ''.
 */
export function toLocalISODate(d) {
  if (typeof d === 'string' && DATE_ONLY.test(d.trim())) return toDate(d) ? d.trim() : '';
  const dt = toDate(d);
  if (!dt) return '';
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** Today's date in local time, 'YYYY-MM-DD'. The default for every date input. */
export function todayLocalISO() {
  return toLocalISODate(new Date());
}
