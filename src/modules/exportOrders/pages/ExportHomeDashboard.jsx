import { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Ship, AlertTriangle, Clock, FileText, CreditCard,
  TrendingUp, Users, Package, ArrowRight, Plus, CheckCircle2,
} from 'lucide-react';
import { useExportOrders, useCustomers } from '../../../api/queries';
import { workflowSteps } from '../components/constants';

function formatUSD(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}

function KPI({ icon: Icon, label, value, sub, accent = 'blue' }) {
  const accents = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg ${accents[accent]}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function ActionItem({ icon: Icon, label, count, to, accent = 'amber' }) {
  const colors = {
    amber: 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100',
    red: 'bg-red-50 border-red-200 text-red-900 hover:bg-red-100',
    blue: 'bg-blue-50 border-blue-200 text-blue-900 hover:bg-blue-100',
  };
  if (count === 0) return null;
  return (
    <Link
      to={to}
      className={`flex items-center justify-between p-3 rounded-lg border ${colors[accent]} transition-colors`}
    >
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

export default function ExportHomeDashboard() {
  const navigate = useNavigate();
  const { data: orders = [], isLoading: ordersLoading } = useExportOrders({});
  const { data: customers = [] } = useCustomers({});

  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const active = orders.filter(o => !['Closed', 'Cancelled'].includes(o.status));
    const closed = orders.filter(o => o.status === 'Closed');
    const closedMTD = closed.filter(o => new Date(o.createdAt) >= monthStart);

    const bookedRevenueMTD = orders
      .filter(o => new Date(o.createdAt) >= monthStart)
      .reduce((s, o) => s + (Number(o.contractValue) || 0), 0);

    const shippedWithETD = orders.filter(o => o.etd && o.atd);
    const avgDaysToShip = shippedWithETD.length > 0
      ? Math.round(
          shippedWithETD.reduce((s, o) => s + daysBetween(o.createdAt, o.atd), 0)
            / shippedWithETD.length
        )
      : null;

    // Pipeline grouping by status
    const pipelineSteps = workflowSteps.filter(s => !['Draft', 'Closed', 'Cancelled'].includes(s.status));
    const pipeline = pipelineSteps.map(step => {
      const ordersInStep = orders.filter(o => o.status === step.status);
      return {
        ...step,
        count: ordersInStep.length,
        value: ordersInStep.reduce((s, o) => s + (Number(o.contractValue) || 0), 0),
      };
    });

    // Action queue
    const awaitingAdvance = orders.filter(o => o.status === 'Awaiting Advance').length;

    const docsLagging = orders.filter(o => {
      if (o.status !== 'Docs In Preparation') return false;
      const updatedAt = o.updatedAt || o.createdAt;
      return daysBetween(updatedAt, now) > 3;
    }).length;

    const shipmentsMissingFields = orders.filter(o => {
      if (!['Ready to Ship', 'Shipped'].includes(o.status)) return false;
      return !o.vesselName || !o.bookingNo || !o.fiNumber;
    }).length;

    const balanceOverdue = orders.filter(o => {
      if (o.status !== 'Awaiting Balance') return false;
      const etd = o.etd ? new Date(o.etd) : null;
      return etd && etd < now;
    }).length;

    // Upcoming shipments
    const upcoming = orders
      .filter(o => o.etd && new Date(o.etd) >= now && new Date(o.etd) <= in14Days)
      .sort((a, b) => new Date(a.etd) - new Date(b.etd))
      .slice(0, 8);

    // Recent orders (last 5)
    const recentOrders = [...orders]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);

    // New buyers in last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const newBuyers = customers
      .filter(c => c.createdAt && new Date(c.createdAt) >= thirtyDaysAgo)
      .slice(0, 3);

    return {
      activeCount: active.length,
      closedMTDCount: closedMTD.length,
      bookedRevenueMTD,
      avgDaysToShip,
      pipeline,
      awaitingAdvance,
      docsLagging,
      shipmentsMissingFields,
      balanceOverdue,
      upcoming,
      recentOrders,
      newBuyers,
    };
  }, [orders, customers]);

  if (ordersLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-gray-100 rounded-xl" />
          <div className="grid grid-cols-4 gap-4">
            {[0,1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
          </div>
          <div className="h-48 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Export Desk</h1>
          <p className="text-sm text-gray-500 mt-0.5">Active orders, shipments, and action items</p>
        </div>
        <button
          onClick={() => navigate('/export/create')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> New Order
        </button>
      </div>

      {/* Action Queue */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={18} className="text-amber-600" />
          <h2 className="text-base font-semibold text-gray-900">Needs Your Attention</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <ActionItem
            icon={CreditCard}
            label="Orders awaiting advance payment"
            count={stats.awaitingAdvance}
            to="/export?status=Awaiting+Advance"
            accent="amber"
          />
          <ActionItem
            icon={FileText}
            label="Document prep running > 3 days"
            count={stats.docsLagging}
            to="/export?status=Docs+In+Preparation"
            accent="amber"
          />
          <ActionItem
            icon={Ship}
            label="Shipments missing vessel/FI/BL"
            count={stats.shipmentsMissingFields}
            to="/export?status=Ready+to+Ship"
            accent="red"
          />
          <ActionItem
            icon={Clock}
            label="Balance overdue (ETD passed)"
            count={stats.balanceOverdue}
            to="/export?status=Awaiting+Balance"
            accent="red"
          />
          {stats.awaitingAdvance + stats.docsLagging + stats.shipmentsMissingFields + stats.balanceOverdue === 0 && (
            <div className="md:col-span-2 flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-900">
              <CheckCircle2 size={18} />
              <span className="text-sm font-medium">All caught up — no action items.</span>
            </div>
          )}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI icon={Ship} label="Active Orders" value={stats.activeCount} accent="blue" />
        <KPI icon={TrendingUp} label="Booked Revenue (MTD)" value={formatUSD(stats.bookedRevenueMTD)} accent="green" />
        <KPI
          icon={Clock}
          label="Avg Order → Ship"
          value={stats.avgDaysToShip != null ? `${stats.avgDaysToShip}d` : '—'}
          sub={stats.avgDaysToShip != null ? 'based on shipped orders' : 'no shipped orders yet'}
          accent="amber"
        />
        <KPI icon={CheckCircle2} label="Closed (MTD)" value={stats.closedMTDCount} accent="green" />
      </div>

      {/* Pipeline Strip */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Order Pipeline</h2>
          <Link to="/export" className="text-xs text-blue-600 hover:underline">View all orders →</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {stats.pipeline.map((step) => (
            <button
              key={step.status}
              onClick={() => navigate(`/export?status=${encodeURIComponent(step.status)}`)}
              className="p-3 text-left border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide truncate">{step.label}</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{step.count}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{formatUSD(step.value)}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Upcoming Shipments + Recent Buyers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Ship size={18} className="text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900">Upcoming Shipments (next 14 days)</h2>
          </div>
          {stats.upcoming.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No shipments scheduled in the next 14 days.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {stats.upcoming.map(o => (
                <Link
                  key={o.id}
                  to={`/export/${o.id}`}
                  className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{o.id} · {o.customerName}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {o.productName} · {o.qtyMT} MT · {o.destinationPort || o.country}
                    </p>
                  </div>
                  <div className="text-right ml-4">
                    <p className="text-sm font-medium text-gray-900">{new Date(o.etd).toLocaleDateString('en-GB')}</p>
                    <p className="text-xs text-gray-500">{o.vesselName || 'No vessel'}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={18} className="text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900">Recent Orders</h2>
          </div>
          {stats.recentOrders.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No orders yet.</p>
          ) : (
            <div className="space-y-2">
              {stats.recentOrders.map(o => (
                <Link
                  key={o.id}
                  to={`/export/${o.id}`}
                  className="block p-2 rounded hover:bg-gray-50 transition-colors"
                >
                  <p className="text-sm font-medium text-gray-900 truncate">{o.id}</p>
                  <p className="text-xs text-gray-500 truncate">{o.customerName} · {o.status}</p>
                </Link>
              ))}
            </div>
          )}
          {stats.newBuyers.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">New buyers (30d)</p>
              {stats.newBuyers.map(b => (
                <p key={b.id} className="text-xs text-gray-700 py-0.5 truncate">{b.name}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
