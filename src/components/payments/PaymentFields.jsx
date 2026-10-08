import { useEffect, useState } from 'react';
import { Percent, Paperclip, FileText, X, ChevronDown } from 'lucide-react';
import api from '../../api/client';
import { favStar } from '../../shared/utils/favorites';
import FieldError from '../../shared/components/FieldError';
import { PAYMENT_METHODS, money, netCash, pickAccountForMethod, CHEQUE_DATE_LABEL, CHEQUE_HINT } from './paymentPayload';
import { accountsForCurrency } from '../../shared/utils/accountCurrency';

/**
 * The payment form body: amount, method, date, account, reference, and the
 * optional tax/discount/document block. Shared by every screen that records a
 * payment, so a change to the method list or the account picker lands
 * everywhere at once instead of on whichever screen someone remembered.
 *
 * Takes `form` and `set` rather than owning the state: each host drawer still
 * decides what it submits, what it defaults, and what else it shows.
 */

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 min-h-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
const lbl = 'block text-xs font-medium text-gray-600 mb-1';

/**
 * A label string ending in " *" (the convention callers pass, e.g.
 * 'Amount to pay *') renders its asterisk in the house required-field red.
 */
export function RequiredLabel({ text }) {
  if (typeof text !== 'string' || !text.endsWith(' *')) return text;
  return <>{text.slice(0, -2)} <span className="text-red-500">*</span></>;
}

/**
 * What recording a cheque does — nothing, until it is cleared in Due Dates.
 * Shown wherever a cheque can be recorded, in the same words.
 */
export function ChequeHint({ className = '' }) {
  return <p className={`mt-1 text-[11px] text-amber-700 ${className}`}>{CHEQUE_HINT}</p>;
}

/** Cash / bank account picker. Favourites first, cash accounts marked. */
export function AccountSelect({ accounts = [], value, onChange, label = 'Cash / Bank account *', id, error }) {
  return (
    <div>
      <label className={lbl} htmlFor={id}><RequiredLabel text={label} /></label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inp}>
        <option value="">Select account…</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {favStar(a)}{a.name}{a.bankName ? ` — ${a.bankName}` : ''}{a.type === 'cash' ? ' (Cash)' : ''}
          </option>
        ))}
      </select>
      <FieldError error={error} />
    </div>
  );
}

/**
 * Withholding tax, early-payment discount and the supporting document.
 *
 * WHT and the discount reduce the cash paid but not the amount settled: the
 * vendor's claim clears in full, the tax is remitted to FBR and the discount is
 * income. The net is shown so whoever is paying can check it against the cheque
 * they are about to write.
 */
export function PaymentExtras({ form, set, gross, currency = 'PKR', addToast, errors = {}, taxes = true, attach = true }) {
  const [uploading, setUploading] = useState(false);

  const onRate = (v) => {
    set('whtRate', v);
    const pct = parseFloat(v);
    if (Number.isFinite(pct) && gross > 0) set('whtAmount', String(Math.round(gross * pct) / 100));
  };

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload('/api/finance/payments/attachment', fd);
      const d = res?.data || res;
      if (d?.url) { set('attachmentUrl', d.url); set('attachmentName', d.name || file.name); }
      else if (res?._offlineQueued) addToast?.('Offline — the document will upload when the connection returns.', 'info');
      else throw new Error('Upload failed');
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Attachment upload failed', 'error');
    } finally { setUploading(false); }
  }

  if (!taxes && !attach) return null;
  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-3 bg-white">
      <div className="text-xs font-semibold text-gray-600">{taxes ? <>Tax, discount &amp; document</> : 'Supporting document'} <span className="font-normal text-gray-500">(optional)</span></div>
      {taxes && (<>
      <div className="grid grid-cols-1 min-[400px]:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1 inline-flex items-center gap-1" htmlFor="pay-wht-rate"><Percent size={11} aria-hidden="true" /> WHT rate</label>
          <input id="pay-wht-rate" type="number" step="0.01" min="0" max="100" value={form.whtRate || ''} onChange={(e) => onRate(e.target.value)} placeholder="e.g. 2" className={inp} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="pay-wht-amount">WHT amount</label>
          <input id="pay-wht-amount" type="number" step="0.01" min="0" value={form.whtAmount || ''} onChange={(e) => set('whtAmount', e.target.value)} placeholder="0" className={inp} />
          <FieldError error={errors.whtAmount} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="pay-discount">Discount</label>
          <input id="pay-discount" type="number" step="0.01" min="0" value={form.discountAmount || ''} onChange={(e) => set('discountAmount', e.target.value)} placeholder="0" className={inp} />
        </div>
      </div>
      <div className="flex items-center justify-between text-xs bg-gray-50 rounded-md border border-gray-200 px-3 py-2">
        <span className="text-gray-500">Net cash to pay</span>
        <span className="font-semibold text-gray-800 tabular-nums">{money(netCash(form), currency)}</span>
      </div>
      </>)}
      {attach && (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1 inline-flex items-center gap-1"><Paperclip size={11} aria-hidden="true" /> Supporting document</label>
        {form.attachmentUrl ? (
          <div className="flex items-center justify-between text-xs bg-gray-50 rounded-md border border-gray-200 px-3 py-1">
            <span className="text-gray-700 truncate inline-flex items-center gap-1.5"><FileText size={13} className="text-emerald-600" aria-hidden="true" /> {form.attachmentName || 'Attached'}</span>
            <button type="button" onClick={() => { set('attachmentUrl', ''); set('attachmentName', ''); }} aria-label="Remove attachment" title="Remove attachment" className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-red-600 hover:bg-red-50"><X size={14} aria-hidden="true" /></button>
          </div>
        ) : (
          <input type="file" onChange={onFile} disabled={uploading}
            className="block w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-gray-200 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50" />
        )}
        {uploading && <p className="text-xs text-gray-500 mt-1">Uploading…</p>}
      </div>
      )}
    </div>
  );
}

/**
 * A collapsible "More details" block for a form's optional fields. Its content
 * stays mounted (a closed <details> only hides it), so values, uploads and
 * validation keep working. `forceOpen` opens it when it holds a value or an
 * error, so nothing the user typed or must fix is ever hidden.
 */
export function MoreDetails({ hint, forceOpen = false, children }) {
  const [open, setOpen] = useState(forceOpen);
  const isOpen = open || forceOpen;
  return (
    <details open={isOpen} onToggle={(e) => setOpen(e.currentTarget.open)} className="group rounded-lg border border-gray-200 bg-gray-50/60" data-testid="more-details">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 min-h-11 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden">
        <span>More details{hint && <span className="ml-1.5 text-xs font-normal text-gray-500">({hint} — optional)</span>}</span>
        <ChevronDown size={16} className="shrink-0 text-gray-400 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-3">{children}</div>
    </details>
  );
}

/**
 * Amount · method · date · account · reference, and the cheque clearing date
 * when the method is a cheque — the due date the Due Dates dashboard reads.
 */
export default function PaymentFields({
  form, set, accounts: allAccounts = [], currency = 'PKR', addToast,
  amountLabel = 'Amount to pay *', max, extras = true, remarks = true, idPrefix = 'pay',
  // A screen that pays from a fixed account (Mill Cash, say) has nothing to
  // pick, so it says so rather than rendering an empty picker.
  hideAccount = false,
  // Cash comes out of a cash account and a transfer out of a bank one. Where a
  // screen already enforced that, it keeps doing so; elsewhere every account is
  // offered with the cash ones marked, as before.
  filterAccountsByMethod = false,
  // { amount, whtAmount, bankAccountId } → message, shown under that field
  // (see paymentErrors in paymentPayload.js).
  errors = {},
  // The methods this path accepts (paymentVariants.js); defaults to the four.
  methods = PAYMENT_METHODS,
  // Cash on a local sale / service invoice lands by WHERE it was collected
  // (Mill Cash / Office Petty Cash): the account pick becomes that choice.
  cashLocation = false,
  // Which parts of the optional block this path's endpoint reads.
  taxes = true, attach = true,
}) {
  // A non-PKR (e.g. USD) account carries only its own currency; a PKR account
  // takes any (the server refuses the rest).
  const accounts = accountsForCurrency(allAccounts, currency);
  const accountOptions = filterAccountsByMethod
    ? accounts.filter((a) => (form.method === 'cash' ? a.type === 'cash' : a.type !== 'cash'))
    : accounts;

  // Changing the method drops an account that no longer suits it — a bank
  // account left selected after switching to Cash made the "cash" payment
  // leave the bank.
  const onMethod = (method) => {
    set('method', method);
    if (hideAccount || !form.bankAccountId) return;
    const kept = pickAccountForMethod({ accounts, method, current: form.bankAccountId });
    if (kept !== String(form.bankAccountId)) set('bankAccountId', kept);
  };

  // Nothing chosen: take the only account that suits the method, else the
  // starred one. Never an account of the wrong kind, and never over a choice
  // the user has made.
  const accountKey = accounts.map((a) => `${a.id}:${a.type}:${a.isFavorite || a.is_favorite ? 1 : 0}`).join(',');
  useEffect(() => {
    if (hideAccount || form.bankAccountId) return;
    const next = pickAccountForMethod({ accounts, method: form.method, current: '' });
    if (next) set('bankAccountId', next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideAccount, form.method, form.bankAccountId, accountKey]);
  return (
    <>
      <div>
        <label className={lbl} htmlFor={`${idPrefix}-amount`}><RequiredLabel text={amountLabel} /></label>
        <input id={`${idPrefix}-amount`} type="number" step="0.01" min="0" max={max}
          value={form.amount} onChange={(e) => set('amount', e.target.value)} className={inp} />
        <FieldError error={errors.amount} />
      </div>
      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3">
        <div>
          <label className={lbl} htmlFor={`${idPrefix}-method`}>Method</label>
          <select id={`${idPrefix}-method`} value={form.method} onChange={(e) => onMethod(e.target.value)} className={inp}>
            {methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} htmlFor={`${idPrefix}-date`}>Date</label>
          <input id={`${idPrefix}-date`} type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inp} />
        </div>
      </div>
      {cashLocation && form.method === 'cash' && (
        <div>
          <span className={lbl}>Cash collected at</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Cash collected at">
            {['Mill', 'Head Office'].map((loc) => (
              <button key={loc} type="button" role="radio" aria-checked={(form.collectionLocation || 'Mill') === loc}
                onClick={() => set('collectionLocation', loc)}
                className={`px-3 min-h-10 text-sm font-medium rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${(form.collectionLocation || 'Mill') === loc ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>{loc}</button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">{(form.collectionLocation || 'Mill') === 'Head Office' ? 'Lands in Office Petty Cash.' : 'Lands in Mill Cash.'}</p>
        </div>
      )}
      {!hideAccount && !(cashLocation && form.method === 'cash') && (
        <AccountSelect id={`${idPrefix}-account`} accounts={accountOptions}
          label={form.method === 'cheque' ? 'Bank account it will clear through (optional)'
            : filterAccountsByMethod && form.method === 'cash' ? 'Cash account *' : 'Cash / Bank account *'}
          value={form.bankAccountId} onChange={(v) => set('bankAccountId', v)} error={errors.bankAccountId} />
      )}
      <div>
        <label className={lbl} htmlFor={`${idPrefix}-ref`}>
          {form.method === 'cheque' ? 'Cheque #' : 'Cheque / Transaction reference'}
        </label>
        <input id={`${idPrefix}-ref`} type="text" value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Optional" className={inp} />
      </div>
      {/* A cheque is money that has not moved yet; its clearing date is what the
          Due Dates dashboard counts down to. */}
      {form.method === 'cheque' && (
        <div>
          <label className={lbl} htmlFor={`${idPrefix}-due`}>{CHEQUE_DATE_LABEL} <span className="text-gray-400 font-normal">(optional)</span></label>
          <input id={`${idPrefix}-due`} type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} className={inp} />
          <ChequeHint />
        </div>
      )}
      {/* Optional fields — folded under "More details" so the form leads
          with what every payment needs. Opens by itself when one of them
          already has a value or an error. */}
      {(extras || remarks) && (
        <MoreDetails
          hint={[extras && taxes ? 'tax, discount' : null, extras && attach ? 'document' : null, remarks ? 'remarks' : null].filter(Boolean).join(', ')}
          forceOpen={!!(errors.whtAmount || form.whtRate || form.whtAmount || form.discountAmount || form.attachmentUrl || form.notes)}>
          {extras && <PaymentExtras form={form} set={set} gross={parseFloat(form.amount) || 0} currency={currency} addToast={addToast} errors={errors} taxes={taxes} attach={attach} />}
          {remarks && (
            <div>
              <label className={lbl} htmlFor={`${idPrefix}-notes`}>Remarks</label>
              <textarea id={`${idPrefix}-notes`} value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} placeholder="Optional" className={inp} />
            </div>
          )}
        </MoreDetails>
      )}
    </>
  );
}
