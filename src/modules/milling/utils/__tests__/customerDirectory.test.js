import { describe, it, expect } from 'vitest';
import { buildCustomerRows, nonSaleReceivables } from '../customerDirectory';

const CUSTOMERS = [
  { id: 72, name: 'YOUSUF BROKER' },
  { id: 96, name: 'AKMAL PARACHA' },
  { id: 56, name: 'MURTAZA' },
];
// One real sale, part-paid or not.
const SALES = [{ customerId: 72, totalAmount: 404040, dueAmount: 404040, saleGroupNo: 'LS-0001' }];
// What the endpoint returns: table rows AND local-sale-derived rows together.
const RECEIVABLES = [
  { id: 1, customerId: 72, recvNo: 'RCV-OPEN-72', expectedAmount: 739361, outstanding: 739361, kind: 'receivable' },
  { id: 2, customerId: 96, recvNo: 'RCV-OPEN-96', expectedAmount: 37534, outstanding: 37534, kind: 'receivable' },
  { id: 3, customerId: 72, recvNo: 'LS-0001', expectedAmount: 404040, outstanding: 404040, kind: 'local_sale' },
];
const row = (rows, name) => rows.find((r) => r.name === name);

describe('nonSaleReceivables', () => {
  it('drops the rows the endpoint derives from local sales', () => {
    expect(nonSaleReceivables(RECEIVABLES).map((r) => r.recvNo)).toEqual(['RCV-OPEN-72', 'RCV-OPEN-96']);
  });

  it('survives a missing or malformed list', () => {
    expect(nonSaleReceivables(undefined)).toEqual([]);
    expect(nonSaleReceivables(null)).toEqual([]);
    expect(nonSaleReceivables([null])).toEqual([]);
  });
});

describe('buildCustomerRows', () => {
  const rows = buildCustomerRows(CUSTOMERS, SALES, RECEIVABLES);

  it('shows an opening balance for a customer with no sale at all', () => {
    // The bug: these showed a row of zeros while the money was in the GL.
    expect(row(rows, 'AKMAL PARACHA')).toMatchObject({ billed: 37534, outstanding: 37534, count: 1 });
  });

  it('adds a sale and an opening balance together, each once', () => {
    // 404,040 sale + 739,361 opening. Folding the whole receivables list in
    // counted the sale twice and gave 1,547,441.
    expect(row(rows, 'YOUSUF BROKER')).toMatchObject({ billed: 1143401, outstanding: 1143401, count: 2 });
    expect(row(rows, 'YOUSUF BROKER').billed).not.toBe(1547441);
  });

  it('leaves a customer with neither at zero', () => {
    expect(row(rows, 'MURTAZA')).toMatchObject({ billed: 0, outstanding: 0, count: 0 });
  });

  it('counts a part-paid receivable as received', () => {
    const r = buildCustomerRows(
      [{ id: 96, name: 'AKMAL PARACHA' }], [],
      [{ id: 9, customerId: 96, recvNo: 'R1', expectedAmount: 1000, outstanding: 400, kind: 'receivable' }],
    );
    expect(row(r, 'AKMAL PARACHA')).toMatchObject({ billed: 1000, paid: 600, outstanding: 400 });
  });

  it('ignores a receivable for a customer not in the directory', () => {
    const r = buildCustomerRows(
      [{ id: 96, name: 'AKMAL PARACHA' }], [],
      [{ id: 9, customerId: 999, expectedAmount: 5000, outstanding: 5000, kind: 'receivable' }],
    );
    expect(r.reduce((s, x) => s + x.outstanding, 0)).toBe(0);
  });

  it('sorts by what is owed, biggest first', () => {
    expect(rows.map((r) => r.name)).toEqual(['YOUSUF BROKER', 'AKMAL PARACHA', 'MURTAZA']);
  });

  it('still matches a walk-in sale by buyer name', () => {
    const r = buildCustomerRows(
      [{ id: 56, name: 'MURTAZA' }],
      [{ customerId: null, buyerName: ' murtaza ', totalAmount: 500, dueAmount: 100, saleNo: 'LS-9' }],
      [],
    );
    expect(row(r, 'MURTAZA')).toMatchObject({ billed: 500, paid: 400, outstanding: 100, count: 1 });
  });

  it('does not double count one receivable listed twice', () => {
    const dup = [
      { id: 1, customerId: 96, recvNo: 'RCV-OPEN-96', expectedAmount: 37534, outstanding: 37534, kind: 'receivable' },
      { id: 1, customerId: 96, recvNo: 'RCV-OPEN-96', expectedAmount: 37534, outstanding: 37534, kind: 'receivable' },
    ];
    // Amounts add (the caller must not send duplicates) but the invoice COUNT is
    // by reference, so a repeated row does not inflate it.
    expect(row(buildCustomerRows([{ id: 96, name: 'AKMAL PARACHA' }], [], dup), 'AKMAL PARACHA').count).toBe(1);
  });
});
