/**
 * An expense reaches the supplier's ledger.
 *
 * It did not. The supplier statement is built from party-stamped journals, with
 * payables synthesized for bills that have no journal of their own — and an
 * expense produced neither route with a supplier on it, because the supplier was
 * never captured.
 *
 * TWO bugs, both found by running it rather than reading it:
 *
 *  1. The form never offered a supplier. VendorSection checks `useApi` BEFORE
 *     `vendorKind === 'supplier'`, and both supplier-kind categories (transport
 *     and bags) are mapped to expense_vendors presets — so the preset list always
 *     won and the picker never rendered anywhere in the app. Every expense was
 *     written with supplier_id NULL.
 *
 *  2. Naming a supplier would have DOUBLE-COUNTED it. The expense posts its
 *     journal under EXP-2026-0001 while its payable is PAY-EXP0001 with the
 *     vendor name as linked_ref, so the statement's coverage test matched
 *     neither: the stamped journal gave one line and the payable synthesized
 *     another. A Rs 221,000 expense read as Rs 442,000. The missing picker had
 *     been hiding it.
 *
 * Both verified end to end against a real Postgres, and the 7 existing suppliers
 * on production data come out byte-identical.
 */
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ACCT = read('modules/accounting/accounting.service.js');
const SVC = read('modules/expenses/expenses.service.js');
const ROUTES = read('modules/expenses/expenses.routes.js');
// The new-expense form moved into a drawer (Expenses view + the Finance
// header's + Expense); its payload builder lives with the catalogue.
const FORM = ['components/ExpenseCreateDrawer.jsx', 'utils/expenseCatalogue.js']
  .map((f) => fs.readFileSync(path.join(__dirname, '../../../src/modules/finance', f), 'utf8')).join('\n');

describe('the statement no longer counts an expense twice', () => {
  it('a payable is covered by its SOURCE document reference too', () => {
    // Its own refs are not what its journal was posted under.
    expect(ACCT).toContain('const SOURCE_REF_COL = {');
    expect(ACCT).toContain("business_expenses: 'expense_no'");
    expect(ACCT).toContain('(sourceRef && glRefs.has(sourceRef))');
  });

  it('source_id is selected, or the lookup has nothing to resolve', () => {
    // The payables query did not select it, so the first version of this fix
    // changed nothing at all — the statement still read Rs 442,000.
    const sel = ACCT.slice(ACCT.indexOf("const payables = await db('payables')"), ACCT.indexOf('const payableStatusByRef'));
    expect(sel).toContain("'source_id'");
  });

  it('it can only ever REMOVE a duplicate line, never add one', () => {
    // The new test is OR-ed into `covered`, which only skips synthetic lines.
    expect(ACCT).toMatch(/const covered = \(p\.pay_no && glRefs\.has\(p\.pay_no\)\)[\s\S]{0,180}sourceRef && glRefs\.has\(sourceRef\)/);
  });

  it('purchases resolve the same way, so one rule covers them all', () => {
    expect(ACCT).toContain("mill_purchases: 'purchase_no'");
    expect(ACCT).toContain("inventory_lots: 'lot_no'");
  });
});

describe('the form offers a supplier', () => {
  it('a supplier-kind category checks the SUPPLIER before the preset list', () => {
    // This is the whole bug: useApi used to win, and both supplier-kind
    // categories are mapped to presets.
    const cfg = FORM.slice(FORM.indexOf('const config = useMemo'), FORM.indexOf("case 'utility':"));
    expect(cfg.indexOf("vendorKind === 'supplier'")).toBeGreaterThan(-1);
    expect(cfg.indexOf("vendorKind === 'supplier'")).toBeLessThan(cfg.indexOf('if (useApi)'));
  });

  it('the presets survive as suggestions on the one-off payee field', () => {
    // They are useful — "NLC", "TCS Logistics" — just not a substitute for a
    // supplier link.
    expect(FORM).toContain('options: useApi ? apiVendors : []');
    expect(FORM).toContain('<datalist id={config.listId}>');
  });

  it('it says plainly that a one-off payee reaches no ledger', () => {
    expect(FORM).toContain('will not appear on any');
  });

  it('only a real supplier is sent, never a typed name', () => {
    expect(FORM).toContain("supplier_id: vendorKind === 'supplier' && form.supplier_id ? Number(form.supplier_id) : null");
  });
});

describe('an expense already recorded can be attached', () => {
  it('it writes the link everywhere the ledger reads', () => {
    const fn = SVC.slice(SVC.indexOf('async linkSupplier('), SVC.indexOf('async markPaid('));
    expect(fn).toContain("trx('business_expenses').where('id', id).update(");
    expect(fn).toContain("trx('payables')");
    expect(fn).toContain("trx('journal_entries').whereIn('ref_no', refs)");
  });

  it('the journals MUST be stamped, or a paid expense goes credit', () => {
    // Unstamped, the statement takes the bill from the synthesized payable —
    // which carries the payment too — while the payment journal is stamped at pay
    // time and contributes the same payment again. A settled Rs 221,000 bill read
    // as Rs -221,000 until this was added.
    const fn = SVC.slice(SVC.indexOf('async linkSupplier('), SVC.indexOf('async markPaid('));
    expect(fn).toContain('party_type: supplier ? \'supplier\' : null');
    // The reasoning lives in the doc comment ABOVE the method, so it is matched
    // against the file rather than the method body.
    expect(SVC).toMatch(/Stamping the journals is NOT optional/);
  });

  it('a payment made BEFORE the link is picked up', () => {
    // Its journal is posted under the payment_no, not the expense_no.
    const fn = SVC.slice(SVC.indexOf('async linkSupplier('), SVC.indexOf('async markPaid('));
    expect(fn).toContain("trx('payments').where('linked_payable_id', payable.id).pluck('payment_no')");
    expect(fn).toContain('const refs = [expense.expense_no, ...paymentNos]');
  });

  it('only the party columns move — no amount, account or date', () => {
    const fn = SVC.slice(SVC.indexOf('async linkSupplier('), SVC.indexOf('async markPaid('));
    const stamp = fn.slice(fn.indexOf("whereIn('ref_no', refs)"), fn.indexOf('audit_logs'));
    for (const forbidden of ['debit', 'credit', 'amount', 'account_id', 'date:']) {
      expect(stamp).not.toContain(forbidden);
    }
  });

  it('the typed payee is kept — it is what was on the bill', () => {
    const fn = SVC.slice(SVC.indexOf('async linkSupplier('), SVC.indexOf('async markPaid('));
    expect(fn).toContain('expense.vendor_name || (supplier ? supplier.name : null)');
  });

  it('passing null unlinks it', () => {
    expect(SVC).toContain('supplier_id: supplier ? supplier.id : null');
    const ctrl = read('modules/expenses/expenses.controller.js');
    expect(ctrl).toContain("raw === null || raw === '' || raw === undefined ? null : Number(raw)");
  });

  it('it is audited and behind allocate_cost', () => {
    // It decides whose ledger the money lands on, not whether it was paid.
    expect(ROUTES).toContain("'/:id/supplier'");
    expect(ROUTES).toContain("authorize('finance', 'allocate_cost')");
    expect(ROUTES).toContain("auditAction('link_supplier', 'business_expense'");
  });

  it('the whole thing is one transaction', () => {
    const fn = SVC.slice(SVC.indexOf('async linkSupplier('), SVC.indexOf('async markPaid('));
    expect(fn).toContain('return db.transaction(async (trx) => {');
  });
});
