// The expense catalogue — kinds, categories and their usual payees — and the
// body POST /api/expenses reads. Shared by the New expense drawer and the
// Expenses view.
import {
  Building2, Zap, Truck, Receipt, Briefcase, Coins, Ship, Factory, User, FileText,
} from 'lucide-react';

// ─── Category catalogue ─────────────────────────────────────────────
// Each category declares the *kind* of vendor it usually has so the
// form can show the right suggestions instead of always offering the
// full suppliers list (which is meant for rice suppliers).
//
// vendorKind:
//   'utility'  → utility companies (KE, SSGC, WAPDA, etc.)
//   'supplier' → real rows from suppliersList (rice transport vendors)
//   'bank'     → bank accounts (charges, fees)
//   'landlord' → free text (rent)
//   'agent'    → free text (clearing agent, freight forwarder)
//   'staff'    → free text (salaries, wages)
//   'free'     → free text only
export const TYPES = [
  { value: 'general',  label: 'General / Office', icon: Briefcase },
  { value: 'mill',     label: 'Mill Operations',  icon: Factory },
  { value: 'export',   label: 'Export Order',     icon: Ship },
  { value: 'personal', label: 'Personal / Owner', icon: User },
];

// apiCategory: when set, the Provider input fetches the dropdown
// options from the DB-backed expense_vendors table (managed in Admin →
// Expense Vendors) instead of the hardcoded vendorKind suggestions.
// Anything else falls through to the legacy vendorKind path below.
export const CATEGORIES = {
  general: [
    { value: 'utility_bill',      label: 'Utility Bill (Electricity, Gas, Water)', icon: Zap,         vendorKind: 'utility',  apiCategory: 'utilities' },
    { value: 'rent',              label: 'Office / Warehouse Rent',                icon: Building2,    vendorKind: 'landlord', apiCategory: 'rent' },
    { value: 'insurance',         label: 'Insurance',                              icon: FileText,     vendorKind: 'free',     apiCategory: 'insurance' },
    { value: 'license',           label: 'License / Permit',                       icon: FileText,     vendorKind: 'free' },
    { value: 'professional_fees', label: 'Professional Fees (Audit, Legal, Tax)',  icon: Briefcase,    vendorKind: 'free' },
    { value: 'office_supplies',   label: 'Office Supplies',                        icon: Receipt,      vendorKind: 'free' },
    { value: 'bank_charges',      label: 'Bank Charges',                           icon: Coins,        vendorKind: 'bank' },
    { value: 'inspection',        label: 'Inspection Fee',                         icon: FileText,     vendorKind: 'free',     apiCategory: 'inspection' },
    { value: 'transport',         label: 'Transport / Delivery',                   icon: Truck,        vendorKind: 'supplier', apiCategory: 'transport' },
    { value: 'miscellaneous',     label: 'Other / Miscellaneous',                  icon: Receipt,      vendorKind: 'free' },
  ],
  mill: [
    { value: 'electricity',       label: 'Electricity',                            icon: Zap,          vendorKind: 'utility',  apiCategory: 'utilities' },
    { value: 'diesel',            label: 'Diesel / Fuel',                          icon: Truck,        vendorKind: 'free',     apiCategory: 'fuel' },
    { value: 'maintenance',       label: 'Maintenance / Repair',                   icon: Briefcase,    vendorKind: 'free',     apiCategory: 'maintenance' },
    { value: 'labor',             label: 'Labor / Daily Wages',                    icon: User,         vendorKind: 'staff' },
    { value: 'salaries',          label: 'Salaries',                               icon: User,         vendorKind: 'staff' },
    { value: 'transport',         label: 'Transport (Rice)',                       icon: Truck,        vendorKind: 'supplier', apiCategory: 'transport' },
    { value: 'inspection',        label: 'Inspection / Testing',                   icon: FileText,     vendorKind: 'free',     apiCategory: 'inspection' },
    { value: 'fumigation',        label: 'Fumigation',                             icon: FileText,     vendorKind: 'free' },
    { value: 'bags',              label: 'Bags / Packaging',                       icon: Receipt,      vendorKind: 'supplier', apiCategory: 'packaging' },
    { value: 'rent',              label: 'Mill Rent',                              icon: Building2,    vendorKind: 'landlord', apiCategory: 'rent' },
    { value: 'insurance',         label: 'Mill Insurance',                         icon: FileText,     vendorKind: 'free',     apiCategory: 'insurance' },
    { value: 'miscellaneous',     label: 'Other Mill Expense',                     icon: Receipt,      vendorKind: 'free' },
  ],
  export: [
    { value: 'clearing',          label: 'Clearing / Customs',                     icon: Ship,         vendorKind: 'agent',    apiCategory: 'inspection' },
    { value: 'freight',           label: 'Freight / Shipping',                     icon: Ship,         vendorKind: 'agent',    apiCategory: 'freight' },
    { value: 'transport',         label: 'Transport (Port / Inland)',              icon: Truck,        vendorKind: 'supplier', apiCategory: 'transport' },
    { value: 'inspection',        label: 'Inspection (SGS, etc.)',                 icon: FileText,     vendorKind: 'agent',    apiCategory: 'inspection' },
    { value: 'insurance',         label: 'Cargo Insurance',                        icon: FileText,     vendorKind: 'free',     apiCategory: 'insurance' },
    { value: 'commission',        label: 'Agent Commission',                       icon: Briefcase,    vendorKind: 'agent',    apiCategory: 'commission' },
    { value: 'documentation',     label: 'Documentation Fees',                     icon: FileText,     vendorKind: 'agent' },
    { value: 'bags',              label: 'Bags / Special Packing',                 icon: Receipt,      vendorKind: 'supplier', apiCategory: 'packaging' },
    { value: 'miscellaneous',     label: 'Other Export Cost',                      icon: Receipt,      vendorKind: 'free' },
  ],
  personal: [
    { value: 'personal_expense',  label: 'Personal Expense',                       icon: User,         vendorKind: 'free' },
    { value: 'travel',            label: 'Travel',                                 icon: Truck,        vendorKind: 'free' },
    { value: 'entertainment',     label: 'Entertainment / Meals',                  icon: Receipt,      vendorKind: 'free' },
    { value: 'vehicle',           label: 'Vehicle / Fuel',                         icon: Truck,        vendorKind: 'free' },
    { value: 'medical',           label: 'Medical',                                icon: FileText,     vendorKind: 'free' },
    { value: 'miscellaneous',     label: 'Other Personal',                         icon: Receipt,      vendorKind: 'free' },
  ],
};

// Common Pakistani utility companies — pre-populated suggestions for
// utility / electricity categories so users don't have to type them.
export const UTILITY_VENDORS = [
  'K-Electric (KE)',
  'WAPDA / DISCOs',
  'LESCO',
  'IESCO',
  'GEPCO',
  'FESCO',
  'MEPCO',
  'SSGC (Sui Southern Gas)',
  'SNGPL (Sui Northern Gas)',
  'KWSB (Karachi Water)',
  'WASA',
  'PTCL',
  'Internet Provider',
];

/** The body POST /api/expenses reads. Pure, for the tests. */
export function expenseCreatePayload(form, vendorKind) {
  const personal = form.expense_type === 'personal';
  return {
    expense_type: personal ? 'general' : form.expense_type,
    category: form.category,
    subcategory: personal ? 'personal' : null,
    amount: Number(form.amount),
    currency: form.currency,
    // Only send supplier_id when the kind actually maps to suppliers.
    // Utility / landlord / bank / staff / free always go via free-text vendor_name.
    supplier_id: vendorKind === 'supplier' && form.supplier_id ? Number(form.supplier_id) : null,
    vendor_name: form.vendor_name || (personal ? form.owner_name : null),
    expense_date: form.expense_date,
    due_date: form.due_date || null,
    invoice_reference: form.invoice_reference || null,
    description: form.description + (personal && form.owner_name ? ` [Owner: ${form.owner_name}]` : ''),
    batch_id: form.batch_id ? Number(form.batch_id) : null,
    order_id: form.order_id ? Number(form.order_id) : null,
    pay_now: form.pay_now,
    bank_account_id: form.pay_now && form.bank_account_id ? Number(form.bank_account_id) : null,
    payment_method: form.pay_now ? form.payment_method : null,
  };
}
