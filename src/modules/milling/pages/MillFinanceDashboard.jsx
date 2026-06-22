import { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  DollarSign, Users, Zap, Shield, TrendingUp, TrendingDown, AlertTriangle,
  Plus, UserPlus, Package, Factory, Wallet, ArrowUpRight, ArrowDownRight, Printer,
  Building2, Banknote, Receipt, Layers, Truck, ExternalLink,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import {
  useMillExpenses, useCreateMillExpense, useMillWorkers, useCreateMillWorker,
  usePayrollSummary, useRecordAttendance, useInventory, useExpenseVendors,
  usePayables, useSuppliers, useCustomers, usePurchases, useLocalSalesSummary, useMillCashFlow,
  useMillLotCosts,
} from '../../../api/queries';
import { useCommodityPrices } from '../hooks/useCommodityPrices';
import SlideDrawer from '../../../components/SlideDrawer';
import SearchSelect from '../../../shared/components/SearchSelect';
import MillSupplierStatement from '../components/MillSupplierStatement';
import MillCustomerStatement from '../components/MillCustomerStatement';
import MillCustomerPayDrawer from '../components/MillCustomerPayDrawer';
import StatementPayDrawer from '../../finance/components/StatementPayDrawer';

const PKR = (v) => 'Rs ' + Math.round(v || 0).toLocaleString('en-PK');
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
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
  { key: 'moneyflow',  label: 'Money In/Out', icon: Wallet },
  { key: 'suppliers',  label: 'Suppliers',    icon: Building2 },
  { key: 'customers',  label: 'Customers',    icon: Users },
  { key: 'expenses',   label: 'Expenses',     icon: TrendingDown },
  { key: 'addcosts',   label: 'Add. Costs',   icon: Layers },
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

  const { data: lotCosts = { categories: [], grandTotal: 0 } } = useMillLotCosts();

  // ── Money In/Out + Suppliers data ──
  const { data: payablesRaw } = usePayables({});
  const payables = useMemo(() => {
    const arr = Array.isArray(payablesRaw) ? payablesRaw : (payablesRaw?.payables || []);
    return arr.filter((p) => String(p.entity || '').toLowerCase() === 'mill');
  }, [payablesRaw]);
  const { data: suppliers = [] } = useSuppliers();
  const { data: storePurchaseData } = usePurchases();
  const { data: localSalesSummary } = useLocalSalesSummary();
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const { data: localCustomers = [] } = useCustomers({ type: 'local' });
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [payCustomer, setPayCustomer] = useState(null);
  // Pay a supplier with the same drawer the Finance dashboard uses.
  const { hasPermission } = useAuth();
  const canPay = hasPermission('finance', 'confirm_payment');
  const [payParty, setPayParty] = useState(null);

  // ── Cash account: actual money in/out ledger with a period filter ──
  const [cashRange, setCashRange] = useState('all'); // all | month | quarter | ytd
  const cashParams = useMemo(() => {
    if (cashRange === 'all') return {};
    const now = new Date();
    const y = now.getFullYear();
    let from;
    if (cashRange === 'month') from = new Date(y, now.getMonth(), 1);
    else if (cashRange === 'quarter') from = new Date(y, Math.floor(now.getMonth() / 3) * 3, 1);
    else from = new Date(y, 0, 1); // ytd
    return { from_date: from.toISOString().slice(0, 10) };
  }, [cashRange]);
  const { data: cashFlow } = useMillCashFlow(cashParams);
  const cashLedger = useMemo(() => {
    const rows = cashFlow?.ledger || [];
    return rows.reduce((acc, r) => {
      const prev = acc.length ? acc[acc.length - 1].balance : 0;
      acc.push({ ...r, balance: prev + (r.direction === 'in' ? r.amount_pkr : -r.amount_pkr) });
      return acc;
    }, []);
  }, [cashFlow]);
  const cashSummary = cashFlow?.summary || { cashIn: 0, cashOut: 0, net: 0, count: 0 };
  const moneyOutStreams = cashFlow?.moneyOutStreams || [];
  const moneyInSummary = cashFlow?.moneyInSummary || { billed: 0, collected: 0, outstanding: 0 };

  const expenses = expData?.expenses || [];
  const expSummary = expData?.summary || [];
  const totalOverhead = expSummary.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
  const payrollSummary = payrollData?.summary || [];
  const payrollTotal = payrollData?.grandTotal || 0;

  const [activeTab, setActiveTab] = useState('overview');
  // Deep-link from the Mill Customers/Suppliers pages: ?tab=customers&customer=ID
  // (or tab=suppliers&supplier=ID) opens the right tab with the party selected.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tabs.some(t => t.key === tab)) setActiveTab(tab);
    const cid = searchParams.get('customer');
    if (cid) { const c = localCustomers.find(x => String(x.id) === String(cid)); if (c) setSelectedCustomer({ id: c.id, name: c.name }); }
    const sid = searchParams.get('supplier');
    if (sid) { const s = suppliers.find(x => String(x.id) === String(sid)); if (s) setSelectedSupplier({ id: s.id, name: s.name }); }
  }, [searchParams, localCustomers, suppliers]);
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

  // A blend re-mills already-owned finished rice, so its raw_rice cost is the
  // internal value of stock already counted as raw material on its source
  // batches — excluding it stops the raw-material/cost KPIs double-counting.
  const isBlendBatch = (b) => b.processingType === 'blended';

  const kpis = useMemo(() => {
    const totalRaw = completed.reduce((s, b) => s + (isBlendBatch(b) ? 0 : getRawCost(b.costs)), 0);
    const totalOtherCosts = completed.reduce((s, b) => {
      return s + Object.entries(b.costs || {}).reduce((cs, [k, v]) => RAW_KEYS.has(k) ? cs : cs + (parseFloat(v) || 0), 0);
    }, 0);
    // Packing / bags is part of Other costs — split out so it's visible.
    const totalPacking = completed.reduce((s, b) => s + (parseFloat(b.costs?.packaging) || 0), 0);
    // Milling cost = the processing/milling fee (Rs/kg × raw qty). It lives on the
    // batch (milling_fee_per_kg), not as a milling_costs row, so the batch-cost
    // sums above miss it. Own production only — a service-milled batch's fee is
    // revenue (counted in serviceFees), not a cost.
    const totalMilling = completed.reduce((s, b) =>
      s + (b.isServiceMilling ? 0 : (parseFloat(b.millingFeePerKg) || 0) * (parseFloat(b.rawQtyMT) || 0) * 1000), 0);
    // Count only finished output NOT re-milled into a downstream blend (sellable
    // rice) — otherwise the blend's output double-counts its source batches', as
    // that rice can only be sold once.
    const sellableFinishedMT = (b) => Math.max(0, b.actualFinishedMT - (b.finishedConsumedMT || 0));
    const finishedRev = completed.reduce((s, b) => s + sellableFinishedMT(b) * batchPrice(b, 'finished'), 0);
    const byproductRev = completed.reduce((s, b) =>
      s + b.brokenMT * batchPrice(b, 'broken') + b.branMT * batchPrice(b, 'bran') + b.huskMT * batchPrice(b, 'husk'), 0);
    const totalRev = finishedRev + byproductRev;
    const totalCost = totalRaw + totalMilling + totalOtherCosts + totalOverhead;
    const totalFinishedKg = completed.reduce((s, b) => s + sellableFinishedMT(b) * 1000, 0);
    const costPerKg = totalFinishedKg > 0 ? totalCost / totalFinishedKg : 0;
    return { totalRev, totalRaw, totalMilling, totalOtherCosts, totalPacking, totalCost, netProfit: totalRev - totalCost, costPerKg, finishedRev, byproductRev };
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

  // ── Money In / Out streams ──
  // Service-milling fees: batches we milled for outside clients (flagged in
  // notes by the create form). Fee = raw qty (kg) × fee/kg.
  const serviceFees = useMemo(() => millingBatches.reduce((s, b) => {
    if (!String(b.notes || '').includes('[SERVICE MILLING]')) return s;
    return s + (parseFloat(b.millingFeePerKg) || 0) * (parseFloat(b.rawQtyMT) || 0) * 1000;
  }, 0), [millingBatches]);

  // usePurchases() returns totals raw (snake_case); total_pkr spans ALL purchase
  // sources (mill store + export costs + lots), so use by_source.mill_store for
  // the mill-store consumables figure only.
  const storePurchaseTotal = parseFloat(
    storePurchaseData?.totals?.by_source?.mill_store ?? storePurchaseData?.totals?.bySource?.mill_store ?? 0
  ) || 0;
  // useLocalSalesSummary() shape: { all: { total, due }, profit: { revenue, collected } }
  const localSalesRevenue = parseFloat(
    localSalesSummary?.all?.total ?? localSalesSummary?.profit?.revenue ?? 0
  ) || 0;
  const localSalesCollected = parseFloat(localSalesSummary?.profit?.collected ?? 0) || 0;

  const moneyFlow = useMemo(() => {
    const out = {
      paddy: kpis.totalRaw,
      milling: kpis.totalMilling,
      batchCosts: kpis.totalOtherCosts,
      overhead: totalOverhead,
      payroll: payrollTotal,
      store: storePurchaseTotal,
    };
    out.total = out.paddy + out.milling + out.batchCosts + out.overhead + out.payroll + out.store;
    const inc = {
      output: kpis.totalRev,
      finished: kpis.finishedRev,
      byproduct: kpis.byproductRev,
      localSales: localSalesRevenue,
      serviceFees,
    };
    return { out, inc, netProduction: inc.output - out.total };
  }, [kpis, totalOverhead, payrollTotal, storePurchaseTotal, localSalesRevenue, serviceFees]);

  // ── Supplier directory (money owed to mill suppliers) ──
  const supplierRows = useMemo(() => {
    const map = {};
    for (const p of payables) {
      const name = p.supplierName;
      if (!name) continue;
      const key = p.supplierId || name;
      if (!map[key]) map[key] = { id: p.supplierId || null, name, billed: 0, paid: 0, outstanding: 0, count: 0 };
      map[key].billed += parseFloat(p.originalAmount) || 0;
      map[key].paid += parseFloat(p.paidAmount) || 0;
      map[key].outstanding += parseFloat(p.outstanding) || 0;
      map[key].count += 1;
    }
    return Object.values(map).sort((a, b) => b.outstanding - a.outstanding);
  }, [payables]);

  const supplierTotals = useMemo(() => supplierRows.reduce(
    (acc, r) => ({ billed: acc.billed + r.billed, paid: acc.paid + r.paid, outstanding: acc.outstanding + r.outstanding }),
    { billed: 0, paid: 0, outstanding: 0 },
  ), [supplierRows]);

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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Stat tone="blue"   icon={TrendingUp}   label="Revenue"        value={PKR(kpis.totalRev)}   sub={`Finished ${COMPACT_PKR(kpis.finishedRev)}`} />
            <Stat tone="red"    icon={TrendingDown} label="Raw Material"   value={PKR(kpis.totalRaw)}   sub="Rice purchase" />
            <Stat tone="purple" icon={Factory}      label="Milling Cost"   value={PKR(kpis.totalMilling)} sub="Processing fee" />
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

          {/* Net profit & margin breakdown */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-800">Net Profit &amp; Margin</h3>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${kpis.netProfit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                Margin {margin}%
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-1.5">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm font-semibold text-gray-900"><span>Revenue</span><span className="tabular-nums text-emerald-600">{PKR(kpis.totalRev)}</span></div>
                <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Finished rice (sellable)</span><span className="tabular-nums">{PKR(kpis.finishedRev)}</span></div>
                <div className="flex justify-between text-xs text-gray-500 pl-3"><span>By-products</span><span className="tabular-nums">{PKR(kpis.byproductRev)}</span></div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm font-semibold text-gray-900"><span>Costs</span><span className="tabular-nums text-red-600">{PKR(kpis.totalCost)}</span></div>
                <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Raw material</span><span className="tabular-nums">−{PKR(kpis.totalRaw)}</span></div>
                <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Milling cost</span><span className="tabular-nums">−{PKR(kpis.totalMilling)}</span></div>
                {(kpis.totalOtherCosts - kpis.totalPacking) > 0 && (
                  <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Batch costs</span><span className="tabular-nums">−{PKR(kpis.totalOtherCosts - kpis.totalPacking)}</span></div>
                )}
                {kpis.totalPacking > 0 && (
                  <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Packing / bags</span><span className="tabular-nums">−{PKR(kpis.totalPacking)}</span></div>
                )}
                <div className="flex justify-between text-xs text-gray-500 pl-3"><span>Overhead</span><span className="tabular-nums">−{PKR(totalOverhead)}</span></div>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800">Net Profit</span>
              <span className={`text-lg font-bold tabular-nums ${kpis.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{PKR(kpis.netProfit)}</span>
            </div>
            {payrollTotal > 0 && (
              <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
                <span>After payroll (−{PKR(payrollTotal)})</span>
                <span className="tabular-nums">{PKR(kpis.netProfit - payrollTotal)}</span>
              </div>
            )}
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

      {/* ─── MONEY IN / OUT ────────────────────────────────────────── */}
      {activeTab === 'moneyflow' && (
        <div className="space-y-5">
          {/* Period filter */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-700">Mill cash account — money in &amp; out</h3>
            <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5">
              {[['all', 'All'], ['ytd', 'YTD'], ['quarter', 'Quarter'], ['month', 'This month']].map(([k, l]) => (
                <button key={k} onClick={() => setCashRange(k)}
                  className={`px-2.5 py-1 text-xs rounded-md ${cashRange === k ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
              ))}
            </div>
          </div>

          {/* Realized cash summary */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Cash in (received)" value={PKR(cashSummary.cashIn)} sub="receipts" tone="green" icon={ArrowDownRight} />
            <Stat label="Cash out (paid)" value={PKR(cashSummary.cashOut)} sub="payments made" tone="red" icon={ArrowUpRight} />
            <Stat label="Net cash flow" value={PKR(cashSummary.net)} sub={`${cashSummary.count} transaction(s)`} tone={cashSummary.net >= 0 ? 'green' : 'red'} icon={Wallet} />
          </div>

          {/* Money OUT — paid vs outstanding */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ArrowUpRight size={15} className="text-rose-500" />
              <h3 className="text-sm font-semibold text-gray-700">Money out — paid vs outstanding</h3>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
              {moneyOutStreams.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-400">No mill payables.</div>
              ) : moneyOutStreams.map((s) => {
                const pct = s.billed > 0 ? Math.round((s.paid / s.billed) * 100) : 0;
                return (
                  <div key={s.stream} className="p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-800">{s.stream}</span>
                      <span className="text-gray-500 text-xs">{PKR(s.billed)} billed</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-amber-100 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px]">
                      <span className="text-emerald-600">{PKR(s.paid)} paid ({pct}%)</span>
                      <span className="text-amber-600">{PKR(s.outstanding)} outstanding</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Money IN — local sales collected vs outstanding */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ArrowDownRight size={15} className="text-emerald-500" />
              <h3 className="text-sm font-semibold text-gray-700">Money in — local sales (collected vs outstanding)</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Sales billed" value={COMPACT_PKR(moneyInSummary.billed)} tone="slate" icon={Receipt} />
              <Stat label="Collected" value={COMPACT_PKR(moneyInSummary.collected)} tone="green" icon={Banknote} />
              <Stat label="Outstanding" value={COMPACT_PKR(moneyInSummary.outstanding)} tone={moneyInSummary.outstanding > 0 ? 'amber' : 'green'} icon={Wallet} />
            </div>
          </div>

          {/* Cash ledger */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Banknote size={15} className="text-indigo-500" />
              <h3 className="text-sm font-semibold text-gray-700">Cash ledger</h3>
              <span className="text-xs text-gray-400">— actual money in &amp; out, running balance</span>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
              {cashLedger.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No cash transactions in this period.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="text-left font-medium px-3 py-2">Date</th>
                      <th className="text-left font-medium px-3 py-2">Description</th>
                      <th className="text-left font-medium px-3 py-2">Method</th>
                      <th className="text-right font-medium px-3 py-2">Out</th>
                      <th className="text-right font-medium px-3 py-2">In</th>
                      <th className="text-right font-medium px-3 py-2">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cashLedger.map((r) => (
                      <tr key={`${r.direction}-${r.id}`} className="hover:bg-gray-50/60">
                        <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{fmtDate(r.payment_date)}</td>
                        <td className="px-3 py-1.5">
                          <span className="text-gray-800">{r.counterparty || '—'}</span>
                          <span className="text-[10px] text-gray-400 ml-1.5">{r.category}{r.ref ? ` · ${r.ref}` : ''}</span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-500 capitalize">{r.payment_method || '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{r.direction === 'out' ? PKR(r.amount_pkr) : ''}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600">{r.direction === 'in' ? PKR(r.amount_pkr) : ''}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${r.balance < 0 ? 'text-rose-700' : 'text-gray-800'}`}>{PKR(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Production value (accrual) — kept separate from cash */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Factory size={15} className="text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-700">Production value <span className="text-xs font-normal text-gray-400">— accrual, not cash</span></h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Stat label="Output value produced" value={COMPACT_PKR(moneyFlow.inc.output)} sub="finished + byproducts" tone="slate" icon={Wallet} />
              <Stat label="Finished rice value" value={COMPACT_PKR(moneyFlow.inc.finished)} tone="slate" icon={TrendingUp} />
              <Stat label="Byproduct value" value={COMPACT_PKR(moneyFlow.inc.byproduct)} sub="broken, bran, husk" tone="slate" icon={Package} />
              <Stat label="Mill costs (accrued)" value={COMPACT_PKR(moneyFlow.out.total)} sub="rice + milling + overhead" tone="slate" icon={Receipt} />
              <Stat label="Net production margin" value={COMPACT_PKR(moneyFlow.netProduction)} sub={`${margin}% margin`} tone={moneyFlow.netProduction >= 0 ? 'green' : 'red'} icon={Factory} />
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              Production value is rice produced at confirmed prices (accrual). The cash ledger above is money actually received and paid.
            </p>
          </div>
        </div>
      )}

      {/* ─── SUPPLIERS ─────────────────────────────────────────────── */}
      {activeTab === 'suppliers' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Mill suppliers" value={supplierRows.length} sub="with mill payables" tone="slate" icon={Building2} />
            <Stat label="Total billed" value={COMPACT_PKR(supplierTotals.billed)} sub={`${COMPACT_PKR(supplierTotals.paid)} paid`} tone="blue" icon={Receipt} />
            <Stat label="Outstanding" value={COMPACT_PKR(supplierTotals.outstanding)} tone={supplierTotals.outstanding > 0 ? 'amber' : 'green'} icon={Wallet} />
          </div>

          {/* Pick any supplier to view their statement */}
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">View any supplier statement</p>
            <SearchSelect
              value={selectedSupplier?.id || ''}
              onChange={(val) => {
                const s = suppliers.find((x) => String(x.id) === String(val));
                setSelectedSupplier(s ? { id: s.id, name: s.name } : null);
              }}
              options={suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.location || s.city || s.country || '' }))}
              placeholder="Search suppliers…"
            />
          </div>

          {/* Inline statement */}
          {selectedSupplier?.id && (
            <div className="space-y-2">
              {canPay && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setPayParty({ id: selectedSupplier.id, name: selectedSupplier.name })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-sm font-medium"
                  >
                    <Banknote size={14} /> Record Payment
                  </button>
                </div>
              )}
              <MillSupplierStatement
                supplierId={selectedSupplier.id}
                supplierName={selectedSupplier.name}
                onClose={() => setSelectedSupplier(null)}
              />
            </div>
          )}

          {/* Directory */}
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Mill supplier directory</h3>
              <p className="text-[11px] text-gray-400">Click a supplier to see its statement of money owed & paid.</p>
            </div>
            <div className="overflow-x-auto">
              {supplierRows.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No mill supplier payables yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="text-left font-medium px-4 py-2">Supplier</th>
                      <th className="text-right font-medium px-4 py-2">Invoices</th>
                      <th className="text-right font-medium px-4 py-2">Billed</th>
                      <th className="text-right font-medium px-4 py-2">Paid</th>
                      <th className="text-right font-medium px-4 py-2">Outstanding</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {supplierRows.map((r) => (
                      <tr
                        key={r.id || r.name}
                        className={`hover:bg-blue-50/40 ${r.id ? 'cursor-pointer' : ''} ${selectedSupplier?.id === r.id ? 'bg-blue-50/60' : ''}`}
                        onClick={() => r.id && setSelectedSupplier({ id: r.id, name: r.name })}
                      >
                        <td className="px-4 py-2 font-medium text-gray-800">{r.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-500">{r.count}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-700">{PKR(r.billed)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-emerald-600">{PKR(r.paid)}</td>
                        <td className={`px-4 py-2 text-right tabular-nums font-medium ${r.outstanding > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{PKR(r.outstanding)}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {canPay && r.id && r.outstanding > 0 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setPayParty({ id: r.id, name: r.name }); }}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-[11px] font-medium mr-2"
                            >
                              <Banknote size={12} /> Pay
                            </button>
                          )}
                          {r.id && <span className="text-blue-500 text-xs">View →</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── CUSTOMERS (local sales) ────────────────────────────────── */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Local customers" value={localCustomers.length} sub="local-sales buyers" tone="slate" icon={Users} />
            <Stat label="Pick a customer" value="↓" sub="to view their statement" tone="blue" icon={Receipt} />
          </div>

          {/* Pick any customer to view their statement */}
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">View any customer statement</p>
            <SearchSelect
              value={selectedCustomer?.id || ''}
              onChange={(val) => {
                const c = localCustomers.find((x) => String(x.id) === String(val));
                setSelectedCustomer(c ? { id: c.id, name: c.name } : null);
              }}
              options={localCustomers.map((c) => ({ value: c.id, label: c.name, sub: c.country || c.port || '' }))}
              placeholder="Search customers…"
            />
          </div>

          {/* Inline statement */}
          {selectedCustomer?.id && (
            <div className="space-y-2">
              {canPay && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setPayCustomer({ id: selectedCustomer.id, name: selectedCustomer.name })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-sm font-medium"
                  >
                    <Banknote size={14} /> Record Payment
                  </button>
                </div>
              )}
              <MillCustomerStatement
                customerId={selectedCustomer.id}
                customerName={selectedCustomer.name}
                onClose={() => setSelectedCustomer(null)}
              />
            </div>
          )}

          {/* Directory */}
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Local customer directory</h3>
              <p className="text-[11px] text-gray-400">Click a customer to see their statement of sales & receipts.</p>
            </div>
            <div className="overflow-x-auto">
              {localCustomers.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No local customers yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="text-left font-medium px-4 py-2">Customer</th>
                      <th className="text-left font-medium px-4 py-2">Contact</th>
                      <th className="text-left font-medium px-4 py-2">Country</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {localCustomers.map((c) => (
                      <tr key={c.id}
                        className={`cursor-pointer hover:bg-blue-50/40 ${selectedCustomer?.id === c.id ? 'bg-blue-50/60' : ''}`}
                        onClick={() => setSelectedCustomer({ id: c.id, name: c.name })}>
                        <td className="px-4 py-2 font-medium text-gray-900">{c.name}</td>
                        <td className="px-4 py-2 text-gray-600">{c.contact || c.phone || '—'}</td>
                        <td className="px-4 py-2 text-gray-600">{c.country || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

      {/* ─── ADDITIONAL COSTS (traceability) ───────────────────────── */}
      {activeTab === 'addcosts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Lot additional costs</h3>
              <p className="text-xs text-gray-500">Transport, labor, unloading, packing, bag &amp; other — itemised and traced to the source lot.</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Total recorded</p>
              <p className="text-lg font-bold text-gray-900">{PKR(lotCosts.grandTotal)}</p>
            </div>
          </div>

          {(!lotCosts.categories || lotCosts.categories.length === 0) ? (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">No additional costs recorded on any lot yet.</div>
          ) : (
            <div className="space-y-3">
              {lotCosts.categories.map((cat) => (
                <div key={cat.key} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                    <div className="flex items-center gap-2 min-w-0">
                      {cat.key === 'transport' ? <Truck size={15} className="text-indigo-500 shrink-0" /> : <Layers size={15} className="text-gray-400 shrink-0" />}
                      <span className="font-semibold text-gray-800 text-sm">{cat.label}</span>
                      <span className="text-[11px] text-gray-400">{cat.count} lot{cat.count === 1 ? '' : 's'}</span>
                      {cat.inCogs
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">in rice cost</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">hauler payable</span>}
                    </div>
                    <span className="font-bold text-gray-900 text-sm tabular-nums">{PKR(cat.total)}</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {cat.lots.map((l) => (
                      <div key={l.lotId} className="flex items-center justify-between px-4 py-2 text-sm gap-3">
                        <Link to={`/lot-inventory/${l.lotNo}`} className="font-mono text-blue-600 hover:underline inline-flex items-center gap-1 shrink-0">
                          {l.lotNo}<ExternalLink size={11} />
                        </Link>
                        <div className="flex items-center gap-3 min-w-0">
                          {cat.key === 'transport' && (
                            l.unassigned
                              ? <span className="text-[11px] text-amber-600 whitespace-nowrap">no hauler set</span>
                              : <span className="text-[11px] text-gray-500 truncate">{l.haulerName || '—'}{l.outstanding > 0 ? ` · ${PKR(l.outstanding)} due` : ' · paid'}</span>
                          )}
                          {cat.key === 'transport' && canPay && l.haulerId && l.outstanding > 0 && (
                            <button onClick={() => setPayParty({ id: l.haulerId, name: l.haulerName })}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-[11px] font-medium shrink-0">
                              <Banknote size={11} /> Pay
                            </button>
                          )}
                          <span className="font-medium text-gray-900 tabular-nums shrink-0">{PKR(l.amount)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-gray-400">In-rice-cost items are part of finished COGS (inside Raw Material). Transport is a separate payable owed to the hauler.</p>
            </div>
          )}
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

      {/* Pay a supplier — same drawer the Finance dashboard uses. */}
      {payParty && (
        <StatementPayDrawer
          mode="supplier"
          party={payParty}
          onClose={() => setPayParty(null)}
        />
      )}

      {/* Record a customer receipt against a specific invoice. */}
      {payCustomer && (
        <MillCustomerPayDrawer
          customer={payCustomer}
          onClose={() => setPayCustomer(null)}
        />
      )}
    </div>
  );
}
