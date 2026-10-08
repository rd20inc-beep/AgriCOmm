import { useState } from 'react';
import { useBounceCheque } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import BounceChequeDialog from '../components/BounceChequeDialog';
import { fmtMoney as fmtMoneyBase } from '../../../shared/utils/format';

const fmtMoney = (n, cur) => fmtMoneyBase(parseFloat(n) || 0, cur || 'PKR', { decimals: 2 });

/**
 * The Bounce action (B1), the same on every screen that offers it: call
 * `start(item)` with the cheque ({ paymentId, paymentNo, reference, amount,
 * currency, bankAccountId, party, partyType }) and render `dialog`.
 * Gating is the caller's (PermissionGate finance.confirm_payment).
 */
export default function useChequeBounce({ accounts = [], onDone } = {}) {
  const [item, setItem] = useState(null);
  const mut = useBounceCheque();
  const { addToast } = useApp();

  async function confirm(body) {
    const x = item;
    if (!x) return;
    try {
      await mut.mutateAsync({ id: x.paymentId, data: body });
      addToast?.(`Cheque ${x.reference || x.paymentNo || ''} marked bounced — ${fmtMoney(x.amount, x.currency)} is open again`.replace('  ', ' '), 'success');
      setItem(null);
      onDone?.();
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Could not mark the cheque bounced', 'error');
    }
  }

  const dialog = (
    <BounceChequeDialog key={item?.paymentId || 'none'} item={item} accounts={accounts} busy={mut.isPending}
      onCancel={() => setItem(null)} onConfirm={confirm} />
  );
  return { start: setItem, dialog, busy: mut.isPending };
}
