import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, AlertTriangle, CheckCircle, Loader2, X } from 'lucide-react';
import { useUpcoming, useClearCheque, useBankAccounts } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import PartyLink from '../../../shared/components/PartyLink';
import { totalsByCurrency } from '../drawers/drawerLogic';
import { PerCurrency } from '../drawers/drawerParts';
import { AccountSelect } from '../../../components/payments/PaymentFields';
import { accountsForMethod, pickAccountForMethod } from '../../../components/payments/paymentPayload';
import { accountsForCurrency } from '../../../shared/utils/accountCurrency';
import { fmtMoney as fmtMoneyBase, fmtDate } from '../../../shared/utils/format';
import { TypeChip, EmptyLine, InlineError } from '../components/FinanceUI';
import { btnPrimary, btnSecondary, btnRowSecondary, th, tdMoney, errorText } from '../utils/uiClasses';

// Exact, two decimals; each amount in its own currency (USD export receivables vs PKR dues).
const fmtMoney = (n, cur) => fmtMoneyBase(parseFloat(n) || 0, cur || 'PKR', { decimals: 2 });
const isOverdue = (s) => s && new Date(s) < new Date(new Date().toDateString());

function List({ title, icon: Icon, tone, items, onClear, clearing, canClear }) {
  // Each currency on its own — a USD cheque and a rupee due are never added.
  const totals = totalsByCurrency(items, 'amount');
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={16} className={tone === 'in' ? 'text-emerald-600' : 'text-red-600'} aria-hidden="true" />
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <span className="text-xs text-gray-500 tabular-nums">({items.length})</span>
        </div>
        <PerCurrency totals={totals} empty="" className="text-sm font-bold text-gray-900" />
      </div>
      {items.length === 0 ? (
        <EmptyLine icon={CheckCircle}>Nothing upcoming.</EmptyLine>
      ) : (
        <div className="overflow-x-auto mobile-cards">
          <table className="w-full text-sm">
            <thead><tr>
              <th className={`${th} text-left`}>Due</th><th className={`${th} text-left`}>Party</th>
              <th className={`${th} text-left`}>Type</th><th className={`${th} text-right`}>Amount</th><th className={th}><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((x, i) => (
                <tr key={i} className={`hover:bg-gray-50 ${isOverdue(x.dueDate) ? 'bg-red-50/40' : ''}`}>
                  <td data-label="Due" className="py-2 px-4 whitespace-nowrap">
                    <span className={isOverdue(x.dueDate) ? 'text-red-600 font-medium' : 'text-gray-700'}>{fmtDate(x.dueDate)}</span>
                    {isOverdue(x.dueDate) && <span className="ml-1.5 text-xs font-medium text-red-700 inline-flex items-center gap-0.5"><AlertTriangle size={12} aria-hidden="true" /> Overdue</span>}
                  </td>
                  <td data-label="Party" className="py-2 px-4 text-gray-900 break-words">
                    <PartyLink type={x.partyType} id={x.partyId} name={x.party} className="font-medium" />
                  </td>
                  <td data-label="Type" className="py-2 px-4">
                    <TypeChip>{x.label}</TypeChip>
                    {x.reference && <span className="ml-1.5 text-[11px] text-gray-400 font-mono">{x.reference}</span>}
                  </td>
                  <td data-label="Amount" className={`py-2 px-4 ${tdMoney} font-medium text-gray-900`}>
                    {fmtMoney(x.amount, x.currency)}
                  </td>
                  <td data-label="" className="py-2 px-4 text-right">
                    {x.paymentId && canClear && (
                      <button type="button" onClick={() => onClear(x)} disabled={clearing} className={btnRowSecondary}>
                        <CheckCircle size={12} aria-hidden="true" /> Mark cleared
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
          <button type="button" onClick={() => !busy && onCancel()} className="shrink-0 -mr-2 -mt-1 inline-flex items-center justify-center w-10 h-10 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mx-5 mb-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Amount</p>
          <p className="text-lg font-bold text-gray-900 break-words tabular-nums">{fmtMoney(item.amount, item.currency)}</p>
        </div>
        <div className="px-5 pb-1">
          <AccountSelect id="clear-cheque-account" accounts={accounts} value={accountId} onChange={setAccountId}
            label="Bank account it cleared through *" />
        </div>
        <div className="flex items-center justify-end gap-2 p-5 pt-3">
          <button type="button" onClick={onCancel} disabled={busy} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={() => onConfirm(accountId)} disabled={busy || !accountId}
            title={!accountId ? 'Choose the bank account' : undefined}
            className={btnPrimary}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Mark cleared
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DueDates() {
  const { data, isLoading, error, refetch } = useUpcoming();
  const { data: allAccounts } = useBankAccounts();
  const { addToast } = useApp();
  const clearMut = useClearCheque();
  // Clearing posts the money — POST /finance/payments/:id/clear is
  // finance.confirm_payment; a read-only role sees the list, not the button.
  const { hasPermission } = useAuth();
  const canClear = hasPermission('finance', 'confirm_payment');
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
      <p className="text-sm text-gray-600 max-w-3xl">Uncleared cheques &amp; credit (udhaar) dues — when money is expected or due. A cheque settles only when you mark it cleared here.</p>
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 animate-pulse" aria-busy="true">
          <div className="h-48 bg-gray-100 rounded-xl" /><div className="h-48 bg-gray-100 rounded-xl" />
        </div>
      ) : error ? (
        <InlineError message={errorText(error, 'Cheques and dues')} onRetry={refetch} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <List title="Receiving (money in)" icon={ArrowDownLeft} tone="in" items={receiving} onClear={setClearing} clearing={clearMut.isPending} canClear={canClear} />
          <List title="Giving (money out)" icon={ArrowUpRight} tone="out" items={giving} onClear={setClearing} clearing={clearMut.isPending} canClear={canClear} />
        </div>
      )}
      <ClearChequeDialog key={clearing?.paymentId || 'none'} item={clearing} accounts={bankAccounts} busy={clearMut.isPending}
        onCancel={() => setClearing(null)} onConfirm={onConfirmClear} />
    </div>
  );
}
