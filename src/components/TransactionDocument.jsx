import { useRef } from 'react';
import { Printer, Download } from 'lucide-react';

// One printable/downloadable document for the three transaction kinds:
//   kind='receipt' → Payment Receipt (Money In / a receivable)
//   kind='voucher' → Payment Voucher (Money Out / a payable or purchase)
//   kind='invoice' → Sales Invoice  (a local sale, incl. line item + balance)
// Styled to print as a single A4 portrait page (clean new-window render that
// clones the app stylesheets), mirroring ProformaInvoice's approach.

const sym = (c) => {
  const u = (c || 'PKR').toUpperCase();
  return u === 'PKR' ? 'Rs ' : u === 'USD' ? '$' : u === 'EUR' ? '€' : u === 'GBP' ? '£' : `${u} `;
};
const money = (v, c) => `${sym(c)}${Math.round(parseFloat(v) || 0).toLocaleString()}`;
const dt = (d) => { if (!d) return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); const x = new Date(d); return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };

const METHOD = { cash: 'Cash', cheque: 'Cheque', bank: 'Bank Transfer', bank_transfer: 'Bank Transfer', online: 'Online', mobile: 'Mobile' };

// Map the raw drawer/sale object → a normalized doc model per kind.
function model(kind, d) {
  if (kind === 'invoice') {
    const line = (it) => {
      const qtyKg = parseFloat(it.quantityKg ?? it.qty) || 0;
      const rate = parseFloat(it.ratePerKg ?? it.rate) || 0;
      const unit = (it.quantityUnit === 'pcs' || it.itemType === 'packaging' || it.millItemId) ? 'pcs' : 'kg';
      return {
        desc: [it.itemName || it.desc, it.itemType && it.itemType !== it.itemName ? `(${it.itemType})` : ''].filter(Boolean).join(' '),
        qty: qtyKg ? `${Math.round(qtyKg).toLocaleString()} ${unit}` : '—',
        rate: rate ? `${money(rate, 'PKR')}/${unit}` : '—',
        amount: parseFloat(it.totalAmount ?? it.amount) || 0,
      };
    };
    const items = (Array.isArray(d.items) && d.items.length) ? d.items.map(line) : [line(d)];
    const total = parseFloat(d.totalAmount) || items.reduce((s, i) => s + i.amount, 0);
    return {
      title: 'Sales Invoice', refNo: d.saleNo, date: d.saleDate || d.createdAt,
      partyLabel: 'Bill To', party: d.customerName || d.buyerName || 'Walk-in customer',
      currency: 'PKR',
      items,
      total, paid: parseFloat(d.paidAmount) || 0, balance: parseFloat(d.dueAmount) || 0,
      status: d.paymentStatus, method: d.paymentMode || d.payment_mode,
      reference: d.paymentReference || d.payment_reference,
      dispatch: {
        warehouse: d.warehouse || d.warehouseName || d.warehouse_name || null,
        truck: d.vehicleNo || d.vehicle_no || null,
        driver: d.driverName || d.driver_name || null,
        dispatchDate: d.dispatchDate || d.dispatch_date || null,
        deliveryStatus: (d.dispatched != null) ? (d.dispatched ? 'Dispatched' : 'Not dispatched') : (d.deliveryStatus || null),
        collection: d.collectionLocation || d.collection_location || null,
      },
    };
  }
  if (kind === 'voucher') {
    return {
      title: 'Payment Voucher', refNo: d.payNo, date: d.dueDate,
      partyLabel: 'Paid To', party: d.supplierName || 'Supplier', currency: d.currency || 'PKR',
      // Line items (what was purchased), when the underlying record has them.
      items: Array.isArray(d.items) ? d.items.map((it) => ({ desc: it.desc || it.name, qty: it.qty, rate: it.rate, amount: it.amount })) : [],
      summary: [
        d.category ? ['For', String(d.category).replace(/_/g, ' ')] : null,
        d.linkedRef ? ['Reference', d.linkedRef] : null,
        d.entity ? ['Entity', d.entity] : null,
      ].filter(Boolean),
      total: parseFloat(d.originalAmount) || 0, paid: parseFloat(d.paidAmount) || 0, balance: parseFloat(d.outstanding) || 0,
      status: d.status,
    };
  }
  // receipt (money in)
  return {
    title: 'Payment Receipt', refNo: d.recvNo, date: d.dueDate,
    partyLabel: 'Received From', party: d.customerName || 'Customer', currency: d.currency || 'PKR',
    items: Array.isArray(d.items) ? d.items.map((it) => ({ desc: it.desc || it.name, qty: it.qty, rate: it.rate, amount: it.amount })) : [],
    summary: [
      d.type ? ['Type', d.type] : null,
      d.orderId ? ['Order', d.orderId] : null,
    ].filter(Boolean),
    total: parseFloat(d.expectedAmount) || 0, paid: parseFloat(d.receivedAmount) || 0, balance: parseFloat(d.outstanding) || 0,
    status: d.status,
  };
}

export default function TransactionDocument({ kind = 'receipt', data, companyProfile }) {
  const ref = useRef(null);
  if (!data) return null;
  const m = model(kind, data);
  const cur = m.currency;
  const co = companyProfile || {};
  const companyName = co.legalName || co.name || 'AGRI COMMODITIES';

  const openPrintable = () => {
    const node = ref.current;
    if (!node) return;
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((l) => l.outerHTML).join('');
    const w = window.open('', '_blank', 'width=820,height=1100');
    if (!w) { window.print(); return; }
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${m.title} ${m.refNo || ''}</title>${links}`
      + '<style>@page{size:A4 portrait;margin:12mm}html,body{margin:0;padding:0;background:#fff}'
      + '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      + '#td-doc{box-shadow:none!important;border:0!important;width:100%!important;max-width:none!important}'
      + '.td-actions{display:none!important}</style></head><body>'
      + `<div>${node.outerHTML}</div>`
      + '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},250)});</script>'
      + '</body></html>'
    );
    w.document.close();
  };

  const STATUS = {
    Paid: 'bg-emerald-100 text-emerald-700', Partial: 'bg-amber-100 text-amber-700',
    Unpaid: 'bg-rose-100 text-rose-700', Pending: 'bg-rose-100 text-rose-700',
  };

  return (
    <div className="space-y-3">
      <div className="td-actions flex justify-end gap-2 print:hidden">
        <button onClick={openPrintable} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
          <Download size={15} /> Download PDF
        </button>
        <button onClick={openPrintable} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
          <Printer size={15} /> Print
        </button>
      </div>

      <div id="td-doc" ref={ref} className="bg-white border border-gray-200 rounded-lg p-6" style={{ fontFamily: "'Segoe UI', Tahoma, sans-serif", color: '#1f2937' }}>
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-gray-900 pb-3">
          <div>
            <div className="text-lg font-bold uppercase tracking-wide" style={{ color: '#1e3a5f' }}>{companyName}</div>
            {co.address && <div className="text-[11px] text-gray-500 mt-0.5 max-w-[260px]">{co.address}</div>}
            <div className="text-[11px] text-gray-500">{[co.phone, co.email].filter(Boolean).join(' · ')}</div>
            {co.ntn && <div className="text-[11px] text-gray-500">NTN: {co.ntn}</div>}
          </div>
          <div className="text-right">
            <div className="text-base font-bold uppercase">{m.title}</div>
            {m.refNo && <div className="text-sm text-gray-700">{m.refNo}</div>}
            <div className="text-[11px] text-gray-500">Date: {dt(m.date)}</div>
          </div>
        </div>

        {/* Party */}
        <div className="flex items-start justify-between mt-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{m.partyLabel}</div>
            <div className="text-sm font-semibold text-gray-900">{m.party}</div>
          </div>
          {m.status && <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS[m.status] || 'bg-gray-100 text-gray-600'}`}>{m.status}</span>}
        </div>

        {/* Body: line items (invoice always; voucher/receipt when present),
            otherwise the receipt/voucher summary box. */}
        {(kind === 'invoice' || (m.items && m.items.length > 0)) ? (
          <table className="w-full text-sm mt-4 border-collapse">
            <thead>
              <tr className="bg-gray-50 text-[11px] uppercase text-gray-500">
                <th className="text-left py-2 px-2 border-y border-gray-200">{kind === 'voucher' ? 'Item purchased' : 'Description'}</th>
                <th className="text-right py-2 px-2 border-y border-gray-200">Qty</th>
                <th className="text-right py-2 px-2 border-y border-gray-200">Rate</th>
                <th className="text-right py-2 px-2 border-y border-gray-200">Amount</th>
              </tr>
            </thead>
            <tbody>
              {m.items.map((it, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-2 px-2 text-gray-800">{it.desc || '—'}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{it.qty != null && it.qty !== '' ? it.qty : '—'}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{it.rate != null && it.rate !== '' ? it.rate : '—'}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-medium">{money(it.amount, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          (m.summary?.length > 0) && (
            <div className="mt-4 rounded-lg bg-gray-50 p-3 grid grid-cols-2 gap-x-6 gap-y-1">
              {m.summary.map(([k, v], i) => (
                <div key={i} className="flex justify-between text-sm"><span className="text-gray-500">{k}</span><span className="font-medium text-gray-800">{v}</span></div>
              ))}
            </div>
          )
        )}

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 text-sm">
            <div className="flex justify-between py-1"><span className="text-gray-500">{kind === 'voucher' ? 'Bill amount' : kind === 'invoice' ? 'Total' : 'Expected'}</span><span className="tabular-nums font-medium">{money(m.total, cur)}</span></div>
            <div className="flex justify-between py-1"><span className="text-gray-500">{kind === 'receipt' ? 'Received' : 'Paid'}</span><span className="tabular-nums text-emerald-700 font-medium">{money(m.paid, cur)}</span></div>
            <div className="flex justify-between py-1.5 border-t-2 border-gray-300 mt-1"><span className="font-semibold text-gray-700">Balance</span><span className={`tabular-nums font-bold ${m.balance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(m.balance, cur)}</span></div>
          </div>
        </div>

        {/* Payment meta (invoice) */}
        {(m.method || m.reference) && (
          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
            {m.method && <div className="flex justify-between"><span className="text-gray-500">Payment method</span><span className="text-gray-800">{METHOD[m.method] || m.method}</span></div>}
            {m.reference && <div className="flex justify-between"><span className="text-gray-500">Reference</span><span className="text-gray-800">{m.reference}</span></div>}
          </div>
        )}

        {/* Dispatch (invoice) — warehouse, truck, driver, dispatch date, delivery status */}
        {m.dispatch && (m.dispatch.warehouse || m.dispatch.truck || m.dispatch.driver || m.dispatch.dispatchDate || m.dispatch.deliveryStatus || m.dispatch.collection) && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Dispatch</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
              {m.dispatch.warehouse && <div className="flex justify-between"><span className="text-gray-500">Warehouse</span><span className="text-gray-800">{m.dispatch.warehouse}</span></div>}
              {m.dispatch.deliveryStatus && <div className="flex justify-between"><span className="text-gray-500">Delivery status</span><span className="text-gray-800">{m.dispatch.deliveryStatus}</span></div>}
              {m.dispatch.truck && <div className="flex justify-between"><span className="text-gray-500">Truck no</span><span className="text-gray-800">{m.dispatch.truck}</span></div>}
              {m.dispatch.dispatchDate && <div className="flex justify-between"><span className="text-gray-500">Dispatch date</span><span className="text-gray-800">{dt(m.dispatch.dispatchDate)}</span></div>}
              {m.dispatch.driver && <div className="flex justify-between"><span className="text-gray-500">Driver</span><span className="text-gray-800">{m.dispatch.driver}</span></div>}
              {m.dispatch.collection && <div className="flex justify-between"><span className="text-gray-500">Collected at</span><span className="text-gray-800">{m.dispatch.collection}</span></div>}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 flex items-end justify-between text-[11px] text-gray-400">
          <div>Computer-generated {m.title.toLowerCase()} — no signature required.</div>
          <div className="text-center"><div className="w-40 border-t border-gray-400 pt-1">Authorised Signature</div></div>
        </div>
      </div>
    </div>
  );
}
