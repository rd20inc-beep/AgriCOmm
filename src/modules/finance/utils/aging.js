// Single source of truth for AR/AP aging across the finance module.
// Previously the buckets + colors were redefined in FinanceOverview and
// MoneyIn separately — easy for the edges to drift apart unnoticed.

import { receivablePkrAtBooked } from './currencyTiles';

export const BUCKET_KEYS = ['0-30', '31-60', '61-90', '90+'];

export const BUCKET_COLORS = {
  '0-30':  { bar: 'bg-emerald-500', tag: 'bg-emerald-50 text-emerald-700', text: 'text-emerald-700' },
  '31-60': { bar: 'bg-amber-500',   tag: 'bg-amber-50 text-amber-700',     text: 'text-amber-700' },
  '61-90': { bar: 'bg-orange-500',  tag: 'bg-orange-50 text-orange-700',   text: 'text-orange-700' },
  '90+':   { bar: 'bg-red-500',     tag: 'bg-red-50 text-red-700',         text: 'text-red-700' },
};

export function ageDays(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function ageBucket(days) {
  if (days == null || days < 0) return null;
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

// Bucketize a list of receivable/payable rows by age.
// Returns { '0-30': {count, totalPkr, totalForeign, native}, ..., totalPkr,
// totalForeign, native, missingCount, foreign }.
// `native` holds each currency's own total ({ USD: 3000, PKR: 821395 }) — the
// figures to SHOW. `totalPkr` is the ≈ PKR equivalent (owner decision G-1 /
// C5): in 'mixed' mode each foreign row at its OWN booked rate (booked
// base_amount_pkr scaled by the share outstanding, else × its booked fx_rate);
// a row with neither is left out of it and counted in missingCount. It is a
// secondary line and the bar's proportions, never a headline figure.
// `mode` = 'pkr' assumes everything in PKR (payables today).
export function bucketize(rows, { mode = 'mixed' } = {}) {
  const init = () => ({ count: 0, totalPkr: 0, totalForeign: 0, native: {} });
  const buckets = {
    '0-30': init(), '31-60': init(), '61-90': init(), '90+': init(),
  };
  let totalPkr = 0;
  let totalForeign = 0;
  let missingCount = 0;
  let foreign = false;
  const native = {};

  for (const r of rows || []) {
    if (!isOpenAR(r)) continue;
    const dueOrInvoice = r.dueDate || r.due_date || r.invoiceDate || r.invoice_date || r.expectedDate;
    const days = ageDays(dueOrInvoice);
    const bucket = ageBucket(days);
    if (!bucket) continue;

    const outstanding = parseFloat(r.outstanding) || 0;
    const currency = mode === 'pkr' ? 'PKR' : (r.currency || 'PKR').toUpperCase();
    const pkr = currency === 'PKR' ? outstanding : receivablePkrAtBooked({ ...r, currency }, 'outstanding');

    buckets[bucket].count += 1;
    buckets[bucket].native[currency] = (buckets[bucket].native[currency] || 0) + outstanding;
    native[currency] = (native[currency] || 0) + outstanding;
    if (pkr == null) missingCount += 1;
    else { buckets[bucket].totalPkr += pkr; totalPkr += pkr; }
    if (currency !== 'PKR') {
      foreign = true;
      buckets[bucket].totalForeign += outstanding;
      totalForeign += outstanding;
    }
  }

  return { ...buckets, totalPkr, totalForeign, native, missingCount, foreign };
}

export function isOpenAR(r) {
  const status = String(r.status || '').toLowerCase();
  return status !== 'paid' && status !== 'received' && (parseFloat(r.outstanding) || 0) > 0;
}
