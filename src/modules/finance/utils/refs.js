// Trim long reference numbers down to something human-scannable in a
// dense table cell. Long form is always available on hover via the
// title attribute on the calling site.
//
//   RCV-ADV-EX-008      → ADV·EX-008
//   RCV-BAL-EX-008      → BAL·EX-008
//   LS-0001             → LS-1
//   PAY-EXP0004         → EXP-4
//   PAY-001             → PAY-1
//   LOT-20260512-0181   → LOT-181
//   JE-202605-0019      → JE-19
//   PAY-EXP0004 etc.    → strips leading zeros from the trailing sequence
export function shortenRef(ref) {
  const s = String(ref || '').trim();
  if (!s) return '';

  // Receivable advance / balance for an export order
  const recv = s.match(/^RCV-(ADV|BAL)-(.+)$/i);
  if (recv) return `${recv[1].toUpperCase()}·${recv[2]}`;

  // Local sale
  const ls = s.match(/^LS-0*(\d+)$/i);
  if (ls) return `LS-${ls[1]}`;

  // Payable referencing an expense ledger
  const payExp = s.match(/^PAY-EXP0*(\d+)$/i);
  if (payExp) return `EXP-${payExp[1]}`;

  // Generic payable / payment
  const pay = s.match(/^PAY-0*(\d+)$/i);
  if (pay) return `PAY-${pay[1]}`;

  // Inventory lot: LOT-YYYYMMDD-NNNN → LOT-NNN
  const lot = s.match(/^LOT-\d{8}-0*(\d+)$/i);
  if (lot) return `LOT-${lot[1]}`;

  // Journal: JE-YYYYMM-NNNN → JE-NNN
  const je = s.match(/^JE-\d{6}-0*(\d+)$/i);
  if (je) return `JE-${je[1]}`;

  return s;
}
