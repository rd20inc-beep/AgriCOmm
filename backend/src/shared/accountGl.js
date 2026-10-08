/**
 * Every cash / bank account has its own GL account (owner decision G-8,
 * 2026-10-09). bank_accounts.gl_account_id names it; the account sits under
 * 1000 Cash & Bank in the chart (parent_id), so the trial balance shows each
 * account and the group still rolls up to one Cash & Bank figure.
 *
 * Every writer that posts the cash / bank side of a journal resolves the line
 * here — never `chart_of_accounts.code = '1000'` directly. An account with no
 * GL link (a row inserted outside createBankAccount) falls back to the 1000
 * control account and says so in the log, so the gap is visible rather than
 * silently pooled.
 */
const CASH_CONTROL_CODE = '1000';
// Per-account codes are allocated 1011…1099 under the 1000 group, skipping the
// codes already in the chart (1020, 1030 … from the original seed).
const FIRST_CODE = 1011;
const LAST_CODE = 1099;

async function controlAccount(trx) {
  return trx('chart_of_accounts').where({ code: CASH_CONTROL_CODE }).first();
}

/**
 * The GL account a bank / cash account posts to. `account` is a bank_accounts
 * row or its id. Returns a chart_of_accounts row; falls back to 1000 (logged)
 * when the account has no link, and returns null only when 1000 itself is
 * missing (the caller reports that as a missing account).
 */
async function glAccountFor(trx, account) {
  let acct = account;
  if (acct != null && typeof acct !== 'object') acct = await trx('bank_accounts').where({ id: acct }).first();
  if (acct && acct.gl_account_id) {
    const gl = await trx('chart_of_accounts').where({ id: acct.gl_account_id }).first();
    if (gl) return gl;
  }
  if (acct) {
    console.warn(`[accountGl] bank account #${acct.id} (${acct.name || '?'}) has no GL account — posting to ${CASH_CONTROL_CODE}.`);
  }
  return controlAccount(trx);
}

/** The first free per-account code. Pure; exported for tests. */
function nextFreeCode(existingCodes) {
  const taken = new Set((existingCodes || []).map(String));
  for (let c = FIRST_CODE; c <= LAST_CODE; c += 1) {
    if (!taken.has(String(c))) return String(c);
  }
  throw new Error(`No free GL code left in ${FIRST_CODE}–${LAST_CODE} for a new cash / bank account.`);
}

/**
 * Give a bank account its own GL account when it has none: a new Asset under
 * 1000, named after the account, in the account's currency and entity.
 * Idempotent. Returns the chart_of_accounts row.
 */
async function ensureAccountGl(trx, account) {
  const acct = typeof account === 'object' ? account : await trx('bank_accounts').where({ id: account }).first();
  if (!acct) return null;
  if (acct.gl_account_id) {
    const gl = await trx('chart_of_accounts').where({ id: acct.gl_account_id }).first();
    if (gl) return gl;
  }
  const parent = await controlAccount(trx);
  const codes = await trx('chart_of_accounts').where('code', 'like', '10%').pluck('code');
  const code = nextFreeCode(codes);
  const [gl] = await trx('chart_of_accounts').insert({
    code,
    name: String(acct.name || `Account #${acct.id}`).slice(0, 255),
    type: 'Asset',
    sub_type: acct.type === 'cash' ? 'cash' : 'bank',
    parent_id: parent ? parent.id : null,
    entity: ['general', 'mill', 'export'].includes(acct.entity) ? acct.entity : null,
    currency: String(acct.currency || 'PKR').toUpperCase(),
    is_active: true,
    is_system: true,
    normal_balance: 'debit',
    description: `Cash / bank account #${acct.id}`,
  }).returning('*');
  await trx('bank_accounts').where({ id: acct.id }).update({ gl_account_id: gl.id });
  return gl;
}

/** Ids of the 1000 control account and every account under it. */
async function cashGroupAccountIds(trx) {
  const parent = await controlAccount(trx);
  if (!parent) return [];
  const kids = await trx('chart_of_accounts').where({ parent_id: parent.id }).pluck('id');
  return [parent.id, ...kids];
}

/**
 * Journal lines being mirrored (a signed-delta reversal) that sit on the 1000
 * control account were posted before per-account GL existed; the
 * reclassification moved that money onto the account's own GL, so the delta
 * has to come off there too. `pick(line)` names the bank account a control
 * line belongs to (or null to leave it on 1000). Lines already on an account's
 * own GL are returned untouched.
 */
async function remapControlLines(trx, lines, pick) {
  const control = await controlAccount(trx);
  if (!control) return lines;
  const out = [];
  for (const l of lines) {
    const acctId = String(l.account_id) === String(control.id) ? pick(l) : null;
    if (!acctId) { out.push(l); continue; }
    const gl = await glAccountFor(trx, acctId);
    out.push(gl && String(gl.id) !== String(control.id) ? { ...l, account_id: gl.id, account: gl.name } : l);
  }
  return out;
}

module.exports = {
  CASH_CONTROL_CODE, controlAccount, glAccountFor, ensureAccountGl, nextFreeCode, cashGroupAccountIds,
  remapControlLines,
};
