import { useState } from 'react';
import { Banknote } from 'lucide-react';
import SlideDrawer from '../SlideDrawer';
import PaymentFields from './PaymentFields';
import PaymentHistory from './PaymentHistory';
import { blankPaymentForm, paymentPayload, paymentFieldError } from './paymentPayload';

/**
 * One drawer for settling a payable or a receivable.
 *
 * It replaces a family of near-identical drawers — the transporter payment, the
 * Money Out payable, the printed-bag vendor, the mill-store purchase — that had
 * each been copied from the last one and then diverged: one validated the
 * overpayment, one did not; one offered the WHT block, one did not; one sent
 * `due_date` and one dropped the cheque clearing date on the floor. The
 * arithmetic and the payload now have a single source (`paymentPayload.js`), and
 * each host passes what is genuinely its own: what is being settled, what it is
 * worth, and what to say when it is done.
 *
 *   <PaymentDrawer
 *     title={`Pay ${hauler.name}`} subtitle={`${money(out)} due`}
 *     summary={[['Outstanding', money(out)]]}
 *     outstanding={out} payableId={p.payableId}
 *     accounts={bankAccounts} defaultNotes={`Transport payment — ${hauler.name}`}
 *     onSubmit={(body) => recordMut.mutateAsync(body)}
 *     onDone={() => { addToast('Transporter paid', 'success'); onClose(); }}
 *     onClose={onClose} addToast={addToast} />
 */
export default function PaymentDrawer({
  open = true, onClose, addToast,
  title, subtitle, icon = Banknote, size = 'md',
  // What is being settled
  outstanding = null, payableId = null, receivableId = null,
  type = 'payment', currency = 'PKR',
  // Presentation
  summary = [],                   // [[label, value], …] above the form
  banner = null,                  // a node shown above the fields (e.g. a cash-account warning)
  children = null,                // anything extra below the fields (e.g. an invoice picker)
  submitLabel,
  amountLabel = 'Amount to pay *',
  extras = true,
  filterAccountsByMethod = false,
  // Behaviour
  accounts = [],
  fixedAccountId,                 // pay from a fixed account; hides the picker
  defaultMethod = 'bank_transfer',
  defaultAmount,                  // undefined → prefill with the outstanding
  defaultNotes = '',
  capAmount = true,               // refuse more than the outstanding
  history, historyLoading, historyCompact = true,
  onSubmit, onDone,
}) {
  const prefill = defaultAmount !== undefined
    ? defaultAmount
    : (outstanding != null ? String(outstanding) : '');
  const [form, setForm] = useState(() => blankPaymentForm({ amount: prefill, method: defaultMethod }));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  // Editing a field clears the message shown under it.
  const set = (k, v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  async function submit(e) {
    e?.preventDefault?.();
    if (saving) return;
    const problem = paymentFieldError(form, {
      outstanding: capAmount ? outstanding : null,
      requireAccount: fixedAccountId === undefined,
      currency,
    });
    if (problem) {
      setErrors({ [problem.field]: problem.message });
      addToast?.(problem.message, 'error');
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSubmit(paymentPayload(form, {
        type, currency, payableId, receivableId, notes: defaultNotes,
        ...(fixedAccountId !== undefined ? { bankAccountId: fixedAccountId } : {}),
      }), form);
      onDone?.(form);
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Payment failed', 'error');
    } finally { setSaving(false); }
  }

  const label = submitLabel || (type === 'receipt' ? 'Record Receipt' : 'Record Payment');
  return (
    <SlideDrawer open={open} onClose={onClose} title={title} subtitle={subtitle} icon={icon} size={size}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button type="submit" form="payment-drawer-form" disabled={saving}
            className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60">
            {saving ? 'Processing…' : label}
          </button>
        </div>
      )}>
      <form id="payment-drawer-form" onSubmit={submit} className="space-y-4">
        {summary.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
            {summary.filter(Boolean).map(([k, v], i) => (
              <div key={k || i} className="flex justify-between">
                <span className="text-gray-500">{k}</span>
                <span className={i === summary.length - 1 ? 'font-semibold text-amber-700' : 'text-gray-700'}>{v}</span>
              </div>
            ))}
          </div>
        )}
        {banner}
        <PaymentFields
          form={form} set={set} accounts={accounts}
          currency={currency} addToast={addToast} amountLabel={amountLabel}
          max={capAmount && outstanding != null ? outstanding : undefined}
          extras={extras}
          hideAccount={fixedAccountId !== undefined}
          filterAccountsByMethod={filterAccountsByMethod}
          errors={errors}
        />
        {children}
        {(history !== undefined || historyLoading) && (
          <PaymentHistory payments={history} loading={historyLoading} currency={currency} compact={historyCompact} />
        )}
      </form>
    </SlideDrawer>
  );
}
