import { Link, useNavigate } from 'react-router-dom';

const pipelineStatuses = [
  'Draft',
  'Awaiting Advance',
  'Advance Received',
  'Procurement Pending',
  'In Milling',
  'Docs In Preparation',
  'Awaiting Balance',
  'Shipped',
  'Arrived',
  'Closed',
];

const pipelineColors = {
  Draft: 'border-gray-400',
  'Awaiting Advance': 'border-amber-500',
  'Advance Received': 'border-emerald-500',
  'Procurement Pending': 'border-orange-500',
  'In Milling': 'border-blue-500',
  'Docs In Preparation': 'border-violet-500',
  'Awaiting Balance': 'border-yellow-500',
  Shipped: 'border-cyan-500',
  Arrived: 'border-teal-500',
  Closed: 'border-slate-500',
};

const pipelineBg = {
  Draft: 'bg-gray-50',
  'Awaiting Advance': 'bg-amber-50',
  'Advance Received': 'bg-emerald-50',
  'Procurement Pending': 'bg-orange-50',
  'In Milling': 'bg-blue-50',
  'Docs In Preparation': 'bg-violet-50',
  'Awaiting Balance': 'bg-yellow-50',
  Shipped: 'bg-cyan-50',
  Arrived: 'bg-teal-50',
  Closed: 'bg-slate-50',
};

export default function OrderPipeline({ pipelineCounts }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
          Order Pipeline
        </h2>
        <Link to="/export" className="text-xs text-blue-600 hover:text-blue-800 font-medium">View All &rarr;</Link>
      </div>
      <div className="flex gap-2 sm:gap-3 overflow-x-auto pb-2">
        {pipelineStatuses.map((status) => (
          <div
            key={status}
            onClick={() => navigate('/export?status=' + encodeURIComponent(status))}
            className={`flex-shrink-0 min-w-[120px] rounded-lg border-l-4 ${pipelineColors[status]} ${pipelineBg[status]} px-4 py-3 cursor-pointer hover:shadow-md transition-shadow`}
          >
            <div className="text-2xl font-bold text-gray-900">
              {pipelineCounts[status] || 0}
            </div>
            <div className="text-xs font-medium text-gray-600 mt-0.5 leading-tight">
              {status}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
