/**
 * Shared Utility Tests
 * Tests money.js, pagination.js functions.
 */

const { settledAmount, MONEY_EPSILON, moneyEqual, moneyGte, moneyAdd, moneySubtract } = require('../shared/utils/money');
const { parsePagination, paginationMeta } = require('../shared/utils/pagination');

describe('Money utilities', () => {
  describe('settledAmount', () => {
    it('rounds to 2 decimal places', () => {
      expect(settledAmount(10.005)).toBe(10.01);
      expect(settledAmount(10.004)).toBe(10.0);
      expect(settledAmount(0.1 + 0.2)).toBe(0.3);
    });

    it('handles null and undefined as 0', () => {
      expect(settledAmount(null)).toBe(0);
      expect(settledAmount(undefined)).toBe(0);
      expect(settledAmount('')).toBe(0);
    });

    it('handles string numbers', () => {
      expect(settledAmount('10000.50')).toBe(10000.5);
    });
  });

  describe('MONEY_EPSILON', () => {
    it('is 0.01', () => {
      expect(MONEY_EPSILON).toBe(0.01);
    });
  });

  describe('moneyEqual', () => {
    it('treats amounts within epsilon as equal', () => {
      expect(moneyEqual(100, 100.004)).toBe(true); // rounds to 100.00
      expect(moneyEqual(100, 100.009)).toBe(true); // rounds to 100.01, diff = 0.01 = epsilon
      expect(moneyEqual(100, 100.02)).toBe(false); // diff = 0.02 > epsilon
    });

    it('handles the 0.1 + 0.2 problem', () => {
      expect(moneyEqual(0.3, 0.1 + 0.2)).toBe(true);
    });
  });

  describe('moneyGte', () => {
    it('returns true when a >= b within epsilon', () => {
      expect(moneyGte(100, 99.995)).toBe(true);
      expect(moneyGte(100, 100)).toBe(true);
      expect(moneyGte(99.99, 100)).toBe(true); // within epsilon
      expect(moneyGte(99, 100)).toBe(false);
    });
  });

  describe('moneyAdd', () => {
    it('adds safely', () => {
      expect(moneyAdd(0.1, 0.2)).toBe(0.3);
      expect(moneyAdd(10000.50, 5000.25)).toBe(15000.75);
    });
  });

  describe('moneySubtract', () => {
    it('subtracts safely', () => {
      expect(moneySubtract(0.3, 0.1)).toBe(0.2);
      expect(moneySubtract(10000, 3000.50)).toBe(6999.5);
    });
  });
});

describe('Pagination utilities', () => {
  describe('parsePagination', () => {
    it('parses page, limit, offset from query params', () => {
      const result = parsePagination({ page: '3', limit: '25' });
      expect(result).toEqual({ page: 3, limit: 25, offset: 50 });
    });

    it('defaults to page 1, limit 50', () => {
      const result = parsePagination({});
      expect(result).toEqual({ page: 1, limit: 50, offset: 0 });
    });

    it('clamps page to minimum 1', () => {
      const result = parsePagination({ page: '-5' });
      expect(result.page).toBe(1);
      expect(result.offset).toBe(0);
    });

    it('clamps limit to maximum 200', () => {
      const result = parsePagination({ limit: '500' });
      expect(result.limit).toBe(200);
    });

    it('accepts custom default limit', () => {
      const result = parsePagination({}, 20);
      expect(result.limit).toBe(20);
    });
  });

  describe('paginationMeta', () => {
    it('calculates totalPages correctly', () => {
      expect(paginationMeta(100, 1, 25)).toEqual({
        page: 1,
        limit: 25,
        total: 100,
        totalPages: 4,
      });
    });

    it('handles zero records', () => {
      expect(paginationMeta(0, 1, 25)).toEqual({
        page: 1,
        limit: 25,
        total: 0,
        totalPages: 0,
      });
    });

    it('rounds up totalPages', () => {
      expect(paginationMeta(101, 1, 25).totalPages).toBe(5);
    });
  });
});
