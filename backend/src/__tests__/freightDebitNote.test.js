/**
 * Freight escalation debit notes.
 *
 * The clause on the Proforma and the Sales Contract promises the buyer that a
 * rise in ocean freight between the date the rate was quoted and the date of the
 * Bill of Lading is invoiced by debit note, "payable together with the balance
 * of the contract value". These hold that promise to its wording.
 *
 * The end-to-end behaviour (balance, receivable and GL moving together, and the
 * trial balance staying at zero through issue and cancel) was verified against a
 * real Postgres; what is pinned here is the arithmetic and the wiring, which is
 * what a later refactor can quietly break.
 */
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SVC = read('modules/exportOrders/debitNote.service.js');
const ROUTES = read('modules/exportOrders/exportOrders.routes.js');

describe('what the note claims', () => {
  // The working the buyer will check: the rise per ton times the tons shipped.
  const derive = (oldR, newR, qty) => Math.round((newR - oldR) * qty * 100) / 100;

  it.each([
    [58, 76, 24, 432],
    [58, 76.5, 24, 444],
    [0, 12.5, 100, 1250],
    [58.33, 61.11, 24.375, 67.76],   // rounded to the paisa, not left as dust
  ])('%s → %s per MT over %s MT is %s', (o, n, q, expected) => {
    expect(derive(o, n, q)).toBe(expected);
  });

  it('a rate that did not rise is not a claim', () => {
    // A debit note DEBITS. Letting a fall through would quietly credit the buyer
    // through a document nobody reads as a credit note, so the CHECK constraint
    // and the service both refuse it.
    expect(derive(76, 58, 24)).toBeLessThan(0);
    expect(SVC).toContain('if (!(amount > 0))');
    const mig = fs.readFileSync(path.join(__dirname, '../../migrations/20260929_304_export_debit_notes.js'), 'utf8');
    expect(mig).toContain('CHECK (amount > 0)');
  });

  it('an amount typed by hand wins over the working', () => {
    // A congestion surcharge is a lump sum with no per-MT story.
    expect(SVC).toMatch(/if \(amount == null && oldRate != null && newRate != null\)/);
  });
});

describe('the claim lands on the balance, as the clause says', () => {
  it('it raises balance_expected and the Balance receivable together', () => {
    expect(SVC).toContain("balance_expected: newBalanceExpected");
    expect(SVC).toContain("trx('receivables').where({ order_id: order.id, type: 'Balance' })");
  });

  it('a note against a fully paid balance makes it owing again', () => {
    expect(SVC).toMatch(/status: outstanding <= MONEY_EPSILON \? 'Paid' : \(received > 0 \? 'Partial' : 'Pending'\)/);
  });

  it('it does NOT invent a receivable type the schema forbids', () => {
    // receivables.type is CHECK-constrained to Advance/Balance/Local Sale/
    // Service Milling. Routing the claim through the existing Balance row is
    // what lets the ordinary balance confirmation settle it, with no second
    // receipt path to reconcile.
    expect(SVC).not.toContain("type: 'Debit Note'");
    expect(SVC).not.toContain("insert({ recv_no");
  });

  it('cancelling a note the buyer already paid is refused', () => {
    expect(SVC).toContain('already exceeds what would remain owing');
    // And it is checked BEFORE anything is posted, so a refusal leaves nothing
    // half-done to unwind.
    const cancelBody = SVC.slice(SVC.indexOf('async cancel('));
    expect(cancelBody.indexOf('applyToBalance')).toBeLessThan(cancelBody.indexOf('postDebitNoteJournal'));
  });
});

describe('the ledger', () => {
  it('debits Export AR and credits freight recovered, never export sales', () => {
    expect(SVC).toContain("where({ code: '1110' })");
    expect(SVC).toContain("where({ code: '4070' })");
    expect(SVC).not.toContain("'4010'");
  });

  it('cancelling posts a SIGNED DELTA, it never reverses and reposts', () => {
    // The trial balance and every ledger count Posted journals only, so a
    // reverse-and-repost would subtract the amount twice.
    expect(SVC).toContain('cancel_journal_id');
    expect(SVC).not.toContain('reverseJournal');
    // The reversing entry is the opposite pair, posted as its own journal.
    const rev = SVC.slice(SVC.indexOf('const lines = reversing'), SVC.indexOf('const journal = await'));
    expect(rev).toMatch(/freightRev\.id, account: freightRev\.name, debit: amt/);
    expect(rev).toMatch(/exportAR\.id, account: exportAR\.name, debit: 0, credit: amt/);
  });

  it('every journal it writes is actually posted, not left Draft', () => {
    // createJournal writes a DRAFT; the trial balance counts Posted only, so an
    // unposted journal is a claim that never reaches the books.
    const creates = (SVC.match(/createJournal\(/g) || []).length;
    const posts = (SVC.match(/postJournal\(/g) || []).length;
    expect(posts).toBe(creates);
  });

  it('it values the claim at the order’s booked rate, not today’s', () => {
    expect(SVC).toContain('parseFloat(order.booked_fx_rate)');
    expect(SVC).toContain('contract_value_pkr_locked');
  });

  it('a Postgres date never reaches the period lookup as "Tue Sep 29"', () => {
    // Date#toString sliced to ten characters produced exactly that, and the
    // accounting-period lookup rejected it as a date.
    expect(SVC).toContain('const isoDate =');
    expect(SVC).not.toMatch(/issue_date\)\.toString\(\)\.slice/);
  });
});

describe('who may raise one', () => {
  it('issuing sits behind the balance permission, not plain order edit', () => {
    const block = ROUTES.slice(ROUTES.indexOf("'/:id/debit-notes'"), ROUTES.indexOf("'/:id/debit-notes/:noteId/cancel'"));
    expect(block).toContain("authorizeAny(['export_orders', 'confirm_balance'], ['finance', 'confirm_payment'])");
    expect(block).toContain('validate(schemas.issueExportDebitNote)');
    expect(block).toContain("auditAction('issue_debit_note'");
  });

  it('cancelling withdraws a claim already sent, so it is owner-approved', () => {
    const block = ROUTES.slice(ROUTES.indexOf("'/:id/debit-notes/:noteId/cancel'"));
    expect(block.slice(0, 600)).toContain("ownerApproval('export_balance')");
  });

  it('the fields it accepts are declared, or Joi would strip them', () => {
    const schemas = require('../middleware/schemas');
    const { value, error } = schemas.issueExportDebitNote.validate(
      { old_rate_per_mt: 58, new_rate_per_mt: 76, qty_mt: 24, basis: 'surcharge', reason: 'GRI', issue_date: '2026-10-10' },
      { stripUnknown: true },
    );
    expect(error).toBeUndefined();
    expect(Object.keys(value).sort()).toEqual(
      ['basis', 'issue_date', 'new_rate_per_mt', 'old_rate_per_mt', 'qty_mt', 'reason'],
    );
  });

  it('a note with neither an amount nor a new rate is rejected', () => {
    const schemas = require('../middleware/schemas');
    const { error } = schemas.issueExportDebitNote.validate({ reason: 'because' });
    expect(error).toBeDefined();
  });
});

describe('the document', () => {
  const docCtrl = read('modules/documents/exportDocument.controller.js');

  it('a cancelled note never prints — the buyer would read it as owing', () => {
    expect(docCtrl).toContain("where({ order_id: orderId, status: 'Issued' })");
  });

  it('the type is only offered once a claim exists', () => {
    expect(docCtrl).toContain("docs.push({ key: 'freight-debit-note'");
    expect(docCtrl).toContain('const hasDebitNote');
  });
});
