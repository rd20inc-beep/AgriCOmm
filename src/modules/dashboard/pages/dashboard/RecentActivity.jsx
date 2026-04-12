import { Link } from 'react-router-dom';
import {
  CircleDollarSign,
  FileText,
  Factory,
  AlertTriangle,
  Ship,
  ArrowRightLeft,
  Activity,
} from 'lucide-react';

const activityIcons = {
  finance: CircleDollarSign,
  document: FileText,
  mill: Factory,
  alert: AlertTriangle,
  shipment: Ship,
  transfer: ArrowRightLeft,
};

const activityColors = {
  finance: 'bg-emerald-100 text-emerald-600',
  document: 'bg-blue-100 text-blue-600',
  mill: 'bg-orange-100 text-orange-600',
  alert: 'bg-red-100 text-red-600',
  shipment: 'bg-cyan-100 text-cyan-600',
  transfer: 'bg-violet-100 text-violet-600',
};

export default function RecentActivity({ activities }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
          Recent Activity
        </h2>
        <Link to="/finance/ledger" className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All &rarr;</Link>
      </div>
      <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
        {activities.map((item) => {
          const IconComponent = activityIcons[item.type] || Activity;
          const colorClass = activityColors[item.type] || 'bg-gray-100 text-gray-600';
          return (
            <div key={item.id} className="flex items-start gap-3">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${colorClass}`}
              >
                <IconComponent className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-800 leading-snug">
                  {item.action}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-500">{item.by}</span>
                  <span className="text-gray-300">&middot;</span>
                  <span className="text-xs text-gray-400">{item.time}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
