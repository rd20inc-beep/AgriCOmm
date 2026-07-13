import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Wallet, RefreshCw, Printer } from 'lucide-react';
import { serviceMillingApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { RecordPaymentDrawer } from '../components/ServiceInvoiceDrawers';
import { printServiceInvoice } from '../utils/serviceInvoicePrint';

const num = (v) => parseFloat(v) || 0;
const pkr = (v) => `PKR ${(num(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const BILLING_STYLE = {
  'Unpaid': 'bg-rose-100 text-rose-700',
  'Partial': 'bg-amber-100 text-amber-800',
  'Paid': 'bg-emerald-100 text-emerald-700',
};

export default function ServiceInvoices() {
  const { addToast, companyProfileData } = useApp();
  const { hasPermission } = useAuth();
  const canPay = hasPermission('service_milling', 'record_payment');
  const [payInvoice, setPayInvoice] = useState(null);

  async function viewInvoice(id) {
    try {
      const inv = (await serviceMillingApi.getInvoice(id))?.data;
      if (!printServiceInvoice(inv, companyProfileData)) addToast?.('Pop-up blocked — allow pop-ups to view/print the invoice.', 'error');
    } catch (err) { addToast?.(err?.message || 'Failed to load invoice', 'error'); }
  }

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['service-milling', 'invoices'],
    queryFn: async () => (await serviceMillingApi.listInvoices())?.data || [],
  });
  const rows = Array.isArray(data) ? data : [];

  const totals = rows.reduce((a, r) => {
    a.billed += num(r.total_amount); a.received += num(r.received_amount); a.outstanding += num(r.balance_amount);
    return a;
  }, { billed: 0, received: 0, outstanding: 0 });

  async function openPayment(id) {
    try { setPayInvoice((await serviceMillingApi.getInvoice(id))?.data); }
    catch (err) { addToast?.(err?.message || 'Failed to load invoice', 'error'); }
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2"><FileText size={22} /> Service Milling Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">Billing & collection for toll/job-work milling — service fees only (not rice sales).</p>
        </div>
        <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 self-start">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs uppercase text-gray-500">Billed</p><p className="text-xl font-bold text-gray-900 mt-1">{pkr(totals.billed)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs uppercase text-gray-500">Received</p><p className="text-xl font-bold text-emerald-700 mt-1">{pkr(totals.received)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs uppercase text-gray-500">Outstanding</p><p className="text-xl font-bold text-rose-600 mt-1">{pkr(totals.outstanding)}</p></div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2.5 font-semibold">Invoice</th>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Batch</th>
                <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                <th className="px-4 py-2.5 font-semibold text-right">Received</th>
                <th className="px-4 py-2.5 font-semibold text-right">Balance</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No service-milling invoices yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-semibold text-gray-900">{r.invoice_no}<div className="text-[11px] text-gray-400">{r.invoice_date ? new Date(r.invoice_date).toLocaleDateString('en-GB') : ''}</div></td>
                  <td className="px-4 py-2.5 text-gray-800">{r.client_name || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{r.batch_no || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">{pkr(r.total_amount)}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-700">{pkr(r.received_amount)}</td>
                  <td className="px-4 py-2.5 text-right text-rose-600">{pkr(r.balance_amount)}</td>
                  <td className="px-4 py-2.5"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${BILLING_STYLE[r.payment_status] || 'bg-gray-100 text-gray-600'}`}>{r.payment_status}</span></td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => viewInvoice(r.id)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 mr-2"><Printer size={12} /> View</button>
                    {r.payment_status !== 'Paid' && canPay && (
                      <button onClick={() => openPayment(r.id)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"><Wallet size={12} /> Pay</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <RecordPaymentDrawer open={!!payInvoice} invoice={payInvoice} addToast={addToast}
        onClose={() => setPayInvoice(null)} onPaid={() => refetch()} />
    </div>
  );
}
