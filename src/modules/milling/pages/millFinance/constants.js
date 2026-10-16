import { fmtPKR } from '../../../../shared/utils/format';

export const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });
// Was a Cr/L/k abbreviator; KPI cards now show the exact rupee figure.
export const COMPACT_PKR = (v) => fmtPKR(v || 0);

// The dashboard period (resolved on the server; fiscal year July–June, D-1).
export const PERIOD_OPTIONS = [['month', 'This month'], ['quarter', 'Quarter'], ['fytd', 'FY to date'], ['all', 'All time']];
export const DEFAULT_PERIOD = 'month';

export const EXPENSE_CATS = [
  'utilities', 'rent', 'maintenance', 'insurance',
  'transport', 'fuel', 'packaging', 'inspection', 'freight',
  'commission', 'miscellaneous',
];
// Category-specific extra field for the Add Expense drawer → saved to subcategory.
// Salaries are paid only through Payroll (P2-25), so they are not a head here.
export const CAT_DETAIL = {
  utilities:   { label: 'Utility type', options: ['Electricity', 'Water', 'Gas', 'Internet'] },
  fuel:        { label: 'Vehicle / equipment', placeholder: 'e.g. Generator, Truck LEX-123' },
  rent:        { label: 'Property / location', placeholder: 'e.g. Mill warehouse' },
  transport:   { label: 'Vehicle / route', placeholder: 'e.g. Lahore → Mill' },
  maintenance: { label: 'Asset / equipment', placeholder: 'e.g. Huller #2, boiler' },
  insurance:   { label: 'Policy number', placeholder: 'Policy #' },
  inspection:  { label: 'Inspection / lab', placeholder: 'e.g. SGS moisture test' },
  freight:     { label: 'Shipment / route', placeholder: '' },
  commission:  { label: 'Deal / party', placeholder: '' },
};
export const RECURRENCES = ['monthly', 'weekly', 'quarterly', 'yearly'];
export const WORKER_ROLES = ['operator', 'laborer', 'supervisor', 'driver', 'guard', 'cleaner'];
// Head Office staff carry different job titles — free-text with these suggestions.
export const HEAD_OFFICE_ROLES = ['Manager', 'Accountant', 'Officer', 'Clerk', 'Admin', 'Cashier', 'Executive'];
// The running-cost heads the old "Utilities" tab summed.
export const UTILITY_CATS = ['utilities', 'fuel', 'maintenance', 'rent'];
