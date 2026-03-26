import React from 'react';

export default function TimelineTab({ order }) {
  const sortedLog = [...order.activityLog].sort((a, b) => new Date(b.date) - new Date(a.date));

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
            <div className="pb-6">
              <p className="text-sm text-gray-900">{entry.action}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500">{entry.date}</span>
                <span className="text-xs text-gray-400">by {entry.by}</span>
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
