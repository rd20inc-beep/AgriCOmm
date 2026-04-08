import { Link } from 'react-router-dom';
import {
  Banknote,
  ArrowRightLeft,
  TrendingUp,
  AlertCircle,
} from 'lucide-react';
import KPICard from '../../components/KPICard';

const fmt = (v) => '$' + (parseFloat(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtPKR = (v) => 'Rs ' + Math.round(parseFloat(v) || 0).toLocaleString('en-PK');

export default function KPICardsRow({
  activeOrders,
  advancePending,
  balancePending,
  shipmentsInTransit,
  millBatchesRunning,
  varianceAlerts,
  exportReceivables,
  exportProfit,
  millProfitPKR,
}) {
  const totalCashToCollect = (parseFloat(advancePending) || 0) + (parseFloat(balancePending) || 0);
  const overdueCount = parseFloat(advancePending) > 0 ? 1 : 0; // simplified — real impl would check due dates

  const attentionItems = [];
  if (varianceAlerts > 0) attentionItems.push(`${varianceAlerts} yield variance`);
  if (overdueCount > 0) attentionItems.push(`${overdueCount} overdue advance`);
  const attentionCount = varianceAlerts + overdueCount;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Cash to Collect */}
      <Link to="/finance/money-in" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
        <KPICard
          icon={Banknote}
          title="Cash to Collect"
          value={fmt(totalCashToCollect)}
          color="amber"
          lines={[
            { label: 'Advances due', value: fmt(advancePending) },
            { label: 'Balances due', value: fmt(balancePending) },
            { label: 'Total receivables', value: fmt(exportReceivables) },
          ]}
        />
      </Link>

      {/* 2. Orders in Motion */}
      <Link to="/export" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
        <KPICard
          icon={ArrowRightLeft}
          title="Orders in Motion"
          color="blue"
          lines={[
            { label: 'Active orders', value: String(activeOrders) },
            { label: 'In transit', value: String(shipmentsInTransit) },
            { label: 'Mill batches', value: String(millBatchesRunning) + ' running' },
          ]}
        />
      </Link>

      {/* 3. Profit */}
      <Link to="/finance/profit" className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
        <KPICard
          icon={TrendingUp}
          title="Profit"
          color="green"
          lines={[
            { label: 'Export (USD)', value: fmt(exportProfit) },
            { label: 'Mill (PKR)', value: fmtPKR(millProfitPKR) },
          ]}
        />
      </Link>

      {/* 4. Needs Attention */}
      <Link to={varianceAlerts > 0 ? '/quality' : '/finance/money-in'} className="block hover:ring-2 hover:ring-blue-200 rounded-xl transition-all">
        <KPICard
          icon={AlertCircle}
          title="Needs Attention"
          value={attentionCount === 0 ? 'All clear' : `${attentionCount} items`}
          subtitle={attentionItems.length > 0 ? attentionItems.join(', ') : 'No issues found'}
          color={attentionCount > 0 ? 'red' : 'green'}
          trend={attentionItems.length > 0 ? attentionItems.join(', ') : 'No issues found'}
        />
      </Link>
    </div>
  );
}
