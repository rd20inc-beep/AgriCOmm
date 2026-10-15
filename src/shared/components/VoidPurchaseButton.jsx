import { useState } from 'react';
import { Ban } from 'lucide-react';
import useConfirm from '../../hooks/useConfirm';
import { useOwnerAuth } from '../../context/OwnerAuthContext';

/**
 * "Void purchase" for a purchase lot or a mill-store purchase (P3-11, D-23).
 * Asks for a reason, then the Owner's authorization, then calls
 * `onVoid({ reason, authorized_by_owner_id })`. The server refuses (and says
 * what to undo first) once anything was paid on the purchase or drawn from it.
 */
export default function VoidPurchaseButton({ label, onVoid, onDone, addToast, className = 'btn btn-sm btn-secondary' }) {
  const [confirm, confirmDialog] = useConfirm();
  const { requestOwnerApproval } = useOwnerAuth();
  const [busy, setBusy] = useState(false);

  async function run() {
    const ok = await confirm({
      title: `Void ${label}?`,
      consequence: 'The purchase is kept on record as voided. Its stock, every bill on it and its ledger postings come back out. Only possible while nothing has been paid on it and nothing has been used from it. Needs the Owner\'s authorization.',
      reason: 'required',
      confirmLabel: 'Void purchase',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await requestOwnerApproval((ownerId) => onVoid({ reason: ok.reason, authorized_by_owner_id: ownerId }), { label: `Void ${label}` });
      addToast?.(`${label} voided`, 'success');
      onDone?.();
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Could not void the purchase', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={run} disabled={busy} className={className}>
        <Ban className="w-3.5 h-3.5" /> {busy ? 'Voiding…' : 'Void purchase'}
      </button>
      {confirmDialog}
    </>
  );
}
