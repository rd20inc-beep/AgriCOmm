// Resolve the operational cash account for a cash flow, honouring the entity that
// owns the money. The Mill's cash lives in the dedicated 'Mill Cash' account
// (bank_accounts.entity = 'mill'); Head Office / general cash lives in Office Petty
// Cash (entity = 'general'). An explicit collectionLocation ('Mill' | 'Head Office')
// wins when present — e.g. a mill sale whose cash was physically collected at Head
// Office lands in Office Petty Cash. Falls back to any active cash account if the
// entity-specific one is missing.
async function resolveCashAccountId(trx, { entity = 'general', collectionLocation = null } = {}) {
  let wantsMill;
  if (collectionLocation === 'Mill') wantsMill = true;
  else if (collectionLocation === 'Head Office') wantsMill = false;
  else wantsMill = entity === 'mill';

  const target = wantsMill ? 'mill' : 'general';
  let acct = await trx('bank_accounts').where({ type: 'cash', is_active: true, entity: target }).orderBy('id').first();
  if (!acct) acct = await trx('bank_accounts').where({ type: 'cash', is_active: true }).orderBy('id').first();
  return acct ? acct.id : null;
}

module.exports = { resolveCashAccountId };

// The account a payment moves money through. An explicit account wins. Cash with
// none resolves the paying entity's cash float, exactly as expenses do. A
// post-dated cheque needs none yet — it moves money when it clears. Any other
// payment without an account is refused: it used to be recorded and journalled
// to 1000 Cash & Bank while no cash or bank account moved, so the GL and the
// account balances drifted apart one payment at a time.
async function resolvePaymentAccountId(trx, { bankAccountId, method, entity = 'general', isPostDated = false }) {
  if (bankAccountId) return bankAccountId;
  if (isPostDated) return null;
  if (method === 'cash') {
    const id = await resolveCashAccountId(trx, { entity });
    if (id) return id;
    const e = new Error('No active cash account is set up. Add one, or choose the account the money moves through.');
    e.statusCode = 400;
    throw e;
  }
  const e = new Error('Choose the account the money moves through.');
  e.statusCode = 400;
  throw e;
}

module.exports.resolvePaymentAccountId = resolvePaymentAccountId;
