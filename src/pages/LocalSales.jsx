import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, Plus, Search, Eye, DollarSign, Package, Truck, RefreshCw,
  CreditCard, X, Clock, CheckCircle,
} from 'lucide-react';
import { useLocalSales, useLocalSalesSummary, useCreateLocalSale, useAcceptLocalSalePayment, useLotInventory } from '../api/queries';
import { useApp } from '../context/AppContext';
import { LoadingSpinner, ErrorState, EmptyState } from '../components/LoadingState';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import { localSalesApi } from '../api/services';
import { toKg, fromKg, rateToPerKg, allEquivalents, allRateEquivalents, UNITS } from '../utils/unitConversion';

function fmtPKR(v) { return 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString(); }

export default function LocalSales() {
  const { addToast, customersList, refreshFromApi } = useApp();
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [displayUnit, setDisplayUnit] = useState('kg');
  const [selectedSale, setSelectedSale] = useState(null);
  const [salePayments, setSalePayments] = useState([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'cash', payment_date: new Date().toISOString().split('T')[0], reference: '', notes: '' });
  const [payLoading, setPayLoading] = useState(false);

  const { data: sales = [], isLoading, error, refetch } = useLocalSales();
  const { data: summary = {} } = useLocalSalesSummary();
  const payMutation = useAcceptLocalSalePayment();

  async function openSaleDetail(sale) {
    setSelectedSale(sale);
    setSalePayments([]);
    try {
      const payRes = await localSalesApi.getPayments(sale.id);
      setSalePayments(payRes?.data?.payments || []);
    } catch {}
  }

  const filtered = useMemo(() => {
    if (!searchTerm) return sales;
    const t = searchTerm.toLowerCase();
    return sales.filter(s =>
      (s.saleNo || '').toLowerCase().includes(t) ||
      (s.itemName || '').toLowerCase().includes(t) ||
      (s.buyerName || '').toLowerCase().includes(t) ||
      (s.customerName || '').toLowerCase().includes(t)
    );
  }, [sales, searchTerm]);

  const today = summary.today || {};
  const month = summary.month || {};
  const all = summary.all || {};

  if (isLoading) return <LoadingSpinner message="Loading local sales..." />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-emerald-600" /> Local Sales
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Sell inventory in the local market (PKR)</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSaleModal(true)} className="btn btn-primary"><Plus className="w-4 h-4" /> New Sale</button>
          <button onClick={() => { refetch(); }} className="btn btn-secondary"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4">
          <p className="text-xs font-medium text-emerald-600 uppercase">Today</p>
          <p className="text-xl font-bold text-emerald-700 mt-1">{fmtPKR(today.total)}</p>
          <p className="text-xs text-emerald-500">{today.count || 0} sale(s) | {Math.round(parseFloat(today.qtyKg) || 0).toLocaleString()} KG</p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
          <p className="text-xs font-medium text-blue-600 uppercase">This Month</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{fmtPKR(month.total)}</p>
          <p className="text-xs text-blue-500">{month.count || 0} sale(s) | {Math.round(parseFloat(month.qtyKg) || 0).toLocaleString()} KG</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Sales</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmtPKR(all.total)}</p>
          <p className="text-xs text-gray-400">{all.count || 0} sales</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-100 p-4">
          <p className="text-xs font-medium text-red-600 uppercase">Outstanding</p>
          <p className="text-xl font-bold text-red-700 mt-1">{fmtPKR(all.due)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search sales..." className="form-input pl-9 py-1.5 text-sm" />
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5 ml-auto">
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
        <EmptyState icon={ShoppingCart} title="No local sales yet" description="Click 'New Sale' to sell inventory in the local market." />
      ) : (
        <div className="table-container">
          <div className="table-scroll">
            <table className="w-full">
              <thead><tr>
                <th className="text-left">Sale No</th>
                <th className="text-left">Date</th>
                <th className="text-left">Buyer</th>
                <th className="text-left">Item</th>
                <th className="text-left">Lot</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Sale Rate</th>
                <th className="text-right">Cost/KG</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Profit</th>
                <th className="text-right">Margin</th>
                <th className="text-center">Payment</th>
              </tr></thead>
              <tbody>
                {filtered.map(s => {
                  const profit = parseFloat(s.grossProfit) || 0;
                  const margin = parseFloat(s.marginPct) || 0;
                  const costKg = parseFloat(s.costPerKg) || parseFloat(s.lotCostPerKg) || 0;
                  return (
                  <tr key={s.id} onClick={() => openSaleDetail(s)} className="cursor-pointer">
                    <td className="font-medium text-blue-600">{s.saleNo}</td>
                    <td className="text-gray-600 text-xs">{s.saleDate ? new Date(s.saleDate).toLocaleDateString('en-GB', {day:'2-digit',month:'short'}) : '—'}</td>
                    <td className="text-gray-900">{s.customerName || s.buyerName || '—'}</td>
                    <td className="text-gray-700">{s.itemName}</td>
                    <td className="text-xs">{s.lotNo ? <Link to={`/lot-inventory/${s.lotNo}`} className="text-blue-600 hover:text-blue-800">{s.lotNo}</Link> : '—'}</td>
                    <td className="text-right tabular-nums font-medium">{fromKg(parseFloat(s.quantityKg) || 0, displayUnit).toLocaleString()} <span className="text-xs text-gray-400">{displayUnit === 'katta' ? 'kt' : displayUnit}</span></td>
                    <td className="text-right tabular-nums text-xs">{fmtPKR(s.ratePerKg)}/kg</td>
                    <td className="text-right tabular-nums text-xs">{costKg > 0 ? `${fmtPKR(costKg)}/kg` : '—'}</td>
                    <td className="text-right tabular-nums font-medium">{fmtPKR(s.totalAmount)}</td>
                    <td className={`text-right tabular-nums font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{costKg > 0 ? fmtPKR(profit) : '—'}</td>
                    <td className={`text-right tabular-nums font-semibold text-xs ${margin >= 10 ? 'text-emerald-600' : margin >= 0 ? 'text-amber-600' : 'text-red-600'}`}>{costKg > 0 ? `${margin}%` : '—'}</td>
                    <td className="text-center"><StatusBadge status={s.paymentStatus} /></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SaleModal isOpen={showSaleModal} onClose={() => setShowSaleModal(false)} customers={customersList} addToast={addToast} refetch={refetch} refreshFromApi={refreshFromApi} />

      {/* Sale Detail Drawer */}
      {selectedSale && (
        <Modal isOpen={!!selectedSale} onClose={() => setSelectedSale(null)} title={`Sale Detail — ${selectedSale.saleNo || selectedSale.sale_no}`} size="lg">
          <div className="space-y-5">
            {/* Sale Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg border p-3"><p className="text-xs text-gray-500">Total Amount</p><p className="text-lg font-bold text-gray-900">{fmtPKR(selectedSale.totalAmount || selectedSale.total_amount)}</p></div>
              <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3"><p className="text-xs text-emerald-600">Paid</p><p className="text-lg font-bold text-emerald-700">{fmtPKR(selectedSale.paidAmount || selectedSale.paid_amount)}</p></div>
              <div className={`rounded-lg border p-3 ${parseFloat(selectedSale.dueAmount || selectedSale.due_amount) > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}><p className={`text-xs ${parseFloat(selectedSale.dueAmount || selectedSale.due_amount) > 0 ? 'text-red-600' : 'text-gray-500'}`}>Remaining</p><p className={`text-lg font-bold ${parseFloat(selectedSale.dueAmount || selectedSale.due_amount) > 0 ? 'text-red-700' : 'text-gray-400'}`}>{fmtPKR(selectedSale.dueAmount || selectedSale.due_amount)}</p></div>
              <div className="bg-white rounded-lg border p-3"><p className="text-xs text-gray-500">Status</p><div className="mt-1"><StatusBadge status={selectedSale.paymentStatus || selectedSale.payment_status} /></div></div>
            </div>

            {/* Sale Info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Buyer:</span> <span className="font-medium">{selectedSale.customerName || selectedSale.customer_name || selectedSale.buyerName || selectedSale.buyer_name || '—'}</span></div>
              <div><span className="text-gray-500">Item:</span> <span className="font-medium">{selectedSale.itemName || selectedSale.item_name}</span></div>
              <div><span className="text-gray-500">Qty:</span> <span className="font-medium">{Math.round(parseFloat(selectedSale.quantityKg || selectedSale.quantity_kg) || 0).toLocaleString()} KG</span></div>
              <div><span className="text-gray-500">Rate:</span> <span className="font-medium">{fmtPKR(selectedSale.ratePerKg || selectedSale.rate_per_kg)}/KG</span></div>
              <div><span className="text-gray-500">Lot:</span> <span className="font-medium">{selectedSale.lotNo || selectedSale.lot_no || '—'}</span></div>
              <div><span className="text-gray-500">Vehicle:</span> <span className="font-medium font-mono">{selectedSale.vehicleNo || selectedSale.vehicle_no || '—'}</span></div>
            </div>

            {/* Profit */}
            {(parseFloat(selectedSale.grossProfit || selectedSale.gross_profit) || 0) !== 0 && (
              <div className={`rounded-lg p-3 ${parseFloat(selectedSale.grossProfit || selectedSale.gross_profit) >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Profit</span>
                  <span className={`text-lg font-bold ${parseFloat(selectedSale.grossProfit || selectedSale.gross_profit) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtPKR(selectedSale.grossProfit || selectedSale.gross_profit)} ({selectedSale.marginPct || selectedSale.margin_pct || 0}%)</span>
                </div>
              </div>
            )}

            {/* Accept Payment Button */}
            {parseFloat(selectedSale.dueAmount || selectedSale.due_amount) > 0 && (
              <button onClick={() => { setPayForm(p => ({ ...p, amount: String(parseFloat(selectedSale.dueAmount || selectedSale.due_amount) || 0) })); setShowPaymentModal(true); }}
                className="btn btn-primary w-full">
                <CreditCard className="w-4 h-4" /> Accept Payment
              </button>
            )}

            {/* Payment History */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-2">Payment History</h3>
              {salePayments.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No payment records yet.</p>
              ) : (
                <div className="space-y-2">
                  {salePayments.map((p, i) => (
                    <div key={p.id || i} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 text-sm">
                      <div>
                        <span className="font-medium text-gray-900">{fmtPKR(p.amount)}</span>
                        <span className="text-gray-400 ml-2">{p.payment_method || p.paymentMethod}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-gray-500 text-xs">{p.payment_date ? new Date(p.payment_date || p.paymentDate).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) : ''}</span>
                        {(p.bank_reference || p.bankReference) && <span className="text-gray-400 text-xs ml-2">Ref: {p.bank_reference || p.bankReference}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Accept Payment Modal */}
      <Modal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)} title="Accept Payment" size="sm">
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm">
            <span className="text-blue-600">Remaining:</span> <span className="font-bold text-blue-900">{fmtPKR(selectedSale?.dueAmount || selectedSale?.due_amount)}</span>
          </div>
          <div className="form-group"><label className="form-label">Amount *</label>
            <input type="number" value={payForm.amount} onChange={e => setPayForm(p => ({...p, amount: e.target.value}))} className="form-input" placeholder="Rs" min="0" /></div>
          <div className="form-group"><label className="form-label">Payment Method</label>
            <select value={payForm.payment_method} onChange={e => setPayForm(p => ({...p, payment_method: e.target.value}))} className="form-input">
              <option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank Transfer</option>
            </select></div>
          <div className="form-group"><label className="form-label">Date</label>
            <input type="date" value={payForm.payment_date} onChange={e => setPayForm(p => ({...p, payment_date: e.target.value}))} className="form-input" /></div>
          <div className="form-group"><label className="form-label">Reference</label>
            <input value={payForm.reference} onChange={e => setPayForm(p => ({...p, reference: e.target.value}))} className="form-input" placeholder="Cheque no / receipt no" /></div>
          <div className="flex justify-end gap-3 pt-3 border-t">
            <button onClick={() => setShowPaymentModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={async () => {
              if (!payForm.amount || parseFloat(payForm.amount) <= 0) { addToast('Enter a valid amount', 'error'); return; }
              setPayLoading(true);
              try {
                await payMutation.mutateAsync({ saleId: selectedSale.id, data: payForm });
                addToast(`Payment of ${fmtPKR(payForm.amount)} accepted`, 'success');
                // Refresh sale data directly from API
                const updated = await localSalesApi.get(selectedSale.id);
                setSelectedSale(updated?.data?.sale || selectedSale);
                const payRes = await localSalesApi.getPayments(selectedSale.id);
                setSalePayments(payRes?.data?.payments || []);
                // Mutation onSuccess already invalidates local-sales + receivables + finance
                setShowPaymentModal(false);
                setPayForm({ amount: '', payment_method: 'cash', payment_date: new Date().toISOString().split('T')[0], reference: '', notes: '' });
              } catch (err) { addToast(err.message || 'Payment failed', 'error'); }
              setPayLoading(false);
            }} disabled={payLoading} className="btn btn-primary">
              {payLoading ? 'Processing...' : 'Confirm Payment'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── New Sale Modal ───
function SaleModal({ isOpen, onClose, customers, addToast, refetch, refreshFromApi }) {
  const createMutation = useCreateLocalSale();
  const { data: lots = [] } = useLotInventory({ status: 'Available' });

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

  // Auto-fill from selected lot
  function handleLotSelect(lotId) {
    set('lot_id', lotId);
    const lot = lots.find(l => String(l.id) === String(lotId));
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
      setForm({ customer_id: '', buyer_name: '', buyer_phone: '', lot_id: '', item_name: '', item_type: '', quantity_input: '', quantity_unit: 'katta', bag_weight_kg: '50', rate_input: '', rate_unit: 'katta', payment_mode: 'cash', paid_amount: '', vehicle_no: '', driver_name: '', notes: '' });
    } catch (err) {
      addToast(err.message || 'Sale failed', 'error');
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Local Sale" size="xl">
      <div className="space-y-5">
        {/* Buyer */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Buyer</h3>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Customer (registered)</label>
              <select value={form.customer_id} onChange={e => set('customer_id', e.target.value)} className="form-input">
                <option value="">Walk-in / not registered</option>
                {(customers || []).slice(0, 200).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Buyer Name {!form.customer_id && '*'}</label>
              <input value={form.buyer_name} onChange={e => set('buyer_name', e.target.value)} className="form-input" placeholder="Walk-in buyer name" />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input value={form.buyer_phone} onChange={e => set('buyer_phone', e.target.value)} className="form-input" placeholder="Phone number" />
            </div>
          </div>
        </div>

        {/* Item from Lot */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Item / Lot</h3>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Select Lot</label>
              <select value={form.lot_id} onChange={e => handleLotSelect(e.target.value)} className="form-input">
                <option value="">No lot (manual entry)</option>
                {lots.map(l => {
                  const avail = (parseFloat(l.availableQty) || 0) * 1000;
                  return <option key={l.id} value={l.id}>{l.lotNo} — {l.itemName} ({Math.round(avail).toLocaleString()} KG avail)</option>;
                })}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Item Name *</label>
              <input value={form.item_name} onChange={e => set('item_name', e.target.value)} className="form-input" placeholder="e.g. Broken Rice, 1121 Sella" />
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select value={form.item_type} onChange={e => set('item_type', e.target.value)} className="form-input">
                <option value="">Select...</option>
                <option value="finished">Finished Rice</option>
                <option value="byproduct">By-product</option>
                <option value="raw">Raw / Paddy</option>
              </select>
            </div>
          </div>
        </div>

        {/* Quantity & Rate */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Quantity & Rate</h3>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Quantity *</label>
              <div className="flex gap-2">
                <input type="number" value={form.quantity_input} onChange={e => set('quantity_input', e.target.value)} className="form-input flex-1" placeholder="Enter quantity" />
                <select value={form.quantity_unit} onChange={e => set('quantity_unit', e.target.value)} className="form-input w-24">
                  <option value="katta">Katta</option><option value="maund">Maund</option><option value="kg">KG</option><option value="ton">Ton</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Sale Rate *</label>
              <div className="flex gap-2">
                <input type="number" value={form.rate_input} onChange={e => set('rate_input', e.target.value)} className="form-input flex-1" placeholder="Rate" />
                <select value={form.rate_unit} onChange={e => set('rate_unit', e.target.value)} className="form-input w-24">
                  <option value="katta">/ Katta</option><option value="maund">/ Maund</option><option value="kg">/ KG</option><option value="ton">/ Ton</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Katta Weight (KG)</label>
              <input type="number" value={form.bag_weight_kg} onChange={e => set('bag_weight_kg', e.target.value)} className="form-input" />
            </div>
          </div>

          {/* Live preview */}
          {(form.quantity_input > 0 || form.rate_input > 0) && (
            <div className="mt-3 bg-blue-50 rounded-xl border border-blue-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-blue-600">KG</p><p className="font-bold">{qtyEq.kg.toLocaleString()}</p></div>
              <div><p className="text-xs text-blue-600">Katta</p><p className="font-bold">{qtyEq.katta.toLocaleString()}</p></div>
              <div><p className="text-xs text-blue-600">Maund</p><p className="font-bold">{qtyEq.maund.toLocaleString()}</p></div>
              <div><p className="text-xs text-blue-600">Rate/KG</p><p className="font-bold">Rs {rateEq.perKg}</p></div>
              <div><p className="text-xs text-blue-600">Rate/Katta</p><p className="font-bold">Rs {rateEq.perKatta.toLocaleString()}</p></div>
              <div><p className="text-xs text-blue-600">Rate/Maund</p><p className="font-bold">Rs {rateEq.perMaund.toLocaleString()}</p></div>
              <div className="sm:col-span-2"><p className="text-xs text-blue-600">Total Amount</p><p className="text-lg font-bold text-emerald-700">Rs {totalAmount.toLocaleString()}</p></div>
            </div>
          )}
        </div>

        {/* Payment & Dispatch */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Payment & Dispatch</h3>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Payment Mode</label>
              <select value={form.payment_mode} onChange={e => set('payment_mode', e.target.value)} className="form-input">
                <option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank Transfer</option><option value="credit">Credit (Udhaar)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Amount Received</label>
              <input type="number" value={form.paid_amount} onChange={e => set('paid_amount', e.target.value)} className="form-input" placeholder={totalAmount > 0 ? `Rs ${totalAmount.toLocaleString()} (full)` : 'Rs'} />
            </div>
            <div className="form-group">
              <label className="form-label">Vehicle No</label>
              <input value={form.vehicle_no} onChange={e => set('vehicle_no', e.target.value)} className="form-input" placeholder="e.g. LHR-1234" />
            </div>
            <div className="form-group">
              <label className="form-label">Driver</label>
              <input value={form.driver_name} onChange={e => set('driver_name', e.target.value)} className="form-input" placeholder="Driver name" />
            </div>
            <div className="form-group sm:col-span-2 lg:col-span-3">
              <label className="form-label">Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="form-input resize-none" rows={2} placeholder="Sale notes..." />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-3 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmit} disabled={createMutation.isPending} className="btn btn-primary">
            {createMutation.isPending ? 'Creating...' : 'Create Sale'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
