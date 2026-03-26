import { Link } from 'react-router-dom';
import {
  ShoppingCart,
  Clock,
  DollarSign,
  Ship,
  Factory,
  AlertTriangle,
  CreditCard,
  TrendingUp,
} from 'lucide-react';
import KPICard from '../../components/KPICard';

function formatCurrency(value) {
  return '$' + (parseFloat(value) || 0).toLocaleString('en-US');
}

const formatPKR = (value) => 'Rs ' + Math.round(parseFloat(value) || 0).toLocaleString('en-PK');

export default function KPICardsRow({
  entityFilter,
  activeOrders,
  advancePending,
  balancePending,
  shipmentsInTransit,
  millBatchesRunning,
  millingBatchesTotal,
  varianceAlerts,
  exportReceivables,
  exportReceivablesOrderCount,
  exportProfit,
  millProfitPKR,
}) {
  return (
    <div className="kpi-grid">
      {entityFilter !== 'Mill' && (
        <>
          <Link to="/export" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
            <KPICard
              icon={ShoppingCart}
              title="Active Export Orders"
              value={activeOrders}
              subtitle="Excl. Draft / Closed / Cancelled"
              trend="+2 this month"
              color="blue"
            />
          </Link>
          <Link to="/finance/confirmations" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
            <KPICard
              icon={Clock}
              title="Advance Pending"
              value={formatCurrency(advancePending)}
              subtitle="Awaiting customer advances"
              trend="1 overdue"
              color="amber"
            />
          </Link>
          <Link to="/finance/confirmations" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
            <KPICard
              icon={DollarSign}
              title="Balance Pending"
              value={formatCurrency(balancePending)}
              subtitle="Pre-shipment balances due"
              trend="3 orders"
              color="orange"
            />
          </Link>
          <Link to="/export?status=Shipped" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
            <KPICard
              icon={Ship}
              title="Shipments In Transit"
              value={shipmentsInTransit}
              subtitle="Currently on water"
              trend="ETA tracking active"
              color="cyan"
            />
          </Link>
        </>
      )}
      {entityFilter !== 'Export' && (
        <>
          <Link to="/milling" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
            <KPICard
              icon={Factory}
              title="Mill Batches Running"
              value={millBatchesRunning}
              subtitle="Currently in production"
              trend={`${millingBatchesTotal} total batches`}
              color="violet"
            />
          </Link>
          <Link to="/quality" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
            <KPICard
              icon={AlertTriangle}
              title="Variance Alerts"
              value={varianceAlerts}
              subtitle="Batches exceeding 1% threshold"
              trend={varianceAlerts > 0 ? 'Needs review' : 'All clear'}
              color="red"
            />
          </Link>
        </>
      )}
      {entityFilter !== 'Mill' && (
        <>
          <Link to="/finance/receivables" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
            <KPICard
              icon={CreditCard}
              title="Export Receivables"
              value={formatCurrency(exportReceivables)}
              subtitle="Outstanding from customers"
              trend={`${exportReceivablesOrderCount} orders`}
              color="emerald"
            />
          </Link>
          <Link to="/finance/profitability" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
            <KPICard
              icon={TrendingUp}
              title="Export Profit"
              value={formatCurrency(exportProfit)}
              subtitle="Export division (USD)"
              trend="Current period"
              color="green"
            />
          </Link>
        </>
      )}
      {entityFilter !== 'Export' && (
        <Link to="/finance/profitability" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
          <KPICard
            icon={TrendingUp}
            title="Mill Profit"
            value={formatPKR(millProfitPKR)}
            subtitle="Milling division (PKR)"
            trend="Current period"
            color="green"
          />
        </Link>
      )}
    </div>
  );
}
