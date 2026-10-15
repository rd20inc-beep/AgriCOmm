/**
 * P3-05 / P3-06 — true up 1250 Bags & Packaging to the mill store's value with
 * ONE Owner-approved adjustment journal. Never edits a stock row, an average
 * cost, a movement or an existing journal.
 *
 *   node scripts/correctStoreValuation.js                     dry run: the journal it WOULD post
 *   APPLY_STORE_TRUE_UP=1 APPROVED_BY_OWNER_ID=<user id> \
 *     REASON="..." EXPECTED_DIFFERENCE=<amount> node scripts/correctStoreValuation.js
 *
 * Writing needs all four: the flag, the Owner who approved it (an active
 * Owner user — recorded in approval_authorizations), a reason, and the
 * difference the Owner signed off (from the dry run). If the books moved since
 * the dry run the figure no longer matches and nothing is written.
 *
 * The journal moves 1250 by (store value − GL 1250) against 1290 Suspense —
 * DR 1250 / CR 1290 when the store holds more than 1250, the reverse when it
 * holds less. Suspense is the holding account: the accountant reclassifies it
 * to the real cause (an expense, a prior-period correction) through the
 * Suspense screen. No other counter-account is assumed.
 *
 * Output is counts and amounts of the two totals only.
 * Runbook: docs/runbooks/mill-store-1250-tie-out.md
 */
require('dotenv').config();

const APPLY = process.env.APPLY_STORE_TRUE_UP === '1';
const OWNER = parseInt(process.env.APPROVED_BY_OWNER_ID, 10) || null;
const REASON = String(process.env.REASON || '').trim();
const EXPECTED = process.env.EXPECTED_DIFFERENCE;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

async function plan(db) {
  const { detect } = require('./detectStoreValuation');
  const d = await detect(db);
  // + : the store holds more than 1250 → DR 1250.
  const adjust = r2(d.storeValue - d.gl1250);
  return { ...d, adjust };
}

async function apply(db, { ownerId, reason, expected, today = new Date().toISOString().slice(0, 10) }) {
  const accounting = require('../src/modules/accounting/accounting.service');
  return db.transaction(async (trx) => {
    const owner = await trx('users as u').join('roles as r', 'r.id', 'u.role_id')
      .where({ 'u.id': ownerId, 'r.name': 'Owner', 'u.is_active': true }).first('u.id');
    if (!owner) throw new Error('APPROVED_BY_OWNER_ID is not an active Owner.');
    if (reason.length < 5) throw new Error('REASON is required.');
    // Lock the store and the 1250 lines' source of truth for the duration.
    await trx.raw('LOCK TABLE mill_stock, mill_items IN SHARE MODE');
    const p = await plan(trx);
    if (expected == null || Math.abs(r2(expected) - r2(-p.adjust)) > 0.01) {
      throw new Error(`The difference is now ${(-p.adjust).toFixed(2)}, not the ${expected} approved — re-run the dry run and get it re-approved.`);
    }
    if (Math.abs(p.adjust) < 0.01) return { posted: false, ...p };
    const [store, sus] = await Promise.all([
      trx('chart_of_accounts').where({ code: '1250' }).first(),
      trx('chart_of_accounts').where({ code: '1290' }).first(),
    ]);
    if (!store || !sus) throw new Error('Chart of accounts is missing 1250 / 1290.');
    const amt = Math.abs(p.adjust);
    const line = (c, dr, cr) => ({ account_id: c.id, account: c.name, debit: dr, credit: cr, narration: `${dr > 0 ? 'DR' : 'CR'} ${c.code} ${c.name} — mill store true-up` });
    const j = await accounting.createJournal(trx, {
      date: today, entity: 'mill', refType: 'Mill Store True-up', refNo: `MST-${today}`,
      description: `Mill store true-up: 1250 to the store's value (approved by owner #${ownerId}) — ${reason.slice(0, 150)}`,
      currency: 'PKR', fxRate: 1, isAuto: false, userId: ownerId,
      lines: p.adjust > 0 ? [line(store, amt, 0), line(sus, 0, amt)] : [line(sus, amt, 0), line(store, 0, amt)],
    });
    await accounting.postJournal(trx, j.id);
    await trx('approval_authorizations').insert({
      kind: 'mill_store_true_up', ref: String(j.id), action: 'approve',
      performed_by: ownerId, authorized_by_owner_id: ownerId, self_approved: true, verification: null,
    });
    return { posted: true, journalId: j.id, ...p };
  });
}

async function main() {
  const db = require('../src/config/database');
  try {
    if (!APPLY) {
      const p = await plan(db);
      console.log(`DRY RUN — store value ${p.storeValue.toFixed(2)}, GL 1250 ${p.gl1250.toFixed(2)}, difference (GL − store) ${p.difference.toFixed(2)}`);
      if (Math.abs(p.adjust) < 0.01) console.log('Ties out — nothing to post.');
      else console.log(`Would post: ${p.adjust > 0 ? 'DR 1250 / CR 1290' : 'DR 1290 / CR 1250'} ${Math.abs(p.adjust).toFixed(2)}`);
      console.log('To post: APPLY_STORE_TRUE_UP=1 APPROVED_BY_OWNER_ID=<owner user id> REASON="..." EXPECTED_DIFFERENCE=<difference above>');
      return;
    }
    if (!OWNER) { console.error('Refusing: APPLY_STORE_TRUE_UP=1 needs APPROVED_BY_OWNER_ID.'); process.exitCode = 2; return; }
    const r = await apply(db, { ownerId: OWNER, reason: REASON, expected: EXPECTED });
    console.log(r.posted ? `posted journal #${r.journalId} for ${Math.abs(r.adjust).toFixed(2)}` : 'Ties out — nothing posted.');
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { plan, apply };
