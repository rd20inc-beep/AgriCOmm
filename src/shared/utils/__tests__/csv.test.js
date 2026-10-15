import { describe, test, expect } from 'vitest';
import { csvCell, csvNum, toCsv, BOM } from '../csv';
import { reportEnvelope, reportObject, cleanParams } from '../../../modules/analytics/api/reportHooks';
import { pagerText, metaText } from '../../../modules/analytics/utils/reportChrome';
import { printableSections, printableCsv } from '../../../modules/analytics/utils/printableCsv';

describe('the one CSV exporter (RPT-22)', () => {
  test('escaping + formula-injection fixtures', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=1+2')).toBe("'=1+2");
    expect(csvCell('+923001234567')).toBe("'+923001234567");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-x')).toBe("'-x");
    expect(csvCell('=HYPERLINK("a,b")')).toBe('"\'=HYPERLINK(""a,b"")"');
  });

  test('raw numbers, negatives stay numbers, null/NaN blank', () => {
    expect(csvCell(1866037.5)).toBe('1866037.5');
    expect(csvCell(-12.34)).toBe('-12.34');
    expect(csvCell('-12.34')).toBe('-12.34');
    expect(csvCell(null)).toBe('');
    expect(csvCell(NaN)).toBe('');
    expect(csvNum('1,234')).toBe(1);
    expect(csvNum('')).toBeNull();
    expect(csvNum(null)).toBeNull();
    expect(csvNum('12.505')).toBe(12.505);
  });

  test('BOM + CRLF; header even with no rows; redacted value blank, not 0', () => {
    expect(toCsv([], [{ label: 'A', key: 'a' }])).toBe(`${BOM}A\r\n`);
    expect(toCsv([{ a: 'x', cost: null }], [{ label: 'A', key: 'a' }, { label: 'Cost', accessor: (r) => csvNum(r.cost) }]))
      .toBe(`${BOM}A,Cost\r\nx,\r\n`);
  });
});

describe('report hook envelope (one casing contract)', () => {
  test('a top-level list with pagination and meta', () => {
    const env = reportEnvelope({ success: true, data: [{ order_no: 'EX-1' }], pagination: { total: 3, truncated: true }, meta: { as_of: 'x' } });
    expect(env.rows).toEqual([{ orderNo: 'EX-1' }]);
    expect(env.pagination).toEqual({ total: 3, truncated: true });
    expect(env.meta).toEqual({ asOf: 'x' });
    expect(env.totals).toBeNull();
  });

  test('a nested data.rows + totals, and a listKey', () => {
    expect(reportEnvelope({ data: { rows: [{ sale_no: 1 }], totals: { gross_profit: 5 } } }))
      .toMatchObject({ rows: [{ saleNo: 1 }], totals: { grossProfit: 5 } });
    expect(reportEnvelope({ success: true, batches: [{ batch_no: 'B' }] }, 'batches').rows).toEqual([{ batchNo: 'B' }]);
    expect(reportEnvelope({ data: { suppliers: [{ a_b: 1 }] } }, 'suppliers').rows).toEqual([{ aB: 1 }]);
    expect(reportEnvelope(null).rows).toEqual([]);
  });

  test('object reports and params', () => {
    expect(reportObject({ data: { total_outstanding_pkr: 1 } })).toEqual({ totalOutstandingPkr: 1 });
    expect(cleanParams({ from_date: '2026-01-01', to_date: '', entity: null })).toEqual({ from_date: '2026-01-01' });
  });
});

describe('report chrome words', () => {
  test('pager says when a page is not everything', () => {
    expect(pagerText({ page: 1, limit: 100, total: 80, returned: 80, truncated: false })).toBeNull();
    expect(pagerText({ page: 2, limit: 100, total: 250, returned: 100, truncated: true })).toBe('Showing 101–200 of 250');
  });
  test('meta line states the period, unit and currency', () => {
    expect(metaText({ allTime: true, unit: 'kg', currency: 'PKR' })).toMatch(/^All time · kg · PKR/);
    expect(metaText(null)).toBeNull();
  });
});

describe('Print Reports CSV (RPT-23)', () => {
  const data = {
    revenue: { totalPkr: 1000.5, exportCount: 2 },
    detail: { export: [{ ref: 'EX-1', amountPkr: 700.25 }], local: [{ ref: 'LS-1', amountPkr: 300.25, party: '=evil' }] },
  };
  test('every record list becomes a section; scalars a summary', () => {
    const s = printableSections(data);
    expect(s.map((x) => x.section)).toEqual(['Summary', 'detail.export', 'detail.local']);
    expect(s[0].rows).toContainEqual({ field: 'revenue.totalPkr', value: 1000.5 });
  });
  test('raw figures, injection-guarded text', () => {
    const csv = printableCsv(data);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toContain('detail.export,,,EX-1,700.25');
    expect(csv).toContain("'=evil");
  });
});
