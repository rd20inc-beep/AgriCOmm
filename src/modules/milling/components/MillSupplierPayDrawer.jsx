import { useMemo, useState } from 'react';
import { Landmark, FileText } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import PaymentFormDrawer from '../../../components/payments/PaymentFormDrawer';
import { contextForDocument } from '../../../components/payments/paymentVariants';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { usePayables, useMillPayables } from '../../../api/queries';
import { payablesForRow } from '../utils/payableBuckets';
import { fmtPKR, fmtDate as fmtDateHouse } from '../../../shared/utils/format';

const PKR = (v) => fmtPKR(parseFloat(v) || 0, { decimals: 2 });
const fmtDate = (d) => (d ? fmtDateHouse(d) : '');
const idOf = (p) => String(p.dbId || p.id);

/**
 * Pay a supplier AGAINST a specific invoice (payable), so each payment records
 * which invoice it settled — reconcilable later.
 *
 * The invoice picker is this screen's own; the form below it is the shared
 * Payment form (variant pay_payable → POST /finance/payments with
 * linked_payable_id — the endpoint this drawer always used), so the
 * overpayment check, the cheque clearing date and the payload are the same as
 * every other payable. The mill settles supplier bills from its own cash float
 * (Mill Cash), so the form stays fixed to cash from that account.
 */
export default function MillSupplierPayDrawer({ supplier, onClose }) {
  const { bankAccountsList = [] } = useApp();
  // Finance reads the company feed; a mill role without finance.view (the Mill
  // Operator) reads the mill's own payables — the only ones it may pay.
  const { hasPermission } = useAuth();
  const canFinance = hasPermission('finance', 'view');
  const { data: financePayables } = usePayables({}, { enabled: canFinance });
  const { data: millPayables } = useMillPayables({}, { enabled: !canFinance });
  const payables = (canFinance ? financePayables : millPayables) || [];

  // Open invoices (outstanding > 0) for this supplier, oldest first. `supplier.id`
  // can be the UNASSIGNED bucket, which collects every stored bill that has no
  // supplier on it — those are still debts and still have to be settleable.
  const openInvoices = useMemo(() => payablesForRow(payables, supplier.id)
    .filter((p) => (parseFloat(p.outstanding) || 0) > 0.001 && (p.status || '').toLowerCase() !== 'paid')
    .sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return (da - db) || ((a.dbId || a.id || 0) - (b.dbId || b.id || 0));
    }), [payables, supplier.id]);

  // Mill Finance pays only from its own cash float (Mill Cash) — never from a
  // Head Office bank account, and Head Office balances are never shown here.
  const millCash = useMemo(() => (Array.isArray(bankAccountsList) ? bankAccountsList : [])
    .find((b) => (b.type === 'cash') && ((b.entity || 'general') === 'mill'))
    || (Array.isArray(bankAccountsList) ? bankAccountsList : []).find((b) => b.type === 'cash'), [bankAccountsList]);

  // Default to the oldest open invoice; picking another re-opens the form for
  // it (its outstanding pre-filled, still editable).
  const [picked, setPicked] = useState('');
  const payId = picked || (openInvoices[0] ? idOf(openInvoices[0]) : '');
  const selected = openInvoices.find((p) => idOf(p) === payId);
  const invRef = (p) => p.linkedRef || p.payNo || `#${p.dbId || p.id}`;

  if (!selected) {
    return (
      <SlideDrawer open onClose={onClose} title="Record Payment" subtitle={supplier.name} icon={Landmark} size="md">
        <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500" data-testid="no-open-invoices">
          No open invoices — nothing outstanding to this supplier.
        </div>
      </SlideDrawer>
    );
  }

  const base = contextForDocument({ docKind: 'payable', row: { ...selected, supplierName: selected.supplierName || supplier.name } });
  const ctx = {
    ...base,
    variant: 'pay_payable',
    ref: invRef(selected),
    notes: `Payment for ${invRef(selected)} — ${supplier.name}`,
    entity: 'mill', methods: ['cash'], defaultMethod: 'cash',
    ...(millCash ? { fixedAccountId: millCash.id } : {}),
  };

  const picker = (
    <div className="space-y-3">
      <div>
        <span className="block text-xs font-semibold text-gray-600 uppercase mb-1">Pay against invoice <span className="text-red-500">*</span></span>
        <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-lg border border-gray-200 p-1.5" data-testid="invoice-picker">
          {openInvoices.map((p) => {
            const id = idOf(p);
            return (
              <button key={id} type="button" onClick={() => setPicked(id)} aria-pressed={payId === id}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm border ${payId === id ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <span className="flex items-center gap-1.5 min-w-0">
                  <FileText size={14} className="text-gray-400 shrink-0" />
                  <span className="min-w-0">
                    <span className="font-medium text-gray-800 truncate block">{invRef(p)}</span>
                    {(p.category || p.dueDate) && <span className="text-[11px] text-gray-400">{p.category || ''}{p.dueDate ? ` · due ${fmtDate(p.dueDate)}` : ''}</span>}
                  </span>
                </span>
                <span className="text-xs shrink-0"><span className="text-gray-400">bal</span> <span className="font-semibold text-amber-700">{PKR(p.outstanding)}</span></span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="text-xs bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-emerald-800">
        Paid from <span className="font-semibold">{millCash?.name || 'Mill Cash'}</span>. The mill settles
        supplier bills from its cash float; fund it from Head Office if it runs short.
      </div>
    </div>
  );

  return (
    <PaymentFormDrawer key={payId} variant="pay_payable" ctx={ctx} banner={picker} onClose={onClose} />
  );
}
