// Mill-only payers (owner decision 2026-10-05: the Mill Operator gets full mill
// access, company finance stays closed).
//
// The payment routes accept finance.confirm_payment OR a mill permission
// (milling.edit). Someone who came in WITHOUT finance.confirm_payment may only
// move money for the mill: pay a payable whose entity is 'mill', take a receipt
// on a mill receivable or a mill local sale, through a mill account. The
// handlers check this on the row they already read under lock, so the rule is
// enforced where the money moves, not only on the screen. Reversals stay on
// finance.confirm_payment alone.
const { userHasPermission } = require('../middleware/rbac');

// True when the caller reached the payment route through the MILL permission
// (milling.edit) and holds none of the permissions that allow paying anything:
// finance.confirm_payment always, plus what the caller adds (inventory.create on
// local sales, whose holders were never restricted by entity). The route only
// admits those permissions, so "not unrestricted" here means "came in on
// milling.edit".
async function isMillOnlyPayer(req, extraUnrestricted = []) {
  if (await userHasPermission(req, 'finance', 'confirm_payment')) return false;
  for (const [module, action] of extraUnrestricted) {
    if (await userHasPermission(req, module, action)) return false;
  }
  return userHasPermission(req, 'milling', 'edit');
}

function millOnlyError(message) {
  const e = new Error(message);
  e.statusCode = 403;
  e.status = 403; // localSales.controller reads .status
  return e;
}

// Refuse a row that does not belong to the mill.
function assertMillEntity(entity, what) {
  if (String(entity || '').toLowerCase() !== 'mill') {
    throw millOnlyError(`You can only record payments on mill ${what}. This one belongs to ${entity || 'another part of the business'} — ask Finance.`);
  }
}

// Refuse an account that is not one of the mill's own.
async function assertMillAccount(trx, accountId) {
  if (!accountId) return;
  const acct = await trx('bank_accounts').where({ id: accountId }).first();
  if (!acct || String(acct.entity || '').toLowerCase() !== 'mill') {
    throw millOnlyError('Choose one of the mill\'s own accounts — other accounts are paid from by Finance.');
  }
}

// A local-sale receipt: an explicit account must be the mill's, and cash with
// no account must land in the mill's float, not Head Office petty cash.
async function assertMillReceipt(trx, { bankAccountId, paymentMethod, collectionLocation }) {
  if (bankAccountId) return assertMillAccount(trx, bankAccountId);
  if (paymentMethod === 'cash' && collectionLocation === 'Head Office') {
    throw millOnlyError('Cash collected at Head Office goes into Head Office cash — ask Finance to record it.');
  }
}

module.exports = { isMillOnlyPayer, assertMillEntity, assertMillAccount, assertMillReceipt, millOnlyError };
