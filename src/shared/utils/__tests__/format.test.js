// Run as if on a laptop at the mill. Must be set before any Date is created.
process.env.TZ = 'Asia/Karachi';

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fmtNum, fmtPKR, fmtUSD, fmtMoney, fmtKg, fmtMT, fmtPct,
  fmtDate, fmtDateTime, toLocalISODate, todayLocalISO, toNumber, EMPTY,
} from '../format';

const BLANKS = [null, undefined, '', '   ', NaN, Infinity, -Infinity, 'abc', {}, []];

describe('time zone under test', () => {
  it('is Pakistan (UTC+5)', () => {
    expect(new Date('2026-10-05T00:00:00Z').getTimezoneOffset()).toBe(-300);
  });
});

describe('toNumber', () => {
  it('accepts numbers and numeric strings (Postgres NUMERIC)', () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber('1234.50')).toBe(1234.5);
    expect(toNumber('1,234')).toBe(1234);
    expect(toNumber(0)).toBe(0);
  });
  it.each(BLANKS)('returns null for %s', (v) => expect(toNumber(v)).toBeNull());
});

describe('fmtNum', () => {
  it('groups thousands western-style, never lakh/crore', () => {
    expect(fmtNum(1234567)).toBe('1,234,567');
    expect(fmtNum(123456789)).toBe('123,456,789');
  });
  it('shows up to 2 decimals by default, exactly N when asked', () => {
    expect(fmtNum(1234.5)).toBe('1,234.5');
    expect(fmtNum(1234.5678)).toBe('1,234.57');
    expect(fmtNum(1234.5, 2)).toBe('1,234.50');
    expect(fmtNum(1234.5, 0)).toBe('1,235');
  });
  it('handles zero and negatives, no "-0"', () => {
    expect(fmtNum(0)).toBe('0');
    expect(fmtNum(-1234.5, 2)).toBe('-1,234.50');
    expect(fmtNum(-0.001, 2)).toBe('0.00');
  });
  it.each(BLANKS)('prints — for %s', (v) => expect(fmtNum(v)).toBe(EMPTY));
});

describe('fmtPKR', () => {
  it('is exact — no Cr / L / M abbreviation', () => {
    expect(fmtPKR(1234567)).toBe('Rs 1,234,567');
    expect(fmtPKR(98980000)).toBe('Rs 98,980,000');
    expect(fmtPKR(1500000000)).toBe('Rs 1,500,000,000');
  });
  it('rounds to whole rupees by default, decimals on request', () => {
    expect(fmtPKR(1234.5)).toBe('Rs 1,235');
    expect(fmtPKR(1234.4)).toBe('Rs 1,234');
    expect(fmtPKR(1234.5, { decimals: 2 })).toBe('Rs 1,234.50');
    expect(fmtPKR('415905.25', { decimals: 2 })).toBe('Rs 415,905.25');
  });
  it('zero, negatives, and nothing that rounds to "-Rs 0"', () => {
    expect(fmtPKR(0)).toBe('Rs 0');
    expect(fmtPKR(-1234)).toBe('-Rs 1,234');
    expect(fmtPKR(-0.4)).toBe('Rs 0');
  });
  it.each(BLANKS)('prints — for %s', (v) => expect(fmtPKR(v)).toBe(EMPTY));
});

describe('fmtUSD / fmtMoney', () => {
  it('USD with cents', () => {
    expect(fmtUSD(12345.67)).toBe('$12,345.67');
    expect(fmtUSD(12345.675)).toBe('$12,345.68');
    expect(fmtUSD(0)).toBe('$0.00');
    expect(fmtUSD(-50)).toBe('-$50.00');
    expect(fmtUSD(null)).toBe(EMPTY);
  });
  it('routes by currency code', () => {
    expect(fmtMoney(1000)).toBe('Rs 1,000');
    expect(fmtMoney(1000, 'pkr')).toBe('Rs 1,000');
    expect(fmtMoney(1000, 'USD')).toBe('$1,000.00');
    expect(fmtMoney(1000, 'AED')).toBe('AED 1,000.00');
    expect(fmtMoney(-1000.5, 'EUR', { decimals: 0 })).toBe('-EUR 1,001');
    expect(fmtMoney(undefined, 'AED')).toBe(EMPTY);
    expect(fmtMoney(5, null)).toBe('Rs 5');
  });
});

describe('fmtKg / fmtMT / fmtPct', () => {
  it('kg is whole by default', () => {
    expect(fmtKg(12082)).toBe('12,082 kg');
    expect(fmtKg(12082.6)).toBe('12,083 kg');
    expect(fmtKg(12.25, { decimals: 2 })).toBe('12.25 kg');
    expect(fmtKg(0)).toBe('0 kg');
    expect(fmtKg(-50)).toBe('-50 kg');
    expect(fmtKg(null)).toBe(EMPTY);
  });
  it('MT to 3 places', () => {
    expect(fmtMT(12.0825)).toBe('12.083 MT');
    expect(fmtMT(1500)).toBe('1,500.000 MT');
    expect(fmtMT(2, { decimals: 0 })).toBe('2 MT');
    expect(fmtMT(NaN)).toBe(EMPTY);
  });
  it('percent takes a percentage, not a fraction', () => {
    expect(fmtPct(12.345)).toBe('12.3%');
    expect(fmtPct(12.345, { decimals: 2 })).toBe('12.35%');
    expect(fmtPct(0)).toBe('0.0%');
    expect(fmtPct(-3.25)).toBe('-3.3%');
    expect(fmtPct(undefined)).toBe(EMPTY);
  });
});

describe('fmtDate / fmtDateTime', () => {
  it('house format "05 Oct 2026"', () => {
    expect(fmtDate('2026-10-05')).toBe('05 Oct 2026');
    expect(fmtDate(new Date(2026, 0, 9))).toBe('09 Jan 2026');
  });
  it('a bare date is that calendar day, not shifted by the zone', () => {
    expect(fmtDate('2026-12-31')).toBe('31 Dec 2026');
  });
  it('a server timestamp is shown in local (Pakistan) time', () => {
    // 22:30 UTC on the 4th is 03:30 on the 5th at the mill.
    expect(fmtDate('2026-10-04T22:30:00.000Z')).toBe('05 Oct 2026');
    expect(fmtDateTime('2026-10-04T22:30:00.000Z')).toBe('05 Oct 2026, 03:30 AM');
    expect(fmtDateTime('2026-10-05T09:05:00.000Z')).toBe('05 Oct 2026, 02:05 PM');
    expect(fmtDateTime('2026-10-04T19:00:00.000Z')).toBe('05 Oct 2026, 12:00 AM');
    expect(fmtDateTime('2026-10-05T07:00:00.000Z')).toBe('05 Oct 2026, 12:00 PM');
  });
  it.each([...BLANKS, '2026-02-30', 'not a date'])('prints — for %s', (v) => {
    expect(fmtDate(v)).toBe(EMPTY);
    expect(fmtDateTime(v)).toBe(EMPTY);
  });
});

describe('todayLocalISO / toLocalISODate', () => {
  afterEach(() => vi.useRealTimers());

  it('at 03:00 Pakistan time it is TODAY, not yesterday (the night-shift bug)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T22:00:00.000Z')); // 03:00 PKT on 5 Oct
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-04'); // the old, wrong default
    expect(todayLocalISO()).toBe('2026-10-05');
  });
  it('agrees with UTC in the afternoon', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T10:00:00.000Z'));
    expect(todayLocalISO()).toBe('2026-10-05');
  });
  it('local midnight of a day stays that day (date-range "from")', () => {
    expect(toLocalISODate(new Date(2026, 9, 1, 0, 0, 0))).toBe('2026-10-01');
    expect(toLocalISODate(new Date(2026, 9, 1, 23, 59, 59))).toBe('2026-10-01');
  });
  it('passes a bare date through and rejects junk', () => {
    expect(toLocalISODate('2026-10-05')).toBe('2026-10-05');
    expect(toLocalISODate('2026-02-30')).toBe('');
    expect(toLocalISODate(null)).toBe('');
    expect(toLocalISODate('nope')).toBe('');
    expect(toLocalISODate(new Date('x'))).toBe('');
  });
});
