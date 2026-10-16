import { useAuth } from '../../../../../context/AuthContext';
import { useBankAccounts, useRecordPayment, usePayablePayments } from '../../../../../api/queries';
import PaymentDrawer from '../../../../../components/payments/PaymentDrawer';
import { PKR } from '../constants';

// Pay a transporter, and pay any Money Out payable. Both configure the shared
// PaymentDrawer, which owns the arithmetic, the overpayment check and the
// recordPayment payload (src/components/payments). WHT / early-payment
// discount / attachment ride along in PaymentFields (#14 1e).
//
// recordPayment with a cash/bank account is mandatory and a partial payment is
// allowed: settling any payable posts the GL and moves the account.
export function PayTransporterDrawer({ payTransport, onClose, addToast }) {
  const { hasPermission } = useAuth();
  const { data: bankAccounts = [] } = useBankAccounts({ millOnly: !hasPermission('finance', 'view') });
  const recordMut = useRecordPayment();
  return (
    <PaymentDrawer
      title={`Pay ${payTransport.haulerName || 'Transporter'}`}
      subtitle={`${payTransport.lotNo ? `Lot ${payTransport.lotNo} · ` : ''}${PKR(payTransport.outstanding)} due`}
      summary={[['Outstanding', PKR(payTransport.outstanding)]]}
      outstanding={payTransport.outstanding}
      payableId={payTransport.payableId}
      accounts={bankAccounts}
      rememberAs={{ entity: 'mill' }}
      defaultNotes={`Transport payment — ${payTransport.haulerName || ''}`.trim()}
      submitLabel="Pay Transporter"
      onSubmit={(body) => recordMut.mutateAsync(body)}
      onDone={() => { addToast('Transporter paid', 'success'); onClose(); }}
      onClose={onClose} addToast={addToast}
    />
  );
}

export function PayPayableDrawer({ payTarget, onClose, addToast }) {
  const { hasPermission } = useAuth();
  const { data: bankAccounts = [] } = useBankAccounts({ millOnly: !hasPermission('finance', 'view') });
  const recordMut = useRecordPayment();
  const { data: payHistory, isLoading: payHistLoading } = usePayablePayments(payTarget.payableId, !!payTarget.payableId);
  return (
    <PaymentDrawer
      title={`Pay ${payTarget.party || 'Payable'}`}
      subtitle={`${payTarget.ref ? `${payTarget.ref} · ` : ''}${PKR(payTarget.outstanding)} due`}
      summary={[
        payTarget.stream && ['Category', payTarget.stream],
        ['Outstanding', PKR(payTarget.outstanding)],
      ].filter(Boolean)}
      outstanding={payTarget.outstanding}
      payableId={payTarget.payableId}
      accounts={bankAccounts}
      rememberAs={{ entity: 'mill' }}
      defaultNotes={`${payTarget.stream || 'Payable'} payment — ${payTarget.party || ''}`.trim()}
      history={payTarget.payableId ? (payHistory?.payments || []) : undefined}
      historyLoading={payTarget.payableId ? payHistLoading : false}
      historyCompact
      onSubmit={(body) => recordMut.mutateAsync(body)}
      onDone={() => { addToast(`Paid ${payTarget.party || 'payable'}`, 'success'); onClose(); }}
      onClose={onClose} addToast={addToast}
    />
  );
}
