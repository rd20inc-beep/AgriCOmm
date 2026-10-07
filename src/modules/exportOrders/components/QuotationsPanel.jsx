import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Eye, Edit2, Send, Check, X, ArrowRightCircle, Trash2, FileText, ExternalLink } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import Modal from '../../../components/Modal';
import ProformaInvoice from '../../../components/ProformaInvoice';
import QuotationDrawer from './QuotationDrawer';
import { quotationsApi } from '../api/services';
import { quotationToOrder } from '../utils/quotationToOrder';
import useConfirm from '../../../hooks/useConfirm';
import { fmtNum, fmtDate } from '../../../shared/utils/format';
import StatusBadge from '../../../shared/components/StatusBadge';

const num = (v) => parseFloat(v) || 0;
const STATUS_TABS = ['All', 'Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'];

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
  const [confirm, confirmDialog] = useConfirm();

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
    if (!await confirm({
      title: `Convert ${row.quotation_no} into an export order?`,
      consequence: 'A real export order is created from this quote, with its receivables and document checklist. The quote itself stays on record.',
      amount: `${row.currency || ''} ${fmtNum(num(row.total_amount), 2)}`.trim(),
      danger: false,
      confirmLabel: 'Create the order',
    })) return;
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
    if (!await confirm({
      title: `Delete quotation ${row.quotation_no}?`,
      consequence: 'The quote and its lines go. This cannot be undone.',
      amount: `${row.currency || ''} ${fmtNum(num(row.total_amount), 2)}`.trim(),
      confirmLabel: 'Delete quotation',
    })) return;
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

      <div className="table-container mobile-cards">
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
                    <td data-label="Quote No" className="px-4 py-3 font-medium text-blue-600">{r.quotation_no}</td>
                    <td data-label="Customer" className="px-4 py-3 text-gray-900"><div className="max-w-[260px] truncate" title={r.customer_name || undefined}>{r.customer_name || '—'}{r.country ? <span className="text-gray-400 text-xs"> · {r.country}</span> : null}</div></td>
                    <td data-label="Incoterm" className="mob-hide px-4 py-3 text-gray-600">{r.incoterm || '—'}</td>
                    <td data-label="Total" className="px-4 py-3 text-right font-medium text-gray-900">{r.currency} {fmtNum(num(r.total_amount), 2)}</td>
                    <td data-label="Valid Until" className="mob-hide px-4 py-3 text-center text-gray-600">{fmtDate(r.valid_until)}</td>
                    <td data-label="Status" className="px-4 py-3 text-center">
                      <StatusBadge status={r.status} />
                      {converted && r.converted_order_no && (
                        <button onClick={() => navigate(`/export/${r.converted_order_no}`)} className="ml-1 inline-flex items-center text-emerald-600 hover:text-emerald-800" title={`Order ${r.converted_order_no}`} aria-label={`Open order ${r.converted_order_no}`}>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                    <td data-label="Actions" className="px-4 py-3">
                      <div className="flex items-center justify-center gap-3 flex-wrap">
                        <button onClick={() => openPdf(r)} className={`${iconBtn} text-gray-600 hover:text-gray-900`} title="View / Print" aria-label={`View or print ${r.quotation_no}`}><Eye className="w-3.5 h-3.5" /></button>
                        {!converted && ['Draft', 'Sent', 'Rejected', 'Expired'].includes(r.status) && (
                          <button onClick={() => openEdit(r)} className={`${iconBtn} text-blue-600 hover:text-blue-800`} title="Edit" aria-label={`Edit ${r.quotation_no}`}><Edit2 className="w-3.5 h-3.5" /></button>
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
                          <button disabled={busy} onClick={() => remove(r)} className={`${iconBtn} text-gray-400 hover:text-red-500`} title="Delete" aria-label={`Delete ${r.quotation_no}`}><Trash2 className="w-3.5 h-3.5" /></button>
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
      {confirmDialog}
    </div>
  );
}
