// Purchase Invoice / GRN 360 — a read-only detail view of one purchased rice
// lot (the lot IS the purchase record). Mirrors the sales Invoice 360: header,
// item, inbound (purchase) vehicle(s), supplier payment timeline, traceability,
// and a print. Additive/read-only — assembles existing lot/payable data.
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Truck, Package, BookUser, AlertTriangle, ShoppingCart, Factory } from 'lucide-react';
import { lotInventoryApi } from '../../../api/services';
import { useApp } from '../../../context/AppContext';
import { printPurchaseInvoice } from '../../localSales/utils/invoicePrint';

const pkr = (v) => `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const STATUS_TONE = { Paid: 'bg-emerald-100 text-emerald-700', Partial: 'bg-amber-100 text-amber-700', Unpaid: 'bg-red-100 text-red-700', Pending: 'bg-red-100 text-red-700' };

export default function PurchaseInvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyProfileData, addToast } = useApp();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['lot', 'purchase-invoice', id],
    queryFn: async () => { const res = await lotInventoryApi.getPurchaseInvoice(id); return res?.data || res; },
    retry: false,
  });

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Loading purchase invoice…</div>;
  if (isError || !data?.purchase) return (
    <div className="p-6">
      <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm"><ArrowLeft size={14} /> Back</button>
      <p className="mt-4 text-sm text-red-600">{error?.message || 'Purchase invoice not available for this lot.'}</p>
    </div>
  );

  const { purchase: p, costs = {}, intakeVehicles = [], payments = [], producedByproducts = [] } = data;

  const onPrint = () => { if (!printPurchaseInvoice(data, companyProfileData)) addToast?.('Pop-up blocked — allow pop-ups to print.', 'error'); };

  const ActionBtn = ({ icon: Icon, label, onClick, to, tone = 'default' }) => {
    const cls = tone === 'primary' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50';
    const inner = <><Icon size={14} /> {label}</>;
    if (to) return <Link to={to} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${cls}`}>{inner}</Link>;
    return <button onClick={onClick} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${cls}`}>{inner}</button>;
  };
  const Field = ({ label, value, sub, tone = 'gray' }) => {
    const t = { emerald: 'text-emerald-700', rose: 'text-red-600', gray: 'text-gray-900' }[tone] || 'text-gray-900';
    return <div><p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p><p className={`text-sm font-medium ${t}`}>{value || '—'}</p>{sub && <p className="text-[11px] text-gray-400 truncate">{sub}</p>}</div>;
  };
  const Chip = ({ children }) => <span className="px-2.5 py-1 rounded-lg border bg-gray-50 border-gray-200 text-gray-600">{children}</span>;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5 no-mobile-cards">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate(-1)} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-sm mb-1"><ArrowLeft size={14} /> Back</button>
          <h1 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2">
            <ShoppingCart size={20} /> Purchase {p.purchaseNo}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_TONE[p.paymentStatus] || 'bg-gray-100 text-gray-600'}`}>{p.paymentStatus || '—'}</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionBtn icon={Printer} label="Print purchase invoice" tone="primary" onClick={onPrint} />
          {p.supplierHref && <ActionBtn icon={BookUser} label="Supplier ledger" to={p.supplierHref} />}
          <ActionBtn icon={Package} label="Open lot detail" to={p.lotHref} />
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Field label="Supplier" value={p.supplier} sub={[p.supplierPhone, p.supplierAddress].filter(Boolean).join(' · ')} />
          <Field label="Purchase date" value={dt(p.date)} />
          <Field label="Payment status" value={p.paymentStatus} />
          <Field label="Warehouse" value={p.warehouse} />
          <Field label="Landed total" value={pkr(p.landedTotal)} />
          <Field label="Paid" value={pkr(p.paid)} tone="emerald" />
          <Field label="Outstanding" value={pkr(p.outstanding)} tone={p.outstanding > 0 ? 'rose' : 'gray'} />
          <Field label="Lot no" value={p.purchaseNo} />
        </div>
      </div>

      {/* Item + cost */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5"><Package size={15} /> Purchased rice</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs"><tr>
              <th className="px-4 py-2 text-left font-medium">Rice type</th><th className="px-4 py-2 text-left font-medium">Grade</th>
              <th className="px-4 py-2 text-right font-medium">Quantity</th><th className="px-4 py-2 text-right font-medium">Bags</th>
              <th className="px-4 py-2 text-right font-medium">Rate/kg</th><th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="px-4 py-2">{p.riceType}</td><td className="px-4 py-2">{p.grade || '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Math.round(p.quantityKg).toLocaleString()} kg<div className="text-[11px] text-gray-400">{(p.quantityMt || 0).toFixed(2)} MT</div></td>
                <td className="px-4 py-2 text-right tabular-nums">{p.bags != null ? p.bags.toLocaleString() : '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{p.ratePerKg > 0 ? pkr(p.ratePerKg) : '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{pkr(p.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Landed cost breakdown */}
        <div className="px-4 py-3 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs text-gray-600">
          <span>Rice cost: <b className="text-gray-800">{pkr(costs.riceCost ?? p.amount)}</b></span>
          {costs.transport > 0 && <span>Transport{costs.transportVendor ? ` (${costs.transportVendor})` : ''}: <b className="text-gray-800">{pkr(costs.transport)}</b></span>}
          {costs.unloading > 0 && <span>Unloading: <b className="text-gray-800">{pkr(costs.unloading)}</b></span>}
          {costs.labor > 0 && <span>Labour: <b className="text-gray-800">{pkr(costs.labor)}</b></span>}
          {costs.packing > 0 && <span>Packing: <b className="text-gray-800">{pkr(costs.packing)}</b></span>}
          {costs.other > 0 && <span>Other: <b className="text-gray-800">{pkr(costs.other)}</b></span>}
          <span>Landed total: <b className="text-gray-900">{pkr(p.landedTotal)}</b></span>
        </div>
      </div>

      {/* Inbound (purchase) vehicles */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 inline-flex items-center gap-1.5"><Truck size={15} /> Inbound (purchase) vehicles</h3>
        <div className="flex flex-wrap gap-2 text-xs">
          {intakeVehicles.length > 0
            ? intakeVehicles.map((v, i) => <Chip key={i}>Truck {v.vehicleNo}{v.driverName ? ` · ${v.driverName}` : ''}{v.weightMt ? ` · ${v.weightMt} MT` : ''}{v.totalBags ? ` · ${v.totalBags} bags` : ''}{v.arrivalDate ? ` · ${dt(v.arrivalDate)}` : ''}</Chip>)
            : <span className="text-gray-400">No intake vehicle recorded for this lot.</span>}
        </div>
      </div>

      {/* Produced by-product pricing — INTERNAL/ADMIN ONLY (server omits for non-admin) */}
      {producedByproducts.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/60 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5"><Factory size={15} /> Produced from this lot — by-product pricing</h3>
            <span className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold bg-amber-100 rounded px-1.5 py-0.5">Internal — not for supplier</span>
          </div>
          {producedByproducts.map((bp) => (
            <div key={bp.batchId} className="border-b border-gray-100 last:border-0">
              <div className="px-4 pt-3 flex items-center justify-between flex-wrap gap-2">
                {/* TODO(backend): lotInventory.controller producedByproducts does not yet include batchName;
                  add batch_name so the ` (name)` suffix renders. */}
              <Link to={bp.batchHref} className="text-sm font-medium text-blue-600 hover:underline">Batch {bp.batchNo}{bp.batchName ? ` (${bp.batchName})` : ''}{bp.sharePct < 99.5 ? ` · ${bp.sharePct.toFixed(0)}% of this lot` : ''}</Link>
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
          <p className="px-4 py-2 text-[11px] text-gray-400">Per-grade valuation of the milling batch(es) this purchased rice fed, attributed by this lot's share (set at yield, same basis as Lot/Batch 360). By-product recovery is credited back into the finished cost under residual costing. Shown to authorized staff only — excluded from non-admin views and supplier-facing copies.</p>
        </div>
      )}

      {/* Payment timeline */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Payment timeline (to supplier)</h3>
        <ol className="relative border-l border-gray-200 ml-2 space-y-3">
          {payments.map((e, i) => (
            <li key={i} className="ml-4">
              <span className={`absolute -left-1.5 w-3 h-3 rounded-full ${e.kind === 'created' ? 'bg-slate-400' : 'bg-emerald-500'}`} />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm text-gray-700">{e.kind === 'created' ? 'Purchase recorded' : <>Payment {e.paymentNo ? `· ${e.paymentNo}` : ''} <span className="text-gray-400">· {(e.mode || '').replace(/_/g, ' ')}{e.reference ? ` · ${e.reference}` : ''}</span></>}<span className="text-[11px] text-gray-400"> · {dt(e.date)}</span></span>
                <span className="text-sm tabular-nums">{e.kind === 'payment' && <span className="text-emerald-700 mr-3">−{pkr(e.amount)}</span>}<span className="text-gray-500">Balance {pkr(e.balance)}</span></span>
              </div>
            </li>
          ))}
          {p.outstanding > 0.01 && (
            <li className="ml-4"><span className="absolute -left-1.5 w-3 h-3 rounded-full bg-amber-400" /><span className="text-sm text-gray-600">Balance due {pkr(p.outstanding)}</span></li>
          )}
        </ol>
      </div>
    </div>
  );
}
