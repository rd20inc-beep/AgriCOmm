// Payment terms for export orders / buyers — the standard menu used in
// rice export contracts. Ordered by typical frequency in our trade flow:
// CAD and LC tenors first (most common), then advance / open account.
//
// Used by:
//   - Buyers form (default per buyer)
//   - CreateExportOrder form (per-order override)
//   - ExportOrder OverviewTab specs editor
//
// Free-text is still allowed in the specs editor for one-off variations,
// so this list is a guide-rail, not a hard constraint.

export const PAYMENT_TERMS = [
  'CAD',
  'LC at Sight',
  'LC 30 Days',
  'LC 60 Days',
  'LC 90 Days',
  'LC 120 Days',
  'Advance (100%)',
  'Partial Advance + Balance LC',
  'Net 15',
  'Net 30',
  'Net 45',
  'Net 60',
  'Open Account',
];

// Quick lookup of the LC tenor in days, for any LC term. Returns null
// for non-LC or sight terms.
export function lcTenorDays(term) {
  if (!term) return null;
  const m = String(term).match(/^LC\s+(\d+)\s*Days$/i);
  return m ? parseInt(m[1], 10) : null;
}
