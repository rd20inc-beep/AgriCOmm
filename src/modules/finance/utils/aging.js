// Single source of truth for AR/AP aging across the finance module.
// Previously the buckets + colors were redefined in FinanceOverview and
// MoneyIn separately — easy for the edges to drift apart unnoticed.

import { DEFAULT_FX_RATE } from './fx';

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
// Returns { '0-30': {count, totalPkr, totalForeign}, ..., totalPkr, totalForeign }.
// `mode` = 'mixed' keeps foreign amount separate (receivables can be USD);
// `mode` = 'pkr' assumes everything in PKR (payables today).
export function bucketize(rows, { mode = 'mixed', defaultFxRate = DEFAULT_FX_RATE } = {}) {
  const init = () => ({ count: 0, totalPkr: 0, totalForeign: 0 });
  const buckets = {
    '0-30': init(), '31-60': init(), '61-90': init(), '90+': init(),
  };
  let totalPkr = 0;
  let totalForeign = 0;

  for (const r of rows || []) {
    if (!isOpenAR(r)) continue;
    const dueOrInvoice = r.dueDate || r.due_date || r.invoiceDate || r.invoice_date || r.expectedDate;
    const days = ageDays(dueOrInvoice);
    const bucket = ageBucket(days);
    if (!bucket) continue;

    const outstanding = parseFloat(r.outstanding) || 0;
    const currency = (r.currency || 'PKR').toUpperCase();
    const fxRate = parseFloat(r.fx_rate) || parseFloat(r.fxRate) || defaultFxRate;

    const pkr = mode === 'pkr' || currency === 'PKR'
      ? outstanding
      : outstanding * fxRate;

    buckets[bucket].count += 1;
    buckets[bucket].totalPkr += pkr;
    totalPkr += pkr;
    if (mode === 'mixed' && currency !== 'PKR') {
      buckets[bucket].totalForeign += outstanding;
      totalForeign += outstanding;
    }
  }

  return { ...buckets, totalPkr, totalForeign };
}

export function isOpenAR(r) {
  const status = String(r.status || '').toLowerCase();
  return status !== 'paid' && status !== 'received' && (parseFloat(r.outstanding) || 0) > 0;
}
