import { useMemo, useState } from 'react';
import { Landmark, FileText } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import PaymentFormDrawer from '../../../components/payments/PaymentFormDrawer';
import { useLocalSales } from '../../../api/queries';
import { fmtPKR, fmtDate as fmtDateHouse } from '../../../shared/utils/format';

const PKR = (v) => fmtPKR(parseFloat(v) || 0, { decimals: 2 });
const fmtDate = (d) => (d ? fmtDateHouse(d) : '');
const dueOf = (s) => parseFloat(s.dueAmount ?? s.due_amount) || 0;

/**
 * Record a receipt from a local customer AGAINST a specific invoice (local
 * sale), so the payment is reconcilable.
 *
 * The invoice picker is this screen's own; the form is the shared Payment form
 * (variant receive_local_sale_line → POST /local-sales/:id/payments, the
 * endpoint this drawer always used), which updates the sale AND its
 * receivable. Cash lands by where it was collected (Mill Cash / Office Petty
 * Cash), as before.
 */
export default function MillCustomerPayDrawer({ customer, onClose }) {
  const { data: salesData } = useLocalSales({ customer_id: customer.id });
  const sales = Array.isArray(salesData) ? salesData : (salesData?.sales || salesData?.localSales || []);

  // Open invoices (due > 0), oldest first.
  const openInvoices = useMemo(() => (sales || [])
    .filter((s) => dueOf(s) > 0.001)
    .sort((a, b) => new Date(a.saleDate || a.sale_date || a.createdAt || 0) - new Date(b.saleDate || b.sale_date || b.createdAt || 0)),
  [sales]);

  const [picked, setPicked] = useState('');
  const saleId = picked || (openInvoices[0] ? String(openInvoices[0].id) : '');
  const selected = openInvoices.find((s) => String(s.id) === saleId);

  if (!selected) {
    return (
      <SlideDrawer open onClose={onClose} title="Record Receipt" subtitle={customer.name} icon={Landmark} size="md">
        <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500" data-testid="no-open-invoices">
          No open invoices — this customer has nothing outstanding.
        </div>
      </SlideDrawer>
    );
  }

  const ctx = {
    saleId: selected.id, currency: 'PKR', outstanding: dueOf(selected),
    party: { type: 'customer', id: customer.id, name: customer.name },
    ref: selected.saleNo || selected.sale_no,
    entity: 'mill', defaultMethod: 'cash', collectionLocation: 'Mill',
  };

  const picker = (
    <div>
      <span className="block text-xs font-semibold text-gray-600 uppercase mb-1">Receive against invoice <span className="text-red-500">*</span></span>
      <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-lg border border-gray-200 p-1.5" data-testid="invoice-picker">
        {openInvoices.map((s) => {
          const id = String(s.id);
          return (
            <button key={id} type="button" onClick={() => setPicked(id)} aria-pressed={saleId === id}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm border ${saleId === id ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}>
              <span className="flex items-center gap-1.5 min-w-0">
                <FileText size={14} className="text-gray-400 shrink-0" />
                <span className="font-medium text-gray-800 truncate">{s.saleNo || s.sale_no}</span>
                <span className="text-xs text-gray-400">{fmtDate(s.saleDate || s.sale_date || s.createdAt)}</span>
              </span>
              <span className="text-xs shrink-0"><span className="text-gray-400">due</span> <span className="font-semibold text-amber-700">{PKR(dueOf(s))}</span></span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <PaymentFormDrawer key={saleId} variant="receive_local_sale_line" ctx={ctx} banner={picker} onClose={onClose} />
  );
}
