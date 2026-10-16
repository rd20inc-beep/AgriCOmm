import { useState, useEffect } from 'react';
import { Banknote } from 'lucide-react';
import { useRecordPayment, usePayablePayments } from '../../../../../api/queries';
import TransactionDocument from '../../../../../components/TransactionDocument';
import StatusBadge from '../../../../../components/StatusBadge';
import SlideDrawer from '../../../../../components/SlideDrawer';
import { todayLocalISO, fmtPKR, fmtDate } from '../../../../../shared/utils/format';

const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });

// Pay a single mill expense — mirrors the Finance → Money Out payable drawer:
// amount summary, details, payments-made history, a printable voucher/invoice
// (TransactionDocument), and the payment form. Pays the expense's linked payable
// via recordPayment (which also marks the business_expense Paid + moves the bank).
const EXP_METHOD_LABEL = { bank_transfer: 'Bank Transfer', cheque: 'Cheque', cash: 'Cash', online: 'Online', mobile: 'Mobile' };

export default function ExpensePayDrawer({ expense, bankAccounts = [], companyProfile, addToast, onClose, canPay = true }) {
  const recordMut = useRecordPayment();
  const payableId = expense?.payableId || null;
  const { data: payHistory, isLoading: payHistLoading } = usePayablePayments(payableId, !!payableId);
  const total = expense ? (parseFloat(expense.payableOriginal) || parseFloat(expense.amount) || 0) : 0;
  const paid = expense ? (parseFloat(expense.payablePaid) || 0) : 0;
  const outstanding = expense ? (expense.payableOutstanding != null ? parseFloat(expense.payableOutstanding) : Math.max(0, total - paid)) : 0;
  const status = expense?.payableStatus || expense?.paymentStatus || 'Pending';
  const [form, setForm] = useState({ amount: '', bankAccountId: '', paymentMethod: 'cash', paymentDate: todayLocalISO(), chequeNo: '', dueDate: '', notes: '' });
  useEffect(() => {
    if (expense) setForm({ amount: String(Math.round(outstanding) || ''), bankAccountId: '', paymentMethod: 'cash', paymentDate: todayLocalISO(), chequeNo: '', dueDate: '', notes: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expense]);
  if (!expense) return null;
  const PKR = (n) => fmtPKR(parseFloat(n) || 0, { decimals: 2 });
  // Mill cash payments are drawn from the dedicated Mill Cash account so they
  // reduce "Mill Cash available" on the dashboard (and go negative when the mill
  // has spent more than it holds — a signal it needs funding from Head Office).
  const millCash = bankAccounts.find(a => a.type === 'cash' && a.entity === 'mill')
    || bankAccounts.find(a => a.type === 'cash');

  // Voucher/invoice payload (same shape TransactionDocument uses on Money Out).
  const voucher = {
    payNo: expense.payNo || expense.expenseNo, category: expense.category, entity: expense.payableEntity || 'mill',
    originalAmount: total, paidAmount: paid, outstanding, supplierId: expense.payableSupplierId || expense.supplierId,
    supplierName: expense.vendorName || expense.supplierName || expense.employeeName || expense.linkedRef,
    linkedRef: expense.linkedRef, currency: 'PKR', status, description: expense.description, date: expense.expenseDate,
  };

  async function pay(e) {
    e?.preventDefault?.();
    const amt = parseFloat(form.amount);
    if (!(amt > 0)) { addToast?.('Enter a valid amount', 'error'); return; }
    if (!payableId) { addToast?.('This expense has no payable to settle.', 'error'); return; }
    try {
      // Mill Finance pays only from Mill Cash — never from a Head Office bank account.
      await recordMut.mutateAsync({
        type: 'payment', amount: amt, currency: 'PKR',
        payment_method: 'cash', payment_date: form.paymentDate,
        bank_account_id: millCash?.id || null, bank_reference: null,
        due_date: form.dueDate || null, linked_payable_id: payableId,
        notes: form.notes || `Payment for ${voucher.payNo} — ${expense.description || expense.category}`,
      });
      addToast?.(`Payment of ${PKR(amt)} recorded — ${expense.description || expense.category}`, 'success');
      onClose();
    } catch (err) { addToast?.(`Failed: ${err?.data?.message || err.message || 'Payment failed'}`, 'error'); }
  }

  const footer = canPay && status !== 'Paid' && outstanding > 0 ? (
    <div className="flex justify-end gap-2">
      <button onClick={onClose} className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
      <button onClick={pay} disabled={recordMut.isPending} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
        <Banknote className="w-4 h-4" /> {recordMut.isPending ? 'Recording…' : 'Record Payment'}
      </button>
    </div>
  ) : null;

  return (
    <SlideDrawer open={!!expense} onClose={onClose} title={voucher.payNo || 'Pay Expense'} subtitle={expense.description || expense.category} icon={Banknote} size="lg" footer={footer}>
      <div className="space-y-4">
        {/* Amount summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-50 rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Original</p><p className="text-sm font-semibold">{PKR(total)}</p></div>
          <div className="bg-emerald-50 rounded-lg p-3 text-center"><p className="text-xs text-emerald-600">Paid</p><p className="text-sm font-semibold text-emerald-700">{PKR(paid)}</p></div>
          <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-xs text-red-600">Outstanding</p><p className="text-sm font-semibold text-red-700">{PKR(outstanding)}</p></div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-gray-500">Category</p><p className="capitalize">{expense.category}</p></div>
          <div><p className="text-xs text-gray-500">Vendor / Ref</p><p>{voucher.supplierName || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Date</p><p>{expense.expenseDate || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Status</p><StatusBadge status={status} /></div>
        </div>

        {/* Payments made */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Payments Made</h3>
          {payHistLoading ? <p className="text-xs text-gray-400 py-2">Loading payments…</p>
            : (payHistory?.payments?.length ? (
              <div className="space-y-2">
                {payHistory.payments.map((p, idx) => {
                  let from = [p.accountName, p.bankName].filter(Boolean).join(' · ');
                  if (!from) from = p.paymentMethod === 'cash' ? 'Cash (in hand)' : '—';
                  return (
                    <div key={p.id || idx} className="border border-gray-200 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-emerald-700">{PKR(p.amount)}</span>
                        <span className="text-xs text-gray-500">{fmtDate(p.paymentDate)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
                        <span>Method: <span className="font-medium text-gray-700">{EXP_METHOD_LABEL[p.paymentMethod] || p.paymentMethod || '—'}</span></span>
                        <span>From: <span className="font-medium text-gray-700">{from}</span></span>
                        {p.bankReference && <span>Ref: <span className="font-medium text-gray-700">{p.bankReference}</span></span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-xs text-gray-400 py-2">No payments recorded yet.</p>)}
        </div>

        {/* Printable voucher / invoice */}
        <div className="pt-2 border-t border-gray-100">
          <TransactionDocument kind="voucher" data={voucher} companyProfile={companyProfile} />
        </div>

        {/* Payment form */}
        {canPay && status !== 'Paid' && outstanding > 0 && (
          <form onSubmit={pay} className="pt-3 border-t border-gray-200 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Banknote size={15} /> Record Payment</h3>
            <div className="text-xs bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-emerald-800">
              Paid from <span className="font-semibold">{millCash?.name || 'Mill Cash'}</span>
              {millCash ? <> · balance {PKR(millCash.currentBalance)}</> : null}
              {millCash && (parseFloat(millCash.currentBalance) || 0) - (parseFloat(form.amount) || 0) < 0 && (
                <span className="block text-amber-700 mt-0.5">This will overdraw Mill Cash — fund it from Head Office to clear the negative.</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Amount (Rs)</label>
                <input type="number" step="0.01" required value={form.amount} max={outstanding} onChange={e => setForm({ ...form, amount: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Payment Date</label>
                <input type="date" required value={form.paymentDate} onChange={e => setForm({ ...form, paymentDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" /></div>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Notes (optional)</label>
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          </form>
        )}
      </div>
    </SlideDrawer>
  );
}
