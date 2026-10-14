/**
 * Default cost categories for export orders and milling batches.
 * Extracted from AppContext — these are static reference data.
 */

// Never an export-order expense (P2-05): the rice is costed from stock at
// shipment (5020/1230) and milling is derived from the batch. The server
// refuses them; the UI doesn't offer them.
export const INTERNAL_EXPORT_COST_CATEGORIES = ['rice', 'raw_rice', 'milling'];
export const isInternalExportCostCategory = (key) =>
  INTERNAL_EXPORT_COST_CATEGORIES.includes(String(key || '').trim().toLowerCase());

export const EXPORT_COST_CATEGORIES = [
  { key: 'bags', label: 'Bags / Packaging' },
  { key: 'loading', label: 'Loading' },
  { key: 'clearing', label: 'Clearing Agent' },
  { key: 'freight', label: 'Freight' },
  { key: 'inspection', label: 'Inspection / SGS' },
  { key: 'fumigation', label: 'Fumigation' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'commission', label: 'Commission / Brokerage' },
  { key: 'misc', label: 'Miscellaneous' },
];

export const MILLING_COST_CATEGORIES = [
  { key: 'rawRice', label: 'Raw Rice Purchase', section: 'material' },
  { key: 'transport', label: 'Transport / Freight', section: 'process' },
  { key: 'unloading', label: 'Unloading', section: 'process' },
  { key: 'labor', label: 'Labor / Wages', section: 'process' },
  { key: 'drying', label: 'Drying', section: 'process' },
  { key: 'processing', label: 'Milling / Processing', section: 'process' },
  { key: 'sortex', label: 'Sorting / Sortex', section: 'process' },
  { key: 'packing', label: 'Bagging / Packing', section: 'process' },
  { key: 'stitching', label: 'Stitching / Loading', section: 'process' },
  { key: 'electricity', label: 'Electricity / Fuel', section: 'process' },
  { key: 'commission', label: 'Commission / Brokerage', section: 'process' },
  { key: 'rent', label: 'Rent / Facility', section: 'overhead' },
  { key: 'maintenance', label: 'Maintenance / Repairs', section: 'overhead' },
  { key: 'other', label: 'Other Direct Costs', section: 'overhead' },
];
