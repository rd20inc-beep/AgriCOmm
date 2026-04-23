import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, Plus, Search, DollarSign, Package, Truck,
  CreditCard, X, Clock, CheckCircle, RefreshCw, Download,
} from 'lucide-react';
import { useLocalSales, useLocalSalesSummary, useCreateLocalSale, useAcceptLocalSalePayment, useLotInventory } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { LoadingSpinner, ErrorState, EmptyState } from '../../../components/LoadingState';
import StatusBadge from '../../../components/StatusBadge';
import Modal from '../../../components/Modal';
import { localSalesApi } from '../../../api/services';
import { toKg, fromKg, rateToPerKg, allEquivalents, allRateEquivalents, UNITS } from '../../../utils/unitConversion';
import { downloadCSV } from '../../../utils/csvExport';

function fmtPKR(v) { return 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString(); }

const INPUT = "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white";
const SELECT = INPUT;
const LABEL = "block text-xs font-semibold text-gray-600 uppercase mb-1";

export default function LocalSales() {
  const { addToast, customersList, refreshFromApi } = useApp();
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [displayUnit, setDisplayUnit] = useState('kg');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedSale, setSelectedSale] = useState(null);
  const [salePayments, setSalePayments] = useState([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'cash', payment_date: new Date().toISOString().split('T')[0], reference: '', notes: '' });
  const [payLoading, setPayLoading] = useState(false);

  const { data: sales = [], isLoading, error, refetch } = useLocalSales();
  const { data: summary = {} } = useLocalSalesSummary();
  const payMutation = useAcceptLocalSalePayment();

  const safeSales = Array.isArray(sales) ? sales : [];

  async function openSaleDetail(sale) {
    setSelectedSale(sale);
    setSalePayments([]);
    try { const payRes = await localSalesApi.getPayments(sale.id); setSalePayments(payRes?.data?.payments || []); } catch {}
  }

  const filtered = useMemo(() => {
    let list = safeSales;
    if (statusFilter) list = list.filter(s => s.paymentStatus === statusFilter || s.payment_status === statusFilter);
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      list = list.filter(s =>
        (s.saleNo || '').toLowerCase().includes(t) ||
        (s.itemName || '').toLowerCase().includes(t) ||
        (s.buyerName || s.customerName || '').toLowerCase().includes(t)
      );
    }
    return list;
  }, [safeSales, searchTerm, statusFilter]);

  const today = summary.today || {};
  const month = summary.month || {};
  const all = summary.all || {};

  if (isLoading) return <LoadingSpinner message="Loading local sales..." />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Local Sales</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sell rice and by-products in the local market (PKR)</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => downloadCSV(filtered, [
            { key: 'saleNo', label: 'Sale #' },
            { key: 'saleDate', label: 'Date', accessor: s => s.saleDate ? new Date(s.saleDate).toLocaleDateString('en-GB') : '' },
            { key: 'buyer', label: 'Buyer', accessor: s => s.customerName || s.buyerName || '' },
            { key: 'itemName', label: 'Item' },
            { key: 'quantityKg', label: 'Qty (KG)' },
            { key: 'ratePerKg', label: 'Rate/KG' },
            { key: 'totalAmount', label: 'Total (PKR)' },
            { key: 'paymentStatus', label: 'Payment' },
          ], `local-sales-${new Date().toISOString().split('T')[0]}.csv`)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => refetch()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setShowSaleModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            <Plus size={16} /> New Sale
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <p className="text-xs font-medium text-green-600 uppercase">Today</p>
          <p className="text-xl font-bold text-green-700 mt-1">{fmtPKR(today.total)}</p>
          <p className="text-xs text-green-500">{today.count || 0} sales · {Math.round(parseFloat(today.qtyKg) || 0).toLocaleString()} KG</p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <p className="text-xs font-medium text-blue-600 uppercase">This Month</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{fmtPKR(month.total)}</p>
          <p className="text-xs text-blue-500">{month.count || 0} sales</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Revenue</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmtPKR(all.total)}</p>
          <p className="text-xs text-gray-400">{all.count || 0} total sales</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-xs font-medium text-red-600 uppercase">Outstanding</p>
          <p className="text-xl font-bold text-red-700 mt-1">{fmtPKR(all.due)}</p>
          <p className="text-xs text-red-500">Credit / unpaid</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search buyer, item, sale#..."
            className="w-full pl-9 pr-4 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {['', 'Paid', 'Partial', 'Unpaid'].map(s => (
          <button key={s || 'all'} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s || 'All'}
          </button>
        ))}
        <div className="ml-auto flex bg-gray-100 rounded-lg p-0.5">
          {UNITS.map(u => (
            <button key={u} onClick={() => setDisplayUnit(u)}
              className={`px-2 py-1 text-xs font-medium rounded-md ${displayUnit === u ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
              {u === 'katta' ? 'Katta' : u === 'maund' ? 'Maund' : u === 'ton' ? 'Ton' : 'KG'}
            </button>
          ))}
        </div>
      </div>

      {/* Sales Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No sales found" description={searchTerm || statusFilter ? "Try adjusting your filters." : "Click 'New Sale' to record your first local sale."} />
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Sale #</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Date</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Buyer</th>
                <th className="text-left py-2.5 px-4 font-semibold text-gray-600">Item</th>
                <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Qty</th>
                <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Rate</th>
                <th className="text-right py-2.5 px-4 font-semibold text-gray-600">Total</th>
                <th className="text-center py-2.5 px-4 font-semibold text-gray-600">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(s => (
                <tr key={s.id} onClick={() => openSaleDetail(s)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="py-2.5 px-4 font-medium text-blue-600">{s.saleNo}</td>
                  <td className="py-2.5 px-4 text-gray-600 text-xs">{s.saleDate ? new Date(s.saleDate).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : '—'}</td>
                  <td className="py-2.5 px-4 text-gray-900">{s.customerName || s.buyerName || '—'}</td>
                  <td className="py-2.5 px-4 text-gray-700">{s.itemName}</td>
                  <td className="py-2.5 px-4 text-right font-medium tabular-nums">
                    {fromKg(parseFloat(s.quantityKg) || 0, displayUnit).toLocaleString()}
                    <span className="text-xs text-gray-400 ml-1">{displayUnit === 'katta' ? 'kt' : displayUnit}</span>
                  </td>
                  <td className="py-2.5 px-4 text-right text-xs tabular-nums">{fmtPKR(s.ratePerKg)}/kg</td>
                  <td className="py-2.5 px-4 text-right font-bold tabular-nums">{fmtPKR(s.totalAmount)}</td>
                  <td className="py-2.5 px-4 text-center"><StatusBadge status={s.paymentStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Sale Modal */}
      <SaleModal isOpen={showSaleModal} onClose={() => setShowSaleModal(false)} customers={customersList} addToast={addToast} refetch={refetch} refreshFromApi={refreshFromApi} />

      {/* Sale Detail Modal */}
      {selectedSale && (
        <Modal isOpen={!!selectedSale} onClose={() => setSelectedSale(null)} title={`Sale — ${selectedSale.saleNo || ''}`} size="lg">
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg border p-3"><p className="text-xs text-gray-500">Total</p><p className="text-lg font-bold text-gray-900">{fmtPKR(selectedSale.totalAmount)}</p></div>
              <div className="bg-green-50 rounded-lg border border-green-200 p-3"><p className="text-xs text-green-600">Paid</p><p className="text-lg font-bold text-green-700">{fmtPKR(selectedSale.paidAmount)}</p></div>
              <div className={`rounded-lg border p-3 ${parseFloat(selectedSale.dueAmount) > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
                <p className={`text-xs ${parseFloat(selectedSale.dueAmount) > 0 ? 'text-red-600' : 'text-gray-500'}`}>Remaining</p>
                <p className={`text-lg font-bold ${parseFloat(selectedSale.dueAmount) > 0 ? 'text-red-700' : 'text-gray-400'}`}>{fmtPKR(selectedSale.dueAmount)}</p>
              </div>
              <div className="bg-white rounded-lg border p-3"><p className="text-xs text-gray-500">Status</p><div className="mt-1"><StatusBadge status={selectedSale.paymentStatus} /></div></div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Buyer:</span> <span className="font-medium">{selectedSale.customerName || selectedSale.buyerName || '—'}</span></div>
              <div><span className="text-gray-500">Item:</span> <span className="font-medium">{selectedSale.itemName}</span></div>
              <div><span className="text-gray-500">Qty:</span> <span className="font-medium">{Math.round(parseFloat(selectedSale.quantityKg) || 0).toLocaleString()} KG</span></div>
              <div><span className="text-gray-500">Rate:</span> <span className="font-medium">{fmtPKR(selectedSale.ratePerKg)}/KG</span></div>
              <div><span className="text-gray-500">Vehicle:</span> <span className="font-medium font-mono">{selectedSale.vehicleNo || '—'}</span></div>
              <div><span className="text-gray-500">Driver:</span> <span className="font-medium">{selectedSale.driverName || '—'}</span></div>
            </div>

            {parseFloat(selectedSale.dueAmount) > 0 && (
              <button onClick={() => { setPayForm(p => ({ ...p, amount: String(parseFloat(selectedSale.dueAmount) || 0) })); setShowPaymentModal(true); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
                <CreditCard size={16} /> Accept Payment ({fmtPKR(selectedSale.dueAmount)})
              </button>
            )}

            <div>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-2">Payment History</h3>
              {salePayments.length === 0 ? (
                <p className="text-xs text-gray-400">No payments recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {salePayments.map((p, i) => (
                    <div key={p.id || i} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 text-sm">
                      <div>
                        <span className="font-medium text-gray-900">{fmtPKR(p.amount)}</span>
                        <span className="text-gray-400 ml-2 capitalize">{p.payment_method || p.paymentMethod}</span>
                      </div>
                      <span className="text-gray-500 text-xs">{p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-GB') : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Payment Modal */}
      <Modal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)} title="Accept Payment" size="sm">
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm">
            <span className="text-blue-600">Remaining:</span> <span className="font-bold text-blue-900">{fmtPKR(selectedSale?.dueAmount)}</span>
          </div>
          <div>
            <label className={LABEL}>Amount (PKR) *</label>
            <input type="number" value={payForm.amount} onChange={e => setPayForm(p => ({...p, amount: e.target.value}))} className={INPUT} placeholder="Rs" min="0" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Method</label>
              <select value={payForm.payment_method} onChange={e => setPayForm(p => ({...p, payment_method: e.target.value}))} className={SELECT}>
                <option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Date</label>
              <input type="date" value={payForm.payment_date} onChange={e => setPayForm(p => ({...p, payment_date: e.target.value}))} className={INPUT} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Reference</label>
            <input value={payForm.reference} onChange={e => setPayForm(p => ({...p, reference: e.target.value}))} className={INPUT} placeholder="Receipt / cheque #" />
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t">
            <button onClick={() => setShowPaymentModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={async () => {
              if (!payForm.amount || parseFloat(payForm.amount) <= 0) { addToast('Enter a valid amount', 'error'); return; }
              setPayLoading(true);
              try {
                await payMutation.mutateAsync({ saleId: selectedSale.id, data: payForm });
                addToast(`Payment of ${fmtPKR(payForm.amount)} accepted`, 'success');
                const updated = await localSalesApi.get(selectedSale.id);
                setSelectedSale(updated?.data?.sale || selectedSale);
                const payRes = await localSalesApi.getPayments(selectedSale.id);
                setSalePayments(payRes?.data?.payments || []);
                setShowPaymentModal(false);
                setPayForm({ amount: '', payment_method: 'cash', payment_date: new Date().toISOString().split('T')[0], reference: '', notes: '' });
              } catch (err) { addToast(err.message || 'Payment failed', 'error'); }
              setPayLoading(false);
            }} disabled={payLoading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
              {payLoading ? 'Processing...' : 'Confirm Payment'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── New Sale Modal (redesigned) ───
function SaleModal({ isOpen, onClose, customers, addToast, refetch, refreshFromApi }) {
  const createMutation = useCreateLocalSale();
  const { data: lots = [] } = useLotInventory({ status: 'Available' });
  const safeLots = Array.isArray(lots) ? lots : [];

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    customer_id: '', buyer_name: '', buyer_phone: '',
    lot_id: '', item_name: '', item_type: '',
    quantity_input: '', quantity_unit: 'katta', bag_weight_kg: '50',
    rate_input: '', rate_unit: 'katta',
    payment_mode: 'cash', paid_amount: '',
    vehicle_no: '', driver_name: '', notes: '',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const bagWt = parseFloat(form.bag_weight_kg) || 50;
  const qtyKg = toKg(form.quantity_input, form.quantity_unit, bagWt);
  const ratePerKg = rateToPerKg(form.rate_input, form.rate_unit, bagWt);
  const totalAmount = Math.round(qtyKg * ratePerKg);
  const qtyEq = allEquivalents(qtyKg, bagWt);
  const rateEq = allRateEquivalents(ratePerKg, bagWt);

  function handleLotSelect(lotId) {
    set('lot_id', lotId);
    const lot = safeLots.find(l => String(l.id) === String(lotId));
    if (lot) {
      set('item_name', lot.itemName || '');
      set('item_type', lot.type || '');
    }
  }

  async function handleSubmit() {
    if (!form.item_name || !form.quantity_input || !form.rate_input) {
      addToast('Item, quantity, and rate are required', 'error'); return;
    }
    if (!form.customer_id && !form.buyer_name) {
      addToast('Select a customer or enter buyer name', 'error'); return;
    }
    try {
      const payload = { ...form, paid_amount: parseFloat(form.paid_amount) || totalAmount };
      const res = await createMutation.mutateAsync(payload);
      addToast(`Sale ${res?.data?.sale?.sale_no || ''} created — ${fmtPKR(totalAmount)}`, 'success');
      refreshFromApi('local-sales');
      onClose();
      setStep(1);
      setForm({ customer_id: '', buyer_name: '', buyer_phone: '', lot_id: '', item_name: '', item_type: '', quantity_input: '', quantity_unit: 'katta', bag_weight_kg: '50', rate_input: '', rate_unit: 'katta', payment_mode: 'cash', paid_amount: '', vehicle_no: '', driver_name: '', notes: '' });
    } catch (err) {
      addToast(err.message || 'Sale failed', 'error');
    }
  }

  const canProceedStep1 = (form.customer_id || form.buyer_name) && form.item_name;
  const canProceedStep2 = form.quantity_input && form.rate_input;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Local Sale" size="lg">
      <div className="space-y-5">
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {['Buyer & Item', 'Qty & Rate', 'Payment'].map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              {i > 0 && <div className={`w-8 h-0.5 ${step > i ? 'bg-blue-500' : 'bg-gray-200'}`} />}
              <button
                onClick={() => setStep(i + 1)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full ${step === i + 1 ? 'bg-blue-600 text-white' : step > i + 1 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}
              >
                <span className="w-4 h-4 rounded-full bg-white/20 text-[10px] flex items-center justify-center font-bold">{i + 1}</span>
                {label}
              </button>
            </div>
          ))}
        </div>

        {/* Step 1: Buyer & Item */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Customer (registered)</label>
                <select value={form.customer_id} onChange={e => set('customer_id', e.target.value)} className={SELECT}>
                  <option value="">Walk-in / not registered</option>
                  {(customers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Buyer Name {!form.customer_id && '*'}</label>
                <input value={form.buyer_name} onChange={e => set('buyer_name', e.target.value)} className={INPUT} placeholder="Walk-in buyer name" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Select from Inventory</label>
                <select value={form.lot_id} onChange={e => handleLotSelect(e.target.value)} className={SELECT}>
                  <option value="">No lot (manual entry)</option>
                  {safeLots.map(l => {
                    const avail = (parseFloat(l.availableQty) || 0) * 1000;
                    return <option key={l.id} value={l.id}>{l.lotNo} — {l.itemName} ({Math.round(avail).toLocaleString()} KG)</option>;
                  })}
                </select>
              </div>
              <div>
                <label className={LABEL}>Item Name *</label>
                <input value={form.item_name} onChange={e => set('item_name', e.target.value)} className={INPUT} placeholder="e.g. Broken Rice, 1121 Sella" />
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setStep(2)} disabled={!canProceedStep1}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                Next: Quantity & Rate
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Quantity & Rate */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={LABEL}>Quantity *</label>
                <div className="flex gap-1">
                  <input type="number" value={form.quantity_input} onChange={e => set('quantity_input', e.target.value)} className={`${INPUT} flex-1`} placeholder="Enter qty" />
                  <select value={form.quantity_unit} onChange={e => set('quantity_unit', e.target.value)} className={`${SELECT} w-24`}>
                    <option value="katta">Katta</option><option value="maund">Maund</option><option value="kg">KG</option><option value="ton">Ton</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL}>Rate *</label>
                <div className="flex gap-1">
                  <input type="number" value={form.rate_input} onChange={e => set('rate_input', e.target.value)} className={`${INPUT} flex-1`} placeholder="Rate" />
                  <select value={form.rate_unit} onChange={e => set('rate_unit', e.target.value)} className={`${SELECT} w-24`}>
                    <option value="katta">/ Katta</option><option value="maund">/ Maund</option><option value="kg">/ KG</option><option value="ton">/ Ton</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL}>Katta Weight (KG)</label>
                <input type="number" value={form.bag_weight_kg} onChange={e => set('bag_weight_kg', e.target.value)} className={INPUT} />
              </div>
            </div>

            {/* Live preview */}
            {(form.quantity_input > 0 || form.rate_input > 0) && (
              <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-[10px] text-blue-600 uppercase font-semibold">KG</p><p className="font-bold text-gray-900">{qtyEq.kg.toLocaleString()}</p></div>
                  <div><p className="text-[10px] text-blue-600 uppercase font-semibold">Katta</p><p className="font-bold text-gray-900">{qtyEq.katta.toLocaleString()}</p></div>
                  <div><p className="text-[10px] text-blue-600 uppercase font-semibold">Maund</p><p className="font-bold text-gray-900">{qtyEq.maund.toLocaleString()}</p></div>
                  <div><p className="text-[10px] text-blue-600 uppercase font-semibold">Rate/KG</p><p className="font-bold text-gray-900">Rs {rateEq.perKg}</p></div>
                </div>
                <div className="mt-3 pt-3 border-t border-blue-200 flex items-center justify-between">
                  <span className="text-sm font-semibold text-blue-800">Total Amount</span>
                  <span className="text-xl font-bold text-green-700">Rs {totalAmount.toLocaleString()}</span>
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
              <button onClick={() => setStep(3)} disabled={!canProceedStep2}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                Next: Payment
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Payment & Dispatch */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-green-50 rounded-lg border border-green-200 p-3 flex items-center justify-between">
              <span className="text-sm text-green-800">{form.item_name} · {qtyEq.kg.toLocaleString()} KG</span>
              <span className="text-lg font-bold text-green-700">Rs {totalAmount.toLocaleString()}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Payment Mode</label>
                <select value={form.payment_mode} onChange={e => set('payment_mode', e.target.value)} className={SELECT}>
                  <option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank Transfer</option><option value="credit">Credit (Udhaar)</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Amount Received</label>
                <input type="number" value={form.paid_amount} onChange={e => set('paid_amount', e.target.value)} className={INPUT}
                  placeholder={totalAmount > 0 ? `Rs ${totalAmount.toLocaleString()} (full)` : 'Rs'} />
                {form.payment_mode === 'credit' && <p className="text-xs text-amber-600 mt-1">Leave empty or enter partial for credit sale</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Vehicle No</label>
                <input value={form.vehicle_no} onChange={e => set('vehicle_no', e.target.value)} className={INPUT} placeholder="e.g. LHR-1234" />
              </div>
              <div>
                <label className={LABEL}>Driver</label>
                <input value={form.driver_name} onChange={e => set('driver_name', e.target.value)} className={INPUT} placeholder="Driver name" />
              </div>
            </div>
            <div>
              <label className={LABEL}>Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} className={INPUT + ' resize-none'} rows={2} placeholder="Sale notes..." />
            </div>

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(2)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
              <button onClick={handleSubmit} disabled={createMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
                {createMutation.isPending ? 'Creating...' : `Create Sale — Rs ${totalAmount.toLocaleString()}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
