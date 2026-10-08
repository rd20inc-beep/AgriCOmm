import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, AlertTriangle, CheckCircle, Loader2, X } from 'lucide-react';
import { useUpcoming, useClearCheque, useBankAccounts } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { AccountSelect } from '../../../components/payments/PaymentFields';
import { accountsForMethod, pickAccountForMethod } from '../../../components/payments/paymentPayload';
import { accountsForCurrency } from '../../../shared/utils/accountCurrency';
import { fmtPKR as fmtPKRBase, fmtMoney as fmtMoneyBase, fmtDate } from '../../../shared/utils/format';

// Exact, two decimals; each amount in its own currency (USD export receivables vs PKR dues).
const fmtPKR = (n) => fmtPKRBase(parseFloat(n) || 0, { decimals: 2 });
const fmtMoney = (n, cur) => fmtMoneyBase(parseFloat(n) || 0, cur || 'PKR', { decimals: 2 });
const isOverdue = (s) => s && new Date(s) < new Date(new Date().toDateString());

function List({ title, icon: Icon, tone, items, total, onClear, clearing }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className={`px-5 py-3 border-b border-gray-100 flex items-center justify-between ${tone === 'in' ? 'bg-emerald-50' : 'bg-red-50'}`}>
        <div className="flex items-center gap-2">
          <Icon size={16} className={tone === 'in' ? 'text-emerald-600' : 'text-red-600'} />
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <span className="text-xs text-gray-500">({items.length})</span>
        </div>
        <span className={`text-sm font-bold ${tone === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>{fmtPKR(total)}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">Nothing upcoming.</p>
      ) : (
        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-100">
              <th className="py-2 px-4">Due</th><th className="py-2 px-4">Party</th>
              <th className="py-2 px-4">Type</th><th className="py-2 px-4 text-right">Amount</th><th className="py-2 px-4"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((x, i) => (
                <tr key={i} className={`hover:bg-gray-50 ${isOverdue(x.dueDate) ? 'bg-red-50/40' : ''}`}>
                  <td data-label="Due" className="py-2 px-4 whitespace-nowrap">
                    <span className={isOverdue(x.dueDate) ? 'text-red-600 font-medium' : 'text-gray-700'}>{fmtDate(x.dueDate)}</span>
                    {isOverdue(x.dueDate) && <span className="ml-1.5 text-[10px] text-red-500 inline-flex items-center gap-0.5"><AlertTriangle size={10} /> overdue</span>}
                  </td>
                  <td data-label="Party" className="py-2 px-4 text-gray-900 break-words">
                    {x.partyId ? (
                      <Link to={`/finance/accounting/statements?type=${x.partyType}&id=${x.partyId}`}
                        className="text-blue-600 hover:underline font-medium">{x.party}</Link>
                    ) : x.party}
                  </td>
                  <td data-label="Type" className="py-2 px-4">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${x.kind === 'cheque' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{x.label}</span>
                    {x.reference && <span className="ml-1.5 text-[11px] text-gray-400 font-mono">{x.reference}</span>}
                  </td>
                  <td data-label="Amount" className="py-2 px-4 text-right tabular-nums font-medium text-gray-900">
                    {fmtMoney(x.amount, x.currency)}
                    {x.currency && x.currency !== 'PKR' && x.amountPkr ? <span className="block text-[10px] text-gray-400 font-normal">≈ {fmtPKR(x.amountPkr)}</span> : null}
                  </td>
                  <td data-label="" className="py-2 px-4 text-right">
                    {x.paymentId && (
                      <button onClick={() => onClear(x)} disabled={clearing}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 rounded hover:bg-emerald-100 disabled:opacity-50">
                        <CheckCircle size={12} /> Mark cleared
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Clearing a cheque is when the money actually moves: it settles the bill or
 * receivable, moves the bank and posts the ledger entry. So it asks which bank
 * account the cheque cleared through — preselected with the one named when the
 * cheque was recorded, else the only / starred bank account.
 */
export function ClearChequeDialog({ item, accounts: allAccounts, busy, onCancel, onConfirm }) {
  // A non-PKR account clears only cheques in its own currency.
  const accounts = accountsForCurrency(allAccounts, item?.currency);
  // null = not touched yet → show the default; a choice the user makes wins.
  // (Remounted per cheque via `key`, so a new cheque starts untouched.)
  const [picked, setPicked] = useState(null);
  const recorded = item?.bankAccountId ? String(item.bankAccountId) : '';
  const fallback = recorded && accounts.some((a) => String(a.id) === recorded)
    ? recorded
    : pickAccountForMethod({ accounts, method: 'cheque', current: '' });
  const accountId = picked ?? fallback;
  const setAccountId = setPicked;
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [item, busy, onCancel]);
  if (!item) return null;
  const isIn = item.partyType === 'customer';
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="clear-cheque-title">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} />
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-xl">
        <div className="flex items-start gap-3 p-5 pb-3">
          <span className="shrink-0 w-9 h-9 rounded-full bg-emerald-50 inline-flex items-center justify-center">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="clear-cheque-title" className="text-sm font-semibold text-gray-900 break-words">
              Clear cheque{item.reference ? ` ${item.reference}` : ''}{item.paymentNo ? ` (${item.paymentNo})` : ''}?
            </h3>
            <p className="mt-1 text-xs text-gray-600 leading-snug break-words">
              {isIn ? 'The money lands in the account below' : 'The money leaves the account below'}, {item.party || 'the party'}&apos;s balance is settled and the ledger entry is posted — today.
            </p>
          </div>
          <button onClick={() => !busy && onCancel()} className="shrink-0 text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="mx-5 mb-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Amount</p>
          <p className="text-lg font-bold text-gray-900 break-words">{fmtMoney(item.amount, item.currency)}</p>
        </div>
        <div className="px-5 pb-1">
          <AccountSelect id="clear-cheque-account" accounts={accounts} value={accountId} onChange={setAccountId}
            label="Bank account it cleared through *" />
        </div>
        <div className="flex items-center justify-end gap-2 p-5 pt-3">
          <button onClick={onCancel} disabled={busy}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">Cancel</button>
          <button onClick={() => onConfirm(accountId)} disabled={busy || !accountId}
            title={!accountId ? 'Choose the bank account' : undefined}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Mark cleared
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DueDates() {
  const { data, isLoading } = useUpcoming();
  const { data: allAccounts } = useBankAccounts();
  const { addToast } = useApp();
  const clearMut = useClearCheque();
  const [clearing, setClearing] = useState(null);
  const receiving = data?.receiving || [];
  const giving = data?.giving || [];
  // A cheque clears through a bank account, never a cash float.
  const bankAccounts = useMemo(() => accountsForMethod(allAccounts || [], 'cheque'), [allAccounts]);

  async function onConfirmClear(accountId) {
    const x = clearing;
    if (!x || !accountId) return;
    try {
      await clearMut.mutateAsync({ id: x.paymentId, data: { bank_account_id: parseInt(accountId, 10) } });
      addToast?.(`Cheque cleared — ${fmtMoney(x.amount, x.currency)} settled and posted`, 'success');
      setClearing(null);
    } catch (err) {
      addToast?.(err?.data?.message || err.message || 'Failed to clear cheque', 'error');
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">Uncleared cheques &amp; credit (udhaar) dues — when money is expected or due. A cheque settles only when you mark it cleared here.</p>
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <List title="Receiving (money in)" icon={ArrowDownLeft} tone="in" items={receiving} total={data?.totalReceiving || 0} onClear={setClearing} clearing={clearMut.isPending} />
          <List title="Giving (money out)" icon={ArrowUpRight} tone="out" items={giving} total={data?.totalGiving || 0} onClear={setClearing} clearing={clearMut.isPending} />
        </div>
      )}
      <ClearChequeDialog key={clearing?.paymentId || 'none'} item={clearing} accounts={bankAccounts} busy={clearMut.isPending}
        onCancel={() => setClearing(null)} onConfirm={onConfirmClear} />
    </div>
  );
}
