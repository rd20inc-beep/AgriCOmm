/**
 * P2-21 — link the cost rows old business expenses wrote to those expenses.
 *
 * Before migration 349 an expense against an export order / milling batch wrote
 * an unstamped cost row, which the payables feed re-derived as a second bill
 * (EC-… / MC-…) and Purchases offered to pay as an export cost. Stamping
 * `business_expense_id` on that row removes the twin. Only the link column is
 * written — no amount, payable, payment or journal changes.
 *
 * What it finds:
 *   linkable   a cost row whose notes name the expense ("From business expense
 *              EXP-…"), on the expense's own order / batch, for exactly the
 *              expense's PKR amount → stamped when writing
 *   review     a mill cost row an expense was MERGED into ("Updated via
 *              business expense …", or the amount differs) — it mixes the
 *              expense with other cost, so it is listed for a person to split;
 *              this script never splits or edits it
 *   paid twice an expense-created export cost row that ALSO has payments
 *              against it — a possible double payment, for Owner-reviewed
 *              reversal (never handled here)
 *
 * Output is counts and row IDs only.
 *   node scripts/linkExpenseCostRows.js                          dry run (default)
 *   LINK_EXPENSE_COST_ROWS=1 node scripts/linkExpenseCostRows.js  stamp the linkable rows
 * Runbook: docs/runbooks/expense-cost-row-links.md
 */
require('dotenv').config();

const WRITE = process.env.LINK_EXPENSE_COST_ROWS === '1';
const NOTE = /^(From|Updated via) business expense (\S+)/;
const eq2 = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

async function scan(db) {
  const expenses = await db('business_expenses')
    .where((q) => q.whereNotNull('order_id').orWhereNotNull('batch_id'))
    .select('id', 'expense_no', 'expense_type', 'order_id', 'batch_id', 'amount_pkr');
  const byNo = new Map(expenses.map((e) => [e.expense_no, e]));
  const out = { linkable: [], review: [], paidTwice: [] };

  const eoc = await db('export_order_costs').whereNull('business_expense_id')
    .where('notes', 'like', '%business expense%').select('id', 'order_id', 'notes', 'base_amount_pkr', 'amount', 'paid_amount');
  for (const r of eoc) {
    const m = NOTE.exec(String(r.notes || ''));
    const e = m && byNo.get(m[2]);
    if (!e || e.expense_type !== 'export' || Number(e.order_id) !== Number(r.order_id)) continue;
    const amt = Number(r.base_amount_pkr) || Number(r.amount);
    if (m[1] === 'From' && eq2(amt, e.amount_pkr)) out.linkable.push({ table: 'export_order_costs', id: r.id, expenseId: e.id });
    else out.review.push({ table: 'export_order_costs', id: r.id, expenseId: e.id });
    const pays = await db('payments').where({ source_table: 'export_order_costs', source_id: r.id }).count({ c: '*' }).first();
    if (Number(r.paid_amount) > 0 || Number(pays.c) > 0) out.paidTwice.push({ table: 'export_order_costs', id: r.id, expenseId: e.id });
  }

  const mc = await db('milling_costs').whereNull('business_expense_id')
    .where('notes', 'like', '%business expense%').select('id', 'batch_id', 'notes', 'amount');
  for (const r of mc) {
    const m = NOTE.exec(String(r.notes || ''));
    const e = m && byNo.get(m[2]);
    if (!e || e.expense_type !== 'mill' || Number(e.batch_id) !== Number(r.batch_id)) continue;
    if (m[1] === 'From' && eq2(r.amount, e.amount_pkr)) out.linkable.push({ table: 'milling_costs', id: r.id, expenseId: e.id });
    else out.review.push({ table: 'milling_costs', id: r.id, expenseId: e.id });
  }
  return out;
}

async function link(db, { write = false } = {}) {
  const found = await scan(db);
  let linked = 0;
  if (write && found.linkable.length) {
    await db.transaction(async (trx) => {
      for (const r of found.linkable) {
        linked += await trx(r.table).where({ id: r.id }).whereNull('business_expense_id')
          .update({ business_expense_id: r.expenseId, updated_at: trx.fn.now() });
      }
    });
  }
  return { ...found, linked };
}

async function main() {
  const db = require('../src/config/database');
  try {
    const r = await link(db, { write: WRITE });
    const ids = (rows) => rows.map((x) => `${x.table}#${x.id}→expense#${x.expenseId}`).join(', ');
    console.log(`${WRITE ? '' : 'DRY RUN — '}linkable: ${r.linkable.length}${r.linkable.length ? ` (${ids(r.linkable)})` : ''}`);
    console.log(`needs review (merged / amount differs): ${r.review.length}${r.review.length ? ` (${ids(r.review)})` : ''}`);
    console.log(`possible double payment (export cost row also paid): ${r.paidTwice.length}${r.paidTwice.length ? ` (${ids(r.paidTwice)})` : ''}`);
    if (WRITE) console.log(`linked: ${r.linked}`);
    else console.log('Set LINK_EXPENSE_COST_ROWS=1 to stamp the linkable rows.');
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { scan, link };
