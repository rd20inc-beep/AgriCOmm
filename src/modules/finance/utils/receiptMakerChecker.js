// Export receipts are maker-checker: whoever recorded a pending receipt does
// not confirm it — the server answers 403 (exportReceipts.assertNotSelfConfirm).
// An Owner or Super Admin may confirm their own. The screens use this to hide
// Confirm on a receipt the viewer recorded instead of letting them hit the 403.
export const SELF_CONFIRM_ROLES = ['Owner', 'Super Admin'];

// `p` is a pending receipt from GET /export-orders/pending-receipts (camelCased),
// `user` the signed-in user from AuthContext.
export function isOwnPendingReceipt(p, user) {
  if (!p || !user || p.createdBy == null || user.id == null) return false;
  if (SELF_CONFIRM_ROLES.includes(user.role)) return false;
  return String(p.createdBy) === String(user.id);
}

export const OWN_RECEIPT_NOTE = 'You recorded this — another Finance user confirms it';
