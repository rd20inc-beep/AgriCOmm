import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import PartyLink from '../../../shared/components/PartyLink';
import {
  ShoppingCart, Plus, Search, DollarSign, Package, Truck,
  CreditCard, X, Clock, CheckCircle, RefreshCw, Download,
  Check, ChevronLeft, ChevronRight, UserPlus,
} from 'lucide-react';
import { useLocalSales, useLocalSalesSummary, useCreateLocalSale, useAcceptLocalSalePayment, useLotInventory } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { LoadingSpinner, ErrorState, EmptyState } from '../../../components/LoadingState';
import StatusBadge from '../../../components/StatusBadge';
import Modal from '../../../components/Modal';
import SlideDrawer from '../../../components/SlideDrawer';
import { adminApi } from '../../admin/api/services';
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
                  <td className="py-2.5 px-4 text-gray-900"><PartyLink type="customer" id={s.customerId} name={s.customerName || s.buyerName} /></td>
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
              <div><span className="text-gray-500">Buyer:</span> <span className="font-medium"><PartyLink type="customer" id={selectedSale.customerId} name={selectedSale.customerName || selectedSale.buyerName} /></span></div>
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

// ─── New Sale Modal (single form) ───
// Map a lot to a sellable category tag from its type / grade / name. Blend
// grades are stored prefixed (e.g. "M-002-B1"), so match with word boundaries.
function lotCategory(lot) {
  const type = lot.type;
  const name = (lot.itemName || '').toLowerCase();
  const s = `${lot.lotNo || ''} ${lot.itemName || ''} ${lot.grade || ''}`.toLowerCase();
  if (type === 'finished') return 'Finished Rice';
  if (type === 'raw') return 'Raw Rice';
  if (type === 'packaging') return 'Packaging';
  if (type === 'byproduct') {
    if (name.includes('bran')) return 'Bran';
    if (name.includes('husk')) return 'Husk';
    if (name.includes('sortex')) return 'Sortex';
    if (name.includes('powder')) return 'Powder';
    if (name.includes('sweeping')) return 'Sweeping';
    if (/\bb1\b/.test(s)) return 'B1';
    if (/\bb2\b/.test(s)) return 'B2';
    if (/\bb3\b/.test(s)) return 'B3';
    if (/\bcsr\b/.test(s)) return 'CSR';
    if (/short[\s-]?grain/.test(s)) return 'Short Grain';
    return 'Broken';
  }
  return 'Other';
}
const CAT_ORDER = ['Finished Rice', 'B1', 'B2', 'B3', 'CSR', 'Short Grain', 'Broken', 'Powder', 'Sweeping', 'Bran', 'Husk', 'Sortex', 'Raw Rice', 'Packaging', 'Other'];
const CAT_COLOR = {
  'Finished Rice': 'bg-emerald-100 text-emerald-700', B1: 'bg-amber-100 text-amber-700', B2: 'bg-orange-100 text-orange-700',
  B3: 'bg-yellow-100 text-yellow-700', CSR: 'bg-lime-100 text-lime-700', 'Short Grain': 'bg-amber-100 text-amber-700',
  Broken: 'bg-amber-100 text-amber-700', Powder: 'bg-violet-100 text-violet-700', Sweeping: 'bg-pink-100 text-pink-700',
  Bran: 'bg-stone-100 text-stone-600', Husk: 'bg-stone-100 text-stone-600', Sortex: 'bg-red-100 text-red-700',
  'Raw Rice': 'bg-blue-100 text-blue-700', Packaging: 'bg-gray-100 text-gray-600', Other: 'bg-gray-100 text-gray-600',
};

function SaleModal({ isOpen, onClose, customers, addToast, refetch, refreshFromApi }) {
  const createMutation = useCreateLocalSale();
  const { data: lots = [] } = useLotInventory({ status: 'Available' });
  const safeLots = useMemo(() => (Array.isArray(lots) ? lots : []).filter(l => (parseFloat(l.availableQty) || 0) > 0), [lots]);

  const [form, setForm] = useState({
    customer_id: '', buyer_name: '', buyer_phone: '',
    payment_mode: 'cash', paid_amount: '',
    vehicle_no: '', driver_name: '', notes: '',
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const [step, setStep] = useState(1); // 1=Buyer & Items, 2=Payment
  const [registerCustomer, setRegisterCustomer] = useState(true);
  const isWalkIn = !form.customer_id;

  // Cart of line items + the line currently being built.
  const EMPTY_LINE = { lot_id: '', item_name: '', item_type: '', quantity_input: '', quantity_unit: 'katta', bag_weight_kg: '50', rate_input: '', rate_unit: 'katta' };
  const [cart, setCart] = useState([]);
  const [line, setLine] = useState(EMPTY_LINE);
  const setL = (k, v) => setLine(p => ({ ...p, [k]: v }));
  const [tag, setTag] = useState('All');

  // Tags are the categories actually present in sellable inventory.
  const tags = useMemo(() => {
    const present = new Set(safeLots.map(lotCategory));
    return ['All', ...CAT_ORDER.filter(c => present.has(c))];
  }, [safeLots]);
  const filteredLots = useMemo(() => (tag === 'All' ? safeLots : safeLots.filter(l => lotCategory(l) === tag)), [safeLots, tag]);

  const lineBagWt = parseFloat(line.bag_weight_kg) || 50;
  const lineQtyKg = toKg(line.quantity_input, line.quantity_unit, lineBagWt);
  const lineRatePerKg = rateToPerKg(line.rate_input, line.rate_unit, lineBagWt);
  const lineTotal = Math.round(lineQtyKg * lineRatePerKg);
  const selectedLot = safeLots.find(l => String(l.id) === String(line.lot_id));
  const cartQtyForLot = (lotId) => cart.filter(c => lotId && String(c.lot_id) === String(lotId)).reduce((s, c) => s + c.qtyKg, 0);
  const lineAvailKg = selectedLot ? (parseFloat(selectedLot.availableQty) || 0) * 1000 - cartQtyForLot(selectedLot.id) : null;
  const lineOverSell = lineAvailKg != null && lineQtyKg > lineAvailKg + 0.01;

  function pickLot(lotId) {
    const lot = safeLots.find(l => String(l.id) === String(lotId));
    setLine(p => ({ ...p, lot_id: lotId, item_name: lot ? (lot.itemName || '') : p.item_name, item_type: lot ? (lot.type || '') : p.item_type }));
  }

  function addLine() {
    if (!line.item_name || !(parseFloat(line.quantity_input) > 0) || !(parseFloat(line.rate_input) > 0)) { addToast('Item, quantity and rate are required', 'error'); return; }
    if (lineOverSell) { addToast(`Only ${Math.round(lineAvailKg).toLocaleString()} kg left for this lot`, 'error'); return; }
    setCart(c => [...c, { ...line, qtyKg: lineQtyKg, ratePerKg: lineRatePerKg, total: lineTotal, lotNo: selectedLot?.lotNo || null, category: selectedLot ? lotCategory(selectedLot) : (line.item_type || 'Other') }]);
    setLine(EMPTY_LINE);
  }
  const removeLine = (i) => setCart(c => c.filter((_, idx) => idx !== i));

  const grandTotal = cart.reduce((s, c) => s + c.total, 0);

  function reset() {
    setForm({ customer_id: '', buyer_name: '', buyer_phone: '', payment_mode: 'cash', paid_amount: '', vehicle_no: '', driver_name: '', notes: '' });
    setCart([]); setLine(EMPTY_LINE); setTag('All'); setStep(1);
  }

  async function handleSubmit() {
    if (!form.customer_id && !form.buyer_name) { addToast('Select a customer or enter buyer name', 'error'); return; }
    if (cart.length === 0) { addToast('Add at least one item to the sale', 'error'); return; }
    try {
      const payload = {
        customer_id: form.customer_id || null, buyer_name: form.buyer_name || null, buyer_phone: form.buyer_phone || null,
        payment_mode: form.payment_mode, paid_amount: form.paid_amount === '' ? undefined : (parseFloat(form.paid_amount) || 0),
        vehicle_no: form.vehicle_no || null, driver_name: form.driver_name || null, notes: form.notes || null,
        items: cart.map(c => ({
          lot_id: c.lot_id || null, item_name: c.item_name, item_type: c.item_type,
          quantity_input: parseFloat(c.quantity_input), quantity_unit: c.quantity_unit, bag_weight_kg: parseFloat(c.bag_weight_kg),
          rate_input: parseFloat(c.rate_input), rate_unit: c.rate_unit,
        })),
      };
      const res = await createMutation.mutateAsync(payload);
      const cnt = res?.data?.item_count || cart.length;
      addToast(`Sale ${res?.data?.group_no || ''} created — ${cnt} item${cnt > 1 ? 's' : ''}, ${fmtPKR(grandTotal)}`, 'success');
      if (isWalkIn && registerCustomer && form.buyer_name.trim()) {
        try {
          const r = await adminApi.customersQuickAdd({ name: form.buyer_name.trim(), phone: form.buyer_phone || null });
          addToast(r?.data?.deduped ? `${form.buyer_name.trim()} is already a customer` : `${form.buyer_name.trim()} sent for admin approval as a customer`, 'success');
        } catch { /* non-blocking */ }
      }
      refreshFromApi('local-sales');
      onClose();
      reset();
    } catch (err) { addToast(err.message || 'Sale failed', 'error'); }
  }

  const step1Valid = cart.length > 0 && (!!form.customer_id || !!form.buyer_name);
  function tryNext() {
    if (!form.customer_id && !form.buyer_name) { addToast('Select a customer or enter buyer name', 'error'); return; }
    if (cart.length === 0) { addToast('Add at least one item to the sale', 'error'); return; }
    setStep(2);
  }
  const STEPS = [{ n: 1, label: 'Buyer & Items' }, { n: 2, label: 'Payment' }];

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-gray-500 flex items-center gap-3 flex-wrap">
        {cart.length > 0 && <span><span className="font-medium text-gray-900">{cart.length}</span> item{cart.length > 1 ? 's' : ''}</span>}
        {grandTotal > 0 && <span><span className="text-gray-400">Total</span> <span className="font-medium text-emerald-700">Rs {grandTotal.toLocaleString()}</span></span>}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900">Cancel</button>
        {step > 1 && (
          <button onClick={() => setStep(s => Math.max(1, s - 1))} className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 inline-flex items-center gap-1">
            <ChevronLeft size={14} /> Back
          </button>
        )}
        {step === 1 ? (
          <button onClick={tryNext} disabled={!step1Valid}
            className={`px-4 py-2 text-sm font-medium rounded-lg inline-flex items-center gap-1 ${step1Valid ? 'bg-gray-900 text-white hover:bg-gray-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
            Next <ChevronRight size={14} />
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={createMutation.isPending || cart.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:bg-gray-300">
            {createMutation.isPending ? 'Creating…' : grandTotal > 0 ? `Create Sale — Rs ${grandTotal.toLocaleString()}` : 'Create Sale'}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <SlideDrawer open={isOpen} onClose={onClose} title="New Local Sale" subtitle={STEPS[step - 1]?.label} icon={ShoppingCart} size="xl" footer={footer}>
        {/* Step indicator */}
        <div className="-mx-5 -mt-5 mb-5 px-5 pt-4 pb-4 border-b border-gray-100 bg-gray-50/60">
          <div className="flex items-center justify-between max-w-md mx-auto">
            {STEPS.map((s, idx) => {
              const isActive = step === s.n;
              const isDone = step > s.n;
              return (
                <div key={s.n} className="flex items-center flex-1">
                  <button type="button" onClick={() => setStep(s.n)} className="flex flex-col items-center group">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-all ${
                      isActive ? 'bg-gray-900 text-white' : isDone ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-400 group-hover:border-gray-400'
                    }`}>
                      {isDone ? <Check size={13} /> : s.n}
                    </span>
                    <span className={`mt-1.5 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap ${
                      isActive ? 'text-gray-900' : isDone ? 'text-emerald-600' : 'text-gray-400'
                    }`}>{s.label}</span>
                  </button>
                  {idx < STEPS.length - 1 && (
                    <div className={`flex-1 h-px mx-2 -mt-4 transition-colors ${step > s.n ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">

        {step === 1 && <>
        {/* Buyer */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Buyer</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={LABEL}>Customer</label>
              <select value={form.customer_id}
                onChange={e => { const v = e.target.value; setForm(p => ({ ...p, customer_id: v, ...(v ? { buyer_name: '', buyer_phone: '' } : {}) })); }}
                className={SELECT}>
                <option value="">Walk-in / not registered</option>
                {(customers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {isWalkIn && (
              <>
                <div>
                  <label className={LABEL}>Buyer Name *</label>
                  <input value={form.buyer_name} onChange={e => set('buyer_name', e.target.value)} className={INPUT} placeholder="Walk-in buyer name" />
                </div>
                <div>
                  <label className={LABEL}>Phone</label>
                  <input value={form.buyer_phone} onChange={e => set('buyer_phone', e.target.value)} className={INPUT} placeholder="Phone number" />
                </div>
              </>
            )}
          </div>
          {isWalkIn && form.buyer_name.trim() && (
            <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={registerCustomer} onChange={e => setRegisterCustomer(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
              <span className="text-sm">
                <span className="font-medium text-violet-900 inline-flex items-center gap-1"><UserPlus size={13} /> Register “{form.buyer_name.trim()}” as a customer</span>
                <span className="block text-xs text-violet-700/80 mt-0.5">Sends an approval to Admin → Approvals. Once approved they’re added to the system for future sales.</span>
              </span>
            </label>
          )}
        </div>

        {/* Items — tag filter + lot picker + qty/rate, then Add to the cart */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Add Items</h3>

          {/* Category tags from inventory */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tags.map(t => (
              <button key={t} type="button" onClick={() => { setTag(t); setL('lot_id', ''); }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${tag === t ? 'bg-gray-900 text-white border-gray-900' : `border-transparent ${t === 'All' ? 'bg-gray-100 text-gray-600' : CAT_COLOR[t] || 'bg-gray-100 text-gray-600'} hover:opacity-80`}`}>
                {t}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-gray-200 p-3 space-y-3 bg-gray-50/40">
            <div>
              <label className={LABEL}>Select from Inventory{tag !== 'All' ? ` — ${tag}` : ''}</label>
              <select value={line.lot_id} onChange={e => pickLot(e.target.value)} className={SELECT}>
                <option value="">No lot (manual entry)</option>
                {filteredLots.map(l => {
                  const avail = (parseFloat(l.availableQty) || 0) * 1000 - cartQtyForLot(l.id);
                  return <option key={l.id} value={l.id} disabled={avail <= 0}>{l.lotNo} — {l.itemName} ({Math.round(avail).toLocaleString()} KG)</option>;
                })}
              </select>
            </div>
            <div>
              <label className={LABEL}>Item Name *</label>
              <input value={line.item_name} onChange={e => setL('item_name', e.target.value)} className={INPUT} placeholder="e.g. Broken Rice, 1121 Sella" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>Quantity *</label>
                <div className="flex gap-1.5">
                  <input type="number" value={line.quantity_input} onChange={e => setL('quantity_input', e.target.value)} className={INPUT} placeholder="Qty" />
                  <select value={line.quantity_unit} onChange={e => setL('quantity_unit', e.target.value)} className="w-24 border border-gray-300 rounded-lg px-2 py-2.5 text-sm bg-white">
                    <option value="katta">Katta</option><option value="maund">Maund</option><option value="kg">KG</option><option value="ton">Ton</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL}>Rate *</label>
                <div className="flex gap-1.5">
                  <input type="number" value={line.rate_input} onChange={e => setL('rate_input', e.target.value)} className={INPUT} placeholder="Rate" />
                  <select value={line.rate_unit} onChange={e => setL('rate_unit', e.target.value)} className="w-24 border border-gray-300 rounded-lg px-2 py-2.5 text-sm bg-white">
                    <option value="katta">/Katta</option><option value="maund">/Maund</option><option value="kg">/KG</option><option value="ton">/Ton</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div className="w-32">
                <label className={LABEL}>Katta Wt (kg)</label>
                <input type="number" value={line.bag_weight_kg} onChange={e => setL('bag_weight_kg', e.target.value)} className={INPUT} />
              </div>
              <div className="flex-1 text-xs">
                {lineAvailKg != null && (
                  <span className={lineOverSell ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                    {lineOverSell ? `Only ${Math.round(lineAvailKg).toLocaleString()} kg left` : `In stock: ${Math.round(lineAvailKg).toLocaleString()} kg`}
                  </span>
                )}
                {lineTotal > 0 && <span className="block text-emerald-700 font-semibold mt-0.5">Line total: Rs {lineTotal.toLocaleString()}</span>}
              </div>
              <button type="button" onClick={addLine} disabled={lineOverSell}
                className="px-3 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 inline-flex items-center gap-1 shrink-0">
                <Plus size={15} /> Add
              </button>
            </div>
          </div>

          {/* Cart */}
          {cart.length > 0 && (
            <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-[11px] uppercase text-gray-500">
                    <th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Rate/kg</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((c, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${CAT_COLOR[c.category] || 'bg-gray-100 text-gray-600'}`}>{c.category}</span>
                          {c.item_name}
                        </div>
                        {c.lotNo && <div className="text-[11px] text-gray-400">{c.lotNo}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{Math.round(c.qtyKg).toLocaleString()} kg</td>
                      <td className="px-3 py-2 text-right tabular-nums">Rs {Math.round(c.ratePerKg).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">Rs {c.total.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500"><X size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-bold text-gray-900">
                    <td className="px-3 py-2" colSpan={3}>Total ({cart.length})</td>
                    <td className="px-3 py-2 text-right text-emerald-700 tabular-nums">Rs {grandTotal.toLocaleString()}</td><td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        </>}

        {step === 2 && <>
        {/* Order summary */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 text-[11px] uppercase text-gray-500 font-semibold">{cart.length} item{cart.length > 1 ? 's' : ''}</div>
          {cart.map((c, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-sm">
              <span className="text-gray-700"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1.5 ${CAT_COLOR[c.category] || 'bg-gray-100 text-gray-600'}`}>{c.category}</span>{c.item_name} · {Math.round(c.qtyKg).toLocaleString()} kg</span>
              <span className="font-semibold tabular-nums">Rs {c.total.toLocaleString()}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-2.5 border-t border-gray-200 bg-emerald-50">
            <span className="text-sm font-semibold text-emerald-800">Grand Total</span>
            <span className="text-xl font-bold text-emerald-700">Rs {grandTotal.toLocaleString()}</span>
          </div>
        </div>

        {/* Payment & Dispatch */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Payment & Dispatch</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Payment Mode</label>
              <select value={form.payment_mode} onChange={e => set('payment_mode', e.target.value)} className={SELECT}>
                <option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank Transfer</option><option value="credit">Credit (Udhaar)</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Amount Received</label>
              <input type="number" value={form.paid_amount} onChange={e => set('paid_amount', e.target.value)} className={INPUT}
                placeholder={grandTotal > 0 ? `Rs ${grandTotal.toLocaleString()} (full)` : 'Rs'} />
              {form.payment_mode === 'credit' && <p className="text-xs text-amber-600 mt-1">Leave empty or partial for credit sale</p>}
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">The amount received is split across the items automatically; any balance becomes a receivable for this buyer.</p>
          <div className="grid grid-cols-1 gap-4 mt-4">
            <div>
              <label className={LABEL}>Vehicle No</label>
              <input value={form.vehicle_no} onChange={e => set('vehicle_no', e.target.value)} className={INPUT} placeholder="e.g. LHR-1234" />
            </div>
            <div>
              <label className={LABEL}>Driver</label>
              <input value={form.driver_name} onChange={e => set('driver_name', e.target.value)} className={INPUT} placeholder="Driver name" />
            </div>
            <div>
              <label className={LABEL}>Notes</label>
              <input value={form.notes} onChange={e => set('notes', e.target.value)} className={INPUT} placeholder="Sale notes" />
            </div>
          </div>
        </div>
        </>}
        </div>
    </SlideDrawer>
  );
}
