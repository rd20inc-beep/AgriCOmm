import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import TransactionDocument from '../../../../../components/TransactionDocument';
import SlideDrawer from '../../../../../components/SlideDrawer';
import { fmtPKR, fmtDate } from '../../../../../shared/utils/format';

const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });

// View a single cash-ledger entry (money in/out) as a downloadable voucher
// (payment) or receipt (money in). Read-only — these are settled cash movements.
export default function CashEntryDrawer({ entry, companyProfile, onClose }) {
  if (!entry) return null;
  const PKR = (n) => fmtPKR(parseFloat(n) || 0, { decimals: 2 });
  const isIn = entry.direction === 'in';
  const amount = parseFloat(entry.amount_pkr) || 0;
  // Build the doc model TransactionDocument expects (voucher for out, receipt for in).
  const docData = isIn
    ? { recvNo: entry.ref || entry.payment_no, customerName: entry.counterparty, type: entry.category, currency: 'PKR', dueDate: entry.payment_date, expectedAmount: amount, receivedAmount: amount, outstanding: 0, status: 'Received', items: entry.items || [] }
    : { payNo: entry.ref || entry.payment_no, supplierName: entry.counterparty, category: entry.category, linkedRef: entry.linked_ref || entry.ref, entity: 'mill', currency: 'PKR', dueDate: entry.payment_date, originalAmount: amount, paidAmount: amount, outstanding: 0, status: 'Paid', items: entry.items || [] };
  return (
    <SlideDrawer open={!!entry} onClose={onClose} title={isIn ? 'Money In' : 'Money Out'} subtitle={entry.counterparty || entry.category} icon={isIn ? ArrowDownRight : ArrowUpRight} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-gray-500">Date</p><p>{fmtDate(entry.payment_date)}</p></div>
          <div><p className="text-xs text-gray-500">{isIn ? 'Received from' : 'Paid to'}</p><p className="font-medium">{entry.counterparty || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Category</p><p className="capitalize">{entry.category || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Method</p><p className="capitalize">{entry.payment_method || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Reference</p><p>{entry.ref || entry.payment_no || '—'}</p></div>
          <div><p className="text-xs text-gray-500">Amount</p><p className={`font-semibold ${isIn ? 'text-emerald-700' : 'text-red-600'}`}>{isIn ? '+' : '−'}{PKR(amount)}</p></div>
        </div>
        <div className="pt-2 border-t border-gray-100">
          <TransactionDocument kind={isIn ? 'receipt' : 'voucher'} data={docData} companyProfile={companyProfile} />
        </div>
      </div>
    </SlideDrawer>
  );
}
