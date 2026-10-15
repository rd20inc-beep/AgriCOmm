import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as fe from '../saleMoney';

/**
 * P2-24: the sale form and the server apply ONE money rule for a local sale.
 * The backend module is loaded here and both are run on the same cases, so a
 * change to one side without the other fails this test.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const be = require(resolve(HERE, '../../../../../backend/src/modules/localSales/saleMoney.js'));

const AMOUNTS = [0, 0.4, 0.5, 0.49999, 1.5, 2.5, 49060.89, 49060.5, 107771.85, 99.995, -3.5, '12.6', '', null, undefined, 'abc'];

describe('local-sale money rule — form and server agree', () => {
  it('same tolerance', () => {
    expect(fe.SETTLE_TOLERANCE).toBe(be.SETTLE_TOLERANCE);
  });

  it.each(AMOUNTS.map((a) => [a]))('saleLineTotal(%p) is identical', (a) => {
    expect(fe.saleLineTotal(a)).toBe(be.saleLineTotal(a));
  });

  it('a line total is whole rupees', () => {
    expect(fe.saleLineTotal(333 * 147.33)).toBe(49061);
    expect(fe.saleLineTotal(0.5)).toBe(1);
  });

  it.each([[49060.5, 49061], [49060, 49061], [49061, 49061], [100, 102], [0, 0]])('isFullyPaid(%p, %p) is identical', (p, t) => {
    expect(fe.isFullyPaid(p, t)).toBe(be.isFullyPaid(p, t));
  });

  it('over the total: the form flags it, the server refuses it', () => {
    expect(fe.isOverPaid(49062, 49061)).toBe(true);
    expect(() => be.settledTender(49062, 49061)).toThrow(/cannot be more than the sale total/);
    expect(fe.isOverPaid(49061, 49061)).toBe(false);
    expect(be.settledTender(49060.5, 49061)).toBe(49061);
    expect(be.settledTender(40000, 49061)).toBe(40000);
  });

  it('the sale form totals lines with the shared helper', () => {
    const src = readFileSync(resolve(HERE, '../../pages/LocalSales.jsx'), 'utf8');
    expect(src).toMatch(/const lineTotal = saleLineTotal\(/);
    expect(src).not.toMatch(/const lineTotal = Math\.round\(/);
  });
});
