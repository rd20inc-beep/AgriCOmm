import { useMemo, useState } from 'react';
import { Search, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import StatusBadge from '../../../shared/components/StatusBadge';
import { useAuth } from '../../../context/AuthContext';
import { useReceivables, usePayables } from '../../../api/queries';
import { contextForDocument } from '../../../components/payments/paymentVariants';
import { fmtDate } from '../../../shared/utils/format';
import { useFinanceDrawers } from './drawersContext';
import { fmtAmt, pickableDocuments } from './drawerLogic';


/**
 * The first step of the header's + Receive / + Pay: pick what the money is
 * for. Picking a document swaps this for the Payment form, pre-filled.
 */
export default function PaymentPickerDrawer({ mode = 'receive', party = null, onClose }) {
  const drawers = useFinanceDrawers();
  const { hasPermission } = useAuth();
  const [q, setQ] = useState(party?.name || '');
  const isIn = mode === 'receive';
  const { data: receivables = [], isLoading: rl } = useReceivables({}, { enabled: isIn });
  const { data: payables = [], isLoading: pl } = usePayables({}, { enabled: !isIn });
  const docs = useMemo(() => pickableDocuments(mode, isIn ? receivables : payables, hasPermission, q),
    [mode, isIn, receivables, payables, hasPermission, q]);

  return (
    <SlideDrawer open onClose={onClose} title={isIn ? 'Receive money' : 'Pay'} subtitle={isIn ? 'Pick what it is for' : 'Pick the bill'}
      icon={isIn ? ArrowDownLeft : ArrowUpRight} size="lg">
      <div className="space-y-3" data-testid="payment-picker">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search party or document"
            placeholder={isIn ? 'Customer, receivable or sale no…' : 'Supplier, transporter or bill no…'}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        {(isIn ? rl : pl) ? <p className="text-sm text-gray-400">Loading…</p>
          : !docs.length ? <p className="text-sm text-gray-400">Nothing open{q ? ' matches' : ''}.</p>
          : (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
              {docs.slice(0, 100).map((d) => {
                const r = d.row;
                const ctx = contextForDocument(d);
                return (
                  <button key={`${d.docKind}-${r.id}`} type="button" onClick={() => drawers?.replace({ kind: 'payment', doc: d })}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-emerald-50">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900 truncate">{ctx.party?.name || '—'}</span>
                      <span className="block text-[11px] text-gray-500 truncate">{ctx.ref}{r.type || r.category ? ` · ${r.type || r.category}` : ''}{r.dueDate ? ` · due ${fmtDate(r.dueDate)}` : ''}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={r.status} />
                      <span className="text-sm font-semibold tabular-nums">{fmtAmt(ctx.outstanding, ctx.currency)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
      </div>
    </SlideDrawer>
  );
}
