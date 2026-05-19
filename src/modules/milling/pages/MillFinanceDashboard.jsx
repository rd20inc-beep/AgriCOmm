import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign, Users, Zap, Shield, TrendingUp, TrendingDown, AlertTriangle,
  Plus, UserPlus, Package, Factory, Wallet, ArrowUpRight, ArrowDownRight, Printer,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import {
  useMillExpenses, useCreateMillExpense, useMillWorkers, useCreateMillWorker,
  usePayrollSummary, useRecordAttendance, useInventory, useExpenseVendors,
} from '../../../api/queries';
import { useCommodityPrices } from '../hooks/useCommodityPrices';
import SlideDrawer from '../../../components/SlideDrawer';

const PKR = (v) => 'Rs ' + Math.round(v || 0).toLocaleString('en-PK');
const COMPACT_PKR = (v) => {
  const n = Math.round(v || 0);
  if (Math.abs(n) >= 10000000) return `Rs ${(n / 10000000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100000) return `Rs ${(n / 100000).toFixed(2)}L`;
  if (Math.abs(n) >= 1000) return `Rs ${(n / 1000).toFixed(1)}k`;
  return `Rs ${n.toLocaleString('en-PK')}`;
};

const EXPENSE_CATS = [
  'salaries', 'utilities', 'rent', 'maintenance', 'insurance',
  'transport', 'fuel', 'packaging', 'inspection', 'freight',
  'commission', 'miscellaneous',
];
const WORKER_ROLES = ['operator', 'laborer', 'supervisor', 'driver', 'guard', 'cleaner'];
// VENDOR_OPTIONS used to be a hardcoded map here. It now lives in the
// `expense_vendors` table and is managed via Admin → Expense Vendors.
// The component fetches it through useExpenseVendors() below.

const tabs = [
  { key: 'overview',   label: 'Overview',     icon: DollarSign },
  { key: 'expenses',   label: 'Expenses',     icon: TrendingDown },
  { key: 'efficiency', label: 'Efficiency',   icon: TrendingUp },
  { key: 'loss',       label: 'Loss & Theft', icon: Shield },
  { key: 'payroll',    label: 'Payroll',      icon: Users },
  { key: 'utilities',  label: 'Utilities',    icon: Zap },
];

function Stat({ label, value, sub, tone = 'slate', icon: Icon }) {
  const tones = {
    slate:  'bg-white border-gray-100',
    blue:   'bg-blue-50/40 border-blue-100',
    green:  'bg-emerald-50/40 border-emerald-100',
    red:    'bg-red-50/40 border-red-100',
    amber:  'bg-amber-50/40 border-amber-100',
    purple: 'bg-purple-50/40 border-purple-100',
  };
  const iconTones = {
    slate:  'text-gray-400',
    blue:   'text-blue-500',
    green:  'text-emerald-500',
    red:    'text-red-500',
    amber:  'text-amber-500',
    purple: 'text-purple-500',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        {Icon && <Icon size={14} className={iconTones[tone]} />}
      </div>
      <p className="text-xl font-semibold text-gray-900 mt-1.5 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-1 truncate">{sub}</p>}
    </div>
  );
}

export default function MillFinanceDashboard() {
  const { millingBatches, addToast } = useApp();
  const cp = useCommodityPrices();
  const DEFAULT_PRICES = { finished: cp.finished, broken: cp.broken, bran: cp.bran, husk: cp.husk };
  const batchPrice = (b, product) => b[`${product}PricePerMT`] || DEFAULT_PRICES[product];
  const { data: directInventory = [] } = useInventory({});
  const inventory = Array.isArray(directInventory) ? directInventory : [];
  const pf = (v) => parseFloat(v) || 0;

  const inventoryValue = useMemo(() => {
    let raw = 0, fin = 0, bp = 0;
    for (const lot of inventory) {
      const qty = pf(lot.availableQty || lot.qty);
      const netKg = pf(lot.netWeightKg) || qty * 1000;
      const costKg = pf(lot.landedCostPerKg) || pf(lot.ratePerKg);
      if (lot.type === 'raw')       raw += (costKg || 150) * netKg;
      else if (lot.type === 'finished')  fin += (costKg || 190) * qty * 1000;
      else if (lot.type === 'byproduct') {
        const name = (lot.itemName || '').toLowerCase();
        const rate = name.includes('broken') ? 38 : name.includes('bran') ? 28 : 8.4;
        bp += (costKg || rate) * qty * 1000;
      }
    }
    return { raw, fin, bp, total: raw + fin + bp };
  }, [inventory]);

  const { data: vendorData } = useExpenseVendors();
  // category → [{ id, name, ... }] for the Provider dropdown
  const VENDOR_OPTIONS = useMemo(() => {
    const map = {};
    const byCat = vendorData?.byCategory || {};
    for (const cat of Object.keys(byCat)) {
      map[cat] = (byCat[cat] || []).map((v) => v.name);
    }
    return map;
  }, [vendorData]);

  const { data: expData } = useMillExpenses();
  const createExpMut = useCreateMillExpense();
  const { data: workers = [] } = useMillWorkers();
  const createWorkerMut = useCreateMillWorker();
  const curMonth = new Date().toISOString().slice(0, 7);
  const { data: payrollData } = usePayrollSummary({ month: curMonth });
  const recordAttMut = useRecordAttendance();

  const expenses = expData?.expenses || [];
  const expSummary = expData?.summary || [];
  const totalOverhead = expSummary.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
  const payrollSummary = payrollData?.summary || [];
  const payrollTotal = payrollData?.grandTotal || 0;

  const [activeTab, setActiveTab] = useState('overview');
  const [showExpDrawer, setShowExpDrawer] = useState(false);
  const [showWorkerDrawer, setShowWorkerDrawer] = useState(false);
  const [expForm, setExpForm] = useState({ category: 'salaries', vendor_preset: '', vendor_name: '', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], reference: '', notes: '' });
  const [workerForm, setWorkerForm] = useState({ name: '', role: 'laborer', daily_wage: '', phone: '' });

  const completed = useMemo(() => millingBatches.filter(b => b.status === 'Completed'), [millingBatches]);

  const RAW_KEYS = new Set(['rawRice', 'raw_rice', 'rawrice']);
  const getRawCost = (costs) => {
    if (!costs) return 0;
    for (const [k, v] of Object.entries(costs)) {
      if (RAW_KEYS.has(k)) return parseFloat(v) || 0;
    }
    return 0;
  };

  const kpis = useMemo(() => {
    const totalRaw = completed.reduce((s, b) => s + getRawCost(b.costs), 0);
    const totalOtherCosts = completed.reduce((s, b) => {
      return s + Object.entries(b.costs || {}).reduce((cs, [k, v]) => RAW_KEYS.has(k) ? cs : cs + (parseFloat(v) || 0), 0);
    }, 0);
    const finishedRev = completed.reduce((s, b) => s + b.actualFinishedMT * batchPrice(b, 'finished'), 0);
    const byproductRev = completed.reduce((s, b) =>
      s + b.brokenMT * batchPrice(b, 'broken') + b.branMT * batchPrice(b, 'bran') + b.huskMT * batchPrice(b, 'husk'), 0);
    const totalRev = finishedRev + byproductRev;
    const totalCost = totalRaw + totalOtherCosts + totalOverhead;
    const totalFinishedKg = completed.reduce((s, b) => s + b.actualFinishedMT * 1000, 0);
    const costPerKg = totalFinishedKg > 0 ? totalCost / totalFinishedKg : 0;
    return { totalRev, totalRaw, totalOtherCosts, totalCost, netProfit: totalRev - totalCost, costPerKg, finishedRev, byproductRev };
  }, [completed, totalOverhead]);

  const efficiency = useMemo(() => {
    if (completed.length === 0) return { avgYield: 0, avgWastage: 0, costPerKg: 0 };
    const totalRaw = completed.reduce((s, b) => s + b.rawQtyMT, 0);
    const totalFinished = completed.reduce((s, b) => s + b.actualFinishedMT, 0);
    const totalWastage = completed.reduce((s, b) => s + (b.wastageMT || 0), 0);
    return {
      avgYield: totalRaw > 0 ? (totalFinished / totalRaw * 100).toFixed(1) : 0,
      avgWastage: totalRaw > 0 ? (totalWastage / totalRaw * 100).toFixed(1) : 0,
      costPerKg: kpis.costPerKg.toFixed(2),
      totalRaw, totalFinished, totalWastage,
    };
  }, [completed, kpis]);

  const lossData = useMemo(() => {
    return completed.map(b => {
      const expected = b.plannedFinishedMT || b.rawQtyMT * 0.65;
      const actual = b.actualFinishedMT;
      const variance = actual - expected;
      const variancePct = expected > 0 ? (variance / expected * 100).toFixed(1) : 0;
      const flagged = parseFloat(variancePct) < -3;
      return { ...b, expected, variance, variancePct, flagged };
    }).sort((a, b) => a.variancePct - b.variancePct);
  }, [completed]);

  const margin = kpis.totalRev > 0 ? (kpis.netProfit / kpis.totalRev * 100).toFixed(1) : 0;

  function openExpDrawer(prefill) {
    setExpForm({
      category: prefill?.category || 'salaries',
      vendor_preset: '',
      vendor_name: '',
      description: prefill?.description || '',
      amount: prefill?.amount != null ? String(prefill.amount) : '',
      expense_date: new Date().toISOString().split('T')[0],
      reference: '',
      notes: '',
    });
    setShowExpDrawer(true);
  }

  async function handleAddExpense() {
    if (!expForm.amount) { addToast('Amount required', 'error'); return; }
    // Resolve the vendor: preset wins unless "Other" is picked or the
    // category has no presets, in which case fall back to free-text.
    const vendorName = (expForm.vendor_preset && expForm.vendor_preset !== '__other')
      ? expForm.vendor_preset
      : (expForm.vendor_name || null);
    try {
      await createExpMut.mutateAsync({
        category: expForm.category,
        description: expForm.description,
        amount: expForm.amount,
        expense_date: expForm.expense_date,
        reference: expForm.reference,
        notes: expForm.notes,
        vendor_name: vendorName,
      });
      addToast('Expense recorded — also visible on Finance dashboard', 'success');
      setShowExpDrawer(false);
    } catch (e) {
      addToast(e.message, 'error');
    }
  }

  async function handleAddWorker() {
    if (!workerForm.name || !workerForm.daily_wage) {
      addToast('Name and wage required', 'error');
      return;
    }
    try {
      await createWorkerMut.mutateAsync(workerForm);
      addToast('Worker added', 'success');
      setShowWorkerDrawer(false);
      setWorkerForm({ name: '', role: 'laborer', daily_wage: '', phone: '' });
    } catch (e) {
      addToast(e.message, 'error');
    }
  }

  function handlePrint() {
    // Same mask pattern as FinanceLayout — toggle body.app-print-mask
    // so the global @media print rule unhides only .print-report.
    document.body.classList.add('app-print-mask');
    const cleanup = () => {
      document.body.classList.remove('app-print-mask');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 60_000);
    window.print();
  }

  return (
    <div className="space-y-5 pb-4 print-report">
      {/* ─── HERO BAND ─────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-900 to-blue-700 p-5 sm:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-80 mb-1">
              <Factory size={13} /> Mill finance · {curMonth}
            </div>
            <div className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
              {COMPACT_PKR(kpis.netProfit)}
            </div>
            <div className="text-xs opacity-90 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                {kpis.netProfit >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                Net profit · margin {margin}%
              </span>
              <span className="opacity-70">·</span>
              <span>{completed.length} completed batches</span>
              <span className="opacity-70">·</span>
              <span>Revenue {COMPACT_PKR(kpis.totalRev)}</span>
              <span className="opacity-70">·</span>
              <span>Cost {COMPACT_PKR(kpis.totalCost)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors"
              title="Print this dashboard"
            >
              <Printer size={13} /> Print
            </button>
            <button
              onClick={() => openExpDrawer()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors"
            >
              <Plus size={13} /> Add Expense
            </button>
            <button
              onClick={() => setShowWorkerDrawer(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors"
            >
              <UserPlus size={13} /> Add Worker
            </button>
            <Link
              to="/finance"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <Wallet size={13} /> Finance Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* ─── TABS ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ─── OVERVIEW ──────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Top KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat tone="blue"   icon={TrendingUp}   label="Revenue"        value={PKR(kpis.totalRev)}   sub={`Finished ${COMPACT_PKR(kpis.finishedRev)}`} />
            <Stat tone="red"    icon={TrendingDown} label="Raw Material"   value={PKR(kpis.totalRaw)}   sub="Rice purchase" />
            <Stat tone="amber"  icon={DollarSign}   label="Operating"      value={PKR(kpis.totalOtherCosts + totalOverhead)} sub={`Batch ${COMPACT_PKR(kpis.totalOtherCosts)} · OH ${COMPACT_PKR(totalOverhead)}`} />
            <Stat tone={kpis.netProfit >= 0 ? 'green' : 'red'} icon={TrendingUp} label="Net Profit" value={PKR(kpis.netProfit)} sub={`Margin ${margin}%`} />
            <Stat tone="slate"  icon={DollarSign}   label="Cost/kg"        value={`Rs ${kpis.costPerKg.toFixed(2)}`} sub="All-in" />
            <Stat tone="purple" icon={Package}      label="Inventory"      value={PKR(inventoryValue.total)} sub={`Raw ${COMPACT_PKR(inventoryValue.raw)}`} />
          </div>

          {/* Inventory breakdown */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat tone="amber"  label="Raw Rice"      value={PKR(inventoryValue.raw)} sub={`${inventory.filter(i => i.type === 'raw').reduce((s, i) => s + pf(i.qty), 0).toFixed(1)} MT`} />
            <Stat tone="green"  label="Finished Rice" value={PKR(inventoryValue.fin)} sub={`${inventory.filter(i => i.type === 'finished').reduce((s, i) => s + pf(i.availableQty), 0).toFixed(1)} MT`} />
            <Stat tone="purple" label="Byproducts"    value={PKR(inventoryValue.bp)}  sub={`${inventory.filter(i => i.type === 'byproduct').reduce((s, i) => s + pf(i.availableQty), 0).toFixed(1)} MT`} />
            <Stat tone="blue"   label="Working Cap."  value={PKR(inventoryValue.total)} sub="Locked in stock" />
          </div>

          {/* Expense breakdown + Payroll summary */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">Expense Breakdown</h3>
                <span className="text-xs text-gray-400">Total {COMPACT_PKR(totalOverhead)}</span>
              </div>
              <div className="space-y-2">
                {expSummary.length === 0 ? (
                  <p className="text-sm text-gray-400">No expenses recorded yet. Click <span className="font-medium text-gray-600">Add Expense</span> on the header.</p>
                ) : (
                  expSummary.map(e => {
                    const pct = totalOverhead > 0 ? (parseFloat(e.total) / totalOverhead * 100) : 0;
                    return (
                      <div key={e.category}>
                        <div className="flex items-center justify-between text-sm mb-0.5">
                          <span className="capitalize text-gray-700">{e.category}</span>
                          <span className="font-medium text-gray-900 tabular-nums">{PKR(parseFloat(e.total))}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${pct.toFixed(1)}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">Payroll · {curMonth}</h3>
                <span className="text-xs text-gray-400">{payrollSummary.length} workers</span>
              </div>
              {payrollSummary.length === 0 ? (
                <p className="text-sm text-gray-400">No workers added yet.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm pb-2 border-b border-gray-100">
                    <span className="text-gray-600">Monthly total</span>
                    <span className="font-semibold text-gray-900">{PKR(payrollTotal)}</span>
                  </div>
                  {payrollSummary.slice(0, 5).map(w => (
                    <div key={w.id} className="flex justify-between text-xs text-gray-500">
                      <span>{w.name} <span className="text-gray-400">({w.effectiveDays}d)</span></span>
                      <span className="tabular-nums">{PKR(w.totalPay)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── EXPENSES ──────────────────────────────────────────────── */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              All mill expenses flow into the main Finance dashboard, Money Out, and GL.
            </p>
            <button onClick={() => openExpDrawer()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700">
              <Plus className="w-3.5 h-3.5" /> Add Expense
            </button>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Category</th>
                  <th className="text-left px-4 py-3 font-medium">Description</th>
                  <th className="text-left px-4 py-3 font-medium">Reference</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{e.expenseDate}</td>
                    <td className="px-4 py-3 capitalize">{e.category}</td>
                    <td className="px-4 py-3 text-gray-600">{e.description || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{e.reference || e.invoiceReference || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${(e.paymentStatus === 'Paid') ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {e.paymentStatus || 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{PKR(parseFloat(e.amount))}</td>
                  </tr>
                ))}
                {expenses.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No expenses recorded yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── EFFICIENCY ────────────────────────────────────────────── */}
      {activeTab === 'efficiency' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat tone="green" icon={TrendingUp}    label="Avg Recovery"  value={`${efficiency.avgYield}%`}    sub="Finished / Raw" />
            <Stat tone="red"   icon={AlertTriangle} label="Avg Wastage"   value={`${efficiency.avgWastage}%`}  sub="Waste / Raw" />
            <Stat tone="blue"  icon={DollarSign}    label="Cost per KG"   value={`Rs ${efficiency.costPerKg}`} sub="All-in finished" />
            <Stat tone="slate" icon={Factory}       label="Batches"       value={completed.length}             sub={`${efficiency.totalRaw?.toFixed(0) || 0} MT processed`} />
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Batch</th>
                  <th className="text-right px-4 py-3 font-medium">Raw MT</th>
                  <th className="text-right px-4 py-3 font-medium">Finished MT</th>
                  <th className="text-right px-4 py-3 font-medium">Yield %</th>
                  <th className="text-right px-4 py-3 font-medium">Wastage %</th>
                  <th className="text-right px-4 py-3 font-medium">Cost/KG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {completed.map(b => {
                  const totalCost = Object.values(b.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
                  const costKg = b.actualFinishedMT > 0 ? totalCost / (b.actualFinishedMT * 1000) : 0;
                  const wastePct = b.rawQtyMT > 0 ? ((b.wastageMT || 0) / b.rawQtyMT * 100).toFixed(1) : 0;
                  return (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium"><Link to={`/milling/${b.id}`} className="text-blue-600">{b.id}</Link></td>
                      <td className="px-4 py-3 text-right tabular-nums">{b.rawQtyMT}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{b.actualFinishedMT}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{b.yieldPct}%</td>
                      <td className="px-4 py-3 text-right text-red-600 tabular-nums">{wastePct}%</td>
                      <td className="px-4 py-3 text-right tabular-nums">Rs {costKg.toFixed(2)}</td>
                    </tr>
                  );
                })}
                {completed.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No completed batches yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── LOSS & THEFT ──────────────────────────────────────────── */}
      {activeTab === 'loss' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2">
            <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Batches flagged when actual output is more than 3% below expected. May indicate loss, theft, or measurement errors.</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Batch</th>
                  <th className="text-right px-4 py-3 font-medium">Raw MT</th>
                  <th className="text-right px-4 py-3 font-medium">Expected</th>
                  <th className="text-right px-4 py-3 font-medium">Actual</th>
                  <th className="text-right px-4 py-3 font-medium">Var MT</th>
                  <th className="text-right px-4 py-3 font-medium">Var %</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lossData.map(b => (
                  <tr key={b.id} className={`hover:bg-gray-50 ${b.flagged ? 'bg-red-50/50' : ''}`}>
                    <td className="px-4 py-3 font-medium"><Link to={`/milling/${b.id}`} className="text-blue-600">{b.id}</Link></td>
                    <td className="px-4 py-3 text-right tabular-nums">{b.rawQtyMT}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{b.expected.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{b.actualFinishedMT}</td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${b.variance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{b.variance > 0 ? '+' : ''}{b.variance.toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${parseFloat(b.variancePct) < -3 ? 'text-red-600' : 'text-gray-600'}`}>{b.variancePct}%</td>
                    <td className="px-4 py-3 text-center">
                      {b.flagged
                        ? <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[11px] font-medium">Investigate</span>
                        : <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[11px] font-medium">Normal</span>}
                    </td>
                  </tr>
                ))}
                {lossData.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No completed batches yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── PAYROLL ───────────────────────────────────────────────── */}
      {activeTab === 'payroll' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Workers, attendance, and monthly payroll runs.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => openExpDrawer({ category: 'salaries', amount: Math.round(payrollTotal || 0), description: `Mill payroll for ${curMonth}` })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                disabled={!payrollTotal}
              >
                <Wallet className="w-3.5 h-3.5" /> Post Payroll Run
              </button>
              <button onClick={() => setShowWorkerDrawer(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700">
                <UserPlus className="w-3.5 h-3.5" /> Add Worker
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Stat tone="blue"  icon={Users}      label="Active Workers" value={payrollSummary.length} sub="On payroll" />
            <Stat tone="red"   icon={DollarSign} label="Monthly Payroll" value={PKR(payrollTotal)} sub={curMonth} />
            <Stat tone="slate" icon={DollarSign} label="Avg Daily Wage"  value={PKR(payrollSummary.length > 0 ? payrollSummary.reduce((s, w) => s + parseFloat(w.dailyWage || 0), 0) / payrollSummary.length : 0)} sub="Per worker" />
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-right px-4 py-3 font-medium">Daily Wage</th>
                  <th className="text-right px-4 py-3 font-medium">Days</th>
                  <th className="text-right px-4 py-3 font-medium">OT Hours</th>
                  <th className="text-right px-4 py-3 font-medium">Basic</th>
                  <th className="text-right px-4 py-3 font-medium">OT Pay</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payrollSummary.map(w => (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{w.name}</td>
                    <td className="px-4 py-3 capitalize text-gray-600">{w.role}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{PKR(parseFloat(w.dailyWage))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{w.effectiveDays}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{w.totalOT || 0}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{PKR(w.basicPay)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{PKR(w.otPay)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{PKR(w.totalPay)}</td>
                  </tr>
                ))}
                {payrollSummary.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No workers added yet</td></tr>
                )}
                {payrollSummary.length > 0 && (
                  <tr className="bg-gray-50 font-semibold">
                    <td colSpan={7} className="px-4 py-3 text-right">Grand Total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{PKR(payrollTotal)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── UTILITIES ─────────────────────────────────────────────── */}
      {activeTab === 'utilities' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 flex items-start gap-2">
            <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Track electricity, water, gas, and diesel via the <span className="font-medium">Add Expense</span> action.</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {['utilities', 'fuel', 'maintenance', 'rent'].map(cat => {
              const catTotal = expenses.filter(e => e.category === cat).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
              return <Stat key={cat} tone="blue" icon={Zap} label={cat.charAt(0).toUpperCase() + cat.slice(1)} value={PKR(catTotal)} sub="Total recorded" />;
            })}
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Category</th>
                  <th className="text-left px-4 py-3 font-medium">Description</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.filter(e => ['utilities', 'fuel', 'maintenance', 'rent'].includes(e.category)).map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{e.expenseDate}</td>
                    <td className="px-4 py-3 capitalize">{e.category}</td>
                    <td className="px-4 py-3 text-gray-600">{e.description || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{PKR(parseFloat(e.amount))}</td>
                  </tr>
                ))}
                {expenses.filter(e => ['utilities', 'fuel', 'maintenance', 'rent'].includes(e.category)).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">No utility expenses recorded</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── ADD EXPENSE DRAWER ────────────────────────────────────── */}
      <SlideDrawer
        open={showExpDrawer}
        onClose={() => setShowExpDrawer(false)}
        title="Add Mill Expense"
        subtitle="Flows into Finance Dashboard, Money Out, and GL"
        icon={TrendingDown}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowExpDrawer(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button
              onClick={handleAddExpense}
              disabled={createExpMut.isPending}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {createExpMut.isPending ? 'Saving…' : 'Save Expense'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category *</label>
              <select
                value={expForm.category}
                onChange={e => setExpForm(p => ({ ...p, category: e.target.value, vendor_preset: '', vendor_name: '' }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
              >
                {EXPENSE_CATS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount (PKR) *</label>
              <input
                type="number" min="0" step="0.01"
                value={expForm.amount}
                onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums"
              />
            </div>
          </div>

          {/* ─── Provider / Vendor — dynamic per category ───────── */}
          {VENDOR_OPTIONS[expForm.category] ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-600">
                Provider <span className="text-gray-400 font-normal">· choose from common {expForm.category} providers</span>
              </label>
              <select
                value={expForm.vendor_preset}
                onChange={e => setExpForm(p => ({ ...p, vendor_preset: e.target.value, vendor_name: '' }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
              >
                <option value="">Select a provider…</option>
                {VENDOR_OPTIONS[expForm.category].map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
                <option value="__other">Other (specify below)</option>
              </select>
              {expForm.vendor_preset === '__other' && (
                <input
                  type="text"
                  value={expForm.vendor_name}
                  onChange={e => setExpForm(p => ({ ...p, vendor_name: e.target.value }))}
                  placeholder="Enter provider name"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
                  autoFocus
                />
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Vendor / Payee <span className="text-gray-400 font-normal">· optional</span></label>
              <input
                type="text"
                value={expForm.vendor_name}
                onChange={e => setExpForm(p => ({ ...p, vendor_name: e.target.value }))}
                placeholder={expForm.category === 'salaries' ? 'e.g. May payroll batch' : 'Who is being paid?'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input
              type="text"
              value={expForm.description}
              onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))}
              placeholder="e.g. March electricity bill"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input
                type="date"
                value={expForm.expense_date}
                onChange={e => setExpForm(p => ({ ...p, expense_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reference</label>
              <input
                type="text"
                value={expForm.reference}
                onChange={e => setExpForm(p => ({ ...p, reference: e.target.value }))}
                placeholder="Invoice or bill #"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              rows={2}
              value={expForm.notes}
              onChange={e => setExpForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
            />
          </div>
          <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
            Saving creates a <span className="font-medium">business_expense</span> + <span className="font-medium">payable</span> + journal entry. The expense becomes payable on Money Out.
          </div>
        </div>
      </SlideDrawer>

      {/* ─── ADD WORKER DRAWER ─────────────────────────────────────── */}
      <SlideDrawer
        open={showWorkerDrawer}
        onClose={() => setShowWorkerDrawer(false)}
        title="Add Mill Worker"
        subtitle="Used for daily attendance and monthly payroll"
        icon={UserPlus}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowWorkerDrawer(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button
              onClick={handleAddWorker}
              disabled={createWorkerMut.isPending}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {createWorkerMut.isPending ? 'Saving…' : 'Add Worker'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input
                type="text"
                value={workerForm.name}
                onChange={e => setWorkerForm(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <select
                value={workerForm.role}
                onChange={e => setWorkerForm(p => ({ ...p, role: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 bg-white"
              >
                {WORKER_ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Daily Wage (PKR) *</label>
              <input
                type="number" min="0"
                value={workerForm.daily_wage}
                onChange={e => setWorkerForm(p => ({ ...p, daily_wage: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input
                type="text"
                value={workerForm.phone}
                onChange={e => setWorkerForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
              />
            </div>
          </div>
        </div>
      </SlideDrawer>
    </div>
  );
}
