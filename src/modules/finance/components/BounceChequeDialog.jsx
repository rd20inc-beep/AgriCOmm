import { useEffect, useState } from 'react';
import { Ban, Loader2, X } from 'lucide-react';
import { AccountSelect } from '../../../components/payments/PaymentFields';
import { fmtMoney as fmtMoneyBase, todayLocalISO } from '../../../shared/utils/format';
import { btnSecondary, btnDanger } from '../utils/uiClasses';
import { bounceFormError, bouncePayload } from '../utils/chequeBounce';

const fmtMoney = (n, cur) => fmtMoneyBase(parseFloat(n) || 0, cur || 'PKR', { decimals: 2 });
const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900';
const lbl = 'block text-xs font-medium text-gray-600 mb-1';

/**
 * Mark an uncleared cheque bounced (B1). Nothing had settled, moved or posted
 * while it was uncleared, so the bill / receivable it was against simply
 * reopens. The bank's return charge is optional; it comes off the account
 * picked (default: the cheque's) as Bank Charges.
 * `item`: { paymentId, paymentNo, reference, amount, currency, bankAccountId, party, partyType }.
 * `onConfirm(body)` gets the request body for POST /payments/:id/bounce.
 */
export default function BounceChequeDialog({ item, accounts = [], busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [charge, setCharge] = useState('');
  const [chargeDate, setChargeDate] = useState(todayLocalISO());
  const recorded = item?.bankAccountId ? String(item.bankAccountId) : '';
  const [accountId, setAccountId] = useState(recorded && accounts.some((a) => String(a.id) === recorded) ? recorded : '');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [item, busy, onCancel]);
  if (!item) return null;

  const form = { reason, charge, chargeDate, accountId };
  const error = bounceFormError(form);
  const hasCharge = Number(charge) > 0;
  const acct = accounts.find((a) => String(a.id) === String(accountId));
  const isIn = item.partyType === 'customer';
  const submit = () => { setTouched(true); if (!error) onConfirm(bouncePayload(form)); };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="bounce-cheque-title">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} />
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-xl">
        <div className="flex items-start gap-3 p-5 pb-3">
          <span className="shrink-0 w-9 h-9 rounded-full bg-red-50 inline-flex items-center justify-center">
            <Ban className="w-5 h-5 text-red-600" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="bounce-cheque-title" className="text-sm font-semibold text-gray-900 break-words">
              Mark cheque{item.reference ? ` ${item.reference}` : ''}{item.paymentNo ? ` (${item.paymentNo})` : ''} bounced?
            </h3>
            <p className="mt-1 text-xs text-gray-600 leading-snug break-words">
              No money moved while it was uncleared, so nothing is reversed: {isIn ? `${item.party || 'the customer'}'s receivable` : `the bill to ${item.party || 'the supplier'}`} reopens for its full amount. The cheque stays on record as Bounced.
            </p>
          </div>
          <button type="button" onClick={() => !busy && onCancel()} className="shrink-0 -mr-2 -mt-1 inline-flex items-center justify-center w-10 h-10 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mx-5 mb-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Cheque amount</p>
          <p className="text-lg font-bold text-gray-900 break-words tabular-nums">{fmtMoney(item.amount, item.currency)}</p>
        </div>
        <div className="px-5 pb-1 space-y-3">
          <div>
            <label className={lbl} htmlFor="bounce-reason">Reason *</label>
            <input id="bounce-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Insufficient funds, signature mismatch" className={inp} maxLength={2000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl} htmlFor="bounce-charge">Bank charge{acct ? ` (${acct.currency || 'PKR'})` : ''}</label>
              <input id="bounce-charge" type="number" min="0" step="0.01" value={charge} onChange={(e) => setCharge(e.target.value)}
                placeholder="0" className={`${inp} text-right tabular-nums`} />
            </div>
            {hasCharge && (
              <div>
                <label className={lbl} htmlFor="bounce-charge-date">Charged on</label>
                <input id="bounce-charge-date" type="date" value={chargeDate} onChange={(e) => setChargeDate(e.target.value)} className={inp} />
              </div>
            )}
          </div>
          {hasCharge && (
            <>
              <AccountSelect id="bounce-charge-account" accounts={accounts} value={accountId} onChange={setAccountId}
                label="Account the bank charged *" />
              <p className="text-[11px] text-gray-500">Posts Dr 6200 Bank Charges / Cr this account&apos;s ledger, and takes it off the balance.</p>
            </>
          )}
          {touched && error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 p-5 pt-3">
          <button type="button" onClick={onCancel} disabled={busy} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} data-action="confirm-bounce" className={btnDanger}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Mark bounced
          </button>
        </div>
      </div>
    </div>
  );
}
