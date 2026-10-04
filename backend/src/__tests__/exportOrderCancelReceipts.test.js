/**
 * Cancelling an export order refunds only money that was actually banked.
 *
 * cancelOrder took every payment on the order's receivables and decremented
 * the bank for each. But a receipt recorded through recordExportReceipt sits at
 * 'Pending Finance Confirmation' and never credited a bank, and a 'Rejected'
 * one never did either — so a cancel took money out of the account that had
 * never gone in. Only a confirmed receipt (confirmAdvance/confirmBalance insert
 * it with the default status 'Confirmed' and increment the bank) is unwound.
 *
 * This runs unwindOrderReceipts — the step cancelOrder calls — against a
 * recording stub transaction.
 */
const { unwindOrderReceipts } = require('../modules/exportOrders/unwindReceipts');

function recordingTrx(banks) {
  const calls = [];
  const trx = (table) => {
    const q = { table, where: null, whereIn: null };
    const b = {
      where(c) { q.where = c; return b; },
      whereIn(col, ids) { q.whereIn = { col, ids: [...ids] }; return b; },
      async first() { return table === 'bank_accounts' ? banks.find((x) => x.id === q.where.id) : undefined; },
      async decrement(col, by) { calls.push({ op: 'decrement', ...q, col, by }); return 1; },
      async del() { calls.push({ op: 'del', ...q }); return 1; },
      async update(patch) { calls.push({ op: 'update', ...q, patch }); return 1; },
    };
    return b;
  };
  trx.fn = { now: () => 'now()' };
  return { trx, calls };
}

const BANKS = [{ id: 4, currency: 'USD' }, { id: 1, currency: 'PKR' }];
const confirmed = { id: 11, status: 'Confirmed', bank_account_id: 4, currency: 'USD', amount: '3000.00', base_amount_pkr: '840000.00' };
const pending = { id: 12, status: 'Pending Finance Confirmation', bank_account_id: 4, currency: 'USD', amount: '2000.00', base_amount_pkr: '560000.00' };
const rejected = { id: 13, status: 'Rejected', bank_account_id: 4, currency: 'USD', amount: '1500.00', base_amount_pkr: '420000.00' };

describe('cancel unwinds only confirmed receipts', () => {
  it('one confirmed + one pending + one rejected: the bank loses only the confirmed amount', async () => {
    const { trx, calls } = recordingTrx(BANKS);
    const out = await unwindOrderReceipts(trx, [confirmed, pending, rejected], { orderNo: 'EX-006', userId: 2 });

    const decrements = calls.filter((c) => c.op === 'decrement');
    expect(decrements).toHaveLength(1);
    expect(decrements[0]).toMatchObject({ table: 'bank_accounts', where: { id: 4 }, col: 'current_balance', by: 3000 });

    // The confirmed receipt's bank trail and row go; nothing else is deleted.
    const dels = calls.filter((c) => c.op === 'del');
    expect(dels.map((d) => [d.table, d.whereIn.ids])).toEqual([
      ['bank_transactions', [11]],
      ['payments', [11]],
    ]);

    // The pending receipt is voided (Rejected) without touching the bank; the
    // rejected one is left alone.
    const updates = calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].whereIn.ids).toEqual([12]);
    expect(updates[0].patch.status).toBe('Rejected');
    expect(updates[0].patch.reject_reason).toMatch(/EX-006 cancelled/);

    expect(out).toEqual({ refunded: 1, voided: 1 });
  });

  it('a PKR bank is debited the PKR the confirm credited, not the USD figure', async () => {
    const { trx, calls } = recordingTrx(BANKS);
    await unwindOrderReceipts(trx, [{ ...confirmed, bank_account_id: 1 }], { orderNo: 'EX-006' });
    expect(calls.find((c) => c.op === 'decrement')).toMatchObject({ where: { id: 1 }, by: 840000 });
  });

  it('only pending and rejected receipts: no bank movement at all', async () => {
    const { trx, calls } = recordingTrx(BANKS);
    const out = await unwindOrderReceipts(trx, [pending, rejected], { orderNo: 'EX-006' });
    expect(calls.filter((c) => c.op === 'decrement' || c.op === 'del')).toEqual([]);
    expect(out).toEqual({ refunded: 0, voided: 1 });
  });

  it('a reversed receipt was already put back and is left alone', async () => {
    const { trx, calls } = recordingTrx(BANKS);
    await unwindOrderReceipts(trx, [{ ...confirmed, status: 'Reversed' }], { orderNo: 'EX-006' });
    expect(calls).toEqual([]);
  });
});
