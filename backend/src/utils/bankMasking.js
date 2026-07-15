// Server-side masking of sensitive banking identifiers on export documents.
//
// Two independent gates decide what a rendered document may expose:
//   - viewer gate  (canSeeFull): the requesting user holds finance.view_bank_details
//                                (Super Admin / Owner bypass). If not, the account
//                                number and IBAN are reduced to their last 4 chars.
//   - audience gate (audience) : a document addressed to the customer may only
//                                carry a bank account explicitly approved for
//                                external sharing; otherwise the banking block is
//                                withheld entirely. (Bound to a document's audience
//                                in a later phase; internal audience never withholds.)
//
// Masking is always applied here on the server so a masked value never leaves the
// API — the client can't "un-mask" what it never received.

function maskTail(value, keep = 4) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  const compact = s.replace(/\s+/g, '');
  if (compact.length <= keep) return s;
  return '•••• ' + compact.slice(-keep);
}

/**
 * Return a copy of the assembled bank object with sensitive fields masked
 * according to the viewer's permission and the document's audience.
 * @param {object|null} bank  company.bank object (title/name/branch/account/iban/swift/correspondent...)
 * @param {{canSeeFull?: boolean, audience?: 'internal'|'bank'|'chamber'|'customer', approvedForCustomer?: boolean}} opts
 */
function maskBank(bank, opts = {}) {
  if (!bank) return bank;
  const { canSeeFull = false, audience = 'internal', approvedForCustomer = false } = opts;

  // Customer-facing documents may only show an externally-approved account.
  if (audience === 'customer' && !approvedForCustomer) {
    return { withheld: true, title: bank.title || '', name: bank.name || '' };
  }

  const out = { ...bank };
  if (out.correspondent) out.correspondent = { ...out.correspondent };

  if (!canSeeFull) {
    out.account = maskTail(out.account);
    out.iban = maskTail(out.iban);
    if (out.correspondent) out.correspondent.account = maskTail(out.correspondent.account);
    out.masked = true;
  }
  return out;
}

module.exports = { maskBank, maskTail };
