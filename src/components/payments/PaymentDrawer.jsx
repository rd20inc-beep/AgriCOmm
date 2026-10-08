import { useState } from 'react';
import { Banknote } from 'lucide-react';
import SlideDrawer from '../SlideDrawer';
import PaymentFields from './PaymentFields';
import PaymentHistory from './PaymentHistory';
import { blankPaymentForm, paymentPayload, paymentFieldError } from './paymentPayload';

// The Finance-wide button styles (one filled primary at the right).
const btnBase = 'inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap px-3.5 min-h-10 sm:min-h-9 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';
const btnPrimary = `${btnBase} text-white bg-blue-600 hover:bg-blue-700`;
const btnSecondary = `${btnBase} text-gray-700 bg-white border border-gray-200 hover:bg-gray-50`;

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
  // Contextual variants (paymentVariants.js). `buildBody(form)` replaces the
  // recordPayment body for an endpoint that reads other fields; `methods`,
  // `cashLocation`, `taxes`, `attach` shape the form to what that endpoint
  // accepts; `requireAccountFor(form)` says when an account must be picked;
  // `initial` seeds inherited values (account, rate, collection point);
  // `renderExtra({ form, set })` adds a variant's own field.
  buildBody = null,
  methods, cashLocation = false, taxes = true, attach = true,
  requireAccountFor = null, initial = {}, renderExtra = null,
  formId = 'payment-drawer-form',
}) {
  const prefill = defaultAmount !== undefined
    ? defaultAmount
    : (outstanding != null ? String(outstanding) : '');
  const [form, setForm] = useState(() => blankPaymentForm({ ...initial, amount: prefill, method: defaultMethod }));
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
      requireAccount: fixedAccountId === undefined && (requireAccountFor ? requireAccountFor(form) : true),
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
      const body = buildBody ? buildBody(form) : paymentPayload(form, {
        type, currency, payableId, receivableId, notes: defaultNotes,
        ...(fixedAccountId !== undefined ? { bankAccountId: fixedAccountId } : {}),
      });
      await onSubmit(body, form);
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
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" form={formId} disabled={saving} className={btnPrimary}>
            {saving ? 'Processing…' : label}
          </button>
        </div>
      )}>
      <form id={formId} onSubmit={submit} className="space-y-4">
        {summary.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1" data-testid="payment-context">
            {summary.filter(Boolean).map(([k, v], i) => (
              <div key={k || i} className="flex justify-between gap-3">
                <span className="text-gray-500 shrink-0">{k}</span>
                <span className={`text-right min-w-0 break-words ${i === summary.length - 1 ? 'font-semibold text-gray-900 tabular-nums' : 'text-gray-700'}`}>{v}</span>
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
          {...(methods ? { methods } : {})}
          cashLocation={cashLocation} taxes={taxes} attach={attach}
        />
        {renderExtra && renderExtra({ form, set })}
        {children}
        {(history !== undefined || historyLoading) && (
          <PaymentHistory payments={history} loading={historyLoading} currency={currency} compact={historyCompact} />
        )}
      </form>
    </SlideDrawer>
  );
}
