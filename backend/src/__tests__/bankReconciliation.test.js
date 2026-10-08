/**
 * Bank reconciliation (B5) — DB-less checks. The end-to-end flow (start, tick,
 * difference, complete, next statement) runs against Postgres in
 * moneyRules.integration.test.js.
 */
const fs = require('fs');
const schemas = require('../middleware/schemas');
const { suggestMatches } = require('../modules/accounting/bankReconciliation.service');

describe('suggestMatches', () => {
  const txns = [
    { id: 1, signed_amount: 5000, transaction_date: '2026-09-10' },
    { id: 2, signed_amount: -3000, transaction_date: '2026-09-15' },
    { id: 3, signed_amount: -3000, transaction_date: '2026-09-20' },
    { id: 4, signed_amount: 700, transaction_date: '2026-09-01' },
  ];
  test('pairs each statement line with one transaction of the same signed amount, nearest date first', () => {
    const lines = [
      { id: 10, amount: -3000, date: '2026-09-19' },
      { id: 11, amount: -3000, date: '2026-09-16' },
      { id: 12, amount: 5000, date: '2026-09-11' },
    ];
    expect(suggestMatches(lines, txns)).toEqual([
      { statement_item_id: 10, bank_transaction_id: 3 },
      { statement_item_id: 11, bank_transaction_id: 2 },
      { statement_item_id: 12, bank_transaction_id: 1 },
    ]);
  });
  test('no match outside ±3 days, on a different sign, or once a transaction is used', () => {
    expect(suggestMatches([{ id: 1, amount: 700, date: '2026-09-10' }], txns)).toEqual([]);
    expect(suggestMatches([{ id: 1, amount: 3000, date: '2026-09-15' }], txns)).toEqual([]);
    expect(suggestMatches([{ id: 1, amount: 5000, date: '2026-09-10' }, { id: 2, amount: 5000, date: '2026-09-10' }], txns))
      .toEqual([{ statement_item_id: 1, bank_transaction_id: 1 }]);
  });
});

describe('Joi', () => {
  const run = (schema, body) => schema.validate(body, { stripUnknown: true, abortEarly: false });
  test('start needs account, statement date and balance; keeps notes', () => {
    expect(run(schemas.createReconciliation, { bank_account_id: 1, statement_date: '2026-09-30' }).error).toBeTruthy();
    const { error, value } = run(schemas.createReconciliation, { bank_account_id: 1, statement_date: '2026-09-30', statement_balance: -50.25, notes: 'Sept' });
    expect(error).toBeUndefined();
    expect(value).toEqual({ bank_account_id: 1, statement_date: '2026-09-30', statement_balance: -50.25, notes: 'Sept' });
  });
  test('ticks are a list of ids (may be empty); statement lines need an amount', () => {
    expect(run(schemas.saveReconciliationTicks, { bank_transaction_ids: [] }).error).toBeUndefined();
    expect(run(schemas.saveReconciliationTicks, {}).error).toBeTruthy();
    expect(run(schemas.saveReconciliationTicks, { bank_transaction_ids: [1, 2], statement_balance: 10 }).value).toEqual({ bank_transaction_ids: [1, 2], statement_balance: 10 });
    expect(run(schemas.reconciliationStatementLines, { items: [{ date: '2026-09-01' }] }).error).toBeTruthy();
    expect(run(schemas.reconciliationStatementLines, { items: [{ date: '2026-09-01', reference: 'x', amount: -5, notes: 'n' }] }).value)
      .toEqual({ items: [{ date: '2026-09-01', reference: 'x', amount: -5, notes: 'n' }] });
  });
});

describe('route guards', () => {
  const src = fs.readFileSync(require.resolve('../modules/accounting/accounting.routes.js'), 'utf8');
  test('reading is finance.view; start / tick / import / complete are finance.post_journal', () => {
    expect(src).toMatch(/router\.get\('\/reconciliations', authorize\('finance', 'view'\)/);
    expect(src).toMatch(/router\.get\('\/reconciliations\/:id', authorize\('finance', 'view'\)/);
    for (const path of ["'/reconciliations',\n  authorize", "'/reconciliations/:id/ticks',\n  authorize", "'/reconciliations/:id/items',\n  authorize", "'/reconciliations/:id/complete',\n  authorize"]) {
      expect(src).toContain(`${path}('finance', 'post_journal')`);
    }
    expect(src).toMatch(/validate\(schemas\.createReconciliation\)/);
    expect(src).toMatch(/validate\(schemas\.saveReconciliationTicks\)/);
    expect(src).toMatch(/validate\(schemas\.reconciliationStatementLines\)/);
  });
});
