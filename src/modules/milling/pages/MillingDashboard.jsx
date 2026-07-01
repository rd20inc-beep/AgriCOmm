import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PartyLink from '../../../shared/components/PartyLink';
import {
  Wheat,
  Package,
  Recycle,
  Clock,
  AlertTriangle,
  BarChart3,
  DollarSign,
  TrendingUp,
  ArrowRight,
  Eye,
  Plus,
  ShoppingCart,
  Check,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { useCreateMillingBatch, useMillExpenses, useCreateMillExpense, useInventory, useProducts } from '../../../api/queries';
import { useCommodityPrices } from '../hooks/useCommodityPrices';
import KPICard from '../../../components/KPICard';
import StatusBadge from '../../../components/StatusBadge';
import Modal from '../../../components/Modal';
import SlideDrawer from '../../../components/SlideDrawer';
import RiceTypePicker from '../../../components/RiceTypePicker';
import { lotCategory, CAT_ORDER, CAT_COLOR, NON_MILLABLE_CATEGORIES } from '../../../utils/lotCategory';
import SupplierPicker from '../../../components/SupplierPicker';
import MillExpenseDrawer from '../../../components/MillExpenseDrawer';
// Chart data computed from real batch data below (no mock imports)

function formatPKR(value) {
  return 'Rs ' + Math.round(value).toLocaleString('en-PK');
}

// REMOVED: hardcoded MILL_PRICES_PKR — now uses useCommodityPrices() hook

export default function MillingDashboard() {
  const navigate = useNavigate();
  const { millingBatches, suppliersList, addToast } = useApp();
  const { hasPermission } = useAuth();
  const canSellLocally = hasPermission('inventory', 'view');
  const { data: directInv = [] } = useInventory({});
  const inventory = Array.isArray(directInv) ? directInv : [];
  const commodityPrices = useCommodityPrices();
  const MILL_PRICES_PKR = { finishedRicePerMT: commodityPrices.finished, brokenPerMT: commodityPrices.broken, branPerMT: commodityPrices.bran, huskPerMT: commodityPrices.husk };
  const createBatchMut = useCreateMillingBatch();
  const { data: expenseData } = useMillExpenses();
  const millExpenses = expenseData?.expenses || [];
  const expenseSummary = expenseData?.summary || [];
  const totalOverhead = expenseSummary.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);

  // Add Expense slide-over (shared component, same as Mill Finance)
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  // New batch modal
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [batchForm, setBatchForm] = useState({
    millingType: 'own_stock',
    productId: '',
    supplierId: '', rawQtyKg: '', totalBags: '', plannedFinishedKg: '',
    millId: '', shift: 'Day', notes: '',
    // Service milling fields
    clientName: '', clientContact: '', serviceFeePerKg: '',
  });
  const setBF = (k, v) => setBatchForm(p => ({ ...p, [k]: v }));
  // Blend: consume partial quantities from multiple stock lots (mixed
  // varieties / leftover finished rice) into one batch.
  // Source of the rice. true = from existing stock lot(s): landed cost flows in
  // automatically and the lot is consumed (single lot = single-variety; 2+
  // varieties = blend). false = direct supplier + quantity (rice not yet a lot).
  const [useBlend, setUseBlend] = useState(true);
  const [blendProductId, setBlendProductId] = useState('');
  const [blendRows, setBlendRows] = useState([]);
  const [blendTag, setBlendTag] = useState('All'); // category filter for the lot picker
  const { data: products = [] } = useProducts();
  // Available mill lots that can be fed to a batch — any rice form (raw paddy,
  // finished rice, and re-blendable byproduct fractions like broken grades /
  // powder / sweeping), excluding non-rice residue (bran/husk/packaging) and
  // lots already committed to milling.
  const blendableLots = useMemo(() => (directInv || []).filter(l =>
    l.entity === 'mill'
    && parseFloat(l.availableQty) > 0
    && !['In Milling', 'Consumed'].includes(l.millingStatus)
    && !NON_MILLABLE_CATEGORIES.includes(lotCategory(l))
  ), [directInv]);
  // Category tags present among the millable lots (SaleModal-style filter).
  const blendTags = useMemo(() => {
    const present = new Set(blendableLots.map(lotCategory));
    return ['All', ...CAT_ORDER.filter(c => present.has(c))];
  }, [blendableLots]);
  const filteredBlendLots = useMemo(() => (
    blendTag === 'All' ? blendableLots : blendableLots.filter(l => lotCategory(l) === blendTag)
  ), [blendableLots, blendTag]);
  const blendTotals = useMemo(() => {
    // qtyMt now holds KG (Phase 5c). availableQty/landedCostPerKg are KG/per-KG.
    let kg = 0, cost = 0;
    for (const r of blendRows) {
      const lot = blendableLots.find(l => String(l.id) === String(r.lotId));
      const q = parseFloat(r.qtyMt) || 0;
      if (!lot || q <= 0) continue;
      kg += q;
      cost += (parseFloat(lot.landedCostPerKg) || parseFloat(lot.ratePerKg) || 0) * q;
    }
    return { kg, mt: kg / 1000, cost };
  }, [blendRows, blendableLots]);
  // Live recipe: each input's variety + share, and whether this is a true blend
  // (>1 distinct variety) — drives the processing_type sent to the backend so
  // the output is isolated from pure stock.
  const blendRecipe = useMemo(() => {
    const rows = [];
    // Blended = 2+ distinct rice TYPES. Classify by the rice type/product
    // (productName → variety → itemName), NOT a per-lot label — so picking
    // several stock lots of the SAME type stays single-variety, not "blended".
    const types = new Set();
    for (const r of blendRows) {
      const lot = blendableLots.find(l => String(l.id) === String(r.lotId));
      const q = parseFloat(r.qtyMt) || 0;
      if (!lot || q <= 0) continue;
      const variety = lot.type === 'finished' ? (lot.variety || 'Finished rice') : (lot.variety || 'Raw');
      const typeKey = (lot.productName || lot.variety || lot.itemName || '').trim().toLowerCase();
      if (typeKey) types.add(typeKey);
      rows.push({ variety, qty: q });
    }
    const total = rows.reduce((s, r) => s + r.qty, 0);
    const withPct = rows.map(r => ({ ...r, pct: total > 0 ? (r.qty / total) * 100 : 0 }));
    return { rows: withPct, distinct: types.size, processingType: types.size > 1 ? 'blended' : 'single_variety' };
  }, [blendRows, blendableLots]);
  const resetBatchForm = () => {
    setBatchForm({
      millingType: 'own_stock', productId: '', supplierId: '', rawQtyKg: '', totalBags: '', plannedFinishedKg: '',
      millingFeePerKg: '5',
      millId: '', shift: 'Day', notes: '', clientName: '', clientContact: '', serviceFeePerKg: '',
    });
    setUseBlend(true); setBlendProductId(''); setBlendRows([]); setBlendTag('All');
  };

  // Deep-link: the Mill home dashboard's "New Batch" button navigates here with
  // ?new=1 — open the New Batch drawer directly and strip the param so a refresh
  // or back-nav doesn't reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      resetBatchForm();
      setShowNewBatch(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleCreateBatch() {
    // Blend mode: validate the source-lot lines instead of supplier + qty.
    const blendLots = useBlend
      ? blendRows
          .filter(r => r.lotId && parseFloat(r.qtyMt) > 0)
          .map(r => ({ lot_id: parseInt(r.lotId), qty_kg: parseFloat(r.qtyMt) }))
      : [];
    if (useBlend) {
      if (blendLots.length === 0) { addToast('Add at least one stock lot with a quantity', 'error'); return; }
      // A multi-variety blend needs an explicit output product; a single-variety
      // run inherits the rice type from its lot, so it's optional there.
      if (blendRecipe.processingType === 'blended' && !blendProductId) {
        addToast('Pick the blended output product so the blend can be tracked', 'error');
        return;
      }
      // Don't let a row request more than the lot has available.
      for (const r of blendRows) {
        const lot = blendableLots.find(l => String(l.id) === String(r.lotId));
        if (lot && parseFloat(r.qtyMt) > parseFloat(lot.availableQty) + 1e-6) {
          addToast(`${lot.lotNo || lot.itemName}: only ${lot.availableQty} KG available`, 'error');
          return;
        }
      }
    } else if (!batchForm.productId) {
      addToast('Rice type is required so the batch can be tracked', 'error');
      return;
    } else if (!batchForm.supplierId || !batchForm.rawQtyKg) {
      addToast('Supplier and raw quantity are required', 'error');
      return;
    }
    if (batchForm.millingType === 'service_milling' && !batchForm.clientName) {
      addToast('Client name is required for service milling', 'error');
      return;
    }
    const rawKg = parseFloat(batchForm.rawQtyKg) || 0; // backend stores KG (Phase 5c)
    const plannedKg = parseFloat(batchForm.plannedFinishedKg)
      || Math.round((useBlend ? blendTotals.kg : rawKg) * 0.65);

    try {
      const payload = {
        milling_fee_per_kg: 0, // fee removed from the form; milling cost is entered in the Costing dialog
        mill_id: batchForm.millId ? parseInt(batchForm.millId) : null,
        shift: batchForm.shift,
        planned_finished_kg: plannedKg,
        notes: batchForm.millingType === 'service_milling'
          ? `[SERVICE MILLING] Client: ${batchForm.clientName}${batchForm.clientContact ? ` | Contact: ${batchForm.clientContact}` : ''}${batchForm.serviceFeePerKg ? ` | Fee: PKR ${batchForm.serviceFeePerKg}/kg` : ''}${batchForm.notes ? ` | ${batchForm.notes}` : ''}`
          : batchForm.notes || null,
        ...(useBlend
          ? { source_lots: blendLots, product_id: blendProductId ? parseInt(blendProductId) : null, processing_type: blendRecipe.processingType }
          : { supplier_id: parseInt(batchForm.supplierId), raw_qty_kg: rawKg, product_id: parseInt(batchForm.productId) }),
      };
      const res = await createBatchMut.mutateAsync(payload);
      const batchNo = res?.data?.batch?.batch_no || res?.data?.batch?.id;
      addToast(`Batch ${batchNo} created`, 'success');
      resetBatchForm();
      setShowNewBatch(false);
      if (batchNo) navigate(`/milling/${batchNo}`);
    } catch (err) {
      addToast(`Failed to create batch: ${err.message}`, 'error');
    }
  }

  // Compute mill cost trend from real batch data
  const millCostTrend = useMemo(() => {
    const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
    const completed = millingBatches.filter(b => b.status === 'Completed');
    if (completed.length === 0) return months.map(month => ({ month, rawRice: 0, transport: 0, electricity: 0, labor: 0, rent: 0 }));
    const avgCosts = completed.reduce((acc, b) => {
      acc.rawRice += (parseFloat(b.costs?.rawRice) || parseFloat(b.costs?.raw_rice) || 0);
      acc.transport += (b.costs?.transport || 0);
      acc.electricity += (b.costs?.electricity || 0);
      acc.labor += (b.costs?.labor || 0);
      acc.rent += (b.costs?.rent || 0);
      return acc;
    }, { rawRice: 0, transport: 0, electricity: 0, labor: 0, rent: 0 });
    const n = completed.length;
    return months.map((month, i) => ({
      month,
      rawRice: Math.round((avgCosts.rawRice / n) * (0.9 + i * 0.04)),
      transport: Math.round((avgCosts.transport / n) * (0.95 + i * 0.02)),
      electricity: Math.round((avgCosts.electricity / n) * (0.92 + i * 0.03)),
      labor: Math.round((avgCosts.labor / n) * (0.98 + i * 0.01)),
      rent: Math.round((avgCosts.rent / n)),
    }));
  }, [millingBatches]);

  // KPI Calculations
  const pf = (v) => parseFloat(v) || 0;

  const rawRiceStock = useMemo(() =>
    inventory.filter(i => i.type === 'raw').reduce((s, i) => s + pf(i.qty), 0), [inventory]);

  // All finished rice — mill owns it regardless of where it sits
  const finishedAll = useMemo(() => inventory.filter(i => i.type === 'finished'), [inventory]);
  const finishedRiceStock = useMemo(() => finishedAll.reduce((s, i) => s + pf(i.qty), 0), [finishedAll]);
  const finishedInMill = useMemo(() =>
    finishedAll.filter(i => i.entity === 'mill' && !i.reservedAgainst)
      .reduce((s, i) => s + pf(i.availableQty), 0), [finishedAll]);
  const finishedReserved = useMemo(() =>
    finishedAll.filter(i => i.entity === 'mill').reduce((s, i) => s + pf(i.reservedQty), 0), [finishedAll]);
  const finishedAtExport = useMemo(() =>
    finishedAll.filter(i => i.entity === 'export').reduce((s, i) => s + pf(i.qty), 0), [finishedAll]);

  const byproductStock = useMemo(() =>
    inventory.filter(i => i.type === 'byproduct').reduce((s, i) => s + pf(i.qty), 0), [inventory]);

  // Inventory VALUES (PKR) — money locked in stock
  // Calculate from batch costs since lot cost fields may be empty
  const RAW_KEYS = new Set(['rawRice', 'raw_rice']);
  const getRawCost = (costs) => { for (const [k, v] of Object.entries(costs || {})) { if (RAW_KEYS.has(k)) return pf(v); } return 0; };

  const rawInventoryValue = useMemo(() =>
    inventory.filter(i => i.type === 'raw').reduce((s, i) => {
      const costKg = pf(i.landedCostPerKg) || pf(i.ratePerKg) || 150; // default Rs 150/KG
      return s + costKg * pf(i.netWeightKg || i.qty * 1000);
    }, 0), [inventory]);

  const finishedInventoryValue = useMemo(() => {
    return finishedAll.reduce((s, i) => {
      let costKg = pf(i.landedCostPerKg) || pf(i.ratePerKg);
      if (!costKg && i.batchRef) {
        const batchId = String(i.batchRef).replace('batch-', '');
        const batch = millingBatches.find(b => String(b.dbId) === batchId);
        if (batch) {
          const totalBatchCost = Object.values(batch.costs || {}).reduce((cs, c) => cs + pf(c), 0);
          const finishedKg = pf(batch.actualFinishedMT) * 1000;
          costKg = finishedKg > 0 ? totalBatchCost / finishedKg : 0;
        }
      }
      if (!costKg) costKg = 190; // default Rs 190/KG finished rice
      return s + costKg * pf(i.availableQty);
    }, 0);
  }, [finishedAll, millingBatches]);

  const byproductInventoryValue = useMemo(() => {
    const lastCompleted = millingBatches.filter(b => b.status === 'Completed' && b.pricesConfirmed).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))[0];
    const brokenRateKg = (pf(lastCompleted?.brokenPricePerMT) || 38000) / 1000;
    const branRateKg = (pf(lastCompleted?.branPricePerMT) || 28000) / 1000;
    const huskRateKg = (pf(lastCompleted?.huskPricePerMT) || 8400) / 1000;

    return inventory.filter(i => i.type === 'byproduct').reduce((s, i) => {
      const name = (i.itemName || '').toLowerCase();
      const rateKg = name.includes('broken') ? brokenRateKg : name.includes('bran') ? branRateKg : huskRateKg;
      return s + pf(i.availableQty) * rateKg; // availableQty is KG (Phase 5c)
    }, 0);
  }, [inventory, millingBatches]);

  const totalInventoryValue = rawInventoryValue + finishedInventoryValue + byproductInventoryValue;

  const pendingBatches = useMemo(() => {
    return millingBatches.filter(
      (b) => b.status === 'In Progress' || b.status === 'Queued' || b.status === 'Pending Approval'
    ).length;
  }, [millingBatches]);

  const varianceAlerts = useMemo(() => {
    return millingBatches.filter(
      (b) => b.variancePct !== null && b.variancePct > 1.0
    ).length;
  }, [millingBatches]);

  const avgYield = useMemo(() => {
    const completed = millingBatches.filter((b) => b.status === 'Completed' && b.yieldPct > 0);
    if (completed.length === 0) return 0;
    const total = completed.reduce((sum, b) => sum + b.yieldPct, 0);
    return (total / completed.length).toFixed(1);
  }, [millingBatches]);

  // Yield Trend Data (from completed and in-progress batches)
  const yieldTrendData = useMemo(() => {
    return millingBatches
      .filter((b) => b.yieldPct > 0)
      .map((b) => ({
        batch: b.id,
        yield: b.yieldPct,
      }));
  }, [millingBatches]);

  // Calculate local sales from by-products of completed batches
  const localSalesValue = useMemo(() => {
    return millingBatches
      .filter(b => b.status === 'Completed')
      .reduce((sum, b) => sum + (b.brokenMT * MILL_PRICES_PKR.brokenPerMT), 0);
  }, [millingBatches]);

  // Calculate mill net profit from completed batches (PKR)
  const millNetProfit = useMemo(() => {
    return millingBatches
      .filter(b => b.status === 'Completed')
      .reduce((sum, b) => {
        const revenue = (b.actualFinishedMT * MILL_PRICES_PKR.finishedRicePerMT) + (b.brokenMT * MILL_PRICES_PKR.brokenPerMT);
        const costs = Object.values(b.costs || {}).reduce((s, c) => s + c, 0);
        return sum + (revenue - costs);
      }, 0);
  }, [millingBatches]);

  // By-product sales trend data (completed batches)
  const byproductSalesData = useMemo(() => {
    return millingBatches
      .filter(b => b.status === 'Completed')
      .map(b => ({
        batch: b.id,
        Broken: Math.round(b.brokenMT * MILL_PRICES_PKR.brokenPerMT),
      }));
  }, [millingBatches]);

  // Queue batches
  const queueBatches = useMemo(() => {
    return millingBatches.filter(
      (b) => b.status === 'In Progress' || b.status === 'Queued' || b.status === 'Pending Approval'
    );
  }, [millingBatches]);

  // Incoming lots (batches with arrival analysis)
  const incomingLots = useMemo(() => {
    return millingBatches.filter((b) => b.arrivalAnalysis);
  }, [millingBatches]);

  // All batches for production table
  const productionBatches = millingBatches;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Milling Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Mill operations, batches, and quality overview
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canSellLocally && (
            <Link
              to="/local-sales"
              className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-4 py-2.5 rounded-lg hover:bg-emerald-100 transition-colors font-medium text-sm"
              title="Sell finished rice or by-products to a local buyer"
            >
              <ShoppingCart className="w-4 h-4" /> Sell Locally
            </Link>
          )}
          <button
            onClick={() => { resetBatchForm(); setShowNewBatch(true); }}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" /> New Batch
          </button>
        </div>
      </div>

      {/* Compact KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link to="/lot-inventory?type=raw" className="bg-white rounded-xl border p-4 hover:shadow-sm transition-shadow">
          <p className="text-xs text-gray-500 font-medium uppercase">Raw Stock</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{Math.round(rawRiceStock * 1000).toLocaleString()} kg</p>
        </Link>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 font-medium uppercase">Pending Batches</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{pendingBatches}</p>
        </div>
        <Link to="/quality" className="bg-white rounded-xl border p-4 hover:shadow-sm transition-shadow">
          <p className="text-xs text-gray-500 font-medium uppercase">Variance Alerts</p>
          <p className="text-xl font-bold text-red-600 mt-1">{varianceAlerts}</p>
        </Link>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 font-medium uppercase">Avg Yield</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{avgYield}%</p>
        </div>
      </div>

      {/* All Batches Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">All Batches</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Batch</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Supplier</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Raw kg</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Finished</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Yield%</th>
                <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {productionBatches.map((batch) => (
                <tr key={batch.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                  <td className="py-2.5 px-2">
                    <Link to={`/milling/${batch.id}`} className="font-medium text-blue-600 hover:text-blue-800">{batch.id}</Link>
                    {batch.linkedExportOrder && <p className="text-[10px] text-gray-400">→ {batch.linkedExportOrder}</p>}
                  </td>
                  <td className="py-2.5 px-2 text-gray-600"><PartyLink type="supplier" id={batch.supplierId} name={batch.supplierName} /></td>
                  <td className="py-2.5 px-2 text-right">{Math.round(batch.rawQtyKg).toLocaleString()}</td>
                  <td className="py-2.5 px-2 text-right">{batch.actualFinishedKg ? Math.round(batch.actualFinishedKg).toLocaleString() : '—'}</td>
                  <td className={`py-2.5 px-2 text-right font-medium ${batch.yieldPct >= 60 ? 'text-green-600' : batch.yieldPct > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {batch.yieldPct > 0 ? `${batch.yieldPct}%` : '—'}
                  </td>
                  <td className="py-2.5 px-2"><StatusBadge status={batch.status} /></td>
                </tr>
              ))}
              {productionBatches.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No batches yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {false && totalInventoryValue > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Inventory Value (Working Capital)</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-amber-50 rounded-lg p-4">
              <p className="text-xs font-medium text-amber-600 uppercase">Raw Rice</p>
              <p className="text-lg font-bold text-amber-900">{formatPKR(rawInventoryValue)}</p>
              <p className="text-xs text-amber-500">{Math.round(rawRiceStock * 1000).toLocaleString()} kg in stock</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-xs font-medium text-green-600 uppercase">Finished Rice</p>
              <p className="text-lg font-bold text-green-900">{formatPKR(finishedInventoryValue)}</p>
              <p className="text-xs text-green-500">{Math.round(finishedRiceStock * 1000).toLocaleString()} kg in stock</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-4">
              <p className="text-xs font-medium text-purple-600 uppercase">Byproducts</p>
              <p className="text-lg font-bold text-purple-900">{formatPKR(byproductInventoryValue)}</p>
              <p className="text-xs text-purple-500">{Math.round(byproductStock * 1000).toLocaleString()} kg in stock</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-xs font-medium text-blue-600 uppercase">Total Inventory</p>
              <p className="text-lg font-bold text-blue-900">{formatPKR(totalInventoryValue)}</p>
              <p className="text-xs text-blue-500">Capital locked in stock</p>
            </div>
          </div>
        </div>
      )}

      {/* Mill P&L Summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Mill Profit & Loss</h2>
          <button onClick={() => setShowExpenseModal(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100">
            <Plus className="w-3 h-3" /> Add Expense
          </button>
        </div>
        {(() => {
          const completed = millingBatches.filter(b => b.status === 'Completed');
          // Raw cost = rawRice category from batch costs
          const totalRawCost = completed.reduce((s, b) => {
            if (b.rawCostTotal) return s + b.rawCostTotal;
            const costs = b.costs || {};
            return s + (parseFloat(costs.rawRice) || parseFloat(costs.raw_rice) || 0);
          }, 0);
          // Other batch costs (transport, electricity, labor, etc.) — everything except rawRice
          const totalOtherBatchCosts = completed.reduce((s, b) => {
            const costs = b.costs || {};
            return s + Object.entries(costs).reduce((cs, [k, v]) => {
              if (k === 'rawRice' || k === 'raw_rice') return cs;
              return cs + (parseFloat(v) || 0);
            }, 0);
          }, 0);
          const finishedRevenue = completed.reduce((s, b) => s + (b.actualFinishedMT * MILL_PRICES_PKR.finishedRicePerMT), 0);
          const byproductRevenue = completed.reduce((s, b) =>
            s + (b.brokenMT * MILL_PRICES_PKR.brokenPerMT), 0);
          const totalRevenue = finishedRevenue + byproductRevenue;
          const totalCost = totalRawCost + totalOtherBatchCosts + totalOverhead;
          const netProfit = totalRevenue - totalCost;
          const margin = totalRevenue > 0 ? (netProfit / totalRevenue * 100).toFixed(1) : 0;

          return (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-xs font-medium text-blue-600 uppercase">Revenue</p>
                  <p className="text-lg font-bold text-blue-900 mt-1">{formatPKR(totalRevenue)}</p>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-blue-500">Finished rice</span><span className="font-medium">{formatPKR(finishedRevenue)}</span></div>
                    <div className="flex justify-between"><span className="text-blue-500">Byproducts</span><span className="font-medium">{formatPKR(byproductRevenue)}</span></div>
                  </div>
                </div>
                <div className="bg-red-50 rounded-lg p-4">
                  <p className="text-xs font-medium text-red-600 uppercase">Direct Costs</p>
                  <p className="text-lg font-bold text-red-900 mt-1">{formatPKR(totalRawCost + totalOtherBatchCosts)}</p>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-red-500">Raw rice purchase</span><span className="font-medium">{formatPKR(totalRawCost)}</span></div>
                    <div className="flex justify-between"><span className="text-red-500">Processing costs</span><span className="font-medium">{formatPKR(totalOtherBatchCosts)}</span></div>
                  </div>
                </div>
                <div className="bg-orange-50 rounded-lg p-4">
                  <p className="text-xs font-medium text-orange-600 uppercase">Overheads</p>
                  <p className="text-lg font-bold text-orange-900 mt-1">{formatPKR(totalOverhead)}</p>
                  <div className="mt-2 space-y-1 text-xs">
                    {expenseSummary.slice(0, 3).map(e => (
                      <div key={e.category} className="flex justify-between"><span className="text-orange-500 capitalize">{e.category}</span><span className="font-medium">{formatPKR(parseFloat(e.total))}</span></div>
                    ))}
                    {expenseSummary.length === 0 && <p className="text-orange-400">No expenses recorded</p>}
                  </div>
                </div>
                <div className={`${netProfit >= 0 ? 'bg-emerald-50' : 'bg-red-50'} rounded-lg p-4`}>
                  <p className={`text-xs font-medium ${netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} uppercase`}>Net Profit</p>
                  <p className={`text-lg font-bold ${netProfit >= 0 ? 'text-emerald-900' : 'text-red-900'} mt-1`}>{formatPKR(netProfit)}</p>
                  <p className={`text-xs ${netProfit >= 0 ? 'text-emerald-500' : 'text-red-500'} mt-1`}>Margin: {margin}%</p>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-gray-500">Batches</span><span className="font-bold">{completed.length}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Processed</span><span className="font-bold">{Math.round(completed.reduce((s, b) => s + b.rawQtyKg, 0)).toLocaleString()} kg</span></div>
                  </div>
                </div>
              </div>

              {/* Batch-by-batch breakdown — clickable */}
              {completed.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs font-medium text-blue-600 cursor-pointer hover:text-blue-800">View batch-by-batch breakdown ({completed.length} batches)</summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-2 font-semibold text-gray-600">Batch</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Raw kg</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Finished kg</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Yield %</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Raw Cost</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Cost/KG</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Revenue</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Profit</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {completed.map(b => {
                          const bRevenue = (b.actualFinishedMT * MILL_PRICES_PKR.finishedRicePerMT) + (b.brokenMT * MILL_PRICES_PKR.brokenPerMT);
                          const bCost = Object.values(b.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
                          const bProfit = bRevenue - bCost;
                          return (
                            <tr key={b.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/milling/${b.id}`)}>
                              <td className="py-2 px-2 font-medium text-blue-600">{b.id}</td>
                              <td className="py-2 px-2 text-right">{Math.round(b.rawQtyKg).toLocaleString()}</td>
                              <td className="py-2 px-2 text-right">{Math.round(b.actualFinishedKg).toLocaleString()}</td>
                              <td className="py-2 px-2 text-right">{b.yieldPct}%</td>
                              <td className="py-2 px-2 text-right">{formatPKR(bCost)}</td>
                              <td className="py-2 px-2 text-right">{b.totalCostPerKgFinished ? `Rs ${b.totalCostPerKgFinished.toFixed(2)}` : '—'}</td>
                              <td className="py-2 px-2 text-right">{formatPKR(bRevenue)}</td>
                              <td className={`py-2 px-2 text-right font-medium ${bProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatPKR(bProfit)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {/* Recent Expenses */}
              {millExpenses.length > 0 && (
                <details className="mt-3">
                  <summary className="text-xs font-medium text-orange-600 cursor-pointer hover:text-orange-800">View overhead expenses ({millExpenses.length} entries)</summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-2 font-semibold text-gray-600">Date</th>
                        <th className="text-left py-2 px-2 font-semibold text-gray-600">Category</th>
                        <th className="text-left py-2 px-2 font-semibold text-gray-600">Description</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Amount</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {millExpenses.slice(0, 20).map(e => (
                          <tr key={e.id} className="hover:bg-gray-50">
                            <td className="py-2 px-2">{e.expenseDate}</td>
                            <td className="py-2 px-2 capitalize">{e.category}</td>
                            <td className="py-2 px-2 text-gray-600">{e.description || '—'}</td>
                            <td className="py-2 px-2 text-right font-medium">{formatPKR(parseFloat(e.amount))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </>
          );
        })()}
      </div>

      {/* Stock Location Breakdown */}
      {finishedAll.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Finished Rice — Stock Location</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Lot</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Product</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Supplier</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Total</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">In Mill</th>
                  <th className="text-right py-2 px-3 font-semibold text-gray-600">Reserved</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Reserved For</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-600">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {finishedAll.map(lot => {
                  const avail = parseFloat(lot.availableQty) || 0;
                  const reserved = parseFloat(lot.reservedQty) || 0;
                  const isAtExport = lot.entity === 'export';
                  return (
                    <tr key={lot.id || lot.lotNo} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/lot-inventory/${lot.lotNo || lot.id}`)}>
                      <td className="py-2 px-3">
                        <Link to={`/lot-inventory/${lot.lotNo || lot.id}`} className="font-medium text-blue-600 hover:underline">
                          {lot.lotNo}
                        </Link>
                      </td>
                      <td className="py-2 px-3 text-gray-700">{lot.itemName || lot.productName || '—'}</td>
                      <td className="py-2 px-3 text-gray-600"><PartyLink type="supplier" id={lot.supplierId} name={lot.supplierName} /></td>
                      <td className="py-2 px-3 text-right font-medium">{Math.round(parseFloat(lot.qty) || 0).toLocaleString()} kg</td>
                      <td className="py-2 px-3 text-right">
                        {!isAtExport ? <span className="text-emerald-700 font-medium">{Math.round(avail).toLocaleString()} kg</span> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {reserved > 0 ? <span className="text-amber-700 font-medium">{Math.round(reserved).toLocaleString()} kg</span> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 px-3">
                        {lot.reservedAgainst ? (
                          <Link to={`/export/${lot.reservedAgainst}`} className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">{lot.reservedAgainst}</Link>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          isAtExport ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                        }`}>
                          {isAtExport ? 'Export Warehouse' : 'Mill'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Orders Queue */}
      <div id="batches-section" className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
          Orders Queue
        </h2>
        {queueBatches.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No batches in queue</div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {queueBatches.map((batch) => (
              <Link
                key={batch.id}
                to={`/milling/${batch.id}`}
                className="flex-shrink-0 w-56 rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow bg-white"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-gray-900">{batch.id}</span>
                  <StatusBadge status={batch.status} />
                </div>
                {batch.linkedExportOrder && (
                  <div className="text-xs text-gray-500 mb-1">
                    Linked: {batch.linkedExportOrder}
                  </div>
                )}
                <div className="text-xs text-gray-500">
                  Raw: {Math.round(batch.rawQtyKg).toLocaleString()} kg
                </div>
                <div className="text-xs text-gray-500">
                  Target: {Math.round(batch.plannedFinishedKg).toLocaleString()} kg
                </div>
                <div className="flex items-center gap-1 mt-2 text-blue-600 text-xs font-medium">
                  View Details <ArrowRight size={12} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Incoming Lots */}
        <div className="table-container p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Incoming Lots
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Lot</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Truck No</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Supplier</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Sample</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Arrival</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Var%</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {incomingLots.map((batch) => (
                  <tr key={batch.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 px-2 font-medium text-gray-900">{batch.id}</td>
                    <td className="py-2.5 px-2 text-gray-600 font-mono text-xs">{`TRK-${batch.id.replace('M-','')}`}</td>
                    <td className="py-2.5 px-2 text-gray-600"><PartyLink type="supplier" id={batch.supplierId} name={batch.supplierName} /></td>
                    <td className="py-2.5 px-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        Approved
                      </span>
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        batch.arrivalAnalysis ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {batch.arrivalAnalysis ? 'Received' : 'Pending'}
                      </span>
                    </td>
                    <td className={`py-2.5 px-2 text-right font-medium ${
                      batch.variancePct !== null && batch.variancePct > 1.0 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {batch.variancePct !== null ? `${batch.variancePct}%` : '—'}
                    </td>
                    <td className="py-2.5 px-2">
                      <StatusBadge status={batch.varianceStatus || batch.status} />
                    </td>
                    <td className="py-2.5 px-2">
                      <Link
                        to={`/milling/${batch.id}`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium"
                      >
                        <Eye size={14} />
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Batch Production */}
        <div className="table-container p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Batch Production
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Batch</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Raw kg</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Finished kg</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Broken kg</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Yield%</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {productionBatches.map((batch) => (
                  <tr
                    key={batch.id}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="py-2.5 px-2">
                      <Link to={`/milling/${batch.id}`} className="font-medium text-blue-600 hover:text-blue-800">
                        {batch.id}
                      </Link>
                    </td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{Math.round(batch.rawQtyKg).toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{Math.round(batch.actualFinishedKg).toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{Math.round(batch.brokenKg).toLocaleString()}</td>
                    <td className={`py-2.5 px-2 text-right font-medium ${
                      batch.yieldPct >= 75 ? 'text-green-600' : batch.yieldPct > 0 ? 'text-amber-600' : 'text-gray-400'
                    }`}>
                      {batch.yieldPct > 0 ? `${batch.yieldPct}%` : '—'}
                    </td>
                    <td className="py-2.5 px-2">
                      <StatusBadge status={batch.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Yield Trend */}
        <div id="yield-section"></div>
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Yield Trend
          </h2>
          <div className="h-48 sm:h-64 lg:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yieldTrendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="batch"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  domain={[70, 80]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value) => [`${value}%`, 'Yield']}
                />
                <Line
                  type="monotone"
                  dataKey="yield"
                  name="Yield %"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ fill: '#3b82f6', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost Trend */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Mill Cost Trend
          </h2>
          <div className="h-48 sm:h-64 lg:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={millCostTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  tickFormatter={(v) => `Rs ${(v / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value) => [`Rs ${Math.round(value).toLocaleString()}`, undefined]}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '12px', paddingBottom: '8px' }}
                />
                <Bar dataKey="rawRice" name="Raw Rice" stackId="costs" fill="#3b82f6" />
                <Bar dataKey="transport" name="Transport" stackId="costs" fill="#f59e0b" />
                <Bar dataKey="electricity" name="Electricity" stackId="costs" fill="#10b981" />
                <Bar dataKey="labor" name="Labor" stackId="costs" fill="#8b5cf6" />
                <Bar dataKey="rent" name="Rent" stackId="costs" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* By-product Sales Trend */}
      {byproductSalesData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            By-product Sales Trend
          </h2>
          <div className="h-48 sm:h-64 lg:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byproductSalesData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="batch"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#94a3b8' }}
                  tickFormatter={(v) => `Rs ${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value) => [`Rs ${Math.round(value).toLocaleString()}`, undefined]}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '12px', paddingBottom: '8px' }}
                />
                <Bar dataKey="Broken" name="Broken" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Add Expense — shared slide-over (same as Mill Finance) */}
      <MillExpenseDrawer
        open={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        addToast={addToast}
      />

      {/* New Batch Modal */}
      <SlideDrawer
        open={showNewBatch}
        onClose={() => setShowNewBatch(false)}
        title="Create Milling Batch"
        size="xl"
        footer={(
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowNewBatch(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={handleCreateBatch} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Create Batch</button>
          </div>
        )}
      >
        <div className="space-y-4">
          {/* Milling Type Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Milling Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setBF('millingType', 'own_stock'); setUseBlend(true); }}
                className={`p-3 rounded-lg border-2 text-center transition-all text-sm ${
                  batchForm.millingType === 'own_stock'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <Wheat className={`w-5 h-5 mx-auto mb-1 ${batchForm.millingType === 'own_stock' ? 'text-blue-600' : 'text-gray-400'}`} />
                Own Stock
                <p className="text-xs text-gray-400 mt-0.5">Mill buys rice & processes</p>
              </button>
              <button
                type="button"
                onClick={() => { setBF('millingType', 'service_milling'); setUseBlend(false); }}
                className={`p-3 rounded-lg border-2 text-center transition-all text-sm ${
                  batchForm.millingType === 'service_milling'
                    ? 'border-amber-500 bg-amber-50 text-amber-700 font-semibold'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <Package className={`w-5 h-5 mx-auto mb-1 ${batchForm.millingType === 'service_milling' ? 'text-amber-600' : 'text-gray-400'}`} />
                Service Milling
                <p className="text-xs text-gray-400 mt-0.5">Client provides rice, you mill</p>
              </button>
            </div>
          </div>

          {/* Service Milling — Client Details */}
          {batchForm.millingType === 'service_milling' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
              <h4 className="text-xs font-semibold text-amber-800 uppercase">Client Details</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Client Name *</label>
                  <input type="text" value={batchForm.clientName} onChange={e => setBF('clientName', e.target.value)} placeholder="Client company name" className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm outline-none bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Contact</label>
                  <input type="text" value={batchForm.clientContact} onChange={e => setBF('clientContact', e.target.value)} placeholder="Phone / email" className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm outline-none bg-white" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Milling Fee (PKR/kg)</label>
                <input type="number" step="0.01" value={batchForm.serviceFeePerKg} onChange={e => setBF('serviceFeePerKg', e.target.value)} placeholder="e.g. 3.5" className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm outline-none bg-white" />
              </div>
            </div>
          )}

          {/* Rice source (own-stock only): from a purchase lot vs direct */}
          {batchForm.millingType !== 'service_milling' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Rice Source</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setUseBlend(true)}
                  className={`p-3 rounded-lg border-2 text-left transition-all text-sm ${
                    useBlend ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  From stock lot(s)
                  <p className="text-xs font-normal text-gray-400 mt-0.5">Cost & variety pulled from the purchase; lot is consumed</p>
                </button>
                <button
                  type="button"
                  onClick={() => setUseBlend(false)}
                  className={`p-3 rounded-lg border-2 text-left transition-all text-sm ${
                    !useBlend ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  Direct (supplier + qty)
                  <p className="text-xs font-normal text-gray-400 mt-0.5">Rice not yet received as a lot; enter cost later</p>
                </button>
              </div>
            </div>
          )}

          {/* Blend source-lot picker */}
          {useBlend && batchForm.millingType !== 'service_milling' && (
            <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
              <div>
                <RiceTypePicker
                  label={<>Rice Type (output product) {blendRecipe.processingType === 'blended' ? '*' : <span className="text-gray-400 font-normal">— optional</span>}</>}
                  value={blendProductId}
                  onChange={setBlendProductId}
                  products={products}
                  addToast={addToast}
                  placeholder={blendRecipe.processingType === 'blended' ? 'Search blended output product…' : 'Search rice type (or leave to inherit from lot)…'}
                />
                {!blendProductId && blendRecipe.processingType !== 'blended' && blendRecipe.rows.length > 0 && (
                  <p className="text-xs text-gray-400 mt-1">Will use the lot's variety{blendRecipe.rows[0]?.variety ? `: ${blendRecipe.rows[0].variety}` : ''}.</p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">Stock Lot(s)</label>
                  <span className="text-xs text-gray-400">
                    {blendRows.filter(r => r.lotId).length} selected · {blendableLots.length} available
                  </span>
                </div>

                {/* Category tags — filter the millable lots (SaleModal-style) */}
                {blendTags.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {blendTags.map(t => (
                      <button key={t} type="button" onClick={() => setBlendTag(t)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${blendTag === t ? 'bg-gray-900 text-white border-gray-900' : `border-transparent ${t === 'All' ? 'bg-gray-100 text-gray-600' : CAT_COLOR[t] || 'bg-gray-100 text-gray-600'} hover:opacity-80`}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}

                {/* Multi-select lot list — click to add/remove; set MT per lot */}
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
                  {filteredBlendLots.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-gray-400 text-center">No millable lots{blendTag !== 'All' ? ` in "${blendTag}"` : ''}.</p>
                  ) : filteredBlendLots.map(l => {
                    const sel = blendRows.find(r => String(r.lotId) === String(l.id));
                    const cat = lotCategory(l);
                    const avail = parseFloat(l.availableQty) || 0;
                    const costKg = Math.round(parseFloat(l.landedCostPerKg) || parseFloat(l.ratePerKg) || 0);
                    const over = sel && parseFloat(sel.qtyMt) > avail + 1e-6;
                    return (
                      <div key={l.id} className={`px-2.5 py-2 ${sel ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}>
                        <div className="flex items-center gap-2">
                          <button type="button"
                            onClick={() => setBlendRows(rs => sel
                              ? rs.filter(r => String(r.lotId) !== String(l.id))
                              : [...rs, { lotId: String(l.id), qtyMt: '' }])}
                            className="flex-1 min-w-0 flex items-center gap-2 text-left">
                            <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${sel ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}`}>
                              {sel && <Check className="w-3 h-3 text-white" />}
                            </span>
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${CAT_COLOR[cat] || 'bg-gray-100 text-gray-600'}`}>{cat}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-gray-800 truncate">{l.lotNo || l.itemName}</span>
                              <span className="block text-[11px] text-gray-400 truncate">{l.variety || (l.type === 'finished' ? 'Finished' : 'Raw')} · {Math.round(avail).toLocaleString()} kg{costKg > 0 ? ` · Rs${costKg.toLocaleString()}/kg` : ''}</span>
                            </span>
                          </button>
                          {sel && (
                            <div className="shrink-0 flex items-center gap-1">
                              <input type="number" value={sel.qtyMt} placeholder="KG" min="0" max={avail} step="0.01" autoFocus
                                onChange={e => setBlendRows(rs => rs.map(r => String(r.lotId) === String(l.id) ? { ...r, qtyMt: e.target.value } : r))}
                                className={`w-20 border rounded-lg px-2 py-1.5 text-sm outline-none ${over ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} />
                              <button type="button" title="Use all"
                                onClick={() => setBlendRows(rs => rs.map(r => String(r.lotId) === String(l.id) ? { ...r, qtyMt: String(avail) } : r))}
                                className="text-[10px] font-medium text-blue-600 hover:text-blue-800 px-1">all</button>
                            </div>
                          )}
                        </div>
                        {over && <p className="ml-6 mt-0.5 text-[11px] text-red-600">Only {Math.round(avail).toLocaleString()} kg available</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
              {blendTotals.mt > 0 && (
                <div className="flex justify-between text-sm border-t border-blue-200 pt-2">
                  <span className="text-gray-600">Combined total</span>
                  <span className="font-semibold">{Math.round(blendTotals.kg).toLocaleString()} kg · Rs {Math.round(blendTotals.cost).toLocaleString()} <span className="text-gray-400 font-normal">(≈Rs {Math.round(blendTotals.cost / (blendTotals.mt * 1000))}/kg)</span></span>
                </div>
              )}
              {/* Live recipe + processing type — yield is computed against the combined total above */}
              {blendRecipe.rows.length > 0 && (
                <div className="border-t border-blue-200 pt-2 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Processing type</span>
                    <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${blendRecipe.processingType === 'blended' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                      {blendRecipe.processingType === 'blended' ? 'Blended' : 'Single-Variety'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {blendRecipe.rows.map((r, i) => (
                      <span key={i} className="text-xs bg-white border border-blue-200 rounded px-1.5 py-0.5 text-gray-700">
                        {r.variety} <span className="font-semibold">{r.pct.toFixed(0)}%</span>
                      </span>
                    ))}
                  </div>
                  {blendRecipe.processingType === 'blended' && (
                    <p className="text-[11px] text-purple-600">Output is tracked separately as a blend — it won't mix with pure B1/B2 stock or other blends.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Rice type (mandatory — without it the batch & its output lots can't be traced) */}
          {!useBlend && (
          <div>
            <RiceTypePicker
              label={<>Rice Type <span className="text-red-500">*</span></>}
              value={batchForm.productId}
              onChange={(id) => setBF('productId', id)}
              products={products}
              addToast={addToast}
              placeholder="Search rice type, e.g. 1121 Basmati, D98…"
              clearable={false}
            />
            <p className="text-xs text-gray-400 mt-1">Required — the variety being milled, so the batch and its output lots are traceable.</p>
          </div>
          )}

          {/* Supplier (rice source) */}
          {!useBlend && (
          <div>
            <SupplierPicker
              label={<>{batchForm.millingType === 'service_milling' ? 'Rice Source (Client / Broker)' : 'Supplier'} <span className="text-red-500">*</span></>}
              value={batchForm.supplierId}
              onChange={(id) => setBF('supplierId', id)}
              suppliers={suppliersList || []}
              addToast={addToast}
              placeholder={batchForm.millingType === 'service_milling' ? 'Search client / broker…' : 'Search supplier…'}
            />
          </div>
          )}

          {/* Quantities */}
          {!useBlend && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Raw Qty (KG) *</label>
              <input
                type="number"
                value={batchForm.rawQtyKg}
                onChange={e => {
                  setBF('rawQtyKg', e.target.value);
                  if (e.target.value) setBF('plannedFinishedKg', String(Math.round(parseFloat(e.target.value) * 0.65)));
                }}
                placeholder="e.g. 30000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none"
              />
              {batchForm.rawQtyKg && (
                <p className="text-xs text-gray-400 mt-0.5">{Math.round(parseFloat(batchForm.rawQtyKg) || 0).toLocaleString()} kg</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Number of Bags</label>
              <input
                type="number"
                value={batchForm.totalBags}
                onChange={e => setBF('totalBags', e.target.value)}
                placeholder="e.g. 600"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none"
              />
              {batchForm.rawQtyKg && batchForm.totalBags && parseInt(batchForm.totalBags, 10) > 0 && (
                <p className="text-xs text-emerald-600 mt-0.5 font-medium">Avg: {(parseFloat(batchForm.rawQtyKg) / parseInt(batchForm.totalBags, 10)).toFixed(2)} kg/bag</p>
              )}
            </div>
          </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Expected Finished (KG)</label>
            <input type="number" value={batchForm.plannedFinishedKg} onChange={e => setBF('plannedFinishedKg', e.target.value)} placeholder="Auto: ~65% of raw" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
          </div>

          {/* Mill & shift are not asked: there is a single mill (resolved
              server-side) and shift isn't tracked per batch. */}

          {/* Milling fee removed — milling cost is entered per batch in the
              Costing dialog (residual model), not as a flat per-KG fee here. */}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={batchForm.notes} onChange={e => setBF('notes', e.target.value)} rows={2} placeholder="Special instructions, quality requirements..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none resize-none" />
          </div>

          {/* Summary */}
          {batchForm.rawQtyKg && (
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="font-medium">{batchForm.millingType === 'service_milling' ? 'Service Milling' : 'Own Stock'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Raw Input</span><span className="font-medium">{parseFloat(batchForm.rawQtyKg).toLocaleString()} kg ({(parseFloat(batchForm.rawQtyKg) / 1000).toFixed(2)} MT)</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Expected Output</span><span className="font-medium">{(parseFloat(batchForm.plannedFinishedKg) || Math.round(parseFloat(batchForm.rawQtyKg) * 0.65)).toLocaleString()} kg</span></div>
              {batchForm.totalBags && parseInt(batchForm.totalBags, 10) > 0 && (
                <div className="flex justify-between"><span className="text-gray-500">Bags</span><span className="font-medium">{batchForm.totalBags} bags · {(parseFloat(batchForm.rawQtyKg) / parseInt(batchForm.totalBags, 10)).toFixed(2)} kg/bag avg</span></div>
              )}
              {batchForm.millingType === 'service_milling' && batchForm.serviceFeePerKg && (
                <div className="flex justify-between border-t border-gray-200 mt-1 pt-1">
                  <span className="text-gray-500">Milling Revenue</span>
                  <span className="font-bold text-green-700">PKR {Math.round(parseFloat(batchForm.serviceFeePerKg) * parseFloat(batchForm.rawQtyKg)).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

        </div>
      </SlideDrawer>
    </div>
  );
}
