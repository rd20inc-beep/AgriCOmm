import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Eye, Edit2, Send, Check, X, ArrowRightCircle, Trash2, FileText, ExternalLink } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import Modal from '../../../components/Modal';
import ProformaInvoice from '../../../components/ProformaInvoice';
import QuotationDrawer from './QuotationDrawer';
import { quotationsApi } from '../api/services';

const num = (v) => parseFloat(v) || 0;
const STATUS_TABS = ['All', 'Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'];
const STATUS_STYLE = {
  Draft: 'bg-gray-100 text-gray-600',
  Sent: 'bg-blue-100 text-blue-700',
  Accepted: 'bg-emerald-100 text-emerald-700',
  Rejected: 'bg-rose-100 text-rose-700',
  Expired: 'bg-amber-100 text-amber-800',
};

// Map a full quotation (snake_case, with items + joined customer fields) into the
// camelCase `order` shape the ProformaInvoice component reads, so a quote reuses
// the exact PI layout — rendered as a QUOTATION.
function quotationToOrder(q) {
  const items = (q.items || []).map((it) => ({
    productName: it.product_name || '',
    qtyMT: num(it.qty_mt),
    pricePerMT: num(it.price_per_mt),
    lineTotal: num(it.line_total),
    hsCode: it.hs_code || '',
    bagSizeKg: it.bag_size_kg != null ? num(it.bag_size_kg) : null,
    bagType: it.bag_type || '',
    bagCount: it.bag_count != null ? parseInt(it.bag_count) : null,
    packing: it.packing || '',
    qualityDescription: it.quality_description || '',
  }));
  const qty = items.reduce((s, it) => s + it.qtyMT, 0);
  const riceSubtotal = items.reduce((s, it) => s + it.lineTotal, 0);
  // Itemize the packing breakdown (bag + master + poly) when present, else the
  // single flat packing charge.
  const packLines = Array.isArray(q.packing_lines) ? q.packing_lines : [];
  const packCharges = packLines.length
    ? packLines.map((l) => {
        const sz = num(l.sizeKg) > 0 ? ` ${num(l.sizeKg)}kg` : '';
        const qn = num(l.qty) ? ` (${Math.round(num(l.qty)).toLocaleString()})` : '';
        return { label: `${l.label || 'Packing'}${sz}${qn}`, amount: num(l.amount) };
      })
    : [{ label: 'Packing / Bags', amount: num(q.packing_cost) }];
  const charges = [
    ...packCharges,
    { label: 'Freight', amount: num(q.freight_cost) },
    { label: 'Other Charges', amount: num(q.other_charges) },
  ].filter((c) => c.amount > 0);
  const total = num(q.total_amount) || (riceSubtotal + charges.reduce((s, c) => s + c.amount, 0));
  return {
    charges,
    id: q.quotation_no,
    createdAt: q.quote_date || q.created_at,
    customerName: q.customer_name || '',
    customerAddress: q.customer_address || '',
    country: q.country || q.customer_country || '',
    destinationCountry: q.country || q.customer_country || '',
    docAddressMode: 'country',
    currency: q.currency || 'USD',
    incoterm: q.incoterm || '',
    destinationPort: q.destination_port || '',
    portOfLoading: q.port_of_loading || 'Karachi, Pakistan',
    paymentTerms: q.payment_terms || '',
    advancePct: num(q.advance_pct),
    contractValue: total,
    advanceExpected: total * (num(q.advance_pct) / 100),
    qtyMT: qty,
    pricePerMT: qty > 0 ? total / qty : 0,
    productName: items[0]?.productName || '',
    bagSizeKg: items[0]?.bagSizeKg || null,
    bagType: items[0]?.bagType || '',
    items,
  };
}

export default function QuotationsPanel() {
  const { companyProfileData, addToast } = useApp();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState('All');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pdfOrder, setPdfOrder] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await quotationsApi.list();
      setRows(res?.data?.quotations || []);
    } catch (err) {
      addToast(err?.response?.data?.message || 'Failed to load quotations', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = statusTab === 'All' ? rows : rows.filter((r) => r.status === statusTab);

  async function openEdit(row) {
    try {
      const res = await quotationsApi.get(row.id);
      setEditing(res?.data?.quotation || row);
      setDrawerOpen(true);
    } catch { addToast('Failed to open quotation', 'error'); }
  }
  async function openPdf(row) {
    try {
      const res = await quotationsApi.get(row.id);
      setPdfOrder(quotationToOrder(res?.data?.quotation || row));
    } catch { addToast('Failed to load quotation', 'error'); }
  }
  async function setStatus(row, status) {
    setBusyId(row.id);
    try { await quotationsApi.setStatus(row.id, status); await load(); }
    catch (err) { addToast(err?.response?.data?.message || 'Failed to update status', 'error'); }
    finally { setBusyId(null); }
  }
  async function convert(row) {
    if (!window.confirm(`Convert ${row.quotation_no} into an export order? This creates the order (with receivables & document checklist) from this quote.`)) return;
    setBusyId(row.id);
    try {
      const res = await quotationsApi.convert(row.id);
      const orderNo = res?.data?.order_no;
      addToast(`Converted to export order ${orderNo}`, 'success');
      await load();
      if (orderNo) navigate(`/export/${orderNo}`);
    } catch (err) {
      addToast(err?.response?.data?.message || 'Failed to convert', 'error');
    } finally { setBusyId(null); }
  }
  async function remove(row) {
    if (!window.confirm(`Delete quotation ${row.quotation_no}? This cannot be undone.`)) return;
    setBusyId(row.id);
    try { await quotationsApi.remove(row.id); await load(); addToast('Quotation deleted', 'success'); }
    catch (err) { addToast(err?.response?.data?.message || 'Failed to delete', 'error'); }
    finally { setBusyId(null); }
  }

  const iconBtn = 'inline-flex items-center gap-1 text-xs font-medium';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_TABS.map((s) => (
            <button key={s} onClick={() => setStatusTab(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border ${statusTab === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {s}{s !== 'All' && ` (${rows.filter((r) => r.status === s).length})`}
            </button>
          ))}
        </div>
        <button onClick={() => { setEditing(null); setDrawerOpen(true); }}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium text-sm">
          <Plus className="w-4 h-4" /> New Quotation
        </button>
      </div>

      <div className="table-container">
        <div className="table-scroll">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left">Quote No</th>
                <th className="text-left">Customer</th>
                <th className="text-left">Incoterm</th>
                <th className="text-right">Total</th>
                <th className="text-center">Valid Until</th>
                <th className="text-center">Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const converted = !!r.converted_order_id;
                const busy = busyId === r.id;
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-blue-600">{r.quotation_no}</td>
                    <td className="px-4 py-3 text-gray-900">{r.customer_name || '—'}{r.country ? <span className="text-gray-400 text-xs"> · {r.country}</span> : null}</td>
                    <td className="px-4 py-3 text-gray-600">{r.incoterm || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{r.currency} {num(r.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{r.valid_until ? String(r.valid_until).split('T')[0] : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                      {converted && r.converted_order_no && (
                        <button onClick={() => navigate(`/export/${r.converted_order_no}`)} className="ml-1 inline-flex items-center text-emerald-600 hover:text-emerald-800" title={`Order ${r.converted_order_no}`}>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-3 flex-wrap">
                        <button onClick={() => openPdf(r)} className={`${iconBtn} text-gray-600 hover:text-gray-900`} title="View / Print"><Eye className="w-3.5 h-3.5" /></button>
                        {!converted && ['Draft', 'Sent', 'Rejected', 'Expired'].includes(r.status) && (
                          <button onClick={() => openEdit(r)} className={`${iconBtn} text-blue-600 hover:text-blue-800`} title="Edit"><Edit2 className="w-3.5 h-3.5" /></button>
                        )}
                        {r.status === 'Draft' && (
                          <button disabled={busy} onClick={() => setStatus(r, 'Sent')} className={`${iconBtn} text-blue-600 hover:text-blue-800`} title="Mark Sent"><Send className="w-3.5 h-3.5" /> Send</button>
                        )}
                        {r.status === 'Sent' && (
                          <>
                            <button disabled={busy} onClick={() => setStatus(r, 'Accepted')} className={`${iconBtn} text-emerald-600 hover:text-emerald-800`} title="Accept"><Check className="w-3.5 h-3.5" /> Accept</button>
                            <button disabled={busy} onClick={() => setStatus(r, 'Rejected')} className={`${iconBtn} text-rose-600 hover:text-rose-800`} title="Reject"><X className="w-3.5 h-3.5" /> Reject</button>
                          </>
                        )}
                        {r.status === 'Accepted' && !converted && (
                          <button disabled={busy} onClick={() => convert(r)} className={`${iconBtn} text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-1 rounded`} title="Convert to export order"><ArrowRightCircle className="w-3.5 h-3.5" /> Convert</button>
                        )}
                        {!converted && ['Draft', 'Rejected', 'Expired'].includes(r.status) && (
                          <button disabled={busy} onClick={() => remove(r)} className={`${iconBtn} text-gray-400 hover:text-red-500`} title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  No quotations{statusTab !== 'All' ? ` in ${statusTab}` : ''} yet. Click <b>New Quotation</b> to create one.
                </td></tr>
              )}
              {loading && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading quotations…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <QuotationDrawer open={drawerOpen} onClose={() => { setDrawerOpen(false); setEditing(null); }} quotation={editing} onSaved={() => load()} />

      <Modal isOpen={!!pdfOrder} onClose={() => setPdfOrder(null)} title={pdfOrder ? `Quotation — ${pdfOrder.id}` : ''} size="full">
        {pdfOrder && <div className="overflow-x-auto"><ProformaInvoice order={pdfOrder} companyProfile={companyProfileData} title="Quotation" docNo={pdfOrder.id} charges={pdfOrder.charges} /></div>}
      </Modal>
    </div>
  );
}
