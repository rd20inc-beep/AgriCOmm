import { useQuery } from '@tanstack/react-query';
import { FileText, ArrowDownRight } from 'lucide-react';
import { accountingApi } from '../../accounting/api/services';

const PKR = (v) => `Rs ${Math.round(parseFloat(v) || 0).toLocaleString()}`;
const fmtDate = (d) => { if (!d) return '—'; const dt = new Date(d); return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); };
const METHOD = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', online: 'Online', mobile: 'Mobile' };
const STATUS_TONE = { Paid: 'bg-emerald-100 text-emerald-700', Partial: 'bg-amber-100 text-amber-700', Unpaid: 'bg-red-100 text-red-700' };
// Row tint per status so paid / partial / unpaid read at a glance (and print).
const STATUS_BG = { Paid: 'bg-emerald-50', Partial: 'bg-amber-50', Unpaid: 'bg-red-50' };

// Invoice ↔ payment allocation ledger (LedgerReport.pdf style): each invoice
// with the payments applied to it + outstanding, and a totals/counts footer.
export default function PartyAllocationLedger({ partyType, partyId }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['party-allocation', partyType, partyId],
    enabled: !!partyId,
    queryFn: async () => { const r = await accountingApi.partyAllocation(partyType, partyId); return r?.data ?? r; },
  });

  if (isLoading) return <div className="p-6 text-center text-sm text-gray-400">Loading ledger…</div>;
  if (isError) return <div className="p-6 text-center text-sm text-red-500">Failed to load: {error?.message || 'error'}</div>;

  const invoices = data?.invoices || [];
  const totals = data?.totals || { billed: 0, paid: 0, outstanding: 0 };
  const counts = data?.counts || { invoices: 0, payments: 0 };
  const billLabel = partyType === 'customer' ? 'Sale' : 'Bill';
  const payLabel = partyType === 'customer' ? 'Receipt' : 'Payment';

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-gray-700">Invoice & payment allocation</h4>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-200 border border-emerald-300" /> Paid</span>
          <span className="inline-flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2.5 h-2.5 rounded-sm bg-amber-200 border border-amber-300" /> Partial</span>
          <span className="inline-flex items-center gap-1 text-[10px] text-gray-500"><span className="w-2.5 h-2.5 rounded-sm bg-red-200 border border-red-300" /> Unpaid</span>
          <span className="text-[11px] text-gray-400">{counts.invoices} {billLabel.toLowerCase()}{counts.invoices === 1 ? '' : 's'} · {counts.payments} {payLabel.toLowerCase()}{counts.payments === 1 ? '' : 's'}</span>
        </div>
      </div>

      {invoices.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">No invoices yet.</div>
      ) : (
        <div className="divide-y divide-white/60">
          {invoices.map((inv, i) => (
            <div key={i} className={`px-4 py-3 ${STATUS_BG[inv.status] || 'bg-gray-50'}`}>
              {/* Invoice header */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <FileText size={14} className="text-gray-400 shrink-0" />
                    <span className="font-semibold text-gray-900">{inv.ref}</span>
                    {inv.supplier_ref && inv.supplier_ref !== inv.ref && <span className="text-[11px] text-gray-400">{inv.supplier_ref}</span>}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_TONE[inv.status] || 'bg-gray-100 text-gray-600'}`}>{inv.status}</span>
                    <span className="text-[11px] text-gray-400">{fmtDate(inv.date)}</span>
                  </div>
                  {(inv.particulars || inv.notes) && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate" title={`${inv.particulars || ''}${inv.notes ? ` — ${inv.notes}` : ''}`}>
                      {inv.particulars}{inv.notes ? <span className="text-gray-400"> — {inv.notes}</span> : ''}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-gray-900 tabular-nums">{PKR(inv.amount)}</div>
                  {inv.outstanding > 0.01 && <div className="text-[11px] text-amber-700 tabular-nums">Outstanding {PKR(inv.outstanding)}</div>}
                </div>
              </div>

              {/* Payments applied */}
              {inv.payments.length > 0 ? (
                <div className="mt-2 ml-5 rounded-lg bg-white/70 border border-black/5 divide-y divide-black/5">
                  {inv.payments.map((p, j) => (
                    <div key={j} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                      <span className="flex items-center gap-1.5 min-w-0 text-gray-600">
                        <ArrowDownRight size={12} className="text-emerald-500 shrink-0" />
                        <span className="font-medium text-gray-700">{p.ref}</span>
                        <span className="text-gray-400">{fmtDate(p.date)}</span>
                        <span className="text-gray-400">{METHOD[p.method] || p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                      </span>
                      <span className="tabular-nums text-emerald-700 font-medium shrink-0">{PKR(p.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 ml-5 text-[11px] text-gray-400">No {payLabel.toLowerCase()} yet.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Totals footer */}
      <div className="grid grid-cols-3 gap-px bg-gray-100 border-t border-gray-200">
        <Foot label={`Total ${billLabel.toLowerCase()}s`} value={PKR(totals.billed)} />
        <Foot label="Paid" value={PKR(totals.paid)} tone="text-emerald-700" />
        <Foot label="Outstanding" value={PKR(totals.outstanding)} tone={totals.outstanding > 0 ? 'text-amber-700' : 'text-emerald-700'} bold />
      </div>
    </div>
  );
}

function Foot({ label, value, tone = 'text-gray-800', bold }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-0.5 tabular-nums ${bold ? 'text-base font-bold' : 'text-sm font-medium'} ${tone}`}>{value}</p>
    </div>
  );
}
