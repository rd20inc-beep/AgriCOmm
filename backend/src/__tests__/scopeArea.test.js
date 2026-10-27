/**
 * Module scopes (#9-scoping) name broad areas; permission modules split out of
 * an area by mig 470 keep that area's scope.
 */
const { scopeAreaOf } = require('../shared/scopeArea');
const { accessOf, can } = require('../services/accessContext');

describe('scopeAreaOf', () => {
  test.each([
    ['local_sales', 'inventory'], ['mill_customers', 'inventory'], ['mill_finance', 'milling'],
    ['inventory', 'inventory'], ['finance', 'finance'], ['reports', 'reports'],
  ])('%s → %s', (module, area) => expect(scopeAreaOf(module)).toBe(area));

  test('a user scoped to Inventory still reaches Local Sales, not Finance', () => {
    const a = accessOf({ id: 1, roleName: 'Clerk', permissions: ['local_sales.view', 'finance.view'], moduleScopes: ['inventory'] });
    expect(can(a, 'local_sales', 'view')).toBe(true);
    expect(can(a, 'finance', 'view')).toBe(false);
  });
});
