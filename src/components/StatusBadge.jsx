const statusStyles = {
  'Draft': 'bg-gray-100 text-gray-600 ring-gray-200',
  'Awaiting Advance': 'bg-amber-50 text-amber-700 ring-amber-200',
  'Advance Received': 'bg-blue-50 text-blue-700 ring-blue-200',
  'Procurement Pending': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  'In Milling': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  'Docs In Preparation': 'bg-purple-50 text-purple-700 ring-purple-200',
  'Awaiting Balance': 'bg-orange-50 text-orange-700 ring-orange-200',
  'Ready to Ship': 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  'Shipped': 'bg-blue-50 text-blue-600 ring-blue-200',
  'Arrived': 'bg-emerald-50 text-emerald-600 ring-emerald-200',
  'Closed': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'On Hold': 'bg-red-50 text-red-600 ring-red-200',
  'Cancelled': 'bg-red-50 text-red-700 ring-red-200',
  'Pending': 'bg-gray-100 text-gray-600 ring-gray-200',
  'Approved': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'Draft Uploaded': 'bg-blue-50 text-blue-700 ring-blue-200',
  'Under Review': 'bg-yellow-50 text-yellow-700 ring-yellow-200',
  'Rejected': 'bg-red-50 text-red-700 ring-red-200',
  'In Progress': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  'Completed': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'Queued': 'bg-gray-100 text-gray-500 ring-gray-200',
  'Pending Approval': 'bg-amber-50 text-amber-700 ring-amber-200',
  'Received': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'Partial': 'bg-amber-50 text-amber-700 ring-amber-200',
  'Overdue': 'bg-red-50 text-red-700 ring-red-200',
  'Paid': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'Disputed': 'bg-red-50 text-red-600 ring-red-200',
  'Expired': 'bg-gray-100 text-gray-500 ring-gray-200',
};

// Dot colors for compact variant
const dotColors = {
  'Draft': 'bg-gray-400', 'Pending': 'bg-gray-400', 'Queued': 'bg-gray-400',
  'Awaiting Advance': 'bg-amber-500', 'Pending Approval': 'bg-amber-500', 'Partial': 'bg-amber-500',
  'Advance Received': 'bg-blue-500', 'Shipped': 'bg-blue-500', 'In Progress': 'bg-blue-500',
  'Procurement Pending': 'bg-indigo-500', 'In Milling': 'bg-indigo-500',
  'Approved': 'bg-emerald-500', 'Completed': 'bg-emerald-500', 'Closed': 'bg-emerald-500',
  'Arrived': 'bg-emerald-500', 'Received': 'bg-emerald-500', 'Paid': 'bg-emerald-500',
  'Rejected': 'bg-red-500', 'Cancelled': 'bg-red-500', 'Overdue': 'bg-red-500',
  'On Hold': 'bg-red-500', 'Disputed': 'bg-red-500', 'Expired': 'bg-gray-400',
};

export default function StatusBadge({ status, variant = 'default' }) {
  const classes = statusStyles[status] || 'bg-gray-100 text-gray-600 ring-gray-200';
  const dot = dotColors[status] || 'bg-gray-400';

  if (variant === 'dot') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        {status}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset ${classes}`}>
      {status}
    </span>
  );
}
