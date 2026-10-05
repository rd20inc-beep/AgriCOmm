/**
 * Freight escalation debit notes.
 *
 * The clause on the Proforma and the Sales Contract promises the buyer that a
 * rise in ocean freight between the date the rate was quoted and the date of the
 * Bill of Lading is invoiced by debit note, "payable together with the balance
 * of the contract value". These hold that promise to its wording.
 *
 * The service is RUN here against an in-memory database with the accounting
 * service recording what it is asked to post: the arithmetic, the balance and
 * receivable moving together, and the journals. What is still read from source
 * is source structure: the route guards, a migration CHECK, and the document
 * controller's wiring.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../config/database', () => require('./helpers/memoryDb').db);
const mockJournals = [];
const mockPosted = [];
const mockAccounting = {
  createJournal: jest.fn(async (_trx, j) => { mockJournals.push(j); return { id: mockJournals.length }; }),
  postJournal: jest.fn(async (_trx, id) => { mockPosted.push(id); }),
  reverseJournal: jest.fn(),
};
jest.mock('../modules/accounting/accounting.service', () => mockAccounting);
jest.mock('../utils/docNumber', () => ({
  nextDocNo: async (_trx, { prefix }) => `${prefix}${String(require('./helpers/memoryDb').state.tables.export_debit_notes.length + 1).padStart(4, '0')}`,
}));

const { state, reset } = require('./helpers/memoryDb');
const debitNotes = require('../modules/exportOrders/debitNote.service');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ROUTES = read('modules/exportOrders/exportOrders.routes.js');

function seed(over = {}, recvOver = {}) {
  mockJournals.length = 0;
  mockPosted.length = 0;
  reset({
    export_orders: [{
      id: 1, order_no: 'EX-001', customer_id: 10, status: 'Shipped', currency: 'USD',
      qty_mt: 24, contract_value: 12000, contract_value_pkr_locked: 3360000, booked_fx_rate: 280,
      balance_expected: 9600, balance_received: 0, ...over,
    }],
    receivables: [{
      id: 5, order_id: 1, type: 'Balance', expected_amount: 9600, received_amount: 0,
      outstanding: 9600, status: 'Pending', base_amount_pkr: 2688000, notes: null, ...recvOver,
    }],
    export_debit_notes: [],
    chart_of_accounts: [
      { id: 110, code: '1110', name: 'Export AR' },
      { id: 470, code: '4070', name: 'Freight & Insurance Recovered' },
      { id: 401, code: '4010', name: 'Export Sales' },
    ],
  });
}
const order = () => state.tables.export_orders[0];
const recv = () => state.tables.receivables[0];

describe('what the note claims', () => {
  it.each([
    [58, 76, 24, 432],
    [58, 76.5, 24, 444],
    [0, 12.5, 100, 1250],
    [58.33, 61.11, 24.375, 67.76],   // rounded to the paisa, not left as dust
  ])('%s → %s per MT over %s MT is %s', async (o, n, q, expected) => {
    seed();
    const note = await debitNotes.issue(1, { old_rate_per_mt: o, new_rate_per_mt: n, qty_mt: q }, 1);
    expect(note.amount).toBe(expected);
  });

  it('a rate that did not rise is not a claim', async () => {
    // A debit note DEBITS. Letting a fall through would quietly credit the buyer
    // through a document nobody reads as a credit note.
    seed();
    await expect(debitNotes.issue(1, { old_rate_per_mt: 76, new_rate_per_mt: 58 }, 1))
      .rejects.toThrow(/Enter the amount to claim/);
    expect(state.tables.export_debit_notes).toHaveLength(0);
    expect(mockJournals).toHaveLength(0);
    // The table refuses one too (structure — the migration's CHECK).
    const mig = fs.readFileSync(path.join(__dirname, '../../migrations/20260929_304_export_debit_notes.js'), 'utf8');
    expect(mig).toContain('CHECK (amount > 0)');
  });

  it('an amount typed by hand wins over the working', async () => {
    // A congestion surcharge is a lump sum with no per-MT story.
    seed();
    const note = await debitNotes.issue(1, { amount: 300, old_rate_per_mt: 58, new_rate_per_mt: 76 }, 1);
    expect(note.amount).toBe(300);
  });

  it('a cancelled order takes no note', async () => {
    seed({ status: 'Cancelled' });
    await expect(debitNotes.issue(1, { amount: 100 }, 1)).rejects.toThrow(/cancelled order/);
  });
});

describe('the claim lands on the balance, as the clause says', () => {
  it('it raises balance_expected and the Balance receivable together', async () => {
    seed();
    const note = await debitNotes.issue(1, { old_rate_per_mt: 58, new_rate_per_mt: 76 }, 1);
    expect(note.debit_note_no).toBe('DN-0001');
    expect(order().balance_expected).toBe(10032);
    expect(recv()).toMatchObject({ expected_amount: 10032, outstanding: 10032, status: 'Pending', base_amount_pkr: 2688000 + 432 * 280 });
    // It rides the existing Balance row: no new receivable type is invented
    // (receivables.type is CHECK-constrained), so the ordinary balance
    // confirmation settles it.
    expect(state.tables.receivables).toHaveLength(1);
  });

  it('a note against a fully paid balance makes it owing again', async () => {
    seed({ balance_received: 9600 }, { received_amount: 9600, outstanding: 0, status: 'Paid' });
    await debitNotes.issue(1, { amount: 432 }, 1);
    expect(recv()).toMatchObject({ outstanding: 432, status: 'Partial' });
  });

  it('cancelling takes it back off the balance', async () => {
    seed();
    const note = await debitNotes.issue(1, { amount: 432 }, 1);
    const cancelled = await debitNotes.cancel(1, note.id, { reason: 'carrier waived it' }, 1);
    expect(cancelled.status).toBe('Cancelled');
    expect(order().balance_expected).toBe(9600);
    expect(recv()).toMatchObject({ expected_amount: 9600, outstanding: 9600 });
  });

  it('cancelling a note the buyer already paid is refused, before anything is posted', async () => {
    seed();
    const note = await debitNotes.issue(1, { amount: 432 }, 1);
    order().balance_received = 10032;
    const journalsBefore = mockJournals.length;
    await expect(debitNotes.cancel(1, note.id, {}, 1)).rejects.toThrow(/already exceeds what would remain owing/);
    expect(mockJournals).toHaveLength(journalsBefore);
    expect(state.tables.export_debit_notes[0].status).toBe('Issued');
  });
});

describe('the ledger', () => {
  const lineSum = (j, acct) => j.lines.filter((l) => l.account_id === acct)
    .reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0);

  it('debits Export AR and credits freight recovered, never export sales', async () => {
    seed();
    await debitNotes.issue(1, { amount: 432 }, 1);
    const [j] = mockJournals;
    expect(lineSum(j, 110)).toBe(432 * 280);
    expect(lineSum(j, 470)).toBe(-432 * 280);
    expect(j.lines.some((l) => l.account_id === 401)).toBe(false);
    expect(j).toMatchObject({ partyType: 'customer', partyId: 10, origCurrency: 'USD', origFxRate: 280 });
  });

  it('cancelling posts a SIGNED DELTA, it never reverses and reposts', async () => {
    // The trial balance and every ledger count Posted journals only, so a
    // reverse-and-repost would subtract the amount twice.
    seed();
    const note = await debitNotes.issue(1, { amount: 432 }, 1);
    await debitNotes.cancel(1, note.id, {}, 1);
    expect(mockAccounting.reverseJournal).not.toHaveBeenCalled();
    expect(mockJournals).toHaveLength(2);
    const [issued, undone] = mockJournals;
    expect(lineSum(undone, 110)).toBe(-lineSum(issued, 110));
    expect(lineSum(undone, 470)).toBe(-lineSum(issued, 470));
    expect(state.tables.export_debit_notes[0].cancel_journal_id).toBe(2);
  });

  it('every journal it writes is actually posted, not left Draft', async () => {
    seed();
    const note = await debitNotes.issue(1, { amount: 432 }, 1);
    await debitNotes.cancel(1, note.id, {}, 1);
    expect(mockPosted).toEqual([1, 2]);
  });

  it('it values the claim at the order’s booked rate, not today’s', async () => {
    seed({ booked_fx_rate: null }); // falls back to the locked PKR/contract ratio: 3,360,000 / 12,000 = 280
    const note = await debitNotes.issue(1, { amount: 100 }, 1);
    expect(note.fx_rate).toBe(280);
    expect(note.amount_pkr).toBe(28000);
  });

  it('a Postgres date never reaches the period lookup as "Tue Sep 29"', async () => {
    // Date#toString sliced to ten characters produced exactly that, and the
    // accounting-period lookup rejected it as a date.
    seed();
    await debitNotes.issue(1, { amount: 100, issue_date: new Date('2026-09-29T00:00:00Z') }, 1);
    expect(mockJournals[0].date).toBe('2026-09-29');
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
