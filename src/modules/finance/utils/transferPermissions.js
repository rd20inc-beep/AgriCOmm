// Who may accept a Head Office ⇄ Mill transfer — the receiving side, as the
// server decides it (finance.routes.js authorizeTransferAccept): money landing
// at Head Office ('general') needs finance.confirm_payment, money landing at
// the Mill needs milling.edit.
export function canAcceptTransfer(transfer, hasPermission) {
  if (!transfer || typeof hasPermission !== 'function') return false;
  const to = String(transfer.toEntity || transfer.to_entity || '').toLowerCase();
  if (to === 'general') return hasPermission('finance', 'confirm_payment');
  if (to === 'mill') return hasPermission('milling', 'edit');
  return false;
}
