import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

/**
 * One confirmation dialog for actions that cannot be undone.
 *
 * 27 files confirmed a reversal or a delete with `window.confirm`, and 10
 * collected a reason with `window.prompt`. Those cannot show the consequence,
 * cannot be styled, trap no focus, and look like the browser rather than the
 * application — in a system where the action being confirmed often moves money
 * and unwinds GL entries.
 *
 * It is deliberately small and uncontrolled by a form library: the call sites it
 * replaces are one-liners, and anything more would not get adopted.
 *
 *   const confirm = useConfirm();
 *   if (!await confirm({
 *     title: `Reverse payment ${p.paymentNo}?`,
 *     consequence: 'The bank balance is restored and its GL entries are reversed.',
 *     amount: 'Rs 221,000.00',
 *     reason: 'optional',          // 'optional' | 'required' | undefined
 *     confirmLabel: 'Reverse',
 *   })) return;
 *
 * Resolves `false` when dismissed, or `{ reason }` when confirmed — so a bare
 * `if (!await confirm(...)) return;` reads the same as the `window.confirm` it
 * replaces, and a reason is available where one is asked for.
 */
export default function ConfirmDialog({
  open, title, consequence, amount, reason, confirmLabel = 'Confirm',
  cancelLabel = 'Cancel', danger = true, busy = false, onConfirm, onCancel,
}) {
  const [text, setText] = useState('');
  const confirmRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => { if (open) setText(''); }, [open]);

  // Escape closes, and focus starts on the dialog rather than wherever the page
  // left it — the native dialog did both and losing them would be a regression.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
      // A confirm whose button is focused should not also submit a form behind it.
      if (e.key === 'Enter' && reason !== 'required') { e.preventDefault(); confirmRef.current?.click(); }
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      (reason ? panelRef.current?.querySelector('textarea') : confirmRef.current)?.focus();
    }, 50);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [open, onCancel, reason]);

  if (!open) return null;
  const blocked = reason === 'required' && !text.trim();

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel?.()} />
      <div ref={panelRef} className="relative w-full max-w-md bg-white rounded-xl shadow-xl">
        <div className="flex items-start gap-3 p-5 pb-3">
          {danger && (
            <span className="shrink-0 w-9 h-9 rounded-full bg-red-50 inline-flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {/* break-words: a lot number or a document reference in the title
                must wrap rather than push the panel wide. */}
            <h3 id="confirm-title" className="text-sm font-semibold text-gray-900 break-words">{title}</h3>
            {consequence && <p className="mt-1 text-xs text-gray-600 leading-snug break-words">{consequence}</p>}
          </div>
          <button onClick={() => !busy && onCancel?.()} className="shrink-0 text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* The figure the action moves, stated plainly — the single thing
            window.confirm could never show. */}
        {amount && (
          <div className="mx-5 mb-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center">
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Amount</p>
            <p className="text-lg font-bold text-gray-900 break-words">{amount}</p>
          </div>
        )}

        {reason && (
          <div className="px-5 pb-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Reason {reason === 'optional' && <span className="font-normal text-gray-400">(optional)</span>}
            </label>
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Recorded on the audit trail" />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 p-5 pt-3">
          <button onClick={() => onCancel?.()} disabled={busy}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">
            {cancelLabel}
          </button>
          <button ref={confirmRef} onClick={() => onConfirm?.({ reason: text.trim() })} disabled={busy || blocked}
            title={blocked ? 'Enter a reason to continue' : undefined}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
