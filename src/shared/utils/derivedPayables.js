// The payables feed (GET /finance/payables, /milling/payables) merges real
// payables with rows DERIVED from cost tables: MC-<id> (a batch's milling
// cost), EC-<id> (an export cost with no bill yet) and ME-<id> (a legacy mill
// expense). A derived row has no payable behind it, so no payment endpoint can
// settle it (POST /finance/payments needs a numeric payable id) — Money Out and
// Mill Finance show where it is settled instead of a Pay button.

const DERIVED_ID = /^(MC|EC|ME)-\d+$/;

/** True for a cost-derived row that has no payable to pay against. */
export function isDerivedPayable(row) {
  if (!row) return false;
  if (row.derived === true) return true;
  return DERIVED_ID.test(String(row.id ?? row.payNo ?? ''));
}

/** Where a derived row is settled, for the tooltip / drawer note. */
export function derivedPayableHint(row) {
  if (row?.settleHint) return row.settleHint;
  const id = String(row?.id ?? row?.payNo ?? '');
  if (id.startsWith('EC-')) return 'Export cost with no bill yet — pay it from Finance ▸ Purchases (Export cost).';
  if (id.startsWith('ME-')) return 'Legacy mill expense with no payable — record it as an expense to pay it.';
  return 'Cost from the batch cost sheet — there is no bill to pay against here. Settle it with the supplier or transporter (Mill Finance ▸ Suppliers, or their statement).';
}
