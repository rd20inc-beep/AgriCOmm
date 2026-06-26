import React from 'react';
import { ArrowRight } from 'lucide-react';

function fmt(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function TimelineTab({ order }) {
  const sortedLog = [...(order.activityLog || [])].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-6">Activity Log</h3>
      <div className="space-y-0">
        {sortedLog.map((entry, index) => (
          <div key={index} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-blue-500 mt-1.5" />
              {index < sortedLog.length - 1 && (
                <div className="w-0.5 flex-1 min-h-[32px] bg-gray-200" />
              )}
            </div>
            <div className="pb-6 min-w-0">
              <p className="text-sm text-gray-900">{entry.action}</p>
              {(entry.fromStatus || entry.toStatus) && (entry.action !== `Status changed: ${entry.fromStatus} → ${entry.toStatus}`) && (
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {entry.fromStatus && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">{entry.fromStatus}</span>
                  )}
                  {entry.fromStatus && entry.toStatus && <ArrowRight className="w-3 h-3 text-gray-400" />}
                  {entry.toStatus && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700">{entry.toStatus}</span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-500">{fmt(entry.date)}</span>
                {entry.by && <span className="text-xs text-gray-400">· by {entry.by}</span>}
              </div>
            </div>
          </div>
        ))}
        {sortedLog.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-8">No activity logged yet.</p>
        )}
      </div>
    </div>
  );
}
