// One source for how a proforma describes payment, so the Payment Terms box
// and the Payment clause can't contradict each other (PI-004 printed
// "0% Advance / 100% Against BL" in the box and "Payment: CAD" in clause 2).
//
// Inputs: the order's advance % and its free-text payment terms (order-level,
// else the customer's default). The balance is described by the terms when
// they exist; only with no terms does it fall back to the BL-copy / documents
// defaults the proforma always used.

const SHORT_TERMS_MAX = 24;

/** Short name for the balance basis, e.g. "CAD", "L/C at sight", "Against BL". */
export function balanceLabel(terms) {
  const t = (terms || '').trim();
  if (!t) return 'Against BL';
  if (/cash against doc|\bcad\b/i.test(t)) return 'CAD';
  if (/\bd\s*\/\s*p\b|documents against payment/i.test(t)) return 'D/P';
  if (/\bd\s*\/\s*a\b|documents against acceptance/i.test(t)) return 'D/A';
  if (/\bl\s*\/?\s*c\b|letter of credit/i.test(t)) return /sight/i.test(t) ? 'L/C at sight' : 'L/C';
  if (/\bbl\b|b\/l|bill of lading/i.test(t)) return 'Against BL';
  if (t.length <= SHORT_TERMS_MAX) return t;
  return 'As per terms';
}

/**
 * @param {{ advancePct?: number|string, paymentTerms?: string, customerPaymentTerms?: string }} order
 * @returns {{ advancePct: number, balancePct: number, terms: string, isLC: boolean,
 *             payMethod: string, boxTitle: string, boxSubtitle: string, clause: string }}
 */
export function describePaymentTerms(order = {}) {
  const advancePct = Math.min(100, Math.max(0, parseFloat(order.advancePct) || 0));
  const balancePct = 100 - advancePct;
  const terms = (order.paymentTerms || order.customerPaymentTerms || '').trim();
  const isLC = /\bl\s*\/?\s*c\b|letter of credit/i.test(terms);
  const payMethod = isLC ? 'an irrevocable Letter of Credit (L/C) at sight' : 'TT (Telegraphic Transfer)';
  // With no stated terms the defaults differ by advance: balance against the
  // BL copy after an advance, otherwise against shipping documents at sight.
  const basis = terms ? balanceLabel(terms) : (advancePct > 0 ? 'Against BL' : 'Against Docs');

  const boxTitle = advancePct > 0 ? `${advancePct}% Advance` : 'No Advance';
  const boxSubtitle = balancePct > 0 ? `${balancePct}% ${basis}` : 'Paid in advance';

  let clause;
  if (advancePct >= 100) {
    clause = `100% advance payment via ${payMethod} before shipment.`;
  } else if (terms) {
    // The stated terms always appear. When they already spell out the advance
    // ("20% Advance / 80% Against BL") they are the whole clause; otherwise the
    // advance is described in front of them.
    const end = /[.!]$/.test(terms) ? '' : '.';
    clause = /advance/i.test(terms) ? `${terms}${end}` : advancePct > 0
      ? `${advancePct}% advance via ${payMethod} before production; balance ${balancePct}% — ${terms}${end}`
      : `${terms}${end}`;
  } else {
    clause = advancePct > 0
      ? `${advancePct}% advance via ${payMethod} before production; balance ${balancePct}% against presentation of a scanned copy of the Bill of Lading.`
      : '100% against presentation of shipping documents at sight, unless otherwise agreed.';
  }

  return { advancePct, balancePct, terms, isLC, payMethod, boxTitle, boxSubtitle, clause };
}
