import { METHOD_LABEL, money } from './paymentPayload';

const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—');

/**
 * What has already been paid against this payable or receivable.
 *
 * `compact` is a one-line-per-payment list for a drawer that is mostly a form;
 * the default shows where the money came from, which is what someone
 * reconciling a bank statement is looking for.
 */
export default function PaymentHistory({ payments, loading, currency = 'PKR', compact = false, title = 'Payments made' }) {
  const rows = payments || [];
  return (
    <div>
      <div className={compact ? 'text-xs font-medium text-gray-600 mb-1' : 'text-sm font-semibold text-gray-700 mb-2'}>{title}</div>
      {loading ? (
        <p className="text-xs text-gray-400 py-1">Loading…</p>
      ) : !rows.length ? (
        <p className="text-xs text-gray-400 py-1">No payments recorded yet.</p>
      ) : compact ? (
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-xs">
          {rows.map((h, idx) => (
            <div key={h.id || idx} className="flex justify-between px-2.5 py-1.5">
              <span className="text-gray-500">{fmtDate(h.paymentDate)} · {h.paymentNo || '—'}</span>
              <span className="tabular-nums text-emerald-600">{money(h.amount, currency)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((p, idx) => {
            const from = [p.accountName, p.bankName].filter(Boolean).join(' · ')
              || (p.paymentMethod === 'cash' ? 'Cash (in hand)' : '—');
            return (
              <div key={p.id || idx} className="border border-gray-200 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-emerald-700">{money(p.amount, currency)}</span>
                  <span className="text-xs text-gray-500">{fmtDate(p.paymentDate)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
                  <span>Method: <span className="font-medium text-gray-700">{METHOD_LABEL[p.paymentMethod] || p.paymentMethod || '—'}</span></span>
                  <span>From: <span className="font-medium text-gray-700">{from}</span></span>
                  {p.bankReference && <span>Ref: <span className="font-medium text-gray-700">{p.bankReference}</span></span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
