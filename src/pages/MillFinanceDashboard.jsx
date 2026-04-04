import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DollarSign, Users, Zap, Shield, TrendingUp, TrendingDown, AlertTriangle, Plus, UserPlus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useMillExpenses, useCreateMillExpense, useMillWorkers, useCreateMillWorker, usePayrollSummary, useRecordAttendance } from '../api/queries';
import KPICard from '../components/KPICard';
import Modal from '../components/Modal';

const PKR = (v) => 'Rs ' + Math.round(v || 0).toLocaleString('en-PK');
const MILL_PRICES = { finished: 72800, broken: 38000, bran: 28000, husk: 8400 };
const EXPENSE_CATS = ['salaries', 'utilities', 'rent', 'maintenance', 'insurance', 'transport', 'fuel', 'packaging', 'misc'];
const WORKER_ROLES = ['operator', 'laborer', 'supervisor', 'driver', 'guard', 'cleaner'];

const tabs = [
  { key: 'overview', label: 'Overview', icon: DollarSign },
  { key: 'expenses', label: 'Expenses', icon: TrendingDown },
  { key: 'efficiency', label: 'Efficiency', icon: TrendingUp },
  { key: 'loss', label: 'Loss & Theft', icon: Shield },
  { key: 'payroll', label: 'Payroll', icon: Users },
  { key: 'utilities', label: 'Utilities', icon: Zap },
];

export default function MillFinanceDashboard() {
  const { millingBatches, addToast } = useApp();
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
  const [showExpModal, setShowExpModal] = useState(false);
  const [showWorkerModal, setShowWorkerModal] = useState(false);
  const [expForm, setExpForm] = useState({ category: 'salaries', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], notes: '' });
  const [workerForm, setWorkerForm] = useState({ name: '', role: 'laborer', daily_wage: '', phone: '' });

  const completed = useMemo(() => millingBatches.filter(b => b.status === 'Completed'), [millingBatches]);

  // Financial KPIs
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
    const finishedRev = completed.reduce((s, b) => s + b.actualFinishedMT * MILL_PRICES.finished, 0);
    const byproductRev = completed.reduce((s, b) =>
      s + b.brokenMT * MILL_PRICES.broken + b.branMT * MILL_PRICES.bran + b.huskMT * MILL_PRICES.husk, 0);
    const totalRev = finishedRev + byproductRev;
    const totalCost = totalRaw + totalOtherCosts + totalOverhead;
    const totalFinishedKg = completed.reduce((s, b) => s + b.actualFinishedMT * 1000, 0);
    const costPerKg = totalFinishedKg > 0 ? totalCost / totalFinishedKg : 0;
    return { totalRev, totalRaw, totalOtherCosts, totalCost, netProfit: totalRev - totalCost, costPerKg, finishedRev, byproductRev };
  }, [completed, totalOverhead]);

  // Efficiency
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

  // Loss & Theft
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

  async function handleAddExpense() {
    if (!expForm.amount) { addToast('Amount required', 'error'); return; }
    try { await createExpMut.mutateAsync(expForm); addToast('Expense recorded'); setShowExpModal(false); } catch (e) { addToast(e.message, 'error'); }
  }

  async function handleAddWorker() {
    if (!workerForm.name || !workerForm.daily_wage) { addToast('Name and wage required', 'error'); return; }
    try { await createWorkerMut.mutateAsync(workerForm); addToast('Worker added'); setShowWorkerModal(false); setWorkerForm({ name: '', role: 'laborer', daily_wage: '', phone: '' }); } catch (e) { addToast(e.message, 'error'); }
  }

  const margin = kpis.totalRev > 0 ? (kpis.netProfit / kpis.totalRev * 100).toFixed(1) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mill Finance</h1>
          <p className="text-sm text-gray-500 mt-0.5">Financial management, expenses, payroll, and efficiency</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowExpModal(true)} className="btn btn-sm bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"><Plus className="w-3.5 h-3.5" /> Add Expense</button>
          <button onClick={() => setShowWorkerModal(true)} className="btn btn-sm bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"><UserPlus className="w-3.5 h-3.5" /> Add Worker</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* === OVERVIEW === */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KPICard icon={TrendingUp} title="Total Revenue" value={PKR(kpis.totalRev)} subtitle={`Finished: ${PKR(kpis.finishedRev)}`} color="blue" />
            <KPICard icon={TrendingDown} title="Raw Material" value={PKR(kpis.totalRaw)} subtitle="Paddy purchase cost" color="red" />
            <KPICard icon={DollarSign} title="Operating Costs" value={PKR(kpis.totalOtherCosts + totalOverhead)} subtitle={`Batch: ${PKR(kpis.totalOtherCosts)} + OH: ${PKR(totalOverhead)}`} color="orange" />
            <KPICard icon={TrendingUp} title="Net Profit" value={PKR(kpis.netProfit)} subtitle={`Margin: ${margin}%`} color={kpis.netProfit >= 0 ? 'green' : 'red'} />
            <KPICard icon={DollarSign} title="Cost per KG" value={`Rs ${kpis.costPerKg.toFixed(2)}`} subtitle="All-in cost of finished rice" color="gray" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Expense Breakdown</h3>
              <div className="space-y-2">
                {expSummary.map(e => (
                  <div key={e.category} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-gray-600">{e.category}</span>
                    <span className="font-medium">{PKR(parseFloat(e.total))}</span>
                  </div>
                ))}
                {expSummary.length === 0 && <p className="text-sm text-gray-400">No expenses recorded yet. Click "Add Expense" to start.</p>}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Payroll Summary ({curMonth})</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-gray-600">Active workers</span><span className="font-bold">{payrollSummary.length}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-600">Total payroll</span><span className="font-bold">{PKR(payrollTotal)}</span></div>
                {payrollSummary.slice(0, 5).map(w => (
                  <div key={w.id} className="flex justify-between text-xs text-gray-500">
                    <span>{w.name} ({w.effectiveDays}d)</span><span>{PKR(w.totalPay)}</span>
                  </div>
                ))}
                {payrollSummary.length === 0 && <p className="text-xs text-gray-400">No workers added yet.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === EXPENSES === */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowExpModal(true)} className="btn btn-primary btn-sm"><Plus className="w-3.5 h-3.5" /> Add Expense</button>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b"><th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Category</th><th className="text-left px-4 py-3">Description</th><th className="text-left px-4 py-3">Reference</th><th className="text-right px-4 py-3">Amount</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{e.expenseDate}</td>
                    <td className="px-4 py-3 capitalize">{e.category}</td>
                    <td className="px-4 py-3 text-gray-600">{e.description || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{e.reference || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium">{PKR(parseFloat(e.amount))}</td>
                  </tr>
                ))}
                {expenses.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No expenses recorded yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === EFFICIENCY === */}
      {activeTab === 'efficiency' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard icon={TrendingUp} title="Avg Recovery" value={`${efficiency.avgYield}%`} subtitle="Finished / Raw" color="green" />
            <KPICard icon={AlertTriangle} title="Avg Wastage" value={`${efficiency.avgWastage}%`} subtitle="Waste / Raw" color="red" />
            <KPICard icon={DollarSign} title="Cost per KG" value={`Rs ${efficiency.costPerKg}`} subtitle="All-in finished cost" color="blue" />
            <KPICard icon={TrendingUp} title="Batches" value={completed.length} subtitle={`${efficiency.totalRaw?.toFixed(0) || 0} MT processed`} color="gray" />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b"><th className="text-left px-4 py-3">Batch</th><th className="text-right px-4 py-3">Raw MT</th><th className="text-right px-4 py-3">Finished MT</th><th className="text-right px-4 py-3">Yield %</th><th className="text-right px-4 py-3">Wastage %</th><th className="text-right px-4 py-3">Cost/KG</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {completed.map(b => {
                  const totalCost = Object.values(b.costs || {}).reduce((s, c) => s + (parseFloat(c) || 0), 0);
                  const costKg = b.actualFinishedMT > 0 ? totalCost / (b.actualFinishedMT * 1000) : 0;
                  const wastePct = b.rawQtyMT > 0 ? ((b.wastageMT || 0) / b.rawQtyMT * 100).toFixed(1) : 0;
                  return (
                    <tr key={b.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href = `/milling/${b.id}`}>
                      <td className="px-4 py-3 font-medium text-blue-600">{b.id}</td>
                      <td className="px-4 py-3 text-right">{b.rawQtyMT}</td>
                      <td className="px-4 py-3 text-right">{b.actualFinishedMT}</td>
                      <td className="px-4 py-3 text-right font-medium">{b.yieldPct}%</td>
                      <td className="px-4 py-3 text-right text-red-600">{wastePct}%</td>
                      <td className="px-4 py-3 text-right">Rs {costKg.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === LOSS & THEFT === */}
      {activeTab === 'loss' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <Shield className="w-4 h-4 inline mr-2" />
            Batches flagged when actual output is more than 3% below expected. This may indicate loss, theft, or measurement errors.
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b"><th className="text-left px-4 py-3">Batch</th><th className="text-right px-4 py-3">Raw MT</th><th className="text-right px-4 py-3">Expected</th><th className="text-right px-4 py-3">Actual</th><th className="text-right px-4 py-3">Variance MT</th><th className="text-right px-4 py-3">Variance %</th><th className="text-center px-4 py-3">Status</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {lossData.map(b => (
                  <tr key={b.id} className={`hover:bg-gray-50 ${b.flagged ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-blue-600"><Link to={`/milling/${b.id}`}>{b.id}</Link></td>
                    <td className="px-4 py-3 text-right">{b.rawQtyMT}</td>
                    <td className="px-4 py-3 text-right">{b.expected.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{b.actualFinishedMT}</td>
                    <td className={`px-4 py-3 text-right font-medium ${b.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>{b.variance > 0 ? '+' : ''}{b.variance.toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${parseFloat(b.variancePct) < -3 ? 'text-red-600' : 'text-gray-600'}`}>{b.variancePct}%</td>
                    <td className="px-4 py-3 text-center">
                      {b.flagged ? <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">Investigate</span> : <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">Normal</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === PAYROLL === */}
      {activeTab === 'payroll' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Workers & Payroll — {curMonth}</h3>
            <button onClick={() => setShowWorkerModal(true)} className="btn btn-primary btn-sm"><UserPlus className="w-3.5 h-3.5" /> Add Worker</button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <KPICard icon={Users} title="Active Workers" value={payrollSummary.length} subtitle="On payroll" color="blue" />
            <KPICard icon={DollarSign} title="Monthly Payroll" value={PKR(payrollTotal)} subtitle={curMonth} color="red" />
            <KPICard icon={DollarSign} title="Avg Daily Wage" value={PKR(payrollSummary.length > 0 ? payrollSummary.reduce((s, w) => s + parseFloat(w.dailyWage || 0), 0) / payrollSummary.length : 0)} subtitle="Per worker" color="gray" />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b"><th className="text-left px-4 py-3">Name</th><th className="text-left px-4 py-3">Role</th><th className="text-right px-4 py-3">Daily Wage</th><th className="text-right px-4 py-3">Days</th><th className="text-right px-4 py-3">OT Hours</th><th className="text-right px-4 py-3">Basic Pay</th><th className="text-right px-4 py-3">OT Pay</th><th className="text-right px-4 py-3">Total</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {payrollSummary.map(w => (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{w.name}</td>
                    <td className="px-4 py-3 capitalize text-gray-600">{w.role}</td>
                    <td className="px-4 py-3 text-right">{PKR(parseFloat(w.dailyWage))}</td>
                    <td className="px-4 py-3 text-right">{w.effectiveDays}</td>
                    <td className="px-4 py-3 text-right">{w.totalOT || 0}</td>
                    <td className="px-4 py-3 text-right">{PKR(w.basicPay)}</td>
                    <td className="px-4 py-3 text-right">{PKR(w.otPay)}</td>
                    <td className="px-4 py-3 text-right font-bold">{PKR(w.totalPay)}</td>
                  </tr>
                ))}
                {payrollSummary.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No workers added yet. Click "Add Worker" to start.</td></tr>}
                {payrollSummary.length > 0 && (
                  <tr className="bg-gray-50 font-bold">
                    <td colSpan={7} className="px-4 py-3 text-right">Grand Total</td>
                    <td className="px-4 py-3 text-right">{PKR(payrollTotal)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === UTILITIES === */}
      {activeTab === 'utilities' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
            <Zap className="w-4 h-4 inline mr-2" />
            Track electricity, water, gas, and diesel consumption. Record readings via the Expenses tab (category: Utilities) or batch-level utility tracking.
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {['utilities', 'fuel', 'maintenance', 'rent'].map(cat => {
              const catTotal = expenses.filter(e => e.category === cat).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
              return <KPICard key={cat} icon={Zap} title={cat.charAt(0).toUpperCase() + cat.slice(1)} value={PKR(catTotal)} subtitle="Total recorded" color="cyan" />;
            })}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b"><th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Category</th><th className="text-left px-4 py-3">Description</th><th className="text-right px-4 py-3">Amount</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.filter(e => ['utilities', 'fuel', 'maintenance', 'rent'].includes(e.category)).map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{e.expenseDate}</td>
                    <td className="px-4 py-3 capitalize">{e.category}</td>
                    <td className="px-4 py-3 text-gray-600">{e.description || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium">{PKR(parseFloat(e.amount))}</td>
                  </tr>
                ))}
                {expenses.filter(e => ['utilities', 'fuel', 'maintenance', 'rent'].includes(e.category)).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No utility expenses recorded. Add via "Add Expense" button.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      <Modal isOpen={showExpModal} onClose={() => setShowExpModal(false)} title="Add Mill Expense" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
              <select value={expForm.category} onChange={e => setExpForm(p => ({ ...p, category: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                {EXPENSE_CATS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (PKR) *</label>
              <input type="number" value={expForm.amount} onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><input type="text" value={expForm.description} onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g. March electricity bill" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Date</label><input type="date" value={expForm.expense_date} onChange={e => setExpForm(p => ({ ...p, expense_date: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" /></div>
          <div className="flex justify-end gap-2 pt-2 border-t"><button onClick={() => setShowExpModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button><button onClick={handleAddExpense} className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700">Save Expense</button></div>
        </div>
      </Modal>

      {/* Add Worker Modal */}
      <Modal isOpen={showWorkerModal} onClose={() => setShowWorkerModal(false)} title="Add Mill Worker" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><input type="text" value={workerForm.name} onChange={e => setWorkerForm(p => ({ ...p, name: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" /></div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select value={workerForm.role} onChange={e => setWorkerForm(p => ({ ...p, role: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                {WORKER_ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Daily Wage (PKR) *</label><input type="number" value={workerForm.daily_wage} onChange={e => setWorkerForm(p => ({ ...p, daily_wage: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label><input type="text" value={workerForm.phone} onChange={e => setWorkerForm(p => ({ ...p, phone: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t"><button onClick={() => setShowWorkerModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button><button onClick={handleAddWorker} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">Add Worker</button></div>
        </div>
      </Modal>
    </div>
  );
}
