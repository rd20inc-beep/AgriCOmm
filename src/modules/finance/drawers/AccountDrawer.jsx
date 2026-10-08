import { useState } from 'react';
import { Landmark, Wallet, ArrowLeftRight, CheckCircle } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { useAuth } from '../../../context/AuthContext';
import { useApp } from '../../../context/AppContext';
import { useBankAccounts, useBankTransactions, useUpcoming, useClearCheque } from '../../../api/queries';
import { accountsForMethod } from '../../../components/payments/paymentPayload';
import { ClearChequeDialog } from '../pages/DueDates';
import { entityLabel, transferRowLabel } from '../utils/contraTransfer';
import { fmtDate } from '../../../shared/utils/format';
import { useFinanceDrawers } from './drawersContext';
import { Section, Row, DrawerActions } from './drawerParts';
import { fmtAmt, btnPrimary, chequesForAccount } from './drawerLogic';
import { btnRowSecondary } from '../utils/uiClasses';


/**
 * One cash or bank account: its balance in its own currency, its recent
 * movements (each opens the Transaction drawer, or the transfer it belongs
 * to), the uncleared cheques that will clear through it, and Transfer with
 * this account as the source. Transfer asks what the contra route asks
 * (finance.confirm_payment, or milling.edit for the mill's own accounts);
 * clearing a cheque is finance.confirm_payment.
 */
export default function AccountDrawer({ account: given, onClose }) {
  const drawers = useFinanceDrawers();
  const { hasPermission } = useAuth();
  const { addToast } = useApp() || {};
  const { data: accounts = [] } = useBankAccounts();
  const account = accounts.find((a) => String(a.id) === String(given?.id)) || (given?.name ? given : null);
  const id = given?.id;
  const { data: txData, isLoading } = useBankTransactions({ bank_account_id: id, limit: 25 });
  const txs = (Array.isArray(txData) ? txData : txData?.transactions || []).slice(0, 25);
  const { data: upcoming } = useUpcoming();
  const cheques = chequesForAccount(upcoming, id);
  const clearMut = useClearCheque();
  const [clearing, setClearing] = useState(null);

  const canTransfer = hasPermission('finance', 'confirm_payment') || hasPermission('milling', 'edit');
  const canClear = hasPermission('finance', 'confirm_payment');
  const currency = account?.currency || 'PKR';
  const balance = parseFloat(account?.currentBalance) || 0;

  async function onClearConfirm(accountId) {
    try {
      await clearMut.mutateAsync({ id: clearing.paymentId, data: { bank_account_id: parseInt(accountId, 10) } });
      addToast?.(`Cheque cleared — ${fmtAmt(clearing.amount, clearing.currency)} settled and posted`, 'success');
      setClearing(null);
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Failed to clear cheque', 'error');
    }
  }

  const footer = canTransfer && account && account.isActive !== false ? (
    <DrawerActions>
      <button type="button" className={btnPrimary} data-action="transfer" onClick={() => drawers?.openTransfer(account.id)}>
        <ArrowLeftRight size={14} aria-hidden="true" /> Transfer from this account
      </button>
    </DrawerActions>
  ) : null;

  return (
    <SlideDrawer open onClose={onClose} title={account?.name || 'Account'}
      subtitle={account ? [account.bankName, entityLabel(account.entity), currency].filter(Boolean).join(' · ') : undefined}
      icon={account?.type === 'cash' ? Wallet : Landmark} size="lg" footer={footer}>
      <div className="space-y-5" data-testid="account-drawer">
        {/* Neutral tile; an overdrawn balance is red AND says "Overdrawn". */}
        <div className="rounded-lg p-3 text-center bg-gray-50 border border-gray-100">
          <p className="text-xs font-medium text-gray-500">Balance ({currency})</p>
          <p className={`text-2xl font-bold tabular-nums ${balance < 0 ? 'text-red-700' : 'text-gray-900'}`} data-testid="account-balance">{fmtAmt(balance, currency)}</p>
          {balance < 0 && <p className="text-xs font-medium text-red-700">Overdrawn</p>}
        </div>

        {account && (
          <Section title="Account">
            <div>
              <Row label="Type">{account.type === 'cash' ? 'Cash' : 'Bank'}</Row>
              {account.accountNumber && <Row label="Account #">{account.accountNumber}</Row>}
              <Row label="Belongs to">{entityLabel(account.entity)}</Row>
            </div>
          </Section>
        )}

        <Section title={`Uncleared cheques (${cheques.length})`}>
          {!cheques.length ? <p className="text-xs text-gray-500">None naming this account.</p> : (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-xs">
              {cheques.map((c) => (
                <div key={c.paymentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <button type="button" className="min-w-0 truncate text-left text-blue-600 hover:underline" onClick={() => drawers?.openTransaction?.('payment', c.paymentId)}>
                    {c.paymentNo || 'Cheque'} · {c.party} · clears {fmtDate(c.dueDate)}
                  </button>
                  <span className="flex items-center gap-2 shrink-0 ml-auto">
                    <span className="tabular-nums">{fmtAmt(c.amount, c.currency)}</span>
                    {canClear && (
                      <button type="button" onClick={() => setClearing(c)} data-action="clear-cheque" className={btnRowSecondary}>
                        <CheckCircle size={12} aria-hidden="true" /> Clear
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Recent movements">
          {isLoading ? <p className="text-xs text-gray-500">Loading…</p> : !txs.length ? <p className="text-xs text-gray-500">No movements yet.</p> : (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-xs" data-testid="account-ledger">
              {txs.map((t) => (
                <button key={t.id} type="button"
                  onClick={() => (t.fundTransferId ? drawers?.openFundTransfer?.(t.fundTransferId) : drawers?.openTransaction?.('bank', t.id))}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 min-h-11 hover:bg-blue-50 text-left focus-visible:outline-none focus-visible:bg-blue-50">
                  <span className="min-w-0 truncate text-gray-600">{fmtDate(t.transactionDate)} · {transferRowLabel(t) || t.counterparty || t.notes || t.reference || t.transactionNo}</span>
                  <span className={`tabular-nums font-medium ${t.type === 'credit' ? 'text-emerald-700' : 'text-red-700'}`}>
                    {t.type === 'credit' ? '+' : '−'}{fmtAmt(Math.abs(parseFloat(t.amount) || 0), t.currency || currency)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>
      {clearing && (
        <ClearChequeDialog key={clearing.paymentId} item={clearing} accounts={accountsForMethod(accounts, 'cheque')}
          busy={clearMut.isPending} onCancel={() => setClearing(null)} onConfirm={onClearConfirm} />
      )}
    </SlideDrawer>
  );
}
