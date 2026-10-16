import { useState } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import { useMillCashFlow } from '../../../../../api/queries';
import { fmtDate } from '../../../../../shared/utils/format';
import useMillFinancePerms from '../hooks/useMillFinancePerms';
import { PayPayableDrawer } from '../drawers/PayableDrawers';
import { PKR } from '../constants';

/**
 * What the mill owes, by stream (paid vs outstanding), drilled down to each
 * unpaid bill with a Pay button (the shared PaymentDrawer — finance
 * confirm_payment, or milling.edit for the mill's own rows). The streams are
 * the server's snapshot (GET /milling/cash-flow moneyOutStreams).
 */
export default function PayablesView({ period }) {
  const { addToast } = useApp();
  const { canPay } = useMillFinancePerms();
  const { data: cashFlow } = useMillCashFlow({ period });
  const moneyOutStreams = cashFlow?.moneyOutStreams || [];
  const moneyOutPayables = cashFlow?.moneyOutPayables || [];
  const [openStream, setOpenStream] = useState(null);
  const [payPayable, setPayPayable] = useState(null);
  return (
  <div data-testid="mf-payables">
      <div className="flex items-center gap-2 mb-2">
        <ArrowUpRight size={15} className="text-red-500" />
        <h3 className="text-sm font-semibold text-gray-700">Money out — paid vs outstanding</h3>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
        {moneyOutStreams.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">No mill payables.</div>
        ) : moneyOutStreams.map((s) => {
          const pct = s.billed > 0 ? Math.round((s.paid / s.billed) * 100) : 0;
          const rows = moneyOutPayables.filter((p) => p.stream === s.stream);
          const isOpen = openStream === s.stream;
          const canExpand = rows.length > 0;
          return (
            <div key={s.stream}>
              {/* The only hint that these rows opened used to be a 14px grey
                  chevron and a grey "(n unpaid)" whisper, so people did not
                  know the detail — and the Pay buttons inside it — were
                  there at all. The chevron now sits in its own tinted
                  control, the unpaid count is a badge rather than a
                  parenthetical, and the row says in words what clicking
                  does. */}
              <button type="button" disabled={!canExpand}
                aria-expanded={canExpand ? isOpen : undefined}
                title={canExpand ? (isOpen ? `Hide the ${rows.length} unpaid ${s.stream} item(s)` : `Show the ${rows.length} unpaid ${s.stream} item(s) and pay them`) : undefined}
                onClick={() => setOpenStream(isOpen ? null : s.stream)}
                className={`w-full text-left p-3 transition-colors ${canExpand ? 'hover:bg-blue-50/50 cursor-pointer' : 'cursor-default'}`}>
                <div className="flex items-center justify-between text-sm gap-2">
                  <span className="font-medium text-gray-800 flex items-center gap-2 min-w-0">
                    {canExpand && (
                      <span className={`shrink-0 grid place-items-center w-5 h-5 rounded-md border transition-colors ${isOpen ? 'bg-blue-100 border-blue-200 text-blue-700' : 'bg-gray-100 border-gray-200 text-gray-600'}`}>
                        <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      </span>
                    )}
                    <span className="truncate">{s.stream}</span>
                    {canExpand && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                        {rows.length} unpaid
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-gray-500 text-xs">{PKR(s.billed)} billed</span>
                    {canExpand && (
                      <span className="hidden sm:inline text-[11px] font-medium text-blue-600">
                        {isOpen ? 'Hide' : 'View & pay'}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-amber-100 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px]">
                  <span className="text-emerald-600">{PKR(s.paid)} paid ({pct}%)</span>
                  <span className="text-amber-600">{PKR(s.outstanding)} outstanding</span>
                </div>
              </button>
              {isOpen && canExpand && (
                <div className="bg-gray-50/70 border-t border-gray-100 divide-y divide-gray-100">
                  {rows.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 pl-8 text-sm">
                      <div className="min-w-0">
                        <div className="text-gray-800 truncate">{p.party}</div>
                        <div className="text-[11px] text-gray-400">
                          {p.category}{p.ref ? ` · ${p.ref}` : ''}
                          {p.dueDate ? ` · due ${fmtDate(p.dueDate)}` : ''}
                          {p.paid > 0 ? ` · ${PKR(p.paid)} paid` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="tabular-nums text-amber-700 font-medium">{PKR(p.outstanding)}</span>
                        {canPay && (
                          <button type="button"
                            onClick={() => setPayPayable({ payableId: p.id, party: p.party, outstanding: p.outstanding, ref: p.ref, stream: p.stream })}
                            className="px-2.5 py-1 text-xs text-white bg-emerald-600 rounded-md hover:bg-emerald-700">Pay</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-gray-400">Click a stream to see and pay each unpaid bill.</p>
    {payPayable && <PayPayableDrawer payTarget={payPayable} onClose={() => setPayPayable(null)} addToast={addToast} />}
  </div>
  );
}
