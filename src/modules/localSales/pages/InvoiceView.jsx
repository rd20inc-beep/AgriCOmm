// Invoice 360 — a richer, read-only detail view of one local sale (the sale row
// IS the invoice). Phase 2 of the invoice plan: clearer + traceable + easy to
// print. Additive only — reuses the existing sale data, the existing
// accept-payment mutation, and the existing TransactionDocument print template.
// Deliberately does NOT show COGS/margin (admin copy is a placeholder).
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Printer, ShieldCheck, Wallet, BookUser, Package, Factory,
  Truck, FileText, AlertTriangle, ChevronRight, Mail, MessageCircle,
} from 'lucide-react';
import { localSalesApi } from '../api/services';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useAcceptLocalSalePayment } from '../../../api/queries';
import SlideDrawer from '../../../components/SlideDrawer';
import { printCustomerInvoice, printAdminInvoice } from '../utils/invoicePrint';

// Roles allowed to view the admin invoice copy (mirrors the backend route gate).
const ADMIN_INVOICE_ROLES = ['Super Admin', 'Owner', 'Finance Manager', 'Mill Manager'];

const pkr = (v) => `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const STATUS_TONE = {
  Paid: 'bg-emerald-100 text-emerald-700', Partial: 'bg-amber-100 text-amber-700',
  Credit: 'bg-red-100 text-red-700', Unpaid: 'bg-red-100 text-red-700',
};

export default function InvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyProfileData, addToast } = useApp();
  const { user } = useAuth();
  const canSeeAdminCopy = ADMIN_INVOICE_ROLES.includes(user?.role);
  const payMutation = useAcceptLocalSalePayment();
  const [adminBusy, setAdminBusy] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['local-sales', 'invoice', id],
    queryFn: async () => {
      const res = await localSalesApi.getInvoice(id);
      return res?.data || res;
    },
  });

  // Admin-only enrichment (source-batch by-product pricing etc.). Fetched from
  // the role-gated endpoint so internal valuation never enters the customer copy.
  const { data: adminData } = useQuery({
    queryKey: ['local-sales', 'invoice-admin', id],
    enabled: canSeeAdminCopy && !!id,
    queryFn: async () => {
      const res = await localSalesApi.getInvoiceAdmin(id);
      return res?.data || res;
    },
  });

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'cash', reference: '', payment_date: new Date().toISOString().slice(0, 10), due_date: '', collection_location: 'Mill' });
  const [template, setTemplate] = useState('standard'); // print template: standard | compact
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Loading invoice…</div>;
  if (isError || !data?.sale) return (
    <div className="p-6">
      <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm"><ArrowLeft size={14} /> Back</button>
      <p className="mt-4 text-sm text-red-600">Invoice not found.</p>
    </div>
  );

  const { sale, items = [], payments = [], dispatch = {}, totals = {} } = data;
  const primary = items.find(i => i.lotId) || items[0] || {};

  const onPrintCustomer = () => {
    if (!printCustomerInvoice(data, companyProfileData, { template })) addToast?.('Pop-up blocked — allow pop-ups to print.', 'error');
  };
  const onEmailInvoice = async () => {
    setEmailBusy(true);
    try {
      const res = await localSalesApi.emailInvoice(sale.id, { to: emailTo.trim() || undefined });
      const status = res?.status || res?.data?.status;
      const to = res?.to || res?.data?.to || emailTo;
      if (status === 'Failed') addToast?.(`Email logged but the mail server reported an error. Check SMTP settings.`, 'error');
      else addToast?.(`Invoice emailed to ${to}.`, 'success');
      setEmailOpen(false);
    } catch (e) {
      addToast?.(e?.message || 'Could not send the invoice email.', 'error');
    } finally { setEmailBusy(false); }
  };
  const onWhatsApp = () => {
    const phone = String(sale.customerPhone || '').replace(/[^\d]/g, '');
    if (!phone) { addToast?.('No customer phone on file for WhatsApp.', 'error'); return; }
    const co = companyProfileData?.legalName || companyProfileData?.name || 'AGRI COMMODITIES';
    const lines = [
      `*${co}* — Invoice ${sale.invoiceNo}`,
      `Date: ${new Date(sale.date).toLocaleDateString('en-GB')}`,
      `Items: ${(items.map(i => i.gradeProduct).join(', ')) || '—'}`,
      `Total: Rs ${(totals.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `Received: Rs ${(totals.received || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `Outstanding: Rs ${(totals.outstanding || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    ];
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  };
  const onPrintAdmin = async () => {
    setAdminBusy(true);
    try {
      const res = await localSalesApi.getInvoiceAdmin(sale.id);
      const adminData = res?.data || res;
      if (!printAdminInvoice(adminData, companyProfileData)) addToast?.('Pop-up blocked — allow pop-ups to print.', 'error');
    } catch (e) {
      addToast?.(e?.status === 403 ? 'You are not permitted to view the admin copy.' : (e?.message || 'Could not load admin copy.'), 'error');
    } finally { setAdminBusy(false); }
  };

  const submitPayment = async () => {
    const amt = parseFloat(payForm.amount) || 0;
    if (amt <= 0) { addToast?.('Enter a valid amount.', 'error'); return; }
    try {
      await payMutation.mutateAsync({ saleId: sale.id, data: payForm });
      addToast?.('Payment recorded.', 'success');
      setPayOpen(false);
      refetch();
    } catch (e) {
      addToast?.(e?.message || 'Payment failed.', 'error');
    }
  };

  const ActionBtn = ({ icon: Icon, label, onClick, to, tone = 'default', disabled }) => {
    const cls = tone === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700'
      : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50';
    const inner = <><Icon size={14} /> {label}</>;
    if (to) return <Link to={to} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${cls}`}>{inner}</Link>;
    return <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${cls} disabled:opacity-50`}>{inner}</button>;
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Back</button>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2">
            Invoice {sale.invoiceNo}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_TONE[sale.paymentStatus] || 'bg-gray-100 text-gray-600'}`}>{sale.paymentStatus}</span>
            {sale.overdue && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 inline-flex items-center gap-1"><AlertTriangle size={11} /> Overdue</span>}
          </h1>
          {sale.saleGroupNo && sale.saleGroupNo !== sale.invoiceNo && <p className="text-xs text-gray-400">Group {sale.saleGroupNo}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={template} onChange={e => setTemplate(e.target.value)} title="Print template"
            className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700 outline-none">
            <option value="standard">Standard template</option>
            <option value="compact">Compact template</option>
          </select>
          <ActionBtn icon={Printer} label="Print customer invoice" tone="primary" onClick={onPrintCustomer} />
          {canSeeAdminCopy && <ActionBtn icon={ShieldCheck} label={adminBusy ? 'Preparing…' : 'Print admin copy'} onClick={onPrintAdmin} disabled={adminBusy} />}
          <ActionBtn icon={Mail} label="Email invoice" onClick={() => { setEmailTo(sale.customerEmail || ''); setEmailOpen(true); }} />
          <ActionBtn icon={MessageCircle} label="WhatsApp" onClick={onWhatsApp} />
          {sale.outstanding > 0.01 && <ActionBtn icon={Wallet} label="Record payment" onClick={() => { setPayForm(f => ({ ...f, amount: String(Math.round(sale.outstanding)) })); setPayOpen(true); }} />}
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Field label="Customer" value={sale.customer} sub={[sale.customerPhone, sale.customerAddress].filter(Boolean).join(' · ')} />
          <Field label="Invoice date" value={dt(sale.date)} />
          <Field label="Payment status" value={sale.paymentStatus} />
          <Field label="Dispatch status" value={dispatch.deliveryStatus} />
          <Field label="Total" value={pkr(totals.total)} />
          <Field label="Received" value={pkr(totals.received)} tone="emerald" />
          <Field label="Outstanding" value={pkr(totals.outstanding)} tone={totals.outstanding > 0 ? 'rose' : 'gray'} />
          <Field label="Due date" value={dt(sale.dueDate)} tone={sale.overdue ? 'rose' : 'gray'} />
        </div>
      </div>

      {/* Items + traceability */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5"><Package size={15} /> Items</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Rice type</th>
                <th className="px-4 py-2 text-left font-medium">Grade / product</th>
                <th className="px-4 py-2 text-right font-medium">Quantity</th>
                <th className="px-4 py-2 text-right font-medium">Bags</th>
                <th className="px-4 py-2 text-right font-medium">Rate/kg</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it) => (
                <ItemRow key={it.id} it={it} />
              ))}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-2" colSpan={2}>Total</td>
                <td className="px-4 py-2 text-right tabular-nums">{Math.round(totals.quantityKg).toLocaleString()} kg</td>
                <td className="px-4 py-2 text-right tabular-nums">{totals.bags ? Math.round(totals.bags).toLocaleString() : '—'}</td>
                <td className="px-4 py-2" />
                <td className="px-4 py-2 text-right tabular-nums">{pkr(totals.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-gray-400">Expand a row to trace its source lot, batch, warehouse and source purchased rice lots.</p>
      </div>

      {/* Source-batch by-product pricing — INTERNAL/ADMIN ONLY (never on the customer copy) */}
      {canSeeAdminCopy && (adminData?.batchByproducts || []).length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/60 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5"><Factory size={15} /> Source batch — by-product pricing</h3>
            <span className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold bg-amber-100 rounded px-1.5 py-0.5">Internal — not on customer copy</span>
          </div>
          {adminData.batchByproducts.map((bp) => (
            <div key={bp.batchId} className="border-b border-gray-100 last:border-0">
              <div className="px-4 pt-3 flex items-center justify-between flex-wrap gap-2">
                {/* TODO(backend): localSales.controller batchByproducts does not yet include batchName;
                    add batch_name so the ` (name)` suffix below renders. */}
                <Link to={bp.batchHref} className="text-sm font-medium text-blue-600 hover:underline inline-flex items-center gap-1.5">Batch {bp.batchNo}{bp.batchName ? ` (${bp.batchName})` : ''}</Link>
                {bp.byproductRecovery > 0 && <span className="text-xs text-emerald-700">By-product recovery {pkr(bp.byproductRecovery)}</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-xs">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Product / grade</th>
                      <th className="px-4 py-2 text-left font-medium">Type</th>
                      <th className="px-4 py-2 text-right font-medium">Produced</th>
                      <th className="px-4 py-2 text-right font-medium">Cost/kg</th>
                      <th className="px-4 py-2 text-right font-medium">Sale price/kg</th>
                      <th className="px-4 py-2 text-right font-medium">Recovery value</th>
                      <th className="px-4 py-2 text-left font-medium">Warehouse</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {bp.outputs.map((o) => (
                      <tr key={o.lotId}>
                        <td className="px-4 py-2"><Link to={o.href} className="text-blue-600 hover:underline">{o.productGrade}</Link></td>
                        <td className="px-4 py-2 text-gray-600">{o.type === 'byproduct' ? 'by-product' : 'finished'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{Math.round(o.producedKg).toLocaleString()} kg</td>
                        <td className="px-4 py-2 text-right tabular-nums">{o.costPerKg ? pkr(o.costPerKg) : '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{o.salePricePerKg ? pkr(o.salePricePerKg) : '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{o.recoveryValue ? pkr(o.recoveryValue) : '—'}</td>
                        <td className="px-4 py-2 text-gray-600">{o.warehouse || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="px-4 py-2 text-[11px] text-gray-400">Per-grade valuation of the milling batch that produced the sold rice (set at yield, same basis as Batch 360). By-product recovery is credited back into the finished cost under residual costing. Shown to authorized staff only — excluded from the customer invoice.</p>
        </div>
      )}

      {/* Payment timeline */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 inline-flex items-center gap-1.5"><Wallet size={15} /> Payment timeline</h3>
        <ol className="relative border-l border-gray-200 ml-2 space-y-3">
          {payments.map((e, i) => (
            <li key={i} className="ml-4">
              <span className={`absolute -left-1.5 w-3 h-3 rounded-full ${e.kind === 'created' ? 'bg-slate-400' : 'bg-emerald-500'}`} />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm text-gray-700">
                  {e.kind === 'created' ? 'Invoice created' : <>Receipt {e.paymentNo ? `· ${e.paymentNo}` : ''} <span className="text-gray-400">· {(e.mode || '').replace(/_/g, ' ')}{e.reference ? ` · ${e.reference}` : ''}{e.cleared === false ? ' · (uncleared)' : ''}</span></>}
                  <span className="text-[11px] text-gray-400"> · {dt(e.date)}</span>
                </span>
                <span className="text-sm tabular-nums">
                  {e.kind === 'payment' && <span className="text-emerald-700 mr-3">−{pkr(e.amount)}</span>}
                  <span className="text-gray-500">Balance {pkr(e.balance)}</span>
                </span>
              </div>
            </li>
          ))}
          {sale.outstanding > 0.01 && (
            <li className="ml-4">
              <span className={`absolute -left-1.5 w-3 h-3 rounded-full ${sale.overdue ? 'bg-red-500' : 'bg-amber-400'}`} />
              <span className={`text-sm ${sale.overdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                {sale.overdue ? 'Overdue' : 'Balance due'} {pkr(sale.outstanding)}{sale.dueDate ? ` · due ${dt(sale.dueDate)}` : ''}
              </span>
            </li>
          )}
        </ol>
      </div>

      {/* Dispatch + intake (purchase) vehicles */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 inline-flex items-center gap-1.5"><Truck size={15} /> Vehicles &amp; dispatch</h3>
        <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">Outbound (sold / dispatch)</p>
        <div className="flex flex-wrap gap-2 text-xs mb-3">
          <Chip tone={dispatch.dispatched ? 'emerald' : 'gray'}>{dispatch.deliveryStatus}</Chip>
          {dispatch.dispatchDate && <Chip>{dt(dispatch.dispatchDate)}</Chip>}
          {dispatch.vehicleNo && <Chip>Truck {dispatch.vehicleNo}</Chip>}
          {dispatch.driverName && <Chip>Driver {dispatch.driverName}</Chip>}
          {dispatch.collectionLocation && <Chip>Collected at {dispatch.collectionLocation}</Chip>}
          {!dispatch.dispatchDate && !dispatch.vehicleNo && !dispatch.driverName && <span className="text-gray-400">No dispatch details recorded.</span>}
        </div>
        <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">Inbound (purchased / received)</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {(dispatch.intakeVehicles || []).length > 0
            ? dispatch.intakeVehicles.map((v, i) => (
                <Chip key={i}>Truck {v.vehicleNo}{v.driverName ? ` · ${v.driverName}` : ''}{v.weightMt ? ` · ${v.weightMt} MT` : ''}{v.arrivalDate ? ` · ${dt(v.arrivalDate)}` : ''}</Chip>
              ))
            : <span className="text-gray-400">No purchase/intake vehicle recorded for the source lot.</span>}
        </div>
      </div>

      {/* Related ledgers */}
      <div className="flex flex-wrap gap-2">
        {sale.customerId && <ActionBtn icon={BookUser} label="Customer ledger" to={`/finance/statements?type=customer&id=${sale.customerId}`} />}
        {primary.finishedGoodsHref && <ActionBtn icon={Package} label="Lot ledger" to={primary.finishedGoodsHref} />}
        {primary.batchHref && <ActionBtn icon={Factory} label="Batch ledger" to={primary.batchHref} />}
      </div>

      {/* Email invoice modal */}
      <SlideDrawer open={emailOpen} onClose={() => setEmailOpen(false)} title="Email invoice" subtitle={`Send invoice ${sale.invoiceNo} to the customer`} icon={Mail} size="md">
        {emailOpen && (
          <div className="space-y-3">
            <Lbl text="Recipient email">
              <input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="customer@email.com"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
            </Lbl>
            {!sale.customerEmail && <p className="text-[11px] text-amber-600">No email on file for this customer — enter one to send.</p>}
            <p className="text-[11px] text-gray-400">Sends the customer invoice (no cost/margin) via email. Requires the mail server to be configured.</p>
            <button onClick={onEmailInvoice} disabled={emailBusy || !emailTo.trim()}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <Mail size={14} /> {emailBusy ? 'Sending…' : 'Send invoice'}
            </button>
          </div>
        )}
      </SlideDrawer>

      {/* Record payment modal */}
      <SlideDrawer open={payOpen} onClose={() => setPayOpen(false)} title="Record payment" subtitle={`Against invoice ${sale.invoiceNo}`} icon={Wallet} size="md">
        {payOpen && (
          <div className="space-y-3">
            <Lbl text="Amount"><input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" /></Lbl>
            <Lbl text="Method">
              <select value={payForm.payment_method} onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                <option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option><option value="credit">Credit (udhaar)</option>
              </select>
            </Lbl>
            {(payForm.payment_method === 'cash' || payForm.payment_method === 'credit') && (
              <Lbl text="Collection location">
                <select value={payForm.collection_location} onChange={e => setPayForm(f => ({ ...f, collection_location: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none">
                  <option value="Mill">Mill</option><option value="Head Office">Head Office</option>
                </select>
              </Lbl>
            )}
            <Lbl text="Reference (cheque / bank ref)"><input value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" /></Lbl>
            <Lbl text="Payment date"><input type="date" value={payForm.payment_date} onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" /></Lbl>
            {payForm.payment_method === 'cheque' && <Lbl text="Cheque due/clearing date"><input type="date" value={payForm.due_date} onChange={e => setPayForm(f => ({ ...f, due_date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" /></Lbl>}
            <button onClick={submitPayment} disabled={payMutation.isPending} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              <Wallet size={14} /> {payMutation.isPending ? 'Recording…' : 'Record payment'}
            </button>
          </div>
        )}
      </SlideDrawer>
    </div>
  );
}

function ItemRow({ it }) {
  const [open, setOpen] = useState(false);
  const hasTrace = it.lotNo || it.batchNo || it.warehouse || (it.sourceLots || []).length || (it.intakeVehicles || []).length;
  return (
    <>
      <tr className={`hover:bg-gray-50 ${hasTrace ? 'cursor-pointer' : ''}`} onClick={() => hasTrace && setOpen(o => !o)}>
        <td className="px-4 py-2">
          {hasTrace && <ChevronRight size={13} className={`inline mr-1 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />}
          {it.riceType}{it.isBlend ? <span className="text-gray-400"> · blend</span> : ''}
        </td>
        <td className="px-4 py-2">{it.gradeProduct}{it.itemType ? <span className="text-gray-400"> · {it.itemType}</span> : ''}</td>
        <td className="px-4 py-2 text-right tabular-nums">{Math.round(it.quantityKg).toLocaleString()} kg</td>
        <td className="px-4 py-2 text-right tabular-nums">{it.bags != null ? it.bags.toLocaleString() : '—'}</td>
        <td className="px-4 py-2 text-right tabular-nums">{it.ratePerKg > 0 ? pkr(it.ratePerKg) : '—'}</td>
        <td className="px-4 py-2 text-right tabular-nums">{pkr(it.amount)}</td>
      </tr>
      {open && hasTrace && (
        <tr className="bg-gray-50/60 text-xs">
          <td className="px-4 py-2 pl-9" colSpan={6}>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-600">
              {it.lotNo && <span>Source lot: {it.finishedGoodsHref ? <Link to={it.finishedGoodsHref} className="font-mono text-blue-600 hover:underline">{it.lotNo}</Link> : <span className="font-mono">{it.lotNo}</span>}</span>}
              {it.warehouse && <span>Warehouse: <span className="text-gray-800">{it.warehouse}</span></span>}
              {/* TODO(backend): item.batchNo comes from a select of batch_no only; add batch_name for the ` (name)` suffix. */}
              {it.batchNo && <span>Source batch: <Link to={it.batchHref} className="text-blue-600 hover:underline">{it.batchNo}{it.batchName ? ` (${it.batchName})` : ''}</Link></span>}
              {it.finishedGoodsHref && <span>Finished goods: <Link to={it.finishedGoodsHref} className="text-blue-600 hover:underline">open lot</Link></span>}
            </div>
            {(it.sourceLots || []).length > 0 && (
              <div className="mt-1.5 text-gray-600">
                Source purchased rice lots:
                {it.sourceLots.map((s, i) => (
                  <span key={i}>{i > 0 ? ',' : ''} {s.href ? <Link to={s.href} className="font-mono text-blue-600 hover:underline">{s.lotNo}</Link> : <span className="font-mono">{s.lotNo}</span>}{s.supplier && s.supplier !== '—' ? ` (${s.supplier})` : ''}</span>
                ))}
              </div>
            )}
            {(it.intakeVehicles || []).length > 0 && (
              <div className="mt-1.5 text-gray-600">
                Purchased / received on:
                {it.intakeVehicles.map((v, i) => (
                  <span key={i} className="text-gray-800">{i > 0 ? ', ' : ' '}{v.vehicleNo}{v.driverName ? ` (${v.driverName})` : ''}{v.weightMt ? ` · ${v.weightMt} MT` : ''}{v.arrivalDate ? ` · ${dt(v.arrivalDate)}` : ''}</span>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Field({ label, value, sub, tone = 'gray' }) {
  const toneCls = { emerald: 'text-emerald-700', rose: 'text-red-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-sm font-medium ${toneCls}`}>{value || '—'}</p>
      {sub && <p className="text-[11px] text-gray-400 truncate">{sub}</p>}
    </div>
  );
}

function Chip({ children, tone = 'gray' }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-gray-50 border-gray-200 text-gray-600';
  return <span className={`px-2.5 py-1 rounded-lg border ${cls}`}>{children}</span>;
}

function Lbl({ text, children }) {
  return <label className="block"><span className="text-xs text-gray-500 block mb-1">{text}</span>{children}</label>;
}
