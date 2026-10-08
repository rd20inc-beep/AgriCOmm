import { useAuth } from '../../../context/AuthContext';
import { useReceivables, useReceivableReceipts, usePendingExportReceipts } from '../../../api/queries';
import StatusBadge from '../../../shared/components/StatusBadge';
import { fmtDate } from '../../../shared/utils/format';
import { useFinanceDrawers } from './drawersContext';
import { fmtAmt } from './drawerLogic';

function ReceiptRows({ receivable, onOpen }) {
  const { data, isLoading } = useReceivableReceipts(receivable?.id, 'export', !!receivable);
  const rows = data?.payments || [];
  if (!receivable) return null;
  if (isLoading) return <p className="text-xs text-gray-400 px-3 py-2">Loading…</p>;
  return rows.map((p) => (
    <button key={p.id} type="button" onClick={() => onOpen(p.id)} data-receipt={p.id}
      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50">
      <span className="min-w-0 truncate text-gray-600">{fmtDate(p.paymentDate)} · {p.paymentNo} · {receivable.type}{p.accountName ? ` · ${p.accountName}` : ''}</span>
      <span className="tabular-nums font-medium text-emerald-700">{fmtAmt(p.amount, p.currency || receivable.currency)}</span>
    </button>
  ));
}

/**
 * An export order's receipts — the posted ones (per advance / balance
 * receivable) and those still waiting for Finance — each opening the
 * Transaction drawer. Reads /api/finance (finance.view); a role whose
 * receivables arrive without the order link (party-masked) sees nothing here.
 */
export default function OrderReceipts({ orderDbId }) {
  const { hasPermission } = useAuth();
  const drawers = useFinanceDrawers();
  const canView = hasPermission('finance', 'view');
  const { data: receivables = [] } = useReceivables({}, { enabled: canView });
  const { data: pending = [] } = usePendingExportReceipts({ enabled: canView });
  if (!canView || !drawers?.openTransaction) return null;
  const mine = receivables.filter((r) => r.kind !== 'local_sale' && String(r.orderId) === String(orderDbId));
  const adv = mine.find((r) => r.type === 'Advance');
  const bal = mine.find((r) => r.type === 'Balance');
  const waiting = (Array.isArray(pending) ? pending : []).filter((p) => String(p.orderId) === String(orderDbId));
  if (!adv && !bal && !waiting.length) return null;
  const open = (id) => drawers.openTransaction('payment', id);
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" data-testid="order-receipts">
      <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-800">Receipts</div>
      <div className="divide-y divide-gray-100">
        {waiting.map((p) => (
          <button key={`p-${p.id}`} type="button" onClick={() => open(p.id)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-amber-50">
            <span className="min-w-0 truncate text-gray-600">{fmtDate(p.paymentDate)} · {p.receiptType} · recorded by {p.recordedByName || '—'}</span>
            <span className="flex items-center gap-2 shrink-0">
              <StatusBadge status="Pending" />
              <span className="tabular-nums font-medium">{fmtAmt(p.amount, p.currency || 'USD')}</span>
            </span>
          </button>
        ))}
        <ReceiptRows receivable={adv} onOpen={open} />
        <ReceiptRows receivable={bal} onOpen={open} />
      </div>
    </div>
  );
}
