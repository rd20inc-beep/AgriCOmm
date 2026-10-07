import { describe, it, expect } from 'vitest';
import { accountTakesCurrency, accountsForCurrency } from '../accountCurrency';

const PKR = { id: 1, currency: 'PKR' };
const USD = { id: 2, currency: 'USD' };
const LEGACY = { id: 3 }; // no currency → PKR

describe('accountsForCurrency', () => {
  it('a PKR payment is offered PKR accounts only', () => {
    expect(accountsForCurrency([PKR, USD, LEGACY], 'PKR').map((a) => a.id)).toEqual([1, 3]);
  });
  it('a USD payment is offered PKR accounts and USD accounts', () => {
    expect(accountsForCurrency([PKR, USD, LEGACY], 'usd').map((a) => a.id)).toEqual([1, 2, 3]);
  });
  it('a USD account is not offered for EUR', () => {
    expect(accountTakesCurrency(USD, 'EUR')).toBe(false);
    expect(accountTakesCurrency(PKR, 'EUR')).toBe(true);
  });
  it('tolerates a missing list', () => {
    expect(accountsForCurrency(undefined, 'PKR')).toEqual([]);
  });
});
