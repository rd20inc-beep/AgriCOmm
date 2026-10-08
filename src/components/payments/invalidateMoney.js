// Every list a recorded payment can move. One payment touches the document,
// the account, the ledger and the party's statement, so they all refresh.
const AFFECTED = [
  ['receivables'], ['payables'], ['finance'], ['finance-overview'], ['bank-accounts'], ['bank-transactions'],
  ['finance-bank-transactions'], ['payments-feed'], ['purchases-feed'], ['purchases'], ['expenses'], ['local-sales'],
  ['export', 'pending-receipts'], ['export-orders'], ['journals'], ['party-statement'], ['finance-transaction'],
  ['service-milling'], ['mill-expenses'], ['mill-cash-flow'], ['hauler-ledger'],
];
export function invalidateMoney(qc) {
  for (const queryKey of AFFECTED) qc.invalidateQueries({ queryKey });
}
