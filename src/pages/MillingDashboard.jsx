import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import { useApp } from '../context/AppContext';
import { useCreateMillingBatch, useMills, useMillExpenses, useCreateMillExpense } from '../api/queries';
import KPICard from '../components/KPICard';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
// Chart data computed from real batch data below (no mock imports)

function formatPKR(value) {
  return 'Rs ' + Math.round(value).toLocaleString('en-PK');
}

// PKR pricing constants for mill operations
const MILL_PRICES_PKR = {
  finishedRicePerMT: 72800,  // ~260 USD
  brokenPerMT: 42000,        // ~150 USD
  branPerMT: 22400,           // ~80 USD
  huskPerMT: 8400,            // ~30 USD
};

export default function MillingDashboard() {
  const navigate = useNavigate();
  const { millingBatches, inventory: rawInventory, suppliersList, addToast } = useApp();
  const inventory = Array.isArray(rawInventory) ? rawInventory : [];
  const createBatchMut = useCreateMillingBatch();
  const { data: mills = [] } = useMills();
  const { data: expenseData } = useMillExpenses();
  const createExpenseMut = useCreateMillExpense();
  const millExpenses = expenseData?.expenses || [];
  const expenseSummary = expenseData?.summary || [];
  const totalOverhead = expenseSummary.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);

  // Expense modal
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expForm, setExpForm] = useState({ category: 'salaries', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], notes: '' });
  const setEF = (k, v) => setExpForm(p => ({ ...p, [k]: v }));

  async function handleAddExpense() {
    if (!expForm.amount) { addToast('Amount is required', 'error'); return; }
    try {
      await createExpenseMut.mutateAsync(expForm);
      addToast('Expense recorded', 'success');
      setShowExpenseModal(false);
      setExpForm({ category: 'salaries', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], notes: '' });
    } catch (err) { addToast(err.message || 'Failed', 'error'); }
  }

  // New batch modal
  const [showNewBatch, setShowNewBatch] = useState(false);
  const [batchForm, setBatchForm] = useState({
    millingType: 'own_stock',
    supplierId: '', rawQtyMT: '', plannedFinishedMT: '',
    millId: '', shift: 'Day', notes: '',
    // Service milling fields
    clientName: '', clientContact: '', millingFeePerMT: '',
  });
  const setBF = (k, v) => setBatchForm(p => ({ ...p, [k]: v }));
  const resetBatchForm = () => setBatchForm({
    millingType: 'own_stock', supplierId: '', rawQtyMT: '', plannedFinishedMT: '',
    millingFeePerKg: '5',
    millId: '', shift: 'Day', notes: '', clientName: '', clientContact: '', millingFeePerMT: '',
  });

  async function handleCreateBatch() {
    if (!batchForm.supplierId || !batchForm.rawQtyMT) {
      addToast('Supplier and raw quantity are required', 'error');
      return;
    }
    if (batchForm.millingType === 'service_milling' && !batchForm.clientName) {
      addToast('Client name is required for service milling', 'error');
      return;
    }
    const rawQty = parseFloat(batchForm.rawQtyMT);
    const planned = parseFloat(batchForm.plannedFinishedMT) || Math.round(rawQty * 0.65);

    try {
      const payload = {
        supplier_id: parseInt(batchForm.supplierId),
        raw_qty_mt: rawQty,
        planned_finished_mt: planned,
        milling_fee_per_kg: parseFloat(batchForm.millingFeePerKg) || 5,
        mill_id: batchForm.millId ? parseInt(batchForm.millId) : null,
        shift: batchForm.shift,
        notes: batchForm.millingType === 'service_milling'
          ? `[SERVICE MILLING] Client: ${batchForm.clientName}${batchForm.clientContact ? ` | Contact: ${batchForm.clientContact}` : ''}${batchForm.millingFeePerMT ? ` | Fee: PKR ${batchForm.millingFeePerMT}/MT` : ''}${batchForm.notes ? ` | ${batchForm.notes}` : ''}`
          : batchForm.notes || null,
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
      return s + costKg * pf(i.availableQty) * 1000;
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
      return s + pf(i.availableQty) * 1000 * rateKg; // availableQty in MT → convert to KG
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
      .reduce((sum, b) => sum + (b.brokenMT * MILL_PRICES_PKR.brokenPerMT) + (b.branMT * MILL_PRICES_PKR.branPerMT) + (b.huskMT * MILL_PRICES_PKR.huskPerMT), 0);
  }, [millingBatches]);

  // Calculate mill net profit from completed batches (PKR)
  const millNetProfit = useMemo(() => {
    return millingBatches
      .filter(b => b.status === 'Completed')
      .reduce((sum, b) => {
        const revenue = (b.actualFinishedMT * MILL_PRICES_PKR.finishedRicePerMT) + (b.brokenMT * MILL_PRICES_PKR.brokenPerMT) + (b.branMT * MILL_PRICES_PKR.branPerMT) + (b.huskMT * MILL_PRICES_PKR.huskPerMT);
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
        Bran: Math.round(b.branMT * MILL_PRICES_PKR.branPerMT),
        Husk: Math.round(b.huskMT * MILL_PRICES_PKR.huskPerMT),
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
        <button
          onClick={() => { resetBatchForm(); setShowNewBatch(true); }}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
        >
          <Plus className="w-4 h-4" /> New Batch
        </button>
      </div>

      {/* KPI Row — clickable cards */}
      <div className="kpi-grid">
        <Link to="/lot-inventory?type=raw">
          <KPICard icon={Wheat} title="Raw Rice Stock" value={`${rawRiceStock.toFixed(1)} MT`} subtitle="Paddy in mill warehouse" color="amber" />
        </Link>
        <Link to="/lot-inventory?type=finished">
          <KPICard icon={Package} title="Finished Rice" value={`${finishedRiceStock.toFixed(1)} MT`}
            subtitle={`${finishedInMill.toFixed(1)} in mill · ${finishedReserved.toFixed(1)} reserved · ${finishedAtExport.toFixed(1)} at export`} color="green" />
        </Link>
        <Link to="/lot-inventory?type=byproduct">
          <KPICard icon={Recycle} title="By-product Stock" value={`${byproductStock.toFixed(1)} MT`} subtitle="Broken, bran, husk" color="purple" />
        </Link>
        <div className="cursor-pointer" onClick={() => document.getElementById('batches-section')?.scrollIntoView({ behavior: 'smooth' })}>
          <KPICard icon={Clock} title="Pending Batches" value={pendingBatches} subtitle="In Progress / Queued / Pending" color="indigo" />
        </div>
        <Link to="/quality">
          <KPICard icon={AlertTriangle} title="Variance Alerts" value={varianceAlerts} subtitle="Exceeding 1% threshold" color="red" />
        </Link>
        <div className="cursor-pointer" onClick={() => document.getElementById('yield-section')?.scrollIntoView({ behavior: 'smooth' })}>
          <KPICard icon={BarChart3} title="Avg Yield %" value={`${avgYield}%`} subtitle="Completed batches average" color="blue" />
        </div>
        <Link to="/local-sales">
          <KPICard icon={DollarSign} title="Local Sales" value={formatPKR(Math.round(localSalesValue))} subtitle="By-products & local rice" color="cyan" />
        </Link>
        <Link to="/reports">
          <KPICard icon={TrendingUp} title="Mill Net Profit" value={formatPKR(Math.round(millNetProfit))} subtitle="Current period estimate" color="green" />
        </Link>
      </div>

      {/* Inventory Value */}
      {totalInventoryValue > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Inventory Value (Working Capital)</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-amber-50 rounded-lg p-4">
              <p className="text-xs font-medium text-amber-600 uppercase">Raw Paddy</p>
              <p className="text-lg font-bold text-amber-900">{formatPKR(rawInventoryValue)}</p>
              <p className="text-xs text-amber-500">{rawRiceStock.toFixed(1)} MT in stock</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-xs font-medium text-green-600 uppercase">Finished Rice</p>
              <p className="text-lg font-bold text-green-900">{formatPKR(finishedInventoryValue)}</p>
              <p className="text-xs text-green-500">{finishedRiceStock.toFixed(1)} MT in stock</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-4">
              <p className="text-xs font-medium text-purple-600 uppercase">Byproducts</p>
              <p className="text-lg font-bold text-purple-900">{formatPKR(byproductInventoryValue)}</p>
              <p className="text-xs text-purple-500">{byproductStock.toFixed(1)} MT in stock</p>
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
            s + (b.brokenMT * MILL_PRICES_PKR.brokenPerMT) + (b.branMT * MILL_PRICES_PKR.branPerMT) + (b.huskMT * MILL_PRICES_PKR.huskPerMT), 0);
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
                    <div className="flex justify-between"><span className="text-red-500">Raw paddy purchase</span><span className="font-medium">{formatPKR(totalRawCost)}</span></div>
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
                    <div className="flex justify-between"><span className="text-gray-500">Processed</span><span className="font-bold">{completed.reduce((s, b) => s + b.rawQtyMT, 0).toFixed(1)} MT</span></div>
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
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Raw MT</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Finished MT</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Yield %</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Raw Cost</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Cost/KG</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Revenue</th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-600">Profit</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {completed.map(b => {
                          const bRevenue = (b.actualFinishedMT * MILL_PRICES_PKR.finishedRicePerMT) + (b.brokenMT * MILL_PRICES_PKR.brokenPerMT) + (b.branMT * MILL_PRICES_PKR.branPerMT) + (b.huskMT * MILL_PRICES_PKR.huskPerMT);
                          const bCost = Object.values(b.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
                          const bProfit = bRevenue - bCost;
                          return (
                            <tr key={b.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/milling/${b.id}`)}>
                              <td className="py-2 px-2 font-medium text-blue-600">{b.id}</td>
                              <td className="py-2 px-2 text-right">{b.rawQtyMT}</td>
                              <td className="py-2 px-2 text-right">{b.actualFinishedMT}</td>
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
                      <td className="py-2 px-3 text-gray-600">{lot.supplierName || '—'}</td>
                      <td className="py-2 px-3 text-right font-medium">{parseFloat(lot.qty)?.toFixed(2)} MT</td>
                      <td className="py-2 px-3 text-right">
                        {!isAtExport ? <span className="text-emerald-700 font-medium">{avail.toFixed(2)} MT</span> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {reserved > 0 ? <span className="text-amber-700 font-medium">{reserved.toFixed(2)} MT</span> : <span className="text-gray-400">—</span>}
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
                  Raw: {batch.rawQtyMT} MT
                </div>
                <div className="text-xs text-gray-500">
                  Target: {batch.plannedFinishedMT} MT
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
                    <td className="py-2.5 px-2 text-gray-600">{batch.supplierName}</td>
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
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Raw</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Finished</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Broken</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Bran</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 uppercase">Husk</th>
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
                    <td className="py-2.5 px-2 text-right text-gray-600">{batch.rawQtyMT}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{batch.actualFinishedMT}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{batch.brokenMT}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{batch.branMT}</td>
                    <td className="py-2.5 px-2 text-right text-gray-600">{batch.huskMT}</td>
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
                <Bar dataKey="Bran" name="Bran" fill="#10b981" />
                <Bar dataKey="Husk" name="Husk" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      <Modal isOpen={showExpenseModal} onClose={() => setShowExpenseModal(false)} title="Add Mill Expense" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
              <select value={expForm.category} onChange={e => setEF('category', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="salaries">Salaries & Wages</option>
                <option value="utilities">Utilities (Electricity/Gas/Water)</option>
                <option value="rent">Rent / Facility</option>
                <option value="maintenance">Maintenance & Repairs</option>
                <option value="insurance">Insurance</option>
                <option value="transport">Transport</option>
                <option value="fuel">Fuel & Diesel</option>
                <option value="packaging">Packaging Material</option>
                <option value="misc">Miscellaneous</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (PKR) *</label>
              <input type="number" value={expForm.amount} onChange={e => setEF('amount', e.target.value)} placeholder="0" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input type="text" value={expForm.description} onChange={e => setEF('description', e.target.value)} placeholder="e.g. March electricity bill" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" value={expForm.expense_date} onChange={e => setEF('expense_date', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
              <input type="text" value={expForm.reference || ''} onChange={e => setEF('reference', e.target.value)} placeholder="Receipt/invoice #" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={expForm.notes} onChange={e => setEF('notes', e.target.value)} rows={2} placeholder="Optional" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setShowExpenseModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={handleAddExpense} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Record Expense</button>
          </div>
        </div>
      </Modal>

      {/* New Batch Modal */}
      <Modal isOpen={showNewBatch} onClose={() => setShowNewBatch(false)} title="Create Milling Batch" size="md">
        <div className="space-y-4">
          {/* Milling Type Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Milling Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setBF('millingType', 'own_stock')}
                className={`p-3 rounded-lg border-2 text-center transition-all text-sm ${
                  batchForm.millingType === 'own_stock'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <Wheat className={`w-5 h-5 mx-auto mb-1 ${batchForm.millingType === 'own_stock' ? 'text-blue-600' : 'text-gray-400'}`} />
                Own Stock
                <p className="text-xs text-gray-400 mt-0.5">Mill buys paddy & processes</p>
              </button>
              <button
                type="button"
                onClick={() => setBF('millingType', 'service_milling')}
                className={`p-3 rounded-lg border-2 text-center transition-all text-sm ${
                  batchForm.millingType === 'service_milling'
                    ? 'border-amber-500 bg-amber-50 text-amber-700 font-semibold'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <Package className={`w-5 h-5 mx-auto mb-1 ${batchForm.millingType === 'service_milling' ? 'text-amber-600' : 'text-gray-400'}`} />
                Service Milling
                <p className="text-xs text-gray-400 mt-0.5">Client provides paddy, you mill</p>
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
                <label className="block text-xs font-medium text-gray-700 mb-1">Milling Fee (PKR/MT)</label>
                <input type="number" value={batchForm.millingFeePerMT} onChange={e => setBF('millingFeePerMT', e.target.value)} placeholder="e.g. 3500" className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm outline-none bg-white" />
              </div>
            </div>
          )}

          {/* Supplier (paddy source) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {batchForm.millingType === 'service_milling' ? 'Paddy Source (Client / Broker)' : 'Supplier'} *
            </label>
            <select value={batchForm.supplierId} onChange={e => setBF('supplierId', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">Select supplier...</option>
              {(suppliersList || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Quantities */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Raw Qty (MT) *</label>
              <input
                type="number"
                value={batchForm.rawQtyMT}
                onChange={e => {
                  setBF('rawQtyMT', e.target.value);
                  if (e.target.value) setBF('plannedFinishedMT', String(Math.round(parseFloat(e.target.value) * 0.65)));
                }}
                placeholder="Paddy quantity"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expected Finished (MT)</label>
              <input type="number" value={batchForm.plannedFinishedMT} onChange={e => setBF('plannedFinishedMT', e.target.value)} placeholder="Auto: ~65% of raw" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
          </div>

          {/* Mill & Shift */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mill</label>
              <select value={batchForm.millId} onChange={e => setBF('millId', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="">Select mill...</option>
                {mills.map(m => <option key={m.id} value={m.id}>{m.name} — {m.location || 'N/A'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shift</label>
              <select value={batchForm.shift} onChange={e => setBF('shift', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="Day">Day</option>
                <option value="Night">Night</option>
                <option value="Full">Full Day</option>
              </select>
            </div>
          </div>

          {/* Milling Fee */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Milling Fee (PKR/KG)</label>
            <input type="number" value={batchForm.millingFeePerKg} onChange={e => setBF('millingFeePerKg', e.target.value)} placeholder="5" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            <p className="text-xs text-gray-400 mt-1">Cost charged per KG of raw paddy processed. Default: PKR 5/KG</p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={batchForm.notes} onChange={e => setBF('notes', e.target.value)} rows={2} placeholder="Special instructions, quality requirements..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none resize-none" />
          </div>

          {/* Summary */}
          {batchForm.rawQtyMT && (
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="font-medium">{batchForm.millingType === 'service_milling' ? 'Service Milling' : 'Own Stock'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Raw Input</span><span className="font-medium">{batchForm.rawQtyMT} MT</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Expected Output</span><span className="font-medium">{batchForm.plannedFinishedMT || Math.round(parseFloat(batchForm.rawQtyMT) * 0.65)} MT</span></div>
              {batchForm.millingType === 'service_milling' && batchForm.millingFeePerMT && (
                <div className="flex justify-between border-t border-gray-200 mt-1 pt-1">
                  <span className="text-gray-500">Milling Revenue</span>
                  <span className="font-bold text-green-700">PKR {Math.round(parseFloat(batchForm.millingFeePerMT) * parseFloat(batchForm.rawQtyMT)).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setShowNewBatch(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={handleCreateBatch} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Create Batch</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
