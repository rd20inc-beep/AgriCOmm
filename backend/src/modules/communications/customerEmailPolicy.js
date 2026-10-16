/**
 * Automatic CUSTOMER emails (P5-12 / PLT-14).
 *
 * The automation hooks used to email buyers on their own — on advance and
 * balance confirmation (with the currency hard-coded to USD), BL-draft
 * approval, shipment departure and from the overdue scans — with no staff
 * review, and the shipment email fired before its transaction committed, so a
 * rolled-back shipment could still have told the buyer it sailed.
 *
 * Now:
 *   1. Every automatic customer email is OPT-IN PER EVENT. The switch lives in
 *      system_settings under `customer_email_events` as a JSON object
 *      ({ "shipment_departed": true, ... }). A missing row, a missing key, or
 *      anything but literal `true` means OFF — the default for every event.
 *   2. An email raised inside a transaction is sent only AFTER that
 *      transaction COMMITS (the outermost one, when savepoints are nested). A
 *      rollback sends nothing.
 *   3. A send failure is logged and never undoes the business write.
 *
 * Internal staff notifications (in-app notifications, tasks, the uploader's
 * own "document approved" email) are not customer emails and are not gated.
 */
const SETTING_KEY = 'customer_email_events';

const CUSTOMER_EMAIL_EVENTS = Object.freeze({
  advance_confirmed: 'Advance receipt confirmed — payment confirmation to the buyer',
  balance_confirmed: 'Balance receipt confirmed — payment confirmation to the buyer',
  bl_draft_approved: 'BL draft approved — balance reminder to the buyer',
  shipment_departed: 'Shipment departed — shipment notice to the buyer',
  overdue_advance: 'Overdue-advance scan — advance request to the buyer',
  overdue_balance: 'Overdue-balance scan — balance reminder to the buyer',
});

function parseSetting(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The per-event switches, every known event present (default false). */
async function getSettings(conn) {
  let raw = null;
  try {
    const row = await conn('system_settings').where({ key: SETTING_KEY }).first('value');
    raw = row ? row.value : null;
  } catch {
    raw = null; // no settings table → everything OFF
  }
  const parsed = parseSetting(raw);
  const out = {};
  for (const event of Object.keys(CUSTOMER_EMAIL_EVENTS)) out[event] = parsed[event] === true;
  return out;
}

/** True only when the owner has switched this event ON. */
async function isEnabled(conn, event) {
  if (!Object.prototype.hasOwnProperty.call(CUSTOMER_EMAIL_EVENTS, event)) return false;
  const settings = await getSettings(conn);
  return settings[event] === true;
}

// The outermost knex transaction a (possibly nested) transactor belongs to.
function rootTransaction(conn) {
  let t = conn && conn.isTransaction ? conn : null;
  while (t && t.parentTransaction) t = t.parentTransaction;
  return t;
}

function runSafely(fn, label) {
  return Promise.resolve()
    .then(fn)
    .catch((err) => console.error(`${label || 'Customer email'} failed:`, err && err.message));
}

/**
 * Run `fn` once `conn`'s outermost transaction has committed; never if it rolls
 * back. Outside a transaction (`conn` is the pool) it runs now. Returns a
 * promise that settles after `fn` ran or was dropped (tests await it).
 */
function afterCommit(conn, fn, label) {
  const root = rootTransaction(conn);
  if (!root || !root.executionPromise) return runSafely(fn, label);
  return root.executionPromise.then(
    () => runSafely(fn, label),
    () => undefined, // rolled back: nothing was committed, nothing is sent
  );
}

/**
 * Send a customer email for `event` if (and only if) it is switched on, after
 * the surrounding transaction commits. Returns { queued: boolean, done }.
 */
async function sendCustomerEmail(conn, event, sendFn) {
  if (!(await isEnabled(conn, event))) return { queued: false, done: Promise.resolve() };
  const done = afterCommit(conn, sendFn, `Customer email (${event})`);
  return { queued: true, done };
}

module.exports = {
  SETTING_KEY,
  CUSTOMER_EMAIL_EVENTS,
  getSettings,
  isEnabled,
  afterCommit,
  sendCustomerEmail,
  _rootTransaction: rootTransaction,
};
