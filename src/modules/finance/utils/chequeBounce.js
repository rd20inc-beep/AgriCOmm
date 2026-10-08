// Marking an uncleared cheque bounced (owner decision B1) — the form rules,
// shared by the Transaction drawer, the Cheques view and Needs Attention.
// POST /api/finance/payments/:id/bounce takes { reason, bank_charge?,
// charge_date?, charge_account_id? } and refuses a cleared or reversed cheque.

/** Why Bounce cannot be submitted yet, or null. */
export function bounceFormError({ reason, charge, accountId }) {
  if (!String(reason || '').trim()) return 'Give the reason the bank returned it.';
  const c = charge === '' || charge == null ? 0 : Number(charge);
  if (!Number.isFinite(c) || c < 0) return 'The bank charge must be 0 or more.';
  if (c > 0 && !accountId) return 'Choose the account the bank charged.';
  return null;
}

/** The request body: the charge fields only when there is a charge. */
export function bouncePayload({ reason, charge, chargeDate, accountId }) {
  const body = { reason: String(reason || '').trim() };
  const c = charge === '' || charge == null ? 0 : Number(charge);
  if (c > 0) {
    body.bank_charge = Math.round(c * 100) / 100;
    if (chargeDate) body.charge_date = chargeDate;
    if (accountId) body.charge_account_id = Number(accountId);
  }
  return body;
}

/** A cheque row (Cheques view / Needs Attention) the Bounce action applies to. */
export const canBounceItem = (x) => !!(x && x.paymentId && (x.kind === 'cheque' || x.kind == null));
