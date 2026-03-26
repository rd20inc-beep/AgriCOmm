// Workflow steps — static config
export const workflowSteps = [
  { step: 1, label: 'Order Created', status: 'Draft' },
  { step: 2, label: 'Awaiting Advance', status: 'Awaiting Advance' },
  { step: 3, label: 'Advance Received', status: 'Advance Received' },
  { step: 4, label: 'Procurement', status: 'Procurement Pending' },
  { step: 5, label: 'In Milling', status: 'In Milling' },
  { step: 6, label: 'Docs Preparation', status: 'Docs In Preparation' },
  { step: 7, label: 'Awaiting Balance', status: 'Awaiting Balance' },
  { step: 8, label: 'Shipped', status: 'Shipped' },
  { step: 9, label: 'Arrived', status: 'Arrived' },
  { step: 10, label: 'Closed', status: 'Closed' },
];

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
  { key: 'documents', label: 'Documents' },
  { key: 'shipment', label: 'Shipment' },
  { key: 'timeline', label: 'Timeline' },
];

export const today = () => new Date().toISOString().split('T')[0];

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
