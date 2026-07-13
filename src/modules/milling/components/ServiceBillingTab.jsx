import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wallet, FileText, Receipt, Printer, Ban } from 'lucide-react';
import { millingApi, serviceMillingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { CreateInvoiceDrawer, RecordPaymentDrawer } from './ServiceInvoiceDrawers';
import { printServiceInvoice } from '../utils/serviceInvoicePrint';

const num = (v) => parseFloat(v) || 0;
const pkr = (v) => `PKR ${(num(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BILLING_STYLE = {
  'Not Invoiced': 'bg-gray-100 text-gray-600',
  'Invoiced': 'bg-blue-100 text-blue-700',
  'Partial': 'bg-amber-100 text-amber-800',
  'Paid': 'bg-emerald-100 text-emerald-700',
};

/**
 * Billing tab for a service-milling batch — service invoice (milling + rental +
 * labour) and payments. Reuses the existing Create Invoice / Record Payment
 * drawers. This is a SERVICE fee, not a sale of rice.
 */
export default function ServiceBillingTab({ routeId, batchDbId, onChanged }) {
  const { addToast, companyProfileData } = useApp();
  const { hasPermission } = useAuth();
  const canInvoice = hasPermission('service_milling', 'create_invoice');
  const canPay = hasPermission('service_milling', 'record_payment');
  const canViewInvoice = hasPermission('service_milling', 'view_invoice');

  function viewInvoice() {
    if (!invoice) return;
    if (!printServiceInvoice(invoice, companyProfileData)) {
      addToast?.('Pop-up blocked — allow pop-ups to view/print the invoice.', 'error');
    }
  }

  async function voidInvoice() {
    if (!invoiceId) return;
    const paid = invoice && num(invoice.received_amount) > 0;
    const msg = paid
      ? `Void ${row?.invoice_no}? It has PKR ${(num(invoice.received_amount)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} received — the payment(s) will be reversed (account balance + receipt undone) and the invoice removed so you can re-issue. Continue?`
      : `Void ${row?.invoice_no}? The invoice and its revenue posting are reversed and removed so you can create a fresh one. Continue?`;
    if (!window.confirm(msg)) return;
    try {
      await serviceMillingApi.voidInvoice(invoiceId);
      addToast?.('Invoice voided — you can now create a new one', 'success');
      afterChange();
    } catch (err) {
      addToast?.(err?.response?.data?.message || err.message || 'Failed to void invoice', 'error');
    }
  }

  const [showInvoice, setShowInvoice] = useState(false);
  const [showPay, setShowPay] = useState(false);

  // The service-batches feed carries the service rates + billing status + invoice id.
  const { data: batchesData, refetch: refetchBatches } = useQuery({
    queryKey: ['service-milling', 'batches'],
    queryFn: async () => (await millingApi.listServiceBatches())?.data || [],
  });
  const rows = Array.isArray(batchesData) ? batchesData : [];
  const row = rows.find((r) => r.id === batchDbId || r.batch_no === routeId) || null;
  const billing = row?.billing_status || 'Not Invoiced';
  const invoiceId = row?.invoice_id || null;

  // Full invoice (line breakdown + payments) once one exists and the user may see it.
  const { data: invoice, refetch: refetchInvoice } = useQuery({
    queryKey: ['service-invoice', invoiceId],
    queryFn: async () => (await serviceMillingApi.getInvoice(invoiceId))?.data || null,
    enabled: !!invoiceId && canViewInvoice,
  });

  function afterChange() {
    refetchBatches();
    if (invoiceId) refetchInvoice();
    onChanged?.();
  }

  if (!row) {
    return <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">Loading billing…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Billing status header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-900">Service Billing</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${BILLING_STYLE[billing] || 'bg-gray-100 text-gray-600'}`}>{billing}</span>
        </div>
        {billing === 'Not Invoiced' ? (
          canInvoice ? (
            <button onClick={() => setShowInvoice(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">
              <FileText size={14} /> Create Invoice
            </button>
          ) : <span className="text-xs text-gray-400">No invoice yet</span>
        ) : (
          <div className="flex items-center gap-2">
            {invoice && (
              <button onClick={viewInvoice} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-gray-700 bg-white border border-gray-300 text-xs font-medium rounded-lg hover:bg-gray-50">
                <Printer size={14} /> View / Download
              </button>
            )}
            {canInvoice && invoiceId && (
              <button onClick={voidInvoice} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-red-600 bg-white border border-red-200 text-xs font-medium rounded-lg hover:bg-red-50">
                <Ban size={14} /> Void
              </button>
            )}
            {billing !== 'Paid' && canPay && invoiceId && (
              <button onClick={() => setShowPay(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700">
                <Wallet size={14} /> Record Payment
              </button>
            )}
          </div>
        )}
      </div>

      {billing === 'Not Invoiced' ? (
        /* Estimate from the batch's service rates */
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-900">Estimated Service Charges</div>
          <div className="p-4 space-y-1 text-sm">
            <Line label={`Milling — ${Math.round(num(row.milled_kg)).toLocaleString()} kg`} value={row.service_milling_amount} />
            <Line label={`Rental — ${(num(row.katta_count) || num(row.bag_count) || 0).toLocaleString()} kattas`} value={row.service_rental_amount} />
            <Line label={`Labour — ${(num(row.katta_count) || num(row.bag_count) || 0).toLocaleString()} kattas`} value={row.service_labour_amount} />
            <div className="flex justify-between px-1 py-2 mt-1 border-t border-gray-200 font-bold">
              <span>Estimated Total</span><span className="text-emerald-700">{pkr(row.service_total_amount)}</span>
            </div>
            <p className="text-xs text-gray-400 pt-1">A service invoice (not a rice sale) — posts to Service Milling Revenue and opens a receivable against the client.</p>
          </div>
        </div>
      ) : !canViewInvoice ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-500">
          Invoice <span className="font-semibold">{row.invoice_no}</span> exists. You don't have permission to view billing details.
        </div>
      ) : invoice ? (
        <>
          {/* Invoice summary */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2"><Receipt size={15} className="text-gray-400" /><span className="text-sm font-semibold text-gray-900">{invoice.invoice_no}</span></div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString('en-GB') : ''}</span>
                <button onClick={viewInvoice} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                  <Printer size={13} /> View / Download
                </button>
              </div>
            </div>
            <div className="p-4 space-y-1 text-sm">
              <Line label={`Milling — ${Math.round(num(invoice.milling_qty_kg)).toLocaleString()} kg × ${pkr(invoice.milling_rate_per_kg)}`} value={invoice.milling_amount} />
              <Line label={`Rental — ${num(invoice.rental_kattas).toLocaleString()} × ${pkr(invoice.rental_rate_per_katta)}`} value={invoice.rental_amount} />
              <Line label={`Labour — ${num(invoice.labour_kattas).toLocaleString()} × ${pkr(invoice.labour_rate_per_katta)}`} value={invoice.labour_amount} />
              {num(invoice.extra_charges) > 0 && <Line label="Extra charges" value={invoice.extra_charges} />}
              {num(invoice.discount) > 0 && <Line label="Discount" value={-num(invoice.discount)} />}
              {num(invoice.tax_amount) > 0 && <Line label={`Tax (${num(invoice.tax_pct)}%)`} value={invoice.tax_amount} />}
              <div className="flex justify-between px-1 py-2 mt-1 border-t border-gray-200 font-bold"><span>Total</span><span>{pkr(invoice.total_amount)}</span></div>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div className="rounded-lg bg-emerald-50 p-2 text-center"><p className="text-[10px] uppercase text-emerald-600">Received</p><p className="font-bold text-emerald-700">{pkr(invoice.received_amount)}</p></div>
                <div className="rounded-lg bg-rose-50 p-2 text-center"><p className="text-[10px] uppercase text-rose-500">Balance</p><p className="font-bold text-rose-600">{pkr(invoice.balance_amount)}</p></div>
              </div>
            </div>
          </div>

          {/* Payments */}
          {Array.isArray(invoice.payments) && invoice.payments.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-900">Payments</div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {invoice.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2 text-gray-700">{p.payment_no}</td>
                      <td className="px-4 py-2 text-gray-500">{p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-GB') : ''}</td>
                      <td className="px-4 py-2 text-gray-500 capitalize">{(p.payment_method || '').replace('_', ' ')}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">{pkr(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">Loading invoice…</div>
      )}

      <CreateInvoiceDrawer open={showInvoice} batch={row} addToast={addToast}
        onClose={() => setShowInvoice(false)} onCreated={afterChange} />
      <RecordPaymentDrawer open={showPay} invoice={invoice} addToast={addToast}
        onClose={() => setShowPay(false)} onPaid={afterChange} />
    </div>
  );
}

function Line({ label, value }) {
  return (
    <div className="flex justify-between px-1 py-1">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{pkr(value)}</span>
    </div>
  );
}
