// One colour per status word, app-wide. Tones: gray = not started / inert,
// amber = waiting on someone, blue/indigo/cyan/purple = moving, emerald =
// done, red = stopped or owed. Keys are Title Case; lookups ignore case, and
// stored snake_case / lowercase words ('partially_paid') are shown and matched
// as Title Case ('Partially Paid').
const GRAY = 'bg-gray-100 text-gray-600 ring-gray-200';
const MUTED = 'bg-gray-100 text-gray-500 ring-gray-200';
const AMBER = 'bg-amber-50 text-amber-700 ring-amber-200';
const YELLOW = 'bg-yellow-50 text-yellow-700 ring-yellow-200';
const BLUE = 'bg-blue-50 text-blue-700 ring-blue-200';
const INDIGO = 'bg-indigo-50 text-indigo-700 ring-indigo-200';
const CYAN = 'bg-cyan-50 text-cyan-700 ring-cyan-200';
const PURPLE = 'bg-purple-50 text-purple-700 ring-purple-200';
const VIOLET = 'bg-violet-50 text-violet-700 ring-violet-200';
const GREEN = 'bg-emerald-50 text-emerald-700 ring-emerald-200';
const RED = 'bg-red-50 text-red-700 ring-red-200';

const statusStyles = {
  // Export orders
  'Draft': GRAY,
  'Awaiting Advance': AMBER,
  'Advance Received': BLUE,
  'Procurement Pending': INDIGO,
  'In Milling': INDIGO,
  'Docs In Preparation': PURPLE,
  'Awaiting Balance': AMBER,
  'Ready to Ship': CYAN,
  'Shipped': BLUE,
  'Arrived': GREEN,
  'Closed': GREEN,
  'On Hold': RED,
  'Cancelled': RED,
  // Shipment stage (export order list)
  'Not Booked': GRAY,
  'Booked': CYAN,
  'In Transit': BLUE,
  // Generic workflow
  'Pending': GRAY,
  'Queued': MUTED,
  'Submitted': AMBER,
  'Pending Approval': AMBER,
  'Pending Review': YELLOW,
  'Under Review': YELLOW,
  'Approved': GREEN,
  'Rejected': RED,
  'In Progress': INDIGO,
  'Scheduled': BLUE,
  'Completed': GREEN,
  'Confirmed': GREEN,
  'Pending Finance Confirmation': AMBER,
  'Expired': MUTED,
  'Active': GREEN,
  'Inactive': MUTED,
  'Pass': GREEN,
  'Fail': RED,
  'Failed': RED,
  // Documents
  'Draft Uploaded': BLUE,
  'Final': GREEN,
  'Revised': MUTED,
  'Sent to Bank': BLUE,
  'Sent to Chamber': BLUE,
  'Issued to Customer': GREEN,
  // Quotations, debit/credit notes, messages
  'Sent': BLUE,
  'Accepted': GREEN,
  'Issued': AMBER,
  'Applied': GREEN,
  'Delivered': GREEN,
  // Money
  'Received': GREEN,
  'Partial': AMBER,
  'Partially Paid': AMBER,
  'Overdue': RED,
  'Paid': GREEN,
  'Unpaid': RED,
  'Invoiced': BLUE,
  'Disputed': RED,
  'Written Off': MUTED,
  'Credit': BLUE,
  'Refunded': RED,
  'Voided': MUTED,
  'Returned': MUTED,
  // Payroll runs and advances
  'Prepared': AMBER,
  'Accrued': VIOLET,
  'Outstanding': AMBER,
  'Recovered': GREEN,
  // Finance (reconciliation, suspense, transfers)
  'Matched': GREEN,
  'Open': BLUE,
  'Partially Resolved': INDIGO,
  'Resolved': GREEN,
  'Reversed': MUTED,
  'Awaiting you': AMBER,
  'Awaiting mill': AMBER,
  'Posted': GREEN,
  'Allocated': GREEN,
  'Unallocated': RED,
  'Snoozed': YELLOW,
  'Escalated': RED,
  'Acknowledged': BLUE,
  // Inventory: lot, stock-count, purchase-requirement and sample statuses
  'Available': GREEN,
  'Reserved': AMBER,
  'Released': MUTED,
  'Consumed': MUTED,
  'Depleted': MUTED,
  'Sold': MUTED,
  'Damaged': RED,
  'Planned': GRAY,
  'Counted': AMBER,
  'Adjusted': BLUE,
  'Ordered': BLUE,
  'Purchased': GREEN,
  'Fulfilled': GREEN,
  'Partially Received': AMBER,
  'Fully Received': GREEN,
  'Dispatched': BLUE,
  'Converted': MUTED,
  'Shortlisted': BLUE,
  'Hold': AMBER,
  'Reanalysis Required': AMBER,
  'Approved for Purchase': GREEN,
  // Service (toll) milling lot stage
  'Milled': INDIGO,
  'In Stock': AMBER,
  'Partially Dispatched': AMBER,
  'Fully Dispatched': GREEN,
};

// Spelled out in full so Tailwind's class scanner keeps them.
export const DOTS = {
  gray: 'bg-gray-400', amber: 'bg-amber-500', yellow: 'bg-yellow-500', blue: 'bg-blue-500',
  indigo: 'bg-indigo-500', cyan: 'bg-cyan-500', purple: 'bg-purple-500', violet: 'bg-violet-500',
  emerald: 'bg-emerald-500', red: 'bg-red-500',
};

const byLowerKey = Object.fromEntries(Object.entries(statusStyles).map(([k, v]) => [k.toLowerCase(), v]));

/** 'partially_paid' / 'prepared' → 'Partially Paid' / 'Prepared'; anything else unchanged. */
export function statusText(status) {
  if (typeof status !== 'string' || !/^[a-z][a-z_]*$/.test(status)) return status;
  return status.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Badge classes for a status word (gray when unknown). */
export function statusStyle(status) {
  const text = statusText(status);
  return (typeof text === 'string' && byLowerKey[text.toLowerCase()]) || GRAY;
}
