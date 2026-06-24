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
