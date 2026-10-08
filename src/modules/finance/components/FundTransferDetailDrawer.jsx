import { btnSecondary, btnDanger } from '../utils/uiClasses';
import { ArrowLeftRight, AlertTriangle, Paperclip, Pencil, Undo2 } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import StatusBadge from '../../../shared/components/StatusBadge';
import useConfirm from '../../../hooks/useConfirm';
import api from '../../../api/client';
import { useFundTransfer, useReverseFundTransfer } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { fmtMoney, fmtDate, fmtDateTime } from '../../../shared/utils/format';
import { DIRECTION_LABEL, entityLabel, transferStatusLabel } from '../utils/contraTransfer';

/**
 * One fund / contra transfer: both sides, amounts and currencies, rate,
 * charges, status and who did what — with Edit and Reverse for Owner /
 * Super Admin (the server enforces the same).
 */
// onNavigate(id) opens a linked transfer (the one it replaces / is replaced by).
export default function FundTransferDetailDrawer({ open, transferId, onClose, canManage = false, onEdit, onNavigate }) {
  const { data: t, isLoading } = useFundTransfer(open ? transferId : null);
  const reverseMut = useReverseFundTransfer();
  const { addToast } = useApp();
  const [confirm, confirmDialog] = useConfirm();

  async function handleReverse() {
    const internal = t.direction === 'internal';
    const ok = await confirm({
      title: `Reverse ${t.transferNo}?`,
      consequence: internal
        ? `The money goes back to ${t.fromAccountName} and comes out of ${t.toAccountName}${Number(t.bankCharges) > 0 ? '; the bank charges are reversed too' : ''}. The transfer stays on record as Reversed.`
        : 'Equal-and-opposite bank moves and journals are posted; the transfer stays on record as Reversed.',
      amount: fmtMoney(Number(t.amount) || 0, t.currency || 'PKR', { decimals: 2 }),
      reason: 'required',
      confirmLabel: 'Reverse transfer',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    try {
      await reverseMut.mutateAsync({ id: t.id, reason: ok.reason });
      addToast?.(`${t.transferNo} reversed.`, 'success');
    } catch (e) {
      addToast?.(e?.data?.message || e?.message || 'Could not reverse the transfer.', 'error');
    }
  }

  async function openAttachment() {
    try { await api.open(`/api/finance/fund-transfers/attachment/${encodeURIComponent(t.attachmentUrl)}`, t.attachmentName); }
    catch (e) { addToast?.(e?.message || 'Could not open the attachment.', 'error'); }
  }

  const row = (k, v) => (v == null || v === '' ? null : (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0 text-xs">
      <span className="text-gray-500 shrink-0">{k}</span><span className="text-right text-gray-900 break-words">{v}</span>
    </div>
  ));
  const link = (no, targetId) => (
    <button type="button" onClick={() => onNavigate?.(targetId)} className="text-blue-600 hover:underline font-medium">{no}</button>
  );
  const canAct = canManage && t && t.status !== 'reversed';

  return (
    <SlideDrawer open={open} onClose={onClose} size="lg" icon={ArrowLeftRight}
      title={t ? `${t.transferNo} · ${DIRECTION_LABEL[t.direction] || t.direction}` : 'Transfer'}
      subtitle={t ? `${t.fromAccountName || '—'} → ${t.toAccountName || '—'}` : ''}
      footer={canAct ? (
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={handleReverse} disabled={reverseMut.isPending} className={btnDanger}><Undo2 size={14} aria-hidden="true" /> Reverse</button>
          <button type="button" onClick={() => onEdit?.(t)} className={btnSecondary}><Pencil size={14} aria-hidden="true" /> Edit</button>
        </div>
      ) : null}>
      <div className="space-y-4">
        {isLoading || !t ? <div className="text-sm text-gray-500">Loading…</div> : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={transferStatusLabel(t)} />
              {t.fxUnbooked && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                  <AlertTriangle size={11} /> FX difference not booked — review
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">From · {entityLabel(t.fromEntity)}</div>
                <div className="text-sm font-medium text-gray-900 break-words">{t.fromAccountName || '—'}</div>
                <div className="text-base font-semibold text-red-600 tabular-nums">−{fmtMoney(Number(t.amount) || 0, t.currency || 'PKR', { decimals: 2 })}</div>
                {Number(t.bankCharges) > 0 && <div className="text-xs text-gray-600">+ bank charges {fmtMoney(Number(t.bankCharges), t.currency || 'PKR', { decimals: 2 })}</div>}
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">To · {entityLabel(t.toEntity)}</div>
                <div className="text-sm font-medium text-gray-900 break-words">{t.toAccountName || '—'}</div>
                <div className="text-base font-semibold text-emerald-600 tabular-nums">+{fmtMoney(Number(t.toAmount ?? t.amount) || 0, t.toCurrency || t.currency || 'PKR', { decimals: 2 })}</div>
                {t.status === 'pending' && <div className="text-xs text-amber-700">Awaiting the {entityLabel(t.toEntity)}'s acceptance</div>}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 px-3">
              {row('Date', fmtDate(t.transferDate))}
              {row('Reference', t.reference)}
              {t.fxRate != null && row('Exchange rate', t.rateBasis || String(Number(t.fxRate)))}
              {t.amountPkr != null && t.currency !== 'PKR' && row('PKR equivalent', fmtMoney(Number(t.amountPkr), 'PKR', { decimals: 2 }))}
              {row('Method', (t.method || '').replace('_', ' '))}
              {row('Notes', t.notes)}
              {t.attachmentUrl && row('Attachment', (
                <button type="button" onClick={openAttachment} className="inline-flex items-center gap-1 text-blue-600 hover:underline"><Paperclip size={12} /> {t.attachmentName || 'Open'}</button>
              ))}
              {row('Created', `${t.createdByName || '—'} · ${fmtDateTime(t.createdAt)}`)}
              {t.direction !== 'internal' && t.acceptedAt && row('Accepted', `${t.acceptedByName || '—'} · ${fmtDateTime(t.acceptedAt)}`)}
              {t.updatedBy && row('Last updated', `${t.updatedByName || '—'} · ${fmtDateTime(t.updatedAt)}`)}
              {t.status === 'reversed' && row('Reversed', `${t.reversedByName || '—'}${t.reversedAt ? ` · ${fmtDateTime(t.reversedAt)}` : ''}`)}
              {t.reversalReason && row('Reversal reason', t.reversalReason)}
              {t.replacesId && row('Replaces', link(t.replacesTransferNo || `#${t.replacesId}`, t.replacesId))}
              {t.replacedById && row('Replaced by', link(t.replacedByTransferNo || `#${t.replacedById}`, t.replacedById))}
            </div>

            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">Bank rows</div>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500"><tr>
                    {['Txn', 'Account', 'Type', 'Amount', 'Category'].map((h, i) => <th key={h} className={`px-2 py-1.5 font-medium ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {(t.bankTransactions || []).map((b) => (
                      <tr key={b.id} className="border-t border-gray-100">
                        <td className="px-2 py-1.5 text-gray-600">{b.transactionNo}</td>
                        <td className="px-2 py-1.5">{b.accountName}</td>
                        <td className="px-2 py-1.5">{b.type === 'credit' ? 'In' : 'Out'}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${b.type === 'credit' ? 'text-emerald-600' : 'text-red-600'}`}>{fmtMoney(Number(b.amount) || 0, b.currency || 'PKR', { decimals: 2 })}</td>
                        <td className="px-2 py-1.5 text-gray-600">{b.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="text-xs text-gray-600">
              <span className="font-semibold">Journals: </span>
              {(t.journals || []).length === 0
                ? (t.direction === 'internal' ? 'none — both accounts sit on GL 1000, so an internal transfer posts no journal.' : 'none')
                : t.journals.map((j) => `${j.journalNo} (${j.refType}${j.status !== 'Posted' ? `, ${j.status}` : ''})`).join(' · ')}
            </div>
          </>
        )}
      </div>
      {confirmDialog}
    </SlideDrawer>
  );
}
