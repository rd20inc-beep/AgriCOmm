import { todayLocalISO } from '../../../shared/utils/format';
// Workflow steps — static config. Ship on the advance (2026-10-07): the order
// ships once the advance is confirmed and the pre-shipment documents approved;
// the balance (and BL Final) are collected after sailing, before Close.
// `statuses` are the order statuses a step covers; `status` is the one a
// pipeline click filters on. The legacy 'Awaiting Balance' sits on Ready to
// Ship: its documents are done and it can ship on the advance.
export const workflowSteps = [
  { step: 1, label: 'Order Created', status: 'Draft', statuses: ['Draft'] },
  { step: 2, label: 'Advance', status: 'Awaiting Advance', statuses: ['Awaiting Advance'] },
  { step: 3, label: 'Production', status: 'In Milling', statuses: ['Advance Received', 'Procurement Pending', 'In Milling'] },
  { step: 4, label: 'Docs', status: 'Docs In Preparation', statuses: ['Docs In Preparation'] },
  { step: 5, label: 'Ready to Ship', status: 'Ready to Ship', statuses: ['Ready to Ship', 'Awaiting Balance'] },
  { step: 6, label: 'Shipped', status: 'Shipped', statuses: ['Shipped'] },
  { step: 7, label: 'Balance', status: 'Balance Due', statuses: ['Arrived'] },
  { step: 8, label: 'Closed', status: 'Closed', statuses: ['Closed'] },
];

export function workflowStepFor(status) {
  return workflowSteps.find((s) => s.statuses.includes(status)) || null;
}

// Where an owed balance is collected (mirrors backend balanceCollection.js):
// after sailing, plus the legacy 'Awaiting Balance' stage.
export const BALANCE_COLLECTION_STATUSES = ['Awaiting Balance', 'Shipped', 'Arrived'];

export function balanceOutstanding(order) {
  return Math.max(0, (Number(order?.balanceExpected) || 0) - (Number(order?.balanceReceived) || 0));
}

export function isBalanceDue(order) {
  return !!order && BALANCE_COLLECTION_STATUSES.includes(order.status) && balanceOutstanding(order) > 0.01;
}

// #2 Financial status track — the advance-confirmation lifecycle, shown as a
// separate pill from the operational status. Mirrors export_orders.financial_status
// (migration 276) and the client's Financial Status list.
export const financialStatusMeta = {
  'Not Required':        { label: 'No Advance', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  'Advance Not Entered': { label: 'Advance Not Entered', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  'Advance Entered':     { label: 'Advance Entered', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  'Pending Confirmation':{ label: 'Pending Finance Confirmation', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  'Partially Confirmed': { label: 'Advance Partially Confirmed', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  'Confirmed':           { label: 'Advance Confirmed', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  'Rejected':            { label: 'Advance Rejected', cls: 'bg-red-100 text-red-700 border-red-200' },
};

export const documentLabels = {
  phyto: 'Phytosanitary Certificate',
  blDraft: 'Bill of Lading (Draft)',
  blFinal: 'Bill of Lading (Final)',
  invoice: 'Commercial Invoice',
  packingList: 'Packing List',
  coo: 'Certificate of Origin',
  fumigation: 'Fumigation Certificate',
};

export const tabList = [
  { key: 'overview', label: 'Overview' },
  { key: 'financials', label: 'Financials' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'packing', label: 'Packing' },
  { key: 'printedBags', label: 'Printed Bags' },
  { key: 'documents', label: 'Documents' },
  { key: 'shipment', label: 'Shipment' },
  { key: 'timeline', label: 'Timeline' },
];

/**
 * Returns the subset of tabs relevant for the current order status.
 * Overview and Timeline are always visible. Other tabs appear once the
 * workflow reaches the stage where they become actionable.
 */
export function getVisibleTabs(status) {
  // Always-visible (packing specs are set at creation, always relevant).
  // Documents belongs here too: the proforma invoice and sales contract are
  // what the buyer is sent in order to OBTAIN the advance, so gating the tab
  // on the workflow made the export manager wait for the very payment those
  // documents exist to request. Every document generates from whatever data
  // the order has, leaving later fields blank until they are known.
  const visible = ['overview', 'packing', 'printedBags', 'documents', 'timeline'];

  // Financials: visible from Awaiting Advance onwards (payment related)
  const financialsFrom = ['Awaiting Advance', 'Advance Received', 'Procurement Pending',
    'In Milling', 'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship',
    'Shipped', 'Arrived', 'Closed'];
  if (financialsFrom.includes(status)) visible.push('financials');

  // Procurement: visible from Awaiting Advance onwards (#2 decouple — operational
  // milling / sourcing can proceed while the advance is pending confirmation).
  const procurementFrom = ['Awaiting Advance', 'Advance Received', 'Procurement Pending', 'In Milling',
    'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship', 'Shipped', 'Arrived', 'Closed'];
  if (procurementFrom.includes(status)) visible.push('procurement');

  // Shipment: visible from In Milling onwards. Vessel, booking and containers
  // are arranged while the rice is still milling; only the ATD/ATA dates (which
  // ship/arrive the order) wait for Ready to Ship — see canRecordDeparture.
  const shipmentFrom = ['In Milling', 'Docs In Preparation', 'Awaiting Balance',
    'Ready to Ship', 'Shipped', 'Arrived', 'Closed'];
  if (shipmentFrom.includes(status)) visible.push('shipment');

  return tabList.filter(t => visible.includes(t.key));
}

export const today = () => todayLocalISO();

// Helper: check if all required documents are approved
export function allDocsApproved(docs) {
  if (!docs || typeof docs !== 'object') return false;
  const required = ['phyto', 'blDraft', 'invoice', 'packingList'];
  return required.every(key => docs[key]?.status === 'Approved');
}

export function allDocsFinal(docs) {
  if (!docs || typeof docs !== 'object') return false;
  const values = Object.values(docs);
  return values.length > 0 && values.every(d => d?.status === 'Approved');
}
