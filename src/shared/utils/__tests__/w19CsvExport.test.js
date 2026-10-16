import { describe, it, expect, vi, beforeEach } from 'vitest';

// W19 — every report CSV pulls the FULL filtered set from the server and warns
// when even that was capped. The browser save is stubbed; what matters is
// which rows reach the CSV and whether the user is warned.
const saved = [];
vi.mock('../csv', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    downloadCsv: vi.fn(({ rows }) => { saved.push(rows); return rows.length; }),
  };
});
const download = vi.fn();
vi.mock('../../../api/client', () => ({ default: { download: (...a) => download(...a) } }));

const { csvCapWarning } = await import('../listCap');
const { fetchAllPagesCapped } = await import('../fetchAllPages');
const { downloadServerCsv, serverCsvWarning } = await import('../csv');
const { exportFullLedgerCSV } = await import('../../../modules/analytics/utils/ledgerExport');
const { printableTruncations } = await import('../../../modules/analytics/utils/printableCsv');

beforeEach(() => { saved.length = 0; download.mockReset(); });

function pagedApi(n, key = 'logs') {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  return vi.fn(async ({ page = 1, limit = 50 } = {}) => {
    const lim = Math.min(200, limit);
    return { data: { [key]: rows.slice((page - 1) * lim, page * lim), pagination: { page, limit: lim, total: n } } };
  });
}

describe('exportFullLedgerCSV', () => {
  it('re-asks the endpoint with export=1 and writes every row it returns', async () => {
    const fetchAll = vi.fn(async (extra) => ({ success: true, rows: Array.from({ length: 750 }, (_, i) => ({ i })), totals: { count: 750, listed: 750, truncated: false }, extra }));
    const onWarn = vi.fn();
    const out = await exportFullLedgerCSV({ fetchAll, columns: [{ label: 'i', key: 'i' }], onWarn });
    expect(fetchAll).toHaveBeenCalledWith({ export: '1' });
    expect(saved[0]).toHaveLength(750);
    expect(out).toEqual({ written: 750, total: 750, truncated: false });
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('warns with written-of-total when the server still capped the export', async () => {
    const fetchAll = vi.fn(async () => ({ data: { rows: [{ i: 1 }, { i: 2 }], totals: { count: 60000, listed: 2, truncated: true } } }));
    const onWarn = vi.fn();
    const out = await exportFullLedgerCSV({ fetchAll, columns: [], onWarn });
    expect(out.truncated).toBe(true);
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn.mock.calls[0][0]).toMatch(/2 of 60,000/);
  });
});

describe('fetchAllPagesCapped', () => {
  it('walks every page when under the cap', async () => {
    const api = pagedApi(450);
    const r = await fetchAllPagesCapped(api, { action: 'create' }, 'logs', { maxRows: 1000 });
    expect(r.rows).toHaveLength(450);
    expect(r).toMatchObject({ total: 450, truncated: false });
    expect(api.mock.calls.every(([p]) => p.action === 'create')).toBe(true);
  });
  it('stops at maxRows and says it was truncated', async () => {
    const api = pagedApi(1000);
    const r = await fetchAllPagesCapped(api, {}, 'logs', { maxRows: 300 });
    expect(r.rows).toHaveLength(300);
    expect(r).toMatchObject({ total: 1000, truncated: true });
    expect(api).toHaveBeenCalledTimes(2); // pages 1-2 only, never all 5
  });
  it('an unpaged endpoint is one call, never truncated', async () => {
    const api = vi.fn(async () => ({ data: { logs: [{ id: 1 }] } }));
    expect(await fetchAllPagesCapped(api, {}, 'logs')).toEqual({ rows: [{ id: 1 }], total: 1, truncated: false });
  });
});

describe('capped-list and server-CSV warnings', () => {
  it('csvCapWarning only when the list was cut', () => {
    expect(csvCapWarning(2000, 2000)).toBeNull();
    expect(csvCapWarning(5, undefined)).toBeNull();
    expect(csvCapWarning(2000, 2345)).toMatch(/2,000 of 2,345/);
  });
  it('downloadServerCsv asks for format=csv and passes the header verdict through', async () => {
    download.mockResolvedValue({ rowCount: 100000, total: 120000, truncated: true });
    const info = await downloadServerCsv('/api/reporting/local-sales', { from_date: '2026-10-01', q: '' }, 'ls');
    expect(download.mock.calls[0][0]).toBe('/api/reporting/local-sales?from_date=2026-10-01&format=csv');
    expect(download.mock.calls[0][1]).toBe('ls.csv');
    expect(serverCsvWarning(info)).toMatch(/100,000 of 120,000/);
  });
  it('an older client without header info is treated as complete', async () => {
    download.mockResolvedValue(undefined);
    const info = await downloadServerCsv('/x', {}, 'x');
    expect(info.truncated).toBe(false);
    expect(serverCsvWarning(info)).toBeNull();
  });
});

describe('printableTruncations', () => {
  it('finds every capped detail list in a printable payload', () => {
    const data = {
      totals: { revenue: 10 },
      detailTruncated: { export: true, local: false, expenses: true },
      audit: { rows: [{ a: 1 }], truncated: true },
      truncated: false,
    };
    expect(printableTruncations(data).sort()).toEqual(['audit.truncated', 'detailTruncated.expenses', 'detailTruncated.export']);
    expect(printableTruncations({ rows: [{ x: 1 }] })).toEqual([]);
  });
});
