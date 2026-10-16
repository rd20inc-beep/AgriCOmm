import { describe, it, expect } from 'vitest';
import { moneyInTiles, moneyOutTiles, isOverdueRow } from '../moneyTiles';

// D-15 (FIN-08): "overdue" is the server's flag on each row (backend
// kpi/overdue.js) — an export balance is due sailing + term — never the status
// word (export receivables never carry 'Overdue') nor a raw due date.
describe('Money In / Out overdue tiles read the server flag', () => {
  const recv = [
    // Export balance, server says overdue, status word is 'Pending'.
    { kind: 'receivable', currency: 'USD', status: 'Pending', outstanding: 800, receivedAmount: 200, isOverdue: true },
    // Placeholder due date in the past but the order has not sailed: not overdue.
    { kind: 'receivable', currency: 'USD', status: 'Pending', outstanding: 500, receivedAmount: 0, dueDate: '2020-01-01', isOverdue: false },
    // Local sale past due.
    { kind: 'local_sale', status: 'Overdue', outstanding: 1000, receivedAmount: 0, isOverdue: true },
    { kind: 'receivable', currency: 'USD', status: 'Paid', outstanding: 0, receivedAmount: 1000, isOverdue: false },
  ];

  it('overdue per currency from isOverdue only', () => {
    const t = moneyInTiles(recv);
    expect(t.overdue).toEqual(expect.objectContaining({ USD: 800, PKR: 1000 }));
    expect(t.outstanding).toEqual(expect.objectContaining({ USD: 1300, PKR: 1000 }));
  });

  it('payables: a raw past due date alone is not overdue', () => {
    const t = moneyOutTiles([
      { currency: 'PKR', status: 'Pending', outstanding: 300, paidAmount: 0, dueDate: '2020-01-01', isOverdue: true },
      { currency: 'PKR', status: 'Pending', outstanding: 0, paidAmount: 50, dueDate: '2020-01-01', isOverdue: false },
      { currency: 'PKR', status: 'Overdue', outstanding: 70, paidAmount: 0, isOverdue: false },
    ]);
    expect(t.overdue).toEqual(expect.objectContaining({ PKR: 300 }));
  });

  it('isOverdueRow is strict', () => {
    expect(isOverdueRow({ isOverdue: true })).toBe(true);
    expect(isOverdueRow({ status: 'Overdue' })).toBe(false);
    expect(isOverdueRow(null)).toBe(false);
  });
});
