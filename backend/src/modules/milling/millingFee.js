// The batch's processing fee per kg (P4-02 / MIL-02). 0 is a real value — the
// form sends 0 because milling cost lives on the cost sheet (milling_costs) —
// so a missing or invalid fee is 0, never a default Rs 5/kg. It used to be
// `fee ? fee : 5`, which turned every 0 into 5. Nothing costs, values or
// reports with the fee any more; it is kept on the batch as entered.
function feePerKg(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

module.exports = { feePerKg };
