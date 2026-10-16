import { describe, it, expect, vi, beforeEach } from 'vitest';

// W19 — Audit Trail ▸ Export CSV: the screen holds the newest 100 rows; the
// CSV walks every page matching the server filters, applies the search box,
// and warns when the export limit cut it short.
const saved = [];
vi.mock('../../../shared/utils/csv', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, downloadCsv: vi.fn(({ rows, columns }) => { saved.push({ rows, columns }); return rows.length; }) };
});

const { exportAuditCsvAll, auditMatches, AUDIT_EXPORT_MAX } = await import('../utils/auditCsv');

function pagedAudit(n) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1, action: i % 2 ? 'update' : 'create', entity_type: 'lot', user_name: i === 7 ? 'Zainab' : 'Ali' }));
  return vi.fn(async ({ page = 1, limit = 50 } = {}) => {
    const lim = Math.min(200, limit);
    return { data: { logs: rows.slice((page - 1) * lim, page * lim), pagination: { page, limit: lim, total: n } } };
  });
}

beforeEach(() => { saved.length = 0; });

describe('exportAuditCsvAll', () => {
  it('exports every matching page (not the 100 on screen), with the server filters', async () => {
    const list = pagedAudit(530);
    const onWarn = vi.fn();
    const out = await exportAuditCsvAll({ params: { action: 'create', from_date: '2026-10-01' }, searchTerm: '', list, onWarn });
    expect(out).toEqual({ written: 530, total: 530, truncated: false });
    expect(saved[0].rows).toHaveLength(530);
    expect(list.mock.calls[0][0]).toMatchObject({ action: 'create', from_date: '2026-10-01', page: 1, limit: 200 });
    expect(onWarn).not.toHaveBeenCalled();
    // camelCased like the screen, so the CSV columns read the same fields
    expect(saved[0].rows[0]).toMatchObject({ entityType: 'lot', userName: 'Ali' });
  });

  it('applies the search box to the full set', async () => {
    const out = await exportAuditCsvAll({ params: {}, searchTerm: 'zainab', list: pagedAudit(300) });
    expect(out.written).toBe(1);
  });

  it('warns when the export limit is reached', async () => {
    const onWarn = vi.fn();
    const out = await exportAuditCsvAll({ params: {}, searchTerm: '', list: pagedAudit(AUDIT_EXPORT_MAX + 450), onWarn });
    expect(out.truncated).toBe(true);
    expect(saved[0].rows).toHaveLength(AUDIT_EXPORT_MAX);
    expect(onWarn.mock.calls[0][0]).toMatch(/20,000 of 20,450/);
  });

  it('auditMatches searches action, entity, user and details', () => {
    const l = { action: 'approve', entityType: 'payroll_run', entityId: 42, userName: 'Sana', details: { note: 'October' } };
    expect(auditMatches(l, '')).toBe(true);
    expect(auditMatches(l, 'PAYROLL')).toBe(true);
    expect(auditMatches(l, '42')).toBe(true);
    expect(auditMatches(l, 'october')).toBe(true);
    expect(auditMatches(l, 'reject')).toBe(false);
  });
});
