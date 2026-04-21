import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Factory, Wheat, FlaskConical, Gauge, Clock, AlertTriangle,
  Plus, ArrowRight, CheckCircle2, TrendingUp, Truck, Activity,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import { useMillSummary } from '../hooks/useMillSummary';
import { useInventory } from '../../../api/queries';

function formatMT(n) {
  return `${(Number(n) || 0).toFixed(1)} MT`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}

function hoursBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60));
}

function KPI({ icon: Icon, label, value, sub, accent = 'blue' }) {
  const accents = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    purple: 'text-purple-600 bg-purple-50',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-1 truncate">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg ${accents[accent]}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function ActionRow({ icon: Icon, label, count, to, accent = 'amber' }) {
  const colors = {
    amber: 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100',
    red: 'bg-red-50 border-red-200 text-red-900 hover:bg-red-100',
    blue: 'bg-blue-50 border-blue-200 text-blue-900 hover:bg-blue-100',
  };
  if (count === 0) return null;
  return (
    <Link to={to} className={`flex items-center justify-between p-3 rounded-lg border ${colors[accent]} transition-colors`}>
      <div className="flex items-center gap-3">
        <Icon size={18} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="px-2 py-0.5 bg-white rounded-full text-xs font-bold">{count}</span>
        <ArrowRight size={14} />
      </div>
    </Link>
  );
}

function BatchColumn({ title, batches, accent, onBatchClick }) {
  const colors = {
    slate: 'bg-slate-50 border-slate-200',
    blue: 'bg-blue-50 border-blue-200',
    amber: 'bg-amber-50 border-amber-200',
    green: 'bg-green-50 border-green-200',
  };
  return (
    <div className={`rounded-lg border p-3 ${colors[accent]}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</p>
        <span className="text-xs font-bold text-gray-600">{batches.length}</span>
      </div>
      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {batches.length === 0 ? (
          <p className="text-xs text-gray-400 py-2 text-center">—</p>
        ) : batches.slice(0, 8).map(b => (
          <button
            key={b.id}
            onClick={() => onBatchClick(b.id)}
            className="w-full text-left bg-white rounded p-2 border border-gray-100 hover:border-blue-400 transition-colors"
          >
            <p className="text-xs font-semibold text-gray-900 truncate">{b.id}</p>
            <p className="text-[11px] text-gray-500 truncate">
              {b.supplierName || 'Unknown'} · {Number(b.rawQtyMT || 0).toFixed(1)} MT
            </p>
            {b.yieldPct > 0 && (
              <p className="text-[11px] text-gray-600 mt-0.5">Yield: {Number(b.yieldPct).toFixed(1)}%</p>
            )}
          </button>
        ))}
        {batches.length > 8 && (
          <p className="text-[11px] text-gray-500 text-center pt-1">+{batches.length - 8} more</p>
        )}
      </div>
    </div>
  );
}

export default function MillHomeDashboard() {
  const navigate = useNavigate();
  const { summary, isLoading, batches: rawBatches } = useMillSummary();
  const { data: rawInventory } = useInventory({});

  const data = useMemo(() => {
    const batches = Array.isArray(rawBatches) ? rawBatches : [];
    const inventory = Array.isArray(rawInventory) ? rawInventory : [];
    const batchBreakdown = Array.isArray(summary?.batchBreakdown) ? summary.batchBreakdown : [];

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // ─── Action queue ───
    const pendingApproval = batches.filter(b => b.status === 'Pending Approval');

    const arrivalsPendingQC = batches.filter(b => {
      const hasArrival = Array.isArray(b.vehicleArrivals) && b.vehicleArrivals.length > 0;
      const hasArrivalAnalysis = !!b.arrivalAnalysis;
      return hasArrival && !hasArrivalAnalysis;
    });

    const yieldNotRecorded = batches.filter(b => {
      if (b.status !== 'Completed') return false;
      return !b.actualFinishedMT || Number(b.actualFinishedMT) === 0;
    });

    const varianceFlagged = batches.filter(b =>
      b.variancePct != null && Math.abs(Number(b.variancePct)) > 1
    );

    const stalledBatches = batches.filter(b => {
      if (b.status !== 'In Progress') return false;
      const started = b.updatedAt || b.createdAt;
      if (!started) return false;
      return hoursBetween(started, now) > 48;
    });

    // ─── KPIs ───
    const batchesInProgress = batches.filter(b =>
      ['In Progress', 'Queued', 'Pending Approval'].includes(b.status)
    ).length;

    const rawStockMT = inventory
      .filter(i => i.type === 'raw')
      .reduce((s, i) => s + (Number(i.qty) || 0), 0);

    // Estimate daily consumption from last 7 days of completed batches
    const completedLastWeek = batches.filter(b => {
      if (b.status !== 'Completed' || !b.completedAt) return false;
      return new Date(b.completedAt) >= weekAgo;
    });
    const rawConsumedLast7 = completedLastWeek.reduce((s, b) => s + (Number(b.rawQtyMT) || 0), 0);
    const dailyConsumption = rawConsumedLast7 / 7;
    const daysOfCover = dailyConsumption > 0 ? Math.round(rawStockMT / dailyConsumption) : null;

    const yieldLast7 = completedLastWeek.length > 0
      ? completedLastWeek.reduce((s, b) => s + (Number(b.yieldPct) || 0), 0) / completedLastWeek.length
      : 0;

    const completedThisWeek = completedLastWeek.length;

    // ─── Batch board ───
    const board = {
      queued: batches.filter(b => ['Queued', 'Pending Approval'].includes(b.status)),
      inProgress: batches.filter(b => b.status === 'In Progress'),
      pendingQC: arrivalsPendingQC,
      pendingYield: yieldNotRecorded,
      completedToday: batches.filter(b => {
        if (b.status !== 'Completed' || !b.completedAt) return false;
        return new Date(b.completedAt) >= todayStart;
      }),
    };

    // ─── Trends (real data only) ───
    const yieldSeries = batchBreakdown
      .filter(b => b.yieldPct > 0)
      .slice(-20)
      .map(b => ({ batch: String(b.batchNo), yield: Number(b.yieldPct.toFixed(1)) }));

    // Variance distribution
    const varianceBuckets = [
      { label: '< -2%', min: -Infinity, max: -2, count: 0, color: '#dc2626' },
      { label: '-2…-1%', min: -2, max: -1, count: 0, color: '#f59e0b' },
      { label: '-1…+1%', min: -1, max: 1, count: 0, color: '#16a34a' },
      { label: '+1…+2%', min: 1, max: 2, count: 0, color: '#f59e0b' },
      { label: '> +2%', min: 2, max: Infinity, count: 0, color: '#dc2626' },
    ];
    batches.forEach(b => {
      if (b.variancePct == null) return;
      const v = Number(b.variancePct);
      const bucket = varianceBuckets.find(x => v >= x.min && v < x.max);
      if (bucket) bucket.count += 1;
    });

    return {
      pendingApproval: pendingApproval.length,
      arrivalsPendingQC: arrivalsPendingQC.length,
      yieldNotRecorded: yieldNotRecorded.length,
      varianceFlagged: varianceFlagged.length,
      stalledBatches: stalledBatches.length,
      batchesInProgress,
      rawStockMT,
      daysOfCover,
      yieldLast7,
      completedThisWeek,
      board,
      yieldSeries,
      varianceBuckets,
    };
  }, [rawBatches, rawInventory, summary]);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-gray-100 rounded-xl" />
          <div className="grid grid-cols-4 gap-4">
            {[0,1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
          </div>
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  const totalActions = data.pendingApproval + data.arrivalsPendingQC + data.yieldNotRecorded + data.varianceFlagged + data.stalledBatches;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mill Operations</h1>
          <p className="text-sm text-gray-500 mt-0.5">Today's priorities and live batch status</p>
        </div>
        <button
          onClick={() => navigate('/milling?new=1')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> New Batch
        </button>
      </div>

      {/* Action Queue */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={18} className="text-amber-600" />
          <h2 className="text-base font-semibold text-gray-900">Needs Your Attention</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <ActionRow
            icon={Clock}
            label="Batches pending Owner approval"
            count={data.pendingApproval}
            to="/milling"
            accent="amber"
          />
          <ActionRow
            icon={Truck}
            label="Arrivals awaiting QC analysis"
            count={data.arrivalsPendingQC}
            to="/milling"
            accent="amber"
          />
          <ActionRow
            icon={Gauge}
            label="Batches completed — yield not recorded"
            count={data.yieldNotRecorded}
            to="/milling"
            accent="amber"
          />
          <ActionRow
            icon={FlaskConical}
            label="Batches with yield variance > 1%"
            count={data.varianceFlagged}
            to="/quality"
            accent="red"
          />
          <ActionRow
            icon={Clock}
            label="Batches stalled in progress (> 48h)"
            count={data.stalledBatches}
            to="/milling"
            accent="red"
          />
          {totalActions === 0 && (
            <div className="md:col-span-2 flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-900">
              <CheckCircle2 size={18} />
              <span className="text-sm font-medium">All caught up — mill floor is green.</span>
            </div>
          )}
        </div>
      </div>

      {/* Today's Ops KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI
          icon={Factory}
          label="Batches In Progress"
          value={data.batchesInProgress}
          accent="blue"
        />
        <KPI
          icon={Wheat}
          label="Raw Paddy Stock"
          value={formatMT(data.rawStockMT)}
          sub={data.daysOfCover != null ? `${data.daysOfCover} days of cover` : 'no recent consumption'}
          accent={data.daysOfCover != null && data.daysOfCover < 3 ? 'red' : 'amber'}
        />
        <KPI
          icon={Gauge}
          label="Yield (last 7 days)"
          value={data.yieldLast7 > 0 ? `${data.yieldLast7.toFixed(1)}%` : '—'}
          sub={`from ${data.completedThisWeek} completed batches`}
          accent="green"
        />
        <KPI
          icon={TrendingUp}
          label="Completed (7 days)"
          value={data.completedThisWeek}
          accent="purple"
        />
      </div>

      {/* Live Batch Board */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900">Live Batch Board</h2>
          </div>
          <Link to="/milling" className="text-xs text-blue-600 hover:underline">All batches →</Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <BatchColumn title="Queued" batches={data.board.queued} accent="slate" onBatchClick={(id) => navigate(`/milling/${id}`)} />
          <BatchColumn title="In Progress" batches={data.board.inProgress} accent="blue" onBatchClick={(id) => navigate(`/milling/${id}`)} />
          <BatchColumn title="Pending QC" batches={data.board.pendingQC} accent="amber" onBatchClick={(id) => navigate(`/milling/${id}`)} />
          <BatchColumn title="Pending Yield" batches={data.board.pendingYield} accent="amber" onBatchClick={(id) => navigate(`/milling/${id}`)} />
          <BatchColumn title="Completed Today" batches={data.board.completedToday} accent="green" onBatchClick={(id) => navigate(`/milling/${id}`)} />
        </div>
      </div>

      {/* Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Yield % by Batch</h2>
          <p className="text-xs text-gray-500 mb-3">Last 20 completed batches</p>
          {data.yieldSeries.length === 0 ? (
            <p className="text-sm text-gray-400 py-12 text-center">No completed batches yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.yieldSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="batch" tick={{ fontSize: 10 }} />
                <YAxis domain={[50, 75]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="yield" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Yield Variance Distribution</h2>
          <p className="text-xs text-gray-500 mb-3">How close are actual yields to plan?</p>
          {data.varianceBuckets.every(b => b.count === 0) ? (
            <p className="text-sm text-gray-400 py-12 text-center">No variance data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.varianceBuckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count">
                  {data.varianceBuckets.map((b, i) => (
                    <Cell key={i} fill={b.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
